# HLBuilder UI Style Guide

HLBuilder uses a dense, commercial product UI style: dark-first, operational, and built for repeated use. The interface should feel like a network design tool, not a marketing site.

## Design Principles

- Use the app theme tokens first: `background`, `foreground`, `card`, `muted`, `primary`, `border`, `ring`, and `sidebar-*`.
- Keep surfaces quiet and precise. Prefer compact panels, clear borders, and restrained shadows over decorative gradients.
- Use color for state and meaning: `primary` for selected/active, `destructive` for dangerous actions, and chart tokens for metrics.
- Keep cards at `var(--radius-xl)` or less. Tool panels and node UI should stay tighter, usually `var(--radius-lg)`.
- Icon buttons need `aria-label`; icons inside labeled buttons should be decorative.
- Text containers must handle long project names, hardware models, service names, and imported catalog data with `truncate`, `line-clamp`, `break-words`, or `min-w-0`.

## Shared Classes

Use these classes from `frontend/src/index.css` before adding new one-off styles:

- `app-page`: full page background treatment for non-canvas pages.
- `app-hero`: page header band with consistent bottom rule and spacing.
- `app-surface`: framed control rails, filter bars, and summary tiles.
- `app-card`: repeated item cards such as projects, hardware, and blueprints.
- `app-chip`: small section/status label.
- `app-pill`: filter/category pill.
- `app-empty-state`: dashed empty state container.
- `app-sidebar`: left navigation shell.
- `builder-glass-panel`: floating builder header/status panels.
- `builder-floating-panel`: draggable builder panels such as the library.
- `builder-control-button`: builder toolbar buttons.
- `builder-tool-tile`: draggable hardware/service tiles.
- Global command palette: use `cmdk` via `frontend/src/components/command-palette.tsx` for cross-app navigation and common builder actions. Add actions there before adding another permanent sidebar control.

## Target Surfaces

Visual Builder:
Use a full-bleed canvas. Floating controls should use `builder-glass-panel` or `builder-control-button`. The toolbox should use `builder-floating-panel`, compact tabs, and `builder-tool-tile` for draggable assets.

Left Menu:
Use `sidebar-*` theme tokens only. Do not hard-code sidebar hex values. Active items use a contained pill, a small icon fill, and a restrained outline. Do not use a colored left rail or left border for the active state.

Projects:
Use `app-page`, `app-hero`, and `app-card`. Project cards should emphasize opening the editor and keep secondary actions in a compact menu.

Hardware Catalog:
Use `app-surface` for filters and summary tiles, `app-pill` for source/category filters, and `app-card` for hardware and blueprint cards.

## Avoid

- Hard-coded dark palette values for shared UI. Add or use theme tokens instead.
- `transition-all`; list the changed properties.
- Floating cards inside other cards.
- Large decorative hero sections for app workflows.
- New CSS files for a single screen unless the styles cannot reasonably be shared.
