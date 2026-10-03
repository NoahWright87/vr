      // ==============================================================
      // ITEMS: explosives
      // The launcher and what it fires (rocket), and the stick of
      // dynamite that's almost entirely other people's components —
      // lightable/burnable for the fuse, holsterable for the throw,
      // explosive for the bang. detonate() is the one shared function
      // both the rocket and the dynamite end their life by calling.
      // Split out of game.js — see DESIGN.md's "File structure"
      // section.
      // ==============================================================

      // ==============================================================
      // EXPLOSIONS
      // One function, and nothing that calls it knows what the others
      // are. It shoves a fireball's worth of debris and smoke out,
      // spills burning fuel where it went off (so a blast in the
      // saloon leaves the floor alight and the fire system takes it
      // from there), knocks over every target in range through the
      // same fall() a bullet uses, shatters glass in range through the
      // same shatter() a bullet uses, and throws loose objects
      // outward.
      //
      // That last one is the fun one: the blast doesn't special-case
      // anything, it just hands every loose holsterable a velocity —
      // which is the same thing your arm does. Blowing a rack of
      // bottles across the room is throwing them, as far as the code
      // is concerned.
      // ==============================================================
      var BLAST_RADIUS = 2.4;
      var BLAST_SCORE = 60;
      var BLAST_FUEL = 0.5; // how big a burning patch it leaves
      var BLAST_SHOVE = 9; // m/s handed to a loose object at the centre
      var BLAST_SHARDS = 22;

      // A stick of dynamite is a fuse with a bundle attached, so its
      // numbers are burnable's numbers. The fuse is deliberately long
      // enough to be a decision and short enough to be a mistake: at
      // this rate you get about four seconds, which is plenty to throw
      // it and nowhere near enough to change your mind twice.
      var DYNAMITE_STICK_LENGTH = 0.17;
      var DYNAMITE_FUSE_LENGTH = 0.11;
      var DYNAMITE_FUSE_RATE = 0.028; // meters/second — about four seconds of fuse
      var DYNAMITE_FUSE_MIN = 0.004;

      // ==============================================================
      // THE LAUNCHER
      // A tube with a socket in the back. Everything about it is the
      // bow again with a trigger instead of a string, which is why
      // there is so little of it: load, point, press.
      //
      // The rocket flies flat while its motor is lit and then gives up,
      // which is the difference between it and everything else in the
      // air here. It is `armed`, so it goes off on contact with
      // anything rather than needing a fuse — and since it goes off by
      // calling the same detonate() a stick of dynamite does, firing
      // one indoors sets the saloon alight, throws the furniture, and
      // is entirely your own fault.
      // ==============================================================
      var LAUNCHER_LENGTH = 0.95;
      var LAUNCHER_MUZZLE_Z = 0.42; // how far the muzzle sits ahead of the grip
      var LAUNCHER_KICK_DEG = -26; // it is not a comfortable weapon
      var LAUNCHER_RECOVER_MS = 420;
      var LAUNCH_SPEED = 14; // m/s leaving the tube, before the motor does anything
      var ROCKET_THRUST = 34; // m/s² while the motor burns
      var ROCKET_LIFT = 0.85; // fraction of gravity the motor cancels, so it flies flat and then drops
      var ROCKET_BURN_MS = 1400;
      var ROCKET_BLAST_RADIUS = 3.2;
      var ARMORY_ROCKETS = 2;
      // The launcher, and the thing that goes in it. Note how little
      // either declaration says: the tube is a holsterable with a
      // socket and a trigger hook, and the rocket is an armed
      // explosive with a motor. Neither mentions the other.
      defineItem('launcher', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.26,
          grabSpan: { x: 0, y: 0.06, z: -0.4 },
          comOffset: { x: 0, y: 0.03, z: -0.18 },
          supportGrip: { x: 0, y: 0.02, z: -0.24 },
          supportRadius: 0.22,
          maxThrowSpeed: 6,
        });
        el.setAttribute('boxy-launcher', '');
        el.setAttribute('launcher', '');
      });

      defineItem('rocket', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.13,
          comOffset: { x: 0, y: 0, z: -0.02 },
          maxThrowSpeed: 8, // thrown by hand it is a poor club with a warhead on it
        });
        el.setAttribute('boxy-rocket', '');
        el.setAttribute('rocket', '');
        el.setAttribute('explosive', { armed: true, radius: ROCKET_BLAST_RADIUS, fuel: 0.75 });
        el.classList.add('shootable');
      });

      // A stick of dynamite, which is almost entirely other people's
      // components. `lightable` and `burnable` are the fuse — the same
      // pair a match is made of — so every way of lighting anything in
      // this scene already lights it, and the fuse ashes down and can
      // even have its light flicked off. `holsterable` is the throw.
      // `explosive` is the two lines at the end. There is no dynamite
      // code as such, which is the point.
      defineItem('dynamite', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.14,
          grabSpan: { x: 0, y: 0, z: DYNAMITE_STICK_LENGTH * 0.8 },
          comOffset: { x: 0, y: 0, z: -0.08 },
          maxThrowSpeed: 11,
        });
        el.setAttribute('boxy-dynamite', '');
        el.setAttribute('burnable', {
          visual: 'boxy-dynamite',
          length: DYNAMITE_FUSE_LENGTH,
          ashRate: DYNAMITE_FUSE_RATE,
          minLength: DYNAMITE_FUSE_MIN,
          ashColor: '#2e2a24',
        });
        el.setAttribute('lightable', { tipSelector: '.ember' });
        el.setAttribute('ignition-source', { tipSelector: '.ember' });
        el.setAttribute('explosive', '');
        // Shootable, so somebody with better aim than sense can set it
        // off in your hand from across the room.
        el.classList.add('shootable');
      });
      // ==============================================================
      // detonate
      // See the EXPLOSIONS note. Deliberately a plain function rather
      // than a component: a stick of dynamite, a rocket and (later)
      // anything else that goes bang all want the same event to happen
      // at a point in space, and none of them want to own it.
      // ==============================================================
      var _blastScratch = new THREE.Vector3();
      var _blastPush = new THREE.Vector3();

      function detonate(worldPos, options) {
        options = options || {};
        var radius = options.radius || BLAST_RADIUS;

        playBoom();
        spawnDebris(worldPos, { count: BLAST_SHARDS, color: '#4a3f39', size: SHARD_SIZE * 1.4, speed: SHARD_SPEED * 2.2 });
        spawnSparks(worldPos, 14);
        for (var s = 0; s < 6; s++) spawnSmoke(worldPos, randomUnitVector().multiplyScalar(2.2), 1.6);

        // Burning fuel on whatever it went off over. Everything that
        // makes fire interesting — spreading, being doused, lighting
        // cigars — follows from this one line rather than from
        // anything here.
        var pool = spillPuddle(worldPos, 'fire', options.fuel || BLAST_FUEL);
        if (pool) ignitePool(pool);

        var manager = document.querySelector('#range-manager');

        var hinges = sceneElements('[pop-target]');
        for (var i = 0; i < hinges.length; i++) {
          var popTarget = hinges[i].components['pop-target'];
          if (!popTarget || popTarget.fallen) continue;
          hinges[i].object3D.getWorldPosition(_blastScratch);
          if (_blastScratch.distanceTo(worldPos) > radius) continue;
          if (manager) manager.emit('ring-hit', { score: BLAST_SCORE, label: 'BLASTED' }, false);
          popTarget.fall();
        }

        var breakables = sceneElements('[breakable]');
        for (var b = 0; b < breakables.length; b++) {
          var breakable = breakables[b].components.breakable;
          if (!breakable || breakable.broken || !breakable.data.autoShatter) continue;
          breakables[b].object3D.getWorldPosition(_blastScratch);
          if (_blastScratch.distanceTo(worldPos) > radius) continue;
          breakable.shatter(true);
        }

        // And everything loose gets thrown. Note it goes through the
        // ordinary throw path, so a blasted bottle is catchable in
        // mid-air and can be shot out of it like any other.
        var loose = sceneElements('.grabbable');
        for (var g = 0; g < loose.length; g++) {
          var holsterable = loose[g].components.holsterable;
          if (!holsterable) continue;
          if (holsterable.state !== 'resting' && holsterable.state !== 'falling') continue;

          loose[g].object3D.getWorldPosition(_blastScratch);
          var distance = _blastScratch.distanceTo(worldPos);
          if (distance > radius) continue;

          _blastPush.copy(_blastScratch).sub(worldPos);
          if (_blastPush.lengthSq() < 0.0001) _blastPush.set(0, 1, 0);
          _blastPush.normalize().multiplyScalar(BLAST_SHOVE * (1 - distance / radius));
          _blastPush.y = Math.abs(_blastPush.y) + BLAST_SHOVE * 0.35;
          holsterable.throwWithVelocity(_blastPush.clone());
        }
      }

      // ==============================================================
      // COMPONENT: explosive
      // The thing that goes bang, and it doesn't know what set it off.
      // It listens for the three ways anything in this scene ends —
      // a fuse running out (`burnt-out`, straight out of burnable),
      // being hit hard (`impact`), and being shot (`shot`) — so a
      // stick of dynamite can be lit and thrown, shot out of the air
      // by someone with better aim than sense, or simply dropped from
      // a height.
      //
      // Everything else about a stick of dynamite is components that
      // already existed: `lightable` and `burnable` give it a fuse
      // that any cigar, match, Zippo or hot barrel will light, and
      // `holsterable` gives it the aimed overhand throw. This
      // component is the last two lines of its life.
      // ==============================================================
      registerComponent('explosive', {
        schema: {
          radius: { type: 'number', default: BLAST_RADIUS },
          fuel: { type: 'number', default: BLAST_FUEL },
          armed: { type: 'boolean', default: false }, // true = a hard knock alone is enough, no fuse required
        },

        init: function () {
          this.spent = false;
          this._world = new THREE.Vector3();

          this.onBurntOut = this.blow.bind(this);
          this.onImpact = this.onImpact.bind(this);
          this.onShot = this.onShot.bind(this);

          this.el.addEventListener('burnt-out', this.onBurntOut);
          this.el.addEventListener('impact', this.onImpact);
          this.el.addEventListener('landed', this.onImpact);
          this.el.addEventListener('shot', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('burnt-out', this.onBurntOut);
          this.el.removeEventListener('impact', this.onImpact);
          this.el.removeEventListener('landed', this.onImpact);
          this.el.removeEventListener('shot', this.onShot);
        },

        // A knock only sets it off if it's already lit or armed —
        // otherwise a stick of dynamite would be unable to survive
        // being dropped, which makes carrying a bundle of it much less
        // funny than it should be.
        onImpact: function (evt) {
          var lightable = this.el.components.lightable;
          if (!this.data.armed && !(lightable && lightable.lit)) return;
          if (evt.detail && evt.detail.speed < IMPACT_MIN_SPEED) return;
          this.blow();
        },

        onShot: function () {
          this.blow();
        },

        blow: function () {
          if (this.spent) return;
          this.spent = true;

          this.el.object3D.getWorldPosition(this._world);
          detonate(this._world, { radius: this.data.radius, fuel: this.data.fuel });
          despawnItem(this.el);
        },
      });
      // ==============================================================
      // COMPONENT: boxy-launcher / launcher
      // A tube you put something in and a trigger that sends it. It is
      // the bow's idea again with a different silhouette: a socket at
      // the loading end, and a release that hands whatever is in there
      // a velocity. That the socket doesn't ask what it's holding is
      // now a habit rather than a surprise — a rocket goes down the
      // tube, and so does a beer, and so does a lit stick of dynamite,
      // and the launcher can tell the difference between none of them.
      //
      // Firing empty is a click and a puff, because a man should be
      // allowed to find that out the hard way.
      // ==============================================================
      registerComponent('boxy-launcher', {
        init: function () {
          var el = this.el;
          var metal = '#3f4429';
          var wood = '#4a2f1c';

          function box(w, h, d, pos, color, rot) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            if (rot) b.setAttribute('rotation', rot);
            el.appendChild(b);
            return b;
          }

          var tube = document.createElement('a-cylinder');
          tube.setAttribute('radius', 0.055);
          tube.setAttribute('height', LAUNCHER_LENGTH);
          tube.setAttribute('color', metal);
          tube.setAttribute('rotation', '90 0 0');
          tube.setAttribute('position', { x: 0, y: 0.06, z: LAUNCHER_LENGTH / 2 - LAUNCHER_MUZZLE_Z });
          el.appendChild(tube);

          box(0.05, 0.14, 0.055, '0 -0.05 0.02', wood, '10 0 0'); // grip
          box(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard
          box(0.008, 0.03, 0.008, '0 -0.01 -0.035', '#c9962c'); // trigger
          box(0.09, 0.03, 0.1, '0 0.12 -0.16', metal); // crude sight block
          box(0.05, 0.05, 0.12, '0 0.05 0.3', wood); // shoulder pad

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.08);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', { x: 0, y: 0.06, z: -LAUNCHER_MUZZLE_Z });
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', { x: 0, y: 0.06, z: -LAUNCHER_MUZZLE_Z });
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);

          // The breech: an ordinary socket at the back of the tube.
          this.breechEl = document.createElement('a-entity');
          this.breechEl.classList.add('anchor-slot');
          // A big obvious indicator, because a socket you can't find is
          // a weapon that doesn't work — the first version had a
          // discreet one down the tube and the honest playtest note was
          // "I couldn't tell if anything loaded".
          this.breechEl.setAttribute('anchor-slot', { size: 'small', indicatorScale: 2.1 });
          this.breechEl.setAttribute('position', { x: 0, y: 0.06, z: LAUNCHER_LENGTH - LAUNCHER_MUZZLE_Z - 0.16 });
          el.appendChild(this.breechEl);
        },
      });

      registerComponent('launcher', {
        init: function () {
          this._muzzle = new THREE.Vector3();
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
        },

        breech: function () {
          var visual = this.el.components['boxy-launcher'];
          return visual && visual.breechEl;
        },

        // hand-rig's generic press dispatch, same hook a gun's trigger
        // uses — which is why holding the launcher and a pistol in one
        // fist fires both.
        onTriggerUse: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held') return;

          var breech = this.breech();
          var slot = breech && breech.components['anchor-slot'];

          var muzzleEl = this.el.querySelector('.muzzle');
          if (muzzleEl) {
            muzzleEl.object3D.updateWorldMatrix(true, false);
            muzzleEl.object3D.getWorldPosition(this._muzzle);
            muzzleEl.object3D.getWorldQuaternion(this._quat);
            this._dir.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          }

          if (!slot || !slot.occupants.length) {
            // Unmistakably nothing happening, rather than quietly
            // nothing happening.
            playTone({ type: 'square', freq: 150, duration: 0.09, volume: 0.16 });
            playNoise({ duration: 0.05, freq: 1800, q: 2, volume: 0.08 });
            return;
          }

          var payload = slot.occupants[0];
          payload.el.object3D.updateWorldMatrix(true, false);
          payload.vacateSlot();

          var velocity = this._dir.clone().multiplyScalar(LAUNCH_SPEED);
          velocity.isHurl = true; // don't let the tube catch its own rocket back
          payload.throwWithVelocity(velocity);
          payload.angularVelocity.set(0, 0, 0);
          payload.el.object3D.quaternion.setFromUnitVectors(_launchForward, this._dir);

          this.report();
        },

        // Muzzle flash, backblast and a shove. The kick goes through
        // holsterable.extraPitchDeg, the same channel a pistol's recoil
        // uses, so it composes with drunken sway instead of fighting it.
        report: function () {
          playBoom();
          flashMuzzle(this.el);

          var holsterable = this.el.components.holsterable;
          if (holsterable) holsterable.extraPitchDeg = LAUNCHER_KICK_DEG;
          this.recoil = LAUNCHER_RECOVER_MS;

          // Backblast, out the far end and straight at whatever is
          // standing behind you.
          this.el.object3D.getWorldPosition(this._muzzle);
          for (var i = 0; i < 5; i++) {
            spawnSmoke(this._muzzle, this._dir.clone().multiplyScalar(-3.4), 1.4);
          }
          spawnSparks(this._muzzle, 8);
        },

        tick: function (time, dt) {
          if (!this.recoil) return;
          this.recoil = Math.max(this.recoil - (dt || 16), 0);
          var holsterable = this.el.components.holsterable;
          if (holsterable) holsterable.extraPitchDeg = LAUNCHER_KICK_DEG * (this.recoil / LAUNCHER_RECOVER_MS);
        },
      });

      var _launchForward = new THREE.Vector3(0, 0, -1);

      // ==============================================================
      // COMPONENT: rocket
      // The thing that goes in the tube, and it is barely a thing. It's
      // an `explosive` that's armed — so anything it touches sets it
      // off, no fuse required — plus a motor: while it's in the air it
      // pushes itself along, fights most of gravity, and leaves a
      // trail. Everything about how it flies, what it hits and what it
      // does to what it hit is machinery that was already here for
      // thrown bottles and dynamite.
      // ==============================================================
      registerComponent('rocket', {
        init: function () {
          this._world = new THREE.Vector3();
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this.burn = ROCKET_BURN_MS;
        },

        tick: function (time, dt) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'falling') return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var speed = holsterable.fallVelocity.length();
          if (speed < 0.5) return;

          this._dir.copy(holsterable.fallVelocity).divideScalar(speed);

          if (this.burn > 0) {
            this.burn -= dt || 16;
            holsterable.fallVelocity.addScaledVector(this._dir, ROCKET_THRUST * dtSeconds);
            // The motor holds it up while it's lit, so a rocket flies
            // flat and then drops, rather than arcing like a thrown
            // bottle from the moment it leaves.
            holsterable.fallVelocity.y += GRAVITY * ROCKET_LIFT * dtSeconds;
          }

          holsterable.angularVelocity.set(0, 0, 0);
          this._quat.setFromUnitVectors(_launchForward, this._dir);
          this.el.object3D.quaternion.copy(this._quat);

          this.trail = (this.trail || 0) - (dt || 16);
          if (this.trail > 0) return;
          this.trail = 26;
          this.el.object3D.getWorldPosition(this._world);
          spawnSmoke(this._world, this._dir.clone().multiplyScalar(-1.5), 0.8);
          spawnSparks(this._world, 1);
        },
      });

      registerComponent('boxy-rocket', {
        init: function () {
          var el = this.el;

          var body = document.createElement('a-cylinder');
          body.setAttribute('radius', 0.042);
          body.setAttribute('height', 0.2);
          body.setAttribute('color', '#5b6b3a');
          body.setAttribute('rotation', '90 0 0');
          body.setAttribute('position', { x: 0, y: 0, z: 0.02 });
          el.appendChild(body);

          var nose = document.createElement('a-cone');
          nose.setAttribute('radius-bottom', 0.042);
          nose.setAttribute('radius-top', 0);
          nose.setAttribute('height', 0.1);
          nose.setAttribute('color', '#a8342a');
          nose.setAttribute('rotation', '-90 0 0');
          nose.setAttribute('position', { x: 0, y: 0, z: -0.13 });
          el.appendChild(nose);

          for (var i = 0; i < 4; i++) {
            var fin = document.createElement('a-box');
            fin.setAttribute('width', 0.004);
            fin.setAttribute('height', 0.055);
            fin.setAttribute('depth', 0.06);
            fin.setAttribute('position', { x: 0, y: 0.05, z: 0.1 });
            fin.setAttribute('color', '#3f4429');
            var pivot = document.createElement('a-entity');
            pivot.setAttribute('rotation', { x: 0, y: 0, z: i * 90 });
            pivot.appendChild(fin);
            el.appendChild(pivot);
          }
        },
      });

      // ==============================================================
      // COMPONENT: boxy-dynamite
      // Three red sticks in a bundle with a fuse out the end, and the
      // fuse is a `buildBurnStick` — the same object a match and a
      // cigar are made of, because "a thing that burns down from the
      // tip" was already a shape this file knew how to draw. Which
      // means the fuse ashes as it goes, can have its light knocked
      // off it by a hard enough flick, and lights off anything hot,
      // none of which is dynamite code.
      //
      // Same axis convention as the cigar: the entity origin is where
      // your fist closes, and the fuse burns back toward you along -Z.
      // ==============================================================
      registerComponent('boxy-dynamite', {
        init: function () {
          var el = this.el;

          for (var i = 0; i < 3; i++) {
            var stick = document.createElement('a-cylinder');
            stick.setAttribute('radius', 0.019);
            stick.setAttribute('height', DYNAMITE_STICK_LENGTH);
            stick.setAttribute('color', i === 1 ? '#a8342a' : '#8f2b22');
            stick.setAttribute('rotation', '90 0 0');
            stick.setAttribute('position', {
              x: (i - 1) * 0.034,
              y: i === 1 ? 0.016 : 0,
              z: DYNAMITE_STICK_LENGTH / 2 - 0.02,
            });
            el.appendChild(stick);
          }

          var band = document.createElement('a-cylinder');
          band.setAttribute('radius', 0.056);
          band.setAttribute('height', 0.02);
          band.setAttribute('color', '#4a3f2c');
          band.setAttribute('rotation', '90 0 0');
          band.setAttribute('position', { x: 0, y: 0.006, z: DYNAMITE_STICK_LENGTH / 2 - 0.02 });
          el.appendChild(band);

          this.parts = buildBurnStick(el, {
            length: DYNAMITE_FUSE_LENGTH,
            radius: 0.005,
            bodyColor: '#6b5a3a',
            ashColor: '#2e2a24',
            headColor: '#6b5a3a',
            litColor: '#ffd257',
          });

          this.layout(DYNAMITE_FUSE_LENGTH, 0);
        },

        layout: function (length, ashLength) {
          layoutBurnStick(this.parts, length, ashLength);
        },

        setEmber: function (lit) {
          this.parts.ember.setAttribute(
            'material',
            'color: ' + (lit ? this.parts.litColor : this.parts.headColor) + '; shader: flat'
          );
          // A lit fuse throws sparks, which is most of what sells it.
          this.sparking = lit;
        },

        tick: function (time, dt) {
          if (!this.sparking) return;
          this.sparkTimer = (this.sparkTimer || 0) - (dt || 16);
          if (this.sparkTimer > 0) return;
          this.sparkTimer = 70;
          spawnSparks(this.parts.ember.object3D.getWorldPosition(_dynamiteTip), 2);
        },
      });

      var _dynamiteTip = new THREE.Vector3();
