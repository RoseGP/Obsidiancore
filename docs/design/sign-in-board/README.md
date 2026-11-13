# Sign-in and core-scan design board

Concept board for two screens: the login page (password sign-in plus "Send a magic link") and the
post-login screen that prepares the workspace (core scan, status panels, activity feed, connected sources).

- `obsidian-core-board.png`: the board, 3840×2160 (16:9).
- `board.html`: the source. Edit copy or layout here.
- `render.cjs`: renders the board with Playwright.

```bash
cd docs/design/sign-in-board
node render.cjs obsidian-core-board.png 2   # 2 = device scale factor (1920×1080 → 3840×2160)
```

This is a design concept, not a built screen. Names, the workspace and every number on the board are
placeholders. When the scan screen is built, it must show real values, as the codebase rules require.
The login side matches the sign-in methods that exist today: password, magic link
(`docs/auth/MAGIC_LINK.md`) and two-step verification.
