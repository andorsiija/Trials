(function () {
  const STORAGE_KEY = 'vicom-theme';
  const root = document.documentElement;

  function readSaved() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch {
      return null;
    }
  }

  function updateButton(theme) {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const isDark = theme === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    button.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    button.dataset.label = isDark ? 'Light mode' : 'Dark mode';
    button.innerHTML = `<span class="theme-toggle-icon">${isDark ? '☀' : '☾'}</span>`;
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    updateButton(theme);
  }

  function setTheme(theme) {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable in private mode; the theme still applies for this visit.
    }
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function spinButton(button) {
    if (!button || prefersReducedMotion()) return;
    button.classList.remove('is-spinning');
    // Force a reflow so the animation can restart on rapid toggles.
    void button.offsetWidth;
    button.classList.add('is-spinning');
    const clear = () => {
      button.classList.remove('is-spinning');
      button.removeEventListener('animationend', clear);
    };
    button.addEventListener('animationend', clear);
  }

  function animateFallback(theme) {
    root.classList.add('theme-transitioning');
    setTheme(theme);
    window.setTimeout(() => root.classList.remove('theme-transitioning'), 450);
  }

  function toggle() {
    const button = document.getElementById('theme-toggle');
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';

    if (prefersReducedMotion()) {
      setTheme(next);
      return;
    }

    if (typeof document.startViewTransition !== 'function') {
      animateFallback(next);
      return;
    }

    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => setTheme(next));
    transition.ready
      .then(() => {
        root.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 600,
            easing: 'ease-in-out',
            pseudoElement: '::view-transition-new(root)',
          }
        );
      })
      .catch(() => {});
  }

  function mount() {
    if (document.getElementById('theme-toggle')) return;
    const button = document.createElement('button');
    button.id = 'theme-toggle';
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', () => {
      spinButton(button);
      toggle();
    });

    const sidebarBottom = document.querySelector('.sidebar .sidebar-bottom');
    if (sidebarBottom) {
      button.classList.add('theme-toggle--inline');
      sidebarBottom.appendChild(button);
    } else {
      document.body.appendChild(button);
    }

    updateButton(root.getAttribute('data-theme') || 'light');
  }

  // Apply before the body paints to avoid a flash of the wrong theme.
  // Light mode is the default; dark mode only applies if the user chose it.
  apply(readSaved() || 'light');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
