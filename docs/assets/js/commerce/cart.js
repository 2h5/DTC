/* Cart store. Owns the single source of client-side cart truth: a
   localStorage record of { sku, qty } pairs and nothing else.

   Deliberately, the cart NEVER stores prices, titles or totals. Display
   data is looked up from DTC_CATALOG at render time, and money is computed
   by the backend at checkout, so a hand-edited localStorage entry can at
   worst order a real part at its real price. Everything read back from
   localStorage is treated as untrusted input: parsed inside try/catch,
   shape-checked, SKUs matched against the catalog allowlist, quantities
   clamped to integers within the configured caps.

   Consumers (cart-ui.js, checkout.js) react to the "dtc:cartchange"
   CustomEvent on document; a "storage" listener re-emits it so a second
   tab stays in sync. Requires commerce-config.js and commerce-catalog.js
   to be loaded first. */
(function () {
  var config = window.DTC_COMMERCE_CONFIG;
  var catalog = window.DTC_CATALOG;
  if (!config || !catalog) return;

  var STORAGE_KEY = "dtc.cart.v1";
  var MAX_QTY = config.maxQtyPerLine;
  var MAX_LINES = config.maxLines;

  function clampQty(value) {
    var n = Math.floor(Number(value));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(n, MAX_QTY);
  }

  /* Returns a validated copy of whatever is in storage. Unknown SKUs,
     duplicate lines and malformed entries are dropped rather than
     repaired-in-place, so a corrupted record can't wedge the cart. */
  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return []; /* storage blocked (private mode etc.) — behave as empty */
    }
    if (!raw) return [];

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) return [];

    var seen = {};
    var items = [];
    parsed.items.forEach(function (entry) {
      if (!entry || typeof entry.sku !== "string") return;
      var sku = entry.sku;
      if (!Object.prototype.hasOwnProperty.call(catalog, sku)) return;
      if (seen[sku] || items.length >= MAX_LINES) return;
      seen[sku] = true;
      items.push({ sku: sku, qty: clampQty(entry.qty) });
    });
    return items;
  }

  function save(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, items: items }));
    } catch (e) {
      /* Quota/blocked storage: the in-page cart still works for this view,
         it just won't persist. Nothing useful to surface to the visitor. */
    }
    emit(items);
  }

  function emit(items) {
    document.dispatchEvent(new CustomEvent("dtc:cartchange", {
      detail: { items: items, count: count(items) }
    }));
  }

  function count(items) {
    return items.reduce(function (sum, item) { return sum + item.qty; }, 0);
  }

  window.DTC_CART = {
    /* Fresh validated snapshot; callers may mutate their copy freely. */
    getItems: load,

    getCount: function () { return count(load()); },

    /* Estimated subtotal in integer cents, from the display catalog. For
       UI only — the backend recomputes the real total at checkout. */
    getSubtotalCents: function () {
      return load().reduce(function (sum, item) {
        var entry = catalog[item.sku];
        return entry && entry.purchasable ? sum + entry.priceCents * item.qty : sum;
      }, 0);
    },

    add: function (sku, qty) {
      if (!Object.prototype.hasOwnProperty.call(catalog, sku)) return false;
      var items = load();
      var line = items.filter(function (item) { return item.sku === sku; })[0];
      if (line) {
        line.qty = clampQty(line.qty + clampQty(qty || 1));
      } else {
        if (items.length >= MAX_LINES) return false;
        items.push({ sku: sku, qty: clampQty(qty || 1) });
      }
      save(items);
      return true;
    },

    setQty: function (sku, qty) {
      var items = load();
      var n = Math.floor(Number(qty));
      if (isFinite(n) && n < 1) {
        items = items.filter(function (item) { return item.sku !== sku; });
      } else {
        items.forEach(function (item) {
          if (item.sku === sku) item.qty = clampQty(qty);
        });
      }
      save(items);
    },

    remove: function (sku) {
      save(load().filter(function (item) { return item.sku !== sku; }));
    },

    clear: function () {
      save([]);
    }
  };

  /* Another tab changed the cart: revalidate and let this page's UI catch up. */
  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY) emit(load());
  });
})();
