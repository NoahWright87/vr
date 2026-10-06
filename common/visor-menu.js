// ============================================================
// VISOR MENU — the third surface of the shared menu system.
//
// One crossbar menu, locked to your head the way a helmet display
// would be, that appears beside whichever temple you reach for. It is
// the same `crossbar-menu` as the watch and the wall panels, laid out
// as floating text with a curve, inboard alignment and (optionally) a
// single eye; every one of those is adjustable from inside it.
//
// It OPENS differently on each device, for the same reason the watch
// does:
//
//   XR       hold an empty hand beside your head. An arc fills along
//            the curve the rows will sit on; when it is full the menu
//            appears in its place, and that hand drives it. Take the
//            hand away and the arc fills again before it leaves.
//   Desktop  backtick, next to Tab, which is the watch. A soft hint in
//            the corner says so.
//   Touch    the same hint, tapped.
//
// The side is chosen by which side of your head your hand is on, not
// by which hand it is, so reaching across works — and it is the same
// menu, with the same place remembered, whichever side it opens on.
// ============================================================

import './menu-crossbar.js';

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
  // Where a row's highlight plate ends, as a fraction of the panel's
  // width from its centre (crossbar-menu draws plates 0.94 wide). The
  // Position setting measures to here.
  var ROW_EDGE = 0.47;

  // A band around the zone where the arc's track appears, dim, so you
  // can see where you are heading before anything starts.
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

  // ============================================================
  // SYSTEM: visor-menu
  // ============================================================
  AFRAME.registerSystem('visor-menu', {
    schema: {
      // One menu. It appears beside whichever temple you hold your hand
      // to, the same way the watch is one menu you can raise with either
      // wrist — so it is yours whichever hand you prefer.
      page: { type: 'string', default: '' },
      // Older two-page markup; the first one given is used.
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
      draw: { default: 'world', oneOf: ['world', 'screen'] },
      // 'both' draws to both eyes; 'inboard' draws it to the eye on the
      // side it opened on. Composes with `draw`.
      eyes: { default: 'both', oneOf: ['both', 'inboard'] },
      // Layout, in degrees of your view, all live-adjustable from the
      // visor's own menu. See placeFor.
      //   position — how far from straight ahead the selected row sits
      //   lift     — how far above (+) or below (-) eye level it sits
      //   width    — how wide the panel is, which sets the text size
      //   height   — top row to bottom row
      //   curve    — how much further inboard the selected row reaches
      //              than the top and bottom ones
      position: { default: 4 },
      lift: { default: -3 },
      width: { default: 30 },
      height: { default: 64 },
      curve: { default: 9 },
      crumbs: { default: 'title', oneOf: ['outside', 'inside', 'title'] },
      key: { type: 'string', default: 'Backquote' },
      hint: { default: true },
    },

    init: function () {
      this.openSide = null;
      this.panelSide = 'left';
      this.hands = [];
      // How long the menu has spent disagreeing with where your hand is.
      // Drained (not reset) the moment they agree again, which is what
      // lets you call off a close by bringing your hand back.
      this.dwellMs = 0;
      // The schema seeds these; from then on they are the truth. They
      // cannot live in the scene attribute: `visor-menu` is a system with
      // no component of the same name, so setAttribute(name, prop, value)
      // does not merge a property into it the way it would on an entity —
      // it replaces the whole DOM attribute with the property name.
      this.drawMode = this.data.draw;
      this.eyesMode = this.data.eyes;
      this.settings = {
        position: this.data.position, lift: this.data.lift, width: this.data.width,
        height: this.data.height, curve: this.data.curve, crumbs: this.data.crumbs,
      };
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
      var page = data.page || data.leftPage || data.rightPage;
      if (!page) return;
      var cameraEl = this.sceneEl.camera && this.sceneEl.camera.el;
      if (!cameraEl) return;
      this.cameraEl = cameraEl;

      // Head-locked: a child of the camera. Where exactly is placeFor's
      // job, since it changes with the side you open it on and with the
      // layout settings.
      var panel = document.createElement('a-entity');
      panel.setAttribute('id', 'visor-menu');
      panel.setAttribute('crossbar-menu', {
        page: page,
        side: this.panelSide,
        align: 'inboard',
        // Floating text: no backing, no wash behind it, no frame. The
        // visor's own Scrim row can still bring the wash back.
        scrim: 0,
        plate: false,
        frame: false,
        progressArc: true,
        maxChars: 14,
        windowSize: 5,
        breadcrumbDepth: 1,
        open: false,
        closeBehavior: 'hide',
        // No X. Taking your hand away from your head is how this one
        // closes, so a button that can also close it is a second, worse
        // answer to a question the gesture already settles — and one
        // that can strand the menu if the gesture is what reopens it.
        closable: false,
        // The visor is transient — it should not strand you three levels
        // deep because you closed it to shoot someone.
        memory: 'temporary',
        // A head-locked panel is never something you walk up to.
        stickRange: 0,
        hintLabel: '',
        // On your face, not in the room: drawn over the world rather than
        // cut through by the nearest doorway. 'screen' paints it onto the
        // display instead; see setDraw.
        overlay: this.drawMode,
        eye: this.eyesMode,
      });
      panel.setAttribute('crossbar-menu-registration', '');
      cameraEl.appendChild(panel);
      this.panel = panel;

      this.hands = Array.prototype.slice.call(document.querySelectorAll('[semantic-hand]'));
      if (data.hint) this.buildFlatHint();

      // components['crossbar-menu'] exists the moment the entity is
      // attached, but its init — which builds the panel's parts — waits
      // for the entity to load. Placing it before then lays out nothing.
      var self = this;
      var ready = function () {
        self.component = panel.components['crossbar-menu'];
        self.placeFor(self.panelSide);
      };
      if (panel.hasLoaded) ready();
      else panel.addEventListener('loaded', ready, { once: true });
    },

    // Put the one panel beside the given temple, sized and placed from
    // the layout settings. Everything is in degrees of your view and
    // converted at the focal distance, because "how far into my view" is
    // the question the settings answer, not "how many metres".
    //
    // The selected row's inboard end sits at `position` degrees from
    // straight ahead; the top and bottom rows sit `curve` degrees further
    // out, so a pair would read ") (" around what you are looking at.
    // The panel is yawed and pitched to face your eye, so its far edge
    // is not foreshortened.
    placeFor: function (side) {
      var component = this.component;
      if (!component) return;
      var d = this.data.distance;
      var s = this.settings;
      var rad = Math.PI / 180;
      var sign = side === 'left' ? -1 : 1;
      var half = (component.data.windowSize - 1) / 2;

      var width = 2 * d * Math.tan(s.width / 2 * rad);
      // The panel is yawed to face your eye, so a point `a` metres along
      // its face from the centre sits at exactly centre - atan(a/d)
      // degrees. That lets the edges be solved for rather than
      // approximated: the selected row's inboard edge (the plate's edge,
      // ROW_EDGE of the way out) at `position`, the top and bottom rows'
      // at `position + curve`.
      var edge = ROW_EDGE * width;
      var edgeDeg = Math.atan(edge / d) / rad;
      var curveMetres = d * Math.tan((s.curve + edgeDeg) * rad) - edge;
      var centre = s.position + s.curve + edgeDeg;
      var inboard = centre - s.width / 2;
      // Text size follows from the width (14 characters across it); the
      // row is a little over two characters tall. Spacing is separate —
      // see crossbar-menu's rowSpacing.
      var rowHeight = (width * 0.92 / component.data.maxChars) * 2.4;
      var rowSpacing = d * Math.tan(s.height / 2 * rad) / Math.max(1, half);

      this.panelSide = side;
      component.setLayout({
        side: side,
        width: width,
        rowHeight: rowHeight,
        rowSpacing: rowSpacing,
        curve: curveMetres,
        crumbs: s.crumbs,
        // The same placement for screen-space drawing, as a slice of the
        // display: tan(angle) is close enough to NDC for a headset's
        // roughly 90-degree eye.
        screenAnchor: { x: sign * Math.tan(centre * rad), y: Math.tan(s.lift * rad) },
        screenWidth: Math.tan((inboard + s.width) * rad) - Math.tan(inboard * rad),
      });
      // The eye a one-eyed panel draws to follows the side it is on.
      component.applyEyeLayer();

      var c = centre * rad;
      var l = s.lift * rad;
      this.panel.setAttribute('position', {
        x: sign * d * Math.sin(c) * Math.cos(l),
        y: d * Math.sin(l),
        z: -d * Math.cos(c) * Math.cos(l),
      });
      this.panel.setAttribute('rotation', { x: s.lift, y: -sign * centre, z: 0 });
    },

    // Change any of the layout settings live, with the menu open.
    setLayout: function (values) {
      for (var key in values) {
        if (Object.prototype.hasOwnProperty.call(this.settings, key)) this.settings[key] = values[key];
      }
      this.placeFor(this.panelSide);
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

    // Switch between "a real object drawn on top" and "painted on the
    // display", live, with the menu open.
    setDraw: function (mode) {
      this.drawMode = mode;
      this.applySurface();
    },

    // Which eye. One panel now, so this is one decision.
    setEyes: function (mode) {
      this.eyesMode = mode;
      this.applySurface();
    },

    setScrim: function (opacity) {
      if (this.component) this.component.setScrim(opacity);
    },

    applySurface: function () {
      var component = this.component;
      if (!component) return;
      // The panel IS a component, so this one does merge properly.
      this.panel.setAttribute('crossbar-menu', 'overlay', this.drawMode);
      component.setEye(this.eyesMode);
      component.render();
    },

    // ---------- opening and closing ----------

    // With no side, "is it open at all".
    isOpen: function (side) {
      var component = this.component;
      if (!component || !component.menu.isOpen) return false;
      return !side || this.panelSide === side;
    },

    open: function (side, handEl) {
      var component = this.component;
      if (!component) return false;
      if (side && side !== this.panelSide) this.placeFor(side);
      component.menu.open();
      this.openSide = this.panelSide;

      var system = this.sceneEl.systems['menu-stick-control'];
      if (system) {
        // In XR the hand that opened it drives it, wherever that hand
        // then goes: the panel is out in front of your face and the hand
        // is beside your head, so proximity is meaningless here. Off a
        // headset it is a keyboard lock like any other menu.
        if (handEl) system.pinHand(component, handEl);
        else system.lock(component);
      }
      if (this.hintEl) this.hintEl.classList.add('is-open');
      this.sceneEl.emit('visor-menu-opened', { side: this.panelSide, handEl: handEl || null }, false);
      return true;
    },

    close: function () {
      var component = this.component;
      if (!component) return false;
      component.menu.close();
      var system = this.sceneEl.systems['menu-stick-control'];
      if (system) {
        system.unpinHand(component);
        if (system.lockedMenu === component) system.unlock();
      }
      var side = this.openSide;
      this.openSide = null;
      if (this.hintEl) this.hintEl.classList.remove('is-open');
      this.sceneEl.emit('visor-menu-closed', { side: side }, false);
      return true;
    },

    toggle: function (side, handEl) {
      if (this.isOpen()) return this.close();
      return this.open(side, handEl);
    },

    onKeyDown: function (evt) {
      if (evt.code !== this.data.key) return;
      // Never steal a keystroke from a text field.
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      evt.preventDefault();
      this.toggle(this.panelSide);
    },

    // ---------- the temple gesture ----------

    tick: function (time, delta) {
      var component = this.component;
      if (!component) return;
      var mode = this.sceneEl.systems['control-mode'];
      // Off a headset there is no hand to hold to your head, so the arc
      // would advertise a gesture that does not exist. Backtick and the
      // corner button are the flat story.
      if (!mode || !mode.isMode('xr') || !this.cameraEl || !this.hands.length) {
        this.dwellMs = 0;
        component.setProgress(0, false);
        return;
      }

      var atTemple = {};
      var near = {};
      for (var i = 0; i < this.hands.length; i++) {
        var handEl = this.hands[i];
        var state = this.readHand(handEl);
        if (!state) continue;
        if (state.approachSide) near[state.approachSide] = true;
        if (state.side && !atTemple[state.side]) atTemple[state.side] = handEl;
      }

      var open = component.menu.isOpen;
      // While the menu is closed and nothing is under way, the panel
      // follows whichever temple your hand is heading for, so the arc
      // fills on the side you are actually reaching to.
      if (!open && this.dwellMs === 0) {
        var want = atTemple.left ? 'left' : atTemple.right ? 'right'
          : near.left ? 'left' : near.right ? 'right' : null;
        if (want && want !== this.panelSide) this.placeFor(want);
      }
      var side = this.panelSide;
      var hand = atTemple[side] || null;

      // The gesture is a state, not a switch. Your hand at that temple is
      // what "open" means; away is what "closed" means. The arc is the
      // delay before the menu catches up with your hand, in whichever
      // direction they currently disagree — so bring your hand back
      // mid-close and the arc simply drains and nothing happens.
      var dwelling = Boolean(hand) !== open;
      this.dwellMs = dwelling
        ? this.dwellMs + delta
        // Drain, don't snap: see DWELL_DRAIN_RATE.
        : Math.max(0, this.dwellMs - delta * DWELL_DRAIN_RATE);
      var progress = Math.min(1, this.dwellMs / this.data.dwellMs);
      // The dim track shows on approach only while closed — next to an
      // open menu it would be a permanent bar saying nothing.
      component.setProgress(progress, progress > 0 || (!open && Boolean(near[side])));

      if (!dwelling || progress < 1) return;
      this.dwellMs = 0;
      component.setProgress(0, false);
      if (hand) this.open(side, hand);
      else this.close();
    },

    // Purely geometric: whether the hand is in a temple zone, and which
    // side of your HEAD it is on rather than which hand it is, so
    // reaching across works. What that means is the tick's business.
    //
    // There is no speed check: a swing past your ear spends a fifth of a
    // second in the zone and the dwell needs well over a second, while a
    // speed limit tripped on a centimetre of tracking jitter and threw
    // the whole bar away.
    readHand: function (handEl) {
      var semantic = handEl.components['semantic-hand'];
      if (semantic && semantic.heldEl) return null;

      handEl.object3D.getWorldPosition(this._local);
      // worldToLocal refreshes the camera's own world matrix on the way,
      // which is all this needs.
      this.cameraEl.object3D.worldToLocal(this._local);

      var approachSide = insideTemple(this._local, TEMPLE_APPROACH_MARGIN)
        ? (this._local.x < 0 ? 'left' : 'right')
        : null;

      var side = this._local.x < 0 ? 'left' : 'right';
      // Hold on harder once something is under way on that side.
      var holding = side === this.panelSide && (this.isOpen() || this.dwellMs > 0);
      var margin = holding ? TEMPLE_HOLD_MARGIN : 0;
      if (!insideTemple(this._local, margin)) return { approachSide: approachSide, side: null };
      return { approachSide: approachSide, side: side };
    },

    remove: function () {
      window.removeEventListener('keydown', this.onKeyDown);
      this.sceneEl.removeEventListener('enter-vr', this.onXrChange);
      this.sceneEl.removeEventListener('exit-vr', this.onXrChange);
    },
  });
}
