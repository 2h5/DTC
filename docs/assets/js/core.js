/* Shared behavior for every page: header scroll shadow, mobile nav,
   current year, smooth in-page anchors, scroll-triggered reveal. Loaded
   before any assets/js/pages/*.js file. */
(function () {
  var header = document.querySelector('.site-header');
  var toggleScrolled = function () {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 4);
  };
  toggleScrolled();
  window.addEventListener('scroll', toggleScrolled, { passive: true });

  var navToggle = document.querySelector('.nav-toggle');
  var mobileNav = document.querySelector('.mobile-nav');
  var mobileClose = document.querySelector('.mobile-nav-close');

  function openMobileNav() {
    mobileNav.classList.add('is-open');
    if (navToggle) navToggle.classList.add('is-open');
    document.body.classList.add('nav-locked');
  }
  function closeMobileNav() {
    mobileNav.classList.remove('is-open');
    if (navToggle) navToggle.classList.remove('is-open');
    document.body.classList.remove('nav-locked');
  }
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', function () {
      if (mobileNav.classList.contains('is-open')) closeMobileNav();
      else openMobileNav();
    });
  }
  if (mobileClose) {
    mobileClose.addEventListener('click', closeMobileNav);
  }

  document.querySelectorAll('.mobile-nav-group > button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var group = btn.closest('.mobile-nav-group');
      var wasOpen = group.classList.contains('is-open');
      document.querySelectorAll('.mobile-nav-group').forEach(function (g) {
        g.classList.remove('is-open');
      });
      if (!wasOpen) group.classList.add('is-open');
    });
  });

  var yearEl = document.querySelector('[data-current-year]');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Nav search: the icon (or, on the home page, the hero's "Search for
     Parts" button) morphs the whole nav row into a full-width search bar
     (brand/links/CTA fade out via .search-active on .site-header, see
     site-chrome.css). The input itself is wired up separately by
     assets/js/search.js, same as any other search box on the page. */
  var navSearchToggle = document.querySelector('.nav-search-toggle');
  var navSearchClose = document.querySelector('.nav-search-close');
  var navSearchInput = document.querySelector('.nav-search input');
  var heroSearchCta = document.querySelector('.hero-search-cta');

  if (header && navSearchToggle) {
    var openNavSearch = function () {
      header.classList.add('search-active');
      navSearchToggle.setAttribute('aria-expanded', 'true');
      /* Focusing immediately can lose to the opening transition (the input
         is still visibility:hidden mid-frame), landing focus back on the
         page instead - defer a couple of frames so the bar has actually
         painted visible before we try. */
      if (navSearchInput) {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () { navSearchInput.focus(); });
        });
      }
    };
    var closeNavSearch = function () {
      header.classList.remove('search-active');
      navSearchToggle.setAttribute('aria-expanded', 'false');
      if (navSearchInput) navSearchInput.value = '';
    };

    navSearchToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      openNavSearch();
    });
    if (navSearchClose) navSearchClose.addEventListener('click', closeNavSearch);

    document.addEventListener('click', function (e) {
      if (header.classList.contains('search-active') && !header.contains(e.target)) closeNavSearch();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('search-active')) closeNavSearch();
    });

    /* The hero CTA is a trigger only, it has no search state of its own.
       Since the button lives mid-page and the bar it opens is up in the
       header, a plain open is easy to miss - flash the header with the
       accent color the instant it opens so the eye gets pulled up there. */
    if (heroSearchCta) {
      heroSearchCta.addEventListener('click', function (e) {
        e.stopPropagation();
        openNavSearch();
        if (!prefersReduced) {
          header.classList.remove('search-flash');
          void header.offsetWidth; /* restart the animation if clicked again quickly */
          header.classList.add('search-flash');
        }
      });
    }
  }

  /* In-page anchor links (e.g. the skip link) scroll smoothly via JS. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  });

  /* Scroll-triggered reveal */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if (prefersReduced || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      revealEls.forEach(function (el) { io.observe(el); });
    }
  }
})();
