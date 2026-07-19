"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { MAX_LINES, MAX_QTY_PER_LINE, centsToValue, loadCatalog, priceCart, publicCatalogState } = require("./catalog");
const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { PayPalClient } = require("./paypal");
const { JsonOrderStore } = require("./store");

const API_VERSION = 1;
const ORDER_LIFETIME_MS = 6 * 60 * 60 * 1000;
const ORDER_ID_RE = /^[A-Z0-9]{1,36}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EVENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const EVENT_TYPE_RE = /^[A-Z0-9._-]{1,100}$/;

class KeyedLock {
  constructor() {
    this.pending = new Map();
  }

  async run(key, operation) {
    const prior = this.pending.get(key) || Promise.resolve();
    const current = prior.catch(() => {}).then(operation);
    this.pending.set(key, current);
    try {
      return await current;
    } finally {
      if (this.pending.get(key) === current) this.pending.delete(key);
    }
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(token, expectedHash) {
  if (!TOKEN_RE.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return crypto.timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(expectedHash, "hex"));
}

function makeRateLimiter({ limit, windowMs, clock = Date.now }) {
  const clients = new Map();
  return (req, res, next) => {
    const now = clock();
    const key = req.ip;
    const recent = (clients.get(key) || []).filter((time) => time > now - windowMs);
    if (recent.length >= limit) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "Too many requests. Please wait and try again." });
    }
    recent.push(now);
    clients.set(key, recent);
    if (clients.size > 5000) {
      for (const [client, times] of clients) {
        if (!times.some((time) => time > now - windowMs)) clients.delete(client);
      }
    }
    next();
  };
}

function requireJson(req, res, next) {
  if (!req.is("application/json")) return res.status(415).json({ error: "Content-Type must be application/json." });
  next();
}

function orderCredentials(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes("orderID") || !keys.includes("checkoutToken")) return null;
  if (typeof body.orderID !== "string" || !ORDER_ID_RE.test(body.orderID)) return null;
  if (typeof body.checkoutToken !== "string" || !TOKEN_RE.test(body.checkoutToken)) return null;
  return { orderID: body.orderID, checkoutToken: body.checkoutToken };
}

function extractCaptures(orderData) {
  const unit = orderData && Array.isArray(orderData.purchase_units) && orderData.purchase_units.length === 1
    ? orderData.purchase_units[0]
    : null;
  return unit && unit.payments && Array.isArray(unit.payments.captures) ? unit.payments.captures : [];
}

function validateRemoteOrder(order, local, config) {
  if (!order || order.id !== local.orderID || order.intent !== "CAPTURE") return "order identity or intent mismatch";
  const units = Array.isArray(order.purchase_units) ? order.purchase_units : [];
  if (units.length !== 1) return "unexpected purchase-unit count";
  const unit = units[0];
  if (unit.custom_id !== local.merchantReference) return "merchant reference mismatch";

  const payee = unit.payee;
  if (config.mode === "live" && (!payee || payee.merchant_id !== config.expectedMerchantId)) {
    return "live merchant mismatch";
  }
  if (payee && config.expectedMerchantId && payee.merchant_id && payee.merchant_id !== config.expectedMerchantId) {
    return "merchant mismatch";
  }
  if (
    payee &&
    config.expectedMerchantEmail &&
    payee.email_address &&
    payee.email_address.toLowerCase() !== config.expectedMerchantEmail
  ) {
    return "merchant email mismatch";
  }

  const items = Array.isArray(unit.items) ? unit.items : [];
  if (items.length !== local.lines.length || items.length === 0 || items.length > MAX_LINES) return "item count mismatch";
  const expected = new Map(local.lines.map((line) => [line.sku, line]));
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.sku !== "string" || seen.has(item.sku)) return "duplicate or missing sku";
    seen.add(item.sku);
    const line = expected.get(item.sku);
    if (!line) return "unknown sku";
    if (item.quantity !== String(line.qty)) return "quantity mismatch";
    if (
      !item.unit_amount ||
      item.unit_amount.currency_code !== local.currency ||
      item.unit_amount.value !== centsToValue(line.unitCents)
    ) {
      return "unit amount mismatch";
    }
  }
  const amount = unit.amount;
  if (!amount || amount.currency_code !== local.currency || amount.value !== centsToValue(local.totalCents)) {
    return "order amount mismatch";
  }
  if (
    !amount.breakdown ||
    !amount.breakdown.item_total ||
    amount.breakdown.item_total.currency_code !== local.currency ||
    amount.breakdown.item_total.value !== centsToValue(local.totalCents)
  ) {
    return "item total mismatch";
  }
  return null;
}

function assessCapture(orderData, local) {
  const captures = extractCaptures(orderData);
  if (captures.length !== 1) return { kind: "INVALID", reason: "unexpected capture count" };
  const capture = captures[0];
  if (
    !capture ||
    typeof capture.id !== "string" ||
    !capture.amount ||
    capture.amount.currency_code !== local.currency ||
    capture.amount.value !== centsToValue(local.totalCents)
  ) {
    return { kind: "INVALID", reason: "captured amount mismatch" };
  }
  if (capture.status === "COMPLETED") return { kind: "COMPLETED", captureID: capture.id };
  if (capture.status === "PENDING") return { kind: "PENDING", captureID: capture.id };
  if (new Set(["DECLINED", "FAILED"]).has(capture.status)) return { kind: "DECLINED", captureID: capture.id };
  return { kind: "INVALID", reason: "unexpected capture status" };
}

function successBody(order) {
  return {
    status: "COMPLETED",
    orderID: order.orderID,
    captureID: order.captureID,
    merchantReference: order.merchantReference,
  };
}

function pendingBody(order) {
  return {
    status: "PENDING",
    orderID: order.orderID,
    ...(order.captureID ? { captureID: order.captureID } : {}),
    merchantReference: order.merchantReference,
    retriable: true,
  };
}

function unknownBody(orderID, merchantReference) {
  return {
    status: "UNKNOWN",
    orderID,
    ...(merchantReference ? { merchantReference } : {}),
    retriable: true,
    error: "Payment status is uncertain. Do not start another checkout.",
  };
}

function buildOrderBody(priced, currency, merchantReference) {
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: merchantReference,
        custom_id: merchantReference,
        amount: {
          currency_code: currency,
          value: centsToValue(priced.totalCents),
          breakdown: { item_total: { currency_code: currency, value: centsToValue(priced.totalCents) } },
        },
        items: priced.lines.map((line) => ({
          name: line.title,
          sku: line.sku,
          unit_amount: { currency_code: currency, value: centsToValue(line.unitCents) },
          quantity: String(line.qty),
          category: "PHYSICAL_GOODS",
        })),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Direct Turbine Controls",
          shipping_preference: "GET_FROM_FILE",
          user_action: "PAY_NOW",
        },
      },
    },
  };
}

async function createApplication(options = {}) {
  const config = options.config || loadConfig(options.env, options.configOverrides);
  const catalog = options.catalog || loadCatalog(options.catalogPath);
  publicCatalogState(catalog, config.mode);
  const logger = options.logger || createLogger();
  const now = options.now || (() => new Date());
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  let store = options.store || null;
  let paypal = options.paypal || null;
  if (config.active) {
    store = store || new JsonOrderStore({ directory: config.dataDir, clock: now });
    if (typeof store.init === "function") await store.init();
    paypal =
      paypal ||
      new PayPalClient({
        baseUrl: config.paypalBaseUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        timeoutMs: config.paypalTimeoutMs,
        maxRetries: config.paypalMaxRetries,
      });
  }

  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-site",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, mode: config.mode, active: config.active, createEnabled: config.active && config.createEnabled });
  });

  const checkout = express.Router();
  checkout.use((req, res, next) => {
    const origin = req.get("Origin");
    if (!config.active) return res.status(503).json({ error: "Online checkout is not configured." });
    if (!origin || !config.allowedOrigins.has(origin)) return res.status(403).json({ error: "Forbidden" });
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "600");
      return res.status(204).end();
    }
    next();
  });
  checkout.use(
    makeRateLimiter({ limit: config.checkoutRateLimit, windowMs: config.rateWindowMs, clock: options.rateClock })
  );

  checkout.get("/config", (req, res) => {
    res.json({
      ok: true,
      apiVersion: API_VERSION,
      mode: config.mode,
      createEnabled: config.createEnabled,
      currency: catalog.currency,
      paypalClientId: config.clientId,
      maxLines: MAX_LINES,
      maxQtyPerLine: MAX_QTY_PER_LINE,
      catalogVersion: catalog.catalogVersion,
    });
  });

  const jsonCheckout = express.json({ limit: "8kb", strict: true });

  checkout.post("/order", requireJson, jsonCheckout, async (req, res, next) => {
    try {
      if (!config.createEnabled) {
        return res.status(503).json({ error: "Online checkout is temporarily unavailable.", code: "CREATE_DISABLED" });
      }
      if (!req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, "items")) {
        return res.status(400).json({ error: "Malformed checkout request." });
      }
      const priced = priceCart(catalog, config.mode, req.body.items);
      const merchantReference = `DTC-${crypto.randomBytes(9).toString("hex").toUpperCase()}`;
      const checkoutToken = crypto.randomBytes(32).toString("base64url");
      const createRequestId = crypto.randomUUID();
      const captureRequestId = crypto.randomUUID();
      const created = await paypal.createOrder(buildOrderBody(priced, catalog.currency, merchantReference), createRequestId);
      if (!created.ok || !created.data || !ORDER_ID_RE.test(created.data.id || "")) {
        logger.error("paypal_order_create_failed", { status: created.status, debugId: created.debugId });
        return res.status(502).json({ error: "Could not start checkout. Please try again." });
      }
      const createdAt = now();
      const record = {
        orderID: created.data.id,
        merchantReference,
        tokenHash: hashToken(checkoutToken),
        status: "CREATED",
        paypalStatus: typeof created.data.status === "string" ? created.data.status : "CREATED",
        currency: catalog.currency,
        totalCents: priced.totalCents,
        lines: priced.lines.map((line) => ({ ...line })),
        catalogVersion: catalog.catalogVersion,
        createRequestId,
        captureRequestId,
        captureID: null,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ORDER_LIFETIME_MS).toISOString(),
      };
      await store.createOrder(record);
      logger.info("paypal_order_created", {
        orderID: record.orderID,
        merchantReference,
        currency: record.currency,
        totalCents: record.totalCents,
        itemCount: record.lines.length,
      });
      return res.json({
        id: record.orderID,
        checkoutToken,
        merchantReference,
        currency: record.currency,
        totalCents: record.totalCents,
        catalogVersion: record.catalogVersion,
      });
    } catch (error) {
      next(error);
    }
  });

  const locks = new KeyedLock();

  function ownedOrder(req, res) {
    const credentials = orderCredentials(req.body);
    if (!credentials) {
      res.status(404).json({ error: "Order not found." });
      return null;
    }
    const record = store.getOrder(credentials.orderID);
    if (!record || !tokenMatches(credentials.checkoutToken, record.tokenHash)) {
      res.status(404).json({ error: "Order not found." });
      return null;
    }
    return record;
  }

  async function persistAssessment(record, assessment, paypalStatus) {
    if (assessment.kind === "COMPLETED") {
      return store.updateOrder(record.orderID, {
        status: "COMPLETED",
        paypalStatus,
        captureID: assessment.captureID,
        completedAt: now().toISOString(),
      });
    }
    if (assessment.kind === "PENDING") {
      return store.updateOrder(record.orderID, {
        status: "PENDING",
        paypalStatus,
        captureID: assessment.captureID,
      });
    }
    if (assessment.kind === "DECLINED") {
      return store.updateOrder(record.orderID, {
        status: "DECLINED",
        paypalStatus,
        captureID: assessment.captureID,
      });
    }
    logger.error("paypal_capture_verification_failed", {
      orderID: record.orderID,
      merchantReference: record.merchantReference,
      reason: assessment.reason,
    });
    return store.updateOrder(record.orderID, { status: "MANUAL_REVIEW", paypalStatus });
  }

  async function reconcile(record) {
    let fetched;
    try {
      fetched = await paypal.getOrder(record.orderID);
    } catch (error) {
      await store.updateOrder(record.orderID, { status: "UNKNOWN" });
      logger.warn("paypal_order_reconciliation_unavailable", { orderID: record.orderID, code: error.code });
      return { kind: "UNKNOWN", record: store.getOrder(record.orderID) };
    }
    if (!fetched.ok) {
      await store.updateOrder(record.orderID, { status: "UNKNOWN" });
      logger.warn("paypal_order_reconciliation_failed", {
        orderID: record.orderID,
        status: fetched.status,
        debugId: fetched.debugId,
      });
      return { kind: "UNKNOWN", record: store.getOrder(record.orderID) };
    }
    const validationError = validateRemoteOrder(fetched.data, record, config);
    if (validationError) {
      await store.updateOrder(record.orderID, { status: "MANUAL_REVIEW", paypalStatus: fetched.data.status });
      logger.error("paypal_order_validation_failed", { orderID: record.orderID, reason: validationError });
      return { kind: "UNKNOWN", record: store.getOrder(record.orderID) };
    }
    if (fetched.data.status === "COMPLETED") {
      const assessment = assessCapture(fetched.data, record);
      const updated = await persistAssessment(record, assessment, fetched.data.status);
      return { kind: assessment.kind === "INVALID" ? "UNKNOWN" : assessment.kind, record: updated };
    }
    if (fetched.data.status === "APPROVED") {
      const updated = await store.updateOrder(record.orderID, { status: "APPROVED", paypalStatus: "APPROVED" });
      return { kind: "APPROVED", record: updated };
    }
    if (fetched.data.status === "CREATED" || fetched.data.status === "PAYER_ACTION_REQUIRED") {
      const updated = await store.updateOrder(record.orderID, { status: "CREATED", paypalStatus: fetched.data.status });
      return { kind: "CREATED", record: updated };
    }
    const updated = await store.updateOrder(record.orderID, { status: "NOT_READY", paypalStatus: fetched.data.status });
    return { kind: "NOT_READY", record: updated };
  }

  checkout.post("/capture", requireJson, jsonCheckout, async (req, res, next) => {
    const initial = ownedOrder(req, res);
    if (!initial) return;
    try {
      return await locks.run(initial.orderID, async () => {
        let record = store.getOrder(initial.orderID);
        if (record.status === "COMPLETED") return res.json(successBody(record));
        if (record.status === "REFUND_REVIEW" || record.status === "REVERSAL_REVIEW") {
          return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
        }
        if (record.status === "PENDING" || record.status === "UNKNOWN" || record.status === "MANUAL_REVIEW") {
          const result = await reconcile(record);
          if (result.kind === "COMPLETED") return res.json(successBody(result.record));
          if (result.kind === "PENDING") return res.status(202).json(pendingBody(result.record));
          if (result.kind !== "APPROVED") return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
          record = result.record;
        }
        if (now().getTime() > Date.parse(record.expiresAt)) {
          await store.updateOrder(record.orderID, { status: "EXPIRED" });
          return res.status(409).json({ status: "NOT_READY", orderID: record.orderID, retriable: false });
        }

        const beforeCapture = await paypal.getOrder(record.orderID);
        if (!beforeCapture.ok) {
          logger.warn("paypal_order_lookup_failed", {
            orderID: record.orderID,
            status: beforeCapture.status,
            debugId: beforeCapture.debugId,
          });
          return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
        }
        const validationError = validateRemoteOrder(beforeCapture.data, record, config);
        if (validationError) {
          await store.updateOrder(record.orderID, { status: "MANUAL_REVIEW", paypalStatus: beforeCapture.data.status });
          logger.error("paypal_order_validation_failed", { orderID: record.orderID, reason: validationError });
          return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
        }
        if (beforeCapture.data.status === "COMPLETED") {
          const assessment = assessCapture(beforeCapture.data, record);
          const updated = await persistAssessment(record, assessment, beforeCapture.data.status);
          if (assessment.kind === "COMPLETED") return res.json(successBody(updated));
          if (assessment.kind === "PENDING") return res.status(202).json(pendingBody(updated));
          return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
        }
        if (beforeCapture.data.status !== "APPROVED") {
          return res.status(409).json({ status: "NOT_READY", orderID: record.orderID, retriable: false });
        }

        await store.updateOrder(record.orderID, { status: "CAPTURE_IN_PROGRESS", paypalStatus: "APPROVED" });
        let captured;
        try {
          captured = await paypal.captureOrder(record.orderID, record.captureRequestId);
        } catch (error) {
          await store.updateOrder(record.orderID, { status: "UNKNOWN" });
          const result = await reconcile(record);
          if (result.kind === "COMPLETED") return res.json(successBody(result.record));
          if (result.kind === "PENDING") return res.status(202).json(pendingBody(result.record));
          return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
        }

        if (!captured.ok) {
          if (captured.issue === "INSTRUMENT_DECLINED") {
            await store.updateOrder(record.orderID, { status: "DECLINED", paypalStatus: "APPROVED" });
            return res.status(422).json({
              status: "DECLINED",
              orderID: record.orderID,
              merchantReference: record.merchantReference,
              code: "INSTRUMENT_DECLINED",
              retriable: true,
            });
          }
          if (captured.issue === "ORDER_NOT_APPROVED") {
            await store.updateOrder(record.orderID, { status: "NOT_READY" });
            return res.status(409).json({ status: "NOT_READY", orderID: record.orderID, retriable: false });
          }
          if (captured.issue === "ORDER_ALREADY_CAPTURED" || captured.ambiguous) {
            const result = await reconcile(record);
            if (result.kind === "COMPLETED") return res.json(successBody(result.record));
            if (result.kind === "PENDING") return res.status(202).json(pendingBody(result.record));
          }
          await store.updateOrder(record.orderID, { status: "UNKNOWN" });
          logger.warn("paypal_capture_uncertain", {
            orderID: record.orderID,
            status: captured.status,
            issue: captured.issue,
            debugId: captured.debugId,
          });
          return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
        }

        const assessment = assessCapture(captured.data, record);
        const updated = await persistAssessment(record, assessment, captured.data.status);
        if (assessment.kind === "COMPLETED") {
          logger.info("paypal_order_captured", {
            orderID: record.orderID,
            merchantReference: record.merchantReference,
            captureID: updated.captureID,
            currency: record.currency,
            totalCents: record.totalCents,
          });
          return res.json(successBody(updated));
        }
        if (assessment.kind === "PENDING") return res.status(202).json(pendingBody(updated));
        if (assessment.kind === "DECLINED") {
          return res.status(422).json({
            status: "DECLINED",
            orderID: record.orderID,
            merchantReference: record.merchantReference,
            code: "CAPTURE_DECLINED",
            retriable: false,
          });
        }
        return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
      });
    } catch (error) {
      next(error);
    }
  });

  checkout.post("/status", requireJson, jsonCheckout, async (req, res, next) => {
    const initial = ownedOrder(req, res);
    if (!initial) return;
    try {
      return await locks.run(initial.orderID, async () => {
        const record = store.getOrder(initial.orderID);
        if (record.status === "COMPLETED") return res.json(successBody(record));
        if (record.status === "REFUND_REVIEW" || record.status === "REVERSAL_REVIEW") {
          return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
        }
        const result = await reconcile(record);
        if (result.kind === "COMPLETED") return res.json(successBody(result.record));
        if (result.kind === "PENDING") return res.status(202).json(pendingBody(result.record));
        if (result.kind === "APPROVED" || result.kind === "CREATED") {
          return res.json({
            status: result.kind,
            orderID: record.orderID,
            merchantReference: record.merchantReference,
            retriable: true,
          });
        }
        if (result.kind === "NOT_READY") {
          return res.status(409).json({ status: "NOT_READY", orderID: record.orderID, retriable: false });
        }
        return res.status(503).json(unknownBody(record.orderID, record.merchantReference));
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/checkout", checkout);

  const webhookLimiter = makeRateLimiter({
    limit: config.webhookRateLimit,
    windowMs: config.rateWindowMs,
    clock: options.rateClock,
  });
  const webhookJson = express.json({ limit: "64kb", strict: true });

  app.post("/api/webhooks/paypal", webhookLimiter, requireJson, webhookJson, async (req, res, next) => {
    try {
      if (!config.active || !config.webhookId) {
        return res.status(503).json({ error: "PayPal webhook verification is not configured." });
      }
      const headers = {
        authAlgo: req.get("paypal-auth-algo"),
        certUrl: req.get("paypal-cert-url"),
        transmissionId: req.get("paypal-transmission-id"),
        transmissionSig: req.get("paypal-transmission-sig"),
        transmissionTime: req.get("paypal-transmission-time"),
      };
      if (
        !headers.authAlgo || headers.authAlgo.length > 64 ||
        !headers.transmissionId || headers.transmissionId.length > 128 ||
        !headers.transmissionSig || headers.transmissionSig.length > 1024 ||
        !headers.transmissionTime || headers.transmissionTime.length > 64
      ) {
        return res.status(400).json({ error: "Invalid webhook signature headers." });
      }
      let certUrl;
      try {
        certUrl = new URL(headers.certUrl);
      } catch {
        return res.status(400).json({ error: "Invalid webhook certificate URL." });
      }
      if (
        certUrl.protocol !== "https:" ||
        !new Set(["api.paypal.com", "api.sandbox.paypal.com"]).has(certUrl.hostname) ||
        !certUrl.pathname.startsWith("/v1/notifications/certs/")
      ) {
        return res.status(400).json({ error: "Invalid webhook certificate URL." });
      }
      const event = req.body;
      if (
        !event ||
        typeof event !== "object" ||
        Array.isArray(event) ||
        typeof event.id !== "string" ||
        !EVENT_ID_RE.test(event.id) ||
        typeof event.event_type !== "string" ||
        !EVENT_TYPE_RE.test(event.event_type) ||
        !event.resource ||
        typeof event.resource !== "object"
      ) {
        return res.status(400).json({ error: "Malformed webhook event." });
      }

      let verification;
      try {
        verification = await paypal.verifyWebhook({
          auth_algo: headers.authAlgo,
          cert_url: headers.certUrl,
          transmission_id: headers.transmissionId,
          transmission_sig: headers.transmissionSig,
          transmission_time: headers.transmissionTime,
          webhook_id: config.webhookId,
          webhook_event: event,
        });
      } catch (error) {
        logger.warn("paypal_webhook_verification_unavailable", { eventID: event.id, code: error.code });
        return res.status(503).json({ error: "Webhook verification unavailable." });
      }
      if (!verification.ok) {
        logger.warn("paypal_webhook_verification_failed", {
          eventID: event.id,
          status: verification.status,
          debugId: verification.debugId,
        });
        return res.status(503).json({ error: "Webhook verification unavailable." });
      }
      if (!verification.data || verification.data.verification_status !== "SUCCESS") {
        logger.warn("paypal_webhook_rejected", { eventID: event.id });
        return res.status(400).json({ error: "Invalid webhook signature." });
      }

      const resource = event.resource;
      const relatedOrderID =
        resource.supplementary_data &&
        resource.supplementary_data.related_ids &&
        resource.supplementary_data.related_ids.order_id;
      const orderID = ORDER_ID_RE.test(relatedOrderID || "")
        ? relatedOrderID
        : event.event_type.startsWith("CHECKOUT.") && ORDER_ID_RE.test(resource.id || "")
          ? resource.id
          : null;
      const local = orderID ? store.getOrder(orderID) : null;
      let orderPatch = null;
      let disposition = local ? "recorded" : "unknown_order";
      const amountMatches =
        local &&
        resource.amount &&
        resource.amount.currency_code === local.currency &&
        resource.amount.value === centsToValue(local.totalCents);
      const referenceMatches = !local || !resource.custom_id || resource.custom_id === local.merchantReference;
      const protectedPaidState = local && new Set(["COMPLETED", "REFUND_REVIEW", "REVERSAL_REVIEW"]).has(local.status);

      if (local && !referenceMatches) {
        disposition = "merchant_reference_mismatch";
      } else if (local && event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        if (new Set(["REFUND_REVIEW", "REVERSAL_REVIEW"]).has(local.status)) {
          disposition = "stale_event_ignored";
        } else if (amountMatches && typeof resource.id === "string") {
          orderPatch = {
            status: "COMPLETED",
            paypalStatus: "COMPLETED",
            captureID: resource.id,
            completedAt: now().toISOString(),
          };
          disposition = "order_completed";
        } else {
          orderPatch = { status: "MANUAL_REVIEW" };
          disposition = "amount_mismatch";
        }
      } else if (local && event.event_type === "PAYMENT.CAPTURE.PENDING") {
        orderPatch = protectedPaidState
          ? null
          : amountMatches
          ? { status: "PENDING", captureID: typeof resource.id === "string" ? resource.id : local.captureID }
          : { status: "MANUAL_REVIEW" };
        disposition = protectedPaidState ? "stale_event_ignored" : amountMatches ? "order_pending" : "amount_mismatch";
      } else if (local && new Set(["PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.DENIED"]).has(event.event_type)) {
        orderPatch = protectedPaidState ? null : { status: "DECLINED" };
        disposition = protectedPaidState ? "stale_event_ignored" : "order_declined";
      } else if (local && event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
        /* A refund event may represent only a partial refund. Do not claim the
           whole order is refunded until a later production reconciliation
           adapter verifies cumulative amounts. */
        orderPatch = { status: "REFUND_REVIEW" };
        disposition = "refund_requires_reconciliation";
      } else if (local && event.event_type === "PAYMENT.CAPTURE.REVERSED") {
        orderPatch = { status: "REVERSAL_REVIEW" };
        disposition = "reversal_requires_reconciliation";
      } else if (local && event.event_type === "CHECKOUT.ORDER.APPROVED") {
        const validationError = validateRemoteOrder(resource, local, config);
        orderPatch = protectedPaidState
          ? null
          : validationError
            ? { status: "MANUAL_REVIEW" }
            : { status: "APPROVED", paypalStatus: "APPROVED" };
        disposition = protectedPaidState
          ? "stale_event_ignored"
          : validationError
            ? "approved_order_mismatch"
            : "order_approved";
      } else if (local && event.event_type === "CHECKOUT.PAYMENT-APPROVAL.REVERSED") {
        orderPatch = protectedPaidState ? null : { status: "APPROVAL_REVERSED" };
        disposition = protectedPaidState ? "stale_event_ignored" : "approval_reversed";
      }

      const safeEvent = {
        eventID: event.id,
        eventType: event.event_type,
        resourceID: typeof resource.id === "string" ? resource.id.slice(0, 128) : null,
        orderID,
        status: typeof resource.status === "string" ? resource.status.slice(0, 40) : null,
        disposition,
        verified: true,
        receivedAt: now().toISOString(),
      };
      const persisted = await store.recordWebhook(safeEvent, orderID, orderPatch);
      logger.info("paypal_webhook_recorded", {
        eventID: safeEvent.eventID,
        eventType: safeEvent.eventType,
        orderID,
        disposition,
        duplicate: persisted.duplicate,
      });
      return res.status(200).json({ received: true, duplicate: persisted.duplicate });
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    if (error && error.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON request." });
    if (error && error.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
    if (error && error.expose && error.status) return res.status(error.status).json({ error: error.message });
    logger.error("unhandled_request_error", {
      method: req.method,
      path: req.path,
      errorType: error && error.name,
    });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return { app, config, catalog, store, paypal };
}

module.exports = {
  API_VERSION,
  KeyedLock,
  assessCapture,
  createApplication,
  hashToken,
  tokenMatches,
  validateRemoteOrder,
};
