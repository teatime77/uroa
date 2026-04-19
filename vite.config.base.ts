// root/vite.config.base.ts
import { UserConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export const baseConfig: UserConfig = {
  plugins: [
    tsconfigPaths({
      root: '../' 
    })
  ],
  base: './',
  build: {
    minify: false,
    target: 'esnext',
    sourcemap: true,
    // ★ 追加：ビルドのたびに出力先を空にする
    emptyOutDir: true,
    rollupOptions: {
      // input は各プロジェクトで定義するため、ここでは書かないか undefined にする
      output: {
        // ★ 追加：全プロジェクトでファイル名ルールを統一
        entryFileNames: '[name].mjs',
        chunkFileNames: '[name].mjs',
        assetFileNames: '[name].[ext]',
      }
    },
  }
};