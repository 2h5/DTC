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

  /* Submenu open/close is driven by an inline max-height set to the
     submenu's real scrollHeight, not the flat 480px in site-chrome.css.
     That flat value made the CSS transition run its full 0.4s across
     0-480px regardless of actual content height, so short submenus
     (About: 3 links, Services: 6, Contact: 2) reached their real height
     almost instantly and looked like they "snapped" open with no visible
     animation, while Parts Shop (11 links, close to 480px) looked fine.
     Closing looked fine for all of them only because collapsing away is
     forgiving to a snap at the very end. Measuring scrollHeight makes the
     transition duration proportional to each submenu's real height, both
     ways. The static 480px rule stays in the CSS as a no-JS fallback. */
  document.querySelectorAll('.mobile-nav-group > button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var group = btn.closest('.mobile-nav-group');
      var wasOpen = group.classList.contains('is-open');
      document.querySelectorAll('.mobile-nav-group').forEach(function (g) {
        g.classList.remove('is-open');
        var sub = g.querySelector('.mobile-submenu');
        if (sub) sub.style.maxHeight = '';
      });
      if (!wasOpen) {
        group.classList.add('is-open');
        var submenu = group.querySelector('.mobile-submenu');
        if (submenu) submenu.style.maxHeight = submenu.scrollHeight + 'px';
      }
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
    /* .nav-search used to be hidden via visibility:hidden while closed,
       which also had the side effect of keeping it out of the tab order.
       It's now hidden with opacity/pointer-events only (see site-chrome.css)
       so that a synchronous focus() call in the click handler below still
       works - mobile browsers only raise the on-screen keyboard when focus()
       runs inside the same synchronous call stack as the user gesture that
       triggered it, and deferring even by one requestAnimationFrame breaks
       that chain (this is also why the old visibility:hidden approach could
       never work here: focusing a still-hidden element is a no-op, so it had
       to be deferred past the transition, which is exactly what mobile
       doesn't allow). Tab-order exclusion while closed is restored manually
       via tabindex instead. */
    if (navSearchInput) navSearchInput.setAttribute('tabindex', '-1');

    var openNavSearch = function () {
      header.classList.add('search-active');
      navSearchToggle.setAttribute('aria-expanded', 'true');
      if (navSearchInput) {
        navSearchInput.removeAttribute('tabindex');
        navSearchInput.focus();
      }
    };
    var closeNavSearch = function () {
      header.classList.remove('search-active');
      navSearchToggle.setAttribute('aria-expanded', 'false');
      if (navSearchInput) {
        navSearchInput.blur();
        navSearchInput.value = '';
        navSearchInput.setAttribute('tabindex', '-1');
      }
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

  /* FAQ accordion (.faq-item, shared by any product page's FAQ tab):
     native <details>/<summary> can't transition its own open/close (the
     browser toggles display:none instantly), so this intercepts the click
     and animates the inner .faq-body's max-height instead, only touching
     the `open` attribute at the start/end of that transition. Same
     scrollHeight-before-transition technique as the mobile submenu above.
     Falls back to the native instant toggle under reduced motion.
     Skipped on the dedicated FAQs page (identified by .faq-section, present
     in the DOM by the time this runs unlike its own <script> tag further
     down the page): assets/js/pages/faqs.js binds its own (different)
     accordion there, and having both attach a click listener to the same
     <summary> fought over the `open` attribute and made the panels snap
     instead of animate. */
  if (!document.querySelector('.faq-section')) {
  document.querySelectorAll('.faq-item > summary').forEach(function (summary) {
    var details = summary.parentElement;
    var body = details.querySelector('.faq-body');
    if (!body) return;
    summary.addEventListener('click', function (e) {
      e.preventDefault();
      if (prefersReduced) {
        details.open = !details.open;
        return;
      }
      if (details.hasAttribute('open')) {
        body.style.maxHeight = body.scrollHeight + 'px';
        requestAnimationFrame(function () { body.style.maxHeight = '0px'; });
        body.addEventListener('transitionend', function handler(ev) {
          if (ev.propertyName !== 'max-height') return;
          details.removeAttribute('open');
          body.style.maxHeight = '';
          body.removeEventListener('transitionend', handler);
        });
      } else {
        details.setAttribute('open', '');
        body.style.maxHeight = '0px';
        requestAnimationFrame(function () { body.style.maxHeight = body.scrollHeight + 'px'; });
        body.addEventListener('transitionend', function handler(ev) {
          if (ev.propertyName !== 'max-height') return;
          body.style.maxHeight = '';
          body.removeEventListener('transitionend', handler);
        });
      }
    });
  });
  }

  /* Scroll-triggered reveal */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if (prefersReduced || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      /* rootMargin extends the viewport 200px past its actual bottom edge
         for intersection purposes, so a section starts fading in while it's
         still up to 200px below the visible screen instead of only once
         the user has already scrolled 15% of its height into view. That
         15%-of-actual-viewport threshold is what made sections directly
         below a tall mobile hero (GE Boards & Turbine Control's tile grid,
         every series listing's part grid) read as a blank page until the
         user scrolled specifically to them - the section was there, just
         still sitting at opacity:0 waiting to cross the old threshold. */
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0, rootMargin: '0px 0px 200px 0px' }
      );
      revealEls.forEach(function (el) { io.observe(el); });
    }
  }
})();
