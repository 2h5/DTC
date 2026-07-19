# DTC Commerce: architecture, security model, and go-live guide

The site now has a working client-side cart and a checkout flow that is
**shipped dark**: everything is wired, but until the two config values below
are filled in, the cart's checkout panel is an honest "request a quote"
notice and nothing external loads. Going live is deliberately a drop-in:
deploy the backend, paste two strings, test, done.

---

## 1. How the pieces fit

```
Browser (GitHub Pages, docs/)                Your Node host (server/)         PayPal
─────────────────────────────                ────────────────────────         ──────
localStorage cart: {sku, qty} ONLY
commerce-catalog.js: display prices
        │
        │ POST /api/checkout/order {items:[{sku,qty}]}
        ├───────────────────────────────────► prices cart from catalog.json
        │                                     creates order (client SECRET) ──► order lives at PayPal
        │ ◄─────────────────────────────────┤ returns { id } only
PayPal button approval popup ◄──────────────────────────────────────────────► buyer approves
        │ POST /api/checkout/capture {orderID}
        ├───────────────────────────────────► re-fetches order, re-validates
        │                                     against catalog.json, captures,
        │                                     verifies captured amount
        │ ◄─────────────────────────────────┤ { status: COMPLETED, ... }
```

**The trust boundary:** the browser is never trusted with money. It sends
SKUs and quantities; every amount is computed on the server from
`server/catalog.json`. Editing localStorage, the DOM, or the network
requests can change what a visitor *sees*, never what they *pay*.

### Files

| Piece | Path | Job |
| --- | --- | --- |
| Public config | `docs/assets/js/commerce/commerce-config.js` | The two go-live strings. Safe-to-publish values only. |
| Display catalog | `docs/assets/js/commerce/commerce-catalog.js` | What the cart *shows* (title, image, display price). |
| Cart store | `docs/assets/js/commerce/cart.js` | localStorage `{sku, qty}`, validated on every read. |
| Cart UI | `docs/assets/js/commerce/cart-ui.js` | Header cart badge (JS-injected), add-to-cart buttons, toasts. |
| Checkout | `docs/assets/js/commerce/checkout.js` | Cart page rendering + PayPal button wiring. |
| Cart page | `docs/cart.html` + `docs/assets/css/pages/cart.css` | The order desk surface. |
| Backend | `server/` | Authoritative pricing + PayPal Orders v2. **Not served by Pages.** |
| Price truth | `server/catalog.json` | What customers are actually charged. |

The display catalog and `server/catalog.json` are a pair: **any price or
SKU change must be made in both.** If they drift, customers see one number
and pay another.

---

## 2. Go-live, step by step

### Step 1 — PayPal credentials
1. Create the PayPal **Business** account.
2. At <https://developer.paypal.com> → *Apps & Credentials* → create an app.
   You get a **client id** (public) and **secret** (radioactive) for
   Sandbox and, once the business account is approved, for Live.
3. Start with **Sandbox** everywhere below; swap to Live only after the full
   sandbox test pass.

### Step 2 — Deploy the backend
Any always-on Node ≥ 18 host works: Render, Railway, Fly.io, a VPS.
(Static-only hosts and GitHub Pages cannot run it.)

1. Deploy the `server/` directory (`npm install`, start command `npm start`).
2. Set env vars in the host dashboard (see `server/.env.example`):
   `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox`,
   `ALLOWED_ORIGINS=https://2h5.github.io`, `TRUST_PROXY=1`.
3. Verify `https://<your-host>/api/health` returns `{ ok: true }`.

The server refuses to boot without credentials or with an empty origin
allowlist — half-configured deploys fail closed.

### Step 3 — Turn the frontend on
In `docs/assets/js/commerce/commerce-config.js`:

```js
apiBase: "https://<your-host>",        // no trailing slash
paypalClientId: "<sandbox client id>",
```

Push. The cart page now renders PayPal buttons instead of the quote notice.

### Step 4 — Full sandbox test pass
Use a sandbox *buyer* account (developer portal → Testing Tools):

- [ ] Add to cart on the product page; badge count updates; toast links to cart.
- [ ] Cart page: change quantities, remove lines, refresh (cart persists), second tab stays in sync.
- [ ] Complete a payment; confirmation panel shows the order id; cart empties; sandbox account shows the correct amount.
- [ ] Cancel mid-checkout; cart is untouched.
- [ ] Decline path (sandbox card `INSTRUMENT_DECLINED` simulation): checkout restarts cleanly.
- [ ] Tamper test: edit `dtc.cart.v1` in localStorage devtools — a fake SKU is dropped by the UI, and a forged direct `POST /api/checkout/order` with a bad SKU/qty returns 400.
- [ ] Tamper test: confirm the charge equals `server/catalog.json`, not anything shown client-side.

### Step 5 — Harden (recommended)
- In `docs/cart.html` `<head>`, enable the commented-out
  `Content-Security-Policy` meta tag and replace `https://YOUR-API-HOST`
  with the backend origin. Re-run a full sandbox checkout afterwards — a
  wrong host in that tag blocks checkout entirely.
- Keep the backend's dependency count where it is (express + cors); fewer
  deps, smaller supply-chain surface.

### Step 6 — Switch to Live
1. Confirm every price in **both** catalogs with DTC — the current
  `$1,240.00` for 259B2451BVP4 is carried from the page's published
  estimate and must be confirmed as a real sell price.
2. Decide the shipping/tax policy. Today the flow charges **items only**
   and says so on the cart page; PayPal collects the shipping address and
   DTC arranges insured shipping afterwards. If DTC instead wants shipping
   charged at checkout, that's a server change (add a shipping line to the
   order breakdown) — never a frontend one.
3. Revisit the product page's "Estimated price · request a formal quote"
   note — once checkout is live, the price is a real sell price.
4. Flip env vars: `PAYPAL_ENV=live` + live credentials; put the live client
   id in `commerce-config.js`. Test one real small transaction and refund it.

### Adding a purchasable part later
1. Add the SKU to `server/catalog.json` (price in integer cents) **and**
   `docs/assets/js/commerce/commerce-catalog.js` (same price + display fields).
2. On its product page, add the commerce `<script>` tags (copy the block
   from `docs/parts/259b2451bvp4.html`) and give the buttons
   `data-cart-add="SKU"` / `data-cart-buy-now="SKU"`.
3. Redeploy the backend so the new catalog is live *before* pushing the page.

---

## 3. Threat model — what's defended and how

| Threat | Defense |
| --- | --- |
| Price tampering (edit localStorage/DOM/request) | Server prices everything from `catalog.json`; client amounts are never read. Capture re-validates the stored order against the catalog and the captured amount before declaring success. |
| Secret key exposure | Secret exists only in server env vars. `docs/` contains only the public client id. `server/.gitignore` blocks `.env` from git. |
| Forged/foreign order id at capture | Order is re-fetched from PayPal with our credentials and re-validated; unknown orders 400, mispriced orders 409 and are never captured. |
| XSS via cart data | All cart/catalog rendering uses `createElement`/`textContent` — nothing from localStorage is ever parsed as HTML. localStorage reads are shape-checked, SKU-allowlisted, quantity-clamped. |
| CSRF / cross-site API abuse | No cookies or sessions exist (stateless API). CORS allowlist + explicit Origin rejection on POST stops other sites driving the API from visitors' browsers. |
| Double charge | Capture uses a per-order `PayPal-Request-Id`; already-captured retries return the original success idempotently. |
| Scripted abuse / flooding | Per-IP rate limit (30/min), 8 kb JSON body cap, ≤20 lines, qty ≤99 per line. |
| Currency confusion | Currency is fixed server-side from `catalog.json`; mismatches fail validation. |
| Error-message information leaks | Only explicitly-safe validation messages reach the client; everything else logs server-side and returns a generic message. |
| Rogue script injection on cart page | No third-party scripts except PayPal's official SDK, loaded from `www.paypal.com` only, and only after config enables checkout. Optional CSP meta locks this down further. |
| Card data exposure | Card details never touch the site or the server — the PayPal popup/iframe handles all payment instruments. |

**Never do:** put the PayPal secret (or any credential) anywhere under
`docs/`; read client-sent prices on the server; render cart data with
`innerHTML`; loosen `ALLOWED_ORIGINS` to `*`; log full PayPal responses in
production if they might carry payer PII.

**Known limitations (acceptable for this scale, revisit if volume grows):**
rate limiting and idempotency are in-memory (single server instance);
GitHub Pages cannot send real security headers (meta-CSP only); there is no
order database — PayPal's dashboard is the order record, so consider adding
webhook + email notification (`CHECKOUT.ORDER.COMPLETED`) so ops hears
about orders without watching the dashboard.
