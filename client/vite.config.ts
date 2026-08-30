import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
// Production API URL is configured via VITE_API_URL at build time.
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
});
