/* FAQs page only: animates <details>/<summary> open/close height instead of
   the browser's instant snap. Keeps native <details> semantics (keyboard,
   find-in-page, no-JS fallback still works, it just won't be animated). */
(function () {
  class Accordion {
    constructor(el) {
      this.el = el;
      this.summary = el.querySelector('summary');
      this.body = el.querySelector('.faq-body');
      this.animation = null;
      this.isClosing = false;
      this.isExpanding = false;
      this.summary.addEventListener('click', (e) => this.onClick(e));
    }

    onClick(e) {
      e.preventDefault();
      this.el.style.overflow = 'hidden';
      if (this.isClosing || !this.el.open) {
        this.open();
      } else if (this.isExpanding || this.el.open) {
        this.shrink();
      }
    }

    shrink() {
      this.isClosing = true;
      const startHeight = `${this.el.offsetHeight}px`;
      const endHeight = `${this.summary.offsetHeight}px`;
      if (this.animation) this.animation.cancel();
      this.animation = this.el.animate(
        { height: [startHeight, endHeight] },
        { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
      this.animation.onfinish = () => this.onAnimationFinish(false);
      this.animation.oncancel = () => { this.isClosing = false; };
    }

    open() {
      this.el.style.height = `${this.el.offsetHeight}px`;
      this.el.open = true;
      window.requestAnimationFrame(() => this.expand());
    }

    expand() {
      this.isExpanding = true;
      const startHeight = `${this.el.offsetHeight}px`;
      const endHeight = `${this.summary.offsetHeight + this.body.offsetHeight}px`;
      if (this.animation) this.animation.cancel();
      this.animation = this.el.animate(
        { height: [startHeight, endHeight] },
        { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
      this.animation.onfinish = () => this.onAnimationFinish(true);
      this.animation.oncancel = () => { this.isExpanding = false; };
    }

    onAnimationFinish(open) {
      this.el.open = open;
      this.animation = null;
      this.isClosing = false;
      this.isExpanding = false;
      this.el.style.height = '';
      this.el.style.overflow = '';
    }
  }

  document.querySelectorAll('.faq-item').forEach((el) => new Accordion(el));
})();
