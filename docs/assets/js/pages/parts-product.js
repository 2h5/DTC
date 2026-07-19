/* Product detail page only: hover-to-zoom on the gallery image, thumbnail
   switching, the info-panel tabs, placeholder purchase-action toasts, and
   the "You May Also Like" carousel's arrow buttons. */
(function () {
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Tabs: Specifications / Shipping & Returns / Reviews / FAQ. Plain
     click-to-swap, no animation library, matches every other toggle on
     this site (mobile submenu, nav search). */
  var tabTriggers = document.querySelectorAll('[data-tab-trigger]');
  var tabPanels = document.querySelectorAll('[data-tab-panel]');
  var activateTab = function (name) {
    tabTriggers.forEach(function (trigger) {
      var isMatch = trigger.getAttribute('data-tab-trigger') === name;
      trigger.classList.toggle('is-active', isMatch);
      trigger.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    tabPanels.forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-tab-panel') !== name;
    });
  };
  tabTriggers.forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      activateTab(trigger.getAttribute('data-tab-trigger'));
    });
  });

  /* "Write a review" under the star row jumps to and opens the Reviews
     tab, same target any future data-scroll-tab trigger can reuse. */
  document.querySelectorAll('[data-scroll-tab]').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-scroll-tab');
      activateTab(name);
      var panel = document.querySelector('[data-tab-panel="' + name + '"]');
      if (panel) panel.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    });
  });

  /* Add to Cart / Buy It Now are real now — they carry data-cart-add /
     data-cart-buy-now and are owned by assets/js/commerce/cart-ui.js, so
     this placeholder handler must never bind to them (both handlers on
     one button would double-fire). It still owns the actions that have no
     backend: Make an Offer and Write a Review, which surface an inline
     note pointing at the real path instead of doing nothing. */
  /* Each placeholder button shows the toast nearest to it (the page has
     two: one under the hero's purchase actions, one in the Reviews tab),
     so the note always appears next to what the visitor just clicked
     instead of possibly off-screen. */
  var toastTimers = new WeakMap();
  var toastMessages = {
    cart: "Online ordering isn't live for this part yet. Use Request a Quote or Request Repair below and our team will follow up.",
    offer: "Offers aren't automated yet. Call 201-244-6477 or use Request a Quote below and an engineer will work the price with you.",
    review: "Reviews aren't open yet. Call or email us and we'll follow up about your experience with this part."
  };
  document.querySelectorAll('[data-placeholder-action]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var scope = btn.closest('.product-info, .tab-panel') || document;
      var toast = scope.querySelector('[data-cart-toast]');
      if (!toast) return;
      var kind = btn.getAttribute('data-placeholder-action') || 'cart';
      toast.textContent = toastMessages[kind] || toastMessages.cart;
      toast.classList.add('is-visible');
      window.clearTimeout(toastTimers.get(toast));
      toastTimers.set(toast, window.setTimeout(function () {
        toast.classList.remove('is-visible');
      }, 5000));
    });
  });

  /* Hover zoom: scale the image up and slide its transform-origin to follow
     the cursor, so the area under the pointer is what magnifies. Skipped
     under reduced-motion; naturally inert on touch since there's no
     mousemove, so no separate touch handling is needed. */
  var galleryMain = document.querySelector('.gallery-main');
  if (galleryMain && !prefersReduced) {
    var galleryImg = galleryMain.querySelector('img');
    galleryMain.addEventListener('mousemove', function (e) {
      var rect = galleryMain.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      galleryImg.style.transformOrigin = x + '% ' + y + '%';
    });
    galleryMain.addEventListener('mouseenter', function () {
      galleryMain.classList.add('is-zoomed');
    });
    galleryMain.addEventListener('mouseleave', function () {
      galleryMain.classList.remove('is-zoomed');
      galleryImg.style.transformOrigin = '';
    });
  }

  /* Thumbnail rail: swaps the main image's src, no-op when a product only
     has one photo (no .gallery-thumb elements rendered). */
  var thumbs = document.querySelectorAll('.gallery-thumb');
  if (thumbs.length && galleryMain) {
    var mainImg = galleryMain.querySelector('img');
    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        var full = thumb.getAttribute('data-full');
        var alt = thumb.getAttribute('data-alt');
        if (full) mainImg.src = full;
        if (alt) mainImg.alt = alt;
        thumbs.forEach(function (t) { t.classList.remove('is-active'); });
        thumb.classList.add('is-active');
      });
    });
  }

  /* "You May Also Like" carousel: plain scroll-snap track, arrows just
     scroll it by one card width and disable at each end. */
  var track = document.querySelector('.also-like-track');
  var prevBtn = document.querySelector('[data-carousel-prev]');
  var nextBtn = document.querySelector('[data-carousel-next]');
  if (track && (prevBtn || nextBtn)) {
    var step = function () {
      var card = track.querySelector('.part-card');
      return card ? card.getBoundingClientRect().width + 18 : track.clientWidth;
    };
    var updateNav = function () {
      var maxScroll = track.scrollWidth - track.clientWidth - 2;
      if (prevBtn) prevBtn.disabled = track.scrollLeft <= 0;
      if (nextBtn) nextBtn.disabled = track.scrollLeft >= maxScroll;
    };
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        track.scrollBy({ left: -step(), behavior: prefersReduced ? 'auto' : 'smooth' });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        track.scrollBy({ left: step(), behavior: prefersReduced ? 'auto' : 'smooth' });
      });
    }
    track.addEventListener('scroll', updateNav, { passive: true });
    updateNav();
  }
})();
