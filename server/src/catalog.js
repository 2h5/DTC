"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_LINES = 20;
const MAX_QTY_PER_LINE = 99;
const MAX_TOTAL_CENTS = 100_000_000;
const SKU_RE = /^[A-Z0-9][A-Z0-9._-]{0,126}$/;

class CatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogError";
  }
}

function loadCatalog(filePath = path.resolve(__dirname, "..", "catalog.json")) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new CatalogError(`Could not read the authoritative catalog: ${error.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CatalogError("Catalog must be an object.");
  if (typeof raw.catalogVersion !== "string" || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(raw.catalogVersion)) {
    throw new CatalogError("Catalog requires a version such as 2026-07-19.1.");
  }
  if (raw.currency !== "USD") throw new CatalogError("Only the explicitly supported USD catalog is allowed.");
  if (!raw.items || typeof raw.items !== "object" || Array.isArray(raw.items)) {
    throw new CatalogError("Catalog items must be an object.");
  }

  const items = Object.create(null);
  for (const [sku, item] of Object.entries(raw.items)) {
    if (!SKU_RE.test(sku)) throw new CatalogError(`Invalid catalog SKU: ${sku}`);
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new CatalogError(`Invalid item: ${sku}`);
    if (typeof item.title !== "string" || item.title.length < 1 || item.title.length > 127) {
      throw new CatalogError(`Invalid title for ${sku}.`);
    }
    if (!Number.isSafeInteger(item.priceCents) || item.priceCents <= 0 || item.priceCents > MAX_TOTAL_CENTS) {
      throw new CatalogError(`Invalid integer-cent price for ${sku}.`);
    }
    if (!item.checkout || typeof item.checkout.sandbox !== "boolean" || typeof item.checkout.live !== "boolean") {
      throw new CatalogError(`Checkout eligibility must be explicit for ${sku}.`);
    }
    if (!new Set(["confirmed", "unconfirmed_estimate"]).has(item.priceStatus)) {
      throw new CatalogError(`Invalid priceStatus for ${sku}.`);
    }
    if (item.checkout.live && item.priceStatus !== "confirmed") {
      throw new CatalogError(`Unconfirmed item ${sku} cannot be enabled for live checkout.`);
    }
    items[sku] = Object.freeze({
      sku,
      title: item.title,
      priceCents: item.priceCents,
      priceStatus: item.priceStatus,
      checkout: Object.freeze({ sandbox: item.checkout.sandbox, live: item.checkout.live }),
    });
  }
  return Object.freeze({ catalogVersion: raw.catalogVersion, currency: raw.currency, items: Object.freeze(items) });
}

function publicCatalogState(catalog, mode) {
  const eligible = Object.values(catalog.items).filter((item) => item.checkout[mode]);
  if (mode === "live" && eligible.length === 0) {
    throw new CatalogError("Live checkout has no confirmed, live-enabled catalog items.");
  }
  return { eligibleCount: eligible.length };
}

function clientError(message) {
  return Object.assign(new Error(message), { status: 400, expose: true, code: "INVALID_CART" });
}

function priceCart(catalog, mode, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw clientError("Cart is empty.");
  if (rawItems.length > MAX_LINES) throw clientError("Too many cart lines.");
  const seen = new Set();
  const lines = rawItems.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.sku !== "string") {
      throw clientError("Malformed cart line.");
    }
    const keys = Object.keys(raw);
    if (keys.length !== 2 || !keys.includes("sku") || !keys.includes("qty")) {
      throw clientError("Cart lines may contain only sku and qty.");
    }
    if (seen.has(raw.sku)) throw clientError("Duplicate cart line.");
    seen.add(raw.sku);
    const item = Object.prototype.hasOwnProperty.call(catalog.items, raw.sku) ? catalog.items[raw.sku] : null;
    if (!item || !item.checkout[mode]) {
      throw clientError("An item in the cart is not available for online checkout.");
    }
    if (!Number.isInteger(raw.qty) || raw.qty < 1 || raw.qty > MAX_QTY_PER_LINE) {
      throw clientError("Invalid quantity.");
    }
    return Object.freeze({ sku: item.sku, qty: raw.qty, unitCents: item.priceCents, title: item.title });
  });
  const totalCents = lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > MAX_TOTAL_CENTS) {
    throw clientError("Cart total is outside the supported checkout range.");
  }
  return Object.freeze({ lines: Object.freeze(lines), totalCents });
}

function centsToValue(cents) {
  return (cents / 100).toFixed(2);
}

module.exports = {
  CatalogError,
  MAX_LINES,
  MAX_QTY_PER_LINE,
  centsToValue,
  loadCatalog,
  priceCart,
  publicCatalogState,
};
