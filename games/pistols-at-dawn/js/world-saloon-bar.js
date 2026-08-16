      // ==============================================================
      // WORLD: saloon-bar
      // The bar/armoury/wardrobe island: the turntable and shot-switch
      // generic mechanisms, the bell pole that drives them, the mirror
      // mounted in the wardrobe, and saloon-bar itself (the builder for
      // all of it). Split out of game.js because this is the file you
      // want open when you're touching bar/wardrobe positioning and
      // nothing else — see DESIGN.md's "File structure" section.
      // ==============================================================

      // MIRROR — a plain scope pointed at the player, per THE SCOPE's
      // own comment that it's generic enough to work as one. Mounted
      // in the middle of the wardrobe's front face (see saloon-bar.
      // buildWardrobeFaceA) rather than positioned as standalone
      // furniture — no position of its own here, just its optical
      // numbers.
      var MIRROR_RADIUS = 0.35;
      var MIRROR_FOV = 70; // degrees — a normal view, not a scope's zoom
      var MIRROR_WAKE = 0.8; // meters — still gated (per request — "even if it only appears when I'm close"), just close enough that leaning in reaches it
      // THE ISLAND — everything but the shooting range (see saloon-bar)
      // lives on one shared floor that flips upside-down: the bar and
      // armoury are one side, a wardrobe the same size is the other,
      // normally sitting directly underground exactly where the
      // player's standing. It's nonsense as a real place — there's no
      // pretending a bar has a whole second building bolted to its
      // underside — but there's no locomotion yet either, and this is
      // a test zone for trying out what's fun before any of it goes
      // into a real town. FLIP_SPIN_MS is slower than the bar's own
      // horizontal spin (BAR_SPIN_MS) because it's a much bigger,
      // heavier-reading motion — the whole structure tips over, not
      // just a counter turning.
      var FLIP_SPIN_MS = 1400;
      var WARDROBE_FRONT_HEIGHT = 2.0; // taller than the bar's own front panel (bodyH, ~1m) — built for a mirror and rows of pegs/hooks, not a gun counter
      // THE BELL POLE — both bells that drive the island, deliberately
      // NOT parented to any part of it (see boxy-bell-pole): if they
      // flipped or spun along with the structure they toggle, ringing
      // one to bring the bar back could take the bell itself out of
      // reach with it.
      var POLE_POSITION = { x: 1.3, y: 0, z: -0.2 }; // beside the player, clear of the bar/wardrobe's own footprint and the range dead ahead
      // ==============================================================
      // SALOON
      // The bar sits directly behind the player (+Z, opposite the
      // target gallery). There's no locomotion in this prototype, so
      // the counter's near edge is deliberately within arm's reach of
      // someone standing at the origin — turn around and the bottles
      // are right there. If teleport/stick movement ever lands, push
      // BAR_NEAR_EDGE_Z out to something more room-like (2m+) and the
      // rest of the layout follows it.
      // ==============================================================
      var BAR_WIDTH = 3.4;
      var BAR_DEPTH = 0.6;
      var BAR_TOP_Y = 1.05; // counter surface height
      var BAR_NEAR_EDGE_Z = 0.62; // meters behind the player, to the player-facing edge of the counter
      var BAR_BOTTLE_COUNT = 5;
      var BAR_BOTTLE_SPACING = 0.3; // meters between bottles standing on the counter — wide enough that grabbing picks the one you meant, tight enough that the row stays inside one reach
      var BAR_BOTTLE_Z = 0.84; // where along the counter's depth the bottles stand — just clear of the back board (see ARMORY_TOP_Y)
      var BAR_NEAR_ROW_Z = 0.7; // the cigar tray and the two spare sockets sit in front of the bottles, where they're easiest to reach
      var BAR_CIGAR_COUNT = 4;
      var SHELF_Z = 1.9; // back-bar shelf: out of reach on purpose, so those bottles are for shooting
      var SHELF_HEIGHTS = [1.62, 2.04]; // high enough to stay in view over the back board — see ARMORY_TOP_Y
      var SHELF_BOTTLES_PER_ROW = 5;
      // ==============================================================
      // THE REVOLVING BAR
      // The counter is a drum, decorated on both sides: the saloon
      // you've been drinking in on one face, an armoury on the other.
      // Shoot the bell hanging over it and the whole thing whips
      // round.
      //
      // Almost none of this is new machinery, and that's the point.
      // The beers, cigars, matches and lighter aren't "on the bar" in
      // any sense the code knows about — each one is parented to an
      // anchor slot and every one of those slots is parented to the
      // counter, so turning the counter turns the lot. Nothing had to
      // be told that a beer should come along.
      //
      // Two bits of geometry set every number below:
      //
      //   - The axis has to be the counter's own centre line, or the
      //     two faces don't swap places. That puts it 0.92m from where
      //     you're standing while the bar is 3.4m wide, so the ends of
      //     it sweep straight through you. No pivot avoids that —
      //     you're standing at the edge of a turntable — so instead
      //     nothing mounted on the drum reaches above ARMORY_TOP_Y,
      //     which passes under your chin rather than through your
      //     view, and the spin is over quickly. Both of those are feel
      //     numbers and want checking in a headset.
      //   - Each face therefore owns only the half of the drum on its
      //     own side of the axis (see saloon-bar.localTo). Anything
      //     spanning both halves — the counter block itself — belongs
      //     to the drum instead of to either face, which is why it
      //     looks the same whichever way round it is.
      // ==============================================================
      var BAR_PIVOT_Z = BAR_NEAR_EDGE_Z + BAR_DEPTH / 2; // the counter's centre line, and the axis it turns on
      var BAR_SPIN_MS = 850; // whole half-turn, eased at both ends
      var BELL_X = -0.98; // off to one side, threaded between the sightlines to the shelf bottles rather than across them
      var BELL_Y = 1.86;
      var BELL_ARM_Y = 2.5; // the bracket clears the top shelf's bottles
      // ==============================================================
      // THE ARMOURY
      // The far face of the drum: a gun bench with a board of pegs
      // above it, a shelf underneath, and far more sockets than there
      // are guns to put in them. Everything is authored in the same
      // coordinates as the saloon face, so "z = 0.7" means "a hand's
      // width in front of you" on both sides.
      //
      // The racks hold guns the same way the bar holds beer: an
      // anchor-slot and nothing else. A cradle that lays a shotgun
      // flat isn't a different kind of holder, it's a slot that has
      // been rolled 90 degrees — the gun keeps its one holstered pose
      // and the rack decides which way up that pose sits, which is
      // also why you can hang a beer bottle on a gun peg.
      // ==============================================================
      var ARMORY_TOP_Y = 1.46; // top of the back board: under a standing player's chin as it sweeps past, and low enough to leave the back-bar shelves in view
      var ARMORY_BOARD_Z = 0.905; // the board sits right against the axis; the saloon's own backboard is its other half
      var ARMORY_PEG_Z = 0.8; // where the pegs hold a gun. Far enough proud of the board that a pistol's grip — which sticks out behind it, once the gun is hanging barrel-down — stays on the armoury's own side of the axis instead of poking through into the saloon
      var ARMORY_PEG_Y = 1.4; // pistols hang barrel-down from here, muzzle clearing the bench
      var ARMORY_PISTOL_PEGS = 9;
      var ARMORY_CRADLE_Y = 1.1; // long guns lie flat on the bench in rolled slots
      var ARMORY_CRADLE_Z = 0.78; // ditto for a shotgun's stock
      var ARMORY_CRADLES = 4;
      var ARMORY_BENCH_ROW_Z = 0.68; // the free-for-all row along the front of the bench
      var ARMORY_BENCH_SOCKETS = 5; // the free row; the arrow trough takes the left end of the bench
      var ARMORY_SHELF_Y = 0.58; // the low shelf in the cavity under the bench
      var ARMORY_SHELF_Z = 0.76;
      var ARMORY_SHELF_SOCKET_X = [-0.95, -0.55, 0.55, 0.95]; // free sockets, leaving the middle of the shelf for the pack
      var ARMORY_DYNAMITE_PER_CRATE = 3;

      // Which of those start with something in them. Every other
      // socket is bare on purpose — they're for whatever you decide
      // belongs there.
      var ARMORY_PISTOL_STOCK = [0, 2, 4, 6, 8];
      var ARMORY_CRADLE_STOCK = ['shotgun', 'sniper', 'bow', 'launcher']; // per cradle, left to right; null leaves one bare
      var ARMORY_QUIVER_X = -1.36; // the arrow trough, along the front of the bench
      var ARMORY_QUIVER_Z = 0.63;
      var ARMORY_REFILL_MS = 10000;
      // ==============================================================
      // COMPONENT: boxy-mirror
      // Not a holsterable item — a frame built here, plus the `scope`
      // component doing the actual reflecting (see its own comment:
      // "it would work just as well on... a mirror behind the bar").
      // Reused completely as-is, just with a normal FOV and a much
      // larger wake distance instead of a rifle scope's zoom/eyepiece
      // numbers — see the MIRROR constants.
      //
      // Doesn't position itself — whoever builds this entity places
      // and parents it (see saloon-bar.buildWardrobeFaceA, which
      // mounts one in the middle of the wardrobe's own front face, so
      // it turns with that face and is only actually facing you when
      // that face is).
      // ==============================================================
      registerComponent('boxy-mirror', {
        init: function () {
          var el = this.el;
          el.setAttribute('scope', {
            fov: MIRROR_FOV,
            radius: MIRROR_RADIUS,
            wake: MIRROR_WAKE,
            offset: { x: 0, y: 0, z: 0 },
            objective: 0, // a mirror's glass has no barrel/tube in front of it to clear, unlike a rifle scope's default
          });

          // A ring, not a disc — the glass sits almost exactly at
          // z:0 (see `scope`'s own offset.z + 0.005), so anything
          // solid there would just cover it. A ring's hollow center
          // leaves the glass fully visible while still reading as a
          // frame around it. Set as object-form `geometry`/`material`
          // rather than the <a-ring> primitive's own top-level
          // attributes — unlike a-cone's radius-top/radius-bottom,
          // a-ring's primitive mapping doesn't expose radiusInner/
          // radiusOuter, so setting them directly as HTML-style
          // attributes silently no-ops.
          var frame = document.createElement('a-entity');
          frame.setAttribute('geometry', { primitive: 'ring', radiusInner: MIRROR_RADIUS, radiusOuter: MIRROR_RADIUS + 0.04 });
          frame.setAttribute('material', { color: BELT_BUCKLE_COLOR, shader: 'flat', side: 'double' });
          frame.setAttribute('position', { x: 0, y: 0, z: 0.01 });
          el.appendChild(frame);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-bell-pole
      // Both bells that drive the island (see saloon-bar and the
      // THE ISLAND constants comment), on a post beside the player —
      // deliberately NOT parented to any part of what they control.
      // Ringing a bell to bring the bar back has to still work after
      // the bar's gone underground with everything mounted on it; if
      // the bell went with it, there'd be no way back.
      //
      // The two arms point along the axis their bell turns, so which
      // is which reads at a glance: the horizontal-spin bell's arm
      // runs straight up off the post (y), the vertical-flip bell's
      // arm runs straight out to the side (x) — matching turntable's
      // own `axis` on whatever each one targets.
      // ==============================================================
      registerComponent('boxy-bell-pole', {
        init: function () {
          var el = this.el;
          el.setAttribute('position', POLE_POSITION);

          var post = document.createElement('a-cylinder');
          post.setAttribute('radius', 0.03);
          post.setAttribute('height', 1.8);
          post.setAttribute('color', '#3c2a1c');
          post.setAttribute('position', { x: 0, y: 0.9, z: 0 });
          el.appendChild(post);

          // Horizontal spin: bar<->armoury on one drum, wardrobe A<->B
          // on the other, whichever's currently up — see shot-switch's
          // target list, the same multi-target trick the bar's own
          // bell used before it moved here.
          this.buildBell({ x: 0, y: 1.55, z: 0 }, 'y', 0.25, '#bar-turntable, #wardrobe-turntable');

          // Vertical flip: swaps which side (bar/armoury, or wardrobe)
          // is up at all.
          this.buildBell({ x: 0, y: 1.1, z: 0 }, 'x', 0.35, '#island-flip');
        },

        // armAxis/armLength describe a straight bracket from mountPos
        // out to where the bell hangs — same brass dome/lip/clapper
        // proportions the original bar bell used, just parameterized
        // now that there are two of them on one component instead of
        // one each on two unrelated ones.
        buildBell: function (mountPos, armAxis, armLength, target) {
          var brass = '#b98c2a';
          var el = this.el;

          var armDims, armPos, bellPos;
          if (armAxis === 'y') {
            armDims = { w: 0.03, h: armLength, d: 0.03 };
            armPos = { x: mountPos.x, y: mountPos.y + armLength / 2, z: mountPos.z };
            bellPos = { x: mountPos.x, y: mountPos.y + armLength, z: mountPos.z };
          } else {
            armDims = { w: armLength, h: 0.03, d: 0.03 };
            armPos = { x: mountPos.x + armLength / 2, y: mountPos.y, z: mountPos.z };
            bellPos = { x: mountPos.x + armLength, y: mountPos.y, z: mountPos.z };
          }

          var arm = document.createElement('a-box');
          arm.setAttribute('width', armDims.w);
          arm.setAttribute('height', armDims.h);
          arm.setAttribute('depth', armDims.d);
          arm.setAttribute('position', armPos);
          arm.setAttribute('color', '#3c2a1c');
          el.appendChild(arm);

          var hanger = document.createElement('a-entity');
          hanger.setAttribute('position', bellPos);
          hanger.classList.add('shootable');
          hanger.setAttribute('shot-switch', { target: target });
          el.appendChild(hanger);

          var stem = document.createElement('a-box');
          stem.setAttribute('width', 0.014);
          stem.setAttribute('height', 0.1);
          stem.setAttribute('depth', 0.014);
          stem.setAttribute('position', { x: 0, y: -0.05, z: 0 });
          stem.setAttribute('color', '#2b2b2f');
          hanger.appendChild(stem);

          var dome = document.createElement('a-cylinder');
          dome.setAttribute('radius', 0.11);
          dome.setAttribute('height', 0.15);
          dome.setAttribute('color', brass);
          dome.setAttribute('position', { x: 0, y: -0.175, z: 0 });
          hanger.appendChild(dome);

          var lip = document.createElement('a-cylinder');
          lip.setAttribute('radius', 0.13);
          lip.setAttribute('height', 0.03);
          lip.setAttribute('color', '#8a6a1c');
          lip.setAttribute('position', { x: 0, y: -0.26, z: 0 });
          hanger.appendChild(lip);

          var clapper = document.createElement('a-box');
          clapper.setAttribute('width', 0.03);
          clapper.setAttribute('height', 0.05);
          clapper.setAttribute('depth', 0.03);
          clapper.setAttribute('position', { x: 0, y: -0.29, z: 0 });
          clapper.setAttribute('color', '#2b2b2f');
          hanger.appendChild(clapper);
        },
      });
      // ==============================================================
      // COMPONENT: turntable
      // Something with two faces that turns to show one or the other.
      // It has no idea what's mounted on it: whatever is parented here
      // comes round, and since every prop in this scene is parented to
      // an anchor slot rather than floating at a world position, that
      // means every beer, cigar, match and lit flame on the bar arrives
      // on the far side still in its socket. There is no "take the
      // bottles with it" code anywhere, and there was never going to
      // need to be.
      //
      // It listens for a `toggle` event on itself rather than being
      // driven directly, so anything at all can be the switch — see
      // shot-switch, and note that nothing here knows a bell exists.
      //
      // Two things do need saying explicitly, because they aren't
      // parented to anything:
      //
      //   - Spilt liquid. A puddle is a world-space disc, so without
      //     ridePools() a spun bar leaves your beer (or your fire)
      //     hanging in the air where the counter used to be.
      //   - The counter as a hard surface. That one is handled where
      //     it's registered, by giving the surface a frame to live in
      //     — see HARD_SURFACES.
      // ==============================================================
      registerComponent('turntable', {
        schema: {
          spinMs: { type: 'number', default: BAR_SPIN_MS },
          faces: { type: 'number', default: 2 },
          axis: { type: 'string', default: 'y' }, // 'y' | 'x' | 'z' — which local axis it turns on. The bar/armoury and wardrobe drums both spin on y (a horizontal turn); the island's own outer flip (see saloon-bar) turns on x (properly upside-down) to swap which of them is up at all.
        },

        init: function () {
          this.face = 0;
          this.fromAngle = 0;
          this.toAngle = 0;
          this.elapsed = this.data.spinMs; // "already arrived"
          this._pivot = new THREE.Vector3();
          this._poolPos = new THREE.Vector3();

          this.onToggle = this.onToggle.bind(this);
          this.el.addEventListener('toggle', this.onToggle);
        },

        remove: function () {
          this.el.removeEventListener('toggle', this.onToggle);
        },

        spinning: function () {
          return this.elapsed < this.data.spinMs;
        },

        // Mid-spin toggles are ignored rather than queued: emptying a
        // revolver into the bell should ring it, not wind it up.
        onToggle: function () {
          if (this.spinning()) return;

          this.face = (this.face + 1) % this.data.faces;
          this.fromAngle = this.el.object3D.rotation[this.data.axis];
          this.toAngle = this.fromAngle + (Math.PI * 2) / this.data.faces;
          this.elapsed = 0;
          playRumble(this.data.spinMs);
        },

        tick: function (time, dt) {
          if (!this.spinning()) return;

          this.elapsed = Math.min(this.elapsed + (dt || 16), this.data.spinMs);
          var t = this.elapsed / this.data.spinMs;
          var eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          var angle = this.fromAngle + (this.toAngle - this.fromAngle) * eased;

          // Pools are moved by the same delta and BEFORE the drum
          // turns, so the "is this puddle on my counter" test below
          // runs against the frame the puddle is still standing in.
          // ridePools bails out immediately for anything but a y-axis
          // turntable (see its own comment) — the island's own outer
          // flip (axis: x) technically "owns" the bar's counter surface
          // too, by nesting, so without that guard it would try to
          // apply this same x/z-plane rotation to any puddle sitting on
          // the bar while the whole thing tips over, which is the wrong
          // math for that axis and would fling it sideways instead of
          // just carrying it along for the ride.
          this.ridePools(angle - this.el.object3D.rotation[this.data.axis]);
          this.el.object3D.rotation[this.data.axis] = angle;

          if (!this.spinning()) playClunk();
        },

        // Every surface belonging to this turntable drags whatever has
        // been spilt on it round with it. A pool is a flat disc about a
        // vertical axis, so riding along is a rotation of its centre
        // and nothing else — and because a burning pool is just a pool,
        // setting the bar alight and then spinning it delivers a
        // burning armoury without anything here knowing what fire is.
        //
        // Y-axis only — see the comment where this is called.
        ridePools: function (deltaRad) {
          if (!deltaRad || this.data.axis !== 'y') return;

          this.el.object3D.getWorldPosition(this._pivot);
          var cos = Math.cos(deltaRad);
          var sin = Math.sin(deltaRad);

          for (var i = 0; i < POOLS.length; i++) {
            var pool = POOLS[i];
            if (!this.carries(pool)) continue;

            var dx = pool.x - this._pivot.x;
            var dz = pool.z - this._pivot.z;
            pool.x = this._pivot.x + dx * cos + dz * sin;
            pool.z = this._pivot.z - dx * sin + dz * cos;
          }
        },

        carries: function (pool) {
          for (var i = 0; i < HARD_SURFACES.length; i++) {
            var s = HARD_SURFACES[i];
            if (!s.obj || Math.abs(s.y - pool.y) > 0.06) continue;
            if (!this.owns(s.obj)) continue;
            if (overSurface(s, this._poolPos.set(pool.x, pool.y, pool.z))) return true;
          }
          return false;
        },

        owns: function (obj) {
          while (obj) {
            if (obj === this.el.object3D) return true;
            obj = obj.parent;
          }
          return false;
        },
      });

      // ==============================================================
      // COMPONENT: shot-switch
      // A shootable thing that throws a switch somewhere else. It emits
      // `toggle` at whatever it's pointed at and takes a visible knock
      // for it — that's the entire component, and it's deliberately
      // ignorant of both ends: any shootable can be the switch, and
      // anything that listens for `toggle` can be the machine. Also
      // wired to `click` so the desktop reticle can work it without a
      // headset, the same way breakable is.
      //
      // target is selectorAll rather than selector, so one bell can
      // throw more than one switch — the bar's own bell targets both
      // its own turntable and the wardrobe's, a plain CSS selector
      // list ("#bar-turntable, #wardrobe-turntable"), because ringing
      // it is meant to turn the whole connected assembly over at once.
      // ==============================================================
      registerComponent('shot-switch', {
        schema: {
          target: { type: 'selectorAll' },
          knockDeg: { type: 'number', default: 26 },
        },

        init: function () {
          this.swing = 0; // radians of knock left in it
          this.swingVel = 0;

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        onShot: function () {
          this.swingVel = (this.data.knockDeg * Math.PI) / 180 * 9;
          playClang();
          for (var i = 0; i < this.data.target.length; i++) {
            this.data.target[i].emit('toggle', null, false);
          }
        },

        // A damped swing about z, so hitting it reads as a hit even
        // when the machine it's wired to is busy and ignores it.
        tick: function (time, dt) {
          if (!this.swing && !this.swingVel) return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          this.swingVel -= this.swing * 240 * dtSeconds;
          this.swingVel *= Math.max(1 - 3.2 * dtSeconds, 0);
          this.swing += this.swingVel * dtSeconds;

          if (Math.abs(this.swing) < 0.002 && Math.abs(this.swingVel) < 0.02) {
            this.swing = 0;
            this.swingVel = 0;
          }
          this.el.object3D.rotation.z = this.swing;
        },
      });

      // ==============================================================
      // COMPONENT: saloon-bar
      // Furniture, and then a row of ordinary anchor-slots on top of
      // it. Nothing here knows that bottles belong on bars — it builds
      // sockets and puts things in them, exactly the way the hips and
      // the bandolier do, which is why you can just as well set a
      // pistol on the bar, stand a bottle in your hip holster, or
      // stash a cigar in your hat.
      //
      // Reachability, not realism, sets the layout: this prototype has
      // no locomotion, so the counter's near edge is a lean away from
      // someone standing at the origin (see BAR_NEAR_EDGE_Z). The back
      // shelf is deliberately out of reach — those bottles are there
      // to be shot, not picked up.
      //
      // This is also THE ISLAND now (see its own constants comment):
      // the whole thing — bar, armoury, and a wardrobe the same size —
      // lives on one flipping assembly, everything but the shooting
      // range. There are three nested turns here, not one:
      //   - flipEl turns the whole island on x — bar/armoury side up,
      //     or wardrobe side up, normally sitting directly underground.
      //   - drumEl (bar side) turns the counter on y — saloon or
      //     armoury, exactly as it always has.
      //   - wardrobeDrumEl (wardrobe side) turns its own counter on y —
      //     wardrobe face A or B — the same mechanism, one more time.
      // Both faces of both drums are authored in the SAME numbers
      // (BAR_WIDTH, BAR_TOP_Y, BAR_PIVOT_Z, ...) on purpose: the
      // wardrobe side's own local 180°-about-x rotation plus flipEl's
      // matching 180° flip cancel out exactly the way the armoury
      // face's local 180°-about-y rotation plus the counter's own spin
      // already do (see THE REVOLVING BAR) — so reusing those numbers
      // for the wardrobe lands it in exactly the bar's own footprint,
      // right-side up, with no new pivot math anywhere.
      // ==============================================================
      registerComponent('saloon-bar', {
        init: function () {
          this.slotSerial = 0;

          this.flipEl = this.addChild(this.el, { x: 0, y: 0, z: 0 });
          this.flipEl.setAttribute('id', 'island-flip');
          this.flipEl.setAttribute('turntable', { spinMs: FLIP_SPIN_MS, axis: 'x' });

          this.barSideEl = this.addChild(this.flipEl, { x: 0, y: 0, z: 0 });
          this.wardrobeSideEl = this.addChild(this.flipEl, { x: 0, y: 0, z: 0 });
          this.wardrobeSideEl.setAttribute('rotation', { x: 180, y: 0, z: 0 });

          // The bar/armoury side. Same structure as ever — `room` is
          // the building (back wall, out-of-reach shelves, none of
          // which move) and `drum` is the counter block, which turns.
          // Its two faces hang off it and are authored identically,
          // because the armoury's frame IS the saloon's, turned
          // around. Just one level deeper in the hierarchy than before
          // (barSideEl, under flipEl, instead of directly under `el`).
          this.roomEl = this.addChild(this.barSideEl, { x: 0, y: 0, z: 0 });

          this.drumEl = this.addChild(this.barSideEl, { x: 0, y: 0, z: BAR_PIVOT_Z });
          this.drumEl.setAttribute('id', 'bar-turntable');
          this.drumEl.setAttribute('turntable', { spinMs: BAR_SPIN_MS });

          this.barFaceEl = this.addChild(this.drumEl, { x: 0, y: 0, z: 0 });
          this.armoryFaceEl = this.addChild(this.drumEl, { x: 0, y: 0, z: 0 });
          this.armoryFaceEl.setAttribute('rotation', { x: 0, y: 180, z: 0 });

          this.buildRoom();
          this.buildDrum();
          this.buildSaloonFace();
          this.buildArmoryFace();

          // The wardrobe side — a mirror of the above (see the class
          // comment): same shape, same numbers, clothes instead of
          // guns.
          this.wardrobeRoomEl = this.addChild(this.wardrobeSideEl, { x: 0, y: 0, z: 0 });

          this.wardrobeDrumEl = this.addChild(this.wardrobeSideEl, { x: 0, y: 0, z: BAR_PIVOT_Z });
          this.wardrobeDrumEl.setAttribute('id', 'wardrobe-turntable');
          this.wardrobeDrumEl.setAttribute('turntable', { spinMs: BAR_SPIN_MS });

          this.wardrobeFaceAEl = this.addChild(this.wardrobeDrumEl, { x: 0, y: 0, z: 0 });
          this.wardrobeFaceBEl = this.addChild(this.wardrobeDrumEl, { x: 0, y: 0, z: 0 });
          this.wardrobeFaceBEl.setAttribute('rotation', { x: 0, y: 180, z: 0 });

          this.buildWardrobeRoom();
          this.buildWardrobeDrum();
          this.buildWardrobeFaceA();
          this.buildWardrobeFaceB();
        },

        addChild: function (parentEl, pos) {
          var el = document.createElement('a-entity');
          el.setAttribute('position', pos);
          parentEl.appendChild(el);
          return el;
        },

        // Both faces and the drum are authored in the same "as you see
        // it" coordinates — x across the bar, z out toward the player —
        // and this is the only place that knows which of them are
        // mounted on a drum and therefore need the axis subtracted
        // out. Either room (bar or wardrobe) is already in those
        // coordinates.
        localTo: function (faceEl, pos) {
          if (faceEl === this.roomEl || faceEl === this.wardrobeRoomEl) return pos;
          return { x: pos.x, y: pos.y, z: pos.z - BAR_PIVOT_Z };
        },

        addBox: function (w, h, d, pos, color, faceEl, rot) {
          faceEl = faceEl || this.barFaceEl;
          var box = document.createElement('a-box');
          box.setAttribute('width', w);
          box.setAttribute('height', h);
          box.setAttribute('depth', d);
          box.setAttribute('position', this.localTo(faceEl, pos));
          box.setAttribute('color', color);
          if (rot) box.setAttribute('rotation', rot);
          faceEl.appendChild(box);
          return box;
        },

        // Slots are created (and given ids) before the things that
        // start in them, so each item's holsterable="holsterSelector:
        // #..." resolves the moment it initializes.
        //
        // `rot` rolls the socket itself, which is how the armoury's
        // cradles lay a long gun flat: the gun keeps the one holstered
        // pose it has everywhere else and the rack decides which way up
        // that pose sits.
        addSlot: function (pos, size, extra, faceEl, rot) {
          faceEl = faceEl || this.barFaceEl;
          var id = 'bar-slot-' + this.slotSerial++;
          var slot = document.createElement('a-entity');
          slot.setAttribute('id', id);
          slot.classList.add('anchor-slot');

          var config = { size: size };
          Object.keys(extra || {}).forEach(function (k) {
            config[k] = extra[k];
          });
          slot.setAttribute('anchor-slot', config);
          slot.setAttribute('position', this.localTo(faceEl, pos));
          if (rot) slot.setAttribute('rotation', rot);
          faceEl.appendChild(slot);
          return id;
        },

        // Armoury sockets that start with something in them say so by
        // naming a maker, and unlike a holster they carry a refill —
        // this is the shop, so the shelf gets restocked. See stocked.
        stock: function (slotId, item) {
          var slot = document.getElementById(slotId);
          if (slot) slot.setAttribute('stocked', { item: item, refillMs: ARMORY_REFILL_MS });
        },

        // The parts of the saloon that stay where they are: the wall
        // and the high shelves that were always meant to be shot at
        // rather than reached. The bell(s) that used to be built here
        // moved out entirely — see boxy-bell-pole — because they can't
        // be part of anything that turns without taking themselves out
        // of reach along with it.
        buildRoom: function () {
          var self = this;

          this.addBox(BAR_WIDTH + 1.6, 3, 0.12, { x: 0, y: 1.5, z: SHELF_Z + 0.35 }, '#3c2a1c', this.roomEl);

          SHELF_HEIGHTS.forEach(function (y) {
            self.addBox(BAR_WIDTH - 0.4, 0.06, 0.28, { x: 0, y: y, z: SHELF_Z }, '#5b3a29', self.roomEl);
          });

          this.buildShelfBottles();
        },

        // The drum: the counter block, which belongs to neither face
        // because it straddles the axis and looks the same from either
        // side. It's a spine and two end caps rather than one solid
        // lump, so each face has a cavity of its own underneath — the
        // saloon uses it for nothing at all and the armoury keeps a
        // shelf in it, and neither can see through to the other.
        buildDrum: function () {
          var bodyH = BAR_TOP_Y - 0.07;
          var bodyY = bodyH / 2;

          this.addBox(BAR_WIDTH, 0.07, BAR_DEPTH + 0.08, { x: 0, y: BAR_TOP_Y - 0.035, z: BAR_PIVOT_Z }, '#6b4429', this.drumEl); // counter top
          this.addBox(BAR_WIDTH, bodyH, 0.14, { x: 0, y: bodyY, z: BAR_PIVOT_Z }, '#4a2f1c', this.drumEl); // spine, on the axis
          this.addBox(0.05, bodyH, BAR_DEPTH, { x: -(BAR_WIDTH / 2 - 0.025), y: bodyY, z: BAR_PIVOT_Z }, '#4a2f1c', this.drumEl);
          this.addBox(0.05, bodyH, BAR_DEPTH, { x: BAR_WIDTH / 2 - 0.025, y: bodyY, z: BAR_PIVOT_Z }, '#4a2f1c', this.drumEl);

          // The counter surface, registered as somewhere a bottle can
          // be cracked open. This is the only "collision" in the scene
          // and it exists purely for that one move. It's registered in
          // the drum's own frame, so it goes on turning being a counter
          // while the counter turns.
          HARD_SURFACES.push({
            obj: this.drumEl.object3D,
            y: BAR_TOP_Y,
            minX: -BAR_WIDTH / 2,
            maxX: BAR_WIDTH / 2,
            minZ: BAR_NEAR_EDGE_Z - 0.04 - BAR_PIVOT_Z,
            maxZ: BAR_NEAR_EDGE_Z + BAR_DEPTH + 0.04 - BAR_PIVOT_Z,
          });
        },

        buildSaloonFace: function () {
          var bodyH = BAR_TOP_Y - 0.07;
          this.addBox(BAR_WIDTH - 0.1, bodyH, 0.05, { x: 0, y: bodyH / 2, z: BAR_NEAR_EDGE_Z + 0.025 }, '#4a2f1c'); // the front of the bar
          this.addBox(BAR_WIDTH, 0.05, 0.05, { x: 0, y: 0.14, z: BAR_NEAR_EDGE_Z - 0.09 }, '#8a7a45'); // brass foot rail

          // The saloon side of the board the armoury's pegs are driven
          // into: from here it's the back of the bar, with a brass rail
          // along the top. Both halves stop dead on the axis — see
          // localTo — so together they read as one board with a
          // different idea on each side.
          var boardH = ARMORY_TOP_Y - BAR_TOP_Y;
          this.addBox(BAR_WIDTH - 0.2, boardH, 0.03, { x: 0, y: BAR_TOP_Y + boardH / 2, z: BAR_PIVOT_Z - 0.015 }, '#432c1b');
          this.addBox(BAR_WIDTH - 0.2, 0.035, 0.06, { x: 0, y: ARMORY_TOP_Y, z: BAR_PIVOT_Z - 0.03 }, '#8a7a45');

          this.buildCounterBottles();
          this.buildCigarBox();
          this.buildMatchbox();
          this.buildLighter();
          this.buildWaterJug();

          // Two spare sockets on the bar for whatever you're carrying —
          // a place to set your gun down, or your hat, while you drink.
          this.addSlot({ x: -0.92, y: BAR_TOP_Y, z: BAR_NEAR_ROW_Z }, 'medium', {});
          this.addSlot({ x: 0.92, y: BAR_TOP_Y, z: BAR_NEAR_ROW_Z }, 'medium', {});
        },

        spawnBottle: function (slotId, color) {
          var el = document.createElement('a-entity');
          el.classList.add('grabbable');
          el.classList.add('shootable');
          el.setAttribute('holsterable', {
            holsterSelector: '#' + slotId,
            itemSize: 'small',
            holsterPosition: { x: 0, y: -BOTTLE_BASE_Y, z: 0 }, // stand it on the surface, not through it
            holsterRotation: { x: 0, y: 0, z: 0 },
            heldPosition: { x: 0, y: 0, z: 0 },
            heldRotation: { x: -90, y: 0, z: 0 }, // same convention as the guns — see the RECOIL comment block
            grabRadius: 0.16,
            comOffset: { x: 0, y: -0.12, z: 0 },
            // Deliberately unphysical: a real bottle's arc is over
            // before you've drawn, and the whole point of throwing one
            // is to shoot it down. Slowing its fall buys that time.
            gravityScale: 0.6,
            maxThrowSpeed: 15,
          });
          el.setAttribute('boxy-bottle', { glass: color });
          el.setAttribute('pourable', '');
          el.setAttribute('breakable', { color: color });
          this.el.sceneEl.appendChild(el);
          return el;
        },

        buildCounterBottles: function () {
          var colors = ['#3f6b3a', '#6b4a1f', '#2f5b6b', '#5a2f3f', '#3f6b3a'];
          var startX = -((BAR_BOTTLE_COUNT - 1) * BAR_BOTTLE_SPACING) / 2;

          for (var i = 0; i < BAR_BOTTLE_COUNT; i++) {
            var slotId = this.addSlot(
              { x: startX + i * BAR_BOTTLE_SPACING, y: BAR_TOP_Y, z: BAR_BOTTLE_Z },
              'small',
              {}
            );
            this.spawnBottle(slotId, colors[i % colors.length]);
          }
        },

        buildShelfBottles: function () {
          var colors = ['#2f5b6b', '#5a2f3f', '#3f6b3a', '#6b4a1f', '#4a3f6b'];
          var self = this;
          var spacing = (BAR_WIDTH - 0.8) / (SHELF_BOTTLES_PER_ROW - 1);

          SHELF_HEIGHTS.forEach(function (y, row) {
            for (var i = 0; i < SHELF_BOTTLES_PER_ROW; i++) {
              var slotId = self.addSlot(
                { x: -(BAR_WIDTH - 0.8) / 2 + i * spacing, y: y + 0.03, z: SHELF_Z },
                'small',
                {},
                self.roomEl
              );
              self.spawnBottle(slotId, colors[(i + row * 2) % colors.length]);
            }
          });
        },

        buildCigarBox: function () {
          var trayX = 0.5;
          this.addBox(0.26, 0.05, 0.2, { x: trayX, y: BAR_TOP_Y + 0.025, z: BAR_NEAR_ROW_Z }, '#3a2a18');

          var spacing = 0.055;
          var startX = trayX - ((BAR_CIGAR_COUNT - 1) * spacing) / 2;

          for (var i = 0; i < BAR_CIGAR_COUNT; i++) {
            var slotId = this.addSlot(
              { x: startX + i * spacing, y: BAR_TOP_Y + 0.06, z: BAR_NEAR_ROW_Z },
              'small',
              {}
            );

            var el = document.createElement('a-entity');
            el.classList.add('grabbable');
            el.classList.add('shootable');
            el.setAttribute('holsterable', {
              holsterSelector: '#' + slotId,
              itemSize: 'small',
              holsterPosition: { x: 0, y: 0, z: 0 },
              holsterRotation: { x: 0, y: 0, z: 0 }, // points forward: out of the tray, or out of your mouth
              heldPosition: { x: 0, y: 0, z: 0 },
              heldRotation: { x: -90, y: 0, z: 0 },
              grabRadius: 0.11,
              comOffset: { x: 0, y: 0, z: -0.065 },
            });
            el.setAttribute('boxy-cigar', '');
            el.setAttribute('burnable', { visual: 'boxy-cigar' });
            el.setAttribute('cigar', '');
            el.setAttribute('lightable', { tipSelector: '.ember' });
            el.setAttribute('ignition-source', { tipSelector: '.ember' });
            // autoShatter off: a cigar has its own opinions about
            // being shot (it lights) and being dropped (it doesn't
            // care). It reuses breakable purely for the hide-and-come-
            // back-later cycle when it burns down to a stub.
            el.setAttribute('breakable', {
              autoShatter: false,
              sound: false,
              shards: 5,
              color: '#9c968c',
              score: 0,
              respawnMs: CIGAR_RESPAWN_MS,
            });
            this.el.sceneEl.appendChild(el);
          }
        },

        // Matches, in a little box next to the cigars. Almost all of
        // this is the same declaration a cigar gets — the differences
        // are which visual builder it uses and how fast it burns,
        // which is the point.
        buildMatchbox: function () {
          var boxX = 0.24; // beside the cigar tray, both on the near row where they're easiest to reach
          var boxZ = BAR_NEAR_ROW_Z;
          this.addBox(0.16, 0.035, 0.11, { x: boxX, y: BAR_TOP_Y + 0.018, z: boxZ }, '#7a4a2a');

          var spacing = 0.035;
          var startX = boxX - ((MATCH_COUNT - 1) * spacing) / 2;

          for (var i = 0; i < MATCH_COUNT; i++) {
            var slotId = this.addSlot({ x: startX + i * spacing, y: BAR_TOP_Y + 0.042, z: boxZ }, 'small', {});

            var el = document.createElement('a-entity');
            el.classList.add('grabbable');
            el.classList.add('shootable');
            el.setAttribute('holsterable', {
              holsterSelector: '#' + slotId,
              itemSize: 'small',
              holsterRotation: { x: 0, y: 0, z: 0 },
              heldRotation: { x: -90, y: 0, z: 0 },
              grabRadius: 0.1,
              comOffset: { x: 0, y: 0, z: -0.04 },
            });
            el.setAttribute('boxy-match', '');
            el.setAttribute('burnable', {
              visual: 'boxy-match',
              length: MATCH_LENGTH,
              ashRate: MATCH_ASH_RATE,
              minLength: MATCH_MIN_LENGTH,
              ashColor: '#3a3229',
            });
            el.setAttribute('match', '');
            el.setAttribute('lightable', { tipSelector: '.ember' });
            el.setAttribute('ignition-source', { tipSelector: '.ember' });
            el.setAttribute('breakable', {
              autoShatter: false,
              sound: false,
              shards: 3,
              color: '#3a3229',
              score: 0,
              respawnMs: MATCH_RESPAWN_MS,
            });
            this.el.sceneEl.appendChild(el);
          }
        },

        // The jug of water, for when the saloon is on fire. Declared
        // almost identically to a beer — same pourable, same
        // breakable, different liquid — which is the point.
        buildWaterJug: function () {
          var slotId = this.addSlot({ x: -0.85, y: BAR_TOP_Y, z: BAR_BOTTLE_Z }, 'medium', {});

          var el = document.createElement('a-entity');
          el.classList.add('grabbable');
          el.classList.add('shootable');
          el.setAttribute('holsterable', {
            holsterSelector: '#' + slotId,
            itemSize: 'medium',
            holsterPosition: { x: 0, y: -JUG_BASE_Y, z: 0 },
            holsterRotation: { x: 0, y: 0, z: 0 },
            heldRotation: { x: -90, y: 0, z: 0 },
            grabRadius: 0.19,
            comOffset: { x: 0, y: -0.16, z: 0 },
            gravityScale: 0.8,
          });
          el.setAttribute('boxy-jug', '');
          el.setAttribute('pourable', { liquid: 'water', capped: false });
          el.setAttribute('breakable', { color: '#9c8466', shards: 12 });
          this.el.sceneEl.appendChild(el);
        },

        // One Zippo, sitting on the bar. Unlike the matches it never
        // runs out, so it has no burnable and no breakable — just a
        // lid, a flame, and the same ignition-source contract
        // everything else lights from.
        buildLighter: function () {
          var slotId = this.addSlot({ x: -0.5, y: BAR_TOP_Y + 0.025, z: BAR_NEAR_ROW_Z }, 'small', {});

          var el = document.createElement('a-entity');
          el.classList.add('grabbable');
          el.classList.add('shootable');
          el.setAttribute('holsterable', {
            holsterSelector: '#' + slotId,
            itemSize: 'small',
            holsterRotation: { x: 0, y: 0, z: 0 },
            heldRotation: { x: -90, y: 0, z: 0 },
            grabRadius: 0.11,
            comOffset: { x: 0, y: -0.02, z: 0 },
          });
          el.setAttribute('boxy-zippo', '');
          el.setAttribute('zippo', '');
          el.setAttribute('lightable', { tipSelector: '.flame' });
          el.setAttribute('ignition-source', { tipSelector: '.flame' });
          this.el.sceneEl.appendChild(el);
        },

        // ============================================================
        // THE ARMOURY
        // The far face. Authored in exactly the coordinates the saloon
        // uses, so every number below is "where it'll be when it's your
        // turn" — the bench top IS the counter top, seen from the other
        // side.
        //
        // Every rack here is anchor-slots and boxes. Nothing in it
        // knows what a gun is: the pegs would take bottles, the cradles
        // would take your hat, and a pistol left in the free row is
        // holstered by exactly the same code that puts a beer back on
        // the bar. Only the sockets that START with something in them
        // get a `stocked`; the rest are bare on purpose.
        // ============================================================
        buildArmoryFace: function () {
          var face = this.armoryFaceEl;
          var iron = '#3a3f43';
          var board = '#4a3b2c';

          // Back board, its frame, and the pegs driven into it.
          var boardH = ARMORY_TOP_Y - BAR_TOP_Y;
          this.addBox(BAR_WIDTH - 0.2, boardH, 0.03, { x: 0, y: BAR_TOP_Y + boardH / 2, z: ARMORY_BOARD_Z }, board, face);
          this.addBox(0.08, boardH, 0.05, { x: -(BAR_WIDTH - 0.2) / 2, y: BAR_TOP_Y + boardH / 2, z: BAR_PIVOT_Z - 0.025 }, iron, face);
          this.addBox(0.08, boardH, 0.05, { x: (BAR_WIDTH - 0.2) / 2, y: BAR_TOP_Y + boardH / 2, z: BAR_PIVOT_Z - 0.025 }, iron, face);
          this.addBox(BAR_WIDTH - 0.2, 0.035, 0.06, { x: 0, y: ARMORY_TOP_Y, z: BAR_PIVOT_Z - 0.03 }, iron, face);

          this.buildPistolPegs(face, iron);
          this.buildLongGunCradles(face, iron);
          this.buildQuiver(face, iron);

          // The free row along the front of the bench: nothing in it,
          // ever. It's a place to lay out what you're taking.
          var rowStart = -0.5;
          var spacing = (BAR_WIDTH / 2 - 0.2 - rowStart) / (ARMORY_BENCH_SOCKETS - 1);
          for (var i = 0; i < ARMORY_BENCH_SOCKETS; i++) {
            this.addSlot(
              { x: rowStart + i * spacing, y: BAR_TOP_Y, z: ARMORY_BENCH_ROW_Z },
              'medium',
              {},
              face
            );
          }

          // The armoury's front is a low panel rather than a full one,
          // leaving the shelf in the cavity behind it visible and in
          // reach — the saloon's side of the same cavity is boarded
          // right up, because a bar front is a bar front.
          this.addBox(BAR_WIDTH - 0.1, 0.34, 0.05, { x: 0, y: 0.17, z: BAR_NEAR_EDGE_Z + 0.025 }, iron, face);
          this.buildAmmoShelf(face, iron);

          this.addBox(BAR_WIDTH, 0.05, 0.05, { x: 0, y: 0.14, z: BAR_NEAR_EDGE_Z - 0.09 }, iron, face); // kick rail, the armoury's answer to a brass foot rail
        },

        // Pistols hang barrel-down, which is the pose they hold in a
        // hip holster and in the crown of a hat — one holsterRotation,
        // everywhere, forever.
        buildPistolPegs: function (face, iron) {
          var spacing = (BAR_WIDTH - 0.6) / (ARMORY_PISTOL_PEGS - 1);

          for (var i = 0; i < ARMORY_PISTOL_PEGS; i++) {
            var x = -(BAR_WIDTH - 0.6) / 2 + i * spacing;
            this.addBox(0.02, 0.02, ARMORY_BOARD_Z - ARMORY_PEG_Z, { x: x, y: ARMORY_PEG_Y + 0.03, z: (ARMORY_BOARD_Z + ARMORY_PEG_Z) / 2 }, iron, face);

            var slotId = this.addSlot({ x: x, y: ARMORY_PEG_Y, z: ARMORY_PEG_Z }, 'small', {}, face);
            if (ARMORY_PISTOL_STOCK.indexOf(i) !== -1) this.stock(slotId, 'pistol');
          }
        },

        // Long guns lie flat, in sockets rolled a quarter turn. The
        // shotgun's own holstered pose is barrel-down like everything
        // else; rolling the socket is what turns "hanging in a
        // bandolier" into "resting in a rack" without the gun being
        // told anything.
        buildLongGunCradles: function (face, iron) {
          var span = BAR_WIDTH - 0.7;
          var spacing = span / (ARMORY_CRADLES - 1);
          this.cradleX = {};

          for (var i = 0; i < ARMORY_CRADLES; i++) {
            var x = -span / 2 + i * spacing;
            if (ARMORY_CRADLE_STOCK[i]) this.cradleX[ARMORY_CRADLE_STOCK[i]] = x;
            this.addBox(0.05, 0.09, 0.13, { x: x - 0.34, y: ARMORY_CRADLE_Y - 0.02, z: ARMORY_CRADLE_Z + 0.02 }, iron, face);
            this.addBox(0.05, 0.09, 0.13, { x: x + 0.42, y: ARMORY_CRADLE_Y - 0.02, z: ARMORY_CRADLE_Z + 0.02 }, iron, face);

            var slotId = this.addSlot(
              { x: x, y: ARMORY_CRADLE_Y, z: ARMORY_CRADLE_Z },
              'large',
              {},
              face,
              { x: 0, y: 0, z: 90 }
            );
            if (ARMORY_CRADLE_STOCK[i]) this.stock(slotId, ARMORY_CRADLE_STOCK[i]);
          }
        },

        // A trough of arrows along the front of the bench. They lie
        // flat rather than standing in a barrel, and that isn't
        // decoration: an arrow stood on end here is nearly two metres
        // of drum, and the whole thing has to pass under your chin
        // (see THE REVOLVING BAR). One socket with room for five and
        // the usual fan, which is all a quiver has ever been.
        buildQuiver: function (face, iron) {
          // Under the bow, not at the far end of the bench. Ammunition
          // you have to go and find is ammunition you don't load.
          var x = (this.cradleX && this.cradleX.bow !== undefined ? this.cradleX.bow : ARMORY_QUIVER_X) - 0.3;
          this.addBox(0.72, 0.03, 0.09, { x: x + 0.31, y: BAR_TOP_Y + 0.015, z: ARMORY_QUIVER_Z }, '#5b3a29', face);
          this.addBox(0.05, 0.06, 0.11, { x: x, y: BAR_TOP_Y + 0.03, z: ARMORY_QUIVER_Z }, iron, face);
          this.addBox(0.05, 0.06, 0.11, { x: x + 0.6, y: BAR_TOP_Y + 0.03, z: ARMORY_QUIVER_Z }, iron, face);

          var slotId = this.addSlot(
            { x: x, y: BAR_TOP_Y + 0.05, z: ARMORY_QUIVER_Z },
            'small',
            { capacity: ARMORY_ARROWS, fanSpread: 0.03, fanYaw: 0 },
            face,
            { x: 0, y: 90, z: 0 } // turned, so they lie along the bench instead of pointing off the end of it
          );
          this.stock(slotId, 'arrow');
        },

        // A low shelf under the bench, with a crate of dynamite at each
        // end and empty sockets between them. The crate is nothing but
        // a box behind a slot with a capacity of three: the fan that
        // spreads five cigars across your teeth is what makes a bundle
        // of sticks read as a bundle.
        buildAmmoShelf: function (face, iron) {
          this.addBox(BAR_WIDTH - 0.3, 0.05, 0.16, { x: 0, y: ARMORY_SHELF_Y, z: ARMORY_SHELF_Z }, iron, face);

          var self = this;
          var launcherX = this.cradleX && this.cradleX.launcher !== undefined ? this.cradleX.launcher : 1.28;
          [
            { x: -1.28, item: 'dynamite', capacity: ARMORY_DYNAMITE_PER_CRATE },
            { x: launcherX, item: 'rocket', capacity: ARMORY_ROCKETS },
          ].forEach(function (crate) {
            self.addBox(0.24, 0.14, 0.13, { x: crate.x, y: ARMORY_SHELF_Y + 0.095, z: ARMORY_SHELF_Z }, '#5b3a29', face);
            var slotId = self.addSlot(
              { x: crate.x, y: ARMORY_SHELF_Y + 0.12, z: ARMORY_SHELF_Z },
              'small',
              { capacity: crate.capacity, fanSpread: 0.07, fanYaw: 9 },
              face
            );
            self.stock(slotId, crate.item);
          });

          // The pack sits in the middle of the shelf, which is where a
          // pack sits. The free sockets move aside for it.
          var tankSlot = this.addSlot(
            { x: 0, y: ARMORY_SHELF_Y + 0.2, z: ARMORY_SHELF_Z },
            'large',
            {},
            face
          );
          this.stock(tankSlot, 'tank');

          ARMORY_SHELF_SOCKET_X.forEach(function (x) {
            this.addSlot({ x: x, y: ARMORY_SHELF_Y + 0.03, z: ARMORY_SHELF_Z }, 'medium', {}, face);
          }, this);
        },

        // ============================================================
        // THE WARDROBE SIDE
        // A mirror of the bar/armoury above in every sense: same wall,
        // same shelves, same counter-block, same two-faces-on-a-drum
        // trick — just underneath instead of beside, and built for
        // clothes instead of guns. See the class comment for why
        // reusing the bar's own numbers (BAR_WIDTH, BAR_TOP_Y, etc.)
        // is what makes this land in the right spot with no new math.
        // ============================================================
        buildWardrobeRoom: function () {
          var self = this;
          this.addBox(BAR_WIDTH + 1.6, 3, 0.12, { x: 0, y: 1.5, z: SHELF_Z + 0.35 }, '#3f3348', this.wardrobeRoomEl);
          SHELF_HEIGHTS.forEach(function (y) {
            self.addBox(BAR_WIDTH - 0.4, 0.06, 0.28, { x: 0, y: y, z: SHELF_Z }, '#6b5a7a', self.wardrobeRoomEl);
          });
          this.buildWardrobeShelfSlots();
        },

        // Empty display sockets on the high shelves, same layout the
        // bar's own bottles use (see buildShelfBottles) but bare —
        // nothing to put on display up here yet.
        buildWardrobeShelfSlots: function () {
          var self = this;
          var spacing = (BAR_WIDTH - 0.8) / (SHELF_BOTTLES_PER_ROW - 1);
          SHELF_HEIGHTS.forEach(function (y) {
            for (var i = 0; i < SHELF_BOTTLES_PER_ROW; i++) {
              self.addSlot(
                { x: -(BAR_WIDTH - 0.8) / 2 + i * spacing, y: y + 0.03, z: SHELF_Z },
                'small',
                {},
                self.wardrobeRoomEl
              );
            }
          });
        },

        // The counter block itself — same spine-and-two-end-caps shape
        // as buildDrum, just recoloured. No HARD_SURFACES entry: that
        // exists purely for the bottle-cap-crack move (see buildDrum's
        // own comment), and nothing here needs it.
        buildWardrobeDrum: function () {
          var bodyH = BAR_TOP_Y - 0.07;
          var bodyY = bodyH / 2;

          this.addBox(BAR_WIDTH, 0.07, BAR_DEPTH + 0.08, { x: 0, y: BAR_TOP_Y - 0.035, z: BAR_PIVOT_Z }, '#5a4a6b', this.wardrobeDrumEl);
          this.addBox(BAR_WIDTH, bodyH, 0.14, { x: 0, y: bodyY, z: BAR_PIVOT_Z }, '#453a52', this.wardrobeDrumEl);
          this.addBox(0.05, bodyH, BAR_DEPTH, { x: -(BAR_WIDTH / 2 - 0.025), y: bodyY, z: BAR_PIVOT_Z }, '#453a52', this.wardrobeDrumEl);
          this.addBox(0.05, bodyH, BAR_DEPTH, { x: BAR_WIDTH / 2 - 0.025, y: bodyY, z: BAR_PIVOT_Z }, '#453a52', this.wardrobeDrumEl);
        },

        // The near face: the mirror dead center (see boxy-mirror and
        // MIRROR constants), a column of hat peg + belt hook either
        // side of it (one of each already stocked, the rest bare —
        // see STOCK AND PERISHING), and a scatter of small/large
        // sockets filling out the rest of the panel. Built taller than
        // the bar's own front panel (WARDROBE_FRONT_HEIGHT vs bodyH) —
        // this was sized for a mirror and rows of pegs, not a gun
        // counter.
        buildWardrobeFaceA: function () {
          var self = this;
          var face = this.wardrobeFaceAEl;
          var iron = '#5a4a6b';

          this.addBox(
            BAR_WIDTH - 0.1,
            WARDROBE_FRONT_HEIGHT,
            0.05,
            { x: 0, y: WARDROBE_FRONT_HEIGHT / 2, z: BAR_NEAR_EDGE_Z + 0.025 },
            '#4a3b52',
            face
          );

          // Set back from the panel's own front face by a real margin
          // — see the z-fighting note on the earlier draft of this
          // mirror mount, which undershot this and got a flickering
          // crescent instead of a clean ring.
          var mirror = document.createElement('a-entity');
          mirror.setAttribute('boxy-mirror', '');
          mirror.setAttribute('position', this.localTo(face, { x: 0, y: 1.2, z: BAR_NEAR_EDGE_Z - 0.03 }));
          face.appendChild(mirror);

          var pegHeight = 0.12;
          var hookDepth = 0.08;
          var hatY = 1.75;
          var beltY = 0.65;
          var columnXs = [-1.3, -0.65, 0.65, 1.3]; // clear of the mirror's own 0.35 radius either side

          columnXs.forEach(function (x, i) {
            self.addBox(
              0.02,
              pegHeight,
              0.02,
              { x: x, y: hatY - 0.06, z: BAR_NEAR_EDGE_Z - 0.02 },
              iron,
              face,
              { x: -25, y: 0, z: 0 }
            );
            // Tipped steeply forward, same trick as the original
            // wardrobe draft: a hat's own "sitting flat" holsterRotation
            // hangs down off the peg's end this way instead of floating
            // flat in space beside it.
            var hatSlotId = self.addSlot(
              { x: x, y: hatY, z: BAR_NEAR_EDGE_Z - 0.05 },
              'medium',
              {},
              face,
              { x: -80, y: 0, z: 0 }
            );
            if (i === 0) self.stock(hatSlotId, 'hat-tan');

            self.addBox(0.02, 0.02, hookDepth, { x: x, y: beltY, z: BAR_NEAR_EDGE_Z - hookDepth / 2 }, iron, face);
            // Rolled 90°, same reason: a belt's flat "wrapped around a
            // waist" ring hangs as a vertical loop off the hook this way.
            var beltSlotId = self.addSlot(
              { x: x, y: beltY, z: BAR_NEAR_EDGE_Z - hookDepth },
              'medium',
              {},
              face,
              { x: 0, y: 0, z: 90 }
            );
            if (i === 0) self.stock(beltSlotId, 'belt-silver');
          });

          // Bare for now (see STOCK AND PERISHING) — future small
          // things (pins, glasses) low across the panel, future large
          // things (coats, ponchos) either side of the mirror.
          [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5].forEach(function (x) {
            self.addSlot({ x: x, y: 0.3, z: BAR_NEAR_EDGE_Z - 0.02 }, 'small', {}, face);
          });
          [-1.0, 1.0].forEach(function (x) {
            self.addSlot({ x: x, y: 1.2, z: BAR_NEAR_EDGE_Z - 0.02 }, 'large', {}, face);
          });
        },

        // The far face: no mirror here, just a dense, mixed-size grid
        // of bare sockets — structure only for now, exactly the ask.
        // Same panel height as the front face, same reasoning.
        buildWardrobeFaceB: function () {
          var self = this;
          var face = this.wardrobeFaceBEl;
          var iron = '#5a4a6b';

          this.addBox(
            BAR_WIDTH - 0.1,
            WARDROBE_FRONT_HEIGHT,
            0.05,
            { x: 0, y: WARDROBE_FRONT_HEIGHT / 2, z: BAR_NEAR_EDGE_Z + 0.025 },
            '#3f3348',
            face
          );

          var cols = [-1.4, -0.8, -0.2, 0.4, 1.0, 1.6];
          var rows = [
            { y: 1.7, size: 'small' },
            { y: 1.2, size: 'medium' },
            { y: 0.7, size: 'medium' },
            { y: 0.25, size: 'small' },
          ];
          rows.forEach(function (row) {
            cols.forEach(function (x) {
              self.addBox(0.02, 0.02, 0.05, { x: x, y: row.y, z: BAR_NEAR_EDGE_Z - 0.03 }, iron, face);
              self.addSlot({ x: x, y: row.y, z: BAR_NEAR_EDGE_Z - 0.05 }, row.size, {}, face);
            });
          });

          // A couple of large sockets for bigger future things —
          // coats, costume pieces — off in the corners.
          [-1.7, 1.7].forEach(function (x) {
            self.addSlot({ x: x, y: 1.0, z: BAR_NEAR_EDGE_Z - 0.02 }, 'large', {}, face);
          });
        },
      });
