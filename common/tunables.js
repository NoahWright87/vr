// ============================================================
// TUNABLES — every number a system wants tuned by feel, declared once.
//
// A system declares a group of values; this turns the group into a
// crossbar submenu (number / toggle / select rows that preview while
// scrolled and commit on back-out), a text summary of every value for
// the sidecar (one screenshot = one tuned setup), persistence per page,
// and import/export so a setup travels as a link.
//
//   var tune = defineTunables('gun', 'Gun', [
//     { key: 'rate', label: 'Rate', value: 4, min: 1, max: 20, step: 1, unit: '/s' },
//     { key: 'coneDeg', label: 'Cone', value: 35, min: 5, max: 180, step: 5, unit: '°' },
//     { key: 'aim', label: 'Aim', kind: 'select', value: 'soft',
//       options: [{ value: 'none', label: 'None' }, { value: 'soft', label: 'Soft' }] },
//     { key: 'tracers', label: 'Tracers', kind: 'toggle', value: true },
//   ], function (values, key) { ... });
//   tune.values.rate        // read it wherever it's needed, every frame
//   tune.menuItem()         // a submenu item for any crossbar page
//
// Values are stored in the system's own units. A `scale` shows them in
// friendlier ones (0.55 shown as 55 with scale: 100).
//
// The model half (everything above the DOM section) is plain functions
// and is tested by tests/tunables.test.js.
// ============================================================

// ---------- model ----------

function roundToStep(value, def) {
  if (!def.step) return value;
  var base = def.min || 0;
  var steps = Math.round((value - base) / def.step);
  // Kill float dust (0.30000000000000004) so values compare and print cleanly.
  return Math.round((base + steps * def.step) * 1e6) / 1e6;
}

function scaleOf(def) { return def.scale || 1; }

// Clamp and step a value given in the def's own (stored) units.
export function normalizeTunable(def, value) {
  var kind = def.kind || 'number';
  if (kind === 'toggle') return Boolean(value);
  if (kind === 'select') {
    var options = def.options || [];
    for (var i = 0; i < options.length; i++) if (options[i].value === value) return value;
    return def.value;
  }
  var n = Number(value);
  if (!isFinite(n)) return def.value;
  var s = scaleOf(def);
  var shown = roundToStep(n * s, { min: def.min, step: def.step });
  if (def.min !== undefined) shown = Math.max(def.min, shown);
  if (def.max !== undefined) shown = Math.min(def.max, shown);
  return Math.round((shown / s) * 1e9) / 1e9;
}

export function createTunableGroup(id, label, defs) {
  var values = {};
  var byKey = {};
  defs.forEach(function (def) {
    byKey[def.key] = def;
    values[def.key] = def.value;
  });
  return { id: id, label: label, defs: defs, byKey: byKey, values: values };
}

// Returns the value actually stored (after clamping), or undefined for
// an unknown key.
export function setTunable(group, key, value) {
  var def = group.byKey[key];
  if (!def) return undefined;
  group.values[key] = normalizeTunable(def, value);
  return group.values[key];
}

export function resetTunables(group) {
  group.defs.forEach(function (def) { group.values[def.key] = def.value; });
}

// The value as a menu row shows it, and back.
export function toMenuValue(def, value) {
  if ((def.kind || 'number') !== 'number') return value;
  return Math.round(value * scaleOf(def) * 1e6) / 1e6;
}

export function fromMenuValue(def, value) {
  if ((def.kind || 'number') !== 'number') return value;
  return value / scaleOf(def);
}

export function formatTunable(def, value) {
  var kind = def.kind || 'number';
  if (kind === 'toggle') return value ? (def.onLabel || 'On') : (def.offLabel || 'Off');
  if (kind === 'select') {
    var options = def.options || [];
    for (var i = 0; i < options.length; i++) if (options[i].value === value) return options[i].label;
    return String(value);
  }
  var shown = toMenuValue(def, value);
  return String(shown) + (def.unit || '');
}

// One line per value — what the sidecar shows.
export function summarizeTunables(group) {
  return group.defs.map(function (def) {
    return def.label + ' ' + formatTunable(def, group.values[def.key]);
  }).join('\n');
}

// Only values that differ from the defaults — short enough for a URL.
export function changedTunables(group) {
  var out = {};
  group.defs.forEach(function (def) {
    if (group.values[def.key] !== def.value) out[def.key] = group.values[def.key];
  });
  return out;
}

export function applyTunables(group, data) {
  if (!data || typeof data !== 'object') return;
  Object.keys(data).forEach(function (key) { setTunable(group, key, data[key]); });
}

// base64url(JSON) — safe in a query string.
export function encodeTuneParam(data) {
  var json = JSON.stringify(data);
  var b64 = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeTuneParam(text) {
  try {
    var b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var json = typeof atob === 'function'
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, 'base64').toString('utf8');
    var data = JSON.parse(json);
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

// ---------- the page side: registry, menus, persistence ----------

var groups = {}; // id -> handle
var order = [];
var wired = false;

function storageKey(id) {
  var page = typeof location !== 'undefined' ? location.pathname : '';
  return 'tunables:' + page + ':' + id;
}

function readStored(id) {
  try {
    var raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function writeStored(handle) {
  try {
    localStorage.setItem(storageKey(handle.group.id), JSON.stringify(changedTunables(handle.group)));
  } catch (e) { /* private window or blocked storage: values just don't persist */ }
}

function readUrlParam() {
  try {
    var params = new URLSearchParams(location.search);
    var raw = params.get('tune');
    return raw ? decodeTuneParam(raw) : null;
  } catch (e) { return null; }
}

function rowId(groupId, key) { return 'tune.' + groupId + '.' + key; }

function parseRowId(id) {
  if (typeof id !== 'string' || id.indexOf('tune.') !== 0) return null;
  var rest = id.slice(5);
  var dot = rest.indexOf('.');
  if (dot < 0) return null;
  return { group: rest.slice(0, dot), key: rest.slice(dot + 1) };
}

function change(handle, key, value, persist) {
  var before = handle.group.values[key];
  var stored = setTunable(handle.group, key, value);
  if (stored === undefined) return;
  if (persist) writeStored(handle);
  if (stored !== before && handle.onChange) handle.onChange(handle.group.values, key);
}

function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  // Number and select rows preview while they're scrolled, so a value
  // can be found by feel; backing out commits (and persists) it.
  document.addEventListener('menu-preview', function (evt) {
    var ref = parseRowId(evt.detail && evt.detail.id);
    var handle = ref && groups[ref.group];
    if (!handle) return;
    var def = handle.group.byKey[ref.key];
    if (def) change(handle, ref.key, fromMenuValue(def, evt.detail.value), false);
  });
  document.addEventListener('menu-commit', function (evt) {
    var ref = parseRowId(evt.detail && evt.detail.id);
    var handle = ref && groups[ref.group];
    if (!handle) return;
    var def = handle.group.byKey[ref.key];
    if (def) change(handle, ref.key, fromMenuValue(def, evt.detail.value), true);
  });
  document.addEventListener('menu-action', function (evt) {
    var id = evt.detail && evt.detail.id;
    if (id === 'tune.copy') { copyAllTunables(); return; }
    if (id === 'tune.reset-all') { order.forEach(function (gid) { groups[gid].reset(); }); return; }
    var ref = parseRowId(id);
    var handle = ref && groups[ref.group];
    if (handle && ref.key === '__reset') handle.reset();
  });
}

// Every group's changed values as one object, and a ?tune= link for it.
export function exportAllTunables() {
  var data = {};
  order.forEach(function (id) {
    var changed = changedTunables(groups[id].group);
    if (Object.keys(changed).length) data[id] = changed;
  });
  var url = '';
  if (typeof location !== 'undefined') {
    var params = new URLSearchParams(location.search);
    params.set('tune', encodeTuneParam(data));
    url = location.origin + location.pathname + '?' + params.toString();
  }
  return { data: data, url: url };
}

export function copyAllTunables() {
  var out = exportAllTunables();
  var text = JSON.stringify(out.data, null, 1) + '\n' + out.url;
  // The console always works; the clipboard often doesn't in XR.
  console.log('[tunables]\n' + text);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
  } catch (e) { /* no clipboard: the console has it */ }
  return out;
}

export function getTunables(id) { return groups[id] || null; }
export function listTunables() { return order.map(function (id) { return groups[id]; }); }

// Declare a group. Values load from the defaults, then this page's saved
// values, then a ?tune= link (which wins). Defining the same id twice
// returns the existing group, so modules can share one. options.info is
// a readout (string or live function) shown above the values.
export function defineTunables(id, label, defs, onChange, options) {
  if (groups[id]) {
    if (onChange) groups[id].listeners.push(onChange);
    return groups[id];
  }
  var group = createTunableGroup(id, label, defs);
  applyTunables(group, readStored(id));
  var fromUrl = readUrlParam();
  if (fromUrl && fromUrl[id]) applyTunables(group, fromUrl[id]);

  var handle = {
    group: group,
    values: group.values,
    options: options || {},
    listeners: onChange ? [onChange] : [],
    onChange: function (values, key) {
      handle.listeners.forEach(function (fn) { fn(values, key); });
    },
    get: function (key) { return group.values[key]; },
    set: function (key, value) { change(handle, key, value, true); },
    reset: function () {
      resetTunables(group);
      writeStored(handle);
      handle.onChange(group.values, null);
    },
    summary: function () { return summarizeTunables(group); },
    // A crossbar submenu for this group. `info` adds a readout above the
    // values (a function is re-read live — see liveInfo).
    menuItem: function (overrides) {
      var options = Object.assign({}, handle.options, overrides || {});
      return {
        kind: 'submenu',
        id: 'tune.' + id,
        label: options.label || label,
        liveInfo: Boolean(options.info),
        info: function () {
          var head = typeof options.info === 'function' ? options.info() : (options.info || '');
          return (head ? head + '\n\n' : '') + summarizeTunables(group);
        },
        items: function () {
          return group.defs.map(function (def) {
            var kind = def.kind || 'number';
            var item = { kind: kind, id: rowId(id, def.key), label: def.label, value: toMenuValue(def, group.values[def.key]) };
            if (def.info) item.info = def.info;
            if (kind === 'number') {
              item.min = def.min; item.max = def.max; item.step = def.step;
              item.format = function (v) { return String(v) + (def.unit || ''); };
            }
            if (kind === 'select') item.options = def.options;
            if (kind === 'toggle') { item.onLabel = def.onLabel; item.offLabel = def.offLabel; }
            return item;
          }).concat([{ kind: 'action', id: rowId(id, '__reset'), label: 'Defaults' }]);
        },
      };
    },
  };
  groups[id] = handle;
  order.push(id);
  wire();
  return handle;
}

// A "Tuning" submenu with every group on the page, plus copy and reset.
export function tuningMenuItem(label) {
  return {
    kind: 'submenu', id: 'tune.all', label: label || 'Tuning',
    info: 'Every value here is saved for this page.\nCopy settings prints them, and a ?tune= link that loads them, to the console.',
    items: function () {
      return order.map(function (id) { return groups[id].menuItem(); }).concat([
        { kind: 'action', id: 'tune.copy', label: 'Copy settings' },
        { kind: 'action', id: 'tune.reset-all', label: 'Reset all' },
      ]);
    },
  };
}
