import { createRoot } from 'react-dom/client';
import { buildThemeCss } from '@noahwright/design';
import '@noahwright/design/styles.css';
import { theme } from './theme.js';

export function mount(Component) {
  const themeStyle = document.createElement('style');
  themeStyle.textContent = buildThemeCss(theme);
  document.head.appendChild(themeStyle);

  createRoot(document.getElementById('root')).render(<Component />);
}
