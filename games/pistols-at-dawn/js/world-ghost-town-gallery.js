      // A compact outdoor bay for Ghost Town. The existing target-group
      // owns hit reactions and group reset; this component only supplies a
      // weathered frame and places that group so it faces the street.
      registerComponent('ghost-town-gallery', {
        init: function () {
          var width = 5.2, depth = 5.2, wallHeight = 3.25, wood = '#67462e';
          var floor = document.createElement('a-plane');
          floor.setAttribute('rotation', '-90 0 0'); floor.setAttribute('width', width); floor.setAttribute('height', depth); floor.setAttribute('color', '#896442'); this.el.appendChild(floor);
          var back = document.createElement('a-box');
          back.setAttribute('width', width); back.setAttribute('height', wallHeight); back.setAttribute('depth', '.18'); back.setAttribute('position', { x: 0, y: wallHeight / 2, z: -depth / 2 }); back.setAttribute('color', wood); this.el.appendChild(back);
          [-1, 1].forEach(function (side) {
            var post = document.createElement('a-box'); post.setAttribute('width', '.18'); post.setAttribute('height', wallHeight); post.setAttribute('depth', depth); post.setAttribute('position', { x: side * width / 2, y: wallHeight / 2, z: 0 }); post.setAttribute('color', wood); this.el.appendChild(post);
          }, this);
          buildGableRoof(this.el, { width: width, depth: depth, wallHeight: wallHeight, pitchDeg: 20, color: '#3e3029', thickness: .1, overhang: .35 });
          var sign = document.createElement('a-text'); sign.setAttribute('value', 'SHOOTING GALLERY'); sign.setAttribute('align', 'center'); sign.setAttribute('color', '#f0dfba'); sign.setAttribute('width', '2.2'); sign.setAttribute('position', { x: 0, y: 3.1, z: depth / 2 + .12 }); this.el.appendChild(sign);
          var targets = document.createElement('a-entity'); targets.setAttribute('class', 'ghost-town-gallery-targets'); targets.setAttribute('target-group', 'count: 3; distance: 2.4'); this.el.appendChild(targets);
        },
      });
