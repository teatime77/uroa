import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
