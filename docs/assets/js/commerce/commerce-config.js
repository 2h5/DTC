/* Public commerce configuration. Loaded before the other commerce scripts.

   SECURITY BOUNDARY
   -----------------
   Every value in this file is public. Never place a PayPal secret, access
   token, webhook id or any other credential under docs/. Prices here and in
   commerce-catalog.js are display copies only; the backend remains the sole
   authority for every amount that can be charged.

   Checkout is an explicit three-state switch:
     - "off"     No backend request and no PayPal script load. This is the
                 committed scaffolding default.
     - "sandbox" A sandbox backend and the sandbox Web SDK v6 must agree with
                 every public compatibility value below.
     - "live"    A live backend and the live Web SDK v6 must agree likewise.

   Merely filling in a URL or client id cannot enable payments. Before loading
   PayPal, checkout.js validates this object and verifies the deployed backend
   with GET /api/checkout/config. Any missing or mismatched value fails closed.
*/
(function () {
  var config = {
    /* Keep "off" until a backend and PayPal sandbox app both exist. */
    checkoutMode: "off",

    /* Independent emergency/rollout gate. This must be explicitly true in
       both this file and the backend preflight before order creation or SDK
       loading is allowed. Keep false throughout scaffolding. */
    createEnabled: false,

    /* Exact HTTPS origin of the deployed checkout backend, with no path or
       trailing slash. An HTTP localhost origin is accepted in sandbox only. */
    apiBase: "",

    /* Public PayPal REST client id. The client secret stays server-side. */
    paypalClientId: "",

    /* Public compatibility contract. These must exactly match the backend's
       /api/checkout/config response before the PayPal SDK can load. */
    apiVersion: 1,
    catalogVersion: "2026-07-19.1",
    currency: "USD",
    maxQtyPerLine: 99,
    maxLines: 20
  };

  /* Compatibility flag for existing page code. checkout.js still performs
     strict URL, mode and backend checks; this flag alone never enables SDK
     loading or payment. */
  config.checkoutEnabled = Boolean(
    (config.checkoutMode === "sandbox" || config.checkoutMode === "live") &&
    config.createEnabled === true &&
    config.apiBase &&
    config.paypalClientId
  );

  if (typeof Object.freeze === "function") Object.freeze(config);
  window.DTC_COMMERCE_CONFIG = config;
})();
