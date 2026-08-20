import { createRoot } from 'react-dom/client';
import { buildThemeCss } from '@noahwright/design';
import '@noahwright/design/styles.css';
import { theme } from './theme.js';
import { App } from './App.jsx';

const themeStyle = document.createElement('style');
themeStyle.textContent = buildThemeCss(theme);
document.head.appendChild(themeStyle);

createRoot(document.getElementById('root')).render(<App />);
