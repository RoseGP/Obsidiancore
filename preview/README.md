# Obsidian CRM live preview (generated)

`index.html` is the page published as the Obsidian CRM Live Preview artifact
(claude.ai/code/artifact/67f456b9-c483-474c-a46c-48dc2171fce2). Open it in a browser: it is the whole app in one
file and needs no server or install.

**It is a build output, not source.** Change the app in `src/`, then rebuild this file. Don't edit `index.html`
by hand. It was built from commit `f348bd9` on this branch.

## What it contains
- The full React app (`src/`), built with Vite as a single file with `VITE_ENABLE_SANDBOX_LOGIN=true` so the
  demo sign-in works without Firebase.
- A **preview stand-in** (the `<script>` at the top, marked "Obsidian CRM preview stand-in") that answers the
  app's `/api` calls from records kept in the browser's `localStorage`. It exists only in this file; the real server
  is `server.ts`. "Add example records" in the bottom bar loads fictional examples marked "(example)".
- Website Forms: settings, form code, and "Send a test submission", which creates a lead, follow-up task and
  activity using the server's validation, spam and duplicate rules. Real websites can't post to it, webhooks
  aren't sent, and Turnstile keys aren't checked.
- Local SEO shows its real setup state ("Google isn't configured on the server yet"): Google sign-in and Google API
  calls need the server, so no Google data is shown.
- Other server-only features (LiveKit rooms, AI, data exports, sending messages) say they're unavailable.

## Rebuilding
```bash
# 1. Single-file build of the app (writes one JS and one CSS file)
cat > vite.preview.tmp.config.ts <<'EOF'
import { mergeConfig } from 'vite';
import base from './vite.config';
export default mergeConfig(base, { build: { outDir: 'dist-preview', emptyOutDir: true, assetsInlineLimit: 100000000,
  cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } } });
EOF
VITE_ENABLE_SANDBOX_LOGIN=true NODE_OPTIONS=--max-old-space-size=7000 npx vite build --config vite.preview.tmp.config.ts
rm vite.preview.tmp.config.ts
```
2. In `preview/index.html`, keep everything up to the end of the stand-in `</script>` (the head) and the closing
   `<style>…</style></head><body><div id="root"></div>…` part. Replace the `<script type="module">` block with the
   new JS and the `<style>` block after it with the new CSS. Escape `</script` in the JS as `<\/script` and
   `</style` in the CSS as `<\/style`.

The only key in the file is the Firebase web config `apiKey` from `firebase-applet-config.json`, which is a public
client identifier and already in the repository. No `.env` values are included.
