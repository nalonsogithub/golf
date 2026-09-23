import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `vite build`               -> dist/ (what Vercel deploys)
// `vite build --mode single` -> trackman-dashboard.html (one self-contained file for email)
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    plugins: single ? [react(), viteSingleFile({ removeViteModuleLoader: true })] : [react()],
    build: single
      ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000, cssCodeSplit: false }
      : { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
  }
})
