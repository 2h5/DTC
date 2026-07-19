/* Public commerce configuration. Loaded (before the other commerce scripts)
   on every page that participates in cart/checkout.

   SECURITY MODEL — read before editing:
   Everything in this file ships to every visitor's browser. Only values that
   are safe to publish may ever live here:

     - apiBase        The https origin of the DTC checkout backend (the
                      server/ app in this repo, once deployed). An empty
                      string means "no backend yet": the cart still works,
                      but checkout renders as a request-a-quote notice
                      instead of a PayPal button.
     - paypalClientId The PayPal REST *client id*. This value is public by
                      design (PayPal embeds it in the browser SDK URL for
                      every merchant on the internet). It can only be used
                      to render buttons and start an order — it cannot move
                      money. An empty string disables the PayPal button.

   NEVER put any of the following here or anywhere else under docs/:
     - the PayPal client SECRET (server/.env only),
     - webhook ids, API tokens, credentials of any kind,
     - prices you expect to be enforced. Prices in the browser are display
       copies; the deployed backend recomputes every charge from its own
       catalog (server/catalog.json) and ignores client-sent amounts.

   GO-LIVE is intentionally just two edits here (see COMMERCE-SETUP.md):
     1. apiBase        = "https://<your-deployed-backend>"
     2. paypalClientId = "<live client id from the PayPal developer portal>"
*/
(function () {
  window.DTC_COMMERCE_CONFIG = {
    /* "" until the server/ app is deployed. No trailing slash. */
    apiBase: "",

    /* "" until the PayPal Business app exists. Use the sandbox client id
       while testing, swap to the live one at launch. */
    paypalClientId: "",

    /* Fixed storewide. The backend enforces its own currency; this only
       controls display formatting and the PayPal SDK locale hint. */
    currency: "USD",

    /* Hard client-side caps. The backend enforces the same caps again —
       these exist so the UI never builds a request the server would
       reject anyway. */
    maxQtyPerLine: 99,
    maxLines: 20
  };

  /* Checkout is live only when both halves exist. Derived, not hand-set,
     so a half-configured deploy fails closed (quote notice, no button). */
  window.DTC_COMMERCE_CONFIG.checkoutEnabled = Boolean(
    window.DTC_COMMERCE_CONFIG.apiBase && window.DTC_COMMERCE_CONFIG.paypalClientId
  );
})();
