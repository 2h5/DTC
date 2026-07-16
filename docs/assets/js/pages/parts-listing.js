/* Part listing pages (e.g. Mark 1 & II): availability filter and sort.
   Client-side only, operates on the cards already in the DOM (no backend). */
(function () {
  var grid = document.querySelector('[data-listing-grid]');
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll('.part-card'));
  var checkboxes = Array.prototype.slice.call(document.querySelectorAll('[data-filter-availability]'));
  var countEl = document.querySelector('[data-listing-count]');
  var emptyEl = document.querySelector('[data-listing-empty]');
  var resetBtn = document.querySelector('[data-filter-reset]');

  var noun = cards.length === 1 ? 'item' : 'items';

  var dropdown = document.querySelector('[data-dropdown]');
  var dropdownTrigger = document.querySelector('[data-dropdown-trigger]');
  var dropdownMenu = document.querySelector('[data-dropdown-menu]');
  var dropdownValueEl = document.querySelector('[data-dropdown-value]');
  var dropdownOptions = dropdown ? Array.prototype.slice.call(dropdown.querySelectorAll('[role="option"]')) : [];
  var sortMode = 'default';

  /* Availability counts, shown next to each checkbox label. */
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var status = el.getAttribute('data-count');
    var n = cards.filter(function (c) { return c.getAttribute('data-availability') === status; }).length;
    el.textContent = '(' + n + ')';
  });

  function activeStatuses() {
    return checkboxes.filter(function (cb) { return cb.checked; }).map(function (cb) {
      return cb.getAttribute('data-filter-availability');
    });
  }

  function applyFilter() {
    var active = activeStatuses();
    var visible = 0;
    cards.forEach(function (card) {
      var show = active.length === 0 || active.indexOf(card.getAttribute('data-availability')) !== -1;
      card.classList.toggle('is-filtered-out', !show);
      if (show) visible++;
    });

    if (countEl) countEl.textContent = visible + ' of ' + cards.length + ' ' + noun;
    if (emptyEl) emptyEl.hidden = visible !== 0;
    if (resetBtn) resetBtn.hidden = active.length === 0;
  }

  function applySort() {
    var sorted = cards.slice();

    if (sortMode === 'part-asc') {
      sorted.sort(function (a, b) { return a.getAttribute('data-part-number').localeCompare(b.getAttribute('data-part-number')); });
    } else if (sortMode === 'part-desc') {
      sorted.sort(function (a, b) { return b.getAttribute('data-part-number').localeCompare(a.getAttribute('data-part-number')); });
    } else if (sortMode === 'availability') {
      sorted.sort(function (a, b) {
        return a.getAttribute('data-availability').localeCompare(b.getAttribute('data-availability'))
          || a.getAttribute('data-part-number').localeCompare(b.getAttribute('data-part-number'));
      });
    } else {
      sorted.sort(function (a, b) { return cards.indexOf(a) - cards.indexOf(b); });
    }

    sorted.forEach(function (card) { grid.appendChild(card); });
  }

  checkboxes.forEach(function (cb) { cb.addEventListener('change', applyFilter); });
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      checkboxes.forEach(function (cb) { cb.checked = false; });
      applyFilter();
    });
  }

  /* Custom sort dropdown: button + listbox, since a native <select>'s
     option list can't be styled or animated cross-browser. */
  if (dropdown && dropdownTrigger && dropdownMenu) {
    var closeDropdown = function () {
      dropdown.classList.remove('is-open');
      dropdownTrigger.setAttribute('aria-expanded', 'false');
    };
    var openDropdown = function () {
      dropdown.classList.add('is-open');
      dropdownTrigger.setAttribute('aria-expanded', 'true');
    };

    dropdownTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (dropdown.classList.contains('is-open')) closeDropdown();
      else openDropdown();
    });

    dropdownOptions.forEach(function (opt) {
      opt.addEventListener('click', function () {
        sortMode = opt.getAttribute('data-value');
        dropdownValueEl.textContent = opt.textContent;
        dropdownOptions.forEach(function (o) { o.setAttribute('aria-selected', o === opt ? 'true' : 'false'); });
        closeDropdown();
        applySort();
      });
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target)) closeDropdown();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDropdown();
    });
  }

  applyFilter();
})();
