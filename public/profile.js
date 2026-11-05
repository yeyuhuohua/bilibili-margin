(() => {
  const css = 'button#follow, button#follow:hover { color: var(--m-canvas) !important; background: var(--m-ink) !important; border-color: var(--m-ink) !important; } button#follow > span, button#follow bili-icon { color: inherit !important; }';
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = attachShadow.call(this, init);
    if (this.tagName === 'BILI-USER-PROFILE') {
      const install = () => {
        if (!root.querySelector('button#follow') || root.querySelector('style[data-margin-profile]')) return;
        const style = document.createElement('style');
        style.dataset.marginProfile = '';
        style.textContent = css;
        root.append(style);
      };
      new MutationObserver(install).observe(root, { childList: true, subtree: true });
      install();
    }
    return root;
  };
})();
