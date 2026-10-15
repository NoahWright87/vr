// ============================================================
// SPARRING — the Action Lab's defense station, behind you.
//
// An attacker dummy that thrusts at your head or body on a schedule.
// Its arm draws back and flashes red, a faint line shows where it's
// going, then it drives. Put a hand roughly in the way to block (the
// magnetic guard pulls a moving hand onto the line); move a hand fast
// *into* it early to parry, which staggers it and opens it — the arm
// glows blue — for a harder counter-punch. Or step out of the line.
//
// Tuning > Sparring sets its rhythm; Tuning > Defense the block, parry
// and guard rules; Debug > HUD > Defense and Player keep score.
// ============================================================

import '../../common/dummies.js';
import { defineTunables } from '../../common/tunables.js';

function apply(values) {
  var el = document.querySelector('#sparrer');
  if (!el) return;
  el.setAttribute('attacker-dummy', {
    enabled: values.on, intervalMs: values.interval, telegraphMs: values.telegraph,
    activeMs: values.active, reach: values.reach, aimAt: values.aim,
  });
}

var tune = defineTunables('sparring', 'Sparring', [
  { key: 'on', label: 'Attacks', kind: 'toggle', value: true },
  { key: 'interval', label: 'Every', value: 2600, min: 800, max: 8000, step: 200, unit: 'ms' },
  { key: 'telegraph', label: 'Warning', value: 700, min: 150, max: 2000, step: 50, unit: 'ms',
    info: 'How long the arm draws back and glows before it strikes.' },
  { key: 'active', label: 'Strike', value: 280, min: 100, max: 800, step: 20, unit: 'ms',
    info: 'How long the strike takes to drive out. Shorter is harder to react to.' },
  { key: 'reach', label: 'Reach', value: 1.0, min: 0.5, max: 1.8, step: 0.05, unit: 'm' },
  { key: 'aim', label: 'Aims at', kind: 'select', value: 'mixed', options: [
    { value: 'mixed', label: 'Mixed' }, { value: 'head', label: 'Head' }, { value: 'torso', label: 'Body' },
  ] },
], apply);

var scene = document.querySelector('a-scene');
if (scene.hasLoaded) apply(tune.values); else scene.addEventListener('loaded', function () { apply(tune.values); });
