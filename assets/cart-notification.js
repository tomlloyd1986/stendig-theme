class CartNotification extends HTMLElement {
  constructor() {
    super();

    this.notification = document.getElementById('cart-notification');
    this.header = document.querySelector('sticky-header');
    this.overlay = this.querySelector('.cart-drawer__overlay');
    this.onBodyClick = this.handleBodyClick.bind(this);

    this.notification.addEventListener('keyup', (evt) => evt.code === 'Escape' && this.close());
    if (this.overlay) this.overlay.addEventListener('click', () => this.close());

    // The header cart icon opens the drawer instead of the cart page.
    const cartIcon = document.getElementById('cart-icon-bubble');
    if (cartIcon) {
      cartIcon.addEventListener('click', (evt) => {
        evt.preventDefault();
        this.refreshAndOpen();
      });
    }

    // Content is re-rendered on every cart change, so use delegation.
    this.addEventListener('click', (evt) => {
      if (evt.target.closest('.cart-drawer__close') || evt.target.closest('[data-drawer-close]')) {
        this.close();
        return;
      }

      const qtyButton = evt.target.closest('[data-qty-change]');
      if (qtyButton) {
        this.changeLineQuantity(qtyButton);
        return;
      }

      const addButton = evt.target.closest('[data-cross-sell-add]');
      if (addButton) this.addCrossSellAndCheckout(addButton);
    });

    this.addEventListener('change', (evt) => {
      if (evt.target.name !== 'cross-sell-variant') return;
      const priceElement = this.querySelector('[data-cross-sell-price]');
      if (priceElement && evt.target.dataset.price) priceElement.textContent = evt.target.dataset.price;
    });
  }

  async refreshAndOpen() {
    try {
      const sectionIds = this.getSectionsToRender().map((section) => section.id);
      const response = await fetch(`${window.location.pathname}?sections=${sectionIds.join(',')}`);
      const sections = await response.json();
      this.updateSections(sections);
    } catch (error) {
      console.error('Cart drawer refresh failed:', error);
    }
    this.open();
  }

  async changeLineQuantity(button) {
    const row = button.closest('[data-line-key]');
    if (!row || row.classList.contains('is-updating')) return;

    const newQuantity = Math.max(0, Number(row.dataset.quantity) + Number(button.dataset.qtyChange));
    row.classList.add('is-updating');

    try {
      const changeUrl = window.routes && window.routes.cart_change_url ? window.routes.cart_change_url : '/cart/change';
      const response = await fetch(`${changeUrl}.js`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.dataset.lineKey,
          quantity: newQuantity,
          sections: this.getSectionsToRender().map((section) => section.id),
        }),
      });

      if (!response.ok) throw new Error(`Cart change failed (${response.status})`);

      const state = await response.json();
      if (state.sections) this.updateSections(state.sections);
    } catch (error) {
      console.error('Cart quantity change failed:', error);
      row.classList.remove('is-updating');
    }
  }

  async addCrossSellAndCheckout(button) {
    if (button.getAttribute('aria-disabled') === 'true') return;

    const panel = this.querySelector('[data-cross-sell]');
    const selected =
      this.querySelector('input[name="cross-sell-variant"]:checked') ||
      this.querySelector('input[name="cross-sell-variant"][type="hidden"]');
    if (!panel || !selected) return;

    button.setAttribute('aria-disabled', 'true');
    button.classList.add('loading');
    const spinner = button.querySelector('.loading-overlay__spinner');
    if (spinner) spinner.classList.remove('hidden');

    const item = { id: Number(selected.value), quantity: 1 };
    const inheritedDate = panel.dataset.deliveryDate;
    if (inheritedDate) item.properties = { 'Delivery Date': inheritedDate };

    try {
      const addUrl = window.routes && window.routes.cart_add_url ? window.routes.cart_add_url : '/cart/add';
      const response = await fetch(`${addUrl}.js`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [item] }),
      });

      if (!response.ok) throw new Error(`Cart add failed (${response.status})`);

      window.location.href = '/checkout';
    } catch (error) {
      console.error('Cross-sell add failed:', error);
      button.removeAttribute('aria-disabled');
      button.classList.remove('loading');
      if (spinner) spinner.classList.add('hidden');
    }
  }

  open() {
    this.classList.add('active');
    document.documentElement.classList.add('cart-drawer-open');

    this.notification.addEventListener(
      'transitionend',
      () => {
        this.notification.focus();
        trapFocus(this.notification);
      },
      { once: true }
    );

    document.body.addEventListener('click', this.onBodyClick);
  }

  close() {
    this.classList.remove('active');
    document.documentElement.classList.remove('cart-drawer-open');

    document.body.removeEventListener('click', this.onBodyClick);

    removeTrapFocus(this.activeElement);
  }

  updateSections(sections) {
    this.getSectionsToRender().forEach((section) => {
      const target = document.getElementById(section.targetId || section.id);
      if (!target || !sections[section.id]) return;
      target.innerHTML = this.getSectionInnerHTML(sections[section.id], section.selector);
    });
  }

  renderContents(parsedState) {
    this.productId = parsedState.id;
    this.updateSections(parsedState.sections);

    if (this.header) this.header.reveal();
    this.open();
  }

  getSectionsToRender() {
    return [
      {
        id: 'cart-notification-product',
        targetId: 'cart-notification-content',
      },
      {
        id: 'cart-icon-bubble',
      },
    ];
  }

  getSectionInnerHTML(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector).innerHTML;
  }

  handleBodyClick(evt) {
    const target = evt.target;
    if (target !== this.notification && !target.closest('cart-notification')) {
      const disclosure = target.closest('details-disclosure');
      this.activeElement = disclosure ? disclosure.querySelector('summary') : null;
      this.close();
    }
  }

  setActiveElement(element) {
    this.activeElement = element;
  }
}

customElements.define('cart-notification', CartNotification);
