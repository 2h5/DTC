# Site structure

Static HTML/CSS/vanilla JS, no build step. Pages are flat `.html` files (matching
the site's existing URLs, e.g. `about-us.html`, `parts-shop.html`), with parts
subcategories under `parts/` (e.g. `parts/bently-nevada.html`). This doc explains
how the CSS/JS underneath those pages is organized so more than one person can
build pages at the same time without editing the same file.

## File map

```
site/
  index.html                                          home
  parts-shop.html                                     brand grid (top of parts IA)
  parts/
    ge-boards-turbine-control.html                    one brand's series grid
    ge-boards-turbine-control/mark-1-ii.html           one series' part-number listing
    259b2451bvp4.html                                  one product detail page (flat, like all products)
  _template.html                                       starting point for a new flat page
  assets/
    css/
      core/
        tokens.css        design tokens (:root variables only)
        base.css           reset, type scale, .btn/.link/.eyebrow, .breadcrumb,
                            .search-pill, .stock-badge, skip-link, .reveal
        site-chrome.css    utility bar, header/nav (incl. aria-current highlight),
                            mobile nav overlay, footer
      pages/
        home.css              index.html only
        parts-category.css    shared: any tile-grid page (brand grid, series grid)
        parts-listing.css     shared: any part-number listing table
        parts-product.css     shared: any single product detail page
        <page-name>.css       one page's own styles, nothing else touches this file
    js/
      core.js              nav toggle, header scroll shadow, reveal observer, smooth anchors
      pages/
        home.js            index.html only
        <page-name>.js     one page's own behavior
```

## Load order (every page)

```html
<link rel="stylesheet" href="assets/css/core/tokens.css">
<link rel="stylesheet" href="assets/css/core/base.css">
<link rel="stylesheet" href="assets/css/core/site-chrome.css">
<link rel="stylesheet" href="assets/css/pages/<page-name>.css">  <!-- omit if not needed -->
...
<script src="assets/js/core.js"></script>
<script src="assets/js/pages/<page-name>.js"></script>          <!-- omit if not needed -->
```

## The rule that makes parallel work possible

- **`core/*` and the header/nav/footer markup are shared by every page.** Editing
  them changes every page at once. Coordinate before changing these, and expect
  review, changes here have the largest blast radius in the project.
- **`pages/<page-name>.css` and `pages/<page-name>.js` belong to exactly one page.**
  Two people building different pages never need to touch the same file. Put
  everything specific to your page here, including if it *feels* like it should
  be a reusable component, it isn't reusable until a second page actually needs
  it.
- If you find yourself copy-pasting a rule from one page's CSS into another
  page's CSS, that's the signal to promote it into `core/base.css` instead
  (as a generic, page-agnostic class), not to keep duplicating it.

## Adding a new page

1. Copy `_template.html` to `<page-name>.html` (or `parts/<brand>.html` for a
   parts subcategory).
2. Replace `PAGE-NAME` in the two asset links with your page's name, fill in
   `<title>` and the meta description.
3. Build the page inside `<main>`, reusing `.btn`, `.link`, `.eyebrow`,
   `h1`/`h2`/`h3`, `.section-head`, `.container`, `.reveal` etc. from
   `core/base.css` wherever they fit.
4. Only create `assets/css/pages/<page-name>.css` (and the matching `.js`) if
   the page needs something those don't already cover. Leave the `<link>`/
   `<script>` out of the HTML entirely if you don't create the file.
5. Add the page to the header/mobile nav markup (`site-header`, `.mobile-nav`)
   and footer nav across pages if it should be linked, same coordination note
   as above applies since that markup is duplicated per page today.

## Parts catalog pages

The parts IA is four page types deep, and each type has exactly one shared
stylesheet, not one file per instance:

1. **Brand grid** (`parts-shop.html`) and **series grid**
   (`parts/<brand>.html`, e.g. `ge-boards-turbine-control.html`) are the same
   tile-grid layout with different data, both load `pages/parts-category.css`.
   Building `parts/bently-nevada.html` next means copying
   `parts/ge-boards-turbine-control.html`'s markup, swapping the tile data,
   and reusing the same CSS file untouched.
2. **Part-number listing** (`parts/<brand>/<series>.html`, e.g.
   `ge-boards-turbine-control/mark-1-ii.html`) loads `pages/parts-listing.css`.
   Every future series listing (Mark IV, Mark V, ...) reuses this same file.
3. **Product detail** (`parts/<part-number>.html`, flat, mirroring how the
   live site's `/product/<slug>/` URLs sit outside `/product-category/`)
   loads `pages/parts-product.css`. Every future product page reuses this
   same file.

Only the brand/series that's actually wired up (currently: GE Boards &amp;
Turbine Control → Mark 1 &amp; II → 259B2451BVP4) renders its tiles/rows as
real links; everything else in the grid renders as a `.is-disabled` tile or
row (real data, no link) so the page reads as complete without dead links.
When you build out a new brand or series, flip its tile from `.is-disabled`
to a real `<a>` and give the next tier down its own page.

Three atoms used across all of these live in `core/base.css` since 3+ pages
already need them: `.breadcrumb`, `.search-pill` (the part-number search
field), and `.stock-badge` (the one other real-semantic-state dot in the
project, alongside the emergency dot in `site-chrome.css`, both are actual
status indicators, not decoration).
