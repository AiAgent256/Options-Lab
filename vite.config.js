import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/coinbase': {
        target: 'https://api.exchange.coinbase.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/coinbase/, ''),
      },
      '/api/phemex': {
        target: 'https://api.phemex.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/phemex/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
