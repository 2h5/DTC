"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { loadConfig } = require("../src/config");
const { loadCatalog, priceCart } = require("../src/catalog");
const { sanitize } = require("../src/logger");
const { assessCapture, hashToken, tokenMatches, validateRemoteOrder } = require("../src/app");

const catalog = loadCatalog(path.resolve(__dirname, "..", "catalog.json"));

test("committed configuration is disabled and live mode is impossible", () => {
  assert.equal(loadConfig({}).mode, "disabled");
  assert.throws(
    () => loadConfig({ PAYPAL_ENV: "live" }),
    /production order-store adapter has not been selected or implemented/
  );
});

test("authoritative pricing accepts only sku and integer quantity", () => {
  const priced = priceCart(catalog, "sandbox", [{ sku: "259B2451BVP4", qty: 2 }]);
  assert.equal(priced.totalCents, 248000);
  assert.throws(() => priceCart(catalog, "sandbox", [{ sku: "259B2451BVP4", qty: 1, price: 1 }]));
  assert.throws(() => priceCart(catalog, "sandbox", [{ sku: "259B2451BVP4", qty: "1" }]));
  assert.throws(() => priceCart(catalog, "live", [{ sku: "259B2451BVP4", qty: 1 }]));
});

test("checkout tokens are compared against hashes and malformed tokens fail", () => {
  const token = "A".repeat(43);
  const hash = hashToken(token);
  assert.equal(tokenMatches(token, hash), true);
  assert.equal(tokenMatches("B".repeat(43), hash), false);
  assert.equal(tokenMatches("short", hash), false);
});

test("remote order and capture validation reject amount drift", () => {
  const local = {
    orderID: "ORDER123",
    merchantReference: "DTC-REFERENCE",
    currency: "USD",
    totalCents: 124000,
    lines: [{ sku: "259B2451BVP4", qty: 1, unitCents: 124000 }],
  };
  const unit = {
    custom_id: local.merchantReference,
    amount: {
      currency_code: "USD",
      value: "1240.00",
      breakdown: { item_total: { currency_code: "USD", value: "1240.00" } },
    },
    items: [{ sku: "259B2451BVP4", quantity: "1", unit_amount: { currency_code: "USD", value: "1240.00" } }],
  };
  assert.equal(validateRemoteOrder({ id: "ORDER123", intent: "CAPTURE", purchase_units: [unit] }, local, { mode: "sandbox" }), null);
  const changed = structuredClone(unit);
  changed.amount.value = "1.00";
  assert.match(validateRemoteOrder({ id: "ORDER123", intent: "CAPTURE", purchase_units: [changed] }, local, { mode: "sandbox" }), /amount mismatch/);

  const completed = structuredClone(unit);
  completed.payments = { captures: [{ id: "CAPTURE123", status: "COMPLETED", amount: { currency_code: "USD", value: "1240.00" } }] };
  assert.deepEqual(assessCapture({ purchase_units: [completed] }, local), { kind: "COMPLETED", captureID: "CAPTURE123" });
  completed.payments.captures[0].amount.value = "1.00";
  assert.equal(assessCapture({ purchase_units: [completed] }, local).kind, "INVALID");
});

test("structured logging redacts payment and personal fields", () => {
  const clean = sanitize({ checkoutToken: "secret", payerEmail: "buyer@example.com", orderID: "ORDER123" });
  assert.equal(clean.checkoutToken, "[REDACTED]");
  assert.equal(clean.payerEmail, "[REDACTED]");
  assert.equal(clean.orderID, "ORDER123");
});
