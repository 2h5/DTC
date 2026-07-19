/* Cart page controller (docs/cart.html only): renders the line-item
   workspace and summary from the cart store, and owns the checkout zone.

   Checkout has two states, decided by commerce-config.js:

   - Offline (apiBase/paypalClientId not set yet): the PayPal area stays a
     request-a-quote notice. Nothing external loads. This is the shipped
     default and it fails closed.
   - Live: the official PayPal JS SDK is injected (from www.paypal.com
     only, parameterised with the public client id) and its buttons drive
     a backend-owned order flow:
       createOrder -> POST {apiBase}/api/checkout/order  { items:[{sku,qty}] }
       onApprove   -> POST {apiBase}/api/checkout/capture { orderID }
     The browser only ever sends SKUs, quantities and PayPal's own order
     id. It never sends amounts — the backend prices the order from
     server/catalog.json, and PayPal charges what the backend created.
     Totals rendered on this page are estimates for display.

   All rendering is createElement/textContent; nothing user-influenced is
   ever parsed as HTML. Requires commerce-config.js, commerce-catalog.js,
   cart.js (and core.js for path derivation) loaded first. */
(function () {
  var config = window.DTC_COMMERCE_CONFIG;
  var cart = window.DTC_CART;
  var catalog = window.DTC_CATALOG;
  var root = document.querySelector("[data-cart-root]");
  if (!config || !cart || !catalog || !root) return;

  var coreScript = document.querySelector('script[src$="assets/js/core.js"]');
  var basePath = coreScript ? coreScript.getAttribute("src").replace(/assets\/js\/core\.js$/, "") : "";

  var els = {
    empty: root.querySelector("[data-cart-empty]"),
    layout: root.querySelector("[data-cart-layout]"),
    lines: root.querySelector("[data-cart-lines]"),
    subtotal: root.querySelector("[data-cart-subtotal]"),
    total: root.querySelector("[data-cart-total]"),
    readoutLines: document.querySelector("[data-cart-readout-lines]"),
    readoutUnits: document.querySelector("[data-cart-readout-units]"),
    readoutTotal: document.querySelector("[data-cart-readout-total]"),
    offline: root.querySelector("[data-checkout-offline]"),
    live: root.querySelector("[data-checkout-live]"),
    paypalMount: root.querySelector("#paypal-button-container"),
    status: root.querySelector("[data-checkout-status]"),
    success: root.querySelector("[data-cart-success]"),
    successOrderId: root.querySelector("[data-success-order-id]")
  };

  var formatMoney = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: config.currency
  });
  function money(cents) { return formatMoney.format(cents / 100); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ----- Line item rendering ----------------------------------------- */

  function buildQtyControl(item) {
    var wrap = document.createElement("div");
    wrap.className = "cart-line-qty";

    var dec = document.createElement("button");
    dec.type = "button";
    dec.className = "qty-step";
    dec.textContent = "−";
    dec.setAttribute("aria-label", "Decrease quantity of " + item.sku);

    var input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = String(config.maxQtyPerLine);
    input.value = String(item.qty);
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "Quantity of " + item.sku);

    var inc = document.createElement("button");
    inc.type = "button";
    inc.className = "qty-step";
    inc.textContent = "+";
    inc.setAttribute("aria-label", "Increase quantity of " + item.sku);

    dec.addEventListener("click", function () { cart.setQty(item.sku, item.qty - 1); });
    inc.addEventListener("click", function () { cart.setQty(item.sku, item.qty + 1); });
    input.addEventListener("change", function () {
      /* A blanked/garbled field snaps back to the current quantity instead
         of being read as zero (which would silently drop the line). */
      if (input.value.trim() === "" || !isFinite(Number(input.value))) {
        input.value = String(item.qty);
        return;
      }
      cart.setQty(item.sku, input.value);
    });

    wrap.appendChild(dec);
    wrap.appendChild(input);
    wrap.appendChild(inc);
    return wrap;
  }

  function buildLine(item) {
    var entry = catalog[item.sku];
    var line = document.createElement("article");
    line.className = "cart-line";

    var media = document.createElement("a");
    media.className = "cart-line-media";
    media.href = basePath + entry.url;
    var img = document.createElement("img");
    img.src = basePath + entry.image;
    img.alt = "Photo of " + entry.title;
    img.loading = "lazy";
    media.appendChild(img);

    var body = document.createElement("div");
    body.className = "cart-line-body";
    var skuLink = document.createElement("a");
    skuLink.className = "cart-line-sku";
    skuLink.href = basePath + entry.url;
    skuLink.textContent = entry.title;
    var series = document.createElement("span");
    series.className = "cart-line-series";
    series.textContent = entry.series;
    var desc = document.createElement("p");
    desc.className = "cart-line-desc";
    desc.textContent = entry.desc;
    body.appendChild(skuLink);
    body.appendChild(series);
    body.appendChild(desc);

    var price = document.createElement("div");
    price.className = "cart-line-price";
    var lineTotal = document.createElement("strong");
    lineTotal.textContent = money(entry.priceCents * item.qty);
    var each = document.createElement("span");
    each.textContent = money(entry.priceCents) + " each";
    price.appendChild(lineTotal);
    price.appendChild(each);

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cart-line-remove";
    remove.setAttribute("aria-label", "Remove " + item.sku + " from cart");
    remove.textContent = "×";
    remove.addEventListener("click", function () { cart.remove(item.sku); });

    line.appendChild(media);
    line.appendChild(body);
    line.appendChild(buildQtyControl(item));
    line.appendChild(price);
    line.appendChild(remove);
    return line;
  }

  var checkoutComplete = false;

  function render() {
    /* A completed order replaces the workspace; don't re-render over it
       when clearing the cart fires its change event. */
    if (checkoutComplete) return;

    var items = cart.getItems();
    var subtotal = cart.getSubtotalCents();
    var units = items.reduce(function (sum, item) { return sum + item.qty; }, 0);

    if (els.readoutLines) els.readoutLines.textContent = pad2(items.length);
    if (els.readoutUnits) els.readoutUnits.textContent = pad2(units);
    if (els.readoutTotal) els.readoutTotal.textContent = money(subtotal);

    if (!items.length) {
      els.empty.hidden = false;
      els.layout.hidden = true;
      return;
    }
    els.empty.hidden = true;
    els.layout.hidden = false;

    els.lines.textContent = "";
    items.forEach(function (item) { els.lines.appendChild(buildLine(item)); });

    els.subtotal.textContent = money(subtotal);
    els.total.textContent = money(subtotal);
  }

  render();
  document.addEventListener("dtc:cartchange", render);

  /* ----- Checkout zone ------------------------------------------------ */

  function setStatus(message, isError) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.classList.toggle("is-error", Boolean(isError));
  }

  function showSuccess(orderId) {
    checkoutComplete = true;
    cart.clear();
    els.layout.hidden = true;
    els.empty.hidden = true;
    if (els.successOrderId) els.successOrderId.textContent = orderId;
    els.success.hidden = false;
    els.success.scrollIntoView({ block: "start" });
  }

  /* Payload the backend expects: SKUs and quantities only. */
  function checkoutPayload() {
    return {
      items: cart.getItems().filter(function (item) {
        var entry = catalog[item.sku];
        return entry && entry.purchasable;
      }).map(function (item) {
        return { sku: item.sku, qty: item.qty };
      })
    };
  }

  function postJson(path, body) {
    return fetch(config.apiBase + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(data && data.error ? String(data.error) : "Request failed");
          error.retriable = Boolean(data && data.retriable);
          throw error;
        }
        return data;
      });
    });
  }

  function renderPayPalButtons() {
    window.paypal.Buttons({
      style: { layout: "vertical", color: "gold", shape: "pill", label: "checkout" },

      createOrder: function () {
        setStatus("");
        var payload = checkoutPayload();
        if (!payload.items.length) {
          setStatus("Nothing in your cart is available for online checkout yet.", true);
          return Promise.reject(new Error("empty checkout payload"));
        }
        return postJson("/api/checkout/order", payload).then(function (data) {
          if (!data || typeof data.id !== "string") throw new Error("Malformed order response");
          return data.id;
        });
      },

      onApprove: function (data, actions) {
        setStatus("Confirming your payment…");
        return postJson("/api/checkout/capture", { orderID: data.orderID }).then(function (result) {
          if (result && result.status === "COMPLETED") {
            showSuccess(result.orderID || data.orderID);
            return;
          }
          throw new Error("Capture did not complete");
        }).catch(function (error) {
          /* Declined instrument: PayPal recommends restarting so the buyer
             can pick another funding source. Anything else is terminal for
             this attempt; money has not moved unless status was COMPLETED. */
          if (error && error.retriable && actions && actions.restart) {
            setStatus("That payment method was declined. Please choose another way to pay.", true);
            return actions.restart();
          }
          setStatus("We couldn't confirm the payment. You have not been charged — please try again or call 201-244-6477.", true);
        });
      },

      onCancel: function () {
        setStatus("Checkout cancelled. Your cart is unchanged.");
      },

      onError: function () {
        setStatus("Something went wrong starting checkout. Please try again or request a quote instead.", true);
      }
    }).render(els.paypalMount);
  }

  function initCheckout() {
    if (!config.checkoutEnabled) {
      /* Shipped default: no backend, no client id — leave the offline
         request-a-quote panel in place and load nothing external. */
      return;
    }
    els.offline.hidden = true;
    els.live.hidden = false;

    /* Official SDK host only; the client id is public configuration. */
    var script = document.createElement("script");
    script.src = "https://www.paypal.com/sdk/js" +
      "?client-id=" + encodeURIComponent(config.paypalClientId) +
      "&currency=" + encodeURIComponent(config.currency) +
      "&intent=capture&components=buttons";
    script.async = true;
    script.onload = function () {
      if (window.paypal && window.paypal.Buttons) renderPayPalButtons();
      else setStatus("Secure checkout failed to load. Please refresh or request a quote.", true);
    };
    script.onerror = function () {
      els.live.hidden = true;
      els.offline.hidden = false;
      setStatus("Secure checkout failed to load. Please refresh or request a quote.", true);
    };
    document.head.appendChild(script);
  }

  initCheckout();
})();
