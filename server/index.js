/* DTC checkout backend — complete, deployable reference implementation.
 *
 * The static site (GitHub Pages) can't keep secrets or enforce prices, so
 * this small server owns both jobs:
 *
 *   POST /api/checkout/order    { items: [{ sku, qty }] }        -> { id }
 *   POST /api/checkout/capture  { orderID }                      -> { status, orderID, captureID }
 *   GET  /api/health                                             -> { ok: true }
 *
 * SECURITY INVARIANTS (do not weaken when editing):
 *  1. The browser sends SKUs and quantities only. Every amount is computed
 *     here from catalog.json. Client-sent prices, totals or currencies are
 *     not read anywhere in this file — there is nothing to tamper with.
 *  2. The PayPal client SECRET exists only in env vars on the host. It is
 *     never logged, never echoed in a response, never sent to the browser.
 *  3. Capture double-checks: before capturing, the order is re-fetched
 *     from PayPal and re-validated against catalog.json (right SKUs, right
 *     unit prices, right total). A tampered or foreign order id fails
 *     closed. After capturing, the captured amount is verified again.
 *  4. Errors return generic messages; details go to the server log only.
 *
 * Runtime: Node >= 18 (built-in fetch). Deps: express, cors — nothing else.
 * Local dev:   cp .env.example .env  (fill it in)  ->  npm run dev
 * Production:  set the same env vars on the host   ->  npm start
 */
"use strict";

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const catalog = require("./catalog.json");

/* ----- Configuration (env) ---------------------------------------------- */

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_ENV = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
const PORT = Number(process.env.PORT) || 8787;

/* Comma-separated list of exact origins allowed to call this API, e.g.
   "https://2h5.github.io" for the GitHub Pages site. No wildcard support
   on purpose. */
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET env vars. See .env.example.");
  process.exit(1);
}
if (!ALLOWED_ORIGINS.size) {
  console.error("Missing ALLOWED_ORIGINS env var (e.g. https://2h5.github.io). Refusing to start open to every origin.");
  process.exit(1);
}

const PAYPAL_API =
  PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

const CURRENCY = catalog.currency || "USD";
const MAX_QTY_PER_LINE = 99;
const MAX_LINES = 20;
const ORDER_ID_RE = /^[A-Za-z0-9-]{5,64}$/; /* PayPal order ids are short alphanumerics */

/* ----- App + hardening middleware ---------------------------------------- */

const app = express();
app.disable("x-powered-by");

/* Behind a platform proxy (Render/Railway/Fly/Heroku), trust one hop so
   req.ip is the real client for rate limiting, not the proxy. */
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

/* Carts are tiny; anything bigger than 8kb is not a cart. */
app.use(express.json({ limit: "8kb" }));

app.use(
  cors({
    origin(origin, cb) {
      /* Non-browser clients (curl, health checks) send no Origin; CORS is
         a browser protection, so let those through — the routes still
         validate everything they receive. Browsers from unlisted origins
         get no CORS headers and are blocked by their own browser. */
      if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    maxAge: 600,
  })
);

/* Belt-and-suspenders CSRF/abuse gate: if a browser DID send an Origin and
   it isn't ours, refuse to do any work (CORS alone only hides the response,
   the request itself would still execute). No cookies are used anywhere, so
   classic CSRF doesn't apply, but this keeps other sites from driving the
   API through visitors' browsers at all. */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (req.method === "POST" && origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

/* API responses are per-request and must never be cached or sniffed. */
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  next();
});

/* Small in-memory rate limiter: 30 requests/min per IP across the API.
   Enough for real buyers, hostile to scripted abuse. Single-instance only —
   if this ever runs on multiple instances, swap for a shared store. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map();
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, times] of hits) {
    const recent = times.filter((t) => t > cutoff);
    if (recent.length) hits.set(ip, recent);
    else hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

app.use("/api/", (req, res, next) => {
  const now = Date.now();
  const times = (hits.get(req.ip) || []).filter((t) => t > now - RATE_WINDOW_MS);
  if (times.length >= RATE_LIMIT) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
  }
  times.push(now);
  hits.set(req.ip, times);
  next();
});

/* ----- Catalog pricing (the only source of money truth) ------------------ */

function centsToValue(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Validates a client cart and prices it from catalog.json.
 * Returns { lines: [{ sku, qty, unitCents, title }], totalCents }
 * or throws { status: 400, message } on any invalid input.
 */
function priceCart(rawItems) {
  const bad = (message) => Object.assign(new Error(message), { status: 400, expose: true });

  if (!Array.isArray(rawItems) || rawItems.length === 0) throw bad("Cart is empty.");
  if (rawItems.length > MAX_LINES) throw bad("Too many cart lines.");

  const seen = new Set();
  const lines = rawItems.map((raw) => {
    if (!raw || typeof raw.sku !== "string") throw bad("Malformed cart line.");
    const sku = raw.sku;
    if (seen.has(sku)) throw bad("Duplicate cart line.");
    seen.add(sku);

    const entry = Object.prototype.hasOwnProperty.call(catalog.items, sku) ? catalog.items[sku] : null;
    if (!entry || !entry.purchasable) throw bad("An item in the cart is not available for online checkout.");

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) throw bad("Invalid quantity.");

    return { sku, qty, unitCents: entry.priceCents, title: entry.title };
  });

  const totalCents = lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
  if (totalCents <= 0) throw bad("Cart total is invalid.");
  return { lines, totalCents };
}

/* ----- PayPal REST client ------------------------------------------------ */

let cachedToken = null; /* { value, expiresAt } */

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;

  const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`PayPal auth failed: ${response.status}`);
  const data = await response.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function paypalFetch(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* leave data empty; status carries the failure */
  }
  return { ok: response.ok, status: response.status, data };
}

/* ----- Routes ------------------------------------------------------------ */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, env: PAYPAL_ENV });
});

/**
 * Create a PayPal order for the client's cart. The response exposes only
 * the PayPal order id the JS SDK needs; the priced order itself lives at
 * PayPal until capture.
 */
app.post("/api/checkout/order", async (req, res, next) => {
  try {
    const { lines, totalCents } = priceCart(req.body && req.body.items);

    const orderBody = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "default",
          amount: {
            currency_code: CURRENCY,
            value: centsToValue(totalCents),
            breakdown: {
              item_total: { currency_code: CURRENCY, value: centsToValue(totalCents) },
            },
          },
          items: lines.map((line) => ({
            name: line.title.slice(0, 127),
            sku: line.sku.slice(0, 127),
            unit_amount: { currency_code: CURRENCY, value: centsToValue(line.unitCents) },
            quantity: String(line.qty),
            category: "PHYSICAL_GOODS",
          })),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Direct Turbine Controls",
            shipping_preference: "GET_FROM_FILE", /* PayPal collects the address */
            user_action: "PAY_NOW",
          },
        },
      },
    };

    const created = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": crypto.randomUUID() },
      body: JSON.stringify(orderBody),
    });

    if (!created.ok || !created.data.id) {
      console.error("Order create failed:", created.status, JSON.stringify(created.data));
      return res.status(502).json({ error: "Could not start checkout. Please try again." });
    }

    console.log(
      `order created ${created.data.id} total=${centsToValue(totalCents)} ${CURRENCY} ` +
        lines.map((l) => `${l.sku}x${l.qty}`).join(",")
    );
    res.json({ id: created.data.id });
  } catch (err) {
    next(err);
  }
});

/**
 * Re-validates an approved order against the catalog, then captures it.
 * This is the last line of defense: even if order creation were somehow
 * subverted, nothing mispriced gets captured.
 */
app.post("/api/checkout/capture", async (req, res, next) => {
  try {
    const orderID = req.body && req.body.orderID;
    if (typeof orderID !== "string" || !ORDER_ID_RE.test(orderID)) {
      return res.status(400).json({ error: "Invalid order reference." });
    }

    /* 1. Fetch the order as PayPal knows it. A foreign/forged id fails here. */
    const fetched = await paypalFetch(`/v2/checkout/orders/${orderID}`);
    if (!fetched.ok) {
      console.error("Order lookup failed:", orderID, fetched.status);
      return res.status(400).json({ error: "Order not found." });
    }
    const order = fetched.data;

    /* 2. Re-validate its contents against the catalog. */
    const unit = Array.isArray(order.purchase_units) && order.purchase_units.length === 1
      ? order.purchase_units[0]
      : null;
    const validationError = unit ? validateOrderUnit(unit) : "Unexpected order shape.";
    if (validationError) {
      console.error("Order failed catalog validation:", orderID, validationError);
      return res.status(409).json({ error: "Order could not be verified. You have not been charged." });
    }

    /* Idempotent retry of an order we already captured. */
    if (order.status === "COMPLETED") {
      const prior = extractCapture(order);
      return res.json({ status: "COMPLETED", orderID, captureID: prior ? prior.id : undefined });
    }
    if (order.status !== "APPROVED") {
      return res.status(409).json({ error: "Order is not ready to capture." });
    }

    /* 3. Capture. The PayPal-Request-Id makes network retries idempotent. */
    const captured = await paypalFetch(`/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { "PayPal-Request-Id": `capture-${orderID}` },
      body: "{}",
    });

    if (!captured.ok) {
      const issue =
        captured.data &&
        captured.data.details &&
        captured.data.details[0] &&
        captured.data.details[0].issue;
      if (issue === "INSTRUMENT_DECLINED") {
        /* Buyer's funding source bounced — the SDK restarts checkout. */
        return res.status(402).json({ error: "Payment method declined.", retriable: true });
      }
      if (issue === "ORDER_ALREADY_CAPTURED") {
        return res.json({ status: "COMPLETED", orderID });
      }
      console.error("Capture failed:", orderID, captured.status, JSON.stringify(captured.data));
      return res.status(502).json({ error: "Payment could not be completed. You have not been charged." });
    }

    /* 4. Verify what was actually captured before declaring success. */
    const capture = extractCapture(captured.data);
    const expected = unit.amount && unit.amount.value;
    if (
      !capture ||
      capture.status !== "COMPLETED" ||
      !capture.amount ||
      capture.amount.value !== expected ||
      capture.amount.currency_code !== CURRENCY
    ) {
      console.error("Capture verification mismatch:", orderID, JSON.stringify(captured.data));
      return res.status(502).json({ error: "Payment could not be verified. Please contact us before retrying." });
    }

    console.log(`order captured ${orderID} capture=${capture.id} amount=${capture.amount.value} ${CURRENCY}`);
    res.json({ status: "COMPLETED", orderID, captureID: capture.id });
  } catch (err) {
    next(err);
  }
});

/* Checks a purchase unit (as stored at PayPal) against catalog.json:
   every SKU known and purchasable, every unit price and the total exactly
   what the catalog says today. Returns an error string or null. */
function validateOrderUnit(unit) {
  const items = Array.isArray(unit.items) ? unit.items : [];
  if (!items.length || items.length > MAX_LINES) return "bad item count";

  let totalCents = 0;
  for (const item of items) {
    const entry =
      item.sku && Object.prototype.hasOwnProperty.call(catalog.items, item.sku)
        ? catalog.items[item.sku]
        : null;
    if (!entry || !entry.purchasable) return `unknown sku ${item.sku}`;

    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) return `bad qty for ${item.sku}`;

    if (!item.unit_amount || item.unit_amount.value !== centsToValue(entry.priceCents)) {
      return `price mismatch for ${item.sku}`;
    }
    if (item.unit_amount.currency_code !== CURRENCY) return `currency mismatch for ${item.sku}`;
    totalCents += entry.priceCents * qty;
  }

  if (!unit.amount || unit.amount.currency_code !== CURRENCY) return "currency mismatch";
  if (unit.amount.value !== centsToValue(totalCents)) return "total mismatch";
  return null;
}

function extractCapture(orderData) {
  const unit = orderData && Array.isArray(orderData.purchase_units) ? orderData.purchase_units[0] : null;
  const captures = unit && unit.payments && Array.isArray(unit.payments.captures) ? unit.payments.captures : [];
  return captures[0] || null;
}

/* ----- Error handling ---------------------------------------------------- */

app.use((req, res) => res.status(404).json({ error: "Not found" }));

/* Central error handler: expose only messages we explicitly marked safe
   (priceCart's 400s); everything else is logged and returned generic. */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.expose && err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed request." });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, () => {
  console.log(`DTC checkout server listening on :${PORT} (PayPal ${PAYPAL_ENV})`);
  console.log(`Allowed origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
});
