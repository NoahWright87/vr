      // ==============================================================
      // WORLD: saloon-darts
      // The saloon's dart room: three stalls at three distances, a dart
      // item that reuses the ordinary overhand throw untouched, and a
      // chalkboard scoreboard per stall. Reachable via teleport-hub
      // (world-town.js) — see saloon-darts' own init() for how it finds
      // where to build itself.
      //
      // Nothing here adds new throwing physics. A dart is a small
      // holsterable, same as a bottle or an arrow: class="grabbable",
      // pick it up, and the existing overhand release (computeThrowVelocity
      // in core.js) does the rest. The only two pieces that are actually
      // new are (1) a dart freezing in place — sticking — the instant it
      // crosses a `.shootable` scoring ring, which is boxy-arrow's own
      // "sticks where it lands" trick applied to a second item, and (2)
      // the round bookkeeping in dart-stall: which of the 3 starting
      // darts have left their slot and come to rest somewhere else, and
      // resetting the lot once all 3 have.
      // ==============================================================

      // ROOM — floor and three walls (no fourth, no roof: an open-front
      // stall shed, not a sealed building) built around wherever
      // TOWN_LOCATIONS says "saloon" lands the player, so the room is
      // never at risk of drifting away from its own front door.
      //
      // Sized for a real guardian boundary, not a real dart alley: most
      // people playing this on a Quest have something like a 2x2m room-
      // scale space, not the run of a whole saloon, so the player has to
      // land close enough to reach a rack without walking out of their
      // play area, and the farthest throw (HARD, below) has to still fit
      // inside it. Everything here is picked to that constraint first —
      // see DART_STALLS' own comment for the walking-distance math.
      var SALOON_ROOM_WIDTH = 5;
      var SALOON_ROOM_DEPTH = 4; // z spans roughly -1.9 (back wall) to +2.1, floor centered on local z 0.1
      var SALOON_WALL_HEIGHT = 3.2;
      var SALOON_BACK_WALL_Z = -1.7;
      var SALOON_WALL_COLOR = '#4a3220';
      var SALOON_FLOOR_COLOR = '#5b4633';

      // BOARD — mounted just clear of the back wall so it doesn't
      // z-fight with it; local z/height are shared by every stall, only
      // `distance` (how far the slot row sits from it) changes per
      // stall. BOARD_RADIUS (0.24m) is close to a regulation dartboard's
      // own ~0.23m playing radius — everything else here is invented for
      // a low-poly boxy aesthetic, not measured against a real one.
      var DART_BOARD_LOCAL_Z = -1.4;
      var DART_BOARD_HEIGHT = 1.4;
      var DART_RING_Z_STEP = 0.008; // each zone drawn a hair further forward than the last, inner-to-outer — see createDartFace
      var DART_SLOT_HEIGHT = 1.1; // comfortable "reach out and take one" height, not the board's own height
      var DART_CHALKBOARD_HEIGHT = 2.25;
      var DART_RESET_DELAY_MS = 4000; // 3-5s after the third dart lands, the stall resets

      // DART ITEM — deliberately short. A regulation steel dart is
      // ~0.13-0.16m tip to flight; this one skews toward the long end so
      // it still reads as a dart rather than a nail at Quest 2 arm's
      // length.
      var DART_LENGTH = 0.16;
      var DART_TIP_LEN = 0.025;
      var DART_BARREL_LEN = 0.07;
      var DART_EMBED_DEPTH = 0.015; // meters buried past the impact point, so the tip reads as stuck rather than resting flush on the surface

      // Three difficulties, one board layout. `x` spaces the stalls
      // across the room; `distance` is the one number that actually
      // makes a stall harder — everything about the board and the darts
      // themselves is identical across all three.
      //
      // Both numbers are deliberately small rather than realistic: real
      // regulation throw distance (2.37m) alone can exceed a small
      // guardian, so all three are compressed well under that, and 1.3m
      // between stalls means reaching any of the three racks from the
      // middle one is a step, not a walk. TOWN_LOCATIONS' "saloon" entry
      // point (world-town.js) lands the player at this file's local
      // origin, which — see buildSlots — puts them within about 0.4m of
      // every rack: right in front of MEDIUM's, a half-step from EASY's
      // or HARD's.
      var DART_STALLS = [
        { id: 'easy', label: 'EASY', distance: 1.0, x: -1.3 },
        { id: 'medium', label: 'MEDIUM', distance: 1.4, x: 0 },
        { id: 'hard', label: 'HARD', distance: 1.8, x: 1.3 },
      ];

      // ==============================================================
      // ITEM: dart
      // A small holsterable with a point on it — structurally the same
      // sentence boxy-arrow's own comment opens with, and for the same
      // reason: everything about picking it up, throwing it overhand,
      // and having it fly is already generic. `keep: true` (unlike the
      // arrow) because dart-stall owns exactly 3 of these per stall for
      // the room's whole lifetime and resets them by re-slotting, not by
      // despawning and rebuilding — perishable's 30-second loose-item
      // clock would otherwise race that reset for a slow player.
      // ==============================================================
      defineItem('dart', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: 0, y: 0, z: 0 }, // tip (-Z) pointing at the board, same convention as an arrow on the rack
          heldRotation: { x: 0, y: 0, z: 0 },
          grabRadius: 0.08,
          grabSpan: { x: 0, y: 0, z: -DART_LENGTH + 0.03 }, // grabbable anywhere along the shaft, not just at the origin
          comOffset: { x: 0, y: 0, z: -0.05 },
          maxThrowSpeed: 11, // a hair under the generic default — light, hand-flicked, not hurled
        });
        el.setAttribute('boxy-dart', '');
        el.setAttribute('dart', '');
      }, { keep: true });

      // ==============================================================
      // COMPONENT: boxy-dart
      // Tip, barrel, two crossed flights. Same axis convention as every
      // other prop here: entity origin near the grip, -Z is the tip.
      // ==============================================================
      registerComponent('boxy-dart', {
        init: function () {
          var el = this.el;

          var tip = document.createElement('a-cone');
          tip.setAttribute('radius-bottom', 0.006);
          tip.setAttribute('radius-top', 0);
          tip.setAttribute('height', DART_TIP_LEN);
          tip.setAttribute('rotation', '-90 0 0');
          tip.setAttribute('position', { x: 0, y: 0, z: -DART_LENGTH + DART_TIP_LEN / 2 });
          tip.setAttribute('color', '#c7c7c7');
          el.appendChild(tip);

          var barrel = document.createElement('a-cylinder');
          barrel.setAttribute('radius', 0.005);
          barrel.setAttribute('height', DART_BARREL_LEN);
          barrel.setAttribute('rotation', '90 0 0');
          barrel.setAttribute('position', { x: 0, y: 0, z: -DART_LENGTH + DART_TIP_LEN + DART_BARREL_LEN / 2 });
          barrel.setAttribute('color', '#8a6d4b');
          el.appendChild(barrel);

          for (var i = 0; i < 2; i++) {
            var fin = document.createElement('a-box');
            fin.setAttribute('width', 0.001);
            fin.setAttribute('height', 0.026);
            fin.setAttribute('depth', 0.045);
            fin.setAttribute('position', { x: 0, y: 0, z: -DART_LENGTH + DART_TIP_LEN + DART_BARREL_LEN + 0.02 });
            fin.setAttribute('color', i ? '#c1121f' : '#f4f1de');

            var pivot = document.createElement('a-entity');
            pivot.setAttribute('rotation', { x: 0, y: 0, z: i * 90 });
            pivot.appendChild(fin);
            el.appendChild(pivot);
          }
        },
      });

      // ==============================================================
      // COMPONENT: dart
      // The two bits of behaviour boxy-arrow's own `arrow` component
      // already proved out: nose into the direction of travel while
      // genuinely flying, and freeze in place — the "stuck" trick — the
      // instant checkImpact (core-equip.js) reports a hit. The only
      // addition is pinning position to the exact impact point (rather
      // than wherever the dart's own last integration step left it),
      // pulled a hair further along its own travel direction so the tip
      // reads as buried rather than sitting flush on the board.
      // ==============================================================
      registerComponent('dart', {
        init: function () {
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._forward = new THREE.Vector3(0, 0, -1);
          this._hitPoint = new THREE.Vector3();

          this.onImpact = this.onImpact.bind(this);
          this.el.addEventListener('impact', this.onImpact);
        },

        remove: function () {
          this.el.removeEventListener('impact', this.onImpact);
        },

        tick: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'falling') return;
          if (holsterable.fallVelocity.lengthSq() < 1) return;

          this._dir.copy(holsterable.fallVelocity).normalize();
          this._quat.setFromUnitVectors(this._forward, this._dir);
          this.el.object3D.quaternion.copy(this._quat);
          holsterable.angularVelocity.set(0, 0, 0);
        },

        onImpact: function (evt) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;

          // checkImpact only ever fires this while the dart is
          // world-parented (see core-equip.js's startFalling/
          // throwWithVelocity), so the hit point is already in the same
          // space as this object3D's own position — no local/world
          // conversion needed, same assumption boxy-arrow's onImpact
          // relies on.
          this._hitPoint.copy(evt.detail.point);
          this._dir.copy(holsterable.fallVelocity);
          if (this._dir.lengthSq() > 0.0001) {
            this._dir.normalize();
            this._hitPoint.addScaledVector(this._dir, DART_EMBED_DEPTH);
          }
          this.el.object3D.position.copy(this._hitPoint);

          holsterable.fallVelocity.set(0, 0, 0);
          holsterable.angularVelocity.set(0, 0, 0);
          holsterable.state = 'resting';
          playThunk();
        },
      });

      // ==============================================================
      // COMPONENT: dart-ring
      // One scored zone on a board. Structurally scoring-ring
      // (world-targets.js) with the two things that don't apply to a
      // dartboard dropped: no `fallen` gate (a dartboard never tips
      // over) and no direct-to-singleton-manager emit, since there are
      // three independent stalls rather than one shared range. Finds
      // its own stall via closest() instead.
      // ==============================================================
      registerComponent('dart-ring', {
        schema: {
          score: { type: 'number' },
        },

        init: function () {
          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
        },

        onShot: function () {
          var stallEl = this.el.closest('[dart-stall]');
          var stall = stallEl && stallEl.components['dart-stall'];
          if (stall) stall.registerHit(this.data.score);
        },
      });

      // ==============================================================
      // COMPONENT: dart-stall
      // One difficulty's worth of game: builds its own board, chalkboard
      // and 3-slot rack, then owns the round. A dart's slot claim is
      // read straight off holsterable (state/currentSlotEl) rather than
      // tracked via events, because there isn't a "picked up" or
      // "thrown" event anywhere in this codebase to listen for — see
      // core-equip.js's holsterable comment block. Polling three darts'
      // state once a frame is cheap enough not to matter.
      //
      // Per-dart phase, checked every tick:
      //   home   — resting in its own slot, untouched since the round
      //            started (or since the last reset).
      //   active — has left that slot (grabbed) but hasn't settled
      //            anywhere else yet. Settling BACK into its own slot
      //            from here returns it to 'home' with no count — per
      //            the brief, picking a dart up and setting it right
      //            back doesn't use it up.
      //   used   — settled (resting, or holstered somewhere that isn't
      //            its own slot) after having been active. Counts once
      //            toward the round's 3, and stays 'used' until
      //            resetRound() puts it back.
      // ==============================================================
      registerComponent('dart-stall', {
        schema: {
          uid: { type: 'string' }, // short id for this stall's DOM ids — 'easy' / 'medium' / 'hard'
          label: { type: 'string' },
          distance: { type: 'number' },
        },

        init: function () {
          this.score = 0;
          this.topScore = 0;
          this.thrownCount = 0;
          this.awaitingReset = false;
          this.resetTimer = 0;
          this.spawned = false;

          this.dartSlots = [];
          this.darts = [];
          this.dartPhase = [];

          this.buildBoard();
          this.buildChalkboard();
          this.buildSlots();
          this.updateChalkboard();
        },

        buildBoard: function () {
          var backing = document.createElement('a-box');
          backing.setAttribute('width', 0.56);
          backing.setAttribute('height', 0.56);
          backing.setAttribute('depth', 0.03);
          backing.setAttribute('color', '#3a2a1c');
          backing.setAttribute('position', { x: 0, y: DART_BOARD_HEIGHT, z: DART_BOARD_LOCAL_Z - 0.02 });
          this.el.appendChild(backing);

          // Ordered outer-to-inner. Each is a full solid disc, not a
          // ring shape — smaller ones stack slightly further forward
          // (see DART_RING_Z_STEP) and simply cover the middle of the
          // larger ones behind them, the same "stacked discs read as
          // concentric rings" trick createTargetFace uses.
          var zones = [
            { radius: 0.22, color: '#e9d9b8', score: 10 },
            { radius: 0.16, color: '#1f6b3a', score: 20 },
            { radius: 0.1, color: '#b8202a', score: 40 },
            { radius: 0.045, color: '#e0b23c', score: 50 },
          ];

          var el = this.el;
          zones.forEach(function (zone, i) {
            var ring = document.createElement('a-circle');
            ring.setAttribute('radius', zone.radius);
            ring.setAttribute('color', zone.color);
            ring.setAttribute('position', { x: 0, y: DART_BOARD_HEIGHT, z: DART_BOARD_LOCAL_Z + i * DART_RING_Z_STEP });
            ring.classList.add('shootable');
            ring.setAttribute('dart-ring', { score: zone.score });
            el.appendChild(ring);
          });
        },

        // Dark green board, white text, wood frame — the chalkboard
        // look the brief asked for. A real hand-chalked font is a later
        // pass (see the file header); a-text's default face is the
        // placeholder for now, same as every other HUD in this game.
        buildChalkboard: function () {
          var y = DART_CHALKBOARD_HEIGHT;
          var z = DART_BOARD_LOCAL_Z + 0.02;

          var frame = document.createElement('a-box');
          frame.setAttribute('width', 1.0);
          frame.setAttribute('height', 0.6);
          frame.setAttribute('depth', 0.04);
          frame.setAttribute('color', '#4a3220');
          frame.setAttribute('position', { x: 0, y: y, z: z });
          this.el.appendChild(frame);

          var board = document.createElement('a-plane');
          board.setAttribute('width', 0.88);
          board.setAttribute('height', 0.48);
          board.setAttribute('color', '#173620');
          board.setAttribute('position', { x: 0, y: y, z: z + 0.025 });
          this.el.appendChild(board);

          var text = document.createElement('a-text');
          text.setAttribute('align', 'center');
          text.setAttribute('color', '#FFFFFF');
          text.setAttribute('width', 1.1);
          text.setAttribute('position', { x: 0, y: y, z: z + 0.03 });
          this.el.appendChild(text);
          this.scoreText = text;
        },

        buildSlots: function () {
          var self = this;
          var offsets = [-0.09, 0, 0.09];
          var z = DART_BOARD_LOCAL_Z + this.data.distance;

          offsets.forEach(function (xOff, i) {
            var slot = document.createElement('a-entity');
            slot.id = 'dart-slot-' + self.data.uid + '-' + i;
            slot.classList.add('anchor-slot');
            slot.setAttribute('anchor-slot', 'size: small');
            slot.setAttribute('position', { x: xOff, y: DART_SLOT_HEIGHT, z: z });
            self.el.appendChild(slot);
            self.dartSlots.push(slot);
          });
        },

        tick: function (time, dt) {
          if (!this.spawned) {
            this.trySpawnDarts();
            return;
          }
          this.updateRound(dt);
        },

        // Deferred to tick — same reason `stocked` (core.js) waits for
        // its own tick rather than building in init(): these slots were
        // just created this frame, and their anchor-slot component
        // isn't guaranteed to have attached yet on a dynamically-added
        // entity the way it would for markup present at scene load.
        trySpawnDarts: function () {
          for (var i = 0; i < this.dartSlots.length; i++) {
            if (!this.dartSlots[i].components['anchor-slot']) return;
          }

          for (var j = 0; j < this.dartSlots.length; j++) {
            this.darts.push(makeItem('dart', this.dartSlots[j]));
            this.dartPhase.push('home');
          }
          this.spawned = true;
        },

        updateRound: function (dt) {
          for (var i = 0; i < this.darts.length; i++) {
            var holsterable = this.darts[i].components.holsterable;
            if (!holsterable) continue;

            var atHome = holsterable.state === 'holstered' && holsterable.currentSlotEl === this.dartSlots[i];

            if (this.dartPhase[i] === 'home') {
              if (!atHome) this.dartPhase[i] = 'active';
            } else if (this.dartPhase[i] === 'active') {
              if (atHome) {
                this.dartPhase[i] = 'home';
              } else if (holsterable.state === 'resting' || holsterable.state === 'holstered') {
                this.dartPhase[i] = 'used';
                this.thrownCount++;
              }
            }
          }

          if (this.thrownCount >= this.darts.length && !this.awaitingReset) {
            this.awaitingReset = true;
            this.resetTimer = DART_RESET_DELAY_MS;
          }

          if (this.awaitingReset) {
            this.resetTimer -= dt || 16;
            if (this.resetTimer <= 0) this.resetRound();
          }
        },

        registerHit: function (score) {
          this.score += score;
          this.updateChalkboard();
        },

        // Puts all 3 darts back through the same door holstering
        // anything ordinarily uses — occupySlot's own reflow blends
        // each one smoothly back into place (snapTo), so a dart stuck
        // in the board visibly flies back to the rack rather than
        // popping there.
        resetRound: function () {
          for (var i = 0; i < this.darts.length; i++) {
            var holsterable = this.darts[i].components.holsterable;
            if (!holsterable) continue;

            holsterable.vacateSlot();
            holsterable.state = 'holstered';
            holsterable.hand = null;
            holsterable.fallVelocity.set(0, 0, 0);
            holsterable.angularVelocity.set(0, 0, 0);
            holsterable.occupySlot(this.dartSlots[i]);
            this.dartPhase[i] = 'home';
          }

          this.thrownCount = 0;
          this.awaitingReset = false;
          this.resetTimer = 0;

          if (this.score > this.topScore) this.topScore = this.score;
          this.score = 0;
          this.updateChalkboard();
        },

        updateChalkboard: function () {
          if (!this.scoreText) return;
          this.scoreText.setAttribute(
            'value',
            this.data.label + '\nScore: ' + this.score + '\nBest: ' + this.topScore
          );
        },
      });

      // ==============================================================
      // COMPONENT: saloon-darts
      // The room itself: finds where TOWN_LOCATIONS put "the saloon",
      // builds walls and a floor there, and spawns the 3 stalls as
      // children so every local coordinate above (DART_BOARD_LOCAL_Z
      // and friends) is relative to this one room rather than to the
      // world.
      // ==============================================================
      registerComponent('saloon-darts', {
        init: function () {
          var origin = findTownLocation('saloon');
          if (origin) this.el.setAttribute('position', origin.position);

          this.buildRoom();

          var el = this.el;
          DART_STALLS.forEach(function (stall) {
            var stallEl = document.createElement('a-entity');
            stallEl.setAttribute('position', { x: stall.x, y: 0, z: 0 });
            stallEl.setAttribute('dart-stall', { uid: stall.id, label: stall.label, distance: stall.distance });
            el.appendChild(stallEl);
          });
        },

        buildRoom: function () {
          // Floor/side walls span forward from the back wall, so their
          // center is derived from it rather than a second magic number
          // that could quietly drift out of sync with SALOON_BACK_WALL_Z.
          var centerZ = SALOON_BACK_WALL_Z + SALOON_ROOM_DEPTH / 2;

          var floor = document.createElement('a-plane');
          floor.setAttribute('rotation', '-90 0 0');
          floor.setAttribute('width', SALOON_ROOM_WIDTH);
          floor.setAttribute('height', SALOON_ROOM_DEPTH);
          floor.setAttribute('position', { x: 0, y: 0, z: centerZ });
          floor.setAttribute('color', SALOON_FLOOR_COLOR);
          this.el.appendChild(floor);

          var back = document.createElement('a-box');
          back.setAttribute('width', SALOON_ROOM_WIDTH);
          back.setAttribute('height', SALOON_WALL_HEIGHT);
          back.setAttribute('depth', 0.2);
          back.setAttribute('position', { x: 0, y: SALOON_WALL_HEIGHT / 2, z: SALOON_BACK_WALL_Z });
          back.setAttribute('color', SALOON_WALL_COLOR);
          this.el.appendChild(back);

          var el = this.el;
          [-1, 1].forEach(function (side) {
            var wall = document.createElement('a-box');
            wall.setAttribute('width', 0.2);
            wall.setAttribute('height', SALOON_WALL_HEIGHT);
            wall.setAttribute('depth', SALOON_ROOM_DEPTH);
            wall.setAttribute('position', { x: side * (SALOON_ROOM_WIDTH / 2), y: SALOON_WALL_HEIGHT / 2, z: centerZ });
            wall.setAttribute('color', SALOON_WALL_COLOR);
            el.appendChild(wall);
          });
        },
      });
