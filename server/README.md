# DTC checkout server

The backend half of the site's cart/checkout. It holds the authoritative
price list ([catalog.json](catalog.json)) and the PayPal client secret, and
it is the only thing that ever creates or captures a PayPal order. The
static site under `docs/` only ever sends it SKUs and quantities.

This directory is **not** part of the GitHub Pages deploy (Pages serves
`docs/` only) — it must be deployed to a Node host of its own.

## Quick start (local, sandbox)

```bash
cd server
npm install
cp .env.example .env   # fill in sandbox credentials from developer.paypal.com
npm run dev            # http://localhost:8787/api/health
```

## Endpoints

| Method | Path                  | Body                     | Returns |
| ------ | --------------------- | ------------------------ | ------- |
| POST   | /api/checkout/order   | `{ items:[{sku,qty}] }`  | `{ id }` (PayPal order id) |
| POST   | /api/checkout/capture | `{ orderID }`            | `{ status, orderID, captureID }` |
| GET    | /api/health           | —                        | `{ ok, env }` |

The full go-live walkthrough, security model and testing checklist live in
[../COMMERCE-SETUP.md](../COMMERCE-SETUP.md). Read it before deploying, and
re-read the invariants at the top of [index.js](index.js) before editing it.
