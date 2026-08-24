      // Compact hub interiors: the Sheriff provides a readable jail-and-desk
      // space; the Store exposes existing makers as real, restocking stock.
      function hubBox(parent, w, h, d, pos, color) {
        var el = document.createElement('a-box');
        el.setAttribute('width', w); el.setAttribute('height', h); el.setAttribute('depth', d);
        el.setAttribute('position', pos); el.setAttribute('color', color); parent.appendChild(el); return el;
      }
      function hubRoom(el, loc, width, depth, label) {
        el.setAttribute('position', loc.position);
        var floor = document.createElement('a-plane'); floor.setAttribute('rotation', '-90 0 0'); floor.setAttribute('width', width); floor.setAttribute('height', depth); floor.setAttribute('color', '#6f5237'); el.appendChild(floor);
        hubBox(el, width, 3.6, .2, { x: 0, y: 1.8, z: -depth / 2 }, '#493020');
        [-1, 1].forEach(function (side) { hubBox(el, .2, 3.6, depth, { x: side * width / 2, y: 1.8, z: 0 }, '#493020'); });
        hubBox(el, width, .16, depth, { x: 0, y: 3.6, z: 0 }, '#2d1d15');
        var ambient = document.createElement('a-entity'); ambient.setAttribute('light', 'type: ambient; color: #d9b887; intensity: .42'); el.appendChild(ambient);
        [-width / 4, width / 4].forEach(function (x) {
          var light = document.createElement('a-entity'); light.setAttribute('light', 'type: point; color: #ffd48a; intensity: 1.25; distance: 9'); light.setAttribute('position', { x: x, y: 3.15, z: -.5 }); el.appendChild(light);
        });
        var text = document.createElement('a-text'); text.setAttribute('value', label); text.setAttribute('align', 'center'); text.setAttribute('color', '#efd59d'); text.setAttribute('width', '3'); text.setAttribute('position', { x: 0, y: 3.25, z: -depth / 2 + .12 }); el.appendChild(text);
      }
      function hubExit(el, arrival) {
        var door = hubBox(el, 2.2, 2.25, .14, { x: 0, y: 1.125, z: 3.85 }, '#573722');
        door.setAttribute('town-door', 'destination: ghost-town; arrival: ' + arrival);
        door.setAttribute('hint-zone', 'action: mounted; radius: .8; maxReach: 1.65; gazeThreshold: .78; priority: 30; desktopKey: E; desktopLabel: Leave; gamepadKey: X; gamepadLabel: Leave; touchKey: TAP; touchLabel: Leave; xrKey: POKE; xrLabel: Leave; hintOffset: 0 .42 0; hintScale: .88; highlightOpacity: .3');
      }
      registerComponent('sheriff-office', { init: function () {
        var loc = findTownLocation('sheriff-office'); hubRoom(this.el, loc, 9, 8, "SHERIFF'S OFFICE");
        hubBox(this.el, 4.5, 1.15, 1.1, { x: -1.5, y: .575, z: .7 }, '#654125');
        hubBox(this.el, 1.1, .72, .12, { x: -1.5, y: 1.5, z: .15 }, '#2b201a');
        var wanted = document.createElement('a-text'); wanted.setAttribute('value', 'WANTED\nDEAD OR ALIVE'); wanted.setAttribute('align', 'center'); wanted.setAttribute('color', '#24170f'); wanted.setAttribute('width', '2'); wanted.setAttribute('position', { x: -1.5, y: 1.5, z: .21 }); this.el.appendChild(wanted);
        // Bars make the rear-right cell read at a glance, while remaining a
        // small enough play space to be useful for tests and future lock play.
        hubBox(this.el, 3.2, .14, .14, { x: 2.8, y: 2.85, z: -1.7 }, '#9b9b90');
        for (var i = 0; i < 7; i++) hubBox(this.el, .1, 2.7, .1, { x: 1.35 + i * .48, y: 1.45, z: -1.7 }, '#9b9b90');
        hubBox(this.el, 3.2, .12, 3.5, { x: 2.8, y: .12, z: -.2 }, '#3e2a1d');
        hubBox(this.el, .65, .5, 1.8, { x: 2.8, y: .38, z: -.1 }, '#6d5135');
        hubExit(this.el, 'sheriff-entrance');
      }});
      registerComponent('general-store', { init: function () {
        var loc = findTownLocation('general-store'); hubRoom(this.el, loc, 12, 8, 'GENERAL STORE'); this.serial = 0;
        var stock = ['pistol', 'shotgun', 'tommy', 'bow', 'dynamite', 'launcher', 'rocket'];
        for (var side = -1; side <= 1; side += 2) {
          hubBox(this.el, .55, 2.65, 5.8, { x: side * 5.35, y: 1.325, z: -.5 }, '#5b3a25');
          for (var row = 0; row < 3; row++) hubBox(this.el, .85, .1, 5.4, { x: side * 5.0, y: .75 + row * .75, z: -.5 }, '#89623a');
        }
        stock.forEach(function (item, index) {
          var slot = document.createElement('a-entity'); var id = 'store-slot-' + this.serial++;
          slot.setAttribute('id', id); slot.classList.add('anchor-slot'); slot.setAttribute('anchor-slot', 'size: ' + (item === 'shotgun' || item === 'tommy' || item === 'launcher' ? 'large' : 'medium'));
          slot.setAttribute('position', { x: index % 2 ? 4.95 : -4.95, y: .8 + Math.floor(index / 2) * .78, z: 1.8 - (index % 3) * 1.7 }); slot.setAttribute('stocked', { item: item, refillMs: 8000 }); this.el.appendChild(slot);
        }, this);
        hubBox(this.el, 5.6, 1.1, 1.15, { x: 0, y: .55, z: .85 }, '#684326');
        hubBox(this.el, 5.8, .12, 1.3, { x: 0, y: 1.12, z: .85 }, '#9a7040');
        hubExit(this.el, 'store-entrance');
      }});
      registerComponent('bank-interior', { init: function () {
        var loc = findTownLocation('bank'); hubRoom(this.el, loc, 12, 10, 'THE BANK');
        // A long tellers' counter, brass rail, and a heavy rear vault make
        // this modest room immediately legible even before bank gameplay.
        hubBox(this.el, 9.6, 1.2, .8, { x: 0, y: .6, z: -1.1 }, '#6b4326');
        hubBox(this.el, 9.9, .1, 1, { x: 0, y: 1.23, z: -1.1 }, '#9a7040');
        for (var i = -4; i <= 4; i += 2) {
          var rail = document.createElement('a-cylinder'); rail.setAttribute('radius', '.06'); rail.setAttribute('height', '1.05'); rail.setAttribute('color', '#c69b43'); rail.setAttribute('position', { x: i, y: 1.75, z: -.55 }); this.el.appendChild(rail);
        }
        hubBox(this.el, 3.1, 3, .35, { x: 3.7, y: 1.5, z: -4.75 }, '#59606a');
        var vault = document.createElement('a-cylinder'); vault.setAttribute('radius', '1.05'); vault.setAttribute('height', '.28'); vault.setAttribute('rotation', '90 0 0'); vault.setAttribute('color', '#838b95'); vault.setAttribute('position', '3.7 1.55 -4.55'); this.el.appendChild(vault);
        var wheel = document.createElement('a-torus'); wheel.setAttribute('radius', '.42'); wheel.setAttribute('radius-tubular', '.06'); wheel.setAttribute('color', '#d0b45c'); wheel.setAttribute('position', '3.7 1.55 -4.37'); this.el.appendChild(wheel);
        hubExit(this.el, 'bank-entrance');
      }});
