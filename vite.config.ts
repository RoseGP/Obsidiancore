import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  // Some browser modules (e.g. src/lib/firebase.ts) read process.env as a
  // fallback. Browsers have no `process`, so expose an empty object; real
  // values come from import.meta.env (VITE_*) or firebase-applet-config.json.
  define: {
    'process.env': {}
  },
  resolve: {
    alias: {
      '@cloudflare/voice/react': path.resolve(__dirname, './src/lib/cloudflare-voice-react.ts')
    }
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    // The API server writes JSON stores under data/ (billing, social accounts, Local SEO). Without this,
    // every write triggered a full page reload in development (a reload loop on the Social Planner).
    watch: { ignored: ['**/data/**', '**/*.tmp', '**/dist/**'] },
  }
});
