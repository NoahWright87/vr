      // ==============================================================
      // WORLD: farm
      // The town's third stop: a big open square yard marked off by a
      // picket fence, with a barn along its far edge. Purely scenic for
      // now — no props, no game — the same way a new town location
      // starts as just a place before it gets a reason to visit, the
      // way the saloon's own room existed before darts got built into
      // it. Reachable via teleport-hub (world-town.js); see farm's own
      // init() for how it finds where to build itself.
      //
      // The barn's roof is buildGableRoof from world-structures.js —
      // shared with the stable rather than duplicated here. Everything
      // else (the yard, the fence, the barn itself) is specific to this
      // one location.
      // ==============================================================

      // YARD — a 20x20m square, axis-aligned in this room's own local
      // frame. The player lands at local (0,0,0), just outside the
      // south fence line, facing the gate and the barn beyond — same
      // "land right where the thing you came for is" idea as the
      // saloon's dart racks, just for looking at rather than reaching.
      var FARM_YARD_MIN_X = -10;
      var FARM_YARD_MAX_X = 10;
      var FARM_YARD_SOUTH_Z = -1; // gate line, one step in front of where the player lands
      var FARM_YARD_NORTH_Z = -21; // far fence, 20m deep yard
      var FARM_GATE_WIDTH = 3; // gap in the south fence, centered on x=0
      var FARM_GROUND_COLOR = '#4f7a3d';
      var FARM_GROUND_TEXTURE = 'assets/textures/farm-grass-ground-v1.png';
      // The source tile is deliberately small-scale: repeating it here lets
      // the grass stay readable at VR standing distance across the whole yard.
      var FARM_GROUND_TEXTURE_REPEAT = '12 12';
      var FARM_WOOD_TEXTURE = 'assets/textures/western-wood-planks-v1.png';
      var FARM_BARN_SIDING_TEXTURE = 'assets/textures/barn-red-siding-v1.png';
      var FARM_ROOF_TEXTURE = 'assets/textures/weathered-roof-shingles-v1.png';
      var FARM_FENCE_TEXTURE = 'assets/textures/weathered-white-fence-v1.png';
      var FARM_GROUND_MARGIN = 3; // meters the grass patch extends past the fence on every side, so the fence doesn't look like it's floating at the edge of a color change

      // FENCE — plain axis-aligned picket runs. Real picket spacing
      // (~5-10cm) would be several hundred individual entities for a
      // fence this long; 0.5m keeps the "row of white boards" read
      // without the entity count actually mattering to anything.
      var FENCE_PICKET_SPACING = 0.5;
      var FENCE_PICKET_WIDTH = 0.08;
      var FENCE_PICKET_THICKNESS = 0.03;
      var FENCE_PICKET_HEIGHT = 0.9;
      var FENCE_PICKET_COLOR = '#e8e2d0';
      var FENCE_RAIL_THICKNESS = 0.05;
      var FENCE_RAIL_HEIGHT = 0.08;
      var FENCE_RAIL_LOWER_Y = 0.25;
      var FENCE_RAIL_UPPER_Y = 0.62;
      var FENCE_POST_SIZE = 0.14; // gate posts — thicker than a picket so the entrance reads as an entrance
      var FENCE_POST_HEIGHT = 1.15;

      // BARN — centered on the yard's width, set back near the north
      // fence so there's open yard between the gate and the door.
      var FARM_BARN_WIDTH = 8;
      var FARM_BARN_DEPTH = 6;
      var FARM_BARN_WALL_HEIGHT = 4;
      var FARM_BARN_FRONT_Z = -13; // south (door) face — the wall facing the gate
      var FARM_BARN_CENTER_Z = FARM_BARN_FRONT_Z - FARM_BARN_DEPTH / 2;
      var FARM_BARN_WALL_COLOR = '#a13d2b';
      var FARM_BARN_TRIM_COLOR = '#f2ede0';
      var FARM_BARN_DOOR_COLOR = '#5c4230';
      var FARM_ROOF_COLOR = '#3a3f45';
      var FARM_ROOF_PITCH_DEG = 38;
      var FARM_ROOF_THICKNESS = 0.12;
      var FARM_ROOF_OVERHANG = 0.4; // meters the roof extends past the walls on every edge

      // ==============================================================
      // buildFenceRunAlongX / buildFenceRunAlongZ
      // One straight, axis-aligned run of pickets plus two horizontal
      // rails, from one point to another. Kept as two small functions
      // rather than one generic rotated version — every fence side in
      // a square yard is axis-aligned, so the rotation math a fully
      // generic version would need is complexity nothing here would
      // ever exercise.
      // ==============================================================
      function buildFenceRunAlongX(parentEl, x0, x1, z) {
        var length = x1 - x0;
        var count = Math.max(2, Math.round(length / FENCE_PICKET_SPACING) + 1);
        var step = length / (count - 1);

        for (var i = 0; i < count; i++) {
          var picket = document.createElement('a-box');
          picket.setAttribute('width', FENCE_PICKET_WIDTH);
          picket.setAttribute('height', FENCE_PICKET_HEIGHT);
          picket.setAttribute('depth', FENCE_PICKET_THICKNESS);
          picket.setAttribute('color', FENCE_PICKET_COLOR);
          picket.setAttribute('material', { src: FARM_FENCE_TEXTURE, repeat: '1 2', color: '#ffffff', shader: 'flat' });
          picket.setAttribute('position', { x: x0 + step * i, y: FENCE_PICKET_HEIGHT / 2, z: z });
          parentEl.appendChild(picket);
        }

        [FENCE_RAIL_LOWER_Y, FENCE_RAIL_UPPER_Y].forEach(function (y) {
          var rail = document.createElement('a-box');
          rail.setAttribute('width', length);
          rail.setAttribute('height', FENCE_RAIL_HEIGHT);
          rail.setAttribute('depth', FENCE_RAIL_THICKNESS);
          rail.setAttribute('color', FENCE_PICKET_COLOR);
          rail.setAttribute('material', { src: FARM_FENCE_TEXTURE, repeat: '4 1', color: '#ffffff', shader: 'flat' });
          rail.setAttribute('position', { x: (x0 + x1) / 2, y: y, z: z });
          parentEl.appendChild(rail);
        });
      }

      function buildFenceRunAlongZ(parentEl, z0, z1, x) {
        var length = z1 - z0;
        var count = Math.max(2, Math.round(length / FENCE_PICKET_SPACING) + 1);
        var step = length / (count - 1);

        for (var i = 0; i < count; i++) {
          var picket = document.createElement('a-box');
          picket.setAttribute('width', FENCE_PICKET_WIDTH);
          picket.setAttribute('height', FENCE_PICKET_HEIGHT);
          picket.setAttribute('depth', FENCE_PICKET_THICKNESS);
          picket.setAttribute('color', FENCE_PICKET_COLOR);
          picket.setAttribute('material', { src: FARM_FENCE_TEXTURE, repeat: '1 2', color: '#ffffff', shader: 'flat' });
          picket.setAttribute('position', { x: x, y: FENCE_PICKET_HEIGHT / 2, z: z0 + step * i });
          parentEl.appendChild(picket);
        }

        [FENCE_RAIL_LOWER_Y, FENCE_RAIL_UPPER_Y].forEach(function (y) {
          var rail = document.createElement('a-box');
          rail.setAttribute('width', length); // rotated below, so this "width" ends up running along world Z
          rail.setAttribute('height', FENCE_RAIL_HEIGHT);
          rail.setAttribute('depth', FENCE_RAIL_THICKNESS);
          rail.setAttribute('color', FENCE_PICKET_COLOR);
          rail.setAttribute('material', { src: FARM_FENCE_TEXTURE, repeat: '4 1', color: '#ffffff', shader: 'flat' });
          rail.setAttribute('rotation', '0 90 0');
          rail.setAttribute('position', { x: x, y: y, z: (z0 + z1) / 2 });
          parentEl.appendChild(rail);
        });
      }

      // ==============================================================
      // COMPONENT: farm
      // Finds wherever TOWN_LOCATIONS put "the farm" (see world-town.js)
      // and builds the yard there: ground, fence (with a gate gap on
      // the south/entry side), and the barn.
      // ==============================================================
      registerComponent('farm', {
        init: function () {
          var origin = findTownLocation('farm');
          if (origin) this.el.setAttribute('position', origin.position);

          this.buildGround();
          this.buildFence();
          this.buildBarn();
        },

        buildGround: function () {
          var ground = document.createElement('a-plane');
          ground.setAttribute('rotation', '-90 0 0');
          ground.setAttribute('width', FARM_YARD_MAX_X - FARM_YARD_MIN_X + FARM_GROUND_MARGIN * 2);
          ground.setAttribute('height', FARM_YARD_SOUTH_Z - FARM_YARD_NORTH_Z + FARM_GROUND_MARGIN * 2);
          ground.setAttribute('position', {
            x: (FARM_YARD_MIN_X + FARM_YARD_MAX_X) / 2,
            // 0.002, not 0 — the range's own ground plane is 160x160 at
            // the world origin (see index.html's RANGE comment), which
            // reaches this yard's position (world z 60) fine within
            // that. Coincident coplanar geometry z-fights; a hair of
            // clearance is cheaper than coordinating with a file this
            // one doesn't (and shouldn't) know about.
            y: 0.002,
            z: (FARM_YARD_SOUTH_Z + FARM_YARD_NORTH_Z) / 2,
          });
          ground.setAttribute('color', FARM_GROUND_COLOR);
          ground.setAttribute('material', {
            src: FARM_GROUND_TEXTURE,
            repeat: FARM_GROUND_TEXTURE_REPEAT,
            shader: 'flat',
          });
          this.el.appendChild(ground);
        },

        buildFence: function () {
          var el = this.el;
          var gateHalf = FARM_GATE_WIDTH / 2;

          // North side: unbroken. South side: split around the gate.
          buildFenceRunAlongX(el, FARM_YARD_MIN_X, FARM_YARD_MAX_X, FARM_YARD_NORTH_Z);
          buildFenceRunAlongX(el, FARM_YARD_MIN_X, -gateHalf, FARM_YARD_SOUTH_Z);
          buildFenceRunAlongX(el, gateHalf, FARM_YARD_MAX_X, FARM_YARD_SOUTH_Z);

          // East and west sides run the full depth, gate to back fence.
          buildFenceRunAlongZ(el, FARM_YARD_SOUTH_Z, FARM_YARD_NORTH_Z, FARM_YARD_MIN_X);
          buildFenceRunAlongZ(el, FARM_YARD_SOUTH_Z, FARM_YARD_NORTH_Z, FARM_YARD_MAX_X);

          // Gate posts: thicker/taller than a picket, flanking the gap
          // so the entrance reads as a deliberate opening rather than a
          // missing stretch of fence.
          [-gateHalf, gateHalf].forEach(function (x) {
            var post = document.createElement('a-box');
            post.setAttribute('width', FENCE_POST_SIZE);
            post.setAttribute('height', FENCE_POST_HEIGHT);
            post.setAttribute('depth', FENCE_POST_SIZE);
            post.setAttribute('color', FENCE_PICKET_COLOR);
            post.setAttribute('material', { src: FARM_FENCE_TEXTURE, repeat: '1 2', color: '#ffffff', shader: 'flat' });
            post.setAttribute('position', { x: x, y: FENCE_POST_HEIGHT / 2, z: FARM_YARD_SOUTH_Z });
            el.appendChild(post);
          });
        },

        buildBarn: function () {
          var barn = document.createElement('a-entity');
          barn.setAttribute('position', { x: 0, y: 0, z: FARM_BARN_CENTER_Z });
          this.el.appendChild(barn);

          var body = document.createElement('a-box');
          body.setAttribute('width', FARM_BARN_WIDTH);
          body.setAttribute('height', FARM_BARN_WALL_HEIGHT);
          body.setAttribute('depth', FARM_BARN_DEPTH);
          body.setAttribute('position', { x: 0, y: FARM_BARN_WALL_HEIGHT / 2, z: 0 });
          body.setAttribute('color', FARM_BARN_WALL_COLOR);
          body.setAttribute('material', { src: FARM_BARN_SIDING_TEXTURE, repeat: '4 2', color: '#ffffff', shader: 'flat' });
          barn.appendChild(body);

          // Trim board along the eaves — plain color break, no
          // geometry of its own, the cheapest way to keep the barn from
          // reading as one flat block of red.
          var trim = document.createElement('a-box');
          trim.setAttribute('width', FARM_BARN_WIDTH + 0.02);
          trim.setAttribute('height', 0.15);
          trim.setAttribute('depth', FARM_BARN_DEPTH + 0.02);
          trim.setAttribute('position', { x: 0, y: FARM_BARN_WALL_HEIGHT - 0.08, z: 0 });
          trim.setAttribute('color', FARM_BARN_TRIM_COLOR);
          barn.appendChild(trim);

          buildGableRoof(barn, {
            width: FARM_BARN_WIDTH,
            depth: FARM_BARN_DEPTH,
            wallHeight: FARM_BARN_WALL_HEIGHT,
            pitchDeg: FARM_ROOF_PITCH_DEG,
            color: FARM_ROOF_COLOR,
            texture: FARM_ROOF_TEXTURE,
            textureRepeat: '4 3',
            thickness: FARM_ROOF_THICKNESS,
            overhang: FARM_ROOF_OVERHANG,
          });

          // Double doors on the south (gate-facing) wall.
          var doorFaceZ = FARM_BARN_DEPTH / 2 + 0.03;
          var doorWidth = 1.4;
          var doorHeight = 2.6;
          [-1, 1].forEach(function (side) {
            var door = document.createElement('a-box');
            door.setAttribute('width', doorWidth);
            door.setAttribute('height', doorHeight);
            door.setAttribute('depth', 0.06);
            door.setAttribute('color', FARM_BARN_DOOR_COLOR);
            door.setAttribute('material', { src: FARM_WOOD_TEXTURE, repeat: '1 2', color: '#ffffff', shader: 'flat' });
            door.setAttribute('position', { x: (side * doorWidth) / 2, y: doorHeight / 2, z: doorFaceZ });
            barn.appendChild(door);
          });

          // Hayloft opening, high in the gable above the doors.
          var loft = document.createElement('a-box');
          loft.setAttribute('width', 1.0);
          loft.setAttribute('height', 1.0);
          loft.setAttribute('depth', 0.05);
          loft.setAttribute('color', '#2a1f18');
          loft.setAttribute('position', { x: 0, y: FARM_BARN_WALL_HEIGHT + 0.6, z: doorFaceZ });
          barn.appendChild(loft);
        },
      });
