# Obsidian design system

One token layer (`src/styles/obsidian-theme.css`) drives every screen in light and dark mode.
**Light is the default theme** (`DEFAULT_THEME` in `ThemeContext.tsx`, and `index.html` before first paint);
a person's saved choice (Light / Dark / Match system) is kept. The dashboard is the visual reference.
Tailwind v4 colour utilities read CSS variables, so existing classes (`bg-white`, `text-neutral-700`,
`bg-indigo-600`…) follow the theme without per-component edits.

## Identity
- **One frame**: the sidebar, top bar, sign-in page and every page use the same surface tokens, so in light mode
  everything is paper and in dark mode everything is graphite. Only video surfaces (meeting stage, GREET guest
  page, the meeting room in a call) stay dark in both themes (`--obsidian-0…3`, `class="obsidian"`).
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
- **New screens use the tokens above**, never dark-first classes (`text-white` on a neutral background,
  `border-white/10`, `bg-black/40`, `text-neutral-300`). Light text belongs only on accent/status fills.
- **Always-dark panels** (video only): `class="obsidian"` keeps dark-panel greys in both themes.
- **Dark islands** (a `bg-slate-900` badge inside a light card) keep their own greys automatically.
- No glassmorphism (backdrop blur is disabled globally), no decorative glow, gradients only where they carry meaning.
  - **Exception: the AI Command Center surface** (dashboard homepage, Lead Intelligence and Reports & Analytics). Its root has the
    `cc` class (styles at the end of `src/index.css`): pastel canvas, frosted-glass cards (`cc-card`), the aurora
    orb (`cc-orb`), the gradient-edged copilot composer (`cc-composer`), tinted setup cards (`cc-step`) and
    gradient titles (`cc-title`). It follows the app theme (pastel light, navy dark) by redefining the tokens
    above on its root, so components inside need no special colours. Don't use these classes on other screens.
- Theme: `useTheme()` from `src/context/ThemeContext.tsx` (`pref`, `resolved`, `setPref`, `toggle`);
  the top bar has the System / Light / Dark switch. `index.html` applies the saved theme before first paint.

## Converted to tokens (were dark consoles)
Sign-in (incl. two-step prompt and lock screen), sidebar, profile and notification menus, command search,
Sales Pipeline, Unified Inbox (all messaging panels and dialogs), Social Planner (`--sp-*` now map to the CRM
tokens in `planner.css`), Settings and its sections, Billing & Subscription, Security & Access, plan
comparison, meeting admin, notification preferences and the AI receptionist training studio.

## Known gaps
- The video meeting workspace (`VideoMeetingWorkspace`) and GREET guest page stay dark on purpose (video).
- Some rarely used dialogs may still carry a dark-first class; the token rule above is the fix.
- 133 hex colours remain (brand colours such as LinkedIn blue, and distinct accents).
