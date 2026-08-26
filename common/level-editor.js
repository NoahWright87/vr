// In-VR level editor for the Showcase testbed. Deliberately layered on top
// of existing shared primitives rather than inventing new interaction:
// simple-grabbable for pick-up/move (common/interaction-hints.js),
// projected-menu's alwaysOn/rotationMode for the menu-activator kind
// (common/menus.js), and the watch's existing page system for the palette
// and per-object edit UI (common/watch-menu.js). See TODO.md's "Level
// editor" section for what's deliberately deferred (axis-locked handles,
// carrying this into Pistols at Dawn).

var GRID_SIZE = 0.25;
var ROTATE_STEP_DEG = 15;
var ROTATE_COOLDOWN_MS = 180;
var POKE_SELECT_COOLDOWN_MS = 400;

var PRIMITIVE_COLORS = ['#d78b42', '#4287d7', '#42d787', '#d74287', '#d7d142', '#8a42d7'];
var DEFAULT_ACTIVATOR_TEMPLATE = '#wall-screen-menu-template';
var FACE_BUTTON_DOWN_EVENTS = ['abuttondown', 'bbuttondown', 'xbuttondown', 'ybuttondown'];
var FACE_BUTTON_UP_EVENTS = ['abuttonup', 'bbuttonup', 'xbuttonup', 'ybuttonup'];

// Click-to-cycle fields on the watch: one button advances through `values`
// (wrapping), showing `labels[i]` for `values[i]`. Deliberately not
// menu-option here — see the comment on these rows in index.html: each
// menu-option instance costs 3 permanent entries in A-Frame's built-in
// obb-collider system, which does an O(n^2) pairwise check every frame.
var CYCLE_FIELDS = {
  color: { values: ['0', '1', '2', '3', '4', '5'], labels: ['Orange', 'Blue', 'Green', 'Pink', 'Yellow', 'Purple'] },
  shape: { values: ['box', 'sphere', 'cylinder', 'cone'], labels: ['Box', 'Sphere', 'Cylinder', 'Cone'] },
  template: { values: ['#wall-screen-menu-template', '#pedestal-menu-template'], labels: ['Wall screen', 'Pedestal'] },
  rotationMode: { values: ['fixed', 'yaw', 'full'], labels: ['Fixed', 'Upright follow', 'Full follow'] },
  alwaysOn: { values: ['off', 'on'], labels: ['Off', 'On'] },
};
var SNAP_DEFAULT_CYCLE = { values: ['snap', 'free'], labels: ['Snap', 'Free-move'] };

function cycleLabelFor(cycle, value) {
  var index = cycle.values.indexOf(String(value));
  return cycle.labels[index >= 0 ? index : 0];
}

function nextCycleValue(cycle, value) {
  var index = cycle.values.indexOf(String(value));
  return cycle.values[(Math.max(index, 0) + 1) % cycle.values.length];
}

function setRowLabel(panelEl, className, text) {
  var textEl = panelEl.querySelector('.' + className);
  if (textEl) textEl.setAttribute('text', 'value', text);
}

// Everything here is one scene's worth of state; the Showcase only ever
// has one level editor active at a time.
var editorState = {
  buildMode: false,
  selected: null,
  watches: [], // { panelEl, projectedMenu, fingertipEl }
  spawnPointEl: null,
  snapDefault: 'snap', // 'snap' | 'free' -- what a plain release (no face button) does
  hands: {}, // handId -> { el, triggerDown, faceDown, axes }
};

function THREE_() { return AFRAME.THREE; }

function cameraForward() {
  var camera = document.querySelector('a-camera');
  var quat = new (THREE_()).Quaternion();
  camera.object3D.getWorldQuaternion(quat);
  return new (THREE_()).Vector3(0, 0, -1).applyQuaternion(quat);
}

function spawnPositionInFrontOfPlayer() {
  var camera = document.querySelector('a-camera');
  var pos = new (THREE_()).Vector3();
  camera.object3D.getWorldPosition(pos);
  var forward = cameraForward();
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  pos.addScaledVector(forward, 0.6);
  pos.y = Math.max(0.25, pos.y - 0.35);
  return pos;
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

// ---------------------------------------------------------------------
// Per-hand input tracking (trigger/face-button/axes), independent of
// locomotion's own tracking so this module has no dependency on it.
// ---------------------------------------------------------------------

function trackHand(handEl) {
  var id = handEl.id;
  if (editorState.hands[id]) return;
  var state = { el: handEl, triggerDown: false, faceDown: false, axes: [0, 0, 0, 0] };
  editorState.hands[id] = state;
  handEl.addEventListener('triggerdown', function () { state.triggerDown = true; });
  handEl.addEventListener('triggerup', function () { state.triggerDown = false; });
  FACE_BUTTON_DOWN_EVENTS.forEach(function (name) {
    handEl.addEventListener(name, function () { state.faceDown = true; });
  });
  FACE_BUTTON_UP_EVENTS.forEach(function (name) {
    handEl.addEventListener(name, function () { state.faceDown = false; });
  });
  handEl.addEventListener('axismove', function (evt) {
    if (evt.detail.axis) state.axes = evt.detail.axis;
  });
}

function setupHandTracking() {
  ['#left-hand', '#right-hand'].forEach(function (sel) {
    var el = document.querySelector(sel);
    if (el) trackHand(el);
  });
}

// ---------------------------------------------------------------------
// editor-target: attached to every object the level editor spawns.
// Selection reaches it two ways, both already-existing mechanisms
// widened to include it rather than new bindings: a raycaster click
// (fires once Build Mode repoints the fingertip raycaster at
// .editor-target, see setBuildMode below) and a close-range poke via
// obb-collider (mirrors projected-menu's own registerMenuTarget).
// ---------------------------------------------------------------------

AFRAME.registerComponent('editor-target', {
  schema: {
    kind: { type: 'string' }, // 'primitive' | 'activator' | 'spawn-point'
    shape: { type: 'string', default: 'box' },
    colorIndex: { type: 'int', default: 0 },
  },

  init: function () {
    this.el.classList.add('editor-target');
    // The poke obb-collider is expensive (A-Frame's built-in obb-collider
    // system is an O(n^2) pairwise check, every frame, for every collider
    // that ever exists) and only meaningful while Build Mode can actually
    // select things — see setEditorTargetsPokeEnabled, which attaches it
    // here immediately if Build Mode already happens to be on (true
    // whenever this runs from the palette, since that's only reachable
    // from Build Mode) and detaches/reattaches it as Build Mode toggles.
    if (editorState.buildMode) this.el.setAttribute('obb-collider', 'size: 0.14');
    this.pokeReadyAt = 0;
    this.rotateReadyAt = 0;

    this.onClick = this.select.bind(this);
    this.el.addEventListener('click', this.onClick);

    this.onPoke = this.onPoke.bind(this);
    this.el.addEventListener('obbcollisionstarted', this.onPoke);

    this.onReleased = this.onReleased.bind(this);
    this.el.addEventListener('simple-released', this.onReleased);
  },

  onPoke: function (evt) {
    if (!editorState.buildMode) return;
    var poker = evt.detail.withEl;
    var now = performance.now();
    if (
      poker.handComponent && poker.handComponent.isPointing &&
      now - this.pokeReadyAt > POKE_SELECT_COOLDOWN_MS
    ) {
      this.pokeReadyAt = now;
      this.select();
    }
  },

  select: function () {
    if (!editorState.buildMode) return;
    selectEditorObject(this.el);
  },

  onReleased: function () {
    var hand = editorState.hands[this.grabbingHandId || ''];
    var snap = editorState.snapDefault === 'snap';
    if (hand && hand.faceDown) snap = !snap;
    if (!snap) return;
    var pos = this.el.object3D.position;
    pos.x = snapToGrid(pos.x);
    pos.z = snapToGrid(pos.z);
  },

  // Rotate-while-holding: only while this object is actually held AND
  // the holding hand's trigger is also down. Grip-only keeps meaning
  // "carry it while you walk," exactly like every other grabbable here.
  tick: function () {
    var grab = this.el.components['simple-grabbable'];
    if (!grab || grab.state !== 'held' || !grab.handEl) {
      this.grabbingHandId = null;
      return;
    }
    this.grabbingHandId = grab.handEl.id;
    var hand = editorState.hands[grab.handEl.id];
    if (!hand || !hand.triggerDown) return;
    var x = hand.axes[2] !== undefined ? hand.axes[2] : hand.axes[0] || 0;
    if (Math.abs(x) < 0.6) { this.rotateReadyAt = 0; return; }
    var now = performance.now();
    if (now - this.rotateReadyAt < ROTATE_COOLDOWN_MS) return;
    this.rotateReadyAt = now;
    this.el.object3D.rotation.y -= Math.sign(x) * (THREE_().MathUtils.degToRad(ROTATE_STEP_DEG));
  },

  remove: function () {
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('obbcollisionstarted', this.onPoke);
    this.el.removeEventListener('simple-released', this.onReleased);
  },
});

// ---------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------

var GRAB_HINT = 'action: grab; radius: 0.34; maxReach: 1.0; gazeThreshold: 0.93; priority: 10; desktopKey: F; desktopLabel: Grab; xrKey: GRIP; xrLabel: Grab; hintOffset: 0 0.32 0';

function applyPrimitiveGeometry(el, shape) {
  el.setAttribute('geometry', 'primitive: ' + shape);
}

function createBaseEditorEntity() {
  var el = document.createElement('a-entity');
  var pos = spawnPositionInFrontOfPlayer();
  el.setAttribute('position', pos);
  el.setAttribute('simple-grabbable', 'heldPosition: 0 0 -0.12');
  el.setAttribute('hint-zone', GRAB_HINT);
  document.querySelector('a-scene').appendChild(el);
  return el;
}

function spawnPrimitive(shape) {
  var el = createBaseEditorEntity();
  applyPrimitiveGeometry(el, shape);
  el.setAttribute('material', 'color: ' + PRIMITIVE_COLORS[0]);
  el.setAttribute('editor-target', 'kind: primitive; shape: ' + shape + '; colorIndex: 0');
  selectEditorObject(el);
  return el;
}

// A menu activator is a small button primitive that already carries
// projected-menu — "Add menu" (below) is the same operation applied to an
// object that didn't start out as one.
function attachMenuToObject(el, templateSelector) {
  var template = document.querySelector(templateSelector || DEFAULT_ACTIVATOR_TEMPLATE);
  if (!template) return;
  el.setAttribute('projected-menu', {
    template: template,
    mode: 'auto',
    offset: { x: 0, y: 0.3, z: 0 },
    rotationMode: 'auto',
    alwaysOn: false,
  });
}

function spawnActivator() {
  var el = createBaseEditorEntity();
  applyPrimitiveGeometry(el, 'box');
  el.setAttribute('geometry', 'width: 0.12; height: 0.12; depth: 0.06');
  el.setAttribute('material', 'color: #2b2f38');
  el.setAttribute('editor-target', 'kind: activator; shape: box; colorIndex: 0');
  attachMenuToObject(el, DEFAULT_ACTIVATOR_TEMPLATE);
  selectEditorObject(el);
  return el;
}

function spawnPointMarker() {
  if (editorState.spawnPointEl && editorState.spawnPointEl.parentNode) {
    editorState.spawnPointEl.parentNode.removeChild(editorState.spawnPointEl);
  }
  var el = createBaseEditorEntity();
  el.setAttribute('geometry', 'primitive: cone; radiusBottom: 0.12; radiusTop: 0; height: 0.3');
  el.setAttribute('material', 'color: #ffd166');
  el.setAttribute('editor-target', 'kind: spawn-point; shape: cone; colorIndex: 0');
  editorState.spawnPointEl = el;
  selectEditorObject(el);
  return el;
}

function deleteSelected() {
  var el = editorState.selected;
  if (!el) return;
  if (el === editorState.spawnPointEl) editorState.spawnPointEl = null;
  if (el.parentNode) el.parentNode.removeChild(el);
  editorState.selected = null;
  refreshEditPages();
}

// ---------------------------------------------------------------------
// Selection + the watch's Edit page
// ---------------------------------------------------------------------

function selectEditorObject(el) {
  editorState.selected = el;
  refreshEditPages();
  editorState.watches.forEach(function (watch) {
    var pages = watch.panelEl.components['menu-pages'];
    if (pages) pages.showPage('edit');
  });
}

function refreshEditPages() {
  var el = editorState.selected;
  var data = el && el.components['editor-target'] && el.components['editor-target'].data;
  var hasMenu = !!(el && el.components['projected-menu']);

  editorState.watches.forEach(function (watch) {
    var panelEl = watch.panelEl;
    var emptyEl = panelEl.querySelector('.watch-menu-edit-empty');
    var colorEl = panelEl.querySelector('.watch-menu-edit-color');
    var shapeEl = panelEl.querySelector('.watch-menu-edit-shape');
    var templateEl = panelEl.querySelector('.watch-menu-edit-template');
    var rotationEl = panelEl.querySelector('.watch-menu-edit-rotation');
    var alwaysOnEl = panelEl.querySelector('.watch-menu-edit-alwayson');
    var addMenuEl = panelEl.querySelector('.watch-menu-edit-addmenu');
    var deleteEl = panelEl.querySelector('.watch-menu-edit-delete');

    if (emptyEl) emptyEl.setAttribute('visible', !data);
    if (colorEl) colorEl.setAttribute('visible', !!data);
    if (shapeEl) shapeEl.setAttribute('visible', !!data && data.kind === 'primitive');
    if (templateEl) templateEl.setAttribute('visible', hasMenu);
    if (rotationEl) rotationEl.setAttribute('visible', hasMenu);
    if (alwaysOnEl) alwaysOnEl.setAttribute('visible', hasMenu);
    if (addMenuEl) addMenuEl.setAttribute('visible', !!data && !hasMenu && data.kind !== 'spawn-point');
    if (deleteEl) deleteEl.setAttribute('visible', !!data);

    if (!data) return;
    setRowLabel(panelEl, 'watch-menu-edit-color-label', 'Color: ' + cycleLabelFor(CYCLE_FIELDS.color, data.colorIndex));
    if (data.kind === 'primitive') {
      setRowLabel(panelEl, 'watch-menu-edit-shape-label', 'Shape: ' + cycleLabelFor(CYCLE_FIELDS.shape, data.shape));
    }
    if (hasMenu) {
      var pm = el.components['projected-menu'];
      var templateValue = pm.data.template ? '#' + pm.data.template.id : DEFAULT_ACTIVATOR_TEMPLATE;
      setRowLabel(panelEl, 'watch-menu-edit-template-label', 'Window: ' + cycleLabelFor(CYCLE_FIELDS.template, templateValue));
      setRowLabel(panelEl, 'watch-menu-edit-rotation-label', 'Facing: ' + cycleLabelFor(CYCLE_FIELDS.rotationMode, pm.data.rotationMode));
      setRowLabel(panelEl, 'watch-menu-edit-alwayson-label', 'Always on: ' + cycleLabelFor(CYCLE_FIELDS.alwaysOn, pm.data.alwaysOn ? 'on' : 'off'));
    }
  });
}

function applyEditChange(key, value) {
  var el = editorState.selected;
  if (!el) return;
  var targetComp = el.components['editor-target'];
  if (key === 'color') {
    var index = parseInt(value, 10) || 0;
    targetComp.data.colorIndex = index;
    el.setAttribute('editor-target', 'colorIndex', index);
    el.setAttribute('material', 'color', PRIMITIVE_COLORS[index]);
  } else if (key === 'shape') {
    targetComp.data.shape = value;
    el.setAttribute('editor-target', 'shape', value);
    applyPrimitiveGeometry(el, value);
  } else if (key === 'template') {
    // projected-menu clones its panel once, in init() — there's no live
    // "swap the template" support, so changing it means tearing down the
    // old panel/component and attaching a fresh one, carrying the other
    // fields forward.
    var pm = el.components['projected-menu'];
    var priorRotationMode = pm ? pm.data.rotationMode : 'auto';
    var priorAlwaysOn = pm ? pm.data.alwaysOn : false;
    var priorOffset = pm ? pm.data.offset : { x: 0, y: 0.3, z: 0 };
    if (pm && pm.panelEl && pm.panelEl.parentNode) pm.panelEl.parentNode.removeChild(pm.panelEl);
    el.removeAttribute('projected-menu');
    el.setAttribute('projected-menu', {
      template: document.querySelector(value),
      mode: 'auto',
      offset: priorOffset,
      rotationMode: priorRotationMode,
      alwaysOn: priorAlwaysOn,
    });
  } else if (key === 'rotationMode') {
    el.setAttribute('projected-menu', 'rotationMode', value);
  } else if (key === 'alwaysOn') {
    el.setAttribute('projected-menu', 'alwaysOn', value === 'on');
  }
}

// ---------------------------------------------------------------------
// Copy Level export
// ---------------------------------------------------------------------

function serializeEditorObject(el) {
  var data = el.components['editor-target'].data;
  var pos = el.object3D.position;
  var rot = el.object3D.rotation;
  var entry = {
    kind: data.kind,
    position: { x: round3(pos.x), y: round3(pos.y), z: round3(pos.z) },
    rotation: { x: round3(THREE_().MathUtils.radToDeg(rot.x)), y: round3(THREE_().MathUtils.radToDeg(rot.y)), z: round3(THREE_().MathUtils.radToDeg(rot.z)) },
    color: PRIMITIVE_COLORS[data.colorIndex] || PRIMITIVE_COLORS[0],
  };
  if (data.kind === 'primitive') entry.shape = data.shape;
  var pm = el.components['projected-menu'];
  if (pm) {
    entry.template = pm.data.template ? '#' + pm.data.template.id : DEFAULT_ACTIVATOR_TEMPLATE;
    entry.rotationMode = pm.data.rotationMode;
    entry.alwaysOn = pm.data.alwaysOn;
  }
  return entry;
}

function round3(n) { return Math.round(n * 1000) / 1000; }

function copyLevelToClipboard() {
  var objects = Array.prototype.slice.call(document.querySelectorAll('.editor-target')).map(serializeEditorObject);
  var json = JSON.stringify({ objects: objects }, null, 2);
  var showResult = function (text) {
    editorState.watches.forEach(function (watch) {
      var label = watch.panelEl.querySelector('.watch-menu-copy-level-label');
      if (!label) return;
      var original = label.getAttribute('text').value;
      label.setAttribute('text', 'value', text);
      setTimeout(function () { label.setAttribute('text', 'value', original); }, 1500);
    });
  };
  navigator.clipboard.writeText(json).then(function () {
    showResult('Copied!');
  }, function () {
    showResult('Copy failed');
  });
}

// ---------------------------------------------------------------------
// Build Mode: off by default and until toggled, nothing here changes
// anything about how the page behaves. On, it repoints both hands'
// fingertip raycasters at editor objects (plus each watch's OWN panel,
// via the .watch-menu-panel scope, so the toggle and the rest of the
// Build/Edit pages are never unreachable) instead of real-world menus.
// ---------------------------------------------------------------------

function setEditorTargetsPokeEnabled(active) {
  Array.prototype.forEach.call(document.querySelectorAll('.editor-target'), function (el) {
    if (active) el.setAttribute('obb-collider', 'size: 0.14');
    else el.removeAttribute('obb-collider');
  });
}

function setBuildMode(active) {
  editorState.buildMode = active;
  setEditorTargetsPokeEnabled(active);
  editorState.watches.forEach(function (watch) {
    if (watch.fingertipEl) {
      watch.fingertipEl.setAttribute('raycaster', 'objects',
        active ? '.watch-menu-panel .menu-target, .editor-target' : '.menu-target');
    }
    var label = watch.panelEl.querySelector('.watch-menu-build-mode-label');
    if (label) label.setAttribute('text', 'value', 'Build Mode: ' + (active ? 'On' : 'Off'));
    if (active) {
      var pages = watch.panelEl.components['menu-pages'];
      if (pages) pages.showPage('build');
    }
  });
}

// ---------------------------------------------------------------------
// Wiring: collect each watch as it becomes ready, and handle every
// custom menu-item-select value this module owns.
// hand-with-watch's own dispatch (common/watch-menu.js) is untouched —
// it already generically routes "page-<name>" and "<name>-close"
// values, which the Build/Edit page markup relies on.
// ---------------------------------------------------------------------

function wireWatch(panelEl, projectedMenu, fingertipEl) {
  var watch = { panelEl: panelEl, projectedMenu: projectedMenu, fingertipEl: fingertipEl };
  editorState.watches.push(watch);

  panelEl.addEventListener('menu-item-select', function (evt) {
    var value = evt.detail.value;
    if (value === 'toggle-build-mode') setBuildMode(!editorState.buildMode);
    else if (value === 'spawn-primitive-box') spawnPrimitive('box');
    else if (value === 'spawn-primitive-sphere') spawnPrimitive('sphere');
    else if (value === 'spawn-primitive-cylinder') spawnPrimitive('cylinder');
    else if (value === 'spawn-primitive-cone') spawnPrimitive('cone');
    else if (value === 'spawn-activator') spawnActivator();
    else if (value === 'spawn-spawn-point') spawnPointMarker();
    else if (value === 'copy-level') copyLevelToClipboard();
    else if (value === 'editor-delete-selected') deleteSelected();
    else if (value === 'editor-add-menu') {
      if (editorState.selected) attachMenuToObject(editorState.selected, DEFAULT_ACTIVATOR_TEMPLATE);
      refreshEditPages();
    } else if (value === 'editor-cycle-snap-default') {
      editorState.snapDefault = nextCycleValue(SNAP_DEFAULT_CYCLE, editorState.snapDefault);
      setRowLabel(panelEl, 'watch-menu-snap-default-label', 'Hold-to: ' + cycleLabelFor(SNAP_DEFAULT_CYCLE, editorState.snapDefault));
    } else if (value.indexOf('editor-cycle-') === 0) {
      var field = value.slice('editor-cycle-'.length);
      var cycle = CYCLE_FIELDS[field];
      if (cycle) {
        applyEditChange(field, nextCycleValue(cycle, getCurrentCycleValue(field)));
        refreshEditPages();
      }
    }
  });
}

function getCurrentCycleValue(field) {
  var el = editorState.selected;
  var data = el && el.components['editor-target'] && el.components['editor-target'].data;
  if (!data) return '';
  if (field === 'color') return String(data.colorIndex);
  if (field === 'shape') return data.shape;
  var pm = el.components['projected-menu'];
  if (!pm) return '';
  if (field === 'template') return pm.data.template ? '#' + pm.data.template.id : DEFAULT_ACTIVATOR_TEMPLATE;
  if (field === 'rotationMode') return pm.data.rotationMode;
  if (field === 'alwaysOn') return pm.data.alwaysOn ? 'on' : 'off';
  return '';
}

function init() {
  setupHandTracking();
  document.addEventListener('watch-menu-ready', function (evt) {
    wireWatch(evt.detail.panelEl, evt.detail.projectedMenu, evt.detail.fingertipEl);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
