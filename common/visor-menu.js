// ============================================================
// VISOR MENU — the third surface of the shared menu system.
//
// A crossbar menu anchored to one side of your view and locked to your
// head, the way a helmet display would be. It is the same
// `crossbar-menu` as the watch and the wall panels, with four schema
// values turned on: a curve, inboard text alignment, a one-sided
// scrim, and (optionally) a single eye.
//
// What is new here is only how it OPENS, which is different on each
// device for the same reason the watch is:
//
//   XR       hold an empty hand beside your head. A pip at the edge of
//            vision lights and fills while you hold; when it is full
//            the menu opens on that side, and that hand drives it.
//   Desktop  backtick, next to Tab, which is the watch. A soft hint in
//            the corner says so.
//   Touch    the same hint, tapped.
//
// The side is chosen by which side of your head your hand is on, not
// by which hand it is, so reaching across works. Only one visor menu is
// open at a time.
// ============================================================

import { overlayAll, screenSpaceAll } from './menu-crossbar.js';

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  // The temple zone, in head-local metres. Beside and slightly BEHIND
  // the eyes on purpose: that keeps it out of the volume where you hold
  // something up to aim, which in Pistols is most of the time.
  // Generous on purpose. The first version was a 19x26x32cm box that
  // only filled with the hand in exactly the right spot; this is roughly
  // where its approach hint used to light up, which is where people
  // actually put their hand. Still off to the side of the face and
  // reaching back past the ear, and a hand holding anything is ignored
  // outright (readHand), so aiming a gun never comes near it.
  var TEMPLE = {
    xMin: 0.08, xMax: 0.42,
    yMin: -0.24, yMax: 0.22,
    zMin: -0.18, zMax: 0.34,
  };
  // Once a side is open or its bar is filling, the zone grows by this
  // much, so a hand resting on the boundary does not stutter the bar.
  var TEMPLE_HOLD_MARGIN = 0.06;
  // The panel's size and where it sits, as fractions of the focal
  // distance and degrees off centre. See buildSide.
  var VISOR_WIDTH = 0.5;
  var VISOR_ROW = 0.1;
  var VISOR_CENTRE_DEG = 28.5;
  var PIP_DEG = 43;

  // A band around the zone where the pip appears, dim, so you can see
  // where you are heading before anything starts.
  var TEMPLE_APPROACH_MARGIN = 0.08;
  // How much faster a bar drains than it fills when your hand and the
  // menu agree again. Draining rather than snapping to zero is what
  // makes the gesture survive tracking noise: controllers beside your
  // head sit at the edge of the headset cameras' view, and one bad
  // frame used to throw away a second of holding still. Now it costs a
  // few frames. A real change of mind still empties a full bar in well
  // under half a second.
  var DWELL_DRAIN_RATE = 3;
  // Never closer to the middle of your face than this, even with
  // margins added — otherwise a hand in front of your nose would count
  // as "approaching" whichever side its sign happened to land on.
  var TEMPLE_X_FLOOR = 0.04;

  function insideTemple(local, margin) {
    var m = margin || 0;
    var x = Math.abs(local.x);
    return x >= Math.max(TEMPLE_X_FLOOR, TEMPLE.xMin - m) && x <= TEMPLE.xMax + m &&
      local.y >= TEMPLE.yMin - m && local.y <= TEMPLE.yMax + m &&
      local.z >= TEMPLE.zMin - m && local.z <= TEMPLE.zMax + m;
  }

  // The pip belongs to the visor surface, so it is drawn the same way
  // the panel is. Its own anchor sits just outboard of the panel's, so
  // the two keep their relationship on the screen as well as in the
  // world.
  function setPipDraw(pipEl, mode) {
    overlayAll(pipEl);
    screenSpaceAll(pipEl, mode === 'screen' ? {
      anchor: { x: Number(pipEl.dataset.pipAnchorX), y: 0 },
      width: 0.02,
      localWidth: Number(pipEl.dataset.pipWidth),
    } : null);
  }

  // ============================================================
  // SYSTEM: visor-menu
  // ============================================================
  AFRAME.registerSystem('visor-menu', {
    schema: {
      leftPage: { type: 'string', default: '' },
      rightPage: { type: 'string', default: '' },
      // How long a hand has to stay at your temple. Long enough that
      // brushing past your ear doesn't open anything, short enough that
      // it doesn't feel like waiting.
      dwellMs: { default: 1200 },
      distance: { default: 1.8 },
      // 'world' keeps the panel a real object at `distance`, drawn over
      // everything — stereo-correct, so both eyes converge where it
      // actually is. 'screen' paints it onto the display instead:
      // identical in both eyes, no depth, no parallax, fixed size.
      // Switchable live so the difference can be judged in a headset
      // rather than argued about.
      draw: { default: 'world', oneOf: ['world', 'screen'] },
      // 'both' draws to both eyes; 'inboard' draws each side's panel to
      // the eye on that side only, so it sits in peripheral vision the
      // way a helmet display would rather than floating in front of you.
      // Composes with `draw`: one eye and screen space are independent
      // choices, and the interesting one is both at once.
      eyes: { default: 'both', oneOf: ['both', 'inboard'] },
      key: { type: 'string', default: 'Backquote' },
      hint: { default: true },
    },

    init: function () {
      this.panels = {};
      this.pips = {};
      this.openSide = null;
      this.hands = [];
      // How long each side has spent disagreeing with where your hand
      // is. Reset the moment they agree again, which is what lets you
      // call off a close by bringing your hand back.
      this.dwellMs = { left: 0, right: 0 };
      // The schema seeds these; from then on they are the truth (see
      // setDraw for why they cannot live in the attribute).
      this.drawMode = this.data.draw;
      this.eyesMode = this.data.eyes;
      this._local = new THREE.Vector3();
      this.onKeyDown = this.onKeyDown.bind(this);
      window.addEventListener('keydown', this.onKeyDown);

      var self = this;
      this.sceneEl.addEventListener('loaded', function () {
        self.build();
      });
      // Entering and leaving a headset both change what the eye setting
      // means — there are two cameras or there is one — so the whole
      // surface is re-applied at each transition rather than assumed.
      this.onXrChange = function () { self.applySurface(); };
      this.sceneEl.addEventListener('enter-vr', this.onXrChange);
      this.sceneEl.addEventListener('exit-vr', this.onXrChange);
    },

    build: function () {
      var data = this.data;
      if (!data.leftPage && !data.rightPage) return;
      var cameraEl = this.sceneEl.camera && this.sceneEl.camera.el;
      if (!cameraEl) return;
      this.cameraEl = cameraEl;

      if (data.leftPage) this.buildSide('left', data.leftPage);
      if (data.rightPage) this.buildSide('right', data.rightPage);

      this.hands = Array.prototype.slice.call(document.querySelectorAll('[semantic-hand]'));
      if (data.hint) this.buildFlatHint();
    },

    buildSide: function (side, page) {
      var data = this.data;
      var self = this;
      var sign = side === 'left' ? -1 : 1;

      // Head-locked: a child of the camera, at a fixed distance. The
      // numbers come from the wireframes — a 1.8m focal distance,
      // pitched a little below the horizon because resting gaze is not
      // the horizon, and anchored so the rows sit 15-19 degrees off
      // centre where they are readable without covering the middle.
      var panel = document.createElement('a-entity');
      panel.setAttribute('id', 'visor-menu-' + side);
      // Placed by angle, not by eye. The wireframes put a visor menu's
      // inboard edge at about 15 degrees off centre — outside the aim
      // core, inside the readable band — and its outboard edge at about
      // 32, where the glance band ends. For a panel 0.36 of the focal
      // distance wide, that puts its centre at 0.45 of the distance to
      // the side. Yawed to roughly face the eye rather than lying flat
      // across the view.
      // Bigger than the first cut, which was hard to read: 0.5 of the
      // focal distance wide puts a character at about 1.65 degrees, a
      // third larger. The extra size goes outboard rather than inboard —
      // the panel's centre moves out to 28.5 degrees and it is yawed to
      // face the eye, so its inboard edge stays near 16 degrees, outside
      // the part of the view you aim with, and its outboard edge lands
      // around 41.
      var centreAngle = VISOR_CENTRE_DEG * Math.PI / 180;
      panel.setAttribute('position', {
        x: sign * data.distance * Math.tan(centreAngle),
        y: -data.distance * 0.035,
        z: -data.distance,
      });
      panel.setAttribute('rotation', { x: 0, y: -sign * VISOR_CENTRE_DEG, z: 0 });
      panel.setAttribute('crossbar-menu', {
        page: page,
        side: side,
        align: 'inboard',
        // The focused row reaches inboard, so the two sides read as
        // ") (" around the middle of your view. 3.5 degrees at 1.8m.
        curve: 0.11,
        // Floating text: no backing, no wash behind it, no frame. The
        // visor's own Scrim row can still bring the wash back.
        scrim: 0,
        plate: false,
        frame: false,
        width: data.distance * VISOR_WIDTH,
        rowHeight: data.distance * VISOR_ROW,
        maxChars: 14,
        windowSize: 5,
        breadcrumbDepth: 1,
        open: false,
        closeBehavior: 'hide',
        // No X. Taking your hand away from your head is how this one
        // closes, so a button that can also close it is a second,
        // worse answer to a question already settled by the gesture --
        // and one that can strand the menu if the gesture is what
        // reopens it.
        closable: false,
        // The visor is transient — it should not strand you three
        // levels deep because you closed it to shoot someone.
        memory: 'temporary',
        // A head-locked panel is never something you walk up to.
        stickRange: 0,
        hintLabel: '',
        // On your face, not in the room. Without this the panel is
        // ordinary depth-tested geometry at 1.8m, so anything nearer —
        // a wall, a doorway, a table you are standing at — cuts through
        // it, which in a headset reads as the menu being broken rather
        // than as the world being in front of it. 'screen' goes further
        // and paints it onto the display; see setDraw.
        overlay: this.drawMode,
        eye: this.eyesMode,
        // The same enlargement in screen space: a wider slice, its inner
        // edge held about where it was.
        screenAnchor: { x: sign * 0.55, y: 0 },
        screenWidth: 0.42,
      });
      panel.setAttribute('crossbar-menu-registration', '');
      this.cameraEl.appendChild(panel);
      this.panels[side] = panel;

      // The pip: a small bracket at the edge of vision on that side,
      // dim until your hand is at your temple, then filling as you
      // hold. Without it the gesture is invisible — you would be
      // holding your hand next to your head hoping something happens.
      var pip = document.createElement('a-entity');
      // Just beyond the menu's outboard edge (about 41 degrees), so it
      // is visible whether or not the menu is open and never sits under
      // the rows.
      var pipAngle = PIP_DEG * Math.PI / 180;
      pip.setAttribute('position', {
        x: sign * data.distance * Math.tan(pipAngle),
        y: -data.distance * 0.035,
        z: -data.distance,
      });
      pip.setAttribute('rotation', { x: 0, y: -sign * PIP_DEG, z: 0 });

      var track = document.createElement('a-entity');
      track.setAttribute('geometry', 'primitive: plane; width: ' + data.distance * 0.022 + '; height: ' + data.distance * 0.17);
      track.setAttribute('material', 'color: #7fe3ff; shader: flat; transparent: true; opacity: 0.16; depthWrite: false');
      pip.appendChild(track);

      var fill = document.createElement('a-entity');
      fill.setAttribute('geometry', 'primitive: plane; width: ' + data.distance * 0.022 + '; height: ' + data.distance * 0.17);
      fill.setAttribute('material', 'color: #7fe3ff; shader: flat; transparent: true; opacity: 0.95; depthWrite: false');
      fill.object3D.scale.y = 0.001;
      pip.appendChild(fill);

      pip.object3D.visible = false;
      fill.object3D.visible = false;
      this.cameraEl.appendChild(pip);
      // The pip is part of the same visor surface, so it is drawn over
      // the world for the same reason the panel is — a gesture hint you
      // can lose behind a doorframe is not a hint — and it follows the
      // panel between world and screen drawing.
      pip.dataset.pipWidth = String(data.distance * 0.022);
      pip.dataset.pipAnchorX = String(sign * 0.82);
      var applyPip = function () { setPipDraw(pip, self.drawMode); };
      pip.addEventListener('object3dset', applyPip);
      applyPip();
      this.pips[side] = { el: pip, trackEl: track, fillEl: fill, height: data.distance * 0.17 };
    },

    // A corner hint off a headset, so the key is discoverable rather
    // than something you have to be told. Tappable, which is also the
    // whole touch story.
    buildFlatHint: function () {
      var self = this;
      var hint = document.createElement('button');
      hint.type = 'button';
      hint.className = 'visor-menu-hint';
      hint.innerHTML = '<span class="visor-menu-key">`</span><span class="visor-menu-label">Visor</span>';
      hint.setAttribute('aria-label', 'Open the visor menu');
      var style = document.createElement('style');
      // Styled to match interaction-hints' corner hint (dark pill, white
      // key cap) rather than inventing a second look, and placed to dodge
      // what touch-controls already owns: the movement joystick is
      // bottom-left, the action grid bottom-right, the hotbar
      // bottom-centre, and the shared corner hint bottom-right. That
      // leaves the left edge -- but only above the joystick, so on touch
      // this lifts clear of it. Below the touch overlay's z-index but
      // outside the look area, which starts at 38% from the left.
      style.textContent = [
        '.visor-menu-hint{position:fixed;left:max(14px,env(safe-area-inset-left));',
        'bottom:max(14px,env(safe-area-inset-bottom));z-index:26;display:flex;align-items:center;gap:8px;',
        'background:rgba(8,11,18,.78);color:#cbd5e1;font:600 12px system-ui;padding:6px 10px 6px 6px;',
        'border-radius:8px;cursor:pointer;border:0;box-shadow:0 2px 8px #0006}',
        // Clear of the 112px joystick that sits in this corner on touch.
        'html[data-input-family="touch"] .visor-menu-hint{bottom:max(152px,calc(env(safe-area-inset-bottom) + 148px))}',
        '.visor-menu-hint[hidden]{display:none}',
        '.visor-menu-hint.is-open{background:rgba(127,227,255,.22);color:#eaf9ff}',
        '.visor-menu-key{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;',
        'padding:0 5px;border-radius:4px;background:#fff;color:#111722;font:700 11px system-ui}',
      ].join('');
      document.head.appendChild(style);
      hint.addEventListener('click', function (evt) {
        evt.preventDefault();
        self.toggle(self.openSide || 'left');
      });
      document.body.appendChild(hint);
      this.hintEl = hint;

      this.sceneEl.addEventListener('enter-vr', function () { hint.hidden = true; });
      this.sceneEl.addEventListener('exit-vr', function () { hint.hidden = false; });
    },

    // Switch both panels between "a real object drawn on top" and
    // "painted on the display", live, with the menu open. The pips move
    // with them: they are part of the same surface, and a gesture hint
    // drawn one way beside a menu drawn the other would be incoherent.
    // Held as plain fields, not written back through the scene
    // attribute. `visor-menu` is a system with no component of the same
    // name, so setAttribute(name, property, value) does not merge a
    // property into it the way it would on an entity — it falls through
    // to the raw DOM attribute and replaces the whole thing with the
    // property name, wiping leftPage, rightPage and the rest.
    setDraw: function (mode) {
      this.drawMode = mode;
      this.applySurface();
    },

    // Which eye, for both panels and both pips at once. Per surface
    // rather than per panel: "the visor is in my left eye" is one
    // decision, and a pip drawn to both eyes beside a panel drawn to one
    // would read as a rendering fault.
    setEyes: function (mode) {
      this.eyesMode = mode;
      this.applySurface();
    },

    applySurface: function () {
      var self = this;
      var inXr = this.sceneEl.is('vr-mode');
      ['left', 'right'].forEach(function (side) {
        var panel = self.panels[side];
        if (panel && panel.components['crossbar-menu']) {
          // A panel IS a component, so this one does merge properly.
          panel.setAttribute('crossbar-menu', 'overlay', self.drawMode);
          panel.components['crossbar-menu'].setEye(self.eyesMode);
          panel.components['crossbar-menu'].render();
        }
        var pip = self.pips[side];
        if (!pip) return;
        setPipDraw(pip.el, self.drawMode);
        // Layers only mean anything once WebXR's two cameras exist; off
        // a headset everything has to be back on layer 0 or it is drawn
        // for nobody.
        var layer = (inXr && self.eyesMode === 'inboard') ? (side === 'left' ? 1 : 2) : 0;
        pip.el.object3D.traverse(function (object) { object.layers.set(layer); });
      });
    },

    // ---------- opening and closing ----------

    isOpen: function (side) {
      var panel = this.panels[side];
      return Boolean(panel && panel.components['crossbar-menu'] &&
        panel.components['crossbar-menu'].menu.isOpen);
    },

    open: function (side, handEl) {
      var panel = this.panels[side];
      if (!panel) return false;
      if (this.openSide && this.openSide !== side) this.close(this.openSide);
      var component = panel.components['crossbar-menu'];
      component.menu.open();
      this.openSide = side;

      var system = this.sceneEl.systems['menu-stick-control'];
      if (system) {
        // In XR the hand that opened it drives it, wherever that hand
        // then goes: the panel is out in front of your face and the
        // hand is beside your head, so proximity is meaningless here.
        // Off a headset it is a keyboard lock like any other menu.
        if (handEl) system.pinHand(component, handEl);
        else system.lock(component);
      }
      if (this.hintEl) this.hintEl.classList.add('is-open');
      this.sceneEl.emit('visor-menu-opened', { side: side, handEl: handEl || null }, false);
      return true;
    },

    close: function (side) {
      var panel = this.panels[side || this.openSide];
      if (!panel) return false;
      var component = panel.components['crossbar-menu'];
      component.menu.close();
      var system = this.sceneEl.systems['menu-stick-control'];
      if (system) {
        system.unpinHand(component);
        if (system.lockedMenu === component) system.unlock();
      }
      if (this.openSide === (side || this.openSide)) this.openSide = null;
      if (this.hintEl) this.hintEl.classList.remove('is-open');
      this.sceneEl.emit('visor-menu-closed', { side: side }, false);
      return true;
    },

    toggle: function (side, handEl) {
      if (this.isOpen(side)) return this.close(side);
      return this.open(side, handEl);
    },

    onKeyDown: function (evt) {
      if (evt.code !== this.data.key) return;
      // Never steal a keystroke from a text field.
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      evt.preventDefault();
      this.toggle(this.openSide || (this.data.leftPage ? 'left' : 'right'));
    },

    // ---------- the temple gesture ----------

    tick: function (time, delta) {
      var mode = this.sceneEl.systems['control-mode'];
      // Off a headset there is no hand to hold to your head, so the pip
      // advertises a gesture that does not exist — and a permanent bar
      // at the edge of vision reads as a menu that failed to close
      // rather than as a hint. Backtick and the corner button are the
      // flat story; the pips are XR-only.
      if (!mode || !mode.isMode('xr') || !this.cameraEl) return this.hidePips();
      if (!this.hands.length) return this.hidePips();

      var atTemple = {};
      var approaching = {};
      for (var i = 0; i < this.hands.length; i++) {
        var handEl = this.hands[i];
        var state = this.readHand(handEl);
        if (!state) continue;
        if (state.approachSide) approaching[state.approachSide] = true;
        if (!state.side || !this.panels[state.side]) continue;
        if (!atTemple[state.side]) atTemple[state.side] = handEl;
      }

      // The gesture is a state, not a switch. Your hand being at your
      // temple is what "menu open" means; it being away is what "menu
      // closed" means. The bar is the delay before the state catches up
      // with your hand, in whichever direction they currently disagree —
      // so bring your hand back mid-close and the bar simply empties and
      // nothing happens, which is the whole point of showing it.
      for (var side in this.panels) {
        var hand = atTemple[side] || null;
        var open = this.isOpen(side);
        var wantOpen = Boolean(hand);
        var dwelling = wantOpen !== open;

        if (!dwelling) {
          // Drain, don't snap: see DWELL_DRAIN_RATE.
          this.dwellMs[side] = Math.max(0, (this.dwellMs[side] || 0) - delta * DWELL_DRAIN_RATE);
        } else {
          this.dwellMs[side] = (this.dwellMs[side] || 0) + delta;
        }
        var progress = Math.min(1, this.dwellMs[side] / this.data.dwellMs);
        this.setPipPresence(side,
          dwelling || progress > 0 || Boolean(approaching[side]), Boolean(hand));
        this.setPipProgress(side, progress);
        if (!dwelling || progress < 1) continue;

        this.dwellMs[side] = 0;
        this.setPipProgress(side, 0);
        if (wantOpen) this.open(side, hand);
        else this.close(side);
      }
    },

    // Everything the gesture needs to know about one hand this frame:
    // where it is in head space, how fast it is moving, whether it is on
    // its way to a temple, and whether it has arrived.
    // Purely geometric: whether the hand is in a temple zone, and which
    // side of your HEAD it is on rather than which hand it is, so
    // reaching across works. What that means is the tick's business.
    //
    // There is no speed check any more. It existed so a hand swung past
    // your ear would not open anything — but the dwell already does
    // that, since a swing spends a fifth of a second in the zone and the
    // bar needs well over a second. Meanwhile the check was the main
    // reason the gesture felt finicky: a centimetre of tracking jitter
    // in one 72Hz frame is over the old limit, and that one frame threw
    // away the whole bar.
    readHand: function (handEl) {
      var semantic = handEl.components['semantic-hand'];
      if (semantic && semantic.heldEl) return null;

      handEl.object3D.getWorldPosition(this._local);
      // worldToLocal refreshes the camera's own world matrix on the way
      // (updateWorldMatrix up its parents), which is all this needs. The
      // recursive updateMatrixWorld(true) that used to sit here re-ran
      // the camera's whole subtree — both visor panels included — once
      // per hand per frame for nothing.
      this.cameraEl.object3D.worldToLocal(this._local);

      var approachSide = insideTemple(this._local, TEMPLE_APPROACH_MARGIN)
        ? (this._local.x < 0 ? 'left' : 'right')
        : null;

      var side = this._local.x < 0 ? 'left' : 'right';
      // Hold on harder once something is under way on that side.
      var holding = this.isOpen(side) || this.dwellMs[side] > 0;
      var margin = holding ? TEMPLE_HOLD_MARGIN : 0;
      if (!insideTemple(this._local, margin)) return { approachSide: approachSide, side: null };
      return { approachSide: approachSide, side: side };
    },

    // Present only while a hand is on its way to the temple, and
    // brighter once it has arrived.
    setPipPresence: function (side, approaching, arrived) {
      var pip = this.pips[side];
      if (!pip) return;
      pip.el.object3D.visible = approaching;
      if (!approaching) {
        this.setPipProgress(side, 0);
        return;
      }
      // Every frame while visible, so only touch the component when the
      // value actually changes.
      var opacity = arrived ? 0.5 : 0.2;
      if (pip.trackOpacity !== opacity) {
        pip.trackOpacity = opacity;
        pip.trackEl.setAttribute('material', 'opacity', opacity);
      }
    },

    hidePips: function () {
      for (var side in this.pips) {
        if (this.pips[side].el.object3D.visible) this.setPipPresence(side, false, false);
      }
    },

    setPipProgress: function (side, progress) {
      var pip = this.pips[side];
      if (!pip) return;
      // Hidden rather than left as a bright sliver at zero.
      pip.fillEl.object3D.visible = progress > 0.01;
      pip.fillEl.object3D.scale.y = Math.max(0.001, progress);
      // Grows from the bottom rather than the middle.
      pip.fillEl.object3D.position.y = -pip.height * (1 - progress) / 2;
    },

    remove: function () {
      window.removeEventListener('keydown', this.onKeyDown);
    },
  });
}
