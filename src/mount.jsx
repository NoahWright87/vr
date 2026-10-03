import { createRoot } from 'react-dom/client';
import { buildThemeCss } from '@noahwright/design';
import '@noahwright/design/styles.css';
import { theme, darkTheme } from './theme.js';
import './site.css';

export function mount(Component) {
  const themeStyle = document.createElement('style');
  themeStyle.textContent = buildThemeCss(theme) + buildThemeCss(darkTheme).replace(':root', ':root[data-theme="dark"]');
  document.head.appendChild(themeStyle);

  createRoot(document.getElementById('root')).render(<Component />);
}
