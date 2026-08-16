      // ==============================================================
      // ITEMS: bow
      // Two hands, and neither of them presses anything. The bow hand
      // holds and aims it; the other takes hold of the string — which
      // is the *support grip* the shotgun's forend already introduced,
      // just mounted behind the weapon instead of along it, so a drawn
      // bow points down the line between your hands the same way a
      // braced shotgun does, read backwards. Pull that hand away from
      // the bow and the draw is simply how far apart your hands are.
      // Let go of the grip and it looses.
      //
      // What flies is whatever is sitting in the nock, which is an
      // ordinary anchor-slot mounted on the string. It has room for
      // three, and the fan that spreads five cigars across your teeth
      // is what makes three arrows read as three arrows. Nothing
      // anywhere says the nock takes arrows, so it doesn't: a beer
      // bottle, a lit cigar or a stick of dynamite will all sit in it
      // perfectly happily and all leave at the same speed.
      //
      // The aim cheats, deliberately and in the same way an overhand
      // throw does. Where you're LOOKING picks the point it's solving
      // for, and the elevation to reach that point at the speed your
      // draw earned is worked out for you — because judging the arc of
      // an arrow by eye in VR is not fun, and watching one drop onto a
      // target two-thirds of a field away very much is.
      //
      // Split out of game.js — see DESIGN.md's "File structure" section.
      // ==============================================================

      var BOW_REST_DRAW = 0.14; // metres between hands that counts as "not drawn yet"
      var BOW_MAX_DRAW = 0.62; // and a full draw
      var BOW_MIN_LOOSE = 0.18; // below this the string just slips off your fingers, no shot
      var BOW_LIMB_LENGTH = 0.46; // one limb, from the grip
      var BOW_STRING_REST_Z = 0.05; // where the string sits undrawn, behind the grip
      var ARROW_MIN_SPEED = 9; // m/s at the shortest draw that still looses
      var ARROW_MAX_SPEED = 30; // and at a full one
      var ARROW_AIM_ASSIST = 0.85; // 0 = raw bow direction, 1 = solved straight at what you're looking at
      var ARROW_LENGTH = 0.62;
      var ARROW_STACK = 3; // how many the nock will hold at once
      var ARROW_FAN_DEG = 7; // degrees between arrows in a volley, loaded and loosed alike
      var ARMORY_ARROWS = 5; // how many lie in the trough on the bench
      // The bow declares the second grip BEHIND itself, which is the
      // one line that turns the shotgun's forend into a bowstring.
      // Everything else about drawing and loosing is in the `bow`
      // component, and everything about holding, holstering, twirling
      // and catching it is holsterable's, unchanged.
      defineItem('bow', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          // Unlike the guns, a bow racks FLAT: limbs up, string toward
          // you. That reads as a bow slung on your back in the
          // bandolier, and the armoury's cradle rolls the socket a
          // quarter turn to lay the same pose down on the bench.
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.2,
          grabSpan: { x: 0, y: BOW_LIMB_LENGTH * 0.8, z: 0 }, // the upper limb counts as the bow
          comOffset: { x: 0, y: 0.02, z: 0 },
          supportGrip: { x: 0, y: 0, z: BOW_STRING_REST_Z },
          supportRadius: 0.24,
          // The bow does NOT swing to face the string hand. It's held
          // in one hand and aimed with that hand; the other hand just
          // pulls. Letting the string hand steer it meant the whole bow
          // snapped back into place the instant you loosed, which read
          // as the weapon flinching.
          supportAims: false,
          supportGrab: 'trigger', // draw with the finger that shoots; grip stays free to take the arrow back off the string
          maxThrowSpeed: 8,
        });
        el.setAttribute('boxy-bow', '');
        el.setAttribute('bow', '');
      });

      // An arrow is a small holsterable with a point on it. It's
      // lightable, so every existing way of setting something alight
      // sets an arrow alight, and an ignition-source, so a lit one
      // sets alight whatever it lands in — including a puddle of
      // spilled beer on the far side of the room, which is a sentence
      // nobody had to write any code for.
      defineItem('arrow', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: 0, y: 0, z: 0 }, // point-first, which is right on a bowstring and on your back; a rack that wants them any other way rolls its own socket
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.13,
          grabSpan: { x: 0, y: 0, z: -ARROW_LENGTH }, // grab it anywhere along the shaft, not just by the nock
          comOffset: { x: 0, y: 0, z: -0.2 },
          gravityScale: 0.85,
          maxThrowSpeed: 9, // by hand it's a poor javelin; off a string it's something else
        });
        el.setAttribute('boxy-arrow', '');
        el.setAttribute('arrow', '');
        el.setAttribute('lightable', { tipSelector: '.ember' });
        el.setAttribute('ignition-source', { tipSelector: '.ember' });
      });
      // ==============================================================
      // COMPONENT: boxy-bow
      // Two limbs, a grip, a string, and a nock. Same axis convention
      // as the guns — the entity origin is where your fist closes and
      // -Z is where the thing you loosed goes — so the bow holsters,
      // dangles, twirls and is caught by exactly the code that does
      // that for a pistol.
      //
      // The string and the nock are children, and the nock is an
      // ordinary anchor-slot, which is the entire reason a bow can
      // fire a beer bottle.
      // ==============================================================
      registerComponent('boxy-bow', {
        init: function () {
          var el = this.el;
          var wood = '#6b4a24';

          function limb(sign) {
            // Two segments per limb, the outer one angled forward, so
            // the silhouette curves instead of being a plank.
            var inner = document.createElement('a-box');
            inner.setAttribute('width', 0.028);
            inner.setAttribute('height', BOW_LIMB_LENGTH * 0.55);
            inner.setAttribute('depth', 0.022);
            inner.setAttribute('position', { x: 0, y: sign * BOW_LIMB_LENGTH * 0.28, z: 0 });
            inner.setAttribute('color', wood);
            el.appendChild(inner);

            var outer = document.createElement('a-box');
            outer.setAttribute('width', 0.022);
            outer.setAttribute('height', BOW_LIMB_LENGTH * 0.5);
            outer.setAttribute('depth', 0.018);
            outer.setAttribute('position', { x: 0, y: sign * BOW_LIMB_LENGTH * 0.76, z: -0.055 });
            outer.setAttribute('rotation', { x: sign * 24, y: 0, z: 0 });
            outer.setAttribute('color', wood);
            el.appendChild(outer);
          }

          limb(1);
          limb(-1);

          var grip = document.createElement('a-box');
          grip.setAttribute('width', 0.038);
          grip.setAttribute('height', 0.13);
          grip.setAttribute('depth', 0.04);
          grip.setAttribute('color', '#4a3218');
          el.appendChild(grip);

          // One string, drawn as two segments meeting at the nock, so
          // pulling it back makes the V a real bow makes.
          this.upper = this.addString(1);
          this.lower = this.addString(-1);

          this.nockEl = document.createElement('a-entity');
          this.nockEl.classList.add('anchor-slot');
          // Three arrows stack UP THE STRING (the slot's own y) rather
          // than across, because that's the only place a bowstring has
          // room for them, and they splay in yaw so a volley leaves as
          // a fan instead of as one arrow drawn three times.
          this.nockEl.setAttribute('anchor-slot', {
            size: 'small',
            capacity: ARROW_STACK,
            fanAxis: 'y',
            fanSpread: 0.075,
            fanYaw: ARROW_FAN_DEG,
          });
          this.nockEl.setAttribute('position', { x: 0, y: 0, z: BOW_STRING_REST_Z });
          el.appendChild(this.nockEl);

          this.setDraw(0);
        },

        addString: function (sign) {
          var seg = document.createElement('a-box');
          seg.setAttribute('width', 0.006);
          seg.setAttribute('height', 1);
          seg.setAttribute('depth', 0.006);
          seg.setAttribute('color', '#d8cfae');
          this.el.appendChild(seg);
          seg.sign = sign;
          return seg;
        },

        // Lays the string out for a given draw, and takes the nock
        // (and therefore anything sitting in it) with it.
        setDraw: function (draw) {
          var tipY = BOW_LIMB_LENGTH * 0.95;
          var tipZ = -0.04;
          var nockZ = BOW_STRING_REST_Z + draw;

          this.nockEl.object3D.position.z = nockZ;

          [this.upper, this.lower].forEach(function (seg) {
            var dy = seg.sign * tipY;
            var dz = tipZ - nockZ;
            var length = Math.sqrt(dy * dy + dz * dz);
            seg.object3D.scale.y = length;
            seg.object3D.position.set(0, dy / 2, nockZ + dz / 2);
            seg.object3D.rotation.set(Math.atan2(dz, dy) * seg.sign, 0, 0);
          });
        },
      });

      // ==============================================================
      // COMPONENT: bow
      // The behaviour half, and it's smaller than the geometry. Every
      // hard part already existed: the second hand is holsterable's
      // support grip, the draw is how far that hand has gone, and the
      // shot is the ordinary throw with a velocity worked out by
      // solveArcAtSpeed.
      //
      // It looses whatever is in the nock without looking at it. Three
      // arrows leave as three arrows; a bottle leaves as a bottle and
      // smashes into whatever it reaches, because a thrown thing is
      // already a slow bullet (see PROJECTILES). A lit stick of
      // dynamite leaves as a problem you have made for someone else.
      // ==============================================================
      registerComponent('bow', {
        init: function () {
          this.draw = 0;
          this._from = new THREE.Vector3();
          this._velocity = new THREE.Vector3();
          this._solved = new THREE.Vector3();
          this._aim = new THREE.Vector3();
          this._quat = new THREE.Quaternion();

          this.onSupportReleased = this.onSupportReleased.bind(this);
          this.el.addEventListener('support-released', this.onSupportReleased);
        },

        remove: function () {
          this.el.removeEventListener('support-released', this.onSupportReleased);
        },

        visual: function () {
          return this.el.components['boxy-bow'];
        },

        nock: function () {
          var visual = this.visual();
          return visual && visual.nockEl;
        },

        tick: function () {
          var holsterable = this.el.components.holsterable;
          var visual = this.visual();
          if (!holsterable || !visual) return;

          var draw = holsterable.supportHand
            ? Math.min(Math.max(holsterable.supportDraw() - BOW_REST_DRAW, 0), BOW_MAX_DRAW - BOW_REST_DRAW)
            : 0;

          if (Math.abs(draw - this.draw) > 0.001) {
            this.draw = draw;
            visual.setDraw(draw);
          }
        },

        onSupportReleased: function (evt) {
          var pulled = (evt.detail && evt.detail.draw) || 0;
          var visual = this.visual();
          if (visual) visual.setDraw(0);
          this.draw = 0;

          if (pulled < BOW_MIN_LOOSE) return; // slipped off your fingers
          this.loose(Math.min((pulled - BOW_REST_DRAW) / (BOW_MAX_DRAW - BOW_REST_DRAW), 1));
        },

        loose: function (power) {
          var nock = this.nock();
          var slot = nock && nock.components['anchor-slot'];
          if (!slot || !slot.occupants.length) {
            playBowstring(power, false);
            return;
          }

          var speed = ARROW_MIN_SPEED + (ARROW_MAX_SPEED - ARROW_MIN_SPEED) * power;
          playBowstring(power, true);

          // Copied, because each one vacating the slot mutates the
          // list this is walking — the same rule the particle loop
          // follows.
          var leaving = slot.occupants.slice();
          for (var i = 0; i < leaving.length; i++) {
            this.launch(leaving[i], speed, i, leaving.length);
          }
        },

        launch: function (holsterable, speed, index, count) {
          // Freshly nocked things can still be carrying last frame's
          // world matrix, and both the arc solve below and the
          // reparent inside throwWithVelocity read it. Loosing an
          // arrow the same frame you nocked it would otherwise fire it
          // from wherever it used to be, which is exactly the sort of
          // bug that only shows up when someone is quick.
          holsterable.el.object3D.updateWorldMatrix(true, false);
          holsterable.el.object3D.getWorldPosition(this._from);

          // Straight out of the bow, before any help.
          this.el.object3D.getWorldQuaternion(this._quat);
          this._aim.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          this._velocity.copy(this._aim).multiplyScalar(speed);

          // And then the help: solve for what you're looking at and
          // lean most of the way toward that answer. See the note on
          // THE BOW for why this cheats on purpose.
          var cameraEl = document.querySelector('#head-camera');
          if (cameraEl) {
            var headPos = new THREE.Vector3();
            cameraEl.object3D.getWorldPosition(headPos);
            var target = findLookTarget(cameraEl, headPos);
            var gravity = GRAVITY * holsterable.data.gravityScale;
            if (target && solveArcAtSpeed(this._from, target, speed, gravity, this._solved)) {
              // Blend the DIRECTIONS and then put the speed back.
              // Lerping two vectors of equal length gives a shorter
              // one, which would quietly rob a full draw of a third of
              // its power the moment the assist had any work to do.
              this._velocity.lerp(this._solved, ARROW_AIM_ASSIST).setLength(speed);
            }
          }

          // A volley leaves fanned by the same angle it was sitting at
          // on the string, so what you saw loaded is what flies. Yawing
          // the velocity rather than nudging it sideways keeps every
          // arrow at the same speed — a sideways nudge made the outer
          // ones fractionally faster and longer-ranged.
          if (count > 1) {
            this._velocity.applyAxisAngle(_worldUp, (fanOffset(index, count, ARROW_FAN_DEG) * Math.PI) / 180);
          }

          // Flagged as a hurl, which is the existing "this is
          // emphatically leaving, stop trying to catch it" signal.
          // Without it the nock catches its own arrow back on the
          // first frame — the bow is a held object with a slot on it,
          // and that is precisely what a held object with a slot on it
          // is supposed to do (see findCatchingSlot).
          var launched = this._velocity.clone();
          launched.isHurl = true;
          holsterable.vacateSlot();
          holsterable.throwWithVelocity(launched);
          // A loosed arrow flies, it doesn't tumble; throwWithVelocity
          // seeds a toss's spin, which is right for a bottle out of
          // your hand and wrong for anything off a string.
          holsterable.angularVelocity.set(0, 0, 0);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-arrow / arrow
      // A shaft, a head and three fletches. The only behaviour it
      // needs beyond holsterable is: point where you're going, publish
      // heat when you're alight, and stop dead when you hit something.
      //
      // Nothing here knows about the bow. An arrow is a small
      // holsterable, so it sits in a quiver, a hip holster, your
      // mouth, or the crown of your hat, and you can throw one by
      // hand — badly, which is the joke.
      // ==============================================================
      registerComponent('boxy-arrow', {
        init: function () {
          var el = this.el;

          var shaft = document.createElement('a-cylinder');
          shaft.setAttribute('radius', 0.006);
          shaft.setAttribute('height', ARROW_LENGTH);
          shaft.setAttribute('color', '#8a6a3a');
          shaft.setAttribute('rotation', '90 0 0');
          shaft.setAttribute('position', { x: 0, y: 0, z: -ARROW_LENGTH / 2 + 0.08 });
          el.appendChild(shaft);

          var head = document.createElement('a-cone');
          head.setAttribute('radius-bottom', 0.016);
          head.setAttribute('radius-top', 0);
          head.setAttribute('height', 0.055);
          head.setAttribute('color', '#3a3f43');
          head.setAttribute('rotation', '-90 0 0');
          head.setAttribute('position', { x: 0, y: 0, z: -ARROW_LENGTH + 0.055 });
          el.appendChild(head);

          for (var i = 0; i < 3; i++) {
            var fletch = document.createElement('a-box');
            fletch.setAttribute('width', 0.002);
            fletch.setAttribute('height', 0.026);
            fletch.setAttribute('depth', 0.07);
            fletch.setAttribute('position', { x: 0, y: 0, z: 0.04 });
            fletch.setAttribute('rotation', { x: 0, y: 0, z: i * 120 });
            fletch.setAttribute('color', i ? '#c4c0b4' : '#a83b2c');
            var pivot = document.createElement('a-entity');
            pivot.setAttribute('rotation', { x: 0, y: 0, z: i * 120 });
            pivot.appendChild(fletch);
            el.appendChild(pivot);
          }

          // The head doubles as the hot tip, so a lit arrow lights
          // whatever it touches through the ordinary contract.
          var ember = document.createElement('a-sphere');
          ember.setAttribute('radius', 0.02);
          ember.setAttribute('material', 'color: #ffb02a; shader: flat; opacity: 0.9');
          ember.setAttribute('position', { x: 0, y: 0, z: -ARROW_LENGTH + 0.02 });
          ember.setAttribute('visible', false);
          ember.classList.add('ember');
          el.appendChild(ember);
          this.ember = ember;
        },
      });

      registerComponent('arrow', {
        init: function () {
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._forward = new THREE.Vector3(0, 0, -1);
          this._world = new THREE.Vector3();

          this.onImpact = this.onImpact.bind(this);
          this.el.addEventListener('impact', this.onImpact);
        },

        remove: function () {
          this.el.removeEventListener('impact', this.onImpact);
        },

        tick: function (time, dt) {
          var lightable = this.el.components.lightable;
          var lit = !!(lightable && lightable.lit);

          var visual = this.el.components['boxy-arrow'];
          if (visual && visual.ember) visual.ember.setAttribute('visible', lit);

          var source = this.el.components['ignition-source'];
          if (source) source.hot = lit;

          if (lit) {
            this.trailTimer = (this.trailTimer || 0) - (dt || 16);
            if (this.trailTimer <= 0) {
              this.trailTimer = 90;
              spawnSmoke(this.el.object3D.getWorldPosition(this._world), null, 0.4);
            }
          }

          // Nose over into the arc. Only while genuinely flying — a
          // dropped arrow tumbles like anything else.
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'falling') return;
          if (holsterable.fallVelocity.lengthSq() < 1) return;

          this._dir.copy(holsterable.fallVelocity).normalize();
          this._quat.setFromUnitVectors(this._forward, this._dir);
          this.el.object3D.quaternion.copy(this._quat);
          holsterable.angularVelocity.set(0, 0, 0);
        },

        // Sticks where it lands. Freezing in place reads as buried in
        // the thing it hit, and a stuck arrow is an ordinary resting
        // object again — pick it back up, or leave it and it'll be
        // gone in half a minute like anything else loose.
        onImpact: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;
          holsterable.fallVelocity.set(0, 0, 0);
          holsterable.angularVelocity.set(0, 0, 0);
          holsterable.state = 'resting';
          playThunk();
        },
      });
