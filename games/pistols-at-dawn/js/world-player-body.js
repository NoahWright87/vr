      // ==============================================================
      // WORLD: player body
      // The player's own visible body (boxy-ghost) and the cowboy hat
      // (boxy-hat) it can wear. Split out of game.js — see DESIGN.md's
      // "File structure" section. Note GHOST_RADIUS is also read by
      // core-equip.js's boxy-belt (a worn belt matches the ghost's own
      // pill radius) — fine since every script here only runs inside
      // component init()/tick() callbacks, which fire after every
      // <script> on the page has finished loading, regardless of order.
      // ==============================================================

      var GHOST_RADIUS = 0.16; // meters — the pill's constant radius, and the dome's own radius
      var GHOST_TOP_Y = 0.1; // meters above the camera — matches head-anchor, so the dome just intersects the hat
      var GHOST_FRONT_Z = 0.03; // meters behind the camera that the front surface sits — see comment above
      var GHOST_COLOR = '#f5f3ee';
      var GHOST_OPACITY = 0.88;
      var EYE_COLOR = '#1a1a1a';
      var EYE_RADIUS = 0.02;
      var EYE_SPACING = 0.045; // meters, left/right from center
      var EYE_DROP = 0.05; // meters below GHOST_TOP_Y

      // BODY LENGTH — CYLINDER_HEIGHT is how far the straight pill body
      // runs before the skirt starts. 0.8m is picked so a worn belt
      // (see BELT/WARDROBE below), riding the waist anchor at
      // HIP_HEIGHT, lands at roughly that same seam for an average
      // ~1.6-1.7m standing eye height — the belt reading as part of
      // the body rather than floating at some unrelated height.
      var CYLINDER_HEIGHT = 0.8;
      var SKIRT_HEIGHT = 0.2; // meters the wavy points hang below the cylinder's bottom rim
      var SKIRT_TEETH = 6;
      // ==============================================================
      // COMPONENT: boxy-hat
      // A simple cowboy hat: a wide flat brim plus a cylindrical crown,
      // built the same "very simple, boxy" way as boxy-gun. The one
      // thing that isn't simple: unlike boxy-gun (whose origin already
      // sits at a natural grip point, the trigger guard), this hat's
      // true geometric center is offset from its own entity origin by
      // -innerRadius on local X. The origin instead sits at one point
      // along the inner rim of the head-hole — as if a finger were
      // hooked under that one edge, rather than the hat balanced
      // centered on a fingertip. That's the whole trick behind "spin
      // axis like your finger's in the hat, offset to one side": since
      // holsterable's dangle physics always pivots around the entity
      // origin, putting the origin there directly (instead of at the
      // hat's middle) is all it takes — no hat-specific physics code.
      //
      // Because of that offset, holsterable's holsterPosition (set in
      // markup) has to counter it by +innerRadius so the hat renders
      // centered on your head when worn rather than shifted to one
      // side. innerRadius/crownHeight here need to stay in sync with
      // the holsterPosition/comOffset numbers on the hat entity in
      // markup — there's no shared constant linking them, the same way
      // boxy-gun's part dimensions and pistol's comOffset/heldRotation
      // are already just kept consistent by hand.
      // ==============================================================
      registerComponent('boxy-hat', {
        schema: {
          felt: { type: 'string', default: '#2b2320' },
          band: { type: 'string', default: '#5b3a29' },
        },

        init: function () {
          var el = this.el;
          var felt = this.data.felt;
          var band = this.data.band;

          var innerRadius = 0.11; // crown radius / head-hole size
          var crownHeight = 0.13;
          var brimRadius = 0.24;
          var brimThickness = 0.015;
          var cx = -innerRadius; // local x of the hat's true center, relative to the rim point the origin sits at

          var brim = document.createElement('a-cylinder');
          brim.setAttribute('radius', brimRadius);
          brim.setAttribute('height', brimThickness);
          brim.setAttribute('color', felt);
          brim.setAttribute('position', { x: cx, y: 0, z: 0 });
          el.appendChild(brim);

          var crown = document.createElement('a-cylinder');
          crown.setAttribute('radius', innerRadius);
          crown.setAttribute('height', crownHeight);
          crown.setAttribute('color', felt);
          crown.setAttribute('position', { x: cx, y: crownHeight / 2, z: 0 });
          el.appendChild(crown);

          var hatBand = document.createElement('a-cylinder');
          hatBand.setAttribute('radius', innerRadius + 0.004);
          hatBand.setAttribute('height', 0.03);
          hatBand.setAttribute('color', band);
          hatBand.setAttribute('position', { x: cx, y: 0.02, z: 0 });
          el.appendChild(hatBand);

          // A small slot tucked inside the crown's hollow interior —
          // "hide a gun in your hat." Positioned at the crown's true
          // center (cx), not the entity's own rim-edge origin, and
          // low enough to read as sitting down inside the hollow
          // rather than floating above the brim. Being a plain DOM/
          // object3D child of this entity, it automatically follows
          // the hat wherever holsterable reparents it — held, worn,
          // dangling, or resting — with no extra tracking code.
          var innerSlot = document.createElement('a-entity');
          innerSlot.classList.add('anchor-slot');
          innerSlot.setAttribute('anchor-slot', 'size: small');
          innerSlot.setAttribute('position', { x: cx, y: crownHeight * 0.35, z: 0 });
          el.appendChild(innerSlot);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-ghost
      // The player's own body: Pac-Man-ghost simple, on purpose (see
      // the GHOST BODY / BODY LENGTH + BELT constants above for the
      // reasoning behind the exact numbers). A dome, a constant-radius
      // "pill" body (not tapering — see those comments for why), two
      // eyes, and a wavy skirt of pointed teeth around the bottom rim.
      //
      // No belt here any more — the real, swappable one (see `belt`)
      // rides the waist anchor at roughly this same seam height,
      // yaw-tracked rather than camera-child like the rest of this
      // shape (the same everywhere-else-in-the-file tension the hat
      // and the yaw-tracked back/waist anchors already have).
      //
      // Nested directly under the camera in markup (like the hat, not
      // like the yaw-only-tracked waist/back anchors) so it inherits
      // full head rotation for free — there's no separate torso to
      // keep upright independently of your head any more.
      // ==============================================================
      registerComponent('boxy-ghost', {
        init: function () {
          var el = this.el;
          var axisZ = GHOST_FRONT_Z + GHOST_RADIUS; // the shape's central vertical axis — every piece below is positioned relative to this, not to GHOST_FRONT_Z directly, so they stay concentric
          var seamY = GHOST_TOP_Y - CYLINDER_HEIGHT; // the pill/skirt seam

          function primitive(tag, attrs) {
            var e = document.createElement(tag);
            for (var key in attrs) e.setAttribute(key, attrs[key]);
            el.appendChild(e);
            return e;
          }

          // The dome — same radius as the pill so it caps it without a
          // visible step.
          primitive('a-sphere', {
            radius: GHOST_RADIUS,
            color: GHOST_COLOR,
            opacity: GHOST_OPACITY,
            transparent: true,
            position: { x: 0, y: GHOST_TOP_Y, z: axisZ },
          });

          // The straight "pill" body, constant radius all the way down
          // to the skirt seam.
          primitive('a-cylinder', {
            radius: GHOST_RADIUS,
            height: CYLINDER_HEIGHT,
            color: GHOST_COLOR,
            opacity: GHOST_OPACITY,
            transparent: true,
            position: { x: 0, y: GHOST_TOP_Y - CYLINDER_HEIGHT / 2, z: axisZ },
          });

          // Eyes sit right at the front clearance plane, a hair ahead
          // of the dome's own surface so they don't z-fight with it.
          [-1, 1].forEach(function (side) {
            primitive('a-sphere', {
              radius: EYE_RADIUS,
              color: EYE_COLOR,
              position: { x: side * EYE_SPACING, y: GHOST_TOP_Y - EYE_DROP, z: GHOST_FRONT_Z - 0.01 },
            });
          });

          // The wavy skirt: SKIRT_TEETH small cones fanned around the
          // bottom rim, each tapering to a point SKIRT_HEIGHT below the
          // seam. a-cone's radiusTop sits at its own local +Y and
          // radiusBottom at -Y, so radiusBottom: 0 alone gives a
          // downward-pointing tooth with no extra rotation needed.
          // toothRadius is sized a bit past exact edge-to-edge spacing
          // so adjacent teeth overlap slightly rather than leaving gaps.
          var toothChord = GHOST_RADIUS * Math.sin(Math.PI / SKIRT_TEETH);
          var toothRadius = toothChord * 1.3;
          for (var i = 0; i < SKIRT_TEETH; i++) {
            var angle = (i / SKIRT_TEETH) * Math.PI * 2;
            primitive('a-cone', {
              'radius-top': toothRadius,
              'radius-bottom': 0,
              height: SKIRT_HEIGHT,
              color: GHOST_COLOR,
              opacity: GHOST_OPACITY,
              transparent: true,
              position: {
                x: Math.sin(angle) * GHOST_RADIUS,
                y: seamY - SKIRT_HEIGHT / 2,
                z: axisZ + Math.cos(angle) * GHOST_RADIUS,
              },
            });
          }
        },
      });

      // buildHat + the hat-tan item-maker recipe — boxy-hat's own
      // wardrobe-stocked variant, left behind in game.js during the
      // original split, moved here on a later pass.
      // A wardrobe hat variant. Same holsterable numbers as the
      // original hat declared directly in markup (head-anchor's own
      // holsterPosition/heldPosition/comOffset have to agree with
      // boxy-hat's innerRadius offset — see that component's own
      // comment) — just built through the item-maker path instead so a
      // wardrobe peg can produce copies, with a different felt/band.
      function buildHat(el, slotId, felt, band) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'medium',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: 90, y: 0, z: 0 },
          holsterPosition: { x: 0.11, y: 0, z: 0 },
          heldPosition: { x: -0.1, y: 0, z: 0 },
          grabRadius: 0.35,
          comOffset: { x: 0.11, y: -0.065, z: 0 },
        });
        el.setAttribute('boxy-hat', { felt: felt, band: band });
      }

      defineItem(
        'hat-tan',
        function (el, slotId) {
          buildHat(el, slotId, '#c9a86a', '#6b4a2f');
        },
        { keep: true }
      );
