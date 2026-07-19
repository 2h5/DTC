# DTC checkout server

Fail-closed Node/Express scaffolding for the static site's PayPal Orders v2
checkout. It prices carts from `catalog.json`, binds browser access to an
opaque per-order token, stores sandbox order/webhook state atomically, verifies
PayPal state before reporting success, and reconciles unclear capture results.

## Current safety state

- The committed mode is `disabled`; order creation is independently gated by
  `CHECKOUT_CREATE_ENABLED=false`.
- The bundled JSON store supports local/single-instance sandbox work only.
- `PAYPAL_ENV=live` deliberately refuses to start until a production database
  adapter, host, credentials, policies, and operational controls are selected.
- No PayPal secret or checkout token belongs under `docs/` or in source control.

## Local sandbox setup (when testing is authorized)

1. Use Node 24 and generate/review `package-lock.json` with the pinned npm
   version in `package.json`.
2. Run `npm ci`, copy `.env.example` to `.env`, and enter sandbox-only values.
3. Set `PAYPAL_ENV=sandbox`, an exact localhost/site `ALLOWED_ORIGINS`, and a
   private `ORDER_DATA_DIR`.
4. Keep `CHECKOUT_CREATE_ENABLED=false` until configuration/preflight checks
   pass; enable it only for the planned sandbox test window.

The Docker build intentionally fails while the reviewed lockfile is absent.

## API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Secret-free liveness state |
| `GET` | `/api/checkout/config` | Exact frontend/backend compatibility preflight |
| `POST` | `/api/checkout/order` | Price `{items:[{sku,qty}]}` and create one PayPal order |
| `POST` | `/api/checkout/capture` | Capture the bound `{orderID,checkoutToken}` idempotently |
| `POST` | `/api/checkout/status` | Reconcile that same bound order |
| `POST` | `/api/webhooks/paypal` | Verify, deduplicate, and persist supported PayPal events |

Read [`../COMMERCE-SETUP.md`](../COMMERCE-SETUP.md) before deployment. It lists
the unresolved database, policy, tax, shipping, monitoring, test, and approval
gates. This reference server is not authorization to accept live payments.
