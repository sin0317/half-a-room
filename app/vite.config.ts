import { defineConfig } from 'vite';

/**
 * 构建产物直接落到仓库根目录的 viewer/，因为 ModelScope 创空间是 static 类型、
 * 不支持构建步骤：只能本地 build，再把产物当静态文件推上去。
 *
 * base 必须是 './'：创空间的页面挂在子路径下（如 /studios/sinria/half-a-room/viewer/），
 * 用绝对路径 '/assets/...' 会 404。
 */
export default defineConfig({
  base: './',
  build: {
    outDir: '../viewer',
    emptyOutDir: true,
    target: 'esnext',
    // 不要内联 worker / wasm，它们必须作为独立文件存在
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // 包内部用 new URL('./splat-worker.js', import.meta.url) 找 worker。
    // 预打包会把这段路径打乱，所以开发态让 Vite 直接按源码提供。
    exclude: ['@manycore/aholo-viewer'],
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
