      // ==============================================================
      // ITEMS: siege weapons
      // Fixed, wheeled machinery uses a grip contract separate from
      // holsterable: a trail handle moves/aims the carriage and a crank
      // feeds angular travel to the Gatling gun. Cannon payloads remain
      // ordinary holsterable props in a weighted muzzle socket.
      // ==============================================================

      var SIEGE_SERIAL = 0;
      var CANNON_CAPACITY_UNITS = 105;
      var CANNON_FUSE_MS = 4000;
      var CANNONBALL_DAMAGE = 30;
      var _siegeUp = new THREE.Vector3(0, 1, 0);

      function siegeBox(parent, size, position, color) {
        var el = document.createElement('a-box');
        el.setAttribute('width', size.x);
        el.setAttribute('height', size.y);
        el.setAttribute('depth', size.z);
        el.setAttribute('position', position);
        el.setAttribute('color', color);
        parent.appendChild(el);
        return el;
      }

      function siegeCylinder(parent, radius, height, position, rotation, color) {
        var el = document.createElement('a-cylinder');
        el.setAttribute('radius', radius);
        el.setAttribute('height', height);
        el.setAttribute('segments-radial', 12);
        el.setAttribute('position', position);
        el.setAttribute('rotation', rotation || { x: 0, y: 0, z: 0 });
        el.setAttribute('color', color);
        parent.appendChild(el);
        return el;
      }

      function addSights(pivot, rearZ, frontZ, height) {
        var rear = document.createElement('a-entity');
        rear.setAttribute('position', { x: 0, y: height, z: rearZ });
        siegeBox(rear, { x: 0.055, y: 0.012, z: 0.012 }, { x: -0.045, y: 0, z: 0 }, '#d5bd76');
        siegeBox(rear, { x: 0.055, y: 0.012, z: 0.012 }, { x: 0.045, y: 0, z: 0 }, '#d5bd76');
        pivot.appendChild(rear);
        siegeBox(pivot, { x: 0.012, y: 0.07, z: 0.012 }, { x: 0, y: height + 0.025, z: frontZ }, '#d5bd76');
      }

      function playCannonBlast() {
        playBoom();
        playNoise({ duration: 1.15, freq: 150, q: 0.45, volume: 0.62, filterType: 'lowpass' });
        playTone({ type: 'sine', freq: 82, sweep: 24, duration: 1.25, volume: 0.52 });
        playTone({ type: 'sawtooth', freq: 48, sweep: 20, duration: 0.8, volume: 0.24 });
        playRumble(1250);
      }

      function spawnCannonCloud(origin, forward) {
        for (var i = 0; i < 18; i++) {
          var drift = forward.clone().multiplyScalar(0.7 + Math.random() * 2.8);
          drift.addScaledVector(randomUnitVector(), 0.35 + Math.random() * 1.1);
          drift.y += 0.3 + Math.random() * 0.7;
          spawnSmoke(origin, drift, 1.8 + Math.random() * 2.5);
        }
        spawnSparks(origin, 18);

        var flash = document.createElement('a-sphere');
        flash.setAttribute('radius', 0.26);
        flash.setAttribute('material', 'color: #fff4b0; emissive: #ff9d24; emissiveIntensity: 2.5; shader: standard; transparent: true; opacity: 0.95');
        flash.object3D.position.copy(origin);
        flash.setAttribute('animation__blast', { property: 'scale', to: '3 3 3', dur: 120, easing: 'easeOutQuad' });
        document.querySelector('a-scene').appendChild(flash);
        setTimeout(function () {
          if (flash.parentNode) flash.parentNode.removeChild(flash);
        }, 140);
      }

      function addWheel(root, side) {
        var wheel = siegeCylinder(root, 0.31, 0.065, { x: side * 0.43, y: 0.34, z: 0 }, { x: 0, y: 0, z: 90 }, '#4a3425');
        wheel.classList.add('siege-wheel');
        siegeCylinder(wheel, 0.055, 0.08, { x: 0, y: 0, z: 0 }, null, '#81633f');
      }

      function buildCarriage(kind, x) {
        var root = document.createElement('a-entity');
        root.id = kind + '-carriage-' + SIEGE_SERIAL++;
        root.classList.add('siege-carriage');
        root.setAttribute('position', { x: x, y: 0, z: -1.6 });

        addWheel(root, -1);
        addWheel(root, 1);
        siegeBox(root, { x: 0.76, y: 0.12, z: 0.38 }, { x: 0, y: 0.39, z: 0.08 }, '#6d4d30');
        siegeBox(root, { x: 0.14, y: 0.12, z: 0.52 }, { x: 0, y: 0.31, z: 0.36 }, '#765537');

        var trail = document.createElement('a-entity');
        trail.classList.add('grip-interactable');
        trail.setAttribute('position', { x: 0, y: 0.36, z: 0.64 });
        siegeBox(trail, { x: 0.3, y: 0.055, z: 0.09 }, { x: 0, y: 0, z: 0 }, '#c8a66b').classList.add('machine-grip');
        trail.setAttribute('siege-control', { mode: 'trail', machine: '#' + root.id, grabRadius: 0.22 });
        root.appendChild(trail);

        var pivot = document.createElement('a-entity');
        pivot.classList.add('barrel-pivot');
        pivot.setAttribute('position', { x: 0, y: 0.55, z: 0 });
        root.appendChild(pivot);
        root.setAttribute('siege-carriage', { barrelPivot: '.barrel-pivot' });
        return { root: root, pivot: pivot };
      }

      registerComponent('siege-control', {
        schema: {
          mode: { type: 'string', default: 'trail' },
          machine: { type: 'string' },
          grabRadius: { type: 'number', default: 0.2 },
        },

        init: function () {
          this.hand = null;
          this.lastAngle = null;
          this._handWorld = new THREE.Vector3();
          this._local = new THREE.Vector3();
          this._handleWorld = new THREE.Vector3();
        },

        machineComponent: function () {
          var machine = document.querySelector(this.data.machine);
          if (!machine) return null;
          if (this.data.mode === 'trail') return machine.components['siege-carriage'];
          if (this.data.mode === 'hatch') return machine.components.cannon;
          return machine.components['gatling-gun'];
        },

        canGrab: function () {
          return !this.hand;
        },

        grabDistance: function (handWorld) {
          var handle = this.el.querySelector('.machine-grip');
          (handle || this.el).object3D.getWorldPosition(this._handleWorld);
          return this._handleWorld.distanceTo(handWorld);
        },

        grab: function (handEl) {
          this.hand = handEl;
          this.lastAngle = null;
        },

        release: function () {
          this.hand = null;
          this.lastAngle = null;
        },

        onTriggerUse: function () {
          var machine = this.machineComponent();
          if (this.data.mode === 'hatch' && machine) machine.toggleHatch();
        },

        tick: function (time, dt) {
          if (!this.hand) return;
          var machine = this.machineComponent();
          if (!machine) return;
          gripObjectOf(this.hand).getWorldPosition(this._handWorld);
          if (this.data.mode === 'trail') {
            machine.pullTrail(this._handWorld, Math.min((dt || 16) / 1000, 0.05));
            return;
          }
          if (this.data.mode === 'hatch') return;

          this._local.copy(this._handWorld);
          this.el.object3D.parent.worldToLocal(this._local);
          this._local.sub(this.el.object3D.position);
          var angle = Math.atan2(this._local.y, this._local.z);
          if (this.lastAngle !== null) {
            var delta = angle - this.lastAngle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            if (Math.abs(delta) < 0.8) {
              this.el.object3D.rotation.x += delta;
              machine.turnCrank(Math.abs(delta), time);
            }
          }
          this.lastAngle = angle;
        },
      });

      registerComponent('siege-carriage', {
        schema: { barrelPivot: { type: 'string', default: '.barrel-pivot' } },

        init: function () {
          this.pivot = this.el.querySelector(this.data.barrelPivot);
          this._localHand = new THREE.Vector3();
          this._desired = new THREE.Vector3();
          this._travel = new THREE.Vector3();
          this.trailLength = 0.64;
        },

        pullTrail: function (handWorld, dt) {
          this._localHand.copy(handWorld);
          this.el.parentEl.object3D.worldToLocal(this._localHand);
          var rootPos = this.el.object3D.position;
          var dx = this._localHand.x - rootPos.x;
          var dz = this._localHand.z - rootPos.z;
          var distance = Math.sqrt(dx * dx + dz * dz);
          if (distance < 0.2) return;

          var targetYaw = Math.atan2(dx, dz);
          var yawDelta = targetYaw - this.el.object3D.rotation.y;
          while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
          while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
          this.el.object3D.rotation.y += yawDelta * Math.min(dt * 5, 1);

          this._desired.set(
            this._localHand.x - (dx / distance) * this.trailLength,
            rootPos.y,
            this._localHand.z - (dz / distance) * this.trailLength
          );
          this._travel.copy(this._desired).sub(rootPos);
          var maxMove = 0.42 * dt;
          if (this._travel.length() > maxMove) this._travel.setLength(maxMove);
          rootPos.add(this._travel);
          var wheelTurn = this._travel.length() / 0.31;
          var wheels = this.el.querySelectorAll('.siege-wheel');
          for (var i = 0; i < wheels.length; i++) wheels[i].object3D.rotation.x += wheelTurn;

          var elevation = THREE.MathUtils.clamp((1.05 - handWorld.y) * 0.55, -0.08, 0.42);
          if (this.pivot) this.pivot.object3D.rotation.x += (elevation - this.pivot.object3D.rotation.x) * Math.min(dt * 4, 1);
        },
      });

      function buildCrank(pivot, root, side) {
        var crank = document.createElement('a-entity');
        crank.classList.add('grip-interactable');
        crank.setAttribute('position', { x: side * 0.33, y: -0.02, z: 0.08 });
        siegeBox(crank, { x: 0.055, y: 0.035, z: 0.23 }, { x: 0, y: 0, z: 0.11 }, '#b08b51');
        siegeBox(crank, { x: 0.11, y: 0.055, z: 0.055 }, { x: side * 0.045, y: 0, z: 0.23 }, '#d0aa68').classList.add('machine-grip');
        crank.setAttribute('siege-control', { mode: 'crank', machine: '#' + root.id, grabRadius: 0.2 });
        pivot.appendChild(crank);
      }

      function buildGatling(parent) {
        var parts = buildCarriage('gatling', 1.35);
        parent.appendChild(parts.root);
        var pivot = parts.pivot;
        siegeBox(pivot, { x: 0.36, y: 0.3, z: 0.42 }, { x: 0, y: 0, z: 0.05 }, '#5b4932');
        var cluster = document.createElement('a-entity');
        cluster.classList.add('gatling-cluster');
        pivot.appendChild(cluster);
        for (var i = 0; i < 8; i++) {
          var a = (i / 8) * Math.PI * 2;
          siegeCylinder(cluster, 0.018, 0.92, { x: Math.cos(a) * 0.095, y: Math.sin(a) * 0.095, z: -0.58 }, { x: 90, y: 0, z: 0 }, '#303238');
        }
        siegeCylinder(cluster, 0.15, 0.08, { x: 0, y: 0, z: -0.2 }, { x: 90, y: 0, z: 0 }, '#8c6b35');
        siegeCylinder(cluster, 0.13, 0.08, { x: 0, y: 0, z: -0.98 }, { x: 90, y: 0, z: 0 }, '#8c6b35');
        var muzzle = document.createElement('a-entity');
        muzzle.classList.add('siege-muzzle');
        muzzle.setAttribute('position', { x: 0, y: 0, z: -1.06 });
        pivot.appendChild(muzzle);
        addSights(pivot, 0.13, -0.93, 0.2);
        buildCrank(pivot, parts.root, -1);
        buildCrank(pivot, parts.root, 1);
        parts.root.setAttribute('gatling-gun', '');
      }

      registerComponent('gatling-gun', {
        init: function () {
          this.cluster = this.el.querySelector('.gatling-cluster');
          this.muzzle = this.el.querySelector('.siege-muzzle');
          this.travel = 0;
          this.lastShot = 0;
          this._origin = new THREE.Vector3();
          this._direction = new THREE.Vector3();
          this._end = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
        },

        turnCrank: function (delta, time) {
          this.travel += delta;
          this.cluster.object3D.rotation.z += delta * 1.8;
          while (this.travel >= 0.42 && time - this.lastShot >= 55) {
            this.travel -= 0.42;
            this.lastShot = time;
            this.fire();
          }
        },

        fire: function () {
          this.muzzle.object3D.getWorldPosition(this._origin);
          this.muzzle.object3D.getWorldQuaternion(this._quat);
          this._direction.set((Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012, -1).normalize().applyQuaternion(this._quat);
          var hit = castShot(this._origin, this._direction);
          this._end.copy(hit ? hit.point : this._origin.clone().addScaledVector(this._direction, MAX_SHOT_RANGE));
          if (hit) hit.el.emit('shot', { point: hit.point.clone(), direction: this._direction.clone(), damage: 1.5 }, false);
          spawnTracer(this._origin, this._end);
          spawnSmoke(this._origin, this._direction, 0.45);
          spawnSparks(this._origin, 2);
          playNoise({ duration: 0.08, freq: 620, q: 0.7, volume: 0.08 });
          this.el.emit('siege-fired', { kind: 'gatling' }, false);
        },
      });

      function buildCannon(parent) {
        var parts = buildCarriage('cannon', -1.35);
        parent.appendChild(parts.root);
        var pivot = parts.pivot;
        siegeCylinder(pivot, 0.17, 1.45, { x: 0, y: 0, z: -0.48 }, { x: 90, y: 0, z: 0 }, '#383a38');
        siegeCylinder(pivot, 0.23, 0.18, { x: 0, y: 0, z: 0.18 }, { x: 90, y: 0, z: 0 }, '#2e302f');
        var muzzle = document.createElement('a-entity');
        muzzle.classList.add('cannon-muzzle');
        muzzle.setAttribute('position', { x: 0, y: 0, z: -1.22 });
        pivot.appendChild(muzzle);
        var chamber = document.createElement('a-entity');
        chamber.id = 'cannon-chamber-' + SIEGE_SERIAL++;
        chamber.classList.add('anchor-slot', 'cannon-chamber');
        chamber.setAttribute('position', { x: 0, y: 0, z: 0.39 });
        chamber.setAttribute('anchor-slot', {
          size: 'large',
          capacity: 7,
          capacityUnits: CANNON_CAPACITY_UNITS,
          fanSpread: 0.05,
          fanAxis: 'x',
          indicatorScale: 0.8,
          idleHidden: false,
        });
        pivot.appendChild(chamber);

        // An intentionally game-friendly breech loader. Grip the brass
        // latch and pull that hand's trigger; the door swings aside and
        // the ordinary anchor-slot behind it becomes the loading target.
        var hatchHinge = document.createElement('a-entity');
        hatchHinge.classList.add('cannon-hatch-hinge');
        hatchHinge.setAttribute('position', { x: -0.19, y: 0, z: 0.37 });
        var hatchLid = siegeCylinder(hatchHinge, 0.19, 0.045, { x: 0.19, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }, '#343735');
        hatchLid.classList.add('cannon-hatch-lid');
        siegeCylinder(hatchLid, 0.055, 0.052, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, '#a27b3e');
        pivot.appendChild(hatchHinge);

        var loadingGlow = document.createElement('a-torus');
        loadingGlow.classList.add('cannon-loading-glow');
        loadingGlow.setAttribute('radius', 0.205);
        loadingGlow.setAttribute('radius-tubular', 0.012);
        loadingGlow.setAttribute('position', { x: 0, y: 0, z: 0.405 });
        loadingGlow.setAttribute('material', 'color: #ffd85c; emissive: #ffb51f; emissiveIntensity: 1.4; shader: standard; transparent: true; opacity: 0');
        loadingGlow.setAttribute('visible', false);
        pivot.appendChild(loadingGlow);

        var hatchControl = document.createElement('a-entity');
        hatchControl.classList.add('grip-interactable', 'cannon-hatch-control');
        hatchControl.setAttribute('position', { x: 0.24, y: -0.02, z: 0.43 });
        siegeBox(hatchControl, { x: 0.14, y: 0.06, z: 0.07 }, { x: 0, y: 0, z: 0 }, '#d0aa68').classList.add('machine-grip');
        hatchControl.setAttribute('siege-control', { mode: 'hatch', machine: '#' + parts.root.id, grabRadius: 0.2 });
        pivot.appendChild(hatchControl);

        var fuse = document.createElement('a-entity');
        fuse.classList.add('cannon-fuse');
        fuse.setAttribute('position', { x: 0, y: 0.2, z: 0.18 });
        siegeCylinder(fuse, 0.008, 0.18, { x: 0, y: 0.07, z: 0 }, { x: 0, y: 0, z: -18 }, '#756041');
        var ember = document.createElement('a-sphere');
        ember.classList.add('ember');
        ember.setAttribute('radius', 0.014);
        ember.setAttribute('position', { x: 0.028, y: 0.155, z: 0 });
        ember.setAttribute('color', '#6b5a3a');
        fuse.appendChild(ember);
        fuse.setAttribute('lightable', { tipSelector: '.ember' });
        fuse.setAttribute('cannon-fuse', { cannon: '#' + parts.root.id });
        pivot.appendChild(fuse);

        var gauge = document.createElement('a-entity');
        gauge.classList.add('cannon-gauge');
        gauge.setAttribute('position', { x: 0, y: 0.27, z: 0.31 });
        for (var i = 0; i < 7; i++) {
          var pip = siegeBox(gauge, { x: 0.025, y: 0.035, z: 0.012 }, { x: (i - 3) * 0.032, y: 0, z: 0 }, '#423b31');
          pip.classList.add('gauge-pip');
        }
        pivot.appendChild(gauge);
        addSights(pivot, 0.05, -1.08, 0.22);
        parts.root.setAttribute('cannon', '');
      }

      registerComponent('cannon-fuse', {
        schema: { cannon: { type: 'string' } },
        init: function () {
          this.remaining = 0;
          this.sparkTimer = 0;
          this.smokeTimer = 0;
          this.crackleTimer = 0;
          this.ember = this.el.querySelector('.ember');
          this._tip = new THREE.Vector3();
          this.onIgnite = this.onIgnite.bind(this);
          this.el.addEventListener('ignite', this.onIgnite);
        },
        onIgnite: function () {
          this.remaining = CANNON_FUSE_MS;
          this.sparkTimer = 0;
          this.smokeTimer = 0;
          this.crackleTimer = 0;
          this.ember.setAttribute('color', '#ffd257');
          var cannonEl = document.querySelector(this.data.cannon);
          var cannon = cannonEl && cannonEl.components.cannon;
          if (cannon) cannon.closeHatch();
        },
        tick: function (time, dt) {
          if (!this.remaining) return;
          var elapsed = dt || 16;
          this.remaining -= elapsed;
          this.sparkTimer -= elapsed;
          this.smokeTimer -= elapsed;
          this.crackleTimer -= elapsed;
          this.ember.object3D.getWorldPosition(this._tip);
          if (this.sparkTimer <= 0) {
            this.sparkTimer = 45;
            spawnSparks(this._tip, 2 + Math.floor(Math.random() * 3));
          }
          if (this.smokeTimer <= 0) {
            this.smokeTimer = 90;
            spawnSmoke(this._tip, new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.25, (Math.random() - 0.5) * 0.25), 0.55);
          }
          if (this.crackleTimer <= 0) {
            this.crackleTimer = 170 + Math.random() * 100;
            playNoise({ duration: 0.045, freq: 1800 + Math.random() * 1400, q: 0.8, volume: 0.045, filterType: 'highpass' });
          }
          if (this.remaining > 0) return;
          this.remaining = 0;
          var cannonEl = document.querySelector(this.data.cannon);
          var cannon = cannonEl && cannonEl.components.cannon;
          if (cannon) cannon.fire();
          var lightable = this.el.components.lightable;
          if (lightable) lightable.extinguish();
          this.ember.setAttribute('color', '#6b5a3a');
        },
      });

      registerComponent('cannon', {
        init: function () {
          this.chamberEl = this.el.querySelector('.cannon-chamber');
          this.muzzle = this.el.querySelector('.cannon-muzzle');
          this.pips = this.el.querySelectorAll('.gauge-pip');
          this.pivot = this.el.querySelector('.barrel-pivot');
          this.hatchHinge = this.el.querySelector('.cannon-hatch-hinge');
          this.loadingGlow = this.el.querySelector('.cannon-loading-glow');
          this.hatchOpen = false;
          this.hatchAngle = 0;
          this.recoilVelocity = 0;
          this.shakeRemaining = 0;
          this._pivotBase = this.pivot ? this.pivot.object3D.position.clone() : new THREE.Vector3();
          this._origin = new THREE.Vector3();
          this._forward = new THREE.Vector3();
          this._right = new THREE.Vector3();
          this._up = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
        },
        toggleHatch: function () {
          var fuse = this.el.querySelector('.cannon-fuse');
          var fuseComp = fuse && fuse.components['cannon-fuse'];
          if (fuseComp && fuseComp.remaining > 0) {
            playClunk();
            return;
          }
          this.hatchOpen = !this.hatchOpen;
          playTone({ type: 'square', freq: this.hatchOpen ? 470 : 250, duration: 0.08, volume: 0.08 });
          if (!this.hatchOpen) playClunk();
        },
        closeHatch: function () {
          if (!this.hatchOpen) return;
          this.hatchOpen = false;
          playClunk();
        },
        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var slot = this.chamberEl && this.chamberEl.components['anchor-slot'];
          if (slot) {
            slot.accepting = this.hatchOpen;
            var fill = slot.usedUnits() / CANNON_CAPACITY_UNITS;
            for (var i = 0; i < this.pips.length; i++) this.pips[i].setAttribute('color', (i + 1) / this.pips.length <= fill + 0.001 ? '#f2c14d' : '#423b31');
          }

          var wantedHatchAngle = this.hatchOpen ? -112 : 0;
          var hatchStep = 360 * dtSeconds * (wantedHatchAngle > this.hatchAngle ? 1 : -1);
          this.hatchAngle = Math.abs(wantedHatchAngle - this.hatchAngle) <= Math.abs(hatchStep) ? wantedHatchAngle : this.hatchAngle + hatchStep;
          if (this.hatchHinge) this.hatchHinge.object3D.rotation.y = (this.hatchAngle * Math.PI) / 180;
          if (this.loadingGlow) {
            this.loadingGlow.setAttribute('visible', this.hatchOpen);
            if (this.hatchOpen) {
              var pulse = 0.58 + Math.sin((time || 0) * 0.009) * 0.24;
              this.loadingGlow.setAttribute('material', 'opacity', pulse);
            }
          }

          if (this.recoilVelocity > 0.01) {
            var travel = this.recoilVelocity * dtSeconds;
            this.el.object3D.translateZ(travel);
            this.recoilVelocity *= Math.exp(-4.2 * dtSeconds);
            var wheels = this.el.querySelectorAll('.siege-wheel');
            for (var w = 0; w < wheels.length; w++) wheels[w].object3D.rotation.x -= travel / 0.31;
          }

          if (this.pivot) {
            this.pivot.object3D.position.copy(this._pivotBase);
            if (this.shakeRemaining > 0) {
              this.shakeRemaining = Math.max(0, this.shakeRemaining - dtSeconds);
              var strength = this.shakeRemaining / 0.75;
              this.pivot.object3D.position.x += (Math.random() - 0.5) * 0.055 * strength;
              this.pivot.object3D.position.y += (Math.random() - 0.5) * 0.04 * strength;
              this.pivot.object3D.position.z += (Math.random() - 0.5) * 0.07 * strength;
            }
          }
        },
        fire: function () {
          var slot = this.chamberEl && this.chamberEl.components['anchor-slot'];
          if (!slot || !slot.occupants.length) {
            playClunk();
            return;
          }
          var payloads = slot.occupants.slice();
          this.muzzle.object3D.getWorldPosition(this._origin);
          this.muzzle.object3D.getWorldQuaternion(this._quat);
          this._forward.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          this._right.set(1, 0, 0).applyQuaternion(this._quat).normalize();
          this._up.copy(_siegeUp);
          for (var i = 0; i < payloads.length; i++) {
            var item = payloads[i];
            var units = item.data.loadUnits || ({ large: 105, medium: 35, small: 21 }[item.data.itemSize] || 21);
            var spreadDeg = units >= 100 ? 0.45 : units >= 35 ? 3 : units >= 21 ? 6.5 : 10;
            var tangent = Math.tan((spreadDeg * Math.PI) / 180);
            var direction = this._forward.clone()
              .addScaledVector(this._right, (Math.random() - 0.5) * 2 * tangent)
              .addScaledVector(this._up, (Math.random() - 0.5) * 2 * tangent)
              .normalize();
            item.vacateSlot();
            item.el.sceneEl.object3D.attach(item.el.object3D);
            item.el.object3D.position.copy(this._origin).addScaledVector(direction, 0.12 + i * 0.018);
            var velocity = direction.multiplyScalar(units >= 100 ? 55 : 38);
            velocity.isHurl = true;
            item.throwWithVelocity(velocity);
            var piercer = item.el.components['piercing-projectile'];
            if (piercer) piercer.arm();
            var ballistic = item.el.components['ballistic-projectile'];
            if (ballistic) ballistic.arm(this._origin);
          }
          this.closeHatch();
          this.recoilVelocity = 2.35;
          this.shakeRemaining = 0.75;
          spawnCannonCloud(this._origin, this._forward);
          playCannonBlast();
          this.el.emit('siege-fired', { kind: 'cannon', payloadCount: payloads.length }, false);
        },
      });

      defineItem('cannonball', function (el, slotId) {
        el.classList.add('shootable');
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          grabRadius: 0.16,
          comOffset: { x: 0, y: 0, z: 0 },
          maxThrowSpeed: 4,
          gravityScale: 1,
          impactDamage: CANNONBALL_DAMAGE,
          loadUnits: CANNON_CAPACITY_UNITS,
        });
        el.setAttribute('geometry', { primitive: 'sphere', radius: 0.115, segmentsWidth: 12, segmentsHeight: 8 });
        el.setAttribute('material', 'color: #2d302f; roughness: 0.72; metalness: 0.2');
        el.setAttribute('piercing-projectile', { damage: CANNONBALL_DAMAGE });
        el.setAttribute('ballistic-projectile', { maxDistance: 82, maxFlightMs: 6000, despawnBelowY: -8 });
      });

      // Armed only by the cannon. A hand-thrown ball still behaves as
      // an ordinary heavy prop and lands on the dirt; a fired one keeps
      // following its real ballistic arc below ground level, then is
      // swept away once it is safely beyond the useful play space.
      registerComponent('ballistic-projectile', {
        schema: {
          maxDistance: { type: 'number', default: 80 },
          maxFlightMs: { type: 'number', default: 6000 },
          despawnBelowY: { type: 'number', default: -8 },
        },
        init: function () {
          this.active = false;
          this.elapsed = 0;
          this.origin = new THREE.Vector3();
          this.world = new THREE.Vector3();
        },
        arm: function (origin) {
          this.active = true;
          this.elapsed = 0;
          this.origin.copy(origin);
        },
        updateFlight: function (holsterable, dt) {
          if (!this.active) return false;
          this.elapsed += dt * 1000;
          holsterable.el.object3D.getWorldPosition(this.world);
          if (
            this.world.distanceToSquared(this.origin) >= this.data.maxDistance * this.data.maxDistance ||
            this.world.y <= this.data.despawnBelowY ||
            this.elapsed >= this.data.maxFlightMs
          ) {
            this.active = false;
            holsterable.state = 'spent';
            despawnItem(this.el);
          }
          return true;
        },
      });

      registerComponent('piercing-projectile', {
        schema: {
          damage: { type: 'number', default: 20 },
          velocityRetention: { type: 'number', default: 0.72 },
          damageRetention: { type: 'number', default: 0.68 },
        },
        init: function () {
          this.ray = new THREE.Raycaster();
          this.hitKeys = [];
          this.currentDamage = this.data.damage;
          this._origin = new THREE.Vector3();
          this._direction = new THREE.Vector3();
        },
        arm: function () {
          this.hitKeys.length = 0;
          this.currentDamage = this.data.damage;
        },
        checkImpact: function (holsterable, dt) {
          var speed = holsterable.fallVelocity.length();
          if (speed < 1.5) return false;
          this._direction.copy(holsterable.fallVelocity).divideScalar(speed);
          holsterable.el.object3D.getWorldPosition(this._origin);
          this._origin.addScaledVector(this._direction, -speed * dt);
          this.ray.set(this._origin, this._direction);
          this.ray.near = 0;
          this.ray.far = speed * dt + holsterable.data.grabRadius;
          var hits = this.ray.intersectObjects(gatherShootableRoots(), true);
          var struck = false;
          for (var i = 0; i < hits.length; i++) {
            var hitEl = resolveShootable(hits[i].object);
            if (!hitEl || hitEl === this.el || this.el.contains(hitEl)) continue;
            var key = hitEl.closest('[pop-target]') || hitEl;
            if (this.hitKeys.indexOf(key) !== -1) continue;
            this.hitKeys.push(key);
            hitEl.emit('shot', { point: hits[i].point.clone(), direction: this._direction.clone(), damage: this.currentDamage }, false);
            this.el.emit('impact', { point: hits[i].point.clone(), direction: this._direction.clone(), speed: speed, damage: this.currentDamage, hitEl: hitEl }, false);
            holsterable.fallVelocity.multiplyScalar(this.data.velocityRetention);
            this.currentDamage *= this.data.damageRetention;
            struck = true;
            if (this.currentDamage < 2 || holsterable.fallVelocity.length() < 3) break;
          }
          // Own the entire cast while in flight. Falling through to
          // generic impact handling on an empty frame would let the
          // back face of a target stop a ball that just pierced it.
          return true;
        },
      });

      function buildCannonballRack(parent) {
        var rack = document.createElement('a-entity');
        rack.setAttribute('position', { x: -2.0, y: 0, z: -0.8 });
        siegeBox(rack, { x: 0.42, y: 0.12, z: 0.36 }, { x: 0, y: 0.06, z: 0 }, '#5a402b');
        for (var i = 0; i < 3; i++) {
          var slot = document.createElement('a-entity');
          slot.id = 'cannonball-rack-' + SIEGE_SERIAL++;
          slot.classList.add('anchor-slot');
          slot.setAttribute('anchor-slot', { size: 'large', indicatorScale: 0.45 });
          slot.setAttribute('position', { x: (i - 1) * 0.14, y: 0.18, z: 0 });
          slot.setAttribute('stocked', { item: 'cannonball', refillMs: 900 });
          rack.appendChild(slot);
        }
        parent.appendChild(rack);
      }

      registerComponent('siege-battery', {
        init: function () {
          buildCannon(this.el);
          buildGatling(this.el);
          buildCannonballRack(this.el);
        },
      });
