import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Send /api/* to the B2 API on port 3000, without the /api prefix.
    // To the browser it's all one site, so no CORS setup is needed and cookies just work.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? 3000}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
