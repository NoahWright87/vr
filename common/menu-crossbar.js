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

// Past anything a scene is likely to set for itself, so an overlay
// surface draws after the world's own transparent objects.
export var OVERLAY_RENDER_ORDER = 9000;

// "On top of everything" without leaving world space. The surface stays
// a real object at a real distance, because that is what makes it
// comfortable in a headset: both eyes converge where the panel actually
// is, and the stereo agrees with what your eyes are doing. Drawing a HUD
// at zero disparity instead — true screen space — is what gives you the
// eye strain this whole surface is meant to avoid. What was wrong was
// never the distance; it was that the panel took part in the depth test,
// so a wall nearer than 1.8m won.
//
// With depthTest off, draw order alone decides what covers what, so the
// surface's own parts still have to be ordered. They are all in the
// transparent pass, which three.js sorts back-to-front by distance, and
// the z offsets the parts are already built with (a backing at -0.012,
// labels at +0.004) are exactly that ordering — so one renderOrder for
// the whole surface lifts it clear of the world while its internals go
// on sorting themselves out as before.
export function overlayAll(el) {
  if (!el || !el.object3D) return;
  el.object3D.traverse(function (object) {
    if (!object.isMesh || !object.material) return;
    object.renderOrder = OVERLAY_RENDER_ORDER;

    // Where A-Frame's material component owns the material, this has to
    // go through the component. It re-applies its whole schema on every
    // update — and depthTest/depthWrite are part of that schema, both
    // defaulting to true — so a value poked straight onto three.js is
    // silently undone by the next setAttribute('material', 'opacity'),
    // of which this system does plenty: the dwell pip fills, the lock
    // border brightens, a row plate flashes.
    var owner = object.el;
    if (owner && owner.components && owner.components.material) {
      var data = owner.components.material.data;
      if (data.depthTest !== false || data.depthWrite !== false) {
        owner.setAttribute('material', { depthTest: false, depthWrite: false });
      }
      return;
    }

    // a-text has no material component — it draws through the text
    // component's own shader material, which nothing overwrites.
    var materials = Array.isArray(object.material) ? object.material : [object.material];
    for (var i = 0; i < materials.length; i++) {
      var material = materials[i];
      if (material.depthTest === false && material.depthWrite === false) continue;
      material.depthTest = false;
      // Testing against nothing while still writing depth would let the
      // surface punch a hole in whatever is drawn after it.
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  });
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

  // Breadcrumb titles are drawn a letter at a time so they can fly into
  // place; these bound the pool and set the glyph pitch.
  var CRUMB_MAX_CHARS = 18;
  var CRUMB_WRAP = 18;
  var CRUMB_FLY_MS = 260;
  var CRUMB_STAGGER_MS = 22;

  // The confirm flash: the focused row's plate jumps to full and falls
  // back to its resting highlight. Short enough to read as a press
  // rather than an animation, and long enough to survive a frame or
  // two of jank — a signal you can miss is no signal.
  var FLASH_MS = 240;
  var FLASH_HOLD = 0.35;
  var FLASH_OPACITY = 0.8;
  // The label inverts for the duration. A plate this bright is the
  // accent colour the label is already drawn in, so left alone the text
  // disappears into it and the flash reads as the row blanking out.
  var FLASH_TEXT = '#0b1220';


  // The one writer of a row plate's opacity, and it has to stay the one
  // writer. The flash drives this value every frame, which has to go
  // straight at the material — but A-Frame's material component caches
  // the data it was last given, so a setAttribute back to a value it
  // already believes is current is silently dropped. Mix the two and
  // the plate sticks at whatever the last animated frame wrote. Before
  // the geometry has built its mesh there is nothing to write to, so
  // that one case still goes through the component.
  function setPlateOpacity(el, value) {
    var mesh = el.getObject3D('mesh');
    if (mesh && mesh.material) mesh.material.opacity = value;
    else el.setAttribute('material', 'opacity', value);
  }

  // 'inboard' means "toward the centre of the view", which depends on
  // which side of the head the surface is anchored to.
  function resolveAlign(align, side) {
    if (align !== 'inboard') return align;
    return side === 'left' ? 'right' : 'left';
  }

  function eyeLayerFor(eye, side) {
    var resolved = eye === 'inboard' ? side : eye;
    if (resolved === 'left') return 1;
    if (resolved === 'right') return 2;
    return 0;
  }

  // A soft one-sided wash. Painted rather than a flat plane so the
  // inboard edge fades out instead of cutting across your view — the
  // same "generate the texture at runtime" approach the floor
  // checkerboard and the blood splatter already use.
  function buildScrimTexture(outward) {
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = 4;
    var ctx = canvas.getContext('2d');
    var gradient = outward < 0
      ? ctx.createLinearGradient(0, 0, size, 0)
      : ctx.createLinearGradient(size, 0, 0, 0);
    gradient.addColorStop(0, 'rgba(4,10,18,1)');
    gradient.addColorStop(0.55, 'rgba(4,10,18,0.72)');
    gradient.addColorStop(1, 'rgba(4,10,18,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, 4);
    return new THREE.CanvasTexture(canvas);
  }

  function edgeX(align, width, inset) {
    if (align === 'center') return 0;
    return align === 'right' ? width / 2 - inset : -width / 2 + inset;
  }

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
      // 'inboard' resolves against `side`: a left-anchored menu aligns
      // its text to its right edge, so the reading edge — the one
      // nearest your gaze — is flush and labels grow outward into the
      // periphery.
      align: { default: 'left', oneOf: ['left', 'center', 'right', 'inboard'] },
      // A one-sided wash behind the rows, painted as a gradient so it
      // fades out toward view centre instead of ending on a hard line.
      // Text over open sky needs it; text on a panel does not.
      scrim: { default: 0 },
      // Which eye draws this menu in XR. three.js gives the left eye
      // layer 1 and the right eye layer 2, so a single-eye menu leaves
      // the other eye a completely clear view of the world. Off a
      // headset there is one camera on layer 0, so this only applies
      // while presenting and is undone on exit.
      eye: { default: 'both', oneOf: ['both', 'left', 'right', 'inboard'] },
      // Which way "outboard" points, for the curve and the breadcrumb
      // rail. A left-hand visor menu is anchored on the left.
      side: { default: 'left', oneOf: ['left', 'right'] },
      maxChars: { default: 22 },
      open: { default: true },
      // What closing means, which is the surface's business rather than
      // the menu's. A watch panel vanishes because the wrist dropped;
      // the visor's does because the hand left the temple. A panel
      // standing in the room has no such trigger, so it collapses to
      // its title bar and stays there to be re-entered — otherwise
      // closing it deletes it from the world with no way back.
      closeBehavior: { default: 'collapse', oneOf: ['collapse', 'hide'] },
      // Per-letter fly-in for the breadcrumb title. 'none' snaps.
      titleMotion: { default: 'fly', oneOf: ['fly', 'none'] },
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
      // Draw over the world instead of standing in it. A panel bolted to
      // a wall is part of the room and should be occluded by whatever is
      // in front of it; a visor or watch menu is on your face, and being
      // eaten by a doorway is a bug. See applyOverlay for what this
      // actually does and why it stays at a real distance.
      overlay: { default: false },
      color: { type: 'color', default: '#dff3ff' },
      accent: { type: 'color', default: '#7fe3ff' },
    },

    init: function () {
      this.rows = [];
      this.crumbs = [];
      this.textAlign = resolveAlign(this.data.align, this.data.side);
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
      this.flashT0 = 0;
      // Picking up a phone mid-session changes what the footer should
      // say, and a touch device reports 'keyboard' until the first
      // actual touch, so this is not just a theoretical swap.
      this.onFamilyChanged = function () {
        if (self.locked && self.footerEl) self.footerEl.setAttribute('value', self.controlsHint());
      };
      this.el.sceneEl.addEventListener('input-family-changed', this.onFamilyChanged);
      // A label's mesh does not exist until its font has loaded, which
      // is after build and can be after the first render. setObject3D
      // bubbles, so this catches every part as it appears rather than
      // hoping they are all there by the time something re-renders.
      this.onObject3DSet = function () { self.applyOverlay(); };
      this.el.addEventListener('object3dset', this.onObject3DSet);
      this.menu.on('change', function () { self.render(); });
      this.menu.on('activate', function () { self.beginFlash(); });
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

      // Per-eye rendering is a layer assignment, and layers only mean
      // anything once WebXR's two cameras exist. Off a headset there is
      // one camera on layer 0, so applying it early would simply hide
      // the menu.
      this.applyEyeLayer = this.applyEyeLayer.bind(this);
      this.clearEyeLayer = this.clearEyeLayer.bind(this);
      if (eyeLayerFor(this.data.eye, this.data.side)) {
        this.el.sceneEl.addEventListener('enter-vr', this.applyEyeLayer);
        this.el.sceneEl.addEventListener('exit-vr', this.clearEyeLayer);
        if (this.el.sceneEl.is('vr-mode')) this.applyEyeLayer();
      }
    },

    // ---------- one eye, or both ----------

    setEye: function (eye) {
      if (this.data.eye === eye) return;
      this.el.setAttribute('crossbar-menu', 'eye', eye);
      if (this.el.sceneEl.is('vr-mode')) {
        if (eyeLayerFor(eye, this.data.side)) this.applyEyeLayer();
        else this.clearEyeLayer();
      }
    },

    applyEyeLayer: function () {
      var layer = eyeLayerFor(this.data.eye, this.data.side);
      if (!layer) return this.clearEyeLayer();
      this.el.object3D.traverse(function (object) { object.layers.set(layer); });
    },

    clearEyeLayer: function () {
      this.el.object3D.traverse(function (object) { object.layers.set(0); });
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
      title.setAttribute('align', this.textAlign === 'center' ? 'center' : this.textAlign);
      title.setAttribute('position', {
        x: edgeX(this.textAlign, data.width, 0.04),
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
        text.setAttribute('align', this.textAlign === 'center' ? 'center' : this.textAlign);
        text.setAttribute('width', data.width * 0.92);
        text.setAttribute('position', {
          x: edgeX(this.textAlign, data.width, data.width * 0.06),
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
      //
      // Built one character at a time rather than as a single a-text,
      // because the letters have to fly into place individually when
      // you change level: one text mesh can only move as a block.
      for (var c = 0; c < Math.max(0, data.breadcrumbDepth); c++) {
        var crumb = document.createElement('a-entity');
        crumb.setAttribute('rotation', '0 0 ' + (outward < 0 ? 90 : -90));
        crumb.setAttribute('position', {
          x: outward * (data.width / 2 + 0.05 + c * 0.075),
          y: 0,
          z: 0.002,
        });

        // A hit target for pointing, since individual letters are far
        // too small to aim at.
        var crumbTarget = document.createElement('a-entity');
        crumbTarget.classList.add('menu-target');
        crumbTarget.setAttribute('geometry', 'primitive: plane; width: ' + data.rowHeight * (data.windowSize * 0.7) + '; height: ' + data.rowHeight * 0.7);
        crumbTarget.setAttribute('material', 'color: ' + data.accent + '; shader: flat; opacity: 0; transparent: true; depthWrite: false');
        crumbTarget.addEventListener('click', this.onCrumbClick);
        crumb.appendChild(crumbTarget);

        var chars = [];
        for (var ci = 0; ci < CRUMB_MAX_CHARS; ci++) {
          var charEl = document.createElement('a-text');
          charEl.setAttribute('value', '');
          charEl.setAttribute('align', 'center');
          charEl.setAttribute('color', data.accent);
          charEl.setAttribute('width', data.width * 0.92);
          charEl.setAttribute('wrapCount', CRUMB_WRAP);
          charEl.object3D.visible = false;
          crumb.appendChild(charEl);
          chars.push(charEl);
        }

        this.el.appendChild(crumb);
        this.crumbs.push({ el: crumb, chars: chars, targetEl: crumbTarget, title: '' });
      }

      if (data.scrim > 0) {
        var scrim = document.createElement('a-entity');
        scrim.setAttribute('geometry', 'primitive: plane; width: ' + data.width * 2.1 + '; height: ' + data.rowHeight * (data.windowSize + 3));
        // The colour is set explicitly rather than left to the texture:
        // an unset a-frame material is white, so a scrim whose map has
        // not applied yet flashes as a bright slab across your view.
        scrim.setAttribute('material', 'color: #040a12; shader: flat; transparent: true; depthWrite: false; opacity: ' + data.scrim);
        // The wash sits outboard of the rows and fades toward centre.
        scrim.setAttribute('position', { x: outward * data.width * 0.55, y: 0, z: -0.03 });
        this.el.appendChild(scrim);
        this.scrimEl = scrim;
        var self2 = this;
        var applyScrim = function () {
          var mesh = scrim.getObject3D('mesh');
          if (!mesh || !mesh.material) return;
          mesh.material.map = buildScrimTexture(self2.outward);
          mesh.material.needsUpdate = true;
        };
        if (scrim.getObject3D('mesh')) applyScrim();
        else scrim.addEventListener('loaded', applyScrim, { once: true });
      }

      // The engaged-panel outline. Four bars rather than one plane: a
      // filled plane only reads as an outline while an opaque backing
      // sits in front of it, so on a plateless surface like the visor
      // it washes the whole panel pale instead of framing it.
      var glowWidth = data.width + 0.05;
      var glowHeight = data.rowHeight * (data.windowSize + 2) + 0.05;
      var bar = 0.008;
      var glow = document.createElement('a-entity');
      var edges = [
        { w: glowWidth, h: bar, x: 0, y: glowHeight / 2 },
        { w: glowWidth, h: bar, x: 0, y: -glowHeight / 2 },
        { w: bar, h: glowHeight, x: -glowWidth / 2, y: 0 },
        { w: bar, h: glowHeight, x: glowWidth / 2, y: 0 },
      ];
      this.glowBars = edges.map(function (edge) {
        var edgeEl = document.createElement('a-entity');
        edgeEl.setAttribute('geometry', 'primitive: plane; width: ' + edge.w + '; height: ' + edge.h);
        edgeEl.setAttribute('material', 'color: ' + data.accent + '; shader: flat; opacity: 0.55; transparent: true; depthWrite: false; side: double');
        edgeEl.setAttribute('position', { x: edge.x, y: edge.y, z: 0 });
        glow.appendChild(edgeEl);
        return edgeEl;
      });
      glow.setAttribute('position', '0 0 -0.005');
      glow.object3D.visible = false;
      this.el.appendChild(glow);
      this.glowEl = glow;

      // What the controls are, shown only while this menu actually has
      // them. "No sense of I'm using this right now" was the whole
      // complaint; a border alone did not carry it.
      var footer = document.createElement('a-text');
      footer.setAttribute('value', '');
      footer.setAttribute('align', this.textAlign === 'center' ? 'center' : this.textAlign);
      footer.setAttribute('color', data.accent);
      footer.setAttribute('width', data.width * 0.92);
      footer.setAttribute('wrapCount', 46);
      footer.setAttribute('position', {
        x: edgeX(this.textAlign, data.width, 0.04),
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
      var open = this.menu.isOpen;
      this.applyOverlay();

      // Closed does not have to mean gone. A panel set to collapse keeps
      // its backing and title so it still reads as a thing in the room,
      // and keeps its hint zone so E opens it again.
      var collapsed = !open && data.closeBehavior === 'collapse';
      this.el.object3D.visible = open || collapsed;
      if (this.footerEl && !open) this.footerEl.object3D.visible = false;
      if (this.titleEl) this.titleEl.setAttribute('text', 'opacity', open ? (this.locked ? 1 : 0.6) : 0.4);
      if (collapsed) {
        for (var h = 0; h < this.rows.length; h++) this.rows[h].el.object3D.visible = false;
        for (var hc = 0; hc < this.crumbs.length; hc++) this.setCrumb(this.crumbs[hc], '', hc, false);
        if (this.closeEl) this.closeEl.object3D.visible = false;
        if (this.backingEl) this.backingEl.setAttribute('material', 'opacity', 0.35);
        return;
      }
      if (!open) return;
      if (this.closeEl) this.closeEl.object3D.visible = true;
      if (this.backingEl) this.backingEl.setAttribute('material', 'opacity', this.locked ? 0.82 : 0.55);

      var half = (data.windowSize - 1) / 2;
      var inChrome = this.menu.inChrome();
      var frameTime = this.now();
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
        // The flash owns the focused row's plate and label while it
        // runs, so a render triggered part-way through it — a toggle
        // rewriting its own label, a push swapping the whole list —
        // neither dims the plate for a frame nor puts the text back to
        // accent on top of a bright one.
        var resting = (model.focused && !inChrome) ? PLATE_OPACITY : 0;
        var flashed = offset === 0 ? this.flashOpacity(frameTime, resting) : null;
        slot.textEl.setAttribute('color', flashed !== null ? FLASH_TEXT
          : (model.focused ? data.accent : data.color));
        slot.chevronEl.object3D.visible = Boolean(model.hasChildren);
        slot.chevronEl.setAttribute('text', 'opacity', opacity);
        setPlateOpacity(slot.el, flashed === null ? resting : flashed);
      }

      // While the title bar has the focus the list shows none, so there
      // is never a question about where a confirm would land.
      if (this.closeEl) {
        this.closeEl.setAttribute('material', 'opacity', inChrome ? PLATE_OPACITY * 1.6 : 0);
        this.closeGlyphEl.setAttribute('text', 'opacity', inChrome ? 1 : 0.45);
      }

      var crumbs = this.menu.getBreadcrumbs();
      for (var c = 0; c < this.crumbs.length; c++) {
        var crumb = crumbs[c];
        this.setCrumb(this.crumbs[c], crumb ? crumb.title : '', c, true);
      }
    },

    // ---------- the breadcrumb title, a letter at a time ----------

    // Letters fly in from the row that opened the level and out toward
    // it again on the way back, so going a level deeper reads as the
    // item you picked becoming the heading rather than as one label
    // being swapped for another.
    setCrumb: function (crumb, title, depth, animate) {
      var text = truncate(title || '', CRUMB_MAX_CHARS);
      if (crumb.title === text) return;
      var previous = crumb.title;
      crumb.title = text;

      var data = this.data;
      var advance = (data.width * 0.92) / CRUMB_WRAP;
      var opacity = FADE[Math.min(depth, FADE.length - 1)];
      var fly = animate && data.titleMotion === 'fly';
      var now = (this.el.sceneEl && this.el.sceneEl.time) || performance.now();

      // Where the letters come from and return to: the focused row,
      // expressed in this rail's own space.
      var origin = null;
      if (fly) {
        var focusedRow = this.focusedSlot();
        if (focusedRow) {
          focusedRow.el.object3D.getWorldPosition(this._handPosition);
          crumb.el.object3D.updateMatrixWorld(true);
          origin = crumb.el.object3D.worldToLocal(this._handPosition.clone());
        }
      }

      for (var i = 0; i < crumb.chars.length; i++) {
        var charEl = crumb.chars[i];
        var glyph = text.charAt(i);
        var targetX = (i - (text.length - 1) / 2) * advance;

        if (!glyph) {
          // Letters that are no longer part of the title fly back out
          // rather than blinking off.
          if (previous.charAt(i) && fly && origin) {
            this.animateChar(charEl, now, i, charEl.object3D.position.clone(),
              origin, charEl._opacity || opacity, 0, true);
          } else {
            charEl.object3D.visible = false;
            charEl._anim = null;
          }
          continue;
        }

        charEl.setAttribute('value', glyph);
        charEl.object3D.visible = true;
        if (!fly || !origin) {
          charEl.object3D.position.set(targetX, 0, 0);
          this.setCharOpacity(charEl, opacity);
          charEl._anim = null;
          continue;
        }
        var from = previous.charAt(i) ? charEl.object3D.position.clone() : origin.clone();
        this.animateChar(charEl, now, i, from, new THREE.Vector3(targetX, 0, 0),
          previous.charAt(i) ? (charEl._opacity || 0) : 0, opacity, false);
      }
    },

    animateChar: function (charEl, now, index, from, to, fromOpacity, toOpacity, hideAfter) {
      charEl._anim = {
        t0: now,
        delay: index * CRUMB_STAGGER_MS,
        from: from,
        to: to.clone ? to.clone() : to,
        o0: fromOpacity,
        o1: toOpacity,
        hideAfter: hideAfter,
      };
      charEl.object3D.position.copy(from);
      this.setCharOpacity(charEl, fromOpacity);
    },

    // Straight at the material, not through setAttribute: this runs for
    // every letter every frame while a title is moving, and a-text's
    // update path does more work than assigning a uniform.
    setCharOpacity: function (charEl, value) {
      charEl._opacity = value;
      var mesh = charEl.getObject3D('mesh');
      if (mesh && mesh.material) mesh.material.opacity = value;
    },

    // tick() is handed the scene clock, so anything scheduling against
    // it has to read that same clock rather than performance.now().
    now: function () {
      var sceneEl = this.el.sceneEl;
      return (sceneEl && typeof sceneEl.time === 'number') ? sceneEl.time : performance.now();
    },

    // The plate under the focused row, ramped to full and eased back
    // down to whatever the current state says it should rest at — which
    // after a submenu push is a different row than the one pressed.
    applyOverlay: function () {
      if (this.data.overlay) overlayAll(this.el);
    },

    focusedSlot: function () {
      return this.rows.length ? this.rows[(this.rows.length - 1) / 2 | 0] : null;
    },

    // Called before the activation acts, so this paints the row you
    // actually pressed. Whatever the row then does — pushing a level,
    // rewriting its own label — renders over the top with the flash
    // still on, which is why a category flashes while its letters fly
    // off to the breadcrumb rail. Lit on this frame rather than the
    // next, so a confirm and a dropped frame do not look the same.
    beginFlash: function () {
      if (!this.focusedSlot()) return;
      this.flashT0 = this.now();
      this.render();
    },

    // What the flash wants the focused plate to be right now, or null
    // when it is not running. render() asks too, not just the tick: a
    // push renders after the flash has been lit, and painting the
    // resting value over the top of it drops a frame out of the flash.
    flashOpacity: function (time, resting) {
      if (!this.flashT0) return null;
      var progress = (time - this.flashT0) / FLASH_MS;
      if (progress >= 1 || progress < 0) return null;
      // On instantly, held, then eased off — the shape of a button being
      // pressed. A symmetric fade from the first frame reads as a light
      // pulsing instead, and at speed you mostly miss the bright part.
      var fade = progress < FLASH_HOLD ? 0
        : Math.pow((progress - FLASH_HOLD) / (1 - FLASH_HOLD), 2);
      return FLASH_OPACITY + (resting - FLASH_OPACITY) * fade;
    },

    tickFlash: function (time) {
      if (!this.flashT0) return;
      var slot = this.focusedSlot();
      if (!slot) { this.flashT0 = 0; return; }

      var resting = (slot.row && slot.row.focused && !this.menu.inChrome()) ? PLATE_OPACITY : 0;
      var value = this.flashOpacity(time, resting);
      if (value === null) {
        this.flashT0 = 0;
        // A full render rather than just dropping the opacity back: it
        // puts the label's colour right too, and after a submenu push
        // this slot is showing a different row than the one pressed.
        this.render();
        return;
      }
      setPlateOpacity(slot.el, value);
    },

    tick: function (time) {
      this.tickFlash(time);
      if (!this.crumbs.length) return;
      for (var c = 0; c < this.crumbs.length; c++) {
        var chars = this.crumbs[c].chars;
        for (var i = 0; i < chars.length; i++) {
          var charEl = chars[i];
          var anim = charEl._anim;
          if (!anim) continue;
          var progress = (time - anim.t0 - anim.delay) / CRUMB_FLY_MS;
          if (progress < 0) continue;
          if (progress >= 1) {
            progress = 1;
            charEl._anim = null;
            if (anim.hideAfter) charEl.object3D.visible = false;
          }
          var eased = 1 - Math.pow(1 - progress, 3);
          charEl.object3D.position.lerpVectors(anim.from, anim.to, eased);
          this.setCharOpacity(charEl, anim.o0 + (anim.o1 - anim.o0) * eased);
        }
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

    // What this menu is telling you that you can press. Naming keys is
    // only right for the family that has keys — a phone entered the menu
    // with the INTERACT button and drives rows by tapping them, so
    // spelling out W/S/A/D there is instructions for a keyboard nobody
    // is holding. Touch has no stepping buttons of its own yet; see
    // TODO.md.
    controlsHint: function () {
      var router = this.el.sceneEl.systems['input-router'];
      var family = router && typeof router.getActiveFamily === 'function'
        ? router.getActiveFamily() : null;
      return family === 'touch'
        ? 'Tap a row, tap again to pick   INTERACT leaves'
        : 'W/S move   D enter   A back   E exit';
    },

    // Off a headset there is no hand to light up, so the panel has to
    // carry the whole "your keys are going here" signal by itself: a
    // bright border, a brighter title, and the controls spelled out
    // underneath.
    setLocked: function (locked) {
      if (this.locked === locked) return;
      this.locked = locked;
      if (this.glowEl) {
        this.glowEl.object3D.visible = locked || Boolean(this.engagedHand);
        (this.glowBars || []).forEach(function (edgeEl) {
          edgeEl.setAttribute('material', 'opacity', locked ? 0.95 : 0.5);
        });
      }
      if (this.footerEl) {
        this.footerEl.setAttribute('value', this.controlsHint());
        this.footerEl.object3D.visible = locked;
      }
      // While a menu holds the keys it stops advertising itself, and
      // says how to leave instead.
      this.el.setAttribute('hint-zone', 'desktopLabel', locked ? 'Exit menu' : this.data.hintLabel);
      this.el.emit(locked ? 'crossbar-menu-locked' : 'crossbar-menu-unlocked', {}, false);
      this.render();
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
      this.el.sceneEl.removeEventListener('input-family-changed', this.onFamilyChanged);
      this.el.removeEventListener('object3dset', this.onObject3DSet);
      this.el.sceneEl.removeEventListener('enter-vr', this.applyEyeLayer);
      this.el.sceneEl.removeEventListener('exit-vr', this.clearEyeLayer);
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
      // Explicit hand bindings, for surfaces where proximity is
      // meaningless: the visor's panel floats in front of your face
      // while the hand that opened it is beside your head, so the hand
      // is bound on purpose rather than resolved by distance.
      this.pinned = [];
      this.bindings = [];
      this.onKeyDown = this.onKeyDown.bind(this);
      window.addEventListener('keydown', this.onKeyDown);
      this.onActionIntent = this.onActionIntent.bind(this);
      // Emitted on the rig and bubbled, so the scene is where every
      // input family's buttons can be heard in one place.
      this.el.addEventListener('semantic-action-intent', this.onActionIntent);
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
      // Closing the menu you are holding hands the controls straight
      // back, whether it collapsed or vanished.
      if (this.lockedMenu && !this.lockedMenu.menu.isOpen) this.unlock();

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
      // A pinned hand's menu was chosen deliberately; proximity must
      // not take it away again.
      for (var pi = this.pinned.length - 1; pi >= 0; pi--) {
        var pin = this.pinned[pi];
        if (!pin.component.menu.isOpen || !this.handIsAvailable(pin.state.el)) {
          this.unpinHand(pin.component);
          continue;
        }
        this.pumpStick(pin.state, time);
      }

      var h;
      for (h = 0; h < this.hands.length; h++) {
        var state = this.hands[h];
        if (this.isPinned(state)) continue;
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
            if (component.data.stickRange <= 0) continue;
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
        if (this.isPinned(hand)) continue;
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
      if (!component) return null;
      // A collapsed panel is still offerable — that is the whole point
      // of collapsing rather than vanishing. Entering it opens it.
      return (component.menu.isOpen || component.data.closeBehavior === 'collapse')
        ? component
        : null;
    },

    pinHand: function (component, handEl) {
      this.unpinHand(component);
      var state = this.hands.filter(function (h) { return h.el === handEl; })[0];
      if (!state) return false;
      if (state.menu && state.menu !== component) state.menu.setEngagedHand(null);
      state.menu = component;
      state.armed = true;
      state.armedX = true;
      component.setEngagedHand(handEl);
      this.pinned.push({ component: component, state: state });
      return true;
    },

    unpinHand: function (component) {
      for (var i = this.pinned.length - 1; i >= 0; i--) {
        if (component && this.pinned[i].component !== component) continue;
        var entry = this.pinned[i];
        if (entry.state.menu === entry.component) {
          entry.component.setEngagedHand(null);
          entry.state.menu = null;
        }
        this.pinned.splice(i, 1);
      }
    },

    isPinned: function (state) {
      for (var i = 0; i < this.pinned.length; i++) {
        if (this.pinned[i].state === state) return true;
      }
      return false;
    },

    lock: function (component) {
      if (this.lockedMenu === component) return;
      if (this.lockedMenu) this.lockedMenu.setLocked(false);
      this.lockedMenu = component || null;
      if (component) {
        if (!component.menu.isOpen) component.menu.open();
        component.setLocked(true);
      }
      // Both the keyboard path (desktop-controls' own tick) and the
      // joystick path (locomotion) check this, so entering a menu
      // suspends walking without either of them needing to know what a
      // menu is.
      this.el.setAttribute('data-menu-locked', component ? 'true' : 'false');
    },

    unlock: function () {
      this.lock(null);
    },

    // The flat "enter or leave this menu" verb, wherever it came from:
    // E on a keyboard, the INTERACT button on a phone, the same button
    // on a gamepad. Answers whether a menu actually took it, so a
    // keyboard caller knows whether to swallow the key.
    toggleFlatLock: function () {
      var mode = this.el.systems['control-mode'];
      if (mode && mode.isMode('xr')) return false;
      if (this.lockedMenu) { this.unlock(); return true; }
      var prompted = this.getPromptedMenu();
      if (!prompted) return false;
      this.lock(prompted);
      return true;
    },

    // Touch and gamepad publish their buttons as intents rather than as
    // keys, so this is the same verb arriving by the other route. No
    // need to stop it reaching desktop-controls, which answers
    // 'interact' only when a *mounted* zone is the prompted one — and
    // the hint system offers exactly one zone at a time.
    onActionIntent: function (evt) {
      var detail = evt.detail;
      if (!detail || detail.phase !== 'perform' || detail.action !== 'interact') return;
      this.toggleFlatLock();
    },

    onKeyDown: function (evt) {
      var mode = this.el.systems['control-mode'];
      if (mode && mode.isMode('xr')) return;
      var locked = this.lockedMenu;

      if (evt.code === 'KeyE') {
        if (this.toggleFlatLock()) evt.preventDefault();
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
      this.el.removeEventListener('semantic-action-intent', this.onActionIntent);
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
