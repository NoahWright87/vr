      // The compact street-front gallery is an entrance to an intentionally
      // enormous indoor range. The target components remain shared with the
      // outdoor Range, so its targets use the same fall-and-reset behavior.
      registerComponent('ghost-town-gallery', {
        init: function () {
          var width = 5.2, depth = 5.2, wallHeight = 3.25, wood = '#67462e';
          var building = document.createElement('a-box'); building.setAttribute('width', width); building.setAttribute('height', wallHeight); building.setAttribute('depth', depth); building.setAttribute('position', { x: 0, y: wallHeight / 2, z: 0 }); building.setAttribute('color', wood); this.el.appendChild(building);
          buildGableRoof(this.el, { width: width, depth: depth, wallHeight: wallHeight, pitchDeg: 20, color: '#3e3029', thickness: .1, overhang: .35 });
          var sign = document.createElement('a-text'); sign.setAttribute('value', 'SHOOTING GALLERY'); sign.setAttribute('align', 'center'); sign.setAttribute('color', '#f0dfba'); sign.setAttribute('width', '2.2'); sign.setAttribute('position', { x: 0, y: 3.05, z: depth / 2 + .12 }); this.el.appendChild(sign);
          var door = document.createElement('a-box'); door.setAttribute('id', 'ghost-town-gallery-door'); door.classList.add('ghost-town-door'); door.setAttribute('width', '.16'); door.setAttribute('height', '2.15'); door.setAttribute('depth', '1.35'); door.setAttribute('color', '#4d3020'); door.setAttribute('position', { x: 0, y: 1.075, z: depth / 2 + .03 }); door.setAttribute('town-door', 'destination: shooting-gallery'); door.setAttribute('hint-zone', 'action: mounted; radius: .8; maxReach: 1.65; gazeThreshold: .78; priority: 30; desktopKey: E; desktopLabel: Enter Gallery; gamepadKey: X; gamepadLabel: Enter Gallery; touchKey: TAP; touchLabel: Enter Gallery; xrKey: POKE; xrLabel: Enter Gallery; hintOffset: 0 .42 0; hintScale: .88; highlightOpacity: .3'); this.el.appendChild(door);
        },
      });

      registerComponent('shooting-gallery-interior', {
        init: function () {
          var location = findTownLocation('shooting-gallery');
          if (location) this.el.setAttribute('position', location.position);
          var self = this, width = 22, depth = 28, height = 5.6, centerZ = -8;
          function box(w, h, d, position, color) {
            var el = document.createElement('a-box'); el.setAttribute('width', w); el.setAttribute('height', h); el.setAttribute('depth', d); el.setAttribute('position', position); el.setAttribute('color', color); self.el.appendChild(el); return el;
          }
          var floor = document.createElement('a-plane'); floor.setAttribute('rotation', '-90 0 0'); floor.setAttribute('width', width); floor.setAttribute('height', depth); floor.setAttribute('position', { x: 0, y: .002, z: centerZ }); floor.setAttribute('color', '#634831'); this.el.appendChild(floor);
          box(width, height, .22, { x: 0, y: height / 2, z: -22 }, '#38271d');
          box(.22, height, depth, { x: -11, y: height / 2, z: centerZ }, '#38271d');
          box(.22, height, depth, { x: 11, y: height / 2, z: centerZ }, '#38271d');
          box(9.1, height, .22, { x: -6.45, y: height / 2, z: 6 }, '#38271d');
          box(9.1, height, .22, { x: 6.45, y: height / 2, z: 6 }, '#38271d');
          box(width, .16, depth, { x: 0, y: height, z: centerZ }, '#211712');
          var title = document.createElement('a-text'); title.setAttribute('value', 'GHOST TOWN SHOOTING GALLERY'); title.setAttribute('align', 'center'); title.setAttribute('color', '#f0dfba'); title.setAttribute('width', '4'); title.setAttribute('position', '0 4.65 -21.82'); this.el.appendChild(title);
          var rules = document.createElement('a-text'); rules.setAttribute('value', 'POP TARGETS  •  THEY STAND BACK UP'); rules.setAttribute('align', 'center'); rules.setAttribute('color', '#e5c879'); rules.setAttribute('width', '2.5'); rules.setAttribute('position', '0 3.85 -21.8'); this.el.appendChild(rules);
          [-6.5, 0, 6.5].forEach(function (x) { box(3.6, .95, 1.05, { x: x, y: .475, z: 1.7 }, '#70482b'); });
          var manager = document.createElement('a-entity'); manager.setAttribute('id', 'range-manager'); manager.setAttribute('shooting-range', ''); self.el.appendChild(manager);
          var targets = document.createElement('a-entity'); targets.setAttribute('class', 'shooting-gallery-targets'); targets.setAttribute('position', '0 0 3'); targets.setAttribute('target-group', 'count: 5; distance: 12'); self.el.appendChild(targets);
          var ambient = document.createElement('a-entity'); ambient.setAttribute('light', 'type: ambient; color: #d9b887; intensity: .5'); self.el.appendChild(ambient);
          [-7, 0, 7].forEach(function (x) { var lamp = document.createElement('a-entity'); lamp.setAttribute('position', { x: x, y: 4.7, z: -5 }); lamp.setAttribute('light', 'type: point; color: #ffd48a; intensity: 1.3; distance: 13'); self.el.appendChild(lamp); });
          var exit = box(3.6, 2.25, .14, { x: 0, y: 1.125, z: 5.87 }, '#573722'); exit.setAttribute('id', 'shooting-gallery-exit-door'); exit.setAttribute('town-door', 'destination: ghost-town; arrival: shooting-gallery-entrance'); exit.setAttribute('hint-zone', 'action: mounted; radius: .8; maxReach: 1.65; gazeThreshold: .78; priority: 30; desktopKey: E; desktopLabel: Leave Gallery; gamepadKey: X; gamepadLabel: Leave Gallery; touchKey: TAP; touchLabel: Leave Gallery; xrKey: POKE; xrLabel: Leave Gallery; hintOffset: 0 .42 0; hintScale: .88; highlightOpacity: .3');
        },
      });
