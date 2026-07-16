/* Home page only: brand-strip carousel arrows, newsletter form placeholder.
   Loaded after core.js, only by index.html. */
(function () {
  var track = document.querySelector('[data-carousel-track]');
  var prevBtn = document.querySelector('[data-carousel-prev]');
  var nextBtn = document.querySelector('[data-carousel-next]');
  if (track && prevBtn && nextBtn) {
    var scrollAmount = function () { return Math.min(320, track.clientWidth * 0.6); };
    prevBtn.addEventListener('click', function () {
      track.scrollBy({ left: -scrollAmount(), behavior: 'smooth' });
    });
    nextBtn.addEventListener('click', function () {
      track.scrollBy({ left: scrollAmount(), behavior: 'smooth' });
    });
  }

  var newsletterForm = document.querySelector('[data-newsletter-form]');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = newsletterForm.parentElement.querySelector('.newsletter-note');
      newsletterForm.reset();
      if (note) note.textContent = "Thanks, you're on the list. (Form is not yet connected to an email service.)";
    });
  }
})();
