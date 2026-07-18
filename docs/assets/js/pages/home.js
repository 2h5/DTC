/* Home page only: user-controlled OEM platform carousel.
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
})();
