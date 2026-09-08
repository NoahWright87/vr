// ============================================================
// MENU MODEL
//
// The navigation half of the shared menu system, deliberately free of
// A-Frame, THREE, and the DOM so it can be tested with `node --test`
// (see tests/menu-model.test.js) rather than only through a browser.
// A renderer turns what this exposes into geometry; this file decides
// what is focused, what is visible, and what a press means.
//
// The shape of the thing, in one paragraph: a menu is a stack of
// LEVELS. Every level is a list with a focus index, and everything a
// player can change is a level — picking a teleport destination, and
// picking a number of targets, are the same gesture at different
// depths. There is no separate "adjust this value sideways" verb, so
// there is no ambiguity about what left/right means, and a renderer
// only ever has to draw one thing: a windowed list with a focused row.
//
// The two level kinds differ only in where their rows come from:
//
//   list   - rows come from an array (menu items, or the choices of a
//            select).
//   number - rows are generated from min/max/step on demand. This is
//            why a 0-20 speed knob with a 0.1 step doesn't materialise
//            201 objects: the level knows its count and can compute
//            the handful of values around the focus, so it renders
//            like an endless list without being one.
//
// Both are driven by the same windowing code below, which is most of
// the reason the model is this small.
// ============================================================

export var MENU_DEFAULTS = {
  // Rows a surface can show at once. Odd on purpose: there is always a
  // centre row, with an equal number flanking it.
  windowSize: 5,
  // Lists wrap; numbers never do (rolling a clamped speed from 20 back
  // to 0 while nudging it is a nasty surprise, and clamping is the
  // whole point of having a min/max). Wrapping also switches itself off
  // when a list is shorter than the window, or the same row would be
  // visible twice - once above the focus and once below it.
  wrap: true,
  // 'none' always reopens at the root; 'permanent' always reopens
  // where you left off; 'temporary' reopens where you left off only if
  // you were gone less than memoryMs. Temporary is the default because
  // the common case is closing a menu to deal with something and
  // coming straight back.
  memory: 'temporary',
  memoryMs: 60000,
  // The menu's own controls, reached by pressing outward at the root.
  // They live in the title bar, and being part of the focus ring is the
  // point: a close button you can only reach by pointing is unreachable
  // to anyone driving with a stick or a keyboard.
  chrome: [{ id: 'close', label: 'Close' }],
  // How many ancestor titles a renderer may draw alongside the current
  // level. The renderer fades them; this only caps how many it hears
  // about, since a watch face has room for about one.
  breadcrumbDepth: 3,
};

var VALID_MEMORY = ['none', 'temporary', 'permanent'];

// Numbers are built from an integer step index rather than by
// repeatedly adding `step` to a float, so 0.1 increments don't drift
// into 0.30000000000000004 after thirty presses.
function stepCount(item) {
  var span = item.max - item.min;
  if (!(span > 0) || !(item.step > 0)) return 0;
  return Math.round(span / item.step);
}

function valueAtStep(item, index) {
  var raw = item.min + index * item.step;
  // Round to the precision the step itself implies, so a 0.1 step
  // yields 1.3 rather than 1.3000000000000003.
  var decimals = decimalsOf(item.step);
  var factor = Math.pow(10, decimals);
  return Math.round(raw * factor) / factor;
}

function decimalsOf(step) {
  var text = String(step);
  var dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function stepOfValue(item, value) {
  if (!(item.step > 0)) return 0;
  var index = Math.round((value - item.min) / item.step);
  return clampInt(index, 0, stepCount(item));
}

function clampInt(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function resolveItems(source) {
  var items = typeof source === 'function' ? source() : source;
  return Array.isArray(items) ? items : [];
}

// A select row reads "Targets: 8" at rest but its submenu is titled
// just "Targets" - the value slides out of the label and becomes the
// thing you're choosing.
function formatItemLabel(item) {
  if (!item) return '';
  if (item.kind === 'select') {
    var option = findOption(item, item.value);
    return item.label + ': ' + (option ? option.label : String(item.value));
  }
  if (item.kind === 'number') {
    return item.label + ': ' + formatNumber(item, item.value);
  }
  if (item.kind === 'toggle') {
    return item.label + ': ' + (item.value ? (item.onLabel || 'On') : (item.offLabel || 'Off'));
  }
  return item.label;
}

function formatNumber(item, value) {
  if (typeof item.format === 'function') return item.format(value);
  return value.toFixed(decimalsOf(item.step)) + (item.suffix || '');
}

function findOption(item, value) {
  var options = resolveItems(item.options);
  for (var i = 0; i < options.length; i++) {
    if (options[i].value === value) return options[i];
  }
  return null;
}

function optionIndexOf(item, value) {
  var options = resolveItems(item.options);
  for (var i = 0; i < options.length; i++) {
    if (options[i].value === value) return i;
  }
  return 0;
}

// ============================================================
// LEVELS
// ============================================================

function makeListLevel(title, items, index, source) {
  return {
    kind: 'list',
    title: title,
    items: items,
    index: clampInt(index || 0, 0, Math.max(0, items.length - 1)),
    source: source || null,
  };
}

function makeNumberLevel(item) {
  return {
    kind: 'number',
    title: item.label,
    item: item,
    index: stepOfValue(item, item.value),
    source: item,
  };
}

function levelCount(level) {
  return level.kind === 'number' ? stepCount(level.item) + 1 : level.items.length;
}

// Rows are addressed by index so the number level never has to build
// an array. A list hands back the real item; a number synthesises a
// row that looks like one to a renderer.
function levelRowAt(level, index) {
  if (level.kind === 'number') {
    var value = valueAtStep(level.item, index);
    return { kind: 'value', label: formatNumber(level.item, value), value: value };
  }
  var item = level.items[index];
  if (!item) return null;
  if (item.kind === 'option') {
    return { kind: 'value', label: item.label, value: item.value, item: item };
  }
  return {
    kind: item.kind,
    label: formatItemLabel(item),
    value: item.value,
    item: item,
    hasChildren: item.kind === 'submenu' || item.kind === 'select' || item.kind === 'number',
    disabled: item.disabled === true,
  };
}

// ============================================================
// THE MENU
// ============================================================

export function createMenu(page, options) {
  return new MenuModel(page, options);
}

export function MenuModel(page, options) {
  var opts = options || {};
  this.page = page || { title: '', items: [] };
  this.windowSize = Math.max(1, opts.windowSize || MENU_DEFAULTS.windowSize);
  // An even window has no centre row to put the focus on. Round up
  // rather than throwing: a surface that asks for 4 rows gets 5.
  if (this.windowSize % 2 === 0) this.windowSize += 1;
  this.wrapEnabled = opts.wrap === undefined ? MENU_DEFAULTS.wrap : Boolean(opts.wrap);
  this.memory = VALID_MEMORY.indexOf(opts.memory) === -1 ? MENU_DEFAULTS.memory : opts.memory;
  this.memoryMs = opts.memoryMs === undefined ? MENU_DEFAULTS.memoryMs : opts.memoryMs;
  this.breadcrumbDepth = opts.breadcrumbDepth === undefined
    ? MENU_DEFAULTS.breadcrumbDepth
    : opts.breadcrumbDepth;
  this.chrome = opts.chrome || MENU_DEFAULTS.chrome;
  // Injectable so memory expiry is testable without waiting a minute.
  this.now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };

  this.listeners = {};
  this.isOpen = false;
  this.stack = [];
  this.closedAt = null;
  // null while the list has the focus; an index into `chrome` once the
  // title bar does.
  this.chromeIndex = null;
  this.reset();
}

MenuModel.prototype.reset = function () {
  this.stack = [makeListLevel(this.page.title || '', resolveItems(this.page.items), 0, null)];
  this.chromeIndex = null;
};

MenuModel.prototype.on = function (event, handler) {
  (this.listeners[event] = this.listeners[event] || []).push(handler);
  return this;
};

MenuModel.prototype.emit = function (event, detail) {
  var handlers = this.listeners[event] || [];
  for (var i = 0; i < handlers.length; i++) handlers[i](detail);
  if (event !== 'change') this.emit('change', { event: event, detail: detail });
};

MenuModel.prototype.level = function () {
  return this.stack[this.stack.length - 1];
};

MenuModel.prototype.depth = function () {
  return this.stack.length - 1;
};

// ---------- opening and closing ----------

MenuModel.prototype.open = function () {
  if (this.isOpen) return;
  var expired = this.memory === 'none' ||
    (this.memory === 'temporary' &&
      (this.closedAt === null || this.now() - this.closedAt > this.memoryMs));
  if (expired) this.reset();
  this.isOpen = true;
  this.emit('open', { restored: !expired });
};

MenuModel.prototype.close = function () {
  if (!this.isOpen) return;
  this.chromeIndex = null;
  this.isOpen = false;
  this.closedAt = this.now();
  this.emit('close', {});
};

// ---------- navigation ----------

// The one vertical verb. Wrapping is decided per level rather than per
// menu, because a list of twelve towns wants it and a clamped number
// never does.
MenuModel.prototype.inChrome = function () {
  return this.chromeIndex !== null;
};

MenuModel.prototype.getChromeFocus = function () {
  return this.chromeIndex === null ? null : this.chrome[this.chromeIndex];
};

MenuModel.prototype.getChrome = function () {
  return this.chrome;
};

MenuModel.prototype.moveFocus = function (delta) {
  // With one control in the title bar there is nowhere to move inside
  // it, so stepping drops back into the list rather than doing nothing.
  // A menu that swallows your input without visibly changing reads as
  // broken, and this is the only place that could happen.
  if (this.chromeIndex !== null) {
    if (this.chrome.length <= 1) {
      this.chromeIndex = null;
      this.emit('chrome-focus', { control: null });
      return this.moveFocus(delta) || true;
    }
    var next = clampInt(this.chromeIndex + delta, 0, this.chrome.length - 1);
    if (next === this.chromeIndex) return false;
    this.chromeIndex = next;
    this.emit('chrome-focus', { control: this.getChromeFocus() });
    return true;
  }
  var level = this.level();
  var count = levelCount(level);
  if (!count) return false;
  var next = level.index + delta;
  if (this.levelWraps(level)) {
    next = ((next % count) + count) % count;
  } else {
    next = clampInt(next, 0, count - 1);
  }
  if (next === level.index) return false;
  level.index = next;
  this.emit('focus', { index: next, row: this.focusedRow() });
  // A value level previews as you scroll unless the item opted out -
  // watching the target count change while you pick it is most of why
  // this is nicer than a text field. Expensive settings set
  // applyOn:'select' and wait for the commit on the way back out.
  if (this.levelPreviews(level)) this.applyLevelValue(level, 'preview');
  return true;
};

MenuModel.prototype.levelWraps = function (level) {
  if (level.kind === 'number') return false;
  return this.wrapEnabled && levelCount(level) > this.windowSize;
};

MenuModel.prototype.levelPreviews = function (level) {
  if (!level.source) return false;
  if (level.source.kind !== 'select' && level.source.kind !== 'number') return false;
  return level.source.applyOn !== 'select';
};

// The inward verb: face button, stick-inward, or a tap on the focused
// row. What it does is decided by the focused row's own kind, and each
// case is visible from the row itself, so nothing here is a surprise.
// Moving inward: into a submenu from the list, or out of the title bar
// and back into the list. Distinct from activate() so that pressing
// right on a chrome control returns to the list instead of firing it —
// confirming is what the face button is for.
MenuModel.prototype.forward = function () {
  if (this.chromeIndex !== null) {
    this.chromeIndex = null;
    this.emit('chrome-focus', { control: null });
    return true;
  }
  return this.activate();
};

MenuModel.prototype.activate = function () {
  if (this.chromeIndex !== null) {
    var control = this.getChromeFocus();
    this.emit('chrome-action', { control: control, id: control.id });
    if (control.id === 'close') this.close();
    return true;
  }
  var level = this.level();
  var row = this.focusedRow();
  if (!row || row.disabled) return false;

  // Inside a value level, inward means the same as outward: take this
  // one. Otherwise picking a number would need a verb of its own.
  if (level.kind === 'number' || (level.source && level.source.kind === 'select')) {
    this.emit('activate', { row: row, item: level.source });
    return this.back();
  }

  var item = row.item;
  if (!item) return false;

  // Announced for every kind, before any of them acts. Most kinds leave
  // something visibly different behind — a toggle flips its label, a
  // submenu pushes a new list — but an action's whole effect happens
  // somewhere else in the game, so without a signal here, confirming
  // "Reset Boxes" is indistinguishable from a press that was dropped.
  // A surface can answer this however it likes; what the model is
  // saying is only that a row fired.
  this.emit('activate', { row: row, item: item });

  if (item.kind === 'toggle') {
    // Toggles are the one kind that would be silly as a submenu.
    item.value = !item.value;
    this.emit('commit', { item: item, value: item.value });
    return true;
  }

  if (item.kind === 'action') {
    this.emit('action', { item: item, id: item.id });
    if (item.closeOnActivate) this.close();
    return true;
  }

  if (item.kind === 'submenu') {
    var items = resolveItems(item.items);
    this.stack.push(makeListLevel(item.label, items, 0, item));
    this.emit('push', { title: item.label, depth: this.depth() });
    return true;
  }

  if (item.kind === 'select') {
    var options = resolveItems(item.options).map(function (option) {
      return { kind: 'option', label: option.label, value: option.value };
    });
    this.stack.push(makeListLevel(item.label, options, optionIndexOf(item, item.value), item));
    this.emit('push', { title: item.label, depth: this.depth() });
    return true;
  }

  if (item.kind === 'number') {
    this.stack.push(makeNumberLevel(item));
    this.emit('push', { title: item.label, depth: this.depth() });
    return true;
  }

  if (item.kind === 'custom') {
    this.emit('action', { item: item, id: item.id });
    return true;
  }

  return false;
};

// The outward verb. Backing out of a value level IS the commit - there
// is no cancel, deliberately. The value has been live since you
// scrolled to it, so "undo" is going back in and picking the old one,
// and adding a second button to mean discard would cost more than it
// buys.
MenuModel.prototype.back = function () {
  // Already on the title bar: stay put. Pressing outward repeatedly
  // should not fall out of the menu entirely.
  if (this.chromeIndex !== null) return false;
  if (this.stack.length <= 1) {
    // At the root, outward moves onto the menu's own controls rather
    // than closing. Closing by pressing left one time too many is an
    // accident waiting to happen; landing on a Close button you then
    // have to confirm is the same gesture made deliberate.
    if (!this.chrome.length) return false;
    this.chromeIndex = 0;
    this.emit('chrome-focus', { control: this.getChromeFocus() });
    return true;
  }
  var level = this.stack.pop();
  if (level.source) this.applyLevelValue(level, 'commit');
  this.emit('pop', { depth: this.depth() });
  return true;
};

MenuModel.prototype.applyLevelValue = function (level, phase) {
  var item = level.source;
  if (!item) return;
  var value;
  if (level.kind === 'number') {
    value = valueAtStep(item, level.index);
  } else {
    var row = levelRowAt(level, level.index);
    if (!row) return;
    value = row.value;
  }
  item.value = value;
  this.emit(phase, { item: item, value: value });
};

// ---------- what a renderer draws ----------

MenuModel.prototype.focusedRow = function () {
  var level = this.level();
  return levelRowAt(level, level.index);
};

// The visible slice, focus always at offset 0. Slots with nothing in
// them simply aren't returned: a three-item list in a five-row window
// draws three rows and leaves the outer slots empty rather than
// resizing the panel, so nothing shifts underneath you as you
// navigate.
MenuModel.prototype.getWindow = function () {
  var level = this.level();
  var count = levelCount(level);
  var half = (this.windowSize - 1) / 2;
  var wraps = this.levelWraps(level);
  var rows = [];
  for (var offset = -half; offset <= half; offset++) {
    var index = level.index + offset;
    if (wraps) {
      index = ((index % count) + count) % count;
    } else if (index < 0 || index >= count) {
      continue;
    }
    var row = levelRowAt(level, index);
    if (!row) continue;
    row.index = index;
    row.offset = offset;
    row.focused = offset === 0;
    rows.push(row);
  }
  return rows;
};

// Nearest first: index 0 is the level you're in, 1 its parent, and so
// on. The root's own title belongs in the panel's title bar rather
// than the breadcrumb rail, so it is never included.
MenuModel.prototype.getBreadcrumbs = function () {
  var crumbs = [];
  for (var i = this.stack.length - 1; i >= 1; i--) {
    if (crumbs.length >= this.breadcrumbDepth) break;
    crumbs.push({ title: this.stack[i].title, depth: crumbs.length });
  }
  return crumbs;
};

MenuModel.prototype.getTitle = function () {
  return this.page.title || '';
};

// True when there are rows the window can't currently show, which is
// what a renderer needs to decide whether to draw more-above /
// more-below affordances for someone navigating by pointing.
MenuModel.prototype.hasOverflow = function () {
  return levelCount(this.level()) > this.windowSize;
};

// Pointing at a row that isn't the focus should scroll to it rather
// than select it, so a tap is always safe. Renderers hand back the
// offset they drew.
MenuModel.prototype.focusOffset = function (offset) {
  if (!offset) return false;
  return this.moveFocus(offset);
};
