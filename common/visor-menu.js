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
//            the corner says so. It does what a headset player does:
//            desktop-controls moves your hand to the side of your head,
//            and the same gesture below opens the menu once the hand has
//            been there long enough. Backtick again takes the hand away.
//   Touch    the same hint, tapped.
//
// The side is chosen by which side of your head your hand is on, not
// by which hand it is, so reaching across works — and it is the same
// menu, with the same place remembered, whichever side it opens on.
// ============================================================

import { overlayAll } from './menu-crossbar.js';

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  // The temple zones are two spheres in head-local space, mirrored left
  // and right, set live from the menu (Settings > Activation): how big,
  // how far out from the middle of your head, and how far forward or
  // back. Beside and a little behind the eyes by default, which keeps
  // them out of the volume where you hold something up to aim, and a
  // hand holding anything is ignored outright (readHand), so aiming a
  // gun never comes near them.
  //
  // Once a side is open or its bar is filling, the zone grows by this
  // much, so a hand resting on the boundary does not stutter the bar.
  var HOLD_MARGIN = 0.06;
  // A band around each sphere where the arc's dim track appears, so you
  // can see where you are heading before anything starts.
  var APPROACH_MARGIN = 0.08;
  // Where a row's highlight plate ends, as a fraction of the panel's
  // width from its centre (crossbar-menu draws plates 0.94 wide). The
  // Position setting measures to here.
  var ROW_EDGE = 0.47;
  // How much faster the bar drains than it fills when your hand and the
  // menu agree again. Draining rather than snapping to zero is what
  // makes the gesture survive tracking noise: controllers beside your
  // head sit at the edge of the headset cameras' view, and one bad frame
  // used to throw away a second of holding still.
  var DWELL_DRAIN_RATE = 3;

  // The zone view: metres of diagram per metre of real space, how far
  // out from your head it shows, how thick its lines are, and roughly
  // how big a head is, for scale.
  var ZONE_VIEW_SCALE = 0.4;
  var ZONE_VIEW_REACH = 0.55;
  var ZONE_LINE = 0.008;
  var HEAD_RADIUS = 0.09;
  // How far in front of you the zone view floats.
  var EXTRAS_DISTANCE = 1.5;

  function ringGeometry(radius, thickness) {
    return new THREE.RingGeometry(Math.max(0.0005, radius - thickness / 2), radius + thickness / 2, 48);
  }

  // Distance from a head-local point to one side's sphere centre.
  function zoneDistance(local, activation, sign) {
    var dx = local.x - sign * activation.side;
    var dy = local.y;
    var dz = local.z + activation.forward;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
      // How long a hand has to stay at your temple to open it. Long enough
      // that brushing past your ear doesn't open anything, short enough
      // that it doesn't feel like waiting.
      openMs: { default: 1200 },
      // How long it has to be away to close it. Much shorter: putting
      // your hand down is a clear intent, and a menu that lingers after
      // you have stopped using it is in the way.
      closeMs: { default: 400 },
      // The temple spheres, in metres: radius, how far out from the
      // middle of your head, and how far forward (+) or back (-).
      zoneRadius: { default: 0.15 },
      zoneSide: { default: 0.22 },
      zoneForward: { default: -0.06 },
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
      // How far the bar has got, 0..1, while the menu disagrees with
      // where your hand is. Drained (not reset) the moment they agree
      // again, which is what lets you call off a close by bringing your
      // hand back.
      this.progress = 0;
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
      this.activation = {
        radius: this.data.zoneRadius, side: this.data.zoneSide, forward: this.data.zoneForward,
        openMs: this.data.openMs, closeMs: this.data.closeMs,
      };
      this.scrim = 0;
      // Where each hand was last frame, head-local, for the zone view.
      this.handReadings = [];
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
        // The menu spans most of an eye's height, so a card hung from its
        // title would sit up at the top of your view; beside the selected
        // row is where you are already looking.
        sidecarAlign: 'center',
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
      this.buildExtras();

      var self = this;
      var ready = function () {
        self.component = panel.components['crossbar-menu'];
        self.component.menu.on('change', function () { self.updateExtras(); });
        // Closed from inside — E or Esc off a headset — is closed: the
        // keys go back, and whoever put a hand to your head takes it away.
        panel.addEventListener('crossbar-menu-close', function () {
          if (self.openSide) self.close();
        });
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
      this.placeExtras(side);
    },

    // Change any of the layout settings live, with the menu open.
    setLayout: function (values) {
      for (var key in values) {
        if (Object.prototype.hasOwnProperty.call(this.settings, key)) this.settings[key] = values[key];
      }
      this.placeFor(this.panelSide);
      this.refreshInfo();
    },

    // ---------- the zone view ----------
    //
    // Shown only while you are inside a submenu that asks for it (page
    // data: `zones: true`), on the side of your view opposite the menu so
    // it does not cover it. Both eyes and drawn over the world, so a
    // headset screenshot catches it whatever the Eyes and Draw settings
    // are. The temple spheres and your hands, live: the spheres sit beside
    // and behind your eyes, so you could never see them directly even if
    // your head were not inside one; this draws them as two small maps
    // instead, from above and from behind, with each hand's dot lit while
    // it is actually inside a sphere. (The settings summary that used to
    // float beside it is now the menu's own sidecar — see describe.)
    buildExtras: function () {
      var accent = '#7fe3ff';

      var zones = document.createElement('a-entity');
      var zonesBack = document.createElement('a-plane');
      zonesBack.setAttribute('width', 1.0);
      zonesBack.setAttribute('height', 0.58);
      zonesBack.setAttribute('material', 'color: #040a12; shader: flat; transparent: true; opacity: 0.82; depthWrite: false');
      zones.appendChild(zonesBack);
      var group = new THREE.Group();
      var mat = function (color, opacity) {
        return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: opacity, depthWrite: false });
      };
      var views = [
        { name: 'FROM ABOVE', x: -0.25, flip: function (p) { return [p.x, -p.z]; } },
        { name: 'FROM BEHIND', x: 0.25, flip: function (p) { return [p.x, p.y]; } },
      ];
      this.zoneViews = views.map(function (view) {
        var g = new THREE.Group();
        g.position.set(view.x, -0.025, 0.003);
        group.add(g);
        var mk = function (material) { var m = new THREE.Mesh(new THREE.BufferGeometry(), material); g.add(m); return m; };
        var head = mk(mat('#9fb0d4', 0.6));
        head.geometry = ringGeometry(HEAD_RADIUS * ZONE_VIEW_SCALE, ZONE_LINE);
        var label = document.createElement('a-text');
        label.setAttribute('value', view.name);
        label.setAttribute('align', 'center');
        label.setAttribute('width', 0.42);
        label.setAttribute('wrap-count', 16);
        label.setAttribute('color', accent);
        label.setAttribute('position', { x: view.x, y: 0.245, z: 0.003 });
        zones.appendChild(label);
        return {
          flip: view.flip,
          rings: [mk(mat(accent, 0.55)), mk(mat(accent, 0.55))],
          approach: [mk(mat(accent, 0.15)), mk(mat(accent, 0.15))],
          dots: [0, 1].map(function () {
            var dot = mk(mat('#9fb0d4', 0.9));
            dot.geometry = new THREE.CircleGeometry(0.017, 20);
            return dot;
          }),
        };
      });
      zones.setObject3D('zones', group);
      zones.object3D.visible = false;
      this.cameraEl.appendChild(zones);
      this.zonesEl = zones;

      var lift = function (el) {
        var apply = function () { overlayAll(el); };
        el.addEventListener('object3dset', apply);
        apply();
      };
      lift(zones);
      this.rebuildZones();
    },

    // Opposite the menu, so the two can be read together.
    placeExtras: function (side) {
      if (!this.zonesEl) return;
      var opposite = side === 'left' ? 1 : -1;
      var put = function (el, across, up) {
        var a = across * Math.PI / 180;
        var u = up * Math.PI / 180;
        el.setAttribute('position', {
          x: opposite * EXTRAS_DISTANCE * Math.sin(a) * Math.cos(u),
          y: EXTRAS_DISTANCE * Math.sin(u),
          z: -EXTRAS_DISTANCE * Math.cos(a) * Math.cos(u),
        });
        el.setAttribute('rotation', { x: up, y: -opposite * across, z: 0 });
      };
      put(this.zonesEl, 20, -15);
    },

    updateExtras: function () {
      if (!this.zonesEl || !this.component) return;
      var menu = this.component.menu;
      var zones = menu.isOpen && menu.inside('zones');
      if (zones && !this.zonesEl.object3D.visible) this.rebuildZones();
      this.zonesEl.object3D.visible = zones;
    },

    // Every visor setting at once, for the menu's sidecar while you are in
    // Settings (page data: `info` on that submenu), so a tuned layout goes
    // out as one screenshot rather than read off row by row. Short lines:
    // it sits beside the menu, not across the view.
    describe: function () {
      var s = this.settings;
      var a = this.activation;
      var deg = function (v) { return (Math.round(v * 10) / 10) + '°'; };
      var cm = function (m) { return Math.round(m * 100) + ' cm'; };
      var sec = function (ms) { return (ms / 1000).toFixed(2) + ' s'; };
      var titles = { title: 'Top', inside: 'Inner', outside: 'Outer' };
      return [
        'VISOR',
        'Position ' + deg(s.position) + '  Lift ' + deg(s.lift),
        'Width ' + deg(s.width) + '  Height ' + deg(s.height),
        'Curve ' + deg(s.curve) + '  Titles ' + titles[s.crumbs],
        'Eyes ' + (this.eyesMode === 'inboard' ? 'One' : 'Both') + '  Draw ' + (this.drawMode === 'screen' ? 'Screen' : 'World'),
        'Scrim ' + (this.scrim > 0 ? 'On' : 'Off'),
        '',
        'ACTIVATION',
        'Radius ' + cm(a.radius) + '  Side ' + cm(a.side),
        'Forward ' + cm(a.forward),
        'Open ' + sec(a.openMs) + '  Close ' + sec(a.closeMs),
      ].join('\n');
    },

    // A setting changed: redraw, so the sidecar's summary (read fresh on
    // every render) shows the new value.
    refreshInfo: function () {
      if (this.component && this.component.menu) this.component.render();
    },

    // Rings for the current sphere settings. Rebuilt only when a setting
    // changes or the view opens — the per-frame work is just the dots.
    rebuildZones: function () {
      if (!this.zoneViews) return;
      var a = this.activation;
      this.zoneViews.forEach(function (view) {
        [-1, 1].forEach(function (sign, k) {
          var centre = view.flip({ x: sign * a.side, y: 0, z: -a.forward });
          [[view.rings[k], a.radius], [view.approach[k], a.radius + APPROACH_MARGIN]].forEach(function (pair) {
            var mesh = pair[0];
            mesh.geometry.dispose();
            mesh.geometry = ringGeometry(pair[1] * ZONE_VIEW_SCALE, ZONE_LINE);
            mesh.position.set(centre[0] * ZONE_VIEW_SCALE, centre[1] * ZONE_VIEW_SCALE, 0);
          });
        });
      });
    },

    updateZones: function () {
      var readings = this.handReadings;
      var limit = ZONE_VIEW_REACH;
      var lit = { left: false, right: false };
      for (var r = 0; r < readings.length; r++) if (readings[r].side) lit[readings[r].side] = true;
      this.zoneViews.forEach(function (view) {
        view.rings[0].material.opacity = lit.left ? 1 : 0.55;
        view.rings[1].material.opacity = lit.right ? 1 : 0.55;
        view.dots.forEach(function (dot, k) {
          var reading = readings[k];
          dot.visible = Boolean(reading);
          if (!reading) return;
          var p = view.flip(reading);
          dot.position.set(
            Math.max(-limit, Math.min(limit, p[0])) * ZONE_VIEW_SCALE,
            Math.max(-limit, Math.min(limit, p[1])) * ZONE_VIEW_SCALE,
            0.001);
          dot.material.color.set(reading.side ? '#7fe3ff' : (reading.held ? '#c97a5a' : '#9fb0d4'));
        });
      });
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
        self.request();
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
      this.refreshInfo();
    },

    // Which eye. One panel now, so this is one decision.
    setEyes: function (mode) {
      this.eyesMode = mode;
      this.applySurface();
      this.refreshInfo();
    },

    setScrim: function (opacity) {
      this.scrim = opacity;
      if (this.component) this.component.setScrim(opacity);
      this.refreshInfo();
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
      var mode = this.sceneEl.systems['control-mode'];
      if (system) {
        // In XR the hand that opened it drives it, wherever that hand
        // then goes: the panel is out in front of your face and the hand
        // is beside your head, so proximity is meaningless here. Off a
        // headset it is a keyboard lock like any other menu — even when a
        // (simulated) hand opened it, since there is no stick to pin.
        if (handEl && mode && mode.isMode('xr')) system.pinHand(component, handEl);
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

    // Backtick or the corner button. Off a headset the input layer
    // (desktop-controls) answers by moving a hand to your temple, or away
    // again, and the gesture does the rest. Only a page with no such
    // layer gets the menu toggled directly.
    request: function () {
      var detail = { handled: false };
      this.sceneEl.emit('visor-menu-request', detail, false);
      if (!detail.handled) this.toggle(this.panelSide);
    },

    onKeyDown: function (evt) {
      if (evt.code !== this.data.key) return;
      // Never steal a keystroke from a text field.
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      evt.preventDefault();
      if (!evt.repeat) this.request();
    },

    // ---------- the temple gesture ----------

    tick: function (time, delta) {
      var component = this.component;
      if (!component) return;
      // The zone view needs hand positions whether or not anything is
      // under way, and off a headset too, so it can be checked on a
      // desktop; the gesture itself is XR-only below.
      this.readHands();
      if (this.zonesEl && this.zonesEl.object3D.visible) this.updateZones();

      // Off a headset too: desktop and touch move the same hands a
      // headset does (desktop-controls puts one to your temple on
      // backtick), so the gesture is the one way the visor opens. A
      // resting desktop hand sits in front of you, nowhere near a zone.
      if (!this.cameraEl || !this.hands.length) {
        this.progress = 0;
        component.setProgress(0, false);
        return;
      }

      var atTemple = {};
      var near = {};
      for (var i = 0; i < this.handReadings.length; i++) {
        var reading = this.handReadings[i];
        if (reading.near && !near[reading.near]) near[reading.near] = true;
        if (reading.side && !atTemple[reading.side]) atTemple[reading.side] = reading.el;
      }

      var open = component.menu.isOpen;
      // While the menu is closed and nothing is under way, the panel
      // follows whichever temple your hand is heading for, so the arc
      // fills on the side you are actually reaching to.
      if (!open && this.progress === 0) {
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
      // mid-close and the arc simply drains and nothing happens. Closing
      // is quicker than opening (closeMs vs openMs): putting your hand
      // down is a clear intent, and a menu that lingers is in the way.
      var dwelling = Boolean(hand) !== open;
      var duration = Math.max(1, open ? this.activation.closeMs : this.activation.openMs);
      this.progress = dwelling
        ? Math.min(1, this.progress + delta / duration)
        // Drain, don't snap: see DWELL_DRAIN_RATE.
        : Math.max(0, this.progress - (delta * DWELL_DRAIN_RATE) / duration);
      // The dim track shows on approach only while closed — next to an
      // open menu it would be a permanent bar saying nothing.
      component.setProgress(this.progress, this.progress > 0 || (!open && Boolean(near[side])));

      if (!dwelling || this.progress < 1) return;
      this.progress = 0;
      component.setProgress(0, false);
      if (hand) this.open(side, hand);
      else this.close();
    },

    // Every hand, once a frame: where it is in head space and which zone,
    // if any, it is in or near. Which side of your HEAD, not which hand,
    // so reaching across works. There is no speed check: a swing past
    // your ear spends a fifth of a second in a zone and the dwell needs
    // far longer, while a speed limit tripped on a centimetre of tracking
    // jitter and threw the whole bar away.
    readHands: function () {
      var readings = this.handReadings;
      readings.length = 0;
      if (!this.cameraEl) return;
      for (var i = 0; i < this.hands.length; i++) {
        var handEl = this.hands[i];
        var semantic = handEl.components['semantic-hand'];
        var holdingSomething = Boolean(semantic && semantic.heldEl);
        handEl.object3D.getWorldPosition(this._local);
        // worldToLocal refreshes the camera's own world matrix on the way,
        // which is all this needs.
        this.cameraEl.object3D.worldToLocal(this._local);
        var reading = { el: handEl, x: this._local.x, y: this._local.y, z: this._local.z,
          side: null, near: null, held: holdingSomething };
        if (!holdingSomething) this.classify(reading);
        readings.push(reading);
      }
    },

    classify: function (reading) {
      var a = this.activation;
      var bestIn = Infinity;
      var bestNear = Infinity;
      for (var k = 0; k < 2; k++) {
        var side = k === 0 ? 'left' : 'right';
        var d = zoneDistance(reading, a, side === 'left' ? -1 : 1);
        // Hold on harder once something is under way on that side.
        var holding = side === this.panelSide && (this.isOpen() || this.progress > 0);
        if (d <= a.radius + (holding ? HOLD_MARGIN : 0) && d < bestIn) {
          bestIn = d;
          reading.side = side;
        }
        if (d <= a.radius + APPROACH_MARGIN && d < bestNear) {
          bestNear = d;
          reading.near = side;
        }
      }
    },

    // Change the activation zones or timings live. Metres and ms.
    setActivation: function (values) {
      for (var key in values) {
        if (Object.prototype.hasOwnProperty.call(this.activation, key)) this.activation[key] = values[key];
      }
      this.rebuildZones();
      this.refreshInfo();
    },

    remove: function () {
      window.removeEventListener('keydown', this.onKeyDown);
      this.sceneEl.removeEventListener('enter-vr', this.onXrChange);
      this.sceneEl.removeEventListener('exit-vr', this.onXrChange);
    },
  });
}
