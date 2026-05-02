import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

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
    ]
});