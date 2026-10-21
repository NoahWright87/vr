// ============================================================
// VISOR HUD — what the visor shows when its menu is closed.
//
// Halo's HUD is clearly a display on Master Chief's visor: a curved band
// of readouts at the edges of his view, with the middle left for the
// world. This is that, in a headset, as a shared system any game can put
// things on. It owns three things:
//
//   The frame.   One calibrated rectangle in your view (common/visor-
//                frame.js) that the HUD and the visor menu are laid out
//                in. Adjusted from Visor ▸ Adjust, with every slot shown
//                as a grey box while you do; saved in localStorage, shared
//                by every game unless a game is switched to its own.
//
//   The slots.   Fixed places on the frame — four corner squares, a bar
//                along the top and bottom, and the reticle with a line for
//                a hint above and below it. A game puts widgets in them:
//
//                  var hud = sceneEl.systems['visor-hud'];
//                  var ammo = hud.add('bottom-right', {
//                    id: 'ammo',
//                    draw: function (ctx, box) { drawAmmo(ctx, 0, 0, box.w, box.h, box.state.count, 6); },
//                  });
//                  ammo.set({ count: 5 });   // redraws only if it changed
//
//                Each widget is a canvas bent onto the visor, so it draws
//                with the plain 2D canvas API (and common/hud-draw.js's
//                shared pieces); the canvas is always 100 units tall and
//                as wide as its share of the slot. It is redrawn only when
//                its state changes.
//
//   Hints.       The lines above and below the reticle, for "[X] Pick up"
//                prompts: hud.setHint(id, { key, text, slot }).
//
// Widgets that have not changed for a few seconds dim, and light up again
// when they do (preference: idleFade) — a car dashboard, not a billboard.
// While the visor menu is open the HUD steps back: the corners on the
// menu's side go, everything else dims.
//
// Everything here is drawn over the world in stereo, at the frame's
// distance, the same way the visor menu is (see menu-crossbar.js's
// overlayAll): both eyes converge where it is, so it is comfortable to
// read, and nothing in the room can cut through it. The reticle and its
// hints are the exception in depth only: they are where you are looking,
// so they move out to the distance of whatever is locked (a centre
// readout at 1.8 m while you look at something 20 m away would be seen
// double), scaled so they stay the same size.
// ============================================================

import {
  FRAME_DEFAULTS, clampFrame, sheetToCamera, layoutSlots, splitSlot, menuLayout,
  gameKey, loadCalibration, saveCalibration, switchScope,
  loadPreferences, savePreferences, cleanPreferences, sheetOffsetForAngle, SLOT_NAMES,
} from './visor-frame.js';
import { HUD_COLORS, drawText, drawKeyHint, roundRect } from './hud-draw.js';
import { OVERLAY_RENDER_ORDER } from './menu-crossbar.js';

var FONT_FILES = [
  ['B612', new URL('../vendor/fonts/B612-Regular.woff2', import.meta.url).href, '400'],
  ['B612', new URL('../vendor/fonts/B612-Bold.woff2', import.meta.url).href, '700'],
  ['Wright Sans', new URL('../vendor/fonts/WrightSans-Bold.woff2', import.meta.url).href, '700'],
  ['Wright Sans', new URL('../vendor/fonts/WrightSans-Black.woff2', import.meta.url).href, '900'],
];

var fontsReady = null;
// The HUD's fonts, loaded once per page. Resolves either way: a widget
// drawn before (or without) them falls back to system-ui and is redrawn
// when they arrive.
export function loadHudFonts() {
  if (fontsReady) return fontsReady;
  if (typeof FontFace === 'undefined' || !document.fonts) return (fontsReady = Promise.resolve());
  fontsReady = Promise.all(FONT_FILES.map(function (file) {
    var face = new FontFace(file[0], 'url(' + file[1] + ')', { weight: file[2] });
    return face.load().then(function (loaded) { document.fonts.add(loaded); }, function () {});
  }));
  return fontsReady;
}

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;
  var DEG = Math.PI / 180;

  // Canvas pixels per degree of view. A Quest 2 shows about 20; a little
  // over that keeps text crisp once mipmapped.
  var PIXELS_PER_DEGREE = 26;
  // A dimmed widget's share of full opacity, and how long a widget stays
  // lit after it last changed.
  var IDLE_LEVEL = 0.4;
  var IDLE_AFTER_MS = 4000;
  // While the visor menu is open.
  var MENU_DIM = 0.3;
  // Below the visor menu (which is OVERLAY_RENDER_ORDER), so the menu
  // draws over the HUD; the adjustment preview is above the widgets.
  var WIDGET_ORDER = OVERLAY_RENDER_ORDER - 20;
  var PREVIEW_ORDER = OVERLAY_RENDER_ORDER - 10;
  // How quickly the reticle's depth follows a new focus, ms.
  var FOCUS_EASE_MS = 160;
  var CORNERS = { 'top-left': 'left', 'bottom-left': 'left', 'top-right': 'right', 'bottom-right': 'right' };
  var CENTRE_SLOTS = { reticle: true, above: true, below: true };
  var VERTICAL_SLOTS = { 'top-left': true, 'top-right': true, 'bottom-left': true, 'bottom-right': true };

  function storage() {
    try { return window.localStorage; } catch (err) { return null; }
  }

  function inXR(sceneEl) {
    var mode = sceneEl.systems['control-mode'];
    return mode ? mode.isMode('xr') : sceneEl.is('vr-mode');
  }

  // A curved patch of the frame: a grid of vertices laid out over `rect`
  // on the flat sheet, each bent onto the visor. Fine enough that the
  // bend reads as a curve rather than facets — one column every 2.5°.
  function buildPatch(rect, frame) {
    var angW = rect.w / frame.distance / DEG;
    var angH = rect.h / frame.distance / DEG;
    var segX = Math.max(1, Math.min(48, Math.ceil(angW / 2.5)));
    var segY = Math.max(1, Math.min(24, Math.ceil(angH / 2.5)));
    var geometry = new THREE.PlaneGeometry(1, 1, segX, segY);
    var position = geometry.attributes.position;
    var point = {};
    for (var i = 0; i < position.count; i++) {
      sheetToCamera(rect.x + position.getX(i) * rect.w, rect.y + position.getY(i) * rect.h, frame, point);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
    return geometry;
  }

  // ============================================================
  // A widget: one canvas on the visor.
  // ============================================================
  function Widget(system, slot, options) {
    this.system = system;
    this.slot = slot;
    this.id = options.id;
    this.order = options.order || 0;
    this.weight = options.weight || 1;
    this.drawFn = options.draw;
    this.fade = options.fade !== false;
    this.fps = options.fps || 0;
    this.ppd = options.ppd || PIXELS_PER_DEGREE;
    this.visible = options.visible !== false;
    // Internal widgets (hints, the adjustment preview) ignore the HUD
    // on/off preference and the menu dimming.
    this.internal = Boolean(options.internal);
    this.state = Object.assign({}, options.state);
    this.rect = null;
    this.dirty = true;
    this.wakeAt = 0;
    this.lastDraw = -Infinity;
    this.opacity = 0;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    if (THREE.SRGBColorSpace) this.texture.colorSpace = THREE.SRGBColorSpace;
    // A widget can show a texture it is handed instead of drawing — a
    // render target, say, for a live camera feed in a corner of the visor.
    // The HUD bends and fades it like any other and never disposes it.
    this.external = options.texture || null;
    this.material = new THREE.MeshBasicMaterial({
      map: this.external || this.texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.renderOrder = options.renderOrder || WIDGET_ORDER;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'hud-' + (this.id || slot);
  }

  // Merge `state` in; redraw (and light up) only if something changed.
  Widget.prototype.set = function (state) {
    var changed = false;
    for (var key in state) {
      if (this.state[key] !== state[key]) {
        this.state[key] = state[key];
        changed = true;
      }
    }
    if (changed) this.update();
    return this;
  };

  // Redraw, and light up if dimmed.
  Widget.prototype.update = function () {
    this.dirty = true;
    this.wake();
    return this;
  };

  // Redraw without lighting up: for things that change all the time
  // (a minimap, a compass) where a change is not news.
  Widget.prototype.redraw = function () {
    this.dirty = true;
    return this;
  };

  Widget.prototype.wake = function () {
    this.wakeAt = this.system.now;
    return this;
  };

  Widget.prototype.show = function (visible) {
    visible = visible !== false;
    if (visible === this.visible) return this;
    this.visible = visible;
    if (visible) this.update();
    this.system.layoutSlot(this.slot);
    return this;
  };

  Widget.prototype.remove = function () {
    this.system.removeWidget(this);
  };

  // Size the canvas for this widget's place on the frame and bend a new
  // patch to it.
  Widget.prototype.place = function (rect, frame) {
    this.rect = rect;
    var old = this.mesh.geometry;
    this.mesh.geometry = buildPatch(rect, frame);
    old.dispose();
    var angH = rect.h / frame.distance / DEG;
    // Drawing units per degree of view, for text that should be a fixed
    // size in your view whatever the widget's size: 1.2 * box.perDegree
    // is a comfortable minimum for something read at a glance.
    this.perDegree = 100 / angH;
    if (this.external) { this.dirty = false; return; }
    var aspect = rect.w / rect.h;
    var pxH = Math.max(24, Math.min(512, Math.round(angH * this.ppd)));
    var pxW = Math.max(24, Math.min(2048, Math.round(pxH * aspect)));
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
      // A texture keeps the size it was first uploaded at; a new size
      // needs a new texture.
      this.texture.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      if (THREE.SRGBColorSpace) this.texture.colorSpace = THREE.SRGBColorSpace;
      this.material.map = this.texture;
      this.material.needsUpdate = true;
    }
    this.dirty = true;
  };

  Widget.prototype.draw = function (time) {
    if (this.external) { this.dirty = false; return; }
    var canvas = this.canvas;
    var ctx = this.ctx;
    var scale = canvas.height / 100;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.drawFn) {
      ctx.save();
      this.drawFn(ctx, {
        w: canvas.width / scale, h: 100, perDegree: this.perDegree,
        state: this.state, time: time, hud: this.system, widget: this,
      });
      ctx.restore();
    }
    this.texture.needsUpdate = true;
    this.dirty = false;
    this.lastDraw = time;
  };

  // ============================================================
  // SYSTEM: visor-hud
  // ============================================================
  AFRAME.registerSystem('visor-hud', {
    schema: {
      // On the first visit with no calibration saved, show the slots and a
      // hint pointing at Visor ▸ Adjust when you enter a headset.
      firstRunHint: { default: true },
    },

    init: function () {
      this.now = 0;
      this.game = gameKey(window.location && window.location.pathname);
      var calibration = loadCalibration(storage(), this.game);
      this.frame = calibration.frame;
      this.scope = calibration.scope;
      this.calibrated = calibration.saved;
      this.prefs = loadPreferences(storage());
      this.widgets = [];
      this.previewOn = { frame: false, rings: false };
      // Games that want the aim rings in view (aim-targeting request
      // with rings: true), by key.
      this.ringRequests = {};
      this.menuSide = null;
      this.focusTarget = null;
      this.focusDistance = this.frame.distance;
      this.hints = {};
      this.layout = null;
      this.viewKey = '';

      this.root = new THREE.Group();
      this.root.name = 'visor-hud';
      this.centre = new THREE.Group();
      this.centre.name = 'visor-hud-centre';
      this.root.add(this.centre);

      var self = this;
      this.onMenuOpened = function (evt) { self.menuSide = (evt.detail && evt.detail.side) || 'left'; };
      this.onMenuClosed = function () { self.menuSide = null; };
      this.onEnterVr = function () { self.relayout(); self.maybeFirstRun(); };
      this.onExitVr = function () { self.relayout(); };
      this.onCameraActive = function () { self.attach(); };
      this.sceneEl.addEventListener('visor-menu-opened', this.onMenuOpened);
      this.sceneEl.addEventListener('visor-menu-closed', this.onMenuClosed);
      this.sceneEl.addEventListener('enter-vr', this.onEnterVr);
      this.sceneEl.addEventListener('exit-vr', this.onExitVr);
      this.sceneEl.addEventListener('camera-set-active', this.onCameraActive);

      this.buildHints();
      this.buildPreview();
      loadHudFonts().then(function () { self.invalidateAll(); });
    },

    remove: function () {
      this.sceneEl.removeEventListener('visor-menu-opened', this.onMenuOpened);
      this.sceneEl.removeEventListener('visor-menu-closed', this.onMenuClosed);
      this.sceneEl.removeEventListener('enter-vr', this.onEnterVr);
      this.sceneEl.removeEventListener('exit-vr', this.onExitVr);
      this.sceneEl.removeEventListener('camera-set-active', this.onCameraActive);
      if (this.root.parent) this.root.parent.remove(this.root);
    },

    attach: function () {
      var camera = this.sceneEl.camera;
      var cameraEl = camera && camera.el;
      if (!cameraEl || !cameraEl.object3D) return false;
      if (this.root.parent !== cameraEl.object3D) cameraEl.object3D.add(this.root);
      this.cameraEl = cameraEl;
      return true;
    },

    // ---------- the frame ----------

    // The frame as it is drawn right now. In a headset that is the
    // calibration; on a flat screen it is also kept inside the window's
    // own field of view, which a phone held upright makes very narrow.
    effectiveFrame: function () {
      var frame = Object.assign({}, this.frame);
      var camera = this.sceneEl.camera;
      if (!inXR(this.sceneEl) && camera && camera.isPerspectiveCamera) {
        var vertical = camera.fov;
        var horizontal = 2 * Math.atan(Math.tan(vertical / 2 * DEG) * camera.aspect) / DEG;
        frame.height = Math.min(frame.height, vertical - 8);
        frame.width = Math.min(frame.width, horizontal - 8);
      }
      return frame;
    },

    // Where the visor menu goes, for common/visor-menu.js.
    menuLayout: function () {
      return menuLayout(this.effectiveFrame());
    },

    // Change the calibration. `save: false` previews (a menu row being
    // scrolled); the committed value is saved.
    setFrame: function (values, options) {
      this.frame = clampFrame(Object.assign({}, this.frame, values));
      if (!options || options.save !== false) this.saveFrame();
      this.relayout();
    },

    resetFrame: function () {
      this.setFrame(FRAME_DEFAULTS);
    },

    saveFrame: function () {
      saveCalibration(storage(), this.game, this.scope, this.frame);
      this.calibrated = true;
    },

    // 'shared' (every game) or 'game' (this one only).
    setScope: function (scope) {
      this.scope = scope === 'game' ? 'game' : 'shared';
      this.frame = switchScope(storage(), this.game, this.scope, this.frame);
      this.calibrated = true;
      this.relayout();
    },

    setPreferences: function (values, options) {
      var ringsBefore = this.prefs.rings.join();
      this.prefs = cleanPreferences(Object.assign({}, this.prefs, values));
      if (!options || options.save !== false) savePreferences(storage(), this.prefs);
      if (this.prefs.rings.join() !== ringsBefore) this.placeRings();
      this.wakeAll();
      this.sceneEl.emit('visor-hud-preferences', { prefs: this.prefs }, false);
    },

    // Every value at once, for the visor menu's sidecar.
    describe: function () {
      var f = this.frame;
      var p = this.prefs;
      var pct = function (v) { return Math.round(v * 100) + '%'; };
      var targeting = { off: 'Off', asked: 'Asked', always: 'Always' };
      return [
        'FRAME ' + (this.scope === 'game' ? '(this game)' : '(shared)'),
        'Width ' + f.width + '°  Height ' + f.height + '°',
        'Eye level ' + f.lift + '°  Dist ' + f.distance.toFixed(1) + 'm',
        'Bend ' + pct(f.bend) + '  Vertical ' + pct(f.bendY),
        '',
        'HUD ' + (p.hud ? 'On' : 'Off') + '  ' + pct(p.opacity) + (p.idleFade ? '  Fades' : ''),
        'Targets ' + targeting[p.targeting] + '  +' + p.others,
        'Rings ' + p.rings.join('° ') + '°',
      ].join('\n');
    },

    // ---------- widgets ----------

    // Put a widget in a slot. options: { id, draw(ctx, box), state,
    // order, weight, fade, fps, visible }. Adding a widget with an id that
    // is already there replaces it.
    add: function (slot, options) {
      if (SLOT_NAMES.indexOf(slot) === -1) throw new Error('visor-hud: unknown slot ' + slot);
      options = options || {};
      if (options.id) {
        var existing = this.get(options.id);
        if (existing) this.removeWidget(existing);
      }
      var widget = new Widget(this, slot, options);
      widget.wakeAt = this.now;
      this.widgets.push(widget);
      (CENTRE_SLOTS[slot] ? this.centre : this.root).add(widget.mesh);
      this.layoutSlot(slot);
      return widget;
    },

    get: function (id) {
      for (var i = 0; i < this.widgets.length; i++) if (this.widgets[i].id === id) return this.widgets[i];
      return null;
    },

    removeWidget: function (widget) {
      var index = this.widgets.indexOf(widget);
      if (index === -1) return;
      this.widgets.splice(index, 1);
      if (widget.mesh.parent) widget.mesh.parent.remove(widget.mesh);
      widget.mesh.geometry.dispose();
      widget.texture.dispose();
      widget.material.dispose();
      this.layoutSlot(widget.slot);
    },

    // Remove every widget a game added (not the HUD's own), for a game
    // switching HUD styles wholesale.
    clear: function () {
      var self = this;
      this.widgets.filter(function (w) { return !w.internal; }).forEach(function (w) { self.removeWidget(w); });
    },

    invalidateAll: function () {
      this.widgets.forEach(function (w) { w.dirty = true; });
    },

    wakeAll: function () {
      var now = this.now;
      this.widgets.forEach(function (w) { w.wakeAt = now; w.dirty = true; });
    },

    relayout: function () {
      var frame = this.effectiveFrame();
      this.layout = layoutSlots(frame);
      this.layoutFrame = frame;
      var self = this;
      SLOT_NAMES.forEach(function (slot) { self.layoutSlot(slot); });
      this.placePreview();
      this.placeRings();
      this.sceneEl.emit('visor-frame-changed', { frame: this.frame, menu: menuLayout(frame) }, false);
    },

    // Share one slot out among the visible widgets in it, in order.
    layoutSlot: function (slot) {
      if (!this.layout) return;
      var rect = this.layout.slots[slot];
      var list = this.widgets.filter(function (w) { return w.slot === slot && w.visible && !w.previewOnly; })
        .sort(function (a, b) { return a.order - b.order; });
      var parts = splitSlot(rect, list.map(function (w) { return w.weight; }), Boolean(VERTICAL_SLOTS[slot]));
      var frame = this.layoutFrame;
      list.forEach(function (widget, i) { widget.place(parts[i], frame); });
    },

    // ---------- hints ----------
    //
    // A hint is a key and what it does, above or below the reticle. The
    // highest priority (then the newest) shown in each place wins.
    setHint: function (id, hint) {
      if (!hint || (!hint.text && !hint.key)) { this.clearHint(id); return; }
      var existing = this.hints[id];
      var slot = hint.slot === 'above' ? 'above' : 'below';
      var next = {
        text: hint.text || '', key: hint.key || '', slot: slot, priority: hint.priority || 0,
        until: hint.duration ? this.now + hint.duration : Infinity,
        at: existing && existing.text === hint.text && existing.key === hint.key ? existing.at : this.now,
      };
      this.hints[id] = next;
      this.refreshHints();
    },

    clearHint: function (id) {
      if (!this.hints[id]) return;
      delete this.hints[id];
      this.refreshHints();
    },

    buildHints: function () {
      var draw = function (ctx, box) {
        if (!box.state.key && !box.state.text) return;
        drawKeyHint(ctx, box.state.key, box.state.text, box.w / 2, box.h / 2, 58);
      };
      this.hintWidgets = {
        above: this.add('above', { id: 'hud-hint-above', draw: draw, fade: false, internal: true, ppd: 34 }),
        below: this.add('below', { id: 'hud-hint-below', draw: draw, fade: false, internal: true, ppd: 34 }),
      };
    },

    refreshHints: function () {
      var best = { above: null, below: null };
      for (var id in this.hints) {
        var hint = this.hints[id];
        var current = best[hint.slot];
        if (!current || hint.priority > current.priority || (hint.priority === current.priority && hint.at > current.at)) best[hint.slot] = hint;
      }
      for (var slot in this.hintWidgets) {
        var hint = best[slot];
        // Plain values, not an object: set() compares by identity, and a
        // fresh object every call redrew (and re-uploaded) the hint every
        // frame a game kept it set.
        this.hintWidgets[slot].set({ key: hint ? hint.key : '', text: hint ? hint.text : '' });
      }
    },

    expireHints: function () {
      var changed = false;
      for (var id in this.hints) {
        if (this.hints[id].until <= this.now) { delete this.hints[id]; changed = true; }
      }
      if (changed) this.refreshHints();
    },

    // First time in a headset with nothing saved: show where everything
    // goes, say how to change it, and save the defaults so it does not ask
    // again.
    maybeFirstRun: function () {
      if (!this.data.firstRunHint || this.calibrated || this.firstRunShown) return;
      this.firstRunShown = true;
      var self = this;
      this.setHint('visor-first-run', { key: '', text: 'Hand to temple: Visor ▸ Adjust', slot: 'below', duration: 12000, priority: 10 });
      this.firstRunUntil = this.now + 12000;
      this.saveFrame();
      setTimeout(function () { self.firstRunUntil = 0; }, 12000);
    },

    // ---------- the adjustment preview ----------
    //
    // While you are in Visor ▸ Adjust: every slot as a grey box, the
    // frame's edge, and where the visor menu goes on each side. While you
    // are in Visor ▸ Targeting: the three aim rings.
    setPreview: function (which) {
      if (which.frame != null) this.previewOn.frame = Boolean(which.frame);
      if (which.rings != null) this.previewOn.rings = Boolean(which.rings);
    },

    // A game asking for the rings to be drawn, outside the menu.
    showRings: function (key, on) {
      if (on) this.ringRequests[key] = true;
      else delete this.ringRequests[key];
    },

    // The slots are grey boxes with their names on (widgets, so they bend
    // and size like the real thing). Everything large — the frame's edge,
    // the menu's place on each side, the aim rings — is thin lines: as
    // full-size transparent textures they covered most of the view, and
    // filling that much of a Quest's display with blended pixels is what
    // made the Adjust menu crawl.
    buildPreview: function () {
      var self = this;
      this.previewWidgets = SLOT_NAMES.map(function (slot) {
        var widget = self.add(slot, {
          id: 'hud-preview-' + slot, internal: true, fade: false, ppd: 10, renderOrder: PREVIEW_ORDER,
          state: { label: slot.toUpperCase() },
          draw: drawPreviewBox,
        });
        widget.previewOnly = true;
        return widget;
      });
      var line = function (color, opacity) {
        return new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: opacity, depthTest: false, depthWrite: false });
      };
      this.previewLines = new THREE.Group();
      this.previewLines.name = 'visor-hud-preview-lines';
      this.previewLines.visible = false;
      this.edgeMaterial = line('#e8f0ff', 0.6);
      this.menuMaterial = line('#7fe3ff', 0.8);
      this.root.add(this.previewLines);
      this.ringLines = new THREE.Group();
      this.ringLines.name = 'visor-hud-rings';
      this.ringLines.visible = false;
      this.ringMaterials = [line('#ffc24a', 0.95), line('#eef6ff', 0.85), line('#eef6ff', 0.85)];
      this.centre.add(this.ringLines);
    },

    // A rectangle's outline on the sheet, bent with it.
    outline: function (rect, frame, material) {
      var points = [];
      var steps = 24;
      var p = {};
      var corners = [
        [rect.x - rect.w / 2, rect.y + rect.h / 2], [rect.x + rect.w / 2, rect.y + rect.h / 2],
        [rect.x + rect.w / 2, rect.y - rect.h / 2], [rect.x - rect.w / 2, rect.y - rect.h / 2],
      ];
      for (var c = 0; c < 4; c++) {
        var a = corners[c];
        var b = corners[(c + 1) % 4];
        for (var k = 0; k < steps; k++) {
          var t = k / steps;
          sheetToCamera(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, frame, p);
          points.push(new THREE.Vector3(p.x, p.y, p.z));
        }
      }
      var loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
      loop.renderOrder = PREVIEW_ORDER;
      loop.frustumCulled = false;
      return loop;
    },

    clearGroup: function (group) {
      while (group.children.length) {
        var child = group.children.pop();
        child.geometry.dispose();
      }
    },

    placePreview: function () {
      var frame = this.layoutFrame;
      var layout = this.layout;
      if (!frame || !this.previewWidgets) return;
      this.previewWidgets.forEach(function (widget) { widget.place(layout.slots[widget.slot], frame); });
      // The menu runs from its selected row's inner end out to the
      // frame's edge (visor-frame.js menuLayout).
      var menu = menuLayout(frame);
      var inner = sheetOffsetForAngle(menu.position, frame, false);
      var half = sheetOffsetForAngle(menu.height / 2, frame, true);
      var group = this.previewLines;
      this.clearGroup(group);
      group.add(this.outline({ x: 0, y: 0, w: layout.halfW * 2, h: layout.halfH * 2 }, frame, this.edgeMaterial));
      var self = this;
      [-1, 1].forEach(function (sign) {
        group.add(self.outline({ x: sign * (inner + layout.halfW) / 2, y: 0, w: layout.halfW - inner, h: half * 2 }, frame, self.menuMaterial));
      });
    },

    // The rings, sized in degrees, as circles at the centre.
    placeRings: function () {
      var frame = this.layoutFrame;
      if (!frame || !this.ringLines) return;
      this.clearGroup(this.ringLines);
      var self = this;
      var p = {};
      this.prefs.rings.forEach(function (deg, i) {
        var r = sheetOffsetForAngle(deg, frame, false);
        var points = [];
        for (var k = 0; k < 64; k++) {
          var a = k / 64 * Math.PI * 2;
          sheetToCamera(Math.cos(a) * r, Math.sin(a) * r, frame, p);
          points.push(new THREE.Vector3(p.x, p.y, p.z));
        }
        var loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), self.ringMaterials[i]);
        loop.renderOrder = PREVIEW_ORDER;
        loop.frustumCulled = false;
        self.ringLines.add(loop);
      });
    },

    // ---------- focus ----------
    //
    // How far away whatever you are looking at is (common/aim-targeting.js
    // sets it from the locked target), so the reticle cluster sits there.
    // null puts it back at the frame's distance.
    setFocusDistance: function (metres) {
      this.focusTarget = metres == null ? null : Math.max(0.5, Math.min(40, metres));
    },

    // ---------- each frame ----------

    tick: function (time, delta) {
      this.now = time;
      if (!this.cameraEl && !this.attach()) return;
      var camera = this.sceneEl.camera;
      // Lay out again whenever the view changes shape (a window resize, a
      // phone turned) — cheap to notice, so noticed here.
      // Not in a headset, though: there three.js rewrites the camera's
      // fov from the XR projection every frame, and the frame does not
      // depend on it, so watching it re-laid the whole HUD (and the visor
      // menu with it) every frame. Rounded off a headset for the same
      // reason.
      var key = inXR(this.sceneEl) ? 'xr'
        : (camera ? camera.aspect.toFixed(3) + ':' + camera.fov.toFixed(1) : '');
      if (key !== this.viewKey) {
        this.viewKey = key;
        this.relayout();
      }

      var frameDistance = this.frame.distance;
      var focus = this.focusTarget == null ? frameDistance : this.focusTarget;
      var ease = 1 - Math.exp(-(delta || 16) / FOCUS_EASE_MS);
      this.focusDistance += (focus - this.focusDistance) * ease;
      this.centre.scale.setScalar(this.focusDistance / frameDistance);

      this.expireHints();
      var dt = Math.min(delta || 16, 100) / 1000;
      var prefs = this.prefs;
      var menuSide = this.menuSide;
      var showFrame = this.previewOn.frame || this.firstRunUntil > time;
      var showRings = this.previewOn.rings || Object.keys(this.ringRequests).length > 0;
      if (this.previewLines) this.previewLines.visible = showFrame;
      if (this.ringLines) this.ringLines.visible = showRings;
      for (var i = 0; i < this.widgets.length; i++) {
        var widget = this.widgets[i];
        var target;
        if (widget.previewOnly) {
          target = showFrame ? 1 : 0;
        } else if (!widget.visible) {
          target = 0;
        } else if (widget.internal) {
          target = 1;
        } else {
          target = prefs.hud ? prefs.opacity : 0;
          if (menuSide) target *= CORNERS[widget.slot] === menuSide ? 0 : MENU_DIM;
          if (widget.fade && prefs.idleFade && time - widget.wakeAt > IDLE_AFTER_MS) target *= IDLE_LEVEL;
        }
        // Light up quickly, dim slowly; the adjustment preview goes as
        // soon as you leave the menu that showed it.
        var rate = target > widget.opacity ? 10 : (widget.previewOnly ? 8 : 2);
        widget.opacity += (target - widget.opacity) * Math.min(1, rate * dt);
        if (Math.abs(target - widget.opacity) < 0.004) widget.opacity = target;
        var shown = widget.opacity > 0.003 && widget.rect;
        widget.mesh.visible = Boolean(shown);
        if (!shown) continue;
        widget.material.opacity = widget.opacity;
        if (widget.dirty && (!widget.fps || time - widget.lastDraw >= 1000 / widget.fps)) widget.draw(time);
      }
    },
  });

  // ---------- the preview's drawing ----------

  function drawPreviewBox(ctx, box) {
    var w = box.w;
    var h = box.h;
    var inset = 3;
    roundRect(ctx, inset, inset, w - inset * 2, h - inset * 2, 8);
    ctx.fillStyle = 'rgba(160, 172, 190, 0.32)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(232, 240, 255, 0.75)';
    ctx.stroke();
    var size = Math.min(1.3 * box.perDegree, w / Math.max(4, box.state.label.length) * 1.4);
    drawText(ctx, box.state.label, w / 2, h / 2, { size: size, align: 'center', color: 'rgba(240, 246, 255, 0.9)' });
  }


}
