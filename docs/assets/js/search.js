/* Live search-as-you-type for every `.search-pill` (Parts Shop, brand pages)
   and the `.nav-search` bar in the site header (the home hero search is a
   plain CTA now, see home.css/core.js, it has no input of its own).
   Reads the shared index from search-data.js and renders a results dropdown
   under the input, no submit click needed. No-ops if the page has neither
   box or the index failed to load. */
(function () {
  var index = window.DTC_SEARCH_INDEX;
  var forms = Array.prototype.slice.call(document.querySelectorAll('.search-pill, .nav-search'));
  if (!index || !forms.length) return;

  var coreScript = document.querySelector('script[src$="assets/js/core.js"]');
  var basePath = coreScript ? coreScript.getAttribute('src').replace(/assets\/js\/core\.js$/, '') : '';

  var TYPE_LABEL = { brand: 'Brand', series: 'Series', part: 'Part' };

  function normalize(s) { return (s || '').toLowerCase(); }

  function score(entry, q) {
    var title = normalize(entry.title);
    if (title === q) return 100;
    if (title.indexOf(q) === 0) return 90;
    var hay = normalize(entry.title + ' ' + (entry.subtitle || '') + ' ' + (entry.keywords || ''));
    if (hay.indexOf(q) !== -1) return 50;
    return -1;
  }

  function search(q) {
    return index
      .map(function (entry) { return { entry: entry, score: score(entry, q) }; })
      .filter(function (r) { return r.score > -1; })
      .sort(function (a, b) { return b.score - a.score || a.entry.title.localeCompare(b.entry.title); })
      .slice(0, 8)
      .map(function (r) { return r.entry; });
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  forms.forEach(function (form) {
    var input = form.querySelector('input[type="text"]');
    if (!input) return;

    var results = document.createElement('div');
    results.className = 'search-results';
    results.setAttribute('role', 'listbox');
    /* Appended to <body> with fixed positioning, not as a sibling of the
       form, so it can't be clipped by an ancestor's overflow:hidden (e.g.
       the home hero) on any page that reuses this component. Visibility is
       driven by the is-open class (not the hidden attribute) so open/close
       can transition instead of snapping. */
    document.body.appendChild(results);

    var items = [];
    var activeIndex = -1;

    function isOpen() { return results.classList.contains('is-open'); }

    function reposition() {
      var rect = form.getBoundingClientRect();
      results.style.left = rect.left + 'px';
      results.style.top = (rect.bottom + 10) + 'px';
      results.style.width = rect.width + 'px';
    }

    function close() {
      results.classList.remove('is-open');
      items = [];
      activeIndex = -1;
      input.setAttribute('aria-expanded', 'false');
    }

    function highlight() {
      items.forEach(function (el, i) { el.classList.toggle('is-active', i === activeIndex); });
      if (activeIndex > -1) items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function render(q) {
      var matches = search(q);
      reposition();

      if (!matches.length) {
        results.innerHTML = '<div class="search-result-empty">' +
          '<p>No matches for &ldquo;' + escapeHtml(q) + '&rdquo;.</p>' +
          '<a class="btn btn-outline btn-sm" href="' + basePath + 'parts-shop.html">Browse Parts Shop</a>' +
        '</div>';
        items = [];
        activeIndex = -1;
        results.classList.add('is-open');
        input.setAttribute('aria-expanded', 'true');
        return;
      }

      results.innerHTML = matches.map(function (entry) {
        var href = entry.url ? basePath + entry.url : null;
        var tag = href ? 'a' : 'div';
        var attrs = href ? ' href="' + href + '"' : ' aria-disabled="true"';
        return '<' + tag + ' class="search-result' + (href ? '' : ' is-disabled') + '" role="option"' + attrs + '>' +
          '<span class="search-result-type">' + TYPE_LABEL[entry.type] + '</span>' +
          '<span class="search-result-body">' +
            '<span class="search-result-title">' + escapeHtml(entry.title) + '</span>' +
            '<span class="search-result-subtitle">' + escapeHtml(entry.subtitle || (href ? '' : 'Coming soon')) + '</span>' +
          '</span>' +
        '</' + tag + '>';
      }).join('');

      items = Array.prototype.slice.call(results.querySelectorAll('a.search-result'));
      activeIndex = -1;
      results.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
    }

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (!q) { close(); return; }
      render(q);
    });

    input.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) { activeIndex = (activeIndex + 1) % items.length; highlight(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) { activeIndex = (activeIndex - 1 + items.length) % items.length; highlight(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var target = activeIndex > -1 ? items[activeIndex] : items[0];
        if (target) target.click();
      } else if (e.key === 'Escape') {
        close();
      }
    });

    document.addEventListener('click', function (e) {
      if (!form.contains(e.target) && !results.contains(e.target)) close();
    });
    /* The nav-search bar's own close (X) button lives inside this form, so
       the outside-click check above won't catch it; close the results
       explicitly when it's clicked. */
    var ownClose = form.querySelector('.nav-search-close');
    if (ownClose) ownClose.addEventListener('click', close);

    window.addEventListener('resize', function () { if (isOpen()) reposition(); });
    /* Scrolling the page (not the results list itself) closes the dropdown,
       since its fixed position doesn't track scroll. Scrolling *inside* the
       results list must keep working, so ignore scroll events whose target
       is the dropdown or one of its descendants. */
    window.addEventListener('scroll', function (e) {
      if (isOpen() && !results.contains(e.target)) close();
    }, { passive: true, capture: true });
  });
})();
