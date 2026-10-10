import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

// Public HTML is copied without Vite transforms. Reuse the shared entry's
// generated asset tags for Hosting while keeping the source usable in dev.
function buildAppPagesPlugin(): Plugin {
    const pages = [
        ['algebra', 'public/algebra/index.html'],
        ['game', 'public/game/index.html'],
        ['diagram', 'public/diagram/index.html'],
        ['movie', 'public/movie/index.html'],
        ['webgpu', 'webgpu/public/index.html'],
    ] as const;

    return {
        name: 'build-app-pages',
        apply: 'build',
        enforce: 'post',
        async generateBundle(_options, bundle) {
            const entry = bundle['index.html'];
            if (!entry || entry.type !== 'asset') {
                this.error('Missing built index.html for the app pages');
            }
            const entryHtml = String(entry.source);
            const assetTags = entryHtml.match(
                /<script\b[^>]*\btype="module"[^>]*><\/script>|<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>/g
            );
            if (!assetTags?.some(tag => tag.startsWith('<script'))) {
                this.error('Missing built module script for the algebra page');
            }
            const tags = assetTags!.map(tag =>
                tag.replace(/\b(src|href)="\.\//g, '$1="../')
            ).join('\n  ');
            const sourceTag = '<script type="module" src="/diagram/ts/index.ts"></script>';
            for (const [app, sourcePath] of pages) {
                const source = await readFile(resolve(__dirname, sourcePath), 'utf8');
                if (!source.includes(sourceTag)) {
                    this.error(`Missing shared TypeScript entry in ${sourcePath}`);
                }
                this.emitFile({
                    type: 'asset',
                    fileName: `${app}/index.html`,
                    source: source.replace(sourceTag, tags),
                });
            }
        },
    };
}

function saveDataPlugin(): Plugin {
    return {
        name: 'save-data',

        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (req.method !== 'POST' || req.url !== '/api/save') {
                    next()
                    return
                }

                try {
                    let body = ''

                    for await (const chunk of req) {
                        body += chunk
                    }

                    const {
                        filename,
                        type,
                        data,
                    } = JSON.parse(body)

                    if (typeof filename !== 'string') {
                        throw new Error('Invalid filename')
                    }

                    // Prevent filenames such as "../../something"
                    const safe_filename = basename(filename)

                    const output_dir = resolve(process.cwd(), 'public/algebra/output')
                    const output_path = resolve(output_dir, safe_filename)

                    await mkdir(output_dir, { recursive: true })

                    const text = type == "text" ? data : JSON.stringify(data, null, 4);

                    await writeFile(
                        output_path,
                        text,
                        'utf8',
                    )

                    res.statusCode = 200
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify({
                        ok: true,
                        filename: safe_filename,
                    }))
                } catch (error) {
                    console.error(error)

                    res.statusCode = 500
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify({
                        ok: false,
                        error: String(error),
                    }))
                }
            })
        },
    }
}


export default defineConfig(({ command }) => ({
    root: '.',
    base: './', // baseConfigから引き継ぎ
    build: {
        target: 'esnext', // baseConfigから引き継ぎ
        minify: false,    // baseConfigから引き継ぎ
        sourcemap: true,  // baseConfigから引き継ぎ
        emptyOutDir: true,// baseConfigから引き継ぎ
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
            },
            output: {
                // baseConfigから引き継ぎ：出力ファイル名ルール
                entryFileNames: '[name].mjs',
                chunkFileNames: '[name].mjs',
                assetFileNames: '[name].[ext]',
            }
        }
    },
    resolve: {
        alias: {
            // workspaceの各モジュールへのエイリアス
            '@i18n': path.resolve(__dirname, './i18n/ts'),
            '@parser': path.resolve(__dirname, './parser/ts'),
            '@algebra': path.resolve(__dirname, './algebra/ts'),
            '@layout': path.resolve(__dirname, './layout/ts'),
            '@plane': path.resolve(__dirname, './plane/ts'),
            '@uroa-firebase': path.resolve(__dirname, './firebase/ts'),
            '@webgpu': path.resolve(__dirname, './webgpu/ts'),
            '@game': path.resolve(__dirname, './game/ts'),
            '@movie': path.resolve(__dirname, './movie/ts'),
            '@diagram': path.resolve(__dirname, './diagram/ts')
        }
    },
    plugins: [
        viteStaticCopy({
            targets: [
                {
                    // 絶対パスではなく、スラッシュ(/)区切りの相対パス文字列を指定する
                    // The build plugin emits this HTML. Keep serving the source in dev.
                    src: command === 'build'
                        ? ['webgpu/public/**/*', '!webgpu/public/index.html']
                        : 'webgpu/public/**/*',
                    dest: 'webgpu',
                    rename: { stripBase: 2 }
                }
            ]
        })
        ,
        saveDataPlugin(),
        buildAppPagesPlugin()
    ]
}));
