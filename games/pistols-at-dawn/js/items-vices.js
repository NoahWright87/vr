      // ==============================================================
      // ITEMS: vices
      // Cigars, matches, the Zippo, and the two meters/overlay that
      // track what they've done to you. Split out of game.js — see
      // DESIGN.md's "File structure" section. DRIFT_*/SLIP_*/
      // NICOTINE_SHAKE_DEG/ALCOHOL_SWAY_DEG/WOBBLE_EASE_MS stay in
      // game.js: they're read by hand-rig/holsterable's own wobble
      // and slip handling (core-hand-rig.js, core-equip.js), not by
      // anything here.
      //
      // Note: game.js still has a line-255 CIGAR_PUFF_INTERVAL_MS =
      // 1100 that a later game.js declaration (750) immediately
      // shadows — a pre-existing duplicate from before this split,
      // left exactly where it was so this move changes nothing about
      // which value wins.
      // ==============================================================

      var ALCOHOL_DECAY_PER_S = 0.011; // sober up slowly
      var NICOTINE_DECAY_PER_S = 0.02; // and clear your head a bit faster than that
      var NICOTINE_PER_CIGAR_PASSIVE = 0.02; // per second, per lit cigar just sitting in your mouth
      var NICOTINE_PER_INHALE = 0.1; // per second while actively drawing on one — ~10s of solid puffing to max out
      // ==============================================================
      // CIGARS
      // A lit cigar burns down. Ash creeps up the tip as a grey
      // segment, faster while you're actively drawing on it; a sharp
      // enough shake knocks the ash off and leaves the cigar that much
      // shorter. Smoke it to the band and it's gone, and a fresh one
      // turns up in the tray a few seconds later.
      //
      // Holding the tip at your mouth is "inhaling": nicotine climbs
      // much faster, ash builds faster, and no smoke comes off it —
      // you're drawing it in. Pull it away and you exhale everything
      // you banked.
      // ==============================================================
      // CIGAR_ASH_RATE/MIN_LENGTH/SHAKE_SPEED/TWIRL_ASH_RATE live in
      // game.js alongside CIGAR_LENGTH, for the same reason: burnable's
      // schema (core-substances.js) defaults to all of them, evaluated
      // eagerly at registerComponent() time.
      var CIGAR_ASH_INHALE_MULTIPLIER = 6; // how much faster it ashes while you're drawing on it
      var CIGAR_INHALE_RADIUS = 0.16; // meters from the cigar's tip to your mouth
      var CIGAR_SHAKE_REVERSAL = -0.15; // dot product of successive velocities — negative means the direction snapped back, i.e. a shake and not a sweep
      var CIGAR_EXHALE_MAX_PUFFS = 9; // cap on how much banked smoke one exhale can produce
      var CIGAR_RESPAWN_MS = 6000;
      // ==============================================================
      // FIRE-STARTERS
      // Two ways to light something that aren't "borrow a lit cigar"
      // or "point a gun at your own face."
      //
      // A match is a burnable whose head has its own collider, struck
      // the same way a bottle cap is knocked off — the machinery is
      // already there, so a match is barely any new code. It burns
      // fast and doesn't last.
      //
      // A Zippo is the reusable one: flip the lid (trigger, or a flick
      // of the wrist), press a face button to strike it, and the flame
      // is an ignition-source for as long as the lid stays open.
      // ==============================================================
      var MATCH_HEAD_RADIUS = 0.016; // the collider you have to strike against something
      var MATCH_ASH_RATE = 0.011; // meters/sec — a match is gone in a few seconds
      var MATCH_MIN_LENGTH = 0.018;
      var MATCH_COUNT = 4;
      var MATCH_RESPAWN_MS = 5000;

      var ZIPPO_LID_OPEN_DEG = -125; // how far the lid swings back
      var ZIPPO_LID_SPEED_DEG = 900; // degrees/second — a Zippo lid snaps, it doesn't ease
      var ZIPPO_FLICK_SPEED = 1.6; // m/s at the lid for a wrist-flick to open it
      var ZIPPO_FLICK_REVERSAL = -0.1;
      var ZIPPO_FLAME_FLICKER_HZ = 9;
      // ==============================================================
      // COMPONENT: boxy-cigar / boxy-match
      // Both are a stick that burns from the far end, so both are the
      // same shape of thing: long axis along local -Z (the same
      // convention as a gun barrel), origin at the end you hold, and a
      // layout(length, ashLength) the burnable component drives as
      // they're consumed. Putting the origin at the held end is what
      // makes "cigar in the mouth slot" and "pistol in the mouth slot"
      // the same operation.
      //
      // These are the only visual builders that don't just build and
      // forget, because these are the only objects that change shape.
      // The split still holds: burnable decides how long and how ashy,
      // these decide what that looks like.
      // ==============================================================
      // CIGAR_LENGTH/MATCH_LENGTH themselves live in game.js: burnable's
      // own schema (core-substances.js) defaults its `length` field to
      // CIGAR_LENGTH, and schema objects are evaluated the moment
      // registerComponent() runs — eagerly, not deferred to init()/tick()
      // like everything else that reaches across files here — so that
      // reference needs CIGAR_LENGTH to already exist, and only game.js
      // is guaranteed to have loaded that early.

      // Shared by both, since "a coloured stick with a burnt tip and a
      // glowing end" is the whole of it.
      function buildBurnStick(el, options) {
        var parts = {};

        function stick(radius, color) {
          var c = document.createElement('a-cylinder');
          c.setAttribute('radius', radius);
          c.setAttribute('height', options.length);
          c.setAttribute('color', color);
          c.setAttribute('rotation', '90 0 0'); // stand the cylinder's axis up along Z
          el.appendChild(c);
          return c;
        }

        parts.body = stick(options.radius, options.bodyColor);
        parts.ash = stick(options.radius * 1.02, options.ashColor);

        parts.ember = document.createElement('a-sphere');
        parts.ember.setAttribute('radius', options.radius * 1.05);
        parts.ember.setAttribute('material', 'color: ' + options.headColor + '; shader: flat');
        parts.ember.classList.add('ember');
        el.appendChild(parts.ember);

        parts.hitbox = createHitbox(0.045, options.length + 0.04, { x: 0, y: 0, z: 0 }, '90 0 0');
        el.appendChild(parts.hitbox);

        parts.fullLength = options.length;
        parts.headColor = options.headColor;
        parts.litColor = options.litColor;
        return parts;
      }

      // `length` is how much is left, `ashLength` how much of that tip
      // has burnt. The ash sits at the far end, the ember rides the
      // very tip, and the unburnt body fills the rest.
      function layoutBurnStick(parts, length, ashLength) {
        ashLength = Math.min(ashLength, length);
        var solid = length - ashLength;

        parts.body.object3D.scale.y = Math.max(solid / parts.fullLength, 0.0001);
        parts.body.object3D.position.set(0, 0, -solid / 2);
        parts.body.object3D.visible = solid > 0.001;

        parts.ash.object3D.scale.y = Math.max(ashLength / parts.fullLength, 0.0001);
        parts.ash.object3D.position.set(0, 0, -(solid + ashLength / 2));
        parts.ash.object3D.visible = ashLength > 0.001;

        parts.ember.object3D.position.set(0, 0, -length);
        parts.hitbox.object3D.scale.y = (length + 0.04) / (parts.fullLength + 0.04);
        parts.hitbox.object3D.position.set(0, 0, -length / 2);
      }

      registerComponent('boxy-cigar', {
        init: function () {
          this.parts = buildBurnStick(this.el, {
            length: CIGAR_LENGTH,
            radius: 0.011,
            bodyColor: '#5a3a1e',
            ashColor: '#9c968c',
            headColor: '#2a1a10',
            litColor: '#ff7a1a',
          });

          var band = document.createElement('a-cylinder');
          band.setAttribute('radius', 0.0118);
          band.setAttribute('height', 0.018);
          band.setAttribute('color', '#b8892f');
          band.setAttribute('rotation', '90 0 0');
          band.setAttribute('position', { x: 0, y: 0, z: -0.03 });
          this.el.appendChild(band);

          this.layout(CIGAR_LENGTH, 0);
        },

        layout: function (length, ashLength) {
          layoutBurnStick(this.parts, length, ashLength);
        },

        setEmber: function (lit) {
          this.parts.ember.setAttribute(
            'material',
            'color: ' + (lit ? this.parts.litColor : this.parts.headColor) + '; shader: flat'
          );
        },
      });

      // A match: shorter, thinner, and with a red head that's visible
      // before it's lit — which matters, because the head is the bit
      // you have to strike against something.
      registerComponent('boxy-match', {
        init: function () {
          this.parts = buildBurnStick(this.el, {
            length: MATCH_LENGTH,
            radius: 0.004,
            bodyColor: '#d8c9a4',
            ashColor: '#3a3229',
            headColor: '#b8321f',
            litColor: '#ffb02a',
          });

          // The head's own collider, the same trick a bottle cap uses:
          // striking THIS against something is what lights it, rather
          // than waving the match near a surface.
          var head = document.createElement('a-sphere');
          head.setAttribute('radius', MATCH_HEAD_RADIUS);
          head.setAttribute('material', 'opacity: 0; transparent: true; depthWrite: false');
          head.classList.add('match-head');
          head.setAttribute('position', { x: 0, y: 0, z: -MATCH_LENGTH });
          this.el.appendChild(head);

          this.layout(MATCH_LENGTH, 0);
        },

        layout: function (length, ashLength) {
          layoutBurnStick(this.parts, length, ashLength);
        },

        setEmber: function (lit) {
          this.parts.ember.setAttribute(
            'material',
            'color: ' + (lit ? this.parts.litColor : this.parts.headColor) + '; shader: flat'
          );
        },
      });

      // ==============================================================
      // COMPONENT: cigar
      // Everything about a cigar that isn't just "it burns," which is
      // burnable's job now. What's left is your mouth:
      //
      //   - one lit in your mouth trickles nicotine in;
      //   - holding the tip AT your mouth is a proper draw, which
      //     climbs several times faster, cranks burnable's rate, and
      //     stops any smoke coming off it, because you're taking it
      //     in. Pull it away and you exhale the whole banked cloud.
      //
      // Shooting a cigar is handled here rather than by breakable — an
      // unlit one catches light (that is the intended way to do it,
      // and yes, it means pointing a loaded pistol at your own face),
      // and a lit one gets knocked clean out of your teeth.
      // ==============================================================
      registerComponent('cigar', {
        init: function () {
          this.puffTimer = 0;
          this.bankedSmoke = 0; // puffs suppressed while inhaling, released on the exhale
          this.inhaling = false;

          this.mouthEl = document.querySelector('#mouth-anchor');
          this._tip = new THREE.Vector3();
          this._mouthPos = new THREE.Vector3();
          this._forward = new THREE.Vector3();
          this._quat = new THREE.Quaternion();

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        burnable: function () {
          return this.el.components.burnable;
        },

        isLit: function () {
          var burnable = this.burnable();
          return !!(burnable && burnable.isLit());
        },

        // A lit cigar shot out of your mouth: it goes out, leaves your
        // teeth, and tumbles away — which, since it's an ordinary
        // holsterable, means it's catchable on the way down.
        onShot: function () {
          var lightable = this.el.components.lightable;
          if (!lightable) return;

          if (!lightable.lit) {
            lightable.ignite();
            return;
          }

          lightable.extinguish();
          this.releaseBankedSmoke();
          this.inhaling = false;

          var holsterable = this.el.components.holsterable;
          if (holsterable && holsterable.state !== 'falling') {
            if (holsterable.hand) {
              var handRig = holsterable.hand.components['hand-rig'];
              if (handRig) handRig.forget(this.el);
            }
            holsterable.vacateSlot();
            holsterable.startFalling();
            holsterable.fallVelocity.set((Math.random() - 0.5) * 1.5, 1.2, (Math.random() - 0.5) * 1.5);
            holsterable.angularVelocity.set(Math.random() * 8, Math.random() * 8, 0);
          }

          var burnable = this.burnable();
          if (burnable) {
            burnable.tipWorldPosition(this._tip);
            spawnSparks(this._tip, 10);
          }
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var burnable = this.burnable();
          if (!burnable) return;

          if (!burnable.isLit()) {
            this.releaseBankedSmoke();
            this.inhaling = false;
            burnable.burnMultiplier = 1;
            return;
          }

          this.updateDraw(burnable, dtSeconds);
          this.updateSmoke(burnable, dtSeconds);
        },

        // Is the tip at your mouth? That's a draw: nicotine much
        // faster, ash much faster, and the smoke goes into you instead
        // of into the room.
        updateDraw: function (burnable, dtSeconds) {
          var holsterable = this.el.components.holsterable;
          var inMouth = holsterable && holsterable.currentSlotEl === this.mouthEl;
          var wasInhaling = this.inhaling;
          this.inhaling = false;

          if (holsterable && holsterable.state === 'held' && this.mouthEl) {
            this.mouthEl.object3D.getWorldPosition(this._mouthPos);
            burnable.tipWorldPosition(this._tip);
            this.inhaling = this._tip.distanceTo(this._mouthPos) < CIGAR_INHALE_RADIUS;
          }

          burnable.burnMultiplier = this.inhaling ? CIGAR_ASH_INHALE_MULTIPLIER : 1;

          if (this.inhaling) addNicotine(NICOTINE_PER_INHALE * dtSeconds);
          else if (inMouth) addNicotine(NICOTINE_PER_CIGAR_PASSIVE * dtSeconds);

          if (wasInhaling && !this.inhaling) this.releaseBankedSmoke();
        },

        updateSmoke: function (burnable, dtSeconds) {
          this.puffTimer -= dtSeconds * 1000;
          if (this.puffTimer > 0) return;
          this.puffTimer = CIGAR_PUFF_INTERVAL_MS * (0.7 + Math.random() * 0.6);

          // Drawing on it means the smoke goes in, not out — banked
          // for the exhale when you take it away from your mouth.
          if (this.inhaling) {
            this.bankedSmoke = Math.min(this.bankedSmoke + 2, CIGAR_EXHALE_MAX_PUFFS);
            return;
          }

          burnable.tipWorldPosition(this._tip);
          spawnSmoke(this._tip, null, 0.5);
        },

        // Everything you drew in, back out at once, from your mouth
        // rather than from the cigar.
        releaseBankedSmoke: function () {
          if (!this.bankedSmoke || !this.mouthEl) {
            this.bankedSmoke = 0;
            return;
          }

          this.mouthEl.object3D.getWorldPosition(this._mouthPos);
          this.mouthEl.object3D.getWorldQuaternion(this._quat);
          this._forward.set(0, 0, -1).applyQuaternion(this._quat);

          for (var i = 0; i < this.bankedSmoke; i++) {
            spawnSmoke(this._mouthPos, this._forward.clone().multiplyScalar(0.9 + Math.random() * 0.5), 0.85);
          }
          this.bankedSmoke = 0;
        },
      });

      // ==============================================================
      // COMPONENT: match
      // A match is a burnable you light by striking, using exactly the
      // machinery a bottle cap uses to come off: its head carries a
      // small collider, and driving THAT down through a hard surface
      // is what does it (see findHardSurfaceStrike). Everything after
      // the strike — burning down, ash, going out, coming back in the
      // box — is burnable's, and being a fire source at all is
      // ignition-source's. There is nothing else to a match.
      // ==============================================================
      registerComponent('match', {
        init: function () {
          this.headEl = this.el.querySelector('.match-head');
          this._head = new THREE.Vector3();
          this._prevHead = new THREE.Vector3();
          this._lastHead = new THREE.Vector3(); // where the head was last frame, kept while _prevHead advances
          this._hasPrev = false;

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        onShot: function () {
          var lightable = this.el.components.lightable;
          if (lightable) lightable.ignite();
        },

        tick: function (time, dt) {
          if (!this.headEl) return;

          var lightable = this.el.components.lightable;
          var holsterable = this.el.components.holsterable;
          if (!lightable || !holsterable) return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          if (dtSeconds <= 0) return;

          this.headEl.object3D.getWorldPosition(this._head);
          var hadPrev = this._hasPrev;
          var speed = hadPrev ? (this._prevHead.y - this._head.y) / dtSeconds : 0;
          this._lastHead.copy(this._prevHead);
          this._prevHead.copy(this._head);
          this._hasPrev = true;

          if (lightable.lit) return;
          if (!hadPrev || holsterable.state !== 'held') return;
          // A snap blend is the game moving the match, not you
          // striking it, and it's fast enough to read as a strike.
          if (holsterable._heldElapsed < BOTTLE_STRIKE_GRACE_MS) return;

          if (findHardSurfaceStrike(this._lastHead, this._head, speed, MATCH_HEAD_RADIUS)) {
            lightable.ignite();
            spawnSparks(this._head, 10);
            playClink();
          }
        },
      });

      // ==============================================================
      // COMPONENT: boxy-zippo
      // A lighter, built the same "pile of primitives" way as
      // everything else. The lid is a separate entity hinged along the
      // top back edge so it can swing open, the wick sits just inside
      // the chimney, and the flame is a cone that only exists while
      // it's lit. Origin at the middle of the body, where your fingers
      // would close around it.
      // ==============================================================
      registerComponent('boxy-zippo', {
        init: function () {
          var el = this.el;
          var brass = '#b9962e';
          var steel = '#8d8f94';

          function box(w, h, d, pos, color, parent) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            (parent || el).appendChild(b);
            return b;
          }

          box(0.032, 0.042, 0.016, '0 -0.008 0', brass); // body
          box(0.026, 0.006, 0.013, '0 0.015 0', steel); // chimney deck

          // The lid, hinged at the top BACK edge: the hinge entity
          // sits on that edge and the lid panel hangs forward from it,
          // so rotating the hinge on X swings the lid up and back the
          // way a real one does.
          this.hinge = document.createElement('a-entity');
          this.hinge.setAttribute('position', { x: 0, y: 0.018, z: 0.008 });
          el.appendChild(this.hinge);

          box(0.032, 0.026, 0.016, '0 0.013 -0.008', brass, this.hinge);

          var wick = document.createElement('a-cylinder');
          wick.setAttribute('radius', 0.0018);
          wick.setAttribute('height', 0.008);
          wick.setAttribute('color', '#2a2420');
          wick.setAttribute('position', { x: 0, y: 0.021, z: 0 });
          el.appendChild(wick);

          this.flameEl = document.createElement('a-entity');
          this.flameEl.setAttribute('geometry', {
            primitive: 'cone',
            radiusBottom: 0.007,
            radiusTop: 0.0004,
            height: 0.03,
          });
          this.flameEl.setAttribute('material', 'color: #ffb02a; shader: flat; transparent: true; opacity: 0.9');
          this.flameEl.setAttribute('position', { x: 0, y: 0.038, z: 0 });
          this.flameEl.setAttribute('visible', false);
          this.flameEl.classList.add('flame');
          el.appendChild(this.flameEl);

          el.appendChild(createHitbox(0.04, 0.08, { x: 0, y: 0, z: 0 }));
        },

        setLid: function (openFraction) {
          this.hinge.object3D.rotation.x = (ZIPPO_LID_OPEN_DEG * openFraction * Math.PI) / 180;
        },

        setFlame: function (lit, scale) {
          this.flameEl.setAttribute('visible', lit);
          if (lit) this.flameEl.object3D.scale.set(1, scale, 1);
        },
      });

      // ==============================================================
      // COMPONENT: zippo
      // The behavior: a lid that opens and closes, and a flame that
      // can only exist while it's open.
      //
      // Two ways to work the lid, because both are things people will
      // try: pull the trigger (through hand-rig's generic press
      // dispatch — see useHeldObject), or flick your wrist, which
      // reuses the same flick detector that knocks ash off a cigar. A
      // face button strikes it. Closing the lid snuffs it, which is
      // the one rule a Zippo really has.
      //
      // While lit and open it's an ordinary ignition-source, so it
      // lights cigars and matches through exactly the same proximity
      // check a hot barrel does, and needed no code of its own to do
      // that.
      // ==============================================================
      registerComponent('zippo', {
        init: function () {
          this.open = false;
          this.lidFraction = 0; // 0 shut, 1 fully back
          this.flickerPhase = Math.random() * 10;

          this._lidTip = new THREE.Vector3();
          this.flick = createFlickDetector(ZIPPO_FLICK_SPEED, ZIPPO_FLICK_REVERSAL);

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        visual: function () {
          return this.el.components['boxy-zippo'];
        },

        isLit: function () {
          var lightable = this.el.components.lightable;
          return !!(lightable && lightable.lit);
        },

        // Trigger: work the lid.
        onTriggerUse: function () {
          this.toggleLid();
        },

        // Face button: strike it. Only catches with the lid open,
        // which is the entire ritual.
        onFaceButtonUse: function () {
          if (!this.open) return;
          var lightable = this.el.components.lightable;
          if (lightable && !lightable.lit) {
            lightable.ignite();
            playClink();
          }
        },

        // Shooting a lighter is not something anyone should do, so it
        // simply snaps the lid shut and puts it out.
        onShot: function () {
          if (this.open) this.toggleLid();
        },

        toggleLid: function () {
          this.open = !this.open;
          playClink();

          // Updated here as well as in tick so the invariant holds
          // immediately: open the lid and strike it in the same frame
          // and it lights, rather than silently refusing because the
          // veto hadn't been cleared yet.
          var lightable = this.el.components.lightable;
          if (lightable) lightable.blocked = !this.open;

          if (!this.open) this.snuff();
        },

        snuff: function () {
          var lightable = this.el.components.lightable;
          if (lightable) lightable.extinguish();
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var visual = this.visual();
          if (!visual) return;

          // Lid animation, driven straight rather than through
          // A-Frame's animation component, for the same reason
          // everything else here writes object3D directly.
          var target = this.open ? 1 : 0;
          var step = (ZIPPO_LID_SPEED_DEG / Math.abs(ZIPPO_LID_OPEN_DEG)) * dtSeconds;
          if (this.lidFraction < target) this.lidFraction = Math.min(this.lidFraction + step, target);
          else if (this.lidFraction > target) this.lidFraction = Math.max(this.lidFraction - step, target);
          visual.setLid(this.lidFraction);

          this.checkFlick(dtSeconds, visual);

          var lit = this.isLit();
          var flicker = 0.75 + 0.25 * Math.sin((time / 1000) * ZIPPO_FLAME_FLICKER_HZ + this.flickerPhase);
          visual.setFlame(lit, flicker);

          // Only a lit, open lighter is a fire source. Closing it mid-
          // burn snuffs it via toggleLid, so this is belt and braces.
          var source = this.el.components['ignition-source'];
          if (source) source.hot = lit && this.lidFraction > 0.5;

          // Shut, it isn't lightable by anything either — no catching
          // fire in your pocket off a stray hot barrel.
          var lightable = this.el.components.lightable;
          if (lightable) lightable.blocked = !this.open;

          // A lit flame gives off the occasional thread of smoke.
          this.smokeTimer = (this.smokeTimer || 0) - dtSeconds * 1000;
          if (lit && this.smokeTimer <= 0) {
            this.smokeTimer = 900 + Math.random() * 600;
            visual.flameEl.object3D.getWorldPosition(this._lidTip);
            spawnSmoke(this._lidTip, null, 0.3);
          }
        },

        // A sharp flick of the wrist works the lid too. Measured at
        // the lid rather than the body so a rotation counts as motion
        // — the same detector the cigar uses to shed ash.
        checkFlick: function (dtSeconds, visual) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held') {
            this.flick.reset();
            return;
          }

          visual.hinge.object3D.getWorldPosition(this._lidTip);
          if (this.flick.update(this._lidTip, dtSeconds)) this.toggleLid();
        },
      });

      // ==============================================================
      // COMPONENT: vice-meter
      // Owns the two numbers in VICES and the readout that tells you
      // where you stand.
      //
      // They're kept separate because they do different jobs. Nicotine
      // is the shakes and nothing else — a fast tremor on everything
      // you hold, which is why five cigars at once is funny. Alcohol
      // is the interesting one: aim drift, a head-locked vignette and
      // warm pulse, and butterfingers, all of which live in other
      // components that just read VICES.alcohol. Neither meter is
      // allowed anywhere near the camera transform.
      //
      // Both decay on their own, slowly enough that a session has
      // consequences and fast enough that you can sober up if you stop.
      // ==============================================================
      var SOBER_SKY = '#7d6b8f';
      var DRUNK_SKY = '#9c5f79';

      function addAlcohol(amount) {
        VICES.alcohol = Math.min(VICES.alcohol + amount, 1);
      }

      function addNicotine(amount) {
        VICES.nicotine = Math.min(VICES.nicotine + amount, 1);
      }

      registerComponent('vice-meter', {
        init: function () {
          VICES.alcohol = 0;
          VICES.nicotine = 0;

          this.hud = document.querySelector('#vice-text');
          this.sky = document.querySelector('a-sky');
          this.refreshTimer = 0;

          this._soberColor = new THREE.Color(SOBER_SKY);
          this._drunkColor = new THREE.Color(DRUNK_SKY);
          this._skyColor = new THREE.Color();
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          VICES.alcohol = Math.max(VICES.alcohol - ALCOHOL_DECAY_PER_S * dtSeconds, 0);
          VICES.nicotine = Math.max(VICES.nicotine - NICOTINE_DECAY_PER_S * dtSeconds, 0);

          this.refreshTimer -= dt || 16;
          if (this.refreshTimer > 0) return;
          this.refreshTimer = 150;

          this.updateHud();
          this.updateSky();
        },

        updateHud: function () {
          if (!this.hud || !PLAYER_HUD_VISIBLE) return;
          this.hud.setAttribute(
            'text',
            'value',
            'Alcohol: ' + Math.round(VICES.alcohol * 100) + '%   |   Nicotine: ' + Math.round(VICES.nicotine * 100) + '%'
          );
        },

        updateSky: function () {
          if (!this.sky) return;
          this._skyColor.copy(this._soberColor).lerp(this._drunkColor, VICES.alcohol);
          this.sky.setAttribute('material', 'color', '#' + this._skyColor.getHexString());
        },
      });

      // ==============================================================
      // COMPONENT: booze-overlay
      // The visual half of being drunk: a tunnel vignette closing in
      // from the edges plus a warm tint over the whole view, both
      // pulsing slowly.
      //
      // It is drawn as a single quad in CLIP SPACE — the vertex shader
      // writes gl_Position directly from the vertex positions and
      // never looks at the camera at all. That's deliberate and it's
      // the third attempt at this. A quad placed in the world in front
      // of the camera only works if it exactly matches the frustum at
      // that distance: too small and you see a rectangle floating in
      // front of you, too big and the entire gradient falls outside
      // your field of view, so every pixel you can actually see
      // samples the clear middle and the effect is invisible. Matching
      // the frustum means knowing the FOV, and in WebXR there is no
      // single FOV to know — the runtime substitutes two per-eye
      // projection matrices, and any hardcoded guess is a guess. In
      // clip space there is nothing to get wrong: the quad covers
      // exactly the viewport, per eye, at any FOV, on any device.
      //
      // The safety argument is unchanged and is the whole reason the
      // drunk effects are allowed to be visual at all: this is rigidly
      // locked to your view, so there is no relative motion for your
      // inner ear to disagree with. Nothing here — and nothing
      // anywhere else in the alcohol code — moves the camera.
      // ==============================================================
      var VIGNETTE_MAX = 0.92; // peak darkness of the closed-in tunnel
      var TINT_MAX = 0.3; // peak warm wash over everything
      var TINT_PULSE_HZ = 0.35;
      var VIGNETTE_CURVE = 0.65; // <1 pushes the effect earlier, so being a bit drunk still reads

      registerComponent('booze-overlay', {
        init: function () {
          var vertexShader = [
            'varying vec2 vUv;',
            'void main() {',
            // position.xy spans -0.5..0.5 on a unit plane; doubling it
            // spans the full -1..1 of clip space. z is pinned just
            // inside the far plane and depth testing is off anyway.
            '  vUv = uv;',
            '  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);',
            '}',
          ].join('\n');

          var fragmentShader = [
            'varying vec2 vUv;',
            'uniform float amount;',
            'uniform vec3 tintColor;',
            'uniform vec3 edgeColor;',
            'void main() {',
            '  float r = length(vUv - vec2(0.5)) * 2.0;', // 0 at center, ~1.41 at the corners
            '  float tunnel = smoothstep(0.55, 1.3, r);',
            '  float alpha = clamp(tunnel * amount * ' + VIGNETTE_MAX.toFixed(2) + ' + amount * ' + TINT_MAX.toFixed(2) + ', 0.0, 1.0);',
            '  vec3 color = mix(tintColor, edgeColor, tunnel);',
            '  gl_FragColor = vec4(color, alpha);',
            '}',
          ].join('\n');

          this.material = new THREE.ShaderMaterial({
            uniforms: {
              amount: { value: 0 },
              tintColor: { value: new THREE.Color('#c25a3a') },
              edgeColor: { value: new THREE.Color('#0a060c') },
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          });

          this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
          this.mesh.frustumCulled = false; // its vertices are in clip space; culling them against a frustum is meaningless
          this.mesh.renderOrder = 10000; // last, over everything, including anything held up to your face
          this.mesh.visible = false;
          this.el.setObject3D('overlay', this.mesh);
        },

        remove: function () {
          this.el.removeObject3D('overlay');
        },

        tick: function (time) {
          var alcohol = VICES.alcohol;
          if (alcohol <= 0.01) {
            this.mesh.visible = false;
            return;
          }

          this.mesh.visible = true;
          // The pulse is the "woozy" part: a slow swell that reads as
          // the room breathing, without anything actually moving.
          var pulse = 0.78 + 0.22 * Math.sin((time / 1000) * TINT_PULSE_HZ * Math.PI * 2);
          this.material.uniforms.amount.value = Math.pow(alcohol, VIGNETTE_CURVE) * pulse;
        },
      });
