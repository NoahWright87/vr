import { ROOM_DESTINATIONS } from './room-layout.js';
import { DEFAULT_GAIN_SETTINGS } from './speed-gain.js';
import { DEFAULT_REDIRECTION_SETTINGS } from './redirection.js';
import { DEFAULT_MOTION_SETTINGS } from './motion-effects.js';
import { DEFAULT_SCOPE_SETTINGS } from './scope-filter.js';

// One shared tree of typed values for both wrists and the visor. The shared
// renderer windows long lists; this file owns no entities, offsets or colliders.
export function createExperimentPage(readState) {
  const bindings = [];
  const defaults = { gain: DEFAULT_GAIN_SETTINGS, redirection: DEFAULT_REDIRECTION_SETTINGS,
    motion: DEFAULT_MOTION_SETTINGS, scope: DEFAULT_SCOPE_SETTINGS, worldScale: 1.5 };
  const value = (state, group, key) => group === 'worldScale' ? state.worldScale ?? 1.5 : state[group]?.[key] ?? defaults[group][key];
  const control = (kind, id, label, group, key, options) => {
    const item = { kind, id, label, value: value(defaults, group, key), ...options };
    bindings.push({ item, group, key }); return item;
  };
  const select = (id, label, group, key, values, format = v => String(v)) => control('select', id, label, group, key,
    { options: values.map(v => ({ value: v, label: format(v) })) });
  const toggle = (id, label, group, key) => control('toggle', id, label, group, key);
  const action = (id, label) => ({ kind: 'action', id, label });
  const reset = () => action('space-reset-effects', 'Reset travel + rotation');
  const info = (key, lines) => () => [...lines, '', readState().telemetry?.[key] || 'Waiting for tracking'];
  const submenu = (id, label, items, description) => ({ kind: 'submenu', id, label, items, info: description });
  const times = v => v.toFixed(2) + 'x', ms = v => v + ' m/s', percent = v => Math.round(v * 100) + '%';
  const roomInfo = () => {
    const state = readState(), room = state.room;
    return [room?.status || 'Reading boundary…', room?.activeRoom?.name || 'Foyer',
      'World ' + (state.worldScale ?? 1.5).toFixed(2) + 'x',
      'Green: current room', 'Yellow: target footprint', 'Orange: real / Purple: game', '', room?.detail || 'Enter VR to read your boundary.'];
  };
  const curveInfo = info('steering', ['Maximize current-room overlap.', 'Wall clearance breaks ties.', 'Below 0.6 m/s: no steering.']);
  const turnInfo = info('turn', ['Fast looks gain OR lose yaw', 'toward the same overlap goal.', 'Below 30 deg/s: 1x.', 'Response affects both effects.']);
  const items = [
    { kind: 'info', id: 'space-map', label: 'Map + current room', info: roomInfo },
    select('space-world-scale', 'World scale', 'worldScale', null, [1, 1.25, 1.5, 1.75, 2], times),
    submenu('space-gain', 'Movement gain', [
      select('space-max-gain', 'Max gain', 'gain', 'maxGain', [1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.75, 2], times),
      select('space-gain-speed', 'Full gain at', 'gain', 'speedForMax', [.8, 1, 1.2, 1.5, 2, 2.5, 3, 4], ms), reset(),
    ], info('gain', ['Below 0.6 m/s: always 1x.', 'Faster steps ramp up gain.'])),
    submenu('space-steering', 'Walking steering', [
      toggle('space-steering-enabled', 'Walking steering', 'redirection', 'steeringEnabled'),
      select('space-curvature', 'Max curve', 'redirection', 'maxCurvature', [0, 1, 2, 3, 5, 8, 10, 15, 20], v => v + ' deg/m'),
      select('space-steering-speed', 'Full at', 'redirection', 'steeringSpeed', [.8, 1, 1.2, 1.5, 2, 2.5, 3, 4], ms),
      select('space-steering-rate', 'Rate cap', 'redirection', 'maxSteeringRate', [1, 2, 3, 5, 6, 10, 15, 20, 30], v => v + ' deg/s'),
      select('space-wall-lookahead', 'Look ahead', 'redirection', 'lookAhead', [.5, 1, 1.5, 2, 2.5, 3], v => v + ' s'),
      select('space-wall-margin', 'Wall margin', 'redirection', 'wallMargin', [.1, .2, .4, .6, .8, 1], v => v + ' m'), reset(),
    ], curveInfo),
    submenu('space-turn', 'Turn gain', [
      toggle('space-turn-enabled', 'Turn gain', 'redirection', 'turnEnabled'),
      select('space-turn-gain', 'Max gain', 'redirection', 'maxTurnGain', [1, 1.05, 1.1, 200 / 180, 1.15, 1.2, 1.3, 1.5], times),
      select('space-turn-min-gain', 'Min gain', 'redirection', 'minTurnGain', [.5, .6, .7, .8, .9, .95, 1], times),
      select('space-turn-speed', 'Full at', 'redirection', 'turnSpeed', [60, 90, 120, 180, 240, 300, 360], v => v + ' deg/s'),
      select('space-alignment', 'Response', 'redirection', 'alignmentStrength', [0, .25, .5, .75, 1], percent), reset(),
    ], turnInfo),
    submenu('space-experiments', 'More experiments', [
      submenu('space-arm', 'Arm swing', [
        toggle('space-arm-enabled', 'Arm swing', 'motion', 'armEnabled'),
        select('space-arm-gain', 'Max boost', 'motion', 'maxArmGain', [1, 1.5, 2, 3, 4, 6, 8], times),
        select('space-arm-speed', 'Full at', 'motion', 'armSpeed', [.3, .5, 1, 1.5, 2, 3], ms),
        select('space-arm-stroke', 'Stroke', 'motion', 'armStroke', [.04, .06, .12, .2, .3, .4], v => Math.round(v * 100) + ' cm'),
        toggle('space-speed-lines', 'Speed lines', 'motion', 'speedLines'),
      ], info('arm', ['Swing both tracked hands', 'front/back while walking.', 'Multiplies movement gain.'])),
      submenu('space-slide', 'Sliding', [
        toggle('space-slide-enabled', 'Sliding', 'motion', 'slideEnabled'),
        select('space-slide-boost', 'Launch', 'motion', 'slideBoost', [.5, 1, 1.5, 2, 3, 5, 8, 10], times),
        select('space-slide-loss-mode', 'Loss mode', 'motion', 'slideLossMode', ['percent', 'flat'], v => v === 'flat' ? 'Flat' : 'Percent'),
        select('space-slide-flat-loss', 'Flat loss', 'motion', 'slideFlatLoss', [0, .05, .1, .25, .5, 1, 2, 4], v => v + ' m/s/s'),
        select('space-slide-percent-loss', 'Percent loss', 'motion', 'slidePercentLoss', [0, .001, .01, .05, .1, .3, .5, .75, .9], v => v * 100 + '%/s'), reset(),
      ], info('slide', ['Move, then duck within .6 s.', 'Deeper duck: stronger launch.', 'Stand or open a menu to stop.'])),
      submenu('space-jump', 'Jumping', [
        toggle('space-jump-enabled', 'Jumping', 'motion', 'jumpEnabled'),
        select('space-jump-boost', 'Forward', 'motion', 'jumpBoost', [.5, 1, 1.5, 2, 3, 5, 8, 10], times),
        select('space-jump-height', 'Height gain', 'motion', 'jumpVerticalGain', [1, 1.5, 2, 3, 5, 8, 10], times),
        select('space-jump-rise', 'Rise', 'motion', 'jumpRise', [.03, .05, .08, .12, .2, .3], v => Math.round(v * 100) + ' cm'),
        select('space-jump-loss', 'Speed loss', 'motion', 'jumpPercentLoss', [0, .001, .01, .05, .1, .3, .5, .75, .9], v => v * 100 + '%/s'),
        action('space-calibrate-height', 'Calibrate standing height'), reset(),
      ], info('jump', ['Hop in place or add carry.', 'Height gain applies above Rise.', 'Real landing ends the jump.'])),
      submenu('space-scope', 'Binoculars', [
        toggle('space-scope-enabled', 'Binoculars', 'scope', 'enabled'),
        toggle('space-scope-stabilize', 'Stabilize', 'scope', 'stabilize'),
        select('space-scope-zoom', 'Zoom', 'scope', 'zoom', [2, 4, 6, 8], times),
        select('space-scope-rotation', 'Rotation lag', 'scope', 'rotationLag', [0, .05, .1, .15, .25, .4, .8], v => v + ' s'),
        select('space-scope-position', 'Position lag', 'scope', 'positionLag', [0, .05, .1, .15, .25, .4, .8], v => v + ' s'),
        action('space-reset-targets', 'Reset target scores'),
      ], () => {
        const scores = readState().scores;
        return ['Grab from chest, raise to eyes.', 'Trigger: test shot.', 'Desktop: B / right-click aim.', 'Windows in the foyer.', '',
          scores ? `Raw ${scores.raw.hits}/${scores.raw.shots} | Damped ${scores.damped.hits}/${scores.damped.shots}` : 'Binoculars OFF'];
      }),
      action('space-calibrate-height', 'Calibrate standing height'),
      submenu('space-rooms', 'Visit a room', ROOM_DESTINATIONS.map((room, i) => action('visit-' + room.id, (i + 1) + '. ' + room.name)),
        ['Test shortcuts.', 'All rooms also connect', 'through real doorways.']),
    ], ['Effects start OFF.', 'Stand normally to calibrate.', 'Any open menu pauses effects.']),
    reset(),
  ];
  function sync() {
    const state = readState();
    for (const { item, group, key } of bindings) item.value = value(state, group, key);
  }
  return { title: '', items, info: roomInfo, onOpen: sync, sync };
}
