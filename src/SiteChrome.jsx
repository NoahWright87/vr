import { useEffect, useState } from 'react';
import { Header, Footer, Text, Link, ToggleIcon, initThemeMode, toggleThemeMode } from '@noahwright/design';
import { Logo } from './Logo.jsx';

export function SiteHeader() {
  const [isDark, setIsDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    const syncTheme = () => {
      setIsDark(initThemeMode() === 'dark');
    };
    syncTheme();
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      let explicit = null;
      try { explicit = localStorage.getItem('nw-theme-mode'); } catch { /* Optional storage. */ }
      if (explicit !== 'light' && explicit !== 'dark') syncTheme();
    };
    const handleStorage = (event) => {
      if (event.key === null || event.key === 'nw-theme-mode') syncTheme();
    };
    system.addEventListener('change', handleSystemChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      system.removeEventListener('change', handleSystemChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = isDark ? '#1A0A18' : '#F2E3F1';
  }, [isDark]);

  return (
    <Header
      shadow={false}
      left={
        <Link href="/" variant="subtle" className="site-home-link">
          <Logo />
          <strong className="site-name">Noah's VR projects</strong>
        </Link>
      }
      right={
        <>
          <nav className="site-navigation" aria-label="Site navigation">
            <Link href="/primitives/menus/" variant="subtle">Primitives ↗</Link>
            <Link href="/about/" variant="subtle">About</Link>
          </nav>
          <ToggleIcon
            preset="moon-sun"
            isToggled={isDark}
            onChange={() => setIsDark(toggleThemeMode() === 'dark')}
            label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          />
        </>
      }
    />
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <Footer
      bottom={
        <Text align="center" tone="muted">
          Built with A-Frame, for the Meta Quest 2 browser · ©{' '}
          {year} <Link href="/about/" variant="subtle">Noah Wright</Link>
        </Text>
      }
    />
  );
}
