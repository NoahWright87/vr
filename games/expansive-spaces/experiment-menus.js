import { registerMenuPage } from '../../common/menu-crossbar.js';
import { registerVisorPage } from '../../common/visor-page.js';
import '../../common/visor-menu.js';
import { createExperimentPage } from './experiment-menu-data.js';

function readState() {
  const room = document.querySelector('#space-room')?.components['expansive-space'];
  const gain = document.querySelector('#space-rig')?.components['speed-dependent-gain'];
  const scope = document.querySelector('#space-binoculars')?.components['space-binoculars'];
  return { worldScale: room?.worldScale, room, gain: gain?.tracker.settings, redirection: gain?.redirection.settings,
    motion: gain?.motion.settings, scope: scope?.settings, telemetry: gain?.telemetry, scores: scope?.scores };
}

const page = createExperimentPage(readState);
registerMenuPage('expansive-watch', page);
registerVisorPage('expansive-visor', { ...page, title: 'EXPANSIVE SPACES' });

export function syncExperimentMenus() { page.sync(); }

export function refreshExperimentMenus(scene) {
  for (const el of scene.querySelectorAll('[crossbar-menu]')) {
    const component = el.components['crossbar-menu'];
    if (component?.menu.isOpen) component.render();
  }
}

export function experimentMenuOpen(scene) {
  return [...scene.querySelectorAll('[crossbar-menu]')].some(el => el.components['crossbar-menu']?.menu.isOpen);
}
