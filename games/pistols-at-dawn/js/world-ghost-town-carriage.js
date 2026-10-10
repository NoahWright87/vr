      // A physical travel board: a projected-menu trigger with a crossbar
      // panel in it, the same as the Watch. These three tickets deliberately point only
      // to the out-of-town destinations; local buildings remain walkable.
      registerComponent('carriage-ticket-stall', {
        init: function () {
          var self = this;
          var wood = '#6c462c';
          // The component root is deliberately counter-height: it is both
          // the menu trigger and the panel anchor, while the visual stall is
          // built around it down to ground level.
          var counter = document.createElement('a-box'); counter.setAttribute('width', '4.6'); counter.setAttribute('height', '1.05'); counter.setAttribute('depth', '1.2'); counter.setAttribute('position', '0 -.825 0'); counter.setAttribute('color', wood); this.el.appendChild(counter);
          var roof = document.createElement('a-box'); roof.setAttribute('width', '5.1'); roof.setAttribute('height', '.18'); roof.setAttribute('depth', '2.4'); roof.setAttribute('position', '0 1.7 0'); roof.setAttribute('color', '#3d3029'); this.el.appendChild(roof);
          [-2.15, 2.15].forEach(function (x) { var post = document.createElement('a-box'); post.setAttribute('width', '.18'); post.setAttribute('height', '3'); post.setAttribute('depth', '.18'); post.setAttribute('position', { x: x, y: .15, z: 0 }); post.setAttribute('color', wood); self.el.appendChild(post); });
          var sign = document.createElement('a-text'); sign.setAttribute('value', 'CARRIAGE TICKETS'); sign.setAttribute('align', 'center'); sign.setAttribute('color', '#f0dfba'); sign.setAttribute('width', '2.4'); sign.setAttribute('position', '0 1.2 -0.62'); sign.setAttribute('rotation', '0 180 0'); this.el.appendChild(sign);

          // The panel is a crossbar menu built from the "carriage" page
          // (js/menu-pages.js); projected-menu still decides when it is up.
          var template = document.createElement('template'); template.id = 'carriage-ticket-menu-template';
          template.innerHTML = '<a-entity class="carriage-ticket-panel" visible="false">' +
            '<a-entity crossbar-menu="page: carriage; width: 1.05; rowHeight: 0.17; maxChars: 20; open: false; closeBehavior: hide; memory: none; hint: false; stickRange: 0.7; plateOpacity: 0.92; accent: #f0c27a; color: #fff0cd" crossbar-menu-registration></a-entity>' +
            '</a-entity>';
          this.el.appendChild(template);
          this.el.setAttribute('mounted-interaction', 'radialAnchor: true; interactionDistance: 1.1; previewStandoff: .16');
          this.el.setAttribute('hint-zone', 'action: mounted; radius: 1.6; maxReach: 1.65; gazeThreshold: .72; priority: 30; desktopKey: E; desktopLabel: View Tickets; gamepadKey: X; gamepadLabel: View Tickets; touchKey: TAP; touchLabel: View Tickets; xrKey: POKE; xrLabel: View Tickets; hintOffset: 0 .5 0; hintScale: .9; highlightOpacity: .3');
          this.el.setAttribute('projected-menu', 'template: #carriage-ticket-menu-template; mode: laser; laserScale: 1; offset: 0 .45 0; closeDistance: 3.5');
          this.el.setAttribute('projected-crossbar', '');
          this.onTicket = function (evt) {
            var value = (evt.detail && evt.detail.value) || '';
            if (value.indexOf('carriage-') !== 0) return;
            var rig = document.querySelector('#player-rig'); var hub = rig && rig.components['teleport-hub'];
            if (hub) hub.teleportTo(value.slice('carriage-'.length));
          };
          this.el.sceneEl.addEventListener('menu-item-select', this.onTicket);
        },
        remove: function () { this.el.sceneEl.removeEventListener('menu-item-select', this.onTicket); },
      });
