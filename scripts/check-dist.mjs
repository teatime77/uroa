import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'dist');
const apps = ['algebra', 'game', 'diagram', 'movie', 'webgpu'];
const errors = [];
const origin = 'https://uroa.invalid';

function attribute(tag, name) {
    return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
}

async function requireFile(path, description) {
    try {
        if ((await stat(path)).isFile()) return true;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    errors.push(`Missing file: ${description}`);
    return false;
}

async function checkReference(page, reference) {
    const url = new URL(reference, `${origin}/${page}`);
    if (url.origin !== origin) return false;
    const pathname = decodeURIComponent(url.pathname);
    if (/\.(?:tsx?|mts|cts)$/i.test(pathname)) {
        errors.push(`Uncompiled TypeScript reference in ${page}: ${reference}`);
    }
    const target = resolve(dist, '.' + pathname);
    const rel = relative(dist, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
        errors.push(`Reference outside dist in ${page}: ${reference}`);
        return false;
    }
    return requireFile(target, `${page} -> ${reference}`);
}

async function checkPage(page) {
    const path = resolve(dist, page);
    if (!await requireFile(path, page)) return;
    const html = await readFile(path, 'utf8');
    let hasModule = false;
    for (const tag of html.matchAll(/<script\b[^>]*>|<link\b[^>]*>/gi)) {
        const script = /^<script\b/i.test(tag[0]);
        const reference = attribute(tag[0], script ? 'src' : 'href');
        if (!reference) continue;
        if (!script && !/^(stylesheet|modulepreload)$/i.test(attribute(tag[0], 'rel') ?? '')) continue;
        const exists = await checkReference(page, reference);
        if (script && attribute(tag[0], 'type') === 'module' && exists) hasModule = true;
    }
    if (!hasModule) errors.push(`Missing local module entry in ${page}`);
    if (page === 'index.html') {
        const links = new Set([...html.matchAll(/<a\b[^>]*>/gi)].map(match => {
            const href = attribute(match[0], 'href');
            return href ? new URL(href, `${origin}/index.html`).href : '';
        }));
        for (const app of apps) {
            if (!links.has(`${origin}/${app}/index.html`)) errors.push(`Missing ${app} link in index.html`);
        }
    }
}

async function checkWebgpuAssets(directory, prefix = '') {
    let count = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = prefix + entry.name;
        if (entry.isDirectory()) {
            count += await checkWebgpuAssets(resolve(directory, entry.name), path + '/');
        } else if (entry.isFile() && path !== 'index.html') {
            await requireFile(resolve(dist, 'webgpu', path), `webgpu/${path}`);
            count++;
        }
    }
    return count;
}

try {
    for (const page of ['index.html', ...apps.map(app => `${app}/index.html`)]) {
        await checkPage(page);
    }
    const assetCount = await checkWebgpuAssets(resolve(root, 'webgpu/public'));
    // ブラウザ用VMとコンパイラーの配布漏れ・古い組合せを静的に検出する。
    const runtime = resolve(dist, 'diagram/runtime/v1');
    if (await requireFile(resolve(runtime, 'assets.json'), 'browser runtime manifest')) {
        const manifest = JSON.parse(await readFile(resolve(runtime, 'assets.json'), 'utf8'));
        if (manifest.wccCommit !== '659a1773f20499864a8c3fdc7cd25cb506092bc1' || manifest.emscriptenVersion !== '4.0.23') {
            errors.push('Browser runtime toolchain version mismatch');
        }
        for (const name of ['python-vm.mjs', 'python-vm.wasm', 'wccfiles.zip']) {
            if (await requireFile(resolve(runtime, name), name)) {
                const bytes = await readFile(resolve(runtime, name));
                const hash = createHash('sha256').update(bytes).digest('hex');
                if (manifest.files[name]?.sha256 !== hash || manifest.files[name]?.bytes !== bytes.length) {
                    errors.push(`Browser runtime hash mismatch: ${name}`);
                }
            }
        }
    }
    for (const name of ['wcc-LICENSE.txt', 'emscripten-LICENSE.txt', 'third-party-licenses.txt']) {
        await requireFile(resolve(runtime, name), name);
    }
    const workers = await readdir(resolve(dist, 'assets'));
    for (const prefix of ['browser-vm-worker-', 'browser-kernel-worker-']) {
        if (!workers.some(name => name.startsWith(prefix) && name.endsWith('.js'))) {
            errors.push(`Browser worker missing: ${prefix}`);
        }
    }
    for (const asset of ['diagram/data/gemini-object-detection.json', 'diagram/images/toolbox/ObjectDetectionBlock.svg',
        'diagram/data/gemini-image-caption.json', 'diagram/images/toolbox/ImageCaptionBlock.svg']) {
        await requireFile(resolve(dist, asset), asset);
    }
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exitCode = 1;
    } else {
        console.log(`dist OK: root and five app pages, local JS/CSS references, ${assetCount} WebGPU assets.`);
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
