      // ==============================================================
      // WORLD: stable
      // The town's fourth stop: an open-fronted shed of horse stalls,
      // each with a pile of hay in it. No horses yet — this is the
      // "just a place" stage the farm and saloon both started at too;
      // see world-farm.js's own header for that pattern.
      //
      // The roof is buildGableRoof (world-structures.js), the same
      // function the farm's barn uses. Everything else here — the
      // stall dividers, the floor patch, the hay — is specific to this
      // location.
      // ==============================================================

      // BUILDING — a row of stalls, axis-aligned, open on the south
      // (entry-facing) side. Sized and positioned close to the landing
      // point on purpose (see the saloon's own note about real
      // room-scale guardians being small) — there's nothing here that
      // needs walking to, just stalls to look into from just inside the
      // opening.
      var STABLE_STALL_COUNT = 4;
      var STABLE_STALL_WIDTH = 2.4;
      var STABLE_STALL_DEPTH = 3;
      var STABLE_BUILDING_WIDTH = STABLE_STALL_COUNT * STABLE_STALL_WIDTH;
      var STABLE_FRONT_Z = -2; // open face — two steps in from where the player lands
      var STABLE_BACK_Z = STABLE_FRONT_Z - STABLE_STALL_DEPTH;
      var STABLE_CENTER_Z = (STABLE_FRONT_Z + STABLE_BACK_Z) / 2; // depth-center — buildGableRoof (world-structures.js) expects its parent's local z=0 to be the ridge line, so everything roofed lives in a sub-entity positioned here rather than at this file's landing-point origin

      var STABLE_DIVIDER_HEIGHT = 1.3; // chest height — low enough to see every stall from the doorway
      var STABLE_DIVIDER_THICKNESS = 0.1;
      var STABLE_BACK_WALL_HEIGHT = 2.6; // the roof rides on this; the open front's eave floats at the same height, same as the farm barn's doorless face
      var STABLE_WOOD_COLOR = '#7a5a3a';
      var STABLE_FLOOR_COLOR = '#8a7355'; // dirt-and-straw patch, distinct from the grass around it
      var STABLE_FLOOR_MARGIN = 2.5;
      var STABLE_WOOD_TEXTURE = 'assets/textures/western-wood-planks-v1.png';
      var STABLE_FLOOR_TEXTURE = 'assets/textures/stable-dirt-straw-v1.png';
      var STABLE_ROOF_TEXTURE = 'assets/textures/weathered-roof-shingles-v1.png';

      var STABLE_ROOF_COLOR = '#4a3f38';
      var STABLE_ROOF_PITCH_DEG = 25; // shallower than the barn's — a plain shed roof, not a statement piece
      var STABLE_ROOF_THICKNESS = 0.1;
      var STABLE_ROOF_OVERHANG = 0.5; // generous on purpose: the front wall is missing, so the overhang is the only thing keeping weather off the open stalls

      // HAY — one pile per stall: a flattened sphere for the mound plus
      // a handful of thin, randomly-angled boxes for loose strands. Not
      // deterministic (Math.random() per wisp) — purely decorative, so
      // nothing downstream reads or depends on the exact shape.
      var HAY_COLOR = '#c9a227';
      var HAY_WISP_COLOR = '#d9bd4a';
      var HAY_MOUND_RADIUS = 0.4;
      var HAY_MOUND_SQUASH = 0.55; // y-scale — flattens the sphere into a mound instead of a ball
      var HAY_WISP_COUNT = 5;
      var HAY_WISP_LENGTH = 0.35;

      // ==============================================================
      // COMPONENT: stable
      // Finds wherever TOWN_LOCATIONS put "the stable" (world-town.js)
      // and builds it there: floor, stall dividers + back wall, the
      // shared roof, and a hay pile in each stall.
      // ==============================================================
      registerComponent('stable', {
        init: function () {
          var origin = findTownLocation('stable');
          if (origin) this.el.setAttribute('position', origin.position);

          this.buildFloor();
          this.buildStalls();
          this.buildHay();
        },

        buildFloor: function () {
          var floor = document.createElement('a-plane');
          floor.setAttribute('rotation', '-90 0 0');
          floor.setAttribute('width', STABLE_BUILDING_WIDTH + STABLE_FLOOR_MARGIN * 2);
          floor.setAttribute('height', STABLE_STALL_DEPTH + STABLE_FLOOR_MARGIN * 2);
          floor.setAttribute('position', { x: 0, y: 0.002, z: (STABLE_FRONT_Z + STABLE_BACK_Z) / 2 });
          floor.setAttribute('color', STABLE_FLOOR_COLOR);
          floor.setAttribute('material', { src: STABLE_FLOOR_TEXTURE, repeat: '7 5', color: '#ffffff', shader: 'flat' });
          this.el.appendChild(floor);
        },

        buildStalls: function () {
          // Everything roofed — walls, dividers, roof — lives in this
          // sub-entity, positioned so its own local z=0 lands exactly on
          // the stall row's depth-center. buildHay reuses it for the
          // same reason (see STABLE_CENTER_Z's comment).
          var building = document.createElement('a-entity');
          building.setAttribute('position', { x: 0, y: 0, z: STABLE_CENTER_Z });
          this.el.appendChild(building);
          this.buildingEl = building;

          var halfWidth = STABLE_BUILDING_WIDTH / 2;
          var halfDepth = STABLE_STALL_DEPTH / 2;

          var back = document.createElement('a-box');
          back.setAttribute('width', STABLE_BUILDING_WIDTH);
          back.setAttribute('height', STABLE_BACK_WALL_HEIGHT);
          back.setAttribute('depth', 0.15);
          back.setAttribute('position', { x: 0, y: STABLE_BACK_WALL_HEIGHT / 2, z: -halfDepth });
          back.setAttribute('color', STABLE_WOOD_COLOR);
          back.setAttribute('material', { src: STABLE_WOOD_TEXTURE, repeat: '5 2', color: '#ffffff', shader: 'flat' });
          building.appendChild(back);

          // Dividers: one more than the stall count, since two stalls
          // share every interior divider and the row needs an outer
          // wall on each end too.
          for (var i = 0; i <= STABLE_STALL_COUNT; i++) {
            var divider = document.createElement('a-box');
            divider.setAttribute('width', STABLE_DIVIDER_THICKNESS);
            divider.setAttribute('height', STABLE_DIVIDER_HEIGHT);
            divider.setAttribute('depth', STABLE_STALL_DEPTH);
            divider.setAttribute('position', {
              x: -halfWidth + i * STABLE_STALL_WIDTH,
              y: STABLE_DIVIDER_HEIGHT / 2,
              z: 0,
            });
            divider.setAttribute('color', STABLE_WOOD_COLOR);
            divider.setAttribute('material', { src: STABLE_WOOD_TEXTURE, repeat: '1 2', color: '#ffffff', shader: 'flat' });
            building.appendChild(divider);
          }

          buildGableRoof(building, {
            width: STABLE_BUILDING_WIDTH,
            depth: STABLE_STALL_DEPTH,
            wallHeight: STABLE_BACK_WALL_HEIGHT,
            pitchDeg: STABLE_ROOF_PITCH_DEG,
            color: STABLE_ROOF_COLOR,
            texture: STABLE_ROOF_TEXTURE,
            textureRepeat: '5 2',
            thickness: STABLE_ROOF_THICKNESS,
            overhang: STABLE_ROOF_OVERHANG,
          });
        },

        buildHay: function () {
          var building = this.buildingEl;
          var halfWidth = STABLE_BUILDING_WIDTH / 2;
          var halfDepth = STABLE_STALL_DEPTH / 2;

          for (var i = 0; i < STABLE_STALL_COUNT; i++) {
            var stallX = -halfWidth + STABLE_STALL_WIDTH * (i + 0.5);
            var stallZ = -halfDepth + STABLE_STALL_DEPTH * 0.35; // toward the back of the stall, building-local frame
            this.buildHayPile(building, stallX, stallZ);
          }
        },

        buildHayPile: function (parentEl, x, z) {
          var mound = document.createElement('a-sphere');
          mound.setAttribute('radius', HAY_MOUND_RADIUS);
          mound.setAttribute('color', HAY_COLOR);
          mound.setAttribute('scale', { x: 1, y: HAY_MOUND_SQUASH, z: 1 });
          mound.setAttribute('position', { x: x, y: HAY_MOUND_RADIUS * HAY_MOUND_SQUASH, z: z });
          parentEl.appendChild(mound);

          for (var i = 0; i < HAY_WISP_COUNT; i++) {
            var wisp = document.createElement('a-box');
            wisp.setAttribute('width', 0.02);
            wisp.setAttribute('height', 0.02);
            wisp.setAttribute('depth', HAY_WISP_LENGTH);
            wisp.setAttribute('color', HAY_WISP_COLOR);
            wisp.setAttribute('position', {
              x: x + (Math.random() - 0.5) * HAY_MOUND_RADIUS,
              y: HAY_MOUND_RADIUS * HAY_MOUND_SQUASH * 0.7,
              z: z + (Math.random() - 0.5) * HAY_MOUND_RADIUS,
            });
            wisp.setAttribute('rotation', {
              x: (Math.random() - 0.5) * 60,
              y: Math.random() * 360,
              z: 70 + (Math.random() - 0.5) * 30,
            });
            parentEl.appendChild(wisp);
          }
        },
      });
