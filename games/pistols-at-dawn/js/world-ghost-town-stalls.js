      // The town stable is deliberately an exterior landmark: four open
      // stalls and hay rather than another teleport destination. This is the
      // same uncomplicated construction used by the remote Stable area,
      // rotated to face Ghost Town's main street.
      registerComponent('ghost-town-stalls', {
        init: function () {
          var count = 4, stallWidth = 2.25, depth = 3.1, width = count * stallWidth;
          var wood = '#765338', roof = '#483b34';
          var floor = document.createElement('a-plane');
          floor.setAttribute('rotation', '-90 0 0'); floor.setAttribute('width', width + 1); floor.setAttribute('height', depth + 1);
          floor.setAttribute('position', '0 .002 0'); floor.setAttribute('color', '#8a7355'); this.el.appendChild(floor);
          var back = document.createElement('a-box');
          back.setAttribute('width', width); back.setAttribute('height', 2.6); back.setAttribute('depth', '.15'); back.setAttribute('position', { x: 0, y: 1.3, z: -depth / 2 }); back.setAttribute('color', wood); this.el.appendChild(back);
          for (var i = 0; i <= count; i++) {
            var divider = document.createElement('a-box');
            divider.setAttribute('width', '.1'); divider.setAttribute('height', '1.3'); divider.setAttribute('depth', depth);
            divider.setAttribute('position', { x: -width / 2 + i * stallWidth, y: .65, z: 0 }); divider.setAttribute('color', wood); this.el.appendChild(divider);
          }
          buildGableRoof(this.el, { width: width, depth: depth, wallHeight: 2.6, pitchDeg: 25, color: roof, thickness: .1, overhang: .5 });
          for (var stall = 0; stall < count; stall++) {
            var hay = document.createElement('a-sphere'); hay.setAttribute('radius', '.42'); hay.setAttribute('scale', '1 .55 1'); hay.setAttribute('color', '#c9a227');
            hay.setAttribute('position', { x: -width / 2 + stallWidth * (stall + .5), y: .23, z: -.65 }); this.el.appendChild(hay);
          }
        },
      });
