/** ブラウザ用コンパイラーの固定依存と推移依存のライセンス・告知を配布資産へまとめる。 */
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const webRoot = process.cwd();
const roots = ['binaryen', '@wasmer/wasi', '@wasmer/wasmfs', 'fflate', 'path-browserify', 'buffer'];
const seen = new Set();
const sections = [];

/** 実際のNode解決順でパッケージを特定し、含まれる告知を再帰収集する。 */
async function collect(name, parent) {
    const require = createRequire(resolve(parent, 'package.json'));
    let directory;
    try {
        directory = dirname(require.resolve(name + '/package.json'));
    } catch {
        directory = dirname(require.resolve(name));
        while (true) {
            try {
                if (JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')).name === name) {
                    break;
                }
            } catch { /* パッケージの根へ上がる。 */ }
            const next = dirname(directory);
            if (next === directory) {
                throw new Error(`Package root not found: ${name}`);
            }
            directory = next;
        }
    }
    if (seen.has(directory)) {
        return;
    }
    seen.add(directory);
    const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const notices = (await readdir(directory)).filter(file => /^(license|copying|notice)/i.test(file)).sort();
    const texts = await Promise.all(notices.map(file => readFile(resolve(directory, file), 'utf8')));
    sections.push(`${pkg.name}@${pkg.version} (${JSON.stringify(pkg.license)})\n${texts.join('\n')}`);
    for (const child of Object.keys(pkg.dependencies ?? {}).sort()) {
        await collect(child, directory);
    }
}

for (const name of roots) {
    await collect(name, webRoot);
}
await writeFile(resolve(webRoot, 'public/diagram/runtime/v1/third-party-licenses.txt'), sections.join('\n\n====================\n\n') + '\n');
console.log(`Collected ${seen.size} package notices.`);
