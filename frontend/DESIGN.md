---
version: alpha
name: HLBuilder
description: A planner for homelabs, LAN parties and game servers. Outside the canvas the app reads like the paperwork of the plan it holds: tables, schedules and runbooks, set plainly.
colors:
  # The default theme, "dark". A user can pick another theme or import one
  # (src/theme/presets.json, Settings > Appearance): every value below is a
  # token, and a page must be right in all of them.
  ground: "#0b0b0e"   # --background
  ink: "#fafafa"      # --foreground
  muted: "#a1a1aa"    # --muted-foreground: secondary text
  rule: "#27272a"     # --border: every hairline
  surface: "#111113"  # --card: what really is a surface of its own
  action: "#fafafa"   # --primary: the one filled button on a page
typography:
  display:
    fontFamily: Inter
    fontSize: 1.75rem
    fontWeight: 600
    letterSpacing: -0.02em
  body:
    fontFamily: Inter
    fontSize: 0.875rem
    lineHeight: 1.5
  figure:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
rounded:
  sm: 0.5rem     # --radius-md: inputs, buttons, filters, code blocks
  md: 0.625rem   # --radius-lg: cards, dialogs
spacing:
  sm: 0.75rem
  md: 1.5rem
  lg: 2.5rem
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.ground}"
    rounded: "{rounded.sm}"
    padding: 0 1rem
---

## Overview

HLBuilder is used by people who read spec sheets, IP plans and `docker compose` files for fun.
The canvas is where a plan is drawn. Everything else in the app is what such a plan turns into
on paper: a cable schedule, an address plan, a parts list, a runbook to work through at the
rack. So the screens outside the canvas are set like that paperwork, and like the landing page
(`src/features/landing/landing.css`), which states the same rules for the public site.

The look comes from the content: a table where things are compared, a numbered list where there
is an order, a sentence where there is something to say. Nothing is added to make a page look
designed.

This file covers every screen outside the canvas. The canvas keeps the look it has until it is
redesigned (`builder-*`, `hardware-node-*`, `rack-node-*` in `src/index.css`).

## Colors

All colour is a theme token. A hard-coded Tailwind colour (`text-blue-500`, `bg-neutral-950`)
breaks the themes a user can choose, and is not used.

- **Ground (`--background`)**: the page. No washes or gradients on it.
- **Ink (`--foreground`)**: text, and the border of whatever is selected.
- **Muted (`--muted-foreground`)**: secondary text; it stays above 4.5:1 on the ground.
- **Rule (`--border`)**: hairlines. They separate; boxes are for things that really are objects.
- **Surface (`--card`, `--muted`)**: a project card, a code block, a dialog.
- **Action (`--primary`)**: one filled button per page, the thing the page is for. In the
  default theme it is the ink; in a coloured theme it is that theme's colour.
- **State (`--status-ok`, `--status-warn`, `--destructive`)**: saved, needs a look, failed.
  The two status tokens follow only light or dark, so "saved" is the same green in every theme.
  State is the only job colour has. The device colours belong to the canvas.

## Typography

Inter for the interface, JetBrains Mono for figures.

- Page title: 1.75rem, 600, tight. One per page, in `PageHeader`. An article may set its title
  larger (the homelab guide does); a tool page does not.
- Section heading: 1.125rem to 1.25rem, 600. Table headers: 0.8125rem, regular, muted.
- Sentence case for headings, labels and buttons. The names of the app's own places keep their
  capitals (Setup Guide, Config Generator, Service Library).
- The monospace face is for what is compared character by character: addresses, ports, sizes,
  prices, commands (`.app-figure`, `.is-figure`, `.app-code`). It is not used for labels.
- A number in front of a heading means the headings are steps in an order.

## Layout

- Every page starts at the same left edge (`Page` in `src/components/layout/page.tsx`), so the
  title stands in the same place wherever one goes. A page is not centred in the window; how far
  it runs to the right depends on what it holds (`wide`, `article`, `narrow`).
- The title sits on a hairline (`PageHeader`): title, one or two sentences, and at the right
  what can be done with the page as a whole.
- Under it, one of two shapes:
  - **what is scanned** is a table (`.app-table`): Service Library, the tables of the Setup
    Guide, the review step of the planner. Filters stand in a rail at the left on a wide screen
    and become a row of chips on a narrow one.
  - **what is read** is an article beside a rail (`PageRow`): the heading stays in view at the
    left while its content scrolls by. Homelab Guide, and the landing page.
- A grid of cards is for things that are objects with a picture of their own: projects (the
  miniature of the canvas) and catalog hardware.

## Elevation & Depth

Flat. A shadow is for what floats above the page: a dialog, a menu, a popover, a toast.
No glow, no blur, no gradient surfaces.

## Shapes

`--radius-md` for controls and code, `--radius-lg` for cards and dialogs. Fully round only for
what is round by nature: an avatar, the dot of a one-of-several choice.

## Components

- `Page`, `PageHeader`, `PageRow` (`src/components/layout/page.tsx`): the frame of every page.
- `.app-table`, `.app-table-scroll`: rows with hairlines; `.is-figure` and `.is-end` on cells.
- `.app-filter`: a filter that is switched on and off (`aria-pressed`), with `.app-count`.
- `.app-code`: a command or a file as typed. It follows the theme; it is not a black terminal.
- `.app-link`: an underlined link in running text.
- `.app-card`, `.app-empty-state`: a bordered object; a dashed box that says what is missing
  and offers the way on. Empty states are left-aligned sentences, not an icon in the middle.
- `TickBox` (`src/components/ui/tick-box.tsx`): the checkbox, drawn from the theme.
- `UserAvatar` (`src/components/ui/user-avatar.tsx`): a picture or initials; nothing is fetched
  from an avatar service.
- Sidebar (`src/components/layout/sidebar.tsx`): the work at the top (Projects, the open
  project and its pages, what is looked up), the app itself at the foot (command menu,
  settings, survey, support), and the account, whose menu holds everything rarely needed.

## Motion

None for effect. A control answers at once (a 150 ms colour change). What moves in the app is on
the canvas and in the landing page's rack, and each of those says so in its own place.

## Print

The Setup Guide is made to be printed and taken to the rack. `@media print` in `src/index.css`
sets dark ink on white whatever the theme, lets the page run its full length, and drops what is
only for a screen (`print:hidden`). A new page that is worth printing gets this for free; check
it in the browser's print preview.

## Do's and Don'ts

- Do build a new page from `Page`, `PageHeader` and the classes above. Add a class here before
  a page invents one.
- Do check a page in a light theme, a coloured theme (for example Overwatch Light), at phone
  width, and in print when it is a document.
- Do run `scripts/detect.mjs` of [avoid-ai-design](https://github.com/funboy322/avoid-ai-design)
  over a redesigned folder. It reports the tick in a tick box and the assistant's mark as worn
  icons; those two are meant.
- Don't change: Inter and JetBrains Mono, the neutral default theme, the theme tokens. Users
  choose their theme; the app does not hard-code one.
- Don't use: gradient or glow backgrounds, glass, pill badges above a title, an icon in a
  tinted square, the same icon on every card, coloured left borders, all-caps tracked labels,
  metadata joined with middle dots, arrows glued to button labels, decorative numbering,
  count-up or fade-in-on-scroll motion, a sparkle for anything that is not the assistant.
- Don't put a hero on a tool page. A page says what it is in its title and gets to work.
