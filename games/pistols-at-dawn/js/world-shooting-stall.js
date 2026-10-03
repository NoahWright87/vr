      // ==============================================================
      // WORLD: shooting stall
      // A compact stepped barricade between the player and the range.
      // Each step is also a generic gun-brace-surface: firearms can
      // ask it for the closest point on its box without knowing what
      // kind of scenery supplied that surface.
      // ==============================================================

      registerComponent('gun-brace-surface', {
        schema: {
          size: { type: 'vec3', default: { x: 1, y: 1, z: 0.1 } },
        },

        init: function () {
          this._local = new THREE.Vector3();
        },

        // Closest point on the OUTSIDE of this local axis-aligned box.
        // Hands are normally outside it, but choosing the nearest face
        // for an accidentally embedded point prevents a brace from
        // snapping into the middle of the timber.
        nearestPoint: function (worldPoint, out) {
          var halfX = this.data.size.x / 2;
          var halfY = this.data.size.y / 2;
          var halfZ = this.data.size.z / 2;
          this._local.copy(worldPoint);
          this.el.object3D.worldToLocal(this._local);

          var inside =
            Math.abs(this._local.x) <= halfX &&
            Math.abs(this._local.y) <= halfY &&
            Math.abs(this._local.z) <= halfZ;

          this._local.x = Math.min(Math.max(this._local.x, -halfX), halfX);
          this._local.y = Math.min(Math.max(this._local.y, -halfY), halfY);
          this._local.z = Math.min(Math.max(this._local.z, -halfZ), halfZ);

          if (inside) {
            var gapX = halfX - Math.abs(this._local.x);
            var gapY = halfY - Math.abs(this._local.y);
            var gapZ = halfZ - Math.abs(this._local.z);
            if (gapX <= gapY && gapX <= gapZ) {
              this._local.x = this._local.x < 0 ? -halfX : halfX;
            } else if (gapY <= gapZ) {
              this._local.y = this._local.y < 0 ? -halfY : halfY;
            } else {
              this._local.z = this._local.z < 0 ? -halfZ : halfZ;
            }
          }

          out.copy(this._local);
          this.el.object3D.localToWorld(out);
          return out;
        },
      });

      registerComponent('shooting-stall', {
        init: function () {
          var stepWidth = 0.34;
          var depth = 0.14;
          var heights = [0.48, 0.72, 0.96, 1.2];
          var wood = '#657553';

          for (var i = 0; i < heights.length; i++) {
            var height = heights[i];
            var step = document.createElement('a-box');
            step.classList.add('gun-brace-surface');
            step.setAttribute('width', stepWidth);
            step.setAttribute('height', height);
            step.setAttribute('depth', depth);
            step.setAttribute('position', {
              x: (i - (heights.length - 1) / 2) * stepWidth,
              y: height / 2,
              z: 0,
            });
            step.setAttribute('material', 'color: ' + wood + '; roughness: 0.92; metalness: 0');
            step.setAttribute('gun-brace-surface', {
              size: { x: stepWidth, y: height, z: depth },
            });
            this.el.appendChild(step);

            // A light cap makes every usable height readable at a
            // glance, especially against the similarly colored dirt.
            var cap = document.createElement('a-box');
            cap.setAttribute('width', stepWidth + 0.012);
            cap.setAttribute('height', 0.025);
            cap.setAttribute('depth', depth + 0.018);
            cap.setAttribute('position', {
              x: (i - (heights.length - 1) / 2) * stepWidth,
              y: height + 0.0125,
              z: 0,
            });
            cap.setAttribute('color', '#84916d');
            this.el.appendChild(cap);
          }

          // Broad feet keep the silhouette from looking like four
          // slabs balanced on the dirt. They are intentionally not
          // brace surfaces; the useful interaction zone stays at hand
          // height instead of lighting up around the player's boots.
          [-0.58, 0.58].forEach(function (x) {
            var foot = document.createElement('a-box');
            foot.setAttribute('width', 0.16);
            foot.setAttribute('height', 0.08);
            foot.setAttribute('depth', 0.48);
            foot.setAttribute('position', { x: x, y: 0.04, z: 0.08 });
            foot.setAttribute('color', '#4d5c3f');
            this.el.appendChild(foot);
          }, this);
        },
      });
