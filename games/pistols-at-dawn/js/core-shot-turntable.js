      // ==============================================================
      // CORE: shot-triggered turntables
      // A trigger, a rotating parent, and an axis. shot-switch turns a
      // hit on any shootable object into `toggle`; turntable consumes
      // that event and rotates whatever children it happens to carry.
      // appendShotBell is merely the reusable brass presentation for
      // that trigger contract. None of these know about bars, racks,
      // weapons, or any other particular use.
      // ==============================================================

      var SHOT_TURNTABLE_DEFAULT_SPIN_MS = 850;

      registerComponent('turntable', {
        schema: {
          spinMs: { type: 'number', default: SHOT_TURNTABLE_DEFAULT_SPIN_MS },
          faces: { type: 'number', default: 2 },
          axis: { type: 'string', default: 'y' },
        },

        init: function () {
          this.face = 0;
          this.fromAngle = 0;
          this.toAngle = 0;
          this.elapsed = this.data.spinMs;
          this._pivot = new THREE.Vector3();
          this._poolPos = new THREE.Vector3();

          this.onToggle = this.onToggle.bind(this);
          this.el.addEventListener('toggle', this.onToggle);
        },

        remove: function () {
          this.el.removeEventListener('toggle', this.onToggle);
        },

        spinning: function () {
          return this.elapsed < this.data.spinMs;
        },

        // Ignore hits during a turn rather than queueing them: rapid
        // gunfire should ring the bell, not wind up the display.
        onToggle: function () {
          if (this.spinning()) return;

          this.face = (this.face + 1) % this.data.faces;
          this.fromAngle = this.el.object3D.rotation[this.data.axis];
          this.toAngle = this.fromAngle + (Math.PI * 2) / this.data.faces;
          this.elapsed = 0;
          playRumble(this.data.spinMs);
        },

        tick: function (time, dt) {
          if (!this.spinning()) return;

          this.elapsed = Math.min(this.elapsed + (dt || 16), this.data.spinMs);
          var t = this.elapsed / this.data.spinMs;
          var eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          var angle = this.fromAngle + (this.toAngle - this.fromAngle) * eased;

          this.ridePools(angle - this.el.object3D.rotation[this.data.axis]);
          this.el.object3D.rotation[this.data.axis] = angle;

          if (!this.spinning()) playClunk();
        },

        // World-space puddles cannot inherit a parent's transform, so
        // horizontal turntables carry pools resting on their surfaces
        // explicitly. Other axes leave them alone.
        ridePools: function (deltaRad) {
          if (!deltaRad || this.data.axis !== 'y') return;

          this.el.object3D.getWorldPosition(this._pivot);
          var cos = Math.cos(deltaRad);
          var sin = Math.sin(deltaRad);

          for (var i = 0; i < POOLS.length; i++) {
            var pool = POOLS[i];
            if (!this.carries(pool)) continue;

            var dx = pool.x - this._pivot.x;
            var dz = pool.z - this._pivot.z;
            pool.x = this._pivot.x + dx * cos + dz * sin;
            pool.z = this._pivot.z - dx * sin + dz * cos;
          }
        },

        carries: function (pool) {
          for (var i = 0; i < HARD_SURFACES.length; i++) {
            var s = HARD_SURFACES[i];
            if (!s.obj || Math.abs(s.y - pool.y) > 0.06) continue;
            if (!this.owns(s.obj)) continue;
            if (overSurface(s, this._poolPos.set(pool.x, pool.y, pool.z))) return true;
          }
          return false;
        },

        owns: function (obj) {
          while (obj) {
            if (obj === this.el.object3D) return true;
            obj = obj.parent;
          }
          return false;
        },
      });

      registerComponent('shot-switch', {
        schema: {
          target: { type: 'selectorAll' },
          knockDeg: { type: 'number', default: 26 },
        },

        init: function () {
          this.swing = 0;
          this.swingVel = 0;

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        onShot: function () {
          this.swingVel = (this.data.knockDeg * Math.PI) / 180 * 9;
          playClang();
          for (var i = 0; i < this.data.target.length; i++) {
            this.data.target[i].emit('toggle', null, false);
          }
        },

        tick: function (time, dt) {
          if (!this.swing && !this.swingVel) return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          this.swingVel -= this.swing * 240 * dtSeconds;
          this.swingVel *= Math.max(1 - 3.2 * dtSeconds, 0);
          this.swing += this.swingVel * dtSeconds;

          if (Math.abs(this.swing) < 0.002 && Math.abs(this.swingVel) < 0.02) {
            this.swing = 0;
            this.swingVel = 0;
          }
          this.el.object3D.rotation.z = this.swing;
        },
      });

      // Builds a fixed bracket and a shootable hanging bell. `target`
      // is any selector accepted by shot-switch, including a comma-
      // separated list for one bell controlling several turntables.
      function appendShotBell(parentEl, mountPos, armAxis, armLength, target) {
        var armDims = { w: 0.03, h: 0.03, d: 0.03 };
        var armPos = { x: mountPos.x, y: mountPos.y, z: mountPos.z };
        var bellPos = { x: mountPos.x, y: mountPos.y, z: mountPos.z };

        if (armAxis === 'x') {
          armDims.w = armLength;
          armPos.x += armLength / 2;
          bellPos.x += armLength;
        } else if (armAxis === 'z') {
          armDims.d = armLength;
          armPos.z += armLength / 2;
          bellPos.z += armLength;
        } else {
          armDims.h = armLength;
          armPos.y += armLength / 2;
          bellPos.y += armLength;
        }

        var arm = document.createElement('a-box');
        arm.setAttribute('width', armDims.w);
        arm.setAttribute('height', armDims.h);
        arm.setAttribute('depth', armDims.d);
        arm.setAttribute('position', armPos);
        arm.setAttribute('color', '#3c2a1c');
        parentEl.appendChild(arm);

        var hanger = document.createElement('a-entity');
        hanger.setAttribute('position', bellPos);
        hanger.classList.add('shootable');
        hanger.setAttribute('shot-switch', { target: target });
        parentEl.appendChild(hanger);

        var stem = document.createElement('a-box');
        stem.setAttribute('width', 0.014);
        stem.setAttribute('height', 0.1);
        stem.setAttribute('depth', 0.014);
        stem.setAttribute('position', { x: 0, y: -0.05, z: 0 });
        stem.setAttribute('color', '#2b2b2f');
        hanger.appendChild(stem);

        var dome = document.createElement('a-cylinder');
        dome.setAttribute('radius', 0.11);
        dome.setAttribute('height', 0.15);
        dome.setAttribute('color', '#b98c2a');
        dome.setAttribute('position', { x: 0, y: -0.175, z: 0 });
        hanger.appendChild(dome);

        var lip = document.createElement('a-cylinder');
        lip.setAttribute('radius', 0.13);
        lip.setAttribute('height', 0.03);
        lip.setAttribute('color', '#8a6a1c');
        lip.setAttribute('position', { x: 0, y: -0.26, z: 0 });
        hanger.appendChild(lip);

        var clapper = document.createElement('a-box');
        clapper.setAttribute('width', 0.03);
        clapper.setAttribute('height', 0.05);
        clapper.setAttribute('depth', 0.03);
        clapper.setAttribute('position', { x: 0, y: -0.29, z: 0 });
        clapper.setAttribute('color', '#2b2b2f');
        hanger.appendChild(clapper);

        return hanger;
      }
