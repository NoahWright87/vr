// ============================================================
// CROSSBAR MENU — the A-Frame side of the shared menu system.
//
// This file draws what common/menu-model.js decides, and routes input
// into it. The split is deliberate: everything about *what is focused*
// lives in the model and is tested by `node --test`; everything here
// is geometry, materials and event plumbing.
//
// One renderer, several surfaces. A world panel is flat and roomy; a
// watch face is flat and cramped; the visor is curved, anchored to one
// side and drawn for one eye. Those are schema values on the same
// component, not three implementations — the only thing that changes
// per surface is how many rows fit, how far the focused row bulges
// outboard, and which way the text is aligned.
//
// The rows themselves carry class "menu-target", which is what the
// existing fingertip laser and the desktop gaze cursor already
// raycast against, so pointing works on these panels with no changes
// to either. Tapping the focused row activates it; tapping any other
// row scrolls to it. That way a tap is always safe — you can never
// select something by aiming slightly wrong.
// ============================================================

import { createMenu } from './menu-model.js';

// Pages are registered by name because an A-Frame schema can only hold
// strings and numbers, and the alternative (building menus from
// markup) is exactly the thing this system exists to stop doing.
var PAGES = {};

export function registerMenuPage(name, page) {
  PAGES[name] = page;
  return page;
}

export function getMenuPage(name) {
  return PAGES[name];
}

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  // Opacity by distance from the focus. Explicit rather than computed
  // so the falloff can be tuned by eye in a headset without anyone
  // having to reason about a curve.
  var FADE = [1, 0.62, 0.28, 0.14, 0.08];

  // A row's plate is only drawn for the focused row; everything else
  // is text alone, so the panel reads as a list rather than a stack of
  // buttons.
  var PLATE_OPACITY = 0.22;

  // Stick handling. A step fires when the axis crosses ON, and cannot
  // fire again until it falls back under OFF — otherwise a stick held
  // at 0.7 machine-guns through the list.
  var STEP_ON = 0.6;
  var STEP_OFF = 0.25;
  var REPEAT_DELAY_MS = 450;
  var REPEAT_INTERVAL_MS = 200;

  // A hand has to hold the engagement pose this long before the
  // highlight moves, or the outline strobes between two candidates as
  // your hand drifts and you stop trusting it.
  var ENGAGE_SETTLE_MS = 100;
  // Leaving takes a little more room than arriving, so a hand hovering
  // right on the boundary doesn't chatter in and out.
  var RELEASE_MARGIN = 0.06;
  // Flat play aims by looking, so engagement is a cone rather than a
  // reach: ~25 degrees off the view centre.
  var FLAT_GAZE_MIN = 0.9;

  var ACTIVATE_EVENTS = ['triggerdown', 'abuttondown', 'xbuttondown'];
  var BACK_EVENTS = ['bbuttondown', 'ybuttondown', 'gripdown'];

  var panelSerial = 0;

  function truncate(text, maxChars) {
    if (!maxChars || text.length <= maxChars) return text;
    return text.slice(0, Math.max(1, maxChars - 1)) + '…';
  }

  // ============================================================
  // COMPONENT: crossbar-menu
  // ============================================================
  AFRAME.registerComponent('crossbar-menu', {
    schema: {
      page: { type: 'string' },
      title: { type: 'string', default: '' },
      windowSize: { default: 5 },
      wrap: { default: true },
      memory: { default: 'temporary' },
      memoryMs: { default: 60000 },
      breadcrumbDepth: { default: 3 },
      width: { default: 1.1 },
      rowHeight: { default: 0.16 },
      // Metres the focused row bulges outboard. 0 for anything flat;
      // the visor is the only surface that wants this.
      curve: { default: 0 },
      align: { default: 'left', oneOf: ['left', 'center'] },
      // Which way "outboard" points, for the curve and the breadcrumb
      // rail. A left-hand visor menu is anchored on the left.
      side: { default: 'left', oneOf: ['left', 'right'] },
      maxChars: { default: 22 },
      open: { default: true },
      // How close a hand has to be before its thumbstick drives this
      // menu instead of the player.
      stickRange: { default: 0.9 },
      // Flat play looks at a panel from across the room rather than
      // standing inside arm's reach of it, so it gets its own range.
      gazeRange: { default: 6 },
      // The proximity prompt, off a headset. Reuses the repo's own
      // hint-zone card, so a menu announces itself exactly the way a
      // grabbable box or a mounted panel does.
      hintKey: { type: 'string', default: 'E' },
      hintLabel: { type: 'string', default: 'Menu' },
      // Note the ceiling: interaction-hints resolves a desktop candidate
      // against min(hand.maxReach, zone.maxReach) plus a fifth of the
      // radius, and the semantic hands carry maxReach 1.0 — so raising
      // this past about 1.2 buys nothing. Walking right up to a panel is
      // the intended gesture anyway; mounted-interaction uses 0.75.
      hintRadius: { default: 1.2 },
      plate: { default: true },
      color: { type: 'color', default: '#dff3ff' },
      accent: { type: 'color', default: '#7fe3ff' },
    },

    init: function () {
      this.rows = [];
      this.crumbs = [];
      this.engagedHand = null;
      this._handPosition = new THREE.Vector3();
      this._panelPosition = new THREE.Vector3();

      this.onRowClick = this.onRowClick.bind(this);
      this.onCrumbClick = this.onCrumbClick.bind(this);
      this.onCloseClick = this.onCloseClick.bind(this);
      this.locked = false;

      var page = getMenuPage(this.data.page);
      if (!page) {
        console.warn('[crossbar-menu] no page registered as "' + this.data.page + '"');
        page = { title: this.data.title || '', items: [] };
      }
      this.menu = createMenu(page, {
        windowSize: this.data.windowSize,
        wrap: this.data.wrap,
        memory: this.data.memory,
        memoryMs: this.data.memoryMs,
        breadcrumbDepth: this.data.breadcrumbDepth,
      });

      var self = this;
      this.menu.on('change', function () { self.render(); });
      this.menu.on('close', function () { self.el.emit('crossbar-menu-close', {}, false); });
      this.menu.on('action', function (detail) {
        // Bubbles, so a game can listen on the scene rather than on
        // every panel it happens to have built.
        self.el.emit('menu-action', { id: detail.id, item: detail.item }, true);
        // Also emitted in the shape menu-item already uses, so handlers
        // written against the existing menus keep working when a page
        // moves onto this system — which is most of what makes the
        // surface-by-surface migration cheap.
        self.el.emit('menu-item-select', { value: detail.id, label: detail.item.label }, true);
      });
      this.menu.on('commit', function (detail) {
        self.el.emit('menu-commit', { id: detail.item.id, value: detail.value, item: detail.item }, true);
      });
      this.menu.on('preview', function (detail) {
        self.el.emit('menu-preview', { id: detail.item.id, value: detail.value, item: detail.item }, true);
      });

      this.build();
      if (this.data.open) this.menu.open();
      this.render();
    },

    // ---------- construction ----------
    //
    // Built once. Navigation only ever changes text, opacity and
    // position on entities that already exist — no entity is created
    // or destroyed while a menu is being used.
    build: function () {
      var data = this.data;
      var outward = data.side === 'left' ? -1 : 1;
      this.outward = outward;

      if (data.plate) {
        var backing = document.createElement('a-plane');
        backing.classList.add('pm-surface');
        backing.setAttribute('width', data.width);
        backing.setAttribute('height', data.rowHeight * (data.windowSize + 2));
        backing.setAttribute('material', 'color: #0b1220; shader: flat; opacity: 0.55; transparent: true');
        backing.setAttribute('position', '0 0 -0.012');
        // Named so the hint zone can highlight this one plate. Left to
        // itself, hint-zone highlights every mesh under the entity it
        // is on — which for a menu is an additive copy of all five row
        // plates and their text, and reads as banding across the whole
        // panel.
        backing.setAttribute('id', (this.el.id || 'crossbar') + '-backing-' + (panelSerial++));
        this.el.appendChild(backing);
        this.backingEl = backing;
      }

      // Title bar. No close button: a world panel is dismissed by
      // walking away, a watch by dropping your wrist, the visor by
      // taking your hand off your head. An X you can only reach by
      // pointing would be unreachable to someone driving with a stick.
      var titleY = data.rowHeight * (data.windowSize / 2 + 0.7);
      var title = document.createElement('a-text');
      title.setAttribute('value', (this.data.title || this.menu.getTitle() || '').toUpperCase());
      title.setAttribute('color', data.accent);
      // a-text's `width` is the width of the whole text block, so it
      // has to track the panel rather than exceed it, or every label
      // renders wider than the surface it sits on.
      title.setAttribute('width', data.width * 0.92);
      title.setAttribute('wrapCount', 14);
      title.setAttribute('align', data.align === 'center' ? 'center' : 'left');
      title.setAttribute('position', {
        x: data.align === 'center' ? 0 : -data.width / 2 + 0.04,
        y: titleY,
        z: 0.001,
      });
      this.el.appendChild(title);
      this.titleEl = title;

      // The close button. It is a focus target, not only a click
      // target: pressing outward at the root lands on it, and a second
      // press confirms. That is the whole reason closing is no longer
      // something a stray press can do by accident.
      var close = document.createElement('a-entity');
      close.classList.add('menu-target');
      close.setAttribute('geometry', 'primitive: plane; width: ' + data.rowHeight * 0.8 + '; height: ' + data.rowHeight * 0.8);
      close.setAttribute('material', 'color: ' + data.accent + '; shader: flat; opacity: 0; transparent: true; depthWrite: false');
      close.setAttribute('position', { x: data.width / 2 - data.rowHeight * 0.5, y: titleY - data.rowHeight * 0.12, z: 0.002 });
      var closeGlyph = document.createElement('a-text');
      closeGlyph.setAttribute('value', 'X');
      closeGlyph.setAttribute('align', 'center');
      closeGlyph.setAttribute('color', data.accent);
      closeGlyph.setAttribute('width', data.width * 0.92);
      closeGlyph.setAttribute('wrapCount', data.maxChars);
      closeGlyph.setAttribute('position', '0 0 0.004');
      close.appendChild(closeGlyph);
      close.addEventListener('click', this.onCloseClick);
      this.el.appendChild(close);
      this.closeEl = close;
      this.closeGlyphEl = closeGlyph;

      var rule = document.createElement('a-plane');
      rule.setAttribute('width', data.width * 0.92);
      rule.setAttribute('height', 0.004);
      rule.setAttribute('material', 'color: ' + data.accent + '; shader: flat; opacity: 0.5; transparent: true');
      rule.setAttribute('position', '0 ' + (titleY - data.rowHeight * 0.45) + ' 0');
      this.el.appendChild(rule);

      // Rows.
      for (var i = 0; i < data.windowSize; i++) {
        var row = document.createElement('a-entity');
        row.classList.add('menu-target');
        row.setAttribute('geometry', 'primitive: plane; width: ' + data.width * 0.94 + '; height: ' + data.rowHeight * 0.92);
        // depthWrite off: an invisible plate that still writes depth
        // punches a hole in the panel glow behind it, which reads as a
        // band across every row. It has to stay a real (raycastable)
        // object rather than being hidden, since it is also the pointing
        // target — three.js skips invisible objects when raycasting.
        row.setAttribute('material', 'color: ' + data.accent + '; shader: flat; opacity: 0; transparent: true; depthWrite: false');
        row.dataset.rowSlot = String(i);
        row.addEventListener('click', this.onRowClick);

        var text = document.createElement('a-text');
        text.setAttribute('color', data.color);
        text.setAttribute('align', data.align === 'center' ? 'center' : 'left');
        text.setAttribute('width', data.width * 0.92);
        text.setAttribute('position', {
          x: data.align === 'center' ? 0 : -data.width * 0.44,
          y: 0,
          z: 0.004,
        });
        row.appendChild(text);

        // Marks a row you can go deeper into. Sits on the inboard edge
        // so it reads as "this way in" rather than decoration.
        var chevron = document.createElement('a-text');
        chevron.setAttribute('value', outward < 0 ? '›' : '‹');
        chevron.setAttribute('color', data.accent);
        chevron.setAttribute('align', 'center');
        // Same block width and wrap as a row label, so the chevron is
        // the size of one character of body text rather than its own
        // arbitrary scale.
        chevron.setAttribute('width', data.width * 0.92);
        chevron.setAttribute('wrapCount', data.maxChars);
        chevron.setAttribute('position', { x: -outward * data.width * 0.44, y: 0, z: 0.004 });
        chevron.object3D.visible = false;
        row.appendChild(chevron);

        this.el.appendChild(row);
        this.rows.push({ el: row, textEl: text, chevronEl: chevron, offset: 0, row: null });
      }

      // Breadcrumb rail: the level you're in, rotated onto the outboard
      // edge, with ancestors pushed further out and faded. Tapping any
      // of them goes up exactly one level — never several — so the
      // gesture means the same thing wherever you hit it.
      for (var c = 0; c < Math.max(0, data.breadcrumbDepth); c++) {
        var crumb = document.createElement('a-text');
        crumb.classList.add('menu-target');
        crumb.setAttribute('color', data.accent);
        crumb.setAttribute('align', 'center');
        crumb.setAttribute('width', data.width * 0.92);
        crumb.setAttribute('wrapCount', 18);
        crumb.setAttribute('rotation', '0 0 ' + (outward < 0 ? 90 : -90));
        crumb.setAttribute('position', {
          x: outward * (data.width / 2 + 0.05 + c * 0.075),
          y: 0,
          z: 0.002,
        });
        crumb.object3D.visible = false;
        crumb.addEventListener('click', this.onCrumbClick);
        this.el.appendChild(crumb);
        this.crumbs.push(crumb);
      }

      // The engaged-panel outline. Its whole job is to answer "is my
      // thumbstick driving this right now?" before you touch anything.
      var glow = document.createElement('a-plane');
      glow.setAttribute('width', data.width + 0.05);
      glow.setAttribute('height', data.rowHeight * (data.windowSize + 2) + 0.05);
      glow.setAttribute('material', 'color: ' + data.accent + '; shader: flat; opacity: 0.3; transparent: true; side: double');
      glow.setAttribute('position', '0 0 -0.02');
      glow.object3D.visible = false;
      this.el.appendChild(glow);
      this.glowEl = glow;

      // What the controls are, shown only while this menu actually has
      // them. "No sense of I'm using this right now" was the whole
      // complaint; a border alone did not carry it.
      var footer = document.createElement('a-text');
      footer.setAttribute('value', '');
      footer.setAttribute('align', data.align === 'center' ? 'center' : 'left');
      footer.setAttribute('color', data.accent);
      footer.setAttribute('width', data.width * 0.92);
      footer.setAttribute('wrapCount', 46);
      footer.setAttribute('position', {
        x: data.align === 'center' ? 0 : -data.width / 2 + 0.04,
        y: -data.rowHeight * (data.windowSize / 2 + 0.45),
        z: 0.002,
      });
      footer.object3D.visible = false;
      this.el.appendChild(footer);
      this.footerEl = footer;

      // Proximity prompt. The hint system resolves this against every
      // other zone in the scene, so walking up to a menu and walking up
      // to a grabbable box compete on the same terms rather than each
      // shouting over the other.
      var hint = {
        action: 'menu',
        radius: data.hintRadius,
        maxReach: data.hintRadius,
        priority: 5,
        desktopKey: data.hintKey,
        desktopLabel: data.hintLabel,
        touchKey: 'TAP',
        touchLabel: data.hintLabel,
        hintOffset: { x: 0, y: data.rowHeight * (data.windowSize / 2 + 1.25), z: 0 },
      };
      if (this.backingEl) hint.highlight = '#' + this.backingEl.getAttribute('id');
      else hint.highlightOpacity = 0;
      this.el.setAttribute('hint-zone', hint);
    },

    // ---------- drawing ----------

    render: function () {
      var data = this.data;
      var visible = this.menu.isOpen;
      this.el.object3D.visible = visible;
      if (!visible) return;

      var half = (data.windowSize - 1) / 2;
      var inChrome = this.menu.inChrome();
      var windowRows = this.menu.getWindow();
      var bySlot = {};
      for (var w = 0; w < windowRows.length; w++) {
        bySlot[windowRows[w].offset + half] = windowRows[w];
      }

      for (var i = 0; i < this.rows.length; i++) {
        var slot = this.rows[i];
        var model = bySlot[i];
        if (!model) {
          slot.el.object3D.visible = false;
          slot.row = null;
          continue;
        }
        var offset = model.offset;
        var distance = Math.abs(offset);
        var opacity = FADE[Math.min(distance, FADE.length - 1)];

        slot.el.object3D.visible = true;
        slot.row = model;
        slot.offset = offset;

        // The curve: the focused row sits furthest outboard, the ones
        // above and below pull inboard. Zero on flat surfaces, which
        // makes this a no-op everywhere but the visor.
        var bulge = data.curve
          ? data.curve * (1 - Math.pow(distance / Math.max(1, half), 2))
          : 0;
        slot.el.object3D.position.set(
          this.outward * bulge,
          -offset * data.rowHeight,
          0
        );

        var label = truncate(model.label, data.maxChars);
        slot.textEl.setAttribute('text', {
          value: label,
          opacity: opacity,
          // Long labels shrink rather than overflowing the panel:
          // a-text's wrapCount is characters-per-line, so raising it
          // for a long string makes the glyphs smaller instead of
          // letting them run off the edge.
          wrapCount: Math.max(data.maxChars, label.length),
        });
        slot.textEl.setAttribute('color', model.focused ? data.accent : data.color);
        slot.chevronEl.object3D.visible = Boolean(model.hasChildren);
        slot.chevronEl.setAttribute('text', 'opacity', opacity);
        slot.el.setAttribute('material', 'opacity', (model.focused && !inChrome) ? PLATE_OPACITY : 0);
      }

      // While the title bar has the focus the list shows none, so there
      // is never a question about where a confirm would land.
      if (this.closeEl) {
        this.closeEl.setAttribute('material', 'opacity', inChrome ? PLATE_OPACITY * 1.6 : 0);
        this.closeGlyphEl.setAttribute('text', 'opacity', inChrome ? 1 : 0.45);
      }

      var crumbs = this.menu.getBreadcrumbs();
      for (var c = 0; c < this.crumbs.length; c++) {
        var crumbEl = this.crumbs[c];
        var crumb = crumbs[c];
        if (!crumb) {
          crumbEl.object3D.visible = false;
          continue;
        }
        crumbEl.object3D.visible = true;
        crumbEl.setAttribute('text', {
          value: crumb.title,
          opacity: FADE[Math.min(c, FADE.length - 1)],
          wrapCount: Math.max(16, crumb.title.length),
        });
      }
    },

    // ---------- pointing ----------

    onRowClick: function (evt) {
      var slot = this.rows[Number(evt.target.dataset.rowSlot)];
      if (!slot || !slot.row) return;
      // Tapping the focused row selects; tapping any other row only
      // scrolls to it. Two taps to reach anything visible, and no way
      // to fire the wrong thing by aiming a row off.
      if (slot.offset === 0) this.menu.activate();
      else this.menu.focusOffset(slot.offset);
    },

    onCrumbClick: function () {
      this.menu.back();
    },

    onCloseClick: function () {
      this.menu.close();
    },

    // ---------- stick control ----------

    // Off a headset there is no hand to light up, so the panel has to
    // carry the whole "your keys are going here" signal by itself: a
    // bright border, a brighter title, and the controls spelled out
    // underneath.
    setLocked: function (locked) {
      if (this.locked === locked) return;
      this.locked = locked;
      if (this.glowEl) {
        this.glowEl.object3D.visible = locked || Boolean(this.engagedHand);
        this.glowEl.setAttribute('material', 'opacity', locked ? 0.75 : 0.3);
      }
      if (this.backingEl) {
        this.backingEl.setAttribute('material', 'opacity', locked ? 0.82 : 0.55);
      }
      if (this.titleEl) {
        this.titleEl.setAttribute('text', 'opacity', locked ? 1 : 0.6);
      }
      if (this.footerEl) {
        this.footerEl.setAttribute('value', 'W/S move   D enter   A back   E exit');
        this.footerEl.object3D.visible = locked;
      }
      // While a menu holds the keys it stops advertising itself, and
      // says how to leave instead.
      this.el.setAttribute('hint-zone', 'desktopLabel', locked ? 'Exit menu' : this.data.hintLabel);
      this.el.emit(locked ? 'crossbar-menu-locked' : 'crossbar-menu-unlocked', {}, false);
    },

    setEngagedHand: function (handEl) {
      if (this.engagedHand === handEl) return;
      var previous = this.engagedHand;
      this.engagedHand = handEl;
      if (this.glowEl) this.glowEl.object3D.visible = Boolean(handEl) || Boolean(this.locked);
      if (previous) previous.emit('menu-stick-released', { menuEl: this.el }, false);
      if (handEl) handEl.emit('menu-stick-engaged', { menuEl: this.el }, false);
    },

    step: function (delta) { this.menu.moveFocus(delta); },
    activate: function () { this.menu.activate(); },
    forward: function () { this.menu.forward(); },
    back: function () { this.menu.back(); },

    getWorldPosition: function (target) {
      return this.el.object3D.getWorldPosition(target);
    },

    remove: function () {
      this.setEngagedHand(null);
    },
  });

  // ============================================================
  // SYSTEM: menu-stick-control
  //
  // Decides, once per frame, whether a hand's thumbstick is driving a
  // menu or the player. Three rules make that safe:
  //
  //  1. Pointing wins. If the fingertip laser is live, that hand is
  //     pointing and the stick stays with the player — otherwise
  //     reaching out to click something would silently steal your
  //     movement.
  //  2. A hand holding something is not a menu hand. In Pistols both
  //     hands are usually full, and a gun aimed through a wall panel
  //     shouldn't capture anything.
  //  3. Capture follows the pose, not the menu. Drop your arm and the
  //     stick goes back to the player instantly, while the menu stays
  //     open exactly where it was. There is no mode to escape, so
  //     there is no way to be trapped next to a menu.
  // ============================================================
  AFRAME.registerSystem('menu-stick-control', {
    init: function () {
      this.menus = [];
      this.hands = [];
      this._handPosition = new THREE.Vector3();
      this._menuPosition = new THREE.Vector3();
      this._forward = new THREE.Vector3();
      this._toMenu = new THREE.Vector3();
      this._quaternion = new THREE.Quaternion();
      // Off a headset a menu is entered deliberately and held until you
      // leave it, rather than picked up by looking. Exactly one menu can
      // be locked at a time, which is what makes "only this menu moves"
      // true by construction rather than by careful bookkeeping.
      this.lockedMenu = null;
      this.bindings = [];
      this.onKeyDown = this.onKeyDown.bind(this);
      window.addEventListener('keydown', this.onKeyDown);
      var self = this;
      this.el.addEventListener('loaded', function () { self.collectHands(); });
    },

    collectHands: function () {
      var self = this;
      var handEls = Array.prototype.slice.call(document.querySelectorAll('[semantic-hand]'));
      handEls.forEach(function (handEl) {
        var state = {
          el: handEl,
          axes: [0, 0, 0, 0],
          armed: true,
          armedX: true,
          heldSince: 0,
          repeatAt: 0,
          candidate: null,
          candidateSince: 0,
          menu: null,
          glowEl: null,
        };
        handEl.addEventListener('axismove', function (evt) {
          if (evt.detail && evt.detail.axis) state.axes = evt.detail.axis;
        });
        ACTIVATE_EVENTS.forEach(function (name) {
          handEl.addEventListener(name, function (evt) {
            if (!state.menu) return;
            evt.stopPropagation();
            state.menu.activate();
          });
        });

        BACK_EVENTS.forEach(function (name) {
          handEl.addEventListener(name, function (evt) {
            if (!state.menu) return;
            evt.stopPropagation();
            state.menu.back();
          });
        });
        self.hands.push(state);
      });
    },

    registerMenu: function (component) {
      if (this.menus.indexOf(component) === -1) this.menus.push(component);
    },

    unregisterMenu: function (component) {
      var index = this.menus.indexOf(component);
      if (index !== -1) this.menus.splice(index, 1);
    },

    // A hand is eligible only if it is empty and not pointing.
    handIsAvailable: function (handEl) {
      var semantic = handEl.components['semantic-hand'];
      if (semantic && semantic.heldEl) return false;
      var watch = handEl.components['hand-with-watch'];
      if (watch && watch.laserActive) return false;
      return true;
    },

    tick: function (time, delta) {
      var menus = [];
      for (var m = 0; m < this.menus.length; m++) {
        if (this.menus[m].menu.isOpen) menus.push(this.menus[m]);
      }

      // Off a headset there are no thumbsticks to take, so hands never
      // engage — a simulated desktop hand drifting near a panel would
      // otherwise light up and promise a control that doesn't exist.
      // Flat play engages by looking instead, which keeps the rule the
      // same in both places: the surface your input will reach is the
      // one that's lit.
      var mode = this.el.systems['control-mode'];
      if (!mode || !mode.isMode('xr')) {
        for (var r = 0; r < this.hands.length; r++) {
          var idle = this.hands[r];
          if (idle.menu) {
            if (idle.menu.engagedHand === idle.el) idle.menu.setEngagedHand(null);
            idle.menu = null;
            this.setHandGlow(idle, false);
          }
        }
        // A locked menu that gets closed releases the keys with it.
        if (this.lockedMenu && !this.lockedMenu.menu.isOpen) this.unlock();
        return;
      }
      // Entering a headset drops the flat lock: in XR a hand takes the
      // menu by reaching for it, and leaving a keyboard lock in place
      // would hold movement suspended with nothing on screen saying so.
      if (this.lockedMenu) this.unlock();

      if (!this.hands.length) return;

      // Pass one: what would each hand like to drive, and how near is
      // it? A hand that is pointing, or holding something, wants
      // nothing.
      var h;
      for (h = 0; h < this.hands.length; h++) {
        var state = this.hands[h];
        var best = null;
        var bestDistance = Infinity;

        if (this.handIsAvailable(state.el)) {
          state.el.object3D.getWorldPosition(this._handPosition);
          for (var i = 0; i < menus.length; i++) {
            var component = menus[i];
            component.getWorldPosition(this._menuPosition);
            var distance = this._handPosition.distanceTo(this._menuPosition);
            // Once engaged, a little extra room before letting go.
            var range = component.data.stickRange +
              (component.engagedHand === state.el ? RELEASE_MARGIN : 0);
            if (distance <= range && distance < bestDistance) {
              best = component;
              bestDistance = distance;
            }
          }
        }

        // Settle before switching, so the highlight can be trusted.
        if (best !== state.candidate) {
          state.candidate = best;
          state.candidateSince = time;
        }
        state.candidateDistance = bestDistance;
        state.settled = best === null || (time - state.candidateSince) >= ENGAGE_SETTLE_MS;
      }

      // Pass two: one menu, one hand — the nearest one that wants it.
      // Resolving per menu rather than per hand matters because with
      // both hands in range, deciding by iteration order means the
      // menu is driven by whichever hand the DOM happened to list
      // first, not the one you reached out with. An engaged hand keeps
      // its menu while it stays in range, so this only re-decides when
      // something actually changes.
      var claims = new Map();
      for (h = 0; h < this.hands.length; h++) {
        var claimant = this.hands[h];
        if (!claimant.settled || !claimant.candidate) continue;
        var existing = claims.get(claimant.candidate);
        var incumbent = claimant.candidate.engagedHand === claimant.el;
        if (!existing ||
            (incumbent && existing.el !== claimant.candidate.engagedHand) ||
            (!existing.incumbent && claimant.candidateDistance < existing.distance)) {
          claims.set(claimant.candidate, {
            el: claimant.el,
            state: claimant,
            distance: claimant.candidateDistance,
            incumbent: incumbent,
          });
        }
      }

      for (h = 0; h < this.hands.length; h++) {
        var hand = this.hands[h];
        if (!hand.settled) {
          if (hand.menu) this.pumpStick(hand, time);
          continue;
        }
        var claim = hand.candidate ? claims.get(hand.candidate) : null;
        var wins = Boolean(claim && claim.el === hand.el);
        var next = wins ? hand.candidate : null;

        if (hand.menu !== next) {
          if (hand.menu && hand.menu.engagedHand === hand.el) hand.menu.setEngagedHand(null);
          hand.menu = next;
          if (next) next.setEngagedHand(hand.el);
          this.setHandGlow(hand, Boolean(next));
          hand.armed = true;
        }

        if (hand.menu) this.pumpStick(hand, time);
      }
    },

    // ---------- the flat lock ----------

    // Which menu, if any, is close enough to enter right now. The hint
    // system has already arbitrated this against every other zone in
    // the scene, so pressing E next to a menu and a grabbable box does
    // whichever one the prompt is actually offering.
    getPromptedMenu: function () {
      var hints = this.el.systems['interaction-hints'];
      if (!hints || typeof hints.getDesktopCandidate !== 'function') return null;
      var candidate = hints.getDesktopCandidate('menu');
      if (!candidate || !candidate.zone) return null;
      var component = candidate.zone.el.components['crossbar-menu'];
      return component && component.menu.isOpen ? component : null;
    },

    lock: function (component) {
      if (this.lockedMenu === component) return;
      if (this.lockedMenu) this.lockedMenu.setLocked(false);
      this.lockedMenu = component || null;
      if (component) component.setLocked(true);
      // Both the keyboard path (desktop-controls' own tick) and the
      // joystick path (locomotion) check this, so entering a menu
      // suspends walking without either of them needing to know what a
      // menu is.
      this.el.setAttribute('data-menu-locked', component ? 'true' : 'false');
    },

    unlock: function () {
      this.lock(null);
    },

    onKeyDown: function (evt) {
      var mode = this.el.systems['control-mode'];
      if (mode && mode.isMode('xr')) return;
      var locked = this.lockedMenu;

      if (evt.code === 'KeyE') {
        if (locked) { this.unlock(); evt.preventDefault(); return; }
        var prompted = this.getPromptedMenu();
        if (prompted) { this.lock(prompted); evt.preventDefault(); }
        return;
      }
      if (!locked) return;

      // Everything below only reaches the one locked menu, which is the
      // whole point: a second panel in the room does not move.
      var handled = true;
      switch (evt.code) {
        case 'KeyW': case 'ArrowUp': locked.step(-1); break;
        case 'KeyS': case 'ArrowDown': locked.step(1); break;
        case 'KeyD': case 'ArrowRight': locked.forward(); break;
        case 'KeyA': case 'ArrowLeft': locked.back(); break;
        case 'Enter': case 'Space': locked.activate(); break;
        case 'Escape': this.unlock(); break;
        default: handled = false;
      }
      if (handled) {
        evt.preventDefault();
        // Movement keys are shared with walking; stopping propagation
        // keeps desktop-controls from also seeing them this frame.
        evt.stopPropagation();
      }
    },

    // The hand itself lights up, not just the panel. Highlighting only
    // the menu tells you something changed; highlighting the hand tells
    // you WHICH stick just changed meaning, which is the difference
    // between assistance and having the controls taken off you.
    setHandGlow: function (state, engaged) {
      if (!state.glowEl) {
        var glow = document.createElement('a-entity');
        glow.setAttribute('geometry', 'primitive: torus; radius: 0.055; radiusTubular: 0.005; segmentsRadial: 8; segmentsTubular: 20');
        glow.setAttribute('material', 'color: #7fe3ff; shader: flat; opacity: 0.75; transparent: true');
        glow.setAttribute('rotation', '90 0 0');
        glow.object3D.visible = false;
        state.el.appendChild(glow);
        state.glowEl = glow;
      }
      state.glowEl.object3D.visible = engaged;
    },

    remove: function () {
      window.removeEventListener('keydown', this.onKeyDown);
    },

    pumpStick: function (state, time) {
      var axes = state.axes || [];
      // Quest controllers report the thumbstick on axes 2/3; some
      // runtimes use 0/1. locomotion.js reads them the same way.
      var y = axes[3] !== undefined ? axes[3] : (axes[1] || 0);
      var x = axes[2] !== undefined ? axes[2] : (axes[0] || 0);

      // Horizontal is hierarchy: inward goes deeper, outward comes back
      // and, at the root, onto the title bar. One detent, no repeat --
      // walking down levels by holding the stick is not something anyone
      // means to do.
      if (Math.abs(x) > Math.abs(y)) {
        if (Math.abs(x) < STEP_OFF) state.armedX = true;
        else if (Math.abs(x) >= STEP_ON && state.armedX !== false) {
          state.armedX = false;
          if (x > 0) state.menu.forward();
          else state.menu.back();
        }
        return;
      }

      var magnitude = Math.abs(y);
      if (magnitude < STEP_OFF) {
        state.armed = true;
        state.armedX = true;
        state.repeatAt = 0;
        return;
      }
      if (magnitude < STEP_ON) return;

      var direction = y > 0 ? 1 : -1;
      if (state.armed) {
        state.armed = false;
        state.repeatAt = time + REPEAT_DELAY_MS;
        state.menu.step(direction);
        return;
      }
      // Held: repeat, so scrolling a long list (or an alphabet) is one
      // sustained push rather than thirty presses.
      if (state.repeatAt && time >= state.repeatAt) {
        state.repeatAt = time + REPEAT_INTERVAL_MS;
        state.menu.step(direction);
      }
    },
  });

  // Menus register themselves with the system rather than the system
  // querying the DOM every frame.
  AFRAME.registerComponent('crossbar-menu-registration', {
    dependencies: ['crossbar-menu'],
    init: function () {
      this.system = this.el.sceneEl.systems['menu-stick-control'];
      if (this.system) this.system.registerMenu(this.el.components['crossbar-menu']);
    },
    remove: function () {
      if (this.system) this.system.unregisterMenu(this.el.components['crossbar-menu']);
    },
  });

}
