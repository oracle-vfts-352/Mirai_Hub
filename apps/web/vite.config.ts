import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The proxy keeps browser and API on one origin (localhost:5173), so the HttpOnly
// auth cookie and WebAuthn (ORIGIN=http://localhost:5173) work like they will in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
});