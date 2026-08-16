      // ==============================================================
      // ITEMS: tank
      // A backpack with a hatch and a nozzle on the end of a hose, and
      // it is not a flamethrower. It's a thing that sprays whatever is
      // in the tank, and what's in the tank is whatever you last poured
      // in through the open hatch. Water makes it a fire hose. Beer
      // makes it a way to get a room drunk, or to drink from a distance
      // if your aim is poor enough to hit your own face. Fire makes it
      // the obvious thing.
      //
      // None of those are modes. There is no list of what the tank can
      // hold: it takes a droplet's liquid type, whatever that happens
      // to be, and the nozzle sprays droplets of it. Everything after
      // that — burning, dousing, pooling, getting you drunk, catching
      // light off a hot barrel — is the liquid system doing what it
      // already does. Light the beer you're pouring in and you fill the
      // tank with fire; hold a match over an open tank of beer and it
      // catches by itself.
      //
      // THE NOZZLE is a separate object with its home socket on the
      // pack's chest strap, and that placement is the whole answer to
      // "how do I grab the hose rather than the pack". Worn, the tank
      // is behind you and the nozzle is at your chest: reaching over
      // your shoulder takes the pack off, reaching to your chest draws
      // the nozzle. Two different gestures, no rule needed. The hose
      // itself is drawn, not simulated — and if the nozzle ends up
      // loose further away than the hose is long, it reels home.
      //
      // Split out of game.js — see DESIGN.md's "File structure" section.
      // TANK_MOUTH_RADIUS itself stays in game.js: world-systems' own
      // droplet-into-container check (fillContainer) reads it too.
      // ==============================================================

      var TANK_WIDTH = 0.3;
      var TANK_HEIGHT = 0.34;
      var TANK_DEPTH = 0.17;
      var HATCH_OPEN_DEG = -115;
      var HATCH_SPEED_DEG = 420; // degrees/second — a hatch swings, it doesn't snap like a Zippo
      var HATCH_AUTOCLOSE_MS = 12000; // long enough to pour, short enough that you'll be caught out once
      var HOSE_LENGTH = 1.5;
      var HOSE_SEGMENTS = 5;
      var HOSE_SAG = 0.22;
      var SPRAY_RATE = 60; // droplets/second out of the nozzle
      var SPRAY_SPEED = 7.5; // m/s, which is what makes it a jet rather than a pour
      var SPRAY_SPREAD = 0.9; // m/s of sideways scatter at the nozzle, so it cones out
      // The pack and the nozzle. Note that neither declaration says
      // anything about fire, water or beer: the tank holds a liquid
      // type and the nozzle sprays it, and which one it is arrives
      // later, through the hatch, as ordinary droplets.
      defineItem('tank', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          holsterPosition: { x: 0, y: 0, z: 0.06 },
          grabRadius: 0.24,
          comOffset: { x: 0, y: -0.1, z: 0 },
          maxThrowSpeed: 5,
        });
        el.setAttribute('boxy-tank', '');
        el.setAttribute('hatch', '');
        el.setAttribute('liquid-tank', '');
      });

      // Marked `keep`, and its clip is stocked once rather than
      // refilling: between them that's the fix for a hose that grew a
      // second hose every five seconds you spent holding the first one.
      defineItem('nozzle', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: -60, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.17, // generous, because this is the thing you mean to grab
          comOffset: { x: 0, y: 0, z: -0.1 },
        });
        el.setAttribute('boxy-nozzle', '');
        el.setAttribute('nozzle', '');
      }, { keep: true });
      // ==============================================================
      // COMPONENT: boxy-tank / boxy-nozzle
      // A pack with a hinged lid, a little window showing what's in it,
      // and a clip on the chest strap for the nozzle. The clip is an
      // ordinary anchor-slot, and where it SITS is the whole reason
      // this rig is usable — see THE TANK AND THE HOSE.
      // ==============================================================
      var _tankSerial = 0;

      registerComponent('boxy-tank', {
        init: function () {
          var el = this.el;
          var steel = '#5a6068';
          var strap = '#3a2f24';

          function box(w, h, d, pos, color, rot, cls) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            if (rot) b.setAttribute('rotation', rot);
            if (cls) b.classList.add(cls);
            el.appendChild(b);
            return b;
          }

          // The tank is GLASS, and what's in it is a solid block of
          // colour inside it. An indicator stripe on one face was
          // useless in practice: worn, the whole pack is behind you, so
          // whatever tells you what you loaded has to be visible from
          // every angle and from across the room. A see-through tank
          // full of orange is legible at a glance; a gauge is not.
          var glass = document.createElement('a-box');
          glass.setAttribute('width', TANK_WIDTH);
          glass.setAttribute('height', TANK_HEIGHT);
          glass.setAttribute('depth', TANK_DEPTH);
          glass.setAttribute('material', 'color: #b9c6cc; opacity: 0.35; transparent: true; side: double');
          el.appendChild(glass);

          // The contents. Hidden while empty, and coloured by whatever
          // was last poured in.
          var fill = document.createElement('a-box');
          fill.setAttribute('width', TANK_WIDTH - 0.03);
          fill.setAttribute('height', TANK_HEIGHT - 0.05);
          fill.setAttribute('depth', TANK_DEPTH - 0.03);
          fill.setAttribute('material', 'color: #2b2b2f; shader: flat; opacity: 0.85; transparent: true');
          fill.setAttribute('visible', false);
          fill.classList.add('tank-gauge');
          el.appendChild(fill);

          // Bands top and bottom, so it reads as a vessel rather than
          // a floating cube.
          box(TANK_WIDTH + 0.02, 0.03, TANK_DEPTH + 0.02, { x: 0, y: TANK_HEIGHT * 0.42, z: 0 }, '#3f454b');
          box(TANK_WIDTH + 0.02, 0.03, TANK_DEPTH + 0.02, { x: 0, y: -TANK_HEIGHT * 0.42, z: 0 }, '#3f454b');

          // Straps, and the clip on the front one.
          box(0.05, 0.02, 0.5, { x: -0.11, y: TANK_HEIGHT * 0.34, z: -0.25 }, strap, '14 0 0');
          box(0.05, 0.02, 0.5, { x: 0.11, y: TANK_HEIGHT * 0.34, z: -0.25 }, strap, '14 0 0');

          // The filler neck and its lid. The lid hinges at the back of
          // the neck, so it falls shut under the hatch component's own
          // easing rather than snapping.
          var neck = document.createElement('a-cylinder');
          neck.setAttribute('radius', 0.055);
          neck.setAttribute('height', 0.05);
          neck.setAttribute('color', '#3f454b');
          neck.setAttribute('position', { x: 0, y: TANK_HEIGHT / 2 + 0.025, z: 0 });
          el.appendChild(neck);

          var hinge = document.createElement('a-entity');
          hinge.setAttribute('position', { x: 0, y: TANK_HEIGHT / 2 + 0.05, z: 0.055 });
          hinge.classList.add('hatch-lid');
          el.appendChild(hinge);

          var lid = document.createElement('a-cylinder');
          lid.setAttribute('radius', 0.062);
          lid.setAttribute('height', 0.018);
          lid.setAttribute('color', '#6b7078');
          lid.setAttribute('position', { x: 0, y: 0, z: -0.055 });
          hinge.appendChild(lid);

          var mouth = document.createElement('a-entity');
          mouth.setAttribute('position', { x: 0, y: TANK_HEIGHT / 2 + 0.05, z: 0 });
          mouth.classList.add('tank-mouth');
          el.appendChild(mouth);

          var outlet = document.createElement('a-entity');
          outlet.setAttribute('position', { x: 0.1, y: -TANK_HEIGHT / 2 - 0.01, z: -0.04 });
          outlet.classList.add('hose-outlet');
          el.appendChild(outlet);

          // The nozzle's home: down the front strap, at chest height
          // once the pack is on. Reaching here is a different gesture
          // from reaching over your shoulder for the pack itself, which
          // is the entire trick.
          var clip = document.createElement('a-entity');
          clip.setAttribute('id', 'tank-clip-' + _tankSerial++);
          clip.classList.add('anchor-slot');
          clip.setAttribute('anchor-slot', { size: 'small', indicatorScale: 0.8 });
          clip.setAttribute('position', { x: 0.13, y: -0.02, z: -0.42 });
          el.appendChild(clip);
          // The clip brings its own nozzle, and brings another if you
          // manage to lose one. That's a refill rather than a one-off
          // stock because a hose without a nozzle is scrap, not a
          // consequence.
          clip.setAttribute('stocked', { item: 'nozzle' });
        },
      });

      registerComponent('boxy-nozzle', {
        init: function () {
          var el = this.el;

          var body = document.createElement('a-box');
          body.setAttribute('width', 0.04);
          body.setAttribute('height', 0.1);
          body.setAttribute('depth', 0.05);
          body.setAttribute('position', { x: 0, y: -0.04, z: 0.02 });
          body.setAttribute('color', '#3f454b');
          el.appendChild(body);

          var barrel = document.createElement('a-cylinder');
          barrel.setAttribute('radius', 0.017);
          barrel.setAttribute('height', 0.26);
          barrel.setAttribute('color', '#5a6068');
          barrel.setAttribute('rotation', '90 0 0');
          barrel.setAttribute('position', { x: 0, y: 0.01, z: -0.11 });
          el.appendChild(barrel);

          var cone = document.createElement('a-cone');
          cone.setAttribute('radius-bottom', 0.026);
          cone.setAttribute('radius-top', 0.012);
          cone.setAttribute('height', 0.05);
          cone.setAttribute('color', '#8a7a45');
          cone.setAttribute('rotation', '-90 0 0');
          cone.setAttribute('position', { x: 0, y: 0.01, z: -0.25 });
          el.appendChild(cone);

          // The band that says what's loaded, on the thing you're
          // holding when it matters.
          var band = document.createElement('a-cylinder');
          band.setAttribute('radius', 0.024);
          band.setAttribute('height', 0.03);
          band.setAttribute('rotation', '90 0 0');
          band.setAttribute('position', { x: 0, y: 0.01, z: -0.05 });
          band.setAttribute('material', 'color: #2b2b2f; shader: flat');
          band.classList.add('liquid-band');
          el.appendChild(band);

          var tip = document.createElement('a-entity');
          tip.setAttribute('position', { x: 0, y: 0.01, z: -0.275 });
          tip.classList.add('spray-tip');
          el.appendChild(tip);
        },
      });

      // ==============================================================
      // COMPONENT: hatch
      // A lid on a hinge that the trigger opens and that shuts itself
      // again if you wander off. Same idea as the Zippo's lid, made
      // general because a second thing wanted one — and the shared
      // idiom that came out of it is worth stating: THE TRIGGER OPENS
      // WHATEVER YOU ARE HOLDING. A Zippo, a bottle cap, this.
      //
      // It publishes `open` and nothing else. What being open MEANS is
      // entirely the owner's business: for a tank it means liquid can
      // get in.
      // ==============================================================
      registerComponent('hatch', {
        schema: {
          openDeg: { type: 'number', default: HATCH_OPEN_DEG },
          speedDeg: { type: 'number', default: HATCH_SPEED_DEG },
          autoCloseMs: { type: 'number', default: HATCH_AUTOCLOSE_MS },
          lidSelector: { type: 'string', default: '.hatch-lid' },
        },

        init: function () {
          this.open = false;
          this.angle = 0; // degrees, 0 = shut
          this.remaining = 0;
          this.lidEl = this.el.querySelector(this.data.lidSelector);
        },

        onTriggerUse: function () {
          this.toggle();
        },

        toggle: function () {
          this.open = !this.open;
          this.remaining = this.open ? this.data.autoCloseMs : 0;
          playTone({ type: 'square', freq: this.open ? 520 : 300, duration: 0.06, volume: 0.06 });
        },

        tick: function (time, dt) {
          if (this.open && this.data.autoCloseMs > 0) {
            this.remaining -= dt || 16;
            if (this.remaining <= 0) this.toggle();
          }

          var wanted = this.open ? this.data.openDeg : 0;
          if (this.angle === wanted) return;

          var step = (this.data.speedDeg * Math.min((dt || 16) / 1000, 0.05)) * (wanted > this.angle ? 1 : -1);
          this.angle = Math.abs(wanted - this.angle) <= Math.abs(step) ? wanted : this.angle + step;
          if (this.lidEl) this.lidEl.object3D.rotation.x = (this.angle * Math.PI) / 180;
        },
      });

      // ==============================================================
      // COMPONENT: liquid-tank
      // Holds one liquid type, and holds an unlimited amount of it —
      // how much you poured in is not tracked, because the funny part
      // is which liquid, never how much.
      //
      // It fills by having liquid land in it, which means the pour that
      // fills it is the same pour that fills your mouth, and the same
      // droplets. It catches light the same way a puddle does: a
      // flammable liquid with an open lid and something hot nearby
      // becomes fire. Neither of those is tank code so much as a tank
      // standing where the liquid system can see it.
      // ==============================================================
      var OPEN_CONTAINERS = []; // refreshed each frame by world-systems, read by the droplet loop

      registerComponent('liquid-tank', {
        schema: {
          liquid: { type: 'string', default: '' }, // starts empty
          mouthSelector: { type: 'string', default: '.tank-mouth' },
        },

        init: function () {
          this.liquid = this.data.liquid || null;
          this.mouthEl = this.el.querySelector(this.data.mouthSelector);
          this.gaugeEl = this.el.querySelector('.tank-gauge');
          this._mouth = new THREE.Vector3();
          this.applyGauge();
        },

        isOpen: function () {
          var hatch = this.el.components.hatch;
          return !!(hatch && hatch.open);
        },

        mouthWorldPosition: function (out) {
          (this.mouthEl ? this.mouthEl.object3D : this.el.object3D).getWorldPosition(out);
          return out;
        },

        fill: function (type) {
          if (!LIQUIDS[type] || this.liquid === type) return;
          this.liquid = type;
          this.applyGauge();
          playGlug();
        },

        // What's in the tank, shown as what's in the tank. Also
        // repeated on the nozzle you're actually holding, because when
        // the pack is on your back you can't see it and the thing you
        // need to know before pulling the trigger is what's about to
        // come out.
        applyGauge: function () {
          var liquid = this.liquid && LIQUIDS[this.liquid];
          var color = liquid ? liquid.dropColor || liquid.poolColor : '#2b2b2f';

          if (this.gaugeEl) {
            this.gaugeEl.setAttribute('visible', !!liquid);
            this.gaugeEl.setAttribute(
              'material',
              'color: ' + color + '; shader: flat; opacity: 0.85; transparent: true'
            );
          }

          var bands = this.el.querySelectorAll('.liquid-band');
          for (var i = 0; i < bands.length; i++) {
            bands[i].setAttribute('material', 'color: ' + color + '; shader: flat');
          }
        },

        // An open tank of something flammable is a puddle in a box, and
        // it catches from the same hot points a puddle does.
        tick: function () {
          if (!this.isOpen() || !this.liquid) return;
          var liquid = LIQUIDS[this.liquid];
          if (!liquid || !liquid.flammable) return;

          this.mouthWorldPosition(this._mouth);
          for (var i = 0; i < HOT_POINTS.length; i++) {
            if (this._mouth.distanceTo(HOT_POINTS[i].pos) > TANK_MOUTH_RADIUS + IGNITE_RADIUS) continue;
            this.fill('fire');
            spawnSparks(this._mouth, 6);
            return;
          }
        },
      });

      // ==============================================================
      // COMPONENT: nozzle
      // Squeeze the trigger and it sprays whatever the tank has. It
      // does not know what that is and never asks — it hands the type
      // straight to spawnDroplet, and every consequence downstream
      // (pooling, burning, dousing, going down somebody's throat)
      // belongs to the liquid, not to the gun.
      //
      // It also draws the hose, because the hose is a line between two
      // objects and neither of them is a better owner than this one.
      // ==============================================================
      registerComponent('nozzle', {
        init: function () {
          this.tankEl = null;
          this._tip = new THREE.Vector3();
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._vel = new THREE.Vector3();
          this._outlet = new THREE.Vector3();
          this._a = new THREE.Vector3();
          this._b = new THREE.Vector3();
          this.accumulator = 0;

          this.tipEl = this.el.querySelector('.spray-tip');
          this.buildHose();
        },

        remove: function () {
          if (this.hoseEl && this.hoseEl.parentNode) this.hoseEl.parentNode.removeChild(this.hoseEl);
        },

        // The hose lives in the scene rather than on either end, since
        // it belongs to neither once they're apart.
        buildHose: function () {
          this.hoseEl = document.createElement('a-entity');
          this.segments = [];
          for (var i = 0; i < HOSE_SEGMENTS; i++) {
            var seg = document.createElement('a-cylinder');
            seg.setAttribute('radius', 0.014);
            seg.setAttribute('height', 1);
            seg.setAttribute('color', '#2f2a26');
            this.hoseEl.appendChild(seg);
            this.segments.push(seg);
          }
          this.el.sceneEl.appendChild(this.hoseEl);
        },

        // Found once, by walking up from the socket this thing calls
        // home — which is mounted on the tank, so the pack a nozzle
        // belongs to is simply the pack its clip is bolted to.
        tank: function () {
          if (this.tankEl) return this.tankEl.components['liquid-tank'];
          var holsterable = this.el.components.holsterable;
          var home = holsterable && holsterable.data.holsterSelector;
          this.tankEl = home && home.closest && home.closest('[liquid-tank]');
          return this.tankEl ? this.tankEl.components['liquid-tank'] : null;
        },

        tick: function (time, dt) {
          var tank = this.tank();
          if (!tank) return;

          if (this.shownLiquid !== tank.liquid) {
            this.shownLiquid = tank.liquid;
            var liquid = tank.liquid && LIQUIDS[tank.liquid];
            var band = this.el.querySelector('.liquid-band');
            if (band) {
              band.setAttribute(
                'material',
                'color: ' + (liquid ? liquid.dropColor || liquid.poolColor : '#2b2b2f') + '; shader: flat'
              );
            }
          }

          this.drawHose(tank);
          this.reelIn(tank);

          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held' || !holsterable.hand) return;
          var handRig = holsterable.hand.components['hand-rig'];
          if (!handRig || !handRig.triggerHeld) {
            this.accumulator = 0;
            return;
          }
          if (!tank.liquid) return;

          this.spray(tank.liquid, Math.min((dt || 16) / 1000, 0.05));
        },

        spray: function (type, dtSeconds) {
          var tip = this.tipEl ? this.tipEl.object3D : this.el.object3D;
          tip.getWorldPosition(this._tip);
          tip.getWorldQuaternion(this._quat);
          this._dir.set(0, 0, -1).applyQuaternion(this._quat).normalize();

          this.accumulator += SPRAY_RATE * dtSeconds;
          var count = Math.floor(this.accumulator);
          this.accumulator -= count;

          for (var i = 0; i < count; i++) {
            this._vel
              .copy(this._dir)
              .multiplyScalar(SPRAY_SPEED)
              .add(
                _sprayJitter.set(
                  (Math.random() - 0.5) * SPRAY_SPREAD,
                  (Math.random() - 0.5) * SPRAY_SPREAD,
                  (Math.random() - 0.5) * SPRAY_SPREAD
                )
              );
            spawnDroplet(this._tip, this._vel, type);
          }
        },

        // A quadratic bezier sagging under the midpoint, drawn as a
        // handful of stretched cylinders. Not simulated: a hose that
        // fought your hand would be a worse toy than one that follows
        // it.
        drawHose: function (tank) {
          var outletEl = tank.el.querySelector('.hose-outlet');
          (outletEl ? outletEl.object3D : tank.el.object3D).getWorldPosition(this._outlet);
          this.el.object3D.getWorldPosition(this._tip);

          var sag = this._outlet.distanceTo(this._tip) / HOSE_LENGTH;
          _hoseControl
            .copy(this._outlet)
            .add(this._tip)
            .multiplyScalar(0.5).y -= HOSE_SAG * Math.max(1 - sag, 0.15);

          for (var i = 0; i < HOSE_SEGMENTS; i++) {
            bezierPoint(this._outlet, _hoseControl, this._tip, i / HOSE_SEGMENTS, this._a);
            bezierPoint(this._outlet, _hoseControl, this._tip, (i + 1) / HOSE_SEGMENTS, this._b);

            var seg = this.segments[i].object3D;
            var length = this._a.distanceTo(this._b);
            seg.position.copy(this._a).add(this._b).multiplyScalar(0.5);
            seg.scale.y = Math.max(length, 0.0001);
            _hoseDir.copy(this._b).sub(this._a).normalize();
            seg.quaternion.setFromUnitVectors(_hoseUp, _hoseDir);
          }
        },

        // You can put the nozzle down, but you can't leave it across
        // the room: past the length of the hose it goes home, which
        // reads as the hose pulling it back.
        reelIn: function (tank) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;
          if (holsterable.state !== 'resting' && holsterable.state !== 'falling') return;
          if (this._outlet.distanceTo(this._tip) < HOSE_LENGTH) return;

          var home = holsterable.data.holsterSelector;
          if (!home) return;
          holsterable.state = 'holstered';
          holsterable.attachTo(home.object3D, holsterable.data.holsterPosition, holsterable.data.holsterRotation);
          holsterable.occupySlot(home);
        },
      });

      var _worldUp = new THREE.Vector3(0, 1, 0);
      var _sprayJitter = new THREE.Vector3();
      var _hoseControl = new THREE.Vector3();
      var _hoseDir = new THREE.Vector3();
      var _hoseUp = new THREE.Vector3(0, 1, 0);

      function bezierPoint(a, control, b, t, out) {
        var u = 1 - t;
        return out
          .set(0, 0, 0)
          .addScaledVector(a, u * u)
          .addScaledVector(control, 2 * u * t)
          .addScaledVector(b, t * t);
      }
