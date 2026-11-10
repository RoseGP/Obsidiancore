# Obsidian design system

One token layer (`src/styles/obsidian-theme.css`) drives every screen in light and dark mode.
Tailwind v4 colour utilities read CSS variables, so existing classes (`bg-white`, `text-neutral-700`,
`bg-indigo-600`…) follow the theme without per-component edits.

## Identity
- **Graphite frame**: the sidebar and always-dark panels stay graphite in both themes (`--obsidian-0…3`).
- **Paper canvas** in light mode (`--app-bg #F5F5F3`, `--surface #FFFFFF`), graphite in dark (`#131315` / `#1A1A1D`).
- **One accent, Iris**: `--accent #5A4ED9` (dark mode `#6C62EA`; text `#A9A2FF`). Blue, indigo, violet and purple
  classes all map to it, so actions and selection read as one colour.
- **Status**: `--success`, `--warning`, `--danger`, `--info` (+ `-soft` backgrounds), legible in both themes.

## Type
Instrument Sans (Google Fonts), base 14 px, tabular figures in tables (`tabular-nums`). Scale used in the
shell: 12 / 13 / 14 / 16 / 20 / 26–30 (page greeting). Headings use slight negative tracking; labels are
sentence case (no tracked capitals).

## Tokens to use in new code
| Token | Use |
|---|---|
| `--app-bg`, `--surface`, `--surface-raised`, `--surface-sunken` | page, cards, menus, wells/inputs |
| `--border`, `--border-strong` | dividers, control outlines |
| `--text`, `--text-muted`, `--text-subtle` | primary, secondary, tertiary text |
| `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft` | primary actions, links, selected states |
| `--radius-control` 8 px, `--radius-card` 12 px, `--radius-panel` 16 px | hierarchy through radius |

Example: `className="bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]"`.

## Rules
- **Always-dark panels**: add `class="obsidian"` to anything designed with light text on a dark background.
  Inside it the grey scale keeps dark-panel values in both themes.
- **Dark islands** (a `bg-slate-900` badge inside a light card) keep their own greys automatically.
- No glassmorphism (backdrop blur is disabled globally), no decorative glow, gradients only where they carry meaning.
  - **Exception: the dashboard homepage.** `DashboardView` uses the "AI Command Center" surface in
    `src/styles/dashboard-home.css`: a pastel canvas, frosted-glass cards and the assistant orb, all scoped to
    `.dash-home` (`dash-glass`, `dash-glass-strong`, `dash-pill`, `dash-btn`, `dash-chip`, `dash-orb`). It has its
    own light and dark values and still reads text, accent and border colours from the tokens above. Don't use
    these classes on other screens.
- Theme: `useTheme()` from `src/context/ThemeContext.tsx` (`pref`, `resolved`, `setPref`, `toggle`);
  the top bar has the System / Light / Dark switch. `index.html` applies the saved theme before first paint.

## Known gaps
- Sales Pipelines, Messaging, Social Planner, Analytics and Settings were built as dark consoles; they render in
  the graphite frame in both themes. A true light variant needs per-screen work.
- 133 hex colours remain (brand colours such as LinkedIn blue, and distinct accents).
