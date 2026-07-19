/* Cart page controller (docs/cart.html only).

   PAYMENT SAFETY MODEL
   --------------------
   - commerce-config.js must explicitly select off, sandbox or live.
   - Off mode performs no backend request and loads no PayPal code.
   - Sandbox/live mode validates the public config, then requires an exact
     GET /api/checkout/config compatibility match before loading Web SDK v6.
   - The browser sends only {sku, qty}; the backend owns all charge amounts.
   - Create responses are checked against the exact cart snapshot before the
     PayPal approval UI can start.
   - Capture and status calls require the opaque checkoutToken returned with
     the order. The token is held in memory only and is never persisted.
   - An ambiguous capture is reconciled against the same order. A retry uses
     the same order/token pair, allowing the backend's idempotency key to
     prevent a duplicate capture. A new order is never created automatically.

   All cart rendering uses createElement/textContent. Nothing from storage or
   an API response is parsed as HTML. Requires commerce-config.js,
   commerce-catalog.js and cart.js to be loaded first. */
(function () {
  "use strict";

  var config = window.DTC_COMMERCE_CONFIG;
  var cart = window.DTC_CART;
  var catalog = window.DTC_CATALOG;
  var root = document.querySelector("[data-cart-root]");
  if (!config || !cart || !catalog || !root) return;

  var coreScript = document.querySelector('script[src$="assets/js/core.js"]');
  var basePath = coreScript ? coreScript.getAttribute("src").replace(/assets\/js\/core\.js$/, "") : "";
  var displayCurrency = /^[A-Z]{3}$/.test(config.currency) ? config.currency : "USD";
  var maxQty = isPositiveInteger(config.maxQtyPerLine) ? config.maxQtyPerLine : 99;

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
    sandbox: root.querySelector("[data-checkout-sandbox]"),
    loading: root.querySelector("[data-checkout-loading]"),
    paypalMount: root.querySelector("[data-paypal-button-container]"),
    paypalButton: root.querySelector("#paypal-button"),
    status: root.querySelector("[data-checkout-status]"),
    alert: root.querySelector("[data-checkout-alert]"),
    reference: root.querySelector("[data-checkout-reference]"),
    orderId: root.querySelector("[data-checkout-order-id]"),
    merchantRow: root.querySelector("[data-checkout-merchant-row]"),
    merchantReference: root.querySelector("[data-checkout-merchant-reference]"),
    retry: root.querySelector("[data-checkout-retry]"),
    success: root.querySelector("[data-cart-success]"),
    successOrderId: root.querySelector("[data-success-order-id]"),
    successMerchantRow: root.querySelector("[data-success-merchant-row]"),
    successMerchantReference: root.querySelector("[data-success-merchant-reference]")
  };

  var formatMoney = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: displayCurrency
  });

  var checkoutComplete = false;
  var checkoutBusy = false;
  var cartLocked = false;
  var checkoutUnavailable = false;
  var currentOrder = null;
  var paymentSession = null;
  var reconciliationPromise = null;
  var pendingMarkerKey = "dtc.checkout.pending.v1";

  function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function money(cents) {
    return formatMoney.format(cents / 100);
  }

  function pad2(number) {
    return (number < 10 ? "0" : "") + number;
  }

  function setHidden(element, hidden) {
    if (element) element.hidden = Boolean(hidden);
  }

  /* ----- Line item rendering ----------------------------------------- */

  function buildQtyControl(item) {
    var wrap = document.createElement("div");
    wrap.className = "cart-line-qty";

    var decrease = document.createElement("button");
    decrease.type = "button";
    decrease.className = "qty-step";
    decrease.textContent = "−";
    decrease.setAttribute("aria-label", "Decrease quantity of " + item.sku);

    var input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = String(maxQty);
    input.value = String(item.qty);
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "Quantity of " + item.sku);

    var increase = document.createElement("button");
    increase.type = "button";
    increase.className = "qty-step";
    increase.textContent = "+";
    increase.setAttribute("aria-label", "Increase quantity of " + item.sku);

    decrease.addEventListener("click", function () {
      if (!cartLocked) cart.setQty(item.sku, item.qty - 1);
    });
    increase.addEventListener("click", function () {
      if (!cartLocked) cart.setQty(item.sku, item.qty + 1);
    });
    input.addEventListener("change", function () {
      if (cartLocked) {
        input.value = String(item.qty);
        return;
      }
      if (input.value.trim() === "" || !isFinite(Number(input.value))) {
        input.value = String(item.qty);
        return;
      }
      cart.setQty(item.sku, input.value);
    });

    wrap.appendChild(decrease);
    wrap.appendChild(input);
    wrap.appendChild(increase);
    return wrap;
  }

  function buildLine(item) {
    var entry = catalog[item.sku];
    var line = document.createElement("article");
    line.className = "cart-line";

    var media = document.createElement("a");
    media.className = "cart-line-media";
    media.href = basePath + entry.url;
    var image = document.createElement("img");
    image.src = basePath + entry.image;
    image.alt = "Photo of " + entry.title;
    image.loading = "lazy";
    media.appendChild(image);

    var body = document.createElement("div");
    body.className = "cart-line-body";
    var skuLink = document.createElement("a");
    skuLink.className = "cart-line-sku";
    skuLink.href = basePath + entry.url;
    skuLink.textContent = entry.title;
    var series = document.createElement("span");
    series.className = "cart-line-series";
    series.textContent = entry.series;
    var description = document.createElement("p");
    description.className = "cart-line-desc";
    description.textContent = entry.desc;
    body.appendChild(skuLink);
    body.appendChild(series);
    body.appendChild(description);

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
    remove.addEventListener("click", function () {
      if (!cartLocked) cart.remove(item.sku);
    });

    line.appendChild(media);
    line.appendChild(body);
    line.appendChild(buildQtyControl(item));
    line.appendChild(price);
    line.appendChild(remove);
    return line;
  }

  function applyControlState() {
    var controls = root.querySelectorAll(".cart-line button, .cart-line input");
    controls.forEach(function (control) {
      control.disabled = cartLocked;
    });

    if (els.paypalButton) {
      var disablePayPal = checkoutBusy || cartLocked || checkoutUnavailable || checkoutComplete;
      els.paypalButton.toggleAttribute("disabled", disablePayPal);
      els.paypalButton.setAttribute("aria-disabled", disablePayPal ? "true" : "false");
    }
    if (els.retry) els.retry.disabled = checkoutBusy;
    if (els.paypalMount) els.paypalMount.setAttribute("aria-busy", checkoutBusy ? "true" : "false");
    root.classList.toggle("is-checkout-locked", cartLocked);
  }

  function render() {
    if (checkoutComplete) return;

    var items = cart.getItems();
    var subtotal = cart.getSubtotalCents();
    var units = items.reduce(function (sum, item) { return sum + item.qty; }, 0);

    if (els.readoutLines) els.readoutLines.textContent = pad2(items.length);
    if (els.readoutUnits) els.readoutUnits.textContent = pad2(units);
    if (els.readoutTotal) els.readoutTotal.textContent = money(subtotal);

    if (!items.length) {
      setHidden(els.empty, false);
      setHidden(els.layout, true);
      return;
    }

    setHidden(els.empty, true);
    setHidden(els.layout, false);
    els.lines.textContent = "";
    items.forEach(function (item) {
      els.lines.appendChild(buildLine(item));
    });
    els.subtotal.textContent = money(subtotal);
    els.total.textContent = money(subtotal);
    applyControlState();
  }

  render();
  document.addEventListener("dtc:cartchange", function () {
    if (!cartLocked) render();
  });

  /* ----- Accessible checkout state ----------------------------------- */

  function setMessage(message, kind) {
    if (els.status) {
      els.status.textContent = "";
      els.status.classList.remove("is-warning");
    }
    if (els.alert) els.alert.textContent = "";

    if (!message) return;
    if (kind === "error") {
      if (els.alert) els.alert.textContent = message;
      return;
    }
    if (els.status) {
      els.status.textContent = message;
      els.status.classList.toggle("is-warning", kind === "warning");
    }
  }

  function setOrderReference(orderID, merchantReference) {
    if (!orderID) return;
    if (els.orderId) els.orderId.textContent = orderID;
    if (validMerchantReference(merchantReference)) {
      if (els.merchantReference) els.merchantReference.textContent = merchantReference;
      setHidden(els.merchantRow, false);
    }
    setHidden(els.reference, false);
  }

  /* A non-secret, tab-scoped marker prevents a reload during an uncertain
     capture from silently opening a second checkout. The bearer-like
     checkoutToken and all payer data remain memory-only. Marker failures are
     handled by stopping before capture; they never weaken recovery. */
  function readPendingMarker() {
    try {
      if (!window.sessionStorage) return null;
      var parsed = JSON.parse(window.sessionStorage.getItem(pendingMarkerKey) || "null");
      if (!isPlainObject(parsed) || !validOrderID(parsed.orderID) ||
          !validMerchantReference(parsed.merchantReference) ||
          !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt <= 0) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writePendingMarker(order) {
    try {
      if (!window.sessionStorage) return false;
      var marker = {
        orderID: order.orderID,
        merchantReference: order.merchantReference,
        createdAt: Date.now()
      };
      window.sessionStorage.setItem(pendingMarkerKey, JSON.stringify(marker));
      var verified = readPendingMarker();
      return Boolean(verified && verified.orderID === order.orderID &&
        verified.merchantReference === order.merchantReference);
    } catch (error) {
      return false;
    }
  }

  function clearPendingMarker(orderID) {
    try {
      if (!window.sessionStorage) return;
      var marker = readPendingMarker();
      if (marker && marker.orderID === orderID) window.sessionStorage.removeItem(pendingMarkerKey);
    } catch (error) {
      /* A stale marker fails closed on the next load. */
    }
  }

  function setBusy(busy, lockCart) {
    checkoutBusy = Boolean(busy);
    if (typeof lockCart === "boolean") cartLocked = lockCart;
    if (els.live) els.live.setAttribute("aria-busy", checkoutBusy ? "true" : "false");
    applyControlState();
  }

  function releaseForAnotherAttempt(message, kind, backendConfirmedSafe) {
    var orderID = currentOrder ? currentOrder.orderID : "";
    if (backendConfirmedSafe && orderID) clearPendingMarker(orderID);
    currentOrder = null;
    reconciliationPromise = null;
    setHidden(els.retry, true);
    setBusy(false, false);
    setMessage(message, kind || "error");
    render();
  }

  function showRecovery(message) {
    setHidden(els.retry, false);
    setBusy(false, true);
    setMessage(message, "error");
    if (els.retry && typeof els.retry.focus === "function") {
      window.setTimeout(function () { els.retry.focus(); }, 0);
    }
  }

  function showUnavailable(message) {
    checkoutUnavailable = true;
    currentOrder = null;
    reconciliationPromise = null;
    setHidden(els.loading, true);
    setHidden(els.live, true);
    setHidden(els.offline, false);
    setHidden(els.retry, true);
    setBusy(false, false);
    setMessage(message || "Online payment is unavailable. Please request a quote or call 201-244-6477.", "error");
    render();
  }

  function showSuccess(orderID, merchantReference) {
    var purchasedItems = currentOrder && Array.isArray(currentOrder.items) ? currentOrder.items.slice() : [];
    checkoutComplete = true;
    currentOrder = null;
    reconciliationPromise = null;
    checkoutBusy = false;
    cartLocked = true;
    clearPendingMarker(orderID);
    setHidden(els.retry, true);
    setMessage("");
    /* Remove only the quantities that this order purchased. This avoids
       discarding unrelated items added in another tab while PayPal was open. */
    if (purchasedItems.length) {
      var latestItems = cart.getItems();
      purchasedItems.forEach(function (purchased) {
        var latest = latestItems.find(function (item) { return item.sku === purchased.sku; });
        if (!latest || latest.qty <= purchased.qty) cart.remove(purchased.sku);
        else cart.setQty(purchased.sku, latest.qty - purchased.qty);
      });
    } else {
      cart.clear();
    }
    setHidden(els.layout, true);
    setHidden(els.empty, true);
    if (els.successOrderId) els.successOrderId.textContent = orderID;
    if (validMerchantReference(merchantReference)) {
      if (els.successMerchantReference) els.successMerchantReference.textContent = merchantReference;
      setHidden(els.successMerchantRow, false);
    }
    setHidden(els.success, false);
    applyControlState();
    if (els.success) {
      els.success.scrollIntoView({ block: "start" });
      if (typeof els.success.focus === "function") els.success.focus({ preventScroll: true });
    }
  }

  /* ----- Public config and backend preflight ------------------------- */

  function isLocalHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  }

  function validatePublicConfig() {
    if (config.checkoutMode === "off") return { enabled: false };
    if (config.checkoutMode !== "sandbox" && config.checkoutMode !== "live") return null;
    if (config.createEnabled !== true) return { enabled: false, creationDisabled: true };
    if (!config.checkoutEnabled) return null;
    if (config.apiVersion !== 1) return null;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.catalogVersion)) return null;
    if (config.currency !== "USD") return null;
    if (!isPositiveInteger(config.maxQtyPerLine) || !isPositiveInteger(config.maxLines)) return null;
    if (typeof config.paypalClientId !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(config.paypalClientId)) return null;

    var apiURL;
    try {
      apiURL = new URL(config.apiBase);
    } catch (error) {
      return null;
    }
    if (apiURL.username || apiURL.password || apiURL.search || apiURL.hash) return null;
    if (apiURL.pathname !== "/" || config.apiBase !== apiURL.origin) return null;

    var localSandbox = config.checkoutMode === "sandbox" && apiURL.protocol === "http:" && isLocalHost(apiURL.hostname);
    if (apiURL.protocol !== "https:" && !localSandbox) return null;
    if (config.checkoutMode === "live" && window.location.protocol !== "https:") return null;

    return { enabled: true };
  }

  function validateBackendConfig(data) {
    return isPlainObject(data) &&
      data.ok === true &&
      data.createEnabled === true &&
      data.apiVersion === config.apiVersion &&
      data.mode === config.checkoutMode &&
      data.currency === config.currency &&
      data.paypalClientId === config.paypalClientId &&
      data.catalogVersion === config.catalogVersion &&
      data.maxLines === config.maxLines &&
      data.maxQtyPerLine === config.maxQtyPerLine;
  }

  function apiError(message, properties) {
    var error = new Error(message);
    if (properties) Object.keys(properties).forEach(function (key) { error[key] = properties[key]; });
    return error;
  }

  function requestJson(path, options) {
    var requestOptions = options || {};
    var timeoutMs = requestOptions.timeoutMs || 12000;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timedOut = false;
    var timer = window.setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
    }, timeoutMs);

    var fetchOptions = {
      method: requestOptions.method || "GET",
      headers: { "Accept": "application/json" },
      credentials: "omit",
      cache: "no-store"
    };
    if (controller) fetchOptions.signal = controller.signal;
    if (Object.prototype.hasOwnProperty.call(requestOptions, "body")) {
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(requestOptions.body);
    }

    function clearRequestTimer() {
      window.clearTimeout(timer);
    }

    return fetch(config.apiBase + path, fetchOptions).then(function (response) {
      var contentType = response.headers && response.headers.get ? response.headers.get("content-type") : "";
      if (!contentType || contentType.toLowerCase().indexOf("application/json") === -1) {
        throw apiError("Invalid server response", { httpStatus: response.status, ambiguous: true });
      }
      return response.json().catch(function () {
        throw apiError("Invalid server response", { httpStatus: response.status, ambiguous: true });
      }).then(function (data) {
        if (!response.ok) {
          throw apiError("Checkout request failed", {
            httpStatus: response.status,
            code: isPlainObject(data) && typeof data.code === "string" ? data.code : "",
            retriable: Boolean(isPlainObject(data) && data.retriable === true),
            ambiguous: response.status >= 500,
            orderID: isPlainObject(data) && validOrderID(data.orderID) ? data.orderID : "",
            orderStatus: isPlainObject(data) && typeof data.status === "string" ? data.status : "",
            merchantReference: isPlainObject(data) && validMerchantReference(data.merchantReference)
              ? data.merchantReference
              : ""
          });
        }
        return data;
      });
    }).then(function (data) {
      clearRequestTimer();
      return data;
    }, function (error) {
      clearRequestTimer();
      if (timedOut || (error && error.name === "AbortError")) {
        throw apiError("Checkout request timed out", { timedOut: true, ambiguous: true });
      }
      if (error && typeof error.httpStatus === "number") throw error;
      throw apiError("Checkout network request failed", { network: true, ambiguous: true });
    });
  }

  function postJson(path, body, timeoutMs) {
    return requestJson(path, { method: "POST", body: body, timeoutMs: timeoutMs });
  }

  function preflightBackend() {
    return requestJson("/api/checkout/config", { timeoutMs: 8000 }).then(function (data) {
      if (!validateBackendConfig(data)) throw apiError("Checkout compatibility mismatch", { contractMismatch: true });
    });
  }

  /* ----- Order creation and capture reconciliation ------------------- */

  function checkoutSnapshot() {
    var items = cart.getItems().filter(function (item) {
      var entry = catalog[item.sku];
      return entry && entry.purchasable;
    }).map(function (item) {
      return { sku: item.sku, qty: item.qty };
    });

    var totalCents = items.reduce(function (sum, item) {
      return sum + (catalog[item.sku].priceCents * item.qty);
    }, 0);

    if (!items.length || items.length > config.maxLines || !Number.isSafeInteger(totalCents) || totalCents <= 0) return null;
    return { items: items, totalCents: totalCents };
  }

  function validOrderID(value) {
    return typeof value === "string" && /^[A-Za-z0-9-]{5,64}$/.test(value);
  }

  function validCheckoutToken(value) {
    return typeof value === "string" && value.length >= 20 && value.length <= 512 && !/\s/.test(value);
  }

  function validMerchantReference(value) {
    return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{4,79}$/.test(value);
  }

  function updateOrderMetadata(order, source) {
    if (!order || !source || (source.orderID && source.orderID !== order.orderID)) return;
    if (validMerchantReference(source.merchantReference)) {
      order.merchantReference = source.merchantReference;
      setOrderReference(order.orderID, order.merchantReference);
    }
  }

  function customerReference(order) {
    return order && validMerchantReference(order.merchantReference) ? order.merchantReference : order.orderID;
  }

  function createOrder() {
    var snapshot = checkoutSnapshot();
    if (!snapshot) {
      throw apiError("Cart is not eligible for checkout", { safeToRetry: true });
    }

    setMessage("Preparing your PayPal order…");
    return postJson("/api/checkout/order", { items: snapshot.items }, 15000).then(function (data) {
      var orderID = isPlainObject(data) && validOrderID(data.id) ? data.id : "";
      var merchantReference = isPlainObject(data) && validMerchantReference(data.merchantReference)
        ? data.merchantReference
        : "";
      if (orderID) setOrderReference(orderID, merchantReference);

      var contractMatches = isPlainObject(data) &&
        orderID &&
        validCheckoutToken(data.checkoutToken) &&
        merchantReference &&
        data.currency === config.currency &&
        Number.isSafeInteger(data.totalCents) &&
        data.totalCents === snapshot.totalCents &&
        data.catalogVersion === config.catalogVersion;

      if (!contractMatches) {
        showUnavailable("Checkout was stopped because the order details could not be verified. Please request a quote.");
        throw apiError("Order response did not match the cart", {
          contractMismatch: true,
          orderID: orderID
        });
      }

      currentOrder = {
        orderID: orderID,
        checkoutToken: data.checkoutToken,
        merchantReference: merchantReference,
        totalCents: snapshot.totalCents,
        items: snapshot.items.slice(),
        captureAttempts: 0
      };
      setMessage("Order " + merchantReference + " is ready for PayPal approval.");
      return orderID;
    });
  }

  function orderRequestBody(order) {
    return { orderID: order.orderID, checkoutToken: order.checkoutToken };
  }

  function completedResponseMatches(data, order) {
    if (!isPlainObject(data) || data.orderID !== order.orderID) return false;
    updateOrderMetadata(order, data);
    return data.status === "COMPLETED";
  }

  function handleKnownNonterminalStatus(status) {
    if (!currentOrder) return;
    var orderID = currentOrder.orderID;
    var supportReference = customerReference(currentOrder);

    if (status === "CREATED") {
      releaseForAnotherAttempt(
        "PayPal did not report order " + supportReference + " as approved. You can try checkout again or request a quote.",
        "warning",
        true
      );
      return;
    }

    showRecovery(
      "Payment status for order " + supportReference + " is not confirmed. Do not start another payment. " +
      "Check this payment status again or call 201-244-6477 with the reference above."
    );
  }

  function reconcileCurrentOrder(allowCaptureRetry) {
    if (!currentOrder) return Promise.resolve();
    if (reconciliationPromise) return reconciliationPromise;

    var order = currentOrder;
    setBusy(true, true);
    setMessage("Checking payment status for order " + customerReference(order) + "…");

    reconciliationPromise = postJson("/api/checkout/status", orderRequestBody(order), 12000).then(function (result) {
      if (completedResponseMatches(result, order)) {
        showSuccess(order.orderID, order.merchantReference);
        return;
      }
      if (!isPlainObject(result) || result.orderID !== order.orderID || typeof result.status !== "string") {
        throw apiError("Malformed order status", { ambiguous: true });
      }
      updateOrderMetadata(order, result);
      if (result.status === "APPROVED" && allowCaptureRetry) {
        setMessage("Order " + customerReference(order) + " is approved. Retrying confirmation for this same reference…");
        reconciliationPromise = null;
        return captureCurrentOrder(false);
      }
      if (result.status === "APPROVED") {
        showRecovery(
          "Order " + customerReference(order) + " is approved, but final payment is not confirmed. " +
          "Do not start another payment; check this same reference again."
        );
        return;
      }
      handleKnownNonterminalStatus(result.status);
    }).catch(function (error) {
      if (checkoutComplete) return;
      updateOrderMetadata(order, error);
      showRecovery(
        "Payment status for order " + customerReference(order) + " is not confirmed. Do not start another payment. " +
        "Check this payment status again or call 201-244-6477 with the reference above."
      );
    }).then(function (value) {
      reconciliationPromise = null;
      return value;
    }, function (error) {
      reconciliationPromise = null;
      throw error;
    });

    return reconciliationPromise;
  }

  function captureCurrentOrder(allowAutomaticRetry) {
    if (!currentOrder) return Promise.resolve();
    var order = currentOrder;
    if (!writePendingMarker(order)) {
      showRecovery(
        "Order " + customerReference(order) + " is approved, but this browser could not establish a safe recovery record. " +
        "Do not start another payment; call 201-244-6477 with the reference above."
      );
      return Promise.resolve();
    }
    order.captureAttempts += 1;
    setBusy(true, true);
    setMessage("Confirming payment for order " + customerReference(order) + "…");

    return postJson("/api/checkout/capture", orderRequestBody(order), 20000).then(function (result) {
      if (completedResponseMatches(result, order)) {
        showSuccess(order.orderID, order.merchantReference);
        return;
      }
      updateOrderMetadata(order, result);
      return reconcileCurrentOrder(Boolean(allowAutomaticRetry));
    }).catch(function (error) {
      if (checkoutComplete) return;
      updateOrderMetadata(order, error);
      if (error && error.retriable && error.code === "INSTRUMENT_DECLINED") {
        releaseForAnotherAttempt(
          "PayPal declined that payment method for order " + customerReference(order) + ". Choose another method and try again.",
          "error",
          true
        );
        return;
      }
      return reconcileCurrentOrder(Boolean(allowAutomaticRetry));
    });
  }

  function handleApprove(data) {
    var approvedID = isPlainObject(data) && typeof data.orderId === "string" ? data.orderId : "";
    if (!currentOrder || approvedID !== currentOrder.orderID) {
      if (currentOrder) {
        writePendingMarker(currentOrder);
        showRecovery(
          "PayPal returned an unexpected order reference. Do not retry payment. Call 201-244-6477 with " +
          currentOrder.orderID + "."
        );
      } else {
        showUnavailable("The PayPal order could not be verified. Please request a quote or call 201-244-6477.");
      }
      return Promise.resolve();
    }
    return captureCurrentOrder(true);
  }

  function handleCancel() {
    var orderID = currentOrder ? currentOrder.orderID : "";
    currentOrder = null;
    reconciliationPromise = null;
    setHidden(els.retry, true);
    setBusy(false, false);
    setMessage(
      orderID ? "Checkout canceled for order " + orderID + ". Your cart is unchanged." : "Checkout canceled. Your cart is unchanged."
    );
    render();
  }

  function handleSessionError() {
    if (checkoutComplete || checkoutUnavailable) return Promise.resolve();
    if (currentOrder) {
      if (!writePendingMarker(currentOrder)) {
        showRecovery(
          "Payment status for order " + customerReference(currentOrder) + " could not be safely preserved. " +
          "Do not start another payment; call 201-244-6477 with the reference above."
        );
        return Promise.resolve();
      }
      return reconcileCurrentOrder(true);
    }
    setBusy(false, false);
    setMessage("PayPal checkout could not start. Please try again or request a quote.", "error");
    render();
    return Promise.resolve();
  }

  /* ----- PayPal Web SDK v6 ------------------------------------------- */

  function loadPayPalSDK() {
    var expectedSource = config.checkoutMode === "sandbox"
      ? "https://www.sandbox.paypal.com/web-sdk/v6/core"
      : "https://www.paypal.com/web-sdk/v6/core";
    var existing = document.querySelector('script[src*="paypal.com/"]');
    if (existing) {
      if (existing.src !== expectedSource) return Promise.reject(apiError("Unexpected PayPal SDK source"));
      if (window.paypal && typeof window.paypal.createInstance === "function") return Promise.resolve();
      return Promise.reject(apiError("PayPal SDK already present but unavailable"));
    }

    return new Promise(function (resolve, reject) {
      var settled = false;
      var script = document.createElement("script");
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        script.remove();
        reject(apiError("PayPal SDK load timed out"));
      }, 15000);

      script.src = expectedSource;
      script.async = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
      script.setAttribute("data-dtc-paypal-sdk", "v6");
      script.onload = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (window.paypal && typeof window.paypal.createInstance === "function") resolve();
        else reject(apiError("PayPal SDK did not initialize"));
      };
      script.onerror = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(apiError("PayPal SDK could not load"));
      };
      document.head.appendChild(script);
    });
  }

  function configurePayPal() {
    return window.paypal.createInstance({
      clientId: config.paypalClientId,
      components: ["paypal-payments"],
      pageType: "checkout"
    }).then(function (sdkInstance) {
      return sdkInstance.findEligibleMethods({ currencyCode: config.currency }).then(function (methods) {
        if (!methods || typeof methods.isEligible !== "function" || !methods.isEligible("paypal")) {
          throw apiError("PayPal is not eligible for this buyer");
        }

        paymentSession = sdkInstance.createPayPalOneTimePaymentSession({
          onApprove: handleApprove,
          onCancel: handleCancel,
          onError: handleSessionError
        });
        if (!paymentSession || typeof paymentSession.start !== "function") {
          throw apiError("PayPal payment session unavailable");
        }

        els.paypalButton.addEventListener("click", function () {
          if (checkoutBusy || cartLocked || checkoutUnavailable || checkoutComplete) return;
          setHidden(els.retry, true);
          setBusy(true, true);
          setMessage("Opening secure PayPal checkout…");

          var orderPromise;
          try {
            orderPromise = createOrder();
          } catch (error) {
            handleSessionError(error);
            return;
          }

          paymentSession.start({ presentationMode: "auto" }, orderPromise).catch(function (error) {
            if (checkoutUnavailable) return;
            if (error && error.contractMismatch) {
              showUnavailable("Checkout was stopped because the order details could not be verified. Please request a quote.");
              return;
            }
            return handleSessionError(error);
          });
        });

        setHidden(els.loading, true);
        setHidden(els.paypalButton, false);
        setBusy(false, false);
        setMessage(config.checkoutMode === "sandbox" ? "Sandbox checkout is ready for testing." : "Secure checkout is ready.");
      });
    });
  }

  function initCheckout() {
    var pendingMarker = readPendingMarker();
    if (pendingMarker) {
      checkoutUnavailable = true;
      setOrderReference(pendingMarker.orderID, pendingMarker.merchantReference);
      setHidden(els.loading, true);
      setHidden(els.live, true);
      setHidden(els.offline, false);
      setHidden(els.retry, true);
      setBusy(false, true);
      setMessage(
        "Payment status for order " + pendingMarker.merchantReference + " still needs verification. " +
        "Do not start another payment. Call 201-244-6477 with the references above.",
        "error"
      );
      return;
    }

    var publicConfig = validatePublicConfig();
    if (publicConfig && publicConfig.enabled === false) {
      /* Committed default/kill switch: do not preflight or load external code. */
      if (publicConfig.creationDisabled) {
        setMessage("Online payment remains disabled while checkout is being prepared. Please request a quote.", "warning");
      }
      return;
    }
    if (!publicConfig) {
      showUnavailable("Online payment configuration is incomplete. Please request a quote or call 201-244-6477.");
      return;
    }

    setHidden(els.offline, true);
    setHidden(els.live, false);
    setHidden(els.sandbox, config.checkoutMode !== "sandbox");
    setHidden(els.loading, false);
    setHidden(els.paypalButton, true);
    setBusy(true, false);
    setMessage("Checking secure checkout availability…");

    preflightBackend()
      .then(loadPayPalSDK)
      .then(configurePayPal)
      .catch(function () {
        showUnavailable("Secure online payment is unavailable. Please request a quote or call 201-244-6477.");
      });
  }

  if (els.retry) {
    els.retry.addEventListener("click", function () {
      if (!currentOrder || checkoutBusy || checkoutComplete) return;
      reconcileCurrentOrder(true);
    });
  }

  initCheckout();
})();
