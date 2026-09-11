import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

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


export default defineConfig({
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
                    src: 'webgpu/public/**/*',
                    dest: 'webgpu',
                    rename: { stripBase: 2 }
                }
            ]
        })
        ,
        saveDataPlugin()
    ]
});