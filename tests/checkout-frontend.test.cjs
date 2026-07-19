"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const configSource = fs.readFileSync(
  path.join(projectRoot, "docs", "assets", "js", "commerce", "commerce-config.js"),
  "utf8"
);
const checkoutSource = fs.readFileSync(
  path.join(projectRoot, "docs", "assets", "js", "commerce", "checkout.js"),
  "utf8"
);

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(name) {
    this.name = name;
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.attributes = new Map();
    this.children = [];
    this.listeners = Object.create(null);
    this.classList = new FakeClassList();
  }
  addEventListener(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  }
  appendChild(child) { this.children.push(child); return child; }
  focus() { this.focused = true; }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  remove() { this.removed = true; }
  removeAttribute(name) { this.attributes.delete(name); }
  scrollIntoView() { this.scrolled = true; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  toggleAttribute(name, force) {
    if (force === false) this.attributes.delete(name);
    else this.attributes.set(name, "");
  }
}

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json; charset=utf-8" },
    json: () => Promise.resolve(data)
  };
}

function makeConfig(mode = "off") {
  const enabled = mode === "sandbox" || mode === "live";
  return {
    checkoutMode: mode,
    apiBase: enabled ? "https://checkout.example.test" : "",
    paypalClientId: enabled ? "CLIENT_ID_1234567890_ABCDEFG" : "",
    createEnabled: enabled,
    apiVersion: 1,
    catalogVersion: "2026-07-19.1",
    currency: "USD",
    maxQtyPerLine: 99,
    maxLines: 20,
    checkoutEnabled: enabled
  };
}

function matchingPreflight(config) {
  return {
    ok: true,
    createEnabled: true,
    apiVersion: config.apiVersion,
    mode: config.checkoutMode,
    currency: config.currency,
    paypalClientId: config.paypalClientId,
    catalogVersion: config.catalogVersion,
    maxLines: config.maxLines,
    maxQtyPerLine: config.maxQtyPerLine
  };
}

function createHarness(options = {}) {
  const config = options.config || makeConfig("off");
  const elements = Object.create(null);
  const selectorNames = [
    "[data-cart-empty]", "[data-cart-layout]", "[data-cart-lines]",
    "[data-cart-subtotal]", "[data-cart-total]", "[data-checkout-offline]",
    "[data-checkout-live]", "[data-checkout-sandbox]", "[data-checkout-loading]",
    "[data-paypal-button-container]", "#paypal-button", "[data-checkout-status]",
    "[data-checkout-alert]", "[data-checkout-reference]", "[data-checkout-order-id]",
    "[data-checkout-merchant-row]", "[data-checkout-merchant-reference]",
    "[data-checkout-retry]", "[data-cart-success]", "[data-success-order-id]",
    "[data-success-merchant-row]", "[data-success-merchant-reference]"
  ];
  selectorNames.forEach((selector) => { elements[selector] = new FakeElement(selector); });
  elements["[data-cart-empty]"].hidden = true;
  elements["[data-cart-layout]"].hidden = true;
  elements["[data-checkout-live]"].hidden = true;
  elements["[data-checkout-sandbox]"].hidden = true;
  elements["#paypal-button"].hidden = true;
  elements["[data-checkout-reference]"].hidden = true;
  elements["[data-checkout-retry]"].hidden = true;
  elements["[data-cart-success]"].hidden = true;

  const root = new FakeElement("root");
  root.querySelector = (selector) => elements[selector] || new FakeElement(selector);
  root.querySelectorAll = () => [];

  const appendedScripts = [];
  const coreScript = new FakeElement("core-script");
  coreScript.setAttribute("src", "assets/js/core.js");
  const document = {
    head: {
      appendChild(script) {
        appendedScripts.push(script);
        if (options.onScriptAppend) options.onScriptAppend(script, context, state);
        else queueMicrotask(() => script.onerror && script.onerror());
        return script;
      }
    },
    addEventListener() {},
    createElement: (name) => new FakeElement(name),
    querySelector(selector) {
      if (selector === "[data-cart-root]") return root;
      if (selector === 'script[src$="assets/js/core.js"]') return coreScript;
      if (selector === 'script[src*="paypal.com/"]') return null;
      if (selector.startsWith("[data-cart-readout-")) return new FakeElement(selector);
      return null;
    }
  };

  let cartItems = (options.cartItems || []).map((item) => ({ ...item }));
  const cart = {
    clearCalls: 0,
    removeCalls: [],
    getItems: () => cartItems.map((item) => ({ ...item })),
    getSubtotalCents: () => cartItems.reduce((sum, item) => {
      const entry = options.catalog && options.catalog[item.sku];
      return sum + (entry ? entry.priceCents * item.qty : 0);
    }, 0),
    clear() { this.clearCalls += 1; cartItems = []; },
    remove(sku) { this.removeCalls.push(sku); cartItems = cartItems.filter((item) => item.sku !== sku); },
    setQty(sku, qty) {
      const item = cartItems.find((candidate) => candidate.sku === sku);
      if (item) item.qty = Number(qty);
    }
  };

  const state = { appendedScripts, fetchCalls: [], elements, cart };
  const sessionValues = new Map(options.sessionEntries || []);
  const sessionStorage = {
    getItem(key) { return sessionValues.has(key) ? sessionValues.get(key) : null; },
    setItem(key, value) { sessionValues.set(key, String(value)); },
    removeItem(key) { sessionValues.delete(key); }
  };
  state.sessionValues = sessionValues;
  const window = {
    DTC_COMMERCE_CONFIG: config,
    DTC_CART: cart,
    DTC_CATALOG: options.catalog || {},
    location: { protocol: "https:", hostname: "shop.example.test" },
    sessionStorage,
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext({
    AbortController,
    URL,
    console,
    document,
    fetch(url, fetchOptions) {
      state.fetchCalls.push({ url, options: fetchOptions });
      return options.fetchHandler(url, fetchOptions, state);
    },
    queueMicrotask,
    setTimeout,
    clearTimeout,
    window
  });

  vm.runInContext(checkoutSource, context, { filename: "checkout.js" });
  return { context, state, window };
}

function installMockPayPal(script, context, state, behavior = {}) {
  context.window.paypal = {
    createInstance: () => Promise.resolve({
      findEligibleMethods: () => Promise.resolve({ isEligible: (method) => method === "paypal" }),
      createPayPalOneTimePaymentSession(callbacks) {
        state.sessionCallbacks = callbacks;
        return {
          start(options, orderPromise) {
            state.sessionStarts = (state.sessionStarts || 0) + 1;
            return orderPromise.then((orderId) => {
              state.startedOrderID = orderId;
              if (behavior.approve === false) return undefined;
              return callbacks.onApprove({ orderId });
            });
          }
        };
      }
    })
  };
  queueMicrotask(() => script.onload && script.onload());
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

test("public commerce config is frozen and ships explicitly off", () => {
  const window = {};
  vm.runInNewContext(configSource, { window });
  assert.equal(window.DTC_COMMERCE_CONFIG.checkoutMode, "off");
  assert.equal(window.DTC_COMMERCE_CONFIG.checkoutEnabled, false);
  assert.equal(window.DTC_COMMERCE_CONFIG.apiBase, "");
  assert.equal(window.DTC_COMMERCE_CONFIG.paypalClientId, "");
  assert.equal(Object.isFrozen(window.DTC_COMMERCE_CONFIG), true);
});

test("off mode makes no backend request and appends no PayPal script", () => {
  const harness = createHarness({
    fetchHandler: () => { throw new Error("fetch must not run in off mode"); }
  });
  assert.equal(harness.state.fetchCalls.length, 0);
  assert.equal(harness.state.appendedScripts.length, 0);
});

test("a validated unresolved marker blocks a new checkout after reload", () => {
  const marker = JSON.stringify({
    orderID: "PAYPAL-ORDER-LOCKED",
    merchantReference: "DTC-ORDER-LOCKED",
    createdAt: 1784476800000
  });
  const harness = createHarness({
    config: makeConfig("sandbox"),
    sessionEntries: [["dtc.checkout.pending.v1", marker]],
    fetchHandler: () => { throw new Error("preflight must not run while payment is unresolved"); }
  });
  assert.equal(harness.state.fetchCalls.length, 0);
  assert.equal(harness.state.appendedScripts.length, 0);
  assert.equal(harness.state.elements["[data-checkout-merchant-reference]"].textContent, "DTC-ORDER-LOCKED");
  assert.equal(harness.state.elements["#paypal-button"].attributes.has("disabled"), true);
});

test("backend preflight mismatch fails closed before loading PayPal", async () => {
  const config = makeConfig("sandbox");
  const harness = createHarness({
    config,
    fetchHandler: () => Promise.resolve(jsonResponse(200, { ...matchingPreflight(config), currency: "EUR" }))
  });
  await settle();
  assert.equal(harness.state.fetchCalls.length, 1);
  assert.equal(harness.state.appendedScripts.length, 0);
  assert.equal(harness.state.elements["[data-checkout-live]"].hidden, true);
  assert.equal(harness.state.elements["[data-checkout-offline]"].hidden, false);
});

test("sandbox preflight loads only the Web SDK v6 sandbox core", async () => {
  const config = makeConfig("sandbox");
  const harness = createHarness({
    config,
    fetchHandler: () => Promise.resolve(jsonResponse(200, matchingPreflight(config)))
  });
  await settle();
  assert.equal(harness.state.appendedScripts.length, 1);
  assert.equal(harness.state.appendedScripts[0].src, "https://www.sandbox.paypal.com/web-sdk/v6/core");
  assert.equal(harness.state.appendedScripts[0].src.includes("client-id="), false);
});

test("create-time price drift cannot reach approval or capture", async () => {
  const config = makeConfig("sandbox");
  const catalog = {
    SKU1: { sku: "SKU1", title: "SKU1", desc: "Part", series: "Series", priceCents: 124000, purchasable: true, image: "part.jpg", url: "part.html" }
  };
  const harness = createHarness({
    config,
    catalog,
    cartItems: [{ sku: "SKU1", qty: 1 }],
    fetchHandler(url) {
      if (url.endsWith("/api/checkout/config")) return Promise.resolve(jsonResponse(200, matchingPreflight(config)));
      if (url.endsWith("/api/checkout/order")) {
        return Promise.resolve(jsonResponse(200, {
          id: "PAYPAL-ORDER-1",
          checkoutToken: "TOKEN_12345678901234567890",
          merchantReference: "DTC-ORDER-1",
          currency: "USD",
          totalCents: 123999,
          catalogVersion: config.catalogVersion
        }));
      }
      throw new Error("capture/status must not run after a price mismatch");
    },
    onScriptAppend: (script, context, state) => installMockPayPal(script, context, state)
  });
  await settle();
  harness.state.elements["#paypal-button"].listeners.click[0]();
  await settle();
  assert.equal(harness.state.fetchCalls.filter((call) => call.url.endsWith("/api/checkout/order")).length, 1);
  assert.equal(harness.state.fetchCalls.some((call) => call.url.endsWith("/api/checkout/capture")), false);
  assert.equal(harness.state.fetchCalls.some((call) => call.url.endsWith("/api/checkout/status")), false);
  assert.equal(harness.state.startedOrderID, undefined);
  assert.equal(harness.state.elements["[data-checkout-live]"].hidden, true);
});

test("ambiguous capture reconciles and retries only the same order", async () => {
  const config = makeConfig("sandbox");
  const catalog = {
    SKU1: { sku: "SKU1", title: "SKU1", desc: "Part", series: "Series", priceCents: 124000, purchasable: true, image: "part.jpg", url: "part.html" }
  };
  const orderID = "PAYPAL-ORDER-2";
  const checkoutToken = "TOKEN_12345678901234567890";
  let statusCalls = 0;
  let captureCalls = 0;
  const harness = createHarness({
    config,
    catalog,
    cartItems: [{ sku: "SKU1", qty: 1 }],
    fetchHandler(url, fetchOptions) {
      if (url.endsWith("/api/checkout/config")) return Promise.resolve(jsonResponse(200, matchingPreflight(config)));
      if (url.endsWith("/api/checkout/order")) {
        return Promise.resolve(jsonResponse(200, {
          id: orderID,
          checkoutToken,
          merchantReference: "DTC-ORDER-2",
          currency: "USD",
          totalCents: 124000,
          catalogVersion: config.catalogVersion
        }));
      }
      const body = JSON.parse(fetchOptions.body);
      assert.deepEqual(body, { orderID, checkoutToken });
      if (url.endsWith("/api/checkout/capture")) {
        captureCalls += 1;
        if (captureCalls === 1) {
          return Promise.resolve(jsonResponse(503, {
            status: "UNKNOWN",
            orderID,
            merchantReference: "DTC-ORDER-2",
            retriable: true
          }));
        }
        return Promise.resolve(jsonResponse(200, {
          status: "COMPLETED",
          orderID,
          captureID: "CAPTURE-2",
          merchantReference: "DTC-ORDER-2"
        }));
      }
      if (url.endsWith("/api/checkout/status")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          return Promise.resolve(jsonResponse(202, {
            status: "PENDING",
            orderID,
            merchantReference: "DTC-ORDER-2"
          }));
        }
        return Promise.resolve(jsonResponse(200, {
          status: "APPROVED",
          orderID,
          merchantReference: "DTC-ORDER-2",
          retriable: true
        }));
      }
      throw new Error("unexpected request");
    },
    onScriptAppend: (script, context, state) => installMockPayPal(script, context, state)
  });

  await settle();
  harness.state.elements["#paypal-button"].listeners.click[0]();
  await settle();
  assert.equal(harness.state.elements["[data-checkout-retry]"].hidden, false);
  assert.equal(harness.state.sessionValues.has("dtc.checkout.pending.v1"), true);
  assert.equal(harness.state.elements["#paypal-button"].attributes.has("disabled"), true);
  assert.equal(harness.state.cart.removeCalls.length, 0);

  harness.state.elements["[data-checkout-retry]"].listeners.click[0]();
  await settle();
  assert.equal(captureCalls, 2);
  assert.equal(statusCalls, 2);
  assert.equal(harness.state.fetchCalls.filter((call) => call.url.endsWith("/api/checkout/order")).length, 1);
  assert.deepEqual(harness.state.cart.removeCalls, ["SKU1"]);
  assert.equal(harness.state.sessionValues.has("dtc.checkout.pending.v1"), false);
  assert.equal(harness.state.elements["[data-cart-success]"].hidden, false);
  assert.equal(harness.state.elements["[data-success-merchant-reference]"].textContent, "DTC-ORDER-2");
});
