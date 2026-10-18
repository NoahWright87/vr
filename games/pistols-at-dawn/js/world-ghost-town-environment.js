      // Desert-Midwest dressing for Ghost Town. The scenery remains sparse
      // and outside the useful street, but repeated pieces are instanced so a
      // dozen cacti and three tumbleweeds cost two draw calls rather than
      // nearly ninety independent primitive meshes.
      registerComponent('ghost-town-environment', {
        init: function () {
          this.buildTerrain();
          this.buildCacti();
          this.buildTumbleweeds();
        },

        remove: function () {
          if (this.cactusMesh) {
            this.el.object3D.remove(this.cactusMesh);
            this.cactusMesh.geometry.dispose();
            this.cactusMesh.material.dispose();
          }
          if (this.tumbleweedMesh) {
            this.el.object3D.remove(this.tumbleweedMesh);
            this.tumbleweedMesh.geometry.dispose();
            this.tumbleweedMesh.material.dispose();
          }
        },

        buildTerrain: function () {
          var terrain = document.createElement('a-plane');
          terrain.setAttribute('rotation', '-90 0 0');
          terrain.setAttribute('width', 180); terrain.setAttribute('height', 180);
          terrain.setAttribute('position', '0 -0.012 0');
          terrain.setAttribute('material', 'src: assets/textures/stable-dirt-straw-v1.png; repeat: 70 70; color: #d2aa68; shader: standard');
          this.el.appendChild(terrain);
        },

        addCactusPart: function (parts, x, z, yaw, radius, height, position, rotation, color) {
          parts.push({
            x: x, z: z, yaw: yaw, radius: radius, height: height,
            position: position, rotation: rotation || { x: 0, y: 0, z: 0 }, color: color,
          });
        },

        buildCactusParts: function (parts, x, z, variant) {
          var height = 1.4 + (variant % 3) * 0.34;
          var radius = 0.095 + (variant % 2) * 0.018;
          var green = ['#547a3c', '#648b45', '#496e38'][variant % 3];
          var yaw = (variant * 57) * Math.PI / 180;
          this.addCactusPart(parts, x, z, yaw, radius, height,
            { x: 0, y: height / 2, z: 0 }, null, green);

          var arms = [1, 2, 2, 3, 1, 3][variant];
          for (var i = 0; i < arms; i += 1) {
            var side = i % 2 ? 1 : -1;
            var y = height * (0.42 + i * 0.12);
            var reach = 0.32 + (i % 2) * 0.12;
            this.addCactusPart(parts, x, z, yaw, radius * 0.72, reach,
              { x: side * reach / 2, y: y, z: 0 }, { x: 0, y: 0, z: Math.PI / 2 }, green);
            this.addCactusPart(parts, x, z, yaw, radius * 0.72, 0.3 + (variant % 2) * 0.1,
              { x: side * reach, y: y + 0.16, z: 0 }, null, green);
          }
        },

        buildCacti: function () {
          var spots = [
            [-47, -35], [-36, 38], [-29, -42], [42, -36], [48, 28], [32, 42],
            [-58, 9], [57, -4], [-40, 24], [38, -25], [-25, 46], [27, 48],
          ];
          var parts = [];
          for (var i = 0; i < spots.length; i += 1) {
            this.buildCactusParts(parts, spots[i][0], spots[i][1], i % 6);
          }

          var geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
          var material = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
          this.cactusMesh = new THREE.InstancedMesh(geometry, material, parts.length);
          this.cactusMesh.name = 'instanced-cacti';
          this.cactusMesh.userData.lowPriorityShadow = true;
          this.cactusMesh.castShadow = false;
          this.cactusMesh.receiveShadow = false;
          var root = new THREE.Object3D();
          var part = new THREE.Object3D();
          var matrix = new THREE.Matrix4();
          var color = new THREE.Color();
          for (i = 0; i < parts.length; i += 1) {
            var spec = parts[i];
            root.position.set(spec.x, 0, spec.z);
            root.rotation.set(0, spec.yaw, 0);
            root.scale.set(1, 1, 1);
            root.updateMatrix();
            part.position.set(spec.position.x, spec.position.y, spec.position.z);
            part.rotation.set(spec.rotation.x, spec.rotation.y, spec.rotation.z);
            part.scale.set(spec.radius, spec.height, spec.radius);
            part.updateMatrix();
            matrix.multiplyMatrices(root.matrix, part.matrix);
            this.cactusMesh.setMatrixAt(i, matrix);
            this.cactusMesh.setColorAt(i, color.set(spec.color));
          }
          this.cactusMesh.instanceMatrix.needsUpdate = true;
          if (this.cactusMesh.instanceColor) this.cactusMesh.instanceColor.needsUpdate = true;
          if (this.cactusMesh.computeBoundingSphere) this.cactusMesh.computeBoundingSphere();
          this.el.object3D.add(this.cactusMesh);
        },

        makeTumbleweedGeometry: function () {
          var rings = [];
          var totalVertices = 0;
          for (var i = 0; i < 5; i += 1) {
            var ring = new THREE.TorusGeometry(0.18 + (i % 3) * 0.025, 0.012, 4, 10).toNonIndexed();
            var rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
              (i * 47) % 180 * Math.PI / 180,
              (i * 79) % 180 * Math.PI / 180,
              (i * 29) % 180 * Math.PI / 180
            ));
            ring.applyMatrix4(rotation);
            rings.push(ring);
            totalVertices += ring.attributes.position.count;
          }
          var positions = new Float32Array(totalVertices * 3);
          var normals = new Float32Array(totalVertices * 3);
          var cursor = 0;
          for (i = 0; i < rings.length; i += 1) {
            positions.set(rings[i].attributes.position.array, cursor * 3);
            normals.set(rings[i].attributes.normal.array, cursor * 3);
            cursor += rings[i].attributes.position.count;
            rings[i].dispose();
          }
          var geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
          geometry.computeBoundingSphere();
          return geometry;
        },

        buildTumbleweeds: function () {
          this.tumbleweeds = [
            { x: -50, z: -17, speed: 0.55 },
            { x: -66, z: 12, speed: 0.38 },
            { x: -40, z: 35, speed: 0.46 },
          ];
          var geometry = this.makeTumbleweedGeometry();
          var material = new THREE.MeshStandardMaterial({ color: '#b78a4e', roughness: 1, metalness: 0 });
          this.tumbleweedMesh = new THREE.InstancedMesh(geometry, material, this.tumbleweeds.length);
          this.tumbleweedMesh.name = 'instanced-tumbleweeds';
          this.tumbleweedMesh.userData.lowPriorityShadow = true;
          this.tumbleweedMesh.castShadow = false;
          this.tumbleweedMesh.receiveShadow = false;
          // The three moving instances share one conservative batch. One extra
          // draw call is cheaper than recomputing its aggregate bounds each tick.
          this.tumbleweedMesh.frustumCulled = false;
          this.tumbleweedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.tumbleweedDummy = new THREE.Object3D();
          this.tumbleweedTime = 0;
          for (var i = 0; i < this.tumbleweeds.length; i += 1) {
            var weed = this.tumbleweeds[i];
            weed.drift = 0.08 + weed.speed * 0.08;
            weed.phase = Math.random() * Math.PI * 2;
            weed.rotationY = Math.random() * Math.PI * 2;
            weed.rotationZ = Math.random() * Math.PI * 2;
            weed.scale = 0.88 + Math.random() * 0.3;
            this.writeTumbleweedMatrix(i, weed);
          }
          this.tumbleweedMesh.instanceMatrix.needsUpdate = true;
          this.el.object3D.add(this.tumbleweedMesh);
        },

        writeTumbleweedMatrix: function (index, weed) {
          var dummy = this.tumbleweedDummy;
          dummy.position.set(
            weed.x,
            0.24 + Math.max(0, Math.sin(this.tumbleweedTime / 280 + weed.phase)) * 0.07,
            weed.z
          );
          dummy.rotation.set(0, weed.rotationY, weed.rotationZ);
          dummy.scale.setScalar(weed.scale);
          dummy.updateMatrix();
          this.tumbleweedMesh.setMatrixAt(index, dummy.matrix);
        },

        tick: function (time, delta) {
          if (!this.tumbleweedMesh) return;
          var cycle = this.el.sceneEl.components['day-night-cycle'];
          var timeScale = cycle ? cycle.timeScale : 1;
          var elapsed = Math.min(delta || 16, 80) * timeScale;
          var dt = elapsed / 1000;
          this.tumbleweedTime += elapsed;
          for (var i = 0; i < this.tumbleweeds.length; i += 1) {
            var weed = this.tumbleweeds[i];
            weed.x += weed.speed * dt;
            weed.z += Math.sin(this.tumbleweedTime / 1800 + weed.phase) * weed.drift * dt;
            weed.rotationZ -= (weed.speed / 0.22) * dt;
            weed.rotationY += 0.35 * dt;
            if (weed.x > 64) {
              weed.x = -64;
              weed.z = -42 + Math.random() * 84;
            }
            this.writeTumbleweedMatrix(i, weed);
          }
          this.tumbleweedMesh.instanceMatrix.needsUpdate = true;
        },
      });
