import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/
// Production API URL is configured via VITE_API_URL at build time.
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  resolve: {
    alias: {
      // The repo-root proctoring engine's PURE modules (episode/focus
      // trackers, event buffer, shared types) are the single source of
      // truth for both the mobile app and this web client — imported, not
      // copied, so the client/server threshold mirror stays at two copies.
      '@app-services': fileURLToPath(new URL('../services', import.meta.url)),
    },
  },
});
