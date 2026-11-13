# Dashboard homepage design (Obsidian Core)

Design for the dashboard homepage in the dark Obsidian Core look. Only the homepage changes: the sidebar and top
bar in the image are the app's own, rendered from the live preview in dark mode.

- `obsidian-core-dashboard.png`: the design, 3360×2100 (16:10).
- `dash.html`: the homepage markup, styles and the two canvas images (hero energy column, obsidian-core card).
- `render.cjs`: opens `preview/index.html`, signs in with the sandbox persona, puts `dash.html` in the main area
  and saves the screenshot.

```bash
cd docs/design/dashboard-home
node render.cjs 2 obsidian-core-dashboard.png   # 2 = device scale factor (1680×1050 → 3360×2100)
```

This is a design, not a built screen: names and numbers are sample values. When it is built into
`src/components/DashboardView.tsx`, every figure must come from real data (CLAUDE.md rule 1).
