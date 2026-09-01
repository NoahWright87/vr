      // ==============================================================
      // WORLD: saloon interior
      // The actual room behind Ghost Town's Saloon door. Darts remain
      // their own activity builder; this component supplies the shared
      // building and the everyday reasons to linger: bar, beer, tables,
      // chairs, piano nook, warm lights, and the way back to town.
      // ==============================================================

      var SALOON_WIDTH = 16;
      var SALOON_DEPTH = 16;
      var SALOON_HEIGHT = 4.2;
      var SALOON_WALL = '#4a3020';
      var SALOON_WOOD = '#6b4429';
      var SALOON_DARK_WOOD = '#392318';
      var SALOON_BRASS = '#a77e36';

      registerComponent('saloon-interior', {
        init: function () {
          var origin = findTownLocation('saloon');
          if (origin) this.el.setAttribute('position', origin.position);
          this.slotSerial = 0;
          this.buildRoom();
          this.buildWindows();
          this.buildBar();
          this.buildTables();
          this.buildPianoNook();
          this.buildExit();
          this.buildLights();
        },

        addBox: function (width, height, depth, position, color, parent) {
          var box = document.createElement('a-box');
          box.setAttribute('width', width);
          box.setAttribute('height', height);
          box.setAttribute('depth', depth);
          box.setAttribute('position', position);
          box.setAttribute('color', color);
          (parent || this.el).appendChild(box);
          return box;
        },

        buildRoom: function () {
          var halfWidth = SALOON_WIDTH / 2;
          var halfDepth = SALOON_DEPTH / 2;
          var floor = document.createElement('a-plane');
          floor.setAttribute('rotation', '-90 0 0');
          floor.setAttribute('width', SALOON_WIDTH);
          floor.setAttribute('height', SALOON_DEPTH);
          floor.setAttribute('position', { x: 0, y: 0.002, z: 0 });
          floor.setAttribute('color', '#76573a');
          this.el.appendChild(floor);

          this.addBox(SALOON_WIDTH, SALOON_HEIGHT, 0.22, { x: 0, y: SALOON_HEIGHT / 2, z: -halfDepth }, SALOON_WALL);
          this.addBox(0.22, SALOON_HEIGHT, SALOON_DEPTH, { x: -halfWidth, y: SALOON_HEIGHT / 2, z: 0 }, SALOON_WALL);
          this.addBox(0.22, SALOON_HEIGHT, SALOON_DEPTH, { x: halfWidth, y: SALOON_HEIGHT / 2, z: 0 }, SALOON_WALL);

          // The front wall is split around the exit so it reads as a real
          // doorway while still leaving the interior light and open.
          this.addBox(6.2, SALOON_HEIGHT, 0.22, { x: -4.9, y: SALOON_HEIGHT / 2, z: halfDepth }, SALOON_WALL);
          this.addBox(6.2, SALOON_HEIGHT, 0.22, { x: 4.9, y: SALOON_HEIGHT / 2, z: halfDepth }, SALOON_WALL);
          this.addBox(3.6, 1.25, 0.22, { x: 0, y: 3.58, z: halfDepth }, SALOON_WALL);
          this.addBox(SALOON_WIDTH, 0.18, SALOON_DEPTH, { x: 0, y: SALOON_HEIGHT, z: 0 }, '#2d1d15');
        },

        buildWindows: function () {
          var self = this;
          // Bright, double-sided panes make daylight legible even when the
          // room is seen from an oblique angle; nearby points give that
          // daylight actual reach across the furniture.
          [
            { x: -7.87, z: -3.8, rotation: 90 },
            { x: -7.87, z: 1.1, rotation: 90 },
            { x: -7.87, z: 5.2, rotation: 90 },
            { x: 7.87, z: 4.5, rotation: -90 },
          ].forEach(function (spot) {
            var pane = document.createElement('a-plane');
            pane.classList.add('saloon-window');
            pane.setAttribute('width', 2.1);
            pane.setAttribute('height', 1.35);
            pane.setAttribute('position', { x: spot.x, y: 2.65, z: spot.z });
            pane.setAttribute('rotation', { x: 0, y: spot.rotation, z: 0 });
            pane.setAttribute('material', 'color: #c6e6ef; shader: flat; transparent: true; opacity: 0.82; side: double');
            self.el.appendChild(pane);
            self.addBox(0.09, 1.55, 2.3, { x: spot.x * 0.997, y: 2.65, z: spot.z }, SALOON_WOOD);

            var windowLight = document.createElement('a-entity');
            windowLight.setAttribute('position', { x: spot.x * 0.91, y: 2.5, z: spot.z });
            windowLight.setAttribute('light', 'type: point; color: #b9d9e8; intensity: 0.65; distance: 8; decay: 1.2');
            self.el.appendChild(windowLight);
          });
        },

        addBottle: function (x, z, color) {
          var slotId = 'saloon-beer-slot-' + this.slotSerial++;
          var slot = document.createElement('a-entity');
          slot.setAttribute('id', slotId);
          slot.classList.add('anchor-slot');
          slot.setAttribute('anchor-slot', 'size: small');
          slot.setAttribute('position', { x: x, y: 1.12, z: z });
          slot.setAttribute('slot-reach-grab', '');
          slot.setAttribute(
            'hint-zone',
            'action: grab; radius: 0.34; maxReach: 1.0; gazeThreshold: 0.93; priority: 10; desktopKey: F; desktopLabel: Grab; xrKey: GRIP; xrLabel: Grab'
          );
          this.el.appendChild(slot);

          var bottle = document.createElement('a-entity');
          bottle.classList.add('grabbable', 'shootable');
          bottle.setAttribute('holsterable', {
            holsterSelector: '#' + slotId,
            itemSize: 'small',
            holsterPosition: { x: 0, y: -0.2225, z: 0 },
            heldRotation: { x: -90, y: 0, z: 0 },
            grabRadius: 0.16,
            comOffset: { x: 0, y: -0.12, z: 0 },
            gravityScale: 0.6,
            maxThrowSpeed: 15,
          });
          bottle.setAttribute('boxy-bottle', { glass: color });
          bottle.setAttribute('pourable', '');
          bottle.setAttribute('breakable', { color: color });
          this.el.appendChild(bottle);
        },

        buildBar: function () {
          // A long, right-wall bar leaves the back wall free for all three
          // dartboards and the middle free for tables and chairs.
          this.addBox(1.25, 1.1, 9.5, { x: 6.85, y: 0.55, z: -1.2 }, SALOON_DARK_WOOD);
          this.addBox(1.45, 0.12, 9.8, { x: 6.65, y: 1.12, z: -1.2 }, SALOON_WOOD);
          this.addBox(0.08, 0.08, 9.5, { x: 5.9, y: 0.24, z: -1.2 }, SALOON_BRASS);
          this.addBox(0.16, 2.7, 9.8, { x: 7.82, y: 2.1, z: -1.2 }, SALOON_DARK_WOOD);
          [1.8, 2.7, 3.55].forEach(function (height) {
            this.addBox(0.42, 0.08, 8.8, { x: 7.5, y: height, z: -1.2 }, SALOON_WOOD);
          }, this);

          var colors = ['#3f6b3a', '#6b4a1f', '#2f5b6b', '#5a2f3f', '#4a3f6b'];
          for (var i = 0; i < 9; i++) this.addBottle(6.55, 2.7 - i * 0.72, colors[i % colors.length]);
          for (var row = 0; row < 3; row++) {
            for (var bottle = 0; bottle < 7; bottle++) {
              var shelfBottle = document.createElement('a-entity');
              shelfBottle.setAttribute('boxy-bottle', { glass: colors[(row + bottle) % colors.length] });
              shelfBottle.setAttribute('position', { x: 7.3, y: 2.0225 + row * 0.86, z: 2.3 - bottle * 1.05 });
              this.el.appendChild(shelfBottle);
            }
          }
          var sign = document.createElement('a-text');
          sign.setAttribute('value', 'WHISKEY & BEER');
          sign.setAttribute('align', 'center');
          sign.setAttribute('color', '#f0d38b');
          sign.setAttribute('width', '4');
          sign.setAttribute('position', { x: 7.66, y: 3.9, z: -1.2 });
          sign.setAttribute('rotation', { x: 0, y: -90, z: 0 });
          this.el.appendChild(sign);
        },

        buildChair: function (x, z, rotationY) {
          var chair = document.createElement('a-entity');
          chair.setAttribute('position', { x: x, y: 0, z: z });
          chair.setAttribute('rotation', { x: 0, y: rotationY, z: 0 });
          this.addBox(0.72, 0.12, 0.72, { x: 0, y: 0.62, z: 0 }, SALOON_WOOD, chair);
          this.addBox(0.72, 0.72, 0.12, { x: 0, y: 1.02, z: 0.28 }, SALOON_DARK_WOOD, chair);
          [-0.26, 0.26].forEach(function (side) {
            [-0.26, 0.26].forEach(function (depth) {
              this.addBox(0.1, 0.62, 0.1, { x: side, y: 0.31, z: depth }, SALOON_DARK_WOOD, chair);
            }, this);
          }, this);
          this.el.appendChild(chair);
        },

        buildTables: function () {
          var self = this;
          [
            { x: -3.2, z: -1.2 },
            { x: 0.4, z: 1.6 },
            { x: -2.8, z: 3.5 },
          ].forEach(function (spot) {
            var table = document.createElement('a-cylinder');
            table.setAttribute('radius', 0.85);
            table.setAttribute('height', 0.12);
            table.setAttribute('color', SALOON_WOOD);
            table.setAttribute('position', { x: spot.x, y: 1.05, z: spot.z });
            self.el.appendChild(table);
            self.addBox(0.22, 1.0, 0.22, { x: spot.x, y: 0.5, z: spot.z }, SALOON_DARK_WOOD);
            self.buildChair(spot.x - 1.05, spot.z, 90);
            self.buildChair(spot.x + 1.05, spot.z, -90);
            self.buildChair(spot.x, spot.z - 1.05, 0);
          });
        },

        buildPianoNook: function () {
          this.addBox(2.4, 1.1, 0.78, { x: -5.9, y: 0.55, z: 5.85 }, '#2a1a13');
          this.addBox(2.25, 0.18, 0.6, { x: -5.9, y: 1.1, z: 5.42 }, '#efe6d3');
          for (var i = 0; i < 7; i++) this.addBox(0.08, 0.13, 0.32, { x: -6.62 + i * 0.24, y: 1.22, z: 5.38 }, '#1c1715');
          var stool = document.createElement('a-cylinder');
          stool.setAttribute('radius', 0.34);
          stool.setAttribute('height', 0.14);
          stool.setAttribute('color', '#4d3020');
          stool.setAttribute('position', { x: -5.9, y: 0.62, z: 4.55 });
          this.el.appendChild(stool);
          this.addBox(0.12, 0.62, 0.12, { x: -5.9, y: 0.31, z: 4.55 }, SALOON_DARK_WOOD);
        },

        buildExit: function () {
          var frameColor = '#6b4429';
          this.addBox(2.6, 0.16, 0.24, { x: 0, y: 2.4, z: 7.87 }, frameColor);
          this.addBox(0.16, 2.45, 0.24, { x: -1.25, y: 1.22, z: 7.87 }, frameColor);
          this.addBox(0.16, 2.45, 0.24, { x: 1.25, y: 1.22, z: 7.87 }, frameColor);
          var door = document.createElement('a-box');
          door.setAttribute('id', 'saloon-exit-door');
          door.setAttribute('width', 2.25);
          door.setAttribute('height', 2.3);
          door.setAttribute('depth', 0.14);
          door.setAttribute('color', '#563722');
          door.setAttribute('position', { x: 0, y: 1.15, z: 7.8 });
          door.setAttribute('town-door', 'destination: ghost-town; arrival: saloon-entrance');
          door.setAttribute('hint-zone', 'action: mounted; radius: 0.48; maxReach: 1; gazeThreshold: 0.88; priority: 30; desktopKey: E; desktopLabel: Leave Saloon; gamepadKey: X; gamepadLabel: Leave Saloon; touchKey: TAP; touchLabel: Leave Saloon; xrKey: POKE; xrLabel: Leave Saloon; hintOffset: 0 0.34 0.16; hintOffsetSpace: target; hintLockX: true; hintLockY: true; hintLockZ: true; hintScale: 0.68; highlightOpacity: 0.24; highlightScale: 1.045');
          this.el.appendChild(door);
          var label = document.createElement('a-text');
          label.setAttribute('value', 'GHOST TOWN');
          label.setAttribute('align', 'center');
          label.setAttribute('color', '#f0d38b');
          label.setAttribute('width', '2.4');
          label.setAttribute('position', { x: 0, y: 2.75, z: 7.67 });
          this.el.appendChild(label);
        },

        buildLights: function () {
          var ambient = document.createElement('a-entity');
          ambient.setAttribute('light', 'type: ambient; color: #e8cda8; intensity: 0.58');
          this.el.appendChild(ambient);

          [
            { x: -4.2, z: -2.8 }, { x: 0.4, z: -2.8 }, { x: 4.5, z: -2.8 },
            { x: -3.2, z: 3.0 }, { x: 1.4, z: 3.6 }, { x: 5.2, z: 2.8 },
          ].forEach(function (spot) {
            var fixture = document.createElement('a-cylinder');
            fixture.classList.add('saloon-lantern');
            fixture.setAttribute('radius', 0.18);
            fixture.setAttribute('height', 0.34);
            fixture.setAttribute('color', SALOON_BRASS);
            fixture.setAttribute('position', { x: spot.x, y: 3.7, z: spot.z });
            fixture.setAttribute('light', 'type: point; color: #ffd48a; intensity: 1.15; distance: 9; decay: 1.35');
            this.el.appendChild(fixture);
          }, this);
        },
      });
