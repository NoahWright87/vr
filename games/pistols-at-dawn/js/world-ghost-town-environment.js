      // Desert-Midwest dressing for Ghost Town. Everything here is kept
      // outside the useful street so it makes a horizon without turning the
      // hub into an obstacle course.
      registerComponent('ghost-town-environment', {
        init: function () {
          this.buildTerrain();
          this.buildCacti();
          this.buildTumbleweeds();
        },

        buildTerrain: function () {
          var terrain = document.createElement('a-plane');
          terrain.setAttribute('rotation', '-90 0 0');
          terrain.setAttribute('width', 180); terrain.setAttribute('height', 180);
          terrain.setAttribute('position', '0 -0.012 0');
          terrain.setAttribute('material', 'src: assets/textures/stable-dirt-straw-v1.png; repeat: 70 70; color: #d2aa68; shader: flat');
          this.el.appendChild(terrain);
        },

        addCylinder: function (parent, radius, height, position, rotation, color) {
          var part = document.createElement('a-cylinder');
          part.setAttribute('radius', radius); part.setAttribute('height', height);
          part.setAttribute('position', position); part.setAttribute('rotation', rotation || '0 0 0');
          part.setAttribute('color', color); parent.appendChild(part);
        },

        buildCactus: function (x, z, variant) {
          var cactus = document.createElement('a-entity');
          var height = 1.4 + (variant % 3) * 0.34;
          var radius = 0.095 + (variant % 2) * 0.018;
          var green = ['#547a3c', '#648b45', '#496e38'][variant % 3];
          cactus.setAttribute('position', { x: x, y: 0, z: z });
          cactus.setAttribute('rotation', { x: 0, y: (variant * 57) % 360, z: 0 });
          this.addCylinder(cactus, radius, height, { x: 0, y: height / 2, z: 0 }, null, green);

          var arms = [1, 2, 2, 3, 1, 3][variant];
          for (var i = 0; i < arms; i++) {
            var side = i % 2 ? 1 : -1;
            var y = height * (0.42 + i * 0.12);
            var reach = 0.32 + (i % 2) * 0.12;
            this.addCylinder(cactus, radius * 0.72, reach, { x: side * reach / 2, y: y, z: 0 }, { x: 0, y: 0, z: 90 }, green);
            this.addCylinder(cactus, radius * 0.72, 0.3 + (variant % 2) * 0.1, { x: side * reach, y: y + 0.16, z: 0 }, null, green);
          }
          this.el.appendChild(cactus);
        },

        buildCacti: function () {
          var spots = [
            [-47, -35], [-36, 38], [-29, -42], [42, -36], [48, 28], [32, 42],
            [-58, 9], [57, -4], [-40, 24], [38, -25], [-25, 46], [27, 48],
          ];
          for (var i = 0; i < spots.length; i++) this.buildCactus(spots[i][0], spots[i][1], i % 6);
        },

        makeTumbleweed: function (x, z, speed) {
          var weed = document.createElement('a-entity');
          weed.setAttribute('position', { x: x, y: 0.24, z: z });
          for (var i = 0; i < 9; i++) {
            var strand = document.createElement('a-torus');
            strand.setAttribute('radius', 0.18 + (i % 3) * 0.025);
            strand.setAttribute('radius-tubular', 0.012);
            strand.setAttribute('rotation', { x: (i * 47) % 180, y: (i * 79) % 180, z: (i * 29) % 180 });
            strand.setAttribute('color', i % 2 ? '#a77a43' : '#c69a5a');
            weed.appendChild(strand);
          }
          this.el.appendChild(weed);
          return { el: weed, speed: speed, drift: 0.08 + speed * 0.08, phase: Math.random() * Math.PI * 2 };
        },

        buildTumbleweeds: function () {
          this.tumbleweeds = [
            this.makeTumbleweed(-50, -17, 0.55),
            this.makeTumbleweed(-66, 12, 0.38),
            this.makeTumbleweed(-40, 35, 0.46),
          ];
        },

        tick: function (time, delta) {
          var dt = Math.min(delta, 80) / 1000;
          this.tumbleweeds.forEach(function (weed) {
            var pos = weed.el.object3D.position;
            pos.x += weed.speed * dt;
            pos.z += Math.sin(time / 1800 + weed.phase) * weed.drift * dt;
            pos.y = 0.24 + Math.max(0, Math.sin(time / 280 + weed.phase)) * 0.07;
            // Rolling about Z matches movement along X; the tiny Y turn
            // keeps individual straw loops from reading as a flat wheel.
            weed.el.object3D.rotation.z -= (weed.speed / 0.22) * dt;
            weed.el.object3D.rotation.y += 0.35 * dt;
            if (pos.x > 64) { pos.x = -64; pos.z = -42 + Math.random() * 84; }
          });
        },
      });
