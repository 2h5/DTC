/* Display catalog for the cart UI. Keyed by SKU (the part number as printed
   on the product page). Paths are relative to the docs/ root; cart-ui.js and
   checkout.js prefix them with the page's base path (derived from the core.js
   script src, same trick as search.js).

   DISPLAY ONLY — this file has no pricing authority. The deployed backend
   holds the canonical copy in server/catalog.json and recomputes every
   charge from it. If the two files disagree, the customer sees one number
   and is charged another, so treat them as a pair: any price/SKU change
   here must be mirrored there (COMMERCE-SETUP.md has the checklist).

   priceCents is an integer (US cents) to keep all client-side arithmetic
   float-free. `purchasable: false` keeps a part visible in the cart flow
   as quote-only if it ever lands in a stored cart, without letting it
   reach checkout.

   Only parts with a real published estimate belong here. Do not invent
   prices for the rest of the catalog; add entries as DTC confirms them. */
(function () {
  window.DTC_CATALOG = {
    "259B2451BVP4": {
      sku: "259B2451BVP4",
      title: "259B2451BVP4",
      desc: "ESWA 8P / ESWB 16P universal DIN rail adapter bracket. Zinc, blue RoHS finish.",
      series: "Mark 1 & II · GE Boards & Turbine Control",
      priceCents: 124000,
      image: "assets/img/parts/259b2451bvp4.jpg",
      url: "parts/259b2451bvp4.html",
      purchasable: true
    }
  };
})();
