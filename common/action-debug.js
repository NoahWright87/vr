// ============================================================
// ACTION DEBUG — one visor submenu over the debug tools.
//
//   Debug ▸
//     HUD ▸      a toggle per registered readout (common/debug-hud.js)
//     Draw ▸     a toggle per debug-draw channel (common/debug-draw.js)
//     Log        the last few action events, live in the sidecar
//   Tuning ▸     every tunables group on the page (common/tunables.js)
//
// A page adds `debugMenuItem()` and `tuningMenuItem()` to its visor
// rows; nothing else to wire.
// ============================================================

import './debug-draw.js';
import { listReadouts, isReadoutOn, setReadout, actionLog } from './debug-hud.js';
import { DEBUG_CHANNELS } from './debug-draw.js';

export { tuningMenuItem } from './tunables.js';

function drawSystem() {
  var scene = document.querySelector('a-scene');
  return scene && scene.systems['debug-draw'];
}

var wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('menu-commit', function (evt) {
    var id = evt.detail && evt.detail.id;
    if (typeof id !== 'string') return;
    if (id.indexOf('debug.hud.') === 0) setReadout(id.slice(10), evt.detail.value);
    if (id.indexOf('debug.draw.') === 0) {
      var dd = drawSystem();
      if (dd) dd.setChannel(id.slice(11), evt.detail.value);
    }
  });
}

export function debugMenuItem() {
  wire();
  return {
    kind: 'submenu', id: 'debug', label: 'Debug',
    info: 'HUD: live numbers, low in view.\nDraw: what each system is thinking, in the world.\nLog: the last few things that happened, and why.',
    items: function () {
      return [
        {
          kind: 'submenu', id: 'debug.hud', label: 'HUD',
          items: function () {
            return listReadouts().map(function (r) {
              return { kind: 'toggle', id: 'debug.hud.' + r.id, label: r.label, value: isReadoutOn(r.id) };
            });
          },
        },
        {
          kind: 'submenu', id: 'debug.draw', label: 'Draw',
          items: function () {
            var dd = drawSystem();
            return DEBUG_CHANNELS.map(function (c) {
              return { kind: 'toggle', id: 'debug.draw.' + c.id, label: c.label, value: Boolean(dd && dd.on(c.id)) };
            });
          },
        },
        {
          kind: 'info', id: 'debug.log', label: 'Log', liveInfo: true,
          info: function () { var lines = actionLog(); return lines.length ? lines.join('\n') : 'Nothing has happened yet.'; },
        },
      ];
    },
  };
}
