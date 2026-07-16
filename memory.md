# Project memory

Running log of quirks, decisions, and specifics for this project. Not part of the
deployed site (lives at repo root, outside `docs/`, on purpose). Update this
whenever something non-obvious gets decided or fixed, so it doesn't have to be
re-discovered later.

## Deployment

- GitHub Pages serves from `docs/` on `main` (classic "Deploy from a branch",
  folder set to `/docs`), because that mode only supports `/(root)` or `/docs`,
  not an arbitrary folder name. The actual site source used to be `site/`,
  renamed to `docs/` specifically for this reason (2026-07-15).
- Live URL: https://2h5.github.io/DTC/
- Repo: https://github.com/2h5/DTC.git, pushed as git user `2h5`.
- `.claude/settings.local.json` is gitignored (local tool permissions, not
  shared config, contains this machine's absolute paths).

## Brand palette (locked)

- Real logo colors, extracted directly from the live site's logo SVG
  (`DTCLogoampwordmark.svg`): navy `#003d58` + teal `#60c3ad`. Not amber.
- An early pass wrongly guessed an amber/copper accent before anyone checked
  the actual logo. Fully purged, don't reintroduce `#dc7f2e` / `#e8964f` etc.
- Rule: teal fills (buttons, brand mark, tint washes), navy is used for all
  text/icon-on-light (eyebrows, links, focus states) since raw teal fails
  WCAG AA for text on a light background (~1.92:1).
- The live site's real service icon set (Testing & Repair, Spare Parts, etc.)
  bakes in a different arbitrary color per icon (`#f16724`, `#ffcf45`,
  `#dc3c3e`, `#0598cc`, `#1c5e2f`...) — a leftover rainbow scheme from the old
  design. Deliberately NOT imported, it would break the single-locked-accent
  rule. Custom single-color line-art icons are used instead throughout.

## Site architecture

- Static HTML/CSS/vanilla JS, no build step, no framework.
- Modular CSS/JS split so multiple people can work without touching the same
  file: `core/*` (shared everywhere) vs `pages/<type>.css` (one file per page
  *type*, not per page instance — e.g. `parts-category.css` serves both the
  brand grid and every brand's series grid). Full convention documented in
  `docs/README.md`.
- `.page-hero` (breadcrumb + eyebrow + h1 + lede + search-pill) lives in
  `core/base.css`, not a `pages/*.css` file, because 3+ page types use it.
  Bug fixed 2026-07-15: it was only defined in `parts-category.css`, so any
  page loading `parts-listing.css` instead (e.g. the Mark 1 & II listing)
  rendered with zero top spacing under the breadcrumb. If a new page uses
  `.page-hero` and gets weird spacing, check it's not been redefined/
  shadowed in a page-specific stylesheet.

## Parts catalog state (what's real vs. placeholder)

- Only one path is fully wired up end to end: Parts Shop → GE Boards &
  Turbine Control → Mark 1 & II → 259B2451BVP4. Every other brand tile,
  series tile, and listing row shows real data (real counts, real part
  numbers) but renders as a non-clickable `.is-disabled` tile/row rather
  than a dead link. To bring another brand/series online: flip its tile to
  a real `<a>`, build the next page down, reuse the existing shared
  `pages/parts-*.css` file untouched.
- Real photography and OEM logos are self-hosted under `docs/assets/img/`
  (downloaded once from the live site via curl, not hotlinked). Source URLs
  and the mapping of which image goes where are not preserved anywhere else,
  if more images are needed later, re-derive from `mirror/raw/*.html`.
- `mirror/` is a reference crawl of the current live site (fetched
  2026-07-12), kept for content/copy accuracy, not part of the deployed site.

## Small UX details worth remembering

- `.stock-badge .dot` has a slow 2.6s opacity pulse to read as "live" status,
  intentionally slow, not a rapid blink. Respects `prefers-reduced-motion`.
- `.brand-pill` logos are grayscale by default, full color on hover (calm
  logo wall, not a busy multi-color rail).
- Search boxes (`.search-pill`) and the hero search are inert
  (`onsubmit="return false;"`), there's no backend yet.
- No live browser testing/screenshots in this project (session preference),
  verification is static/scripted (grep, path-resolution checks) unless the
  user explicitly says otherwise.
