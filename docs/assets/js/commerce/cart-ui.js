/* Cart UI layer for any page that loads the commerce scripts: injects the
   header cart button (with live count badge) into the nav row, and wires
   [data-cart-add] / [data-cart-buy-now] buttons on product pages.

   The header button is injected by JS instead of edited into every HTML
   file so commerce can roll out page-by-page: any page that adds the
   commerce script tags gets the cart entry point for free, pages without
   them are untouched. All DOM the cart writes is built with
   createElement/textContent — no innerHTML — so nothing that ever passed
   through localStorage can execute as markup. Requires commerce-config.js,
   commerce-catalog.js and cart.js first. */
(function () {
  var cart = window.DTC_CART;
  var catalog = window.DTC_CATALOG;
  if (!cart || !catalog) return;

  /* Same base-path derivation as search.js: works from docs/ root pages
     (cart.html) and nested ones (parts/*.html) alike. */
  var coreScript = document.querySelector('script[src$="assets/js/core.js"]');
  var basePath = coreScript ? coreScript.getAttribute("src").replace(/assets\/js\/core\.js$/, "") : "";
  var cartUrl = basePath + "cart.html";

  /* ----- Header cart button ----------------------------------------- */

  function buildNavCart() {
    var searchToggle = document.querySelector(".nav-search-toggle");
    if (!searchToggle || document.querySelector(".nav-cart")) return null;

    var link = document.createElement("a");
    link.className = "nav-cart";
    link.href = cartUrl;

    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", "M3 4h2l2.4 12.4a2 2 0 002 1.6h8.6a2 2 0 002-1.8L21 8H6");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    [[10, 20], [17, 20]].forEach(function (c) {
      var circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", c[0]);
      circle.setAttribute("cy", c[1]);
      circle.setAttribute("r", "1.4");
      circle.setAttribute("stroke", "currentColor");
      circle.setAttribute("stroke-width", "1.6");
      svg.appendChild(circle);
    });
    link.appendChild(svg);

    var badge = document.createElement("span");
    badge.className = "nav-cart-count";
    badge.setAttribute("aria-hidden", "true");
    link.appendChild(badge);

    /* Between the search toggle and the CTA/hamburger, so the shared
       margin-left:auto on .nav-search-toggle keeps docking the whole
       right-hand cluster together below 1160px. */
    searchToggle.insertAdjacentElement("afterend", link);
    return link;
  }

  var navCart = buildNavCart();

  function refreshNavCart() {
    if (!navCart) return;
    var count = cart.getCount();
    var badge = navCart.querySelector(".nav-cart-count");
    badge.textContent = count > 99 ? "99+" : String(count);
    navCart.classList.toggle("has-items", count > 0);
    navCart.setAttribute("aria-label",
      count === 1 ? "Cart, 1 item" : "Cart, " + count + " items");
    navCart.setAttribute("title", "Cart");
  }

  refreshNavCart();
  document.addEventListener("dtc:cartchange", refreshNavCart);

  /* ----- Product page purchase actions -------------------------------- */

  var toastTimers = new WeakMap();

  /* Confirmation reuses the page's existing .cart-toast element nearest
     the clicked button (same scoping as the old placeholder handler). */
  function showAddedToast(button, sku) {
    var scope = button.closest(".product-info, .tab-panel") || document;
    var toast = scope.querySelector("[data-cart-toast]");
    if (!toast) return;

    toast.textContent = "";
    var text = document.createElement("span");
    text.textContent = sku + " added to your cart. ";
    var link = document.createElement("a");
    link.href = cartUrl;
    link.textContent = "View Cart";
    toast.appendChild(text);
    toast.appendChild(link);

    toast.classList.add("is-visible");
    window.clearTimeout(toastTimers.get(toast));
    toastTimers.set(toast, window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 6000));
  }

  document.querySelectorAll("[data-cart-add]").forEach(function (button) {
    button.addEventListener("click", function () {
      var sku = button.getAttribute("data-cart-add");
      if (cart.add(sku, 1)) showAddedToast(button, sku);
    });
  });

  document.querySelectorAll("[data-cart-buy-now]").forEach(function (button) {
    button.addEventListener("click", function () {
      var sku = button.getAttribute("data-cart-buy-now");
      /* Ensure at least one in the cart without inflating an existing
         quantity, then hand off to the cart page to finish. */
      var inCart = cart.getItems().some(function (item) { return item.sku === sku; });
      if (!inCart && !cart.add(sku, 1)) return;
      window.location.href = cartUrl;
    });
  });
})();
