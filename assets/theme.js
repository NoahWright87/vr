/* Apply the saved theme before first paint. Uses @noahwright/design's storage key. */
(() => {
  const root = document.documentElement;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try {
    const stored = localStorage.getItem('nw-theme-mode');
    if (stored === 'light' || stored === 'dark') preference = stored;
  } catch { /* Storage can be unavailable; the switch still works. */ }

  function apply(mode) {
    root.dataset.theme = mode;
    const button = document.getElementById('theme-toggle');
    if (button) {
      const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(mode === 'dark'));
    }
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = mode === 'dark' ? '#1A0A18' : '#F2E3F1';
  }

  apply(preference || (systemTheme.matches ? 'dark' : 'light'));
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    button.hidden = false;
    apply(root.dataset.theme);
    button.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.themeTransitioning = '';
      apply(preference);
      try { localStorage.setItem('nw-theme-mode', preference); } catch { /* Optional. */ }
      window.setTimeout(() => { delete root.dataset.themeTransitioning; }, 400);
    });
  });
  systemTheme.addEventListener('change', () => {
    if (!preference) apply(systemTheme.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== 'nw-theme-mode') return;
    preference = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
    apply(preference || (systemTheme.matches ? 'dark' : 'light'));
  });
})();
