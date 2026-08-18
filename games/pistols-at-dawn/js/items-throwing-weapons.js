      // ==============================================================
      // ITEMS: vest + throwing weapons
      // A wearable vest owns two ordinary small swap slots. Its
      // default occupants are equipment packs, and each pack owns a
      // refilling slot of its own. The visible knife/star is therefore
      // a real holsterable item, drawn with the ordinary grip gesture;
      // the pack is supply, not a magical trigger-button inventory.
      // ==============================================================

      var VEST_SLOT_SERIAL = 0;
      var AMMO_PACK_SLOT_SERIAL = 0;
      var THROWING_WEAPON_REFILL_MS = 650;
      var KNIFE_TIP_OFFSET = 0.255;

      defineItem('vest-classic', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'medium',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: 0, y: 0, z: 0 },
          grabRadius: 0.25,
          grabPriority: 30,
          comOffset: { x: 0, y: -0.04, z: 0 },
          maxThrowSpeed: 5,
        });
        // The vest is equipment, not scenery in front of the player's
        // face. Its two packs remain visible and reachable; the body
        // panel itself is intentionally not rendered while worn.
        el.setAttribute('vest', '');
      }, { keep: true });

      defineItem('knife-pack', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          grabRadius: 0.11,
          grabPriority: 20,
          comOffset: { x: 0, y: -0.04, z: 0 },
          maxThrowSpeed: 6,
        });
        el.setAttribute('boxy-ammo-pack', { kind: 'knife' });
        el.setAttribute('ammo-pack', {
          item: 'throwing-knife',
          slotPosition: { x: 0, y: 0.045, z: -0.032 },
          fanSpread: 0.035,
          fanYaw: 6,
        });
      }, { keep: true });

      defineItem('star-pack', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          grabRadius: 0.11,
          grabPriority: 20,
          comOffset: { x: 0, y: -0.04, z: 0 },
          maxThrowSpeed: 6,
        });
        el.setAttribute('boxy-ammo-pack', { kind: 'star' });
        el.setAttribute('ammo-pack', {
          item: 'ninja-star',
          slotPosition: { x: 0, y: 0.02, z: -0.038 },
          fanSpread: 0.025,
          fanYaw: 8,
        });
      }, { keep: true });

      defineItem('throwing-knife', function (el, slotId) {
        el.classList.add('shootable');
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.13,
          grabSpan: { x: 0, y: 0, z: -0.11 },
          comOffset: { x: 0, y: 0, z: -0.105 },
          maxThrowSpeed: 18,
          gravityScale: 0.45,
          impactDamage: 2,
          loadUnits: 15,
        });
        el.setAttribute('boxy-throwing-knife', '');
        el.setAttribute('blade-projectile', { tipOffset: KNIFE_TIP_OFFSET, spinRate: 0, guided: false });
      });

      defineItem('ninja-star', function (el, slotId) {
        el.classList.add('shootable');
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.12,
          comOffset: { x: 0, y: 0, z: 0 },
          maxThrowSpeed: 21,
          gravityScale: 0.28,
          impactDamage: 1,
          loadUnits: 15,
        });
        el.setAttribute('boxy-ninja-star', '');
        el.setAttribute('blade-projectile', { tipOffset: 0.012, spinRate: 24, guided: true, curveRate: 2.6 });
      });

      // ==============================================================
      // The vest's pockets accept any small thing. They start with the
      // two packs, but `swap:true` means bringing some future chest
      // equipment to one is the intended way to replace it.
      // ==============================================================
      registerComponent('vest', {
        init: function () {
          this.pocketSlots = [];
          var stock = ['knife-pack', 'star-pack'];
          [-1, 1].forEach(function (side, i) {
            var slot = document.createElement('a-entity');
            slot.id = 'vest-pocket-' + VEST_SLOT_SERIAL++;
            slot.classList.add('anchor-slot');
            slot.setAttribute('anchor-slot', {
              size: 'small',
              swap: true,
              idleHidden: true,
              indicatorScale: 0.55,
              revealDistance: 0.18,
            });
            slot.setAttribute('position', { x: side * 0.13, y: -0.025, z: -0.04 });
            slot.setAttribute('stocked', { item: stock[i] });
            this.el.appendChild(slot);
            this.pocketSlots.push(slot);
          }, this);
        },
      });

      registerComponent('boxy-vest', {
        init: function () {
          var panel = document.createElement('a-box');
          panel.setAttribute('width', 0.42);
          panel.setAttribute('height', 0.43);
          panel.setAttribute('depth', 0.035);
          panel.setAttribute('position', { x: 0, y: 0, z: 0 });
          panel.setAttribute('color', '#5d4931');
          this.el.appendChild(panel);

          [-1, 1].forEach(function (side) {
            var strap = document.createElement('a-box');
            strap.setAttribute('width', 0.07);
            strap.setAttribute('height', 0.28);
            strap.setAttribute('depth', 0.026);
            // The straps pass over the shoulders behind the headset.
            // Keeping that part behind the view plane avoids two huge
            // leather bars framing the player's normal forward view.
            strap.setAttribute('position', { x: side * 0.17, y: 0.18, z: 0.2 });
            strap.setAttribute('rotation', { x: 0, y: 0, z: side * -12 });
            strap.setAttribute('color', '#3e3022');
            this.el.appendChild(strap);

            var pocket = document.createElement('a-box');
            pocket.setAttribute('width', 0.17);
            pocket.setAttribute('height', 0.17);
            pocket.setAttribute('depth', 0.055);
            pocket.setAttribute('position', { x: side * 0.13, y: -0.055, z: -0.04 });
            pocket.setAttribute('color', '#745a3b');
            this.el.appendChild(pocket);
          }, this);

          var centerSeam = document.createElement('a-box');
          centerSeam.setAttribute('width', 0.018);
          centerSeam.setAttribute('height', 0.41);
          centerSeam.setAttribute('depth', 0.012);
          centerSeam.setAttribute('position', { x: 0, y: 0, z: -0.025 });
          centerSeam.setAttribute('color', '#30271d');
          this.el.appendChild(centerSeam);
        },
      });

      // A pack is a three-capacity stocked slot wearing a pouch. Pull
      // any exposed weapon with GRIP and the ordinary stock component
      // grows one replacement after a short delay.
      registerComponent('ammo-pack', {
        schema: {
          item: { type: 'string' },
          slotPosition: { type: 'vec3', default: { x: 0, y: 0, z: -0.03 } },
          fanSpread: { type: 'number', default: 0.03 },
          fanYaw: { type: 'number', default: 6 },
        },

        init: function () {
          var slot = document.createElement('a-entity');
          slot.id = 'ammo-pack-slot-' + AMMO_PACK_SLOT_SERIAL++;
          slot.classList.add('anchor-slot');
          slot.setAttribute('anchor-slot', {
            size: 'small',
            capacity: 3,
            fanSpread: this.data.fanSpread,
            fanYaw: this.data.fanYaw,
            idleHidden: true,
            indicatorScale: 0.35,
            revealDistance: 0.12,
          });
          slot.setAttribute('position', this.data.slotPosition);
          slot.setAttribute('stocked', {
            item: this.data.item,
            refillMs: THROWING_WEAPON_REFILL_MS,
          });
          this.el.appendChild(slot);
          this.slotEl = slot;
        },
      });

      registerComponent('boxy-ammo-pack', {
        schema: {
          kind: { type: 'string', default: 'knife' },
        },

        init: function () {
          var isKnife = this.data.kind === 'knife';
          var pouch = document.createElement('a-box');
          pouch.setAttribute('width', isKnife ? 0.125 : 0.15);
          pouch.setAttribute('height', isKnife ? 0.14 : 0.12);
          pouch.setAttribute('depth', 0.05);
          pouch.setAttribute('position', { x: 0, y: -0.055, z: 0 });
          pouch.setAttribute('color', isKnife ? '#3f3022' : '#30343a');
          this.el.appendChild(pouch);

          var flap = document.createElement('a-box');
          flap.setAttribute('width', isKnife ? 0.11 : 0.135);
          flap.setAttribute('height', 0.035);
          flap.setAttribute('depth', 0.058);
          flap.setAttribute('position', { x: 0, y: 0.005, z: -0.004 });
          flap.setAttribute('color', isKnife ? '#6b4c2d' : '#555b64');
          this.el.appendChild(flap);
        },
      });

      registerComponent('boxy-throwing-knife', {
        init: function () {
          var handle = document.createElement('a-cylinder');
          handle.setAttribute('radius', 0.014);
          handle.setAttribute('height', 0.085);
          handle.setAttribute('rotation', '90 0 0');
          handle.setAttribute('position', { x: 0, y: 0, z: -0.022 });
          handle.setAttribute('color', '#34291f');
          this.el.appendChild(handle);

          var pommel = document.createElement('a-cylinder');
          pommel.setAttribute('radius', 0.019);
          pommel.setAttribute('height', 0.012);
          pommel.setAttribute('rotation', '90 0 0');
          pommel.setAttribute('position', { x: 0, y: 0, z: 0.026 });
          pommel.setAttribute('color', '#6f7378');
          this.el.appendChild(pommel);

          var guard = document.createElement('a-box');
          guard.setAttribute('width', 0.055);
          guard.setAttribute('height', 0.009);
          guard.setAttribute('depth', 0.014);
          guard.setAttribute('position', { x: 0, y: 0, z: -0.07 });
          guard.setAttribute('color', '#8c9094');
          this.el.appendChild(guard);

          var blade = document.createElement('a-box');
          blade.setAttribute('width', 0.027);
          blade.setAttribute('height', 0.006);
          blade.setAttribute('depth', 0.14);
          blade.setAttribute('position', { x: 0, y: 0, z: -0.145 });
          blade.setAttribute('color', '#b9c1c7');
          this.el.appendChild(blade);

          var tip = document.createElement('a-cone');
          tip.setAttribute('radius-bottom', 0.019);
          tip.setAttribute('radius-top', 0);
          tip.setAttribute('height', 0.05);
          tip.setAttribute('rotation', '-90 0 0');
          tip.setAttribute('position', { x: 0, y: 0, z: -0.23 });
          tip.setAttribute('color', '#d2d8dc');
          this.el.appendChild(tip);
        },
      });

      registerComponent('boxy-ninja-star', {
        init: function () {
          for (var i = 0; i < 4; i++) {
            var blade = document.createElement('a-box');
            blade.setAttribute('width', 0.017);
            blade.setAttribute('height', 0.115);
            blade.setAttribute('depth', 0.006);
            blade.setAttribute('rotation', { x: 0, y: 0, z: i * 45 });
            blade.setAttribute('color', i % 2 ? '#9aa1a6' : '#c1c7ca');
            this.el.appendChild(blade);
          }

          var hub = document.createElement('a-cylinder');
          hub.setAttribute('radius', 0.023);
          hub.setAttribute('height', 0.009);
          hub.setAttribute('rotation', '90 0 0');
          hub.setAttribute('color', '#34383c');
          this.el.appendChild(hub);
        },
      });

      // Shared flight/impact behavior. Knives hold point-first; stars
      // add roll around that forward axis. Both attach their object3D
      // to the thing hit, so a blade rides a target as it tips over.
      registerComponent('blade-projectile', {
        schema: {
          tipOffset: { type: 'number', default: 0 },
          spinRate: { type: 'number', default: 0 },
          guided: { type: 'boolean', default: false },
          curveRate: { type: 'number', default: 0 },
        },

        init: function () {
          this.spin = 0;
          this._forward = new THREE.Vector3(0, 0, -1);
          this._direction = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._world = new THREE.Vector3();
          this._target = new THREE.Vector3();
          this._perfect = new THREE.Vector3();
          this._raw = new THREE.Vector3();
          this._desired = new THREE.Vector3();
          this.curveTarget = null;
          this.curveElapsed = 0;
          this.previousTargetDistance = Infinity;
          this.onImpact = this.onImpact.bind(this);
          this.onThrown = this.onThrown.bind(this);
          this.el.addEventListener('impact', this.onImpact);
          this.el.addEventListener('thrown', this.onThrown);
        },

        remove: function () {
          this.el.removeEventListener('impact', this.onImpact);
          this.el.removeEventListener('thrown', this.onThrown);
        },

        // Hand throws get a release-locked gaze target. Knives take a
        // fast, flat solved arc straight to it. Stars start from a
        // deliberately imperfect blend of that solution and the real
        // hand motion, then visibly bend back toward the same frozen
        // point rather than following the player's gaze like a cursor.
        onThrown: function (evt) {
          var detail = evt.detail || {};
          if (!detail.handVelocity) return; // cannon payloads do not home
          var holsterable = this.el.components.holsterable;
          var camera = document.querySelector('#head-camera');
          if (!holsterable || !camera) return;

          camera.object3D.getWorldPosition(this._world);
          var target = findLookTarget(camera, this._world);
          if (!target) {
            if (holsterable.fallVelocity.lengthSq() > 0.001) holsterable.fallVelocity.setLength(holsterable.data.maxThrowSpeed);
            return;
          }

          this.el.object3D.getWorldPosition(this._world);
          var solved = solveArcAtSpeed(
            this._world,
            target,
            holsterable.data.maxThrowSpeed,
            GRAVITY * holsterable.data.gravityScale,
            this._perfect
          );
          if (!solved) return;

          if (!this.data.guided) {
            holsterable.fallVelocity.copy(solved);
            return;
          }

          var speed = solved.length();
          this._perfect.normalize();
          this._raw.copy(detail.handVelocity);
          if (this._raw.lengthSq() < 0.01) this._raw.copy(this._perfect);
          else this._raw.normalize();
          holsterable.fallVelocity.copy(this._perfect).multiplyScalar(0.68).addScaledVector(this._raw, 0.32).normalize().multiplyScalar(speed);
          this.curveTarget = this._target.copy(target);
          this.curveElapsed = 0;
          this.previousTargetDistance = this._world.distanceTo(this.curveTarget);
        },

        tick: function (time, dt) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'falling') return;
          if (holsterable.fallVelocity.lengthSq() < 1) return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          if (this.curveTarget) {
            this.el.object3D.getWorldPosition(this._world);
            var distance = this._world.distanceTo(this.curveTarget);
            this.curveElapsed += dtSeconds;
            if (distance < 0.22 || this.curveElapsed > 2.2 || (this.curveElapsed > 0.18 && distance > this.previousTargetDistance + 0.02)) {
              this.curveTarget = null;
            } else {
              var speed = holsterable.fallVelocity.length();
              this._direction.copy(holsterable.fallVelocity).normalize();
              this._desired.copy(this.curveTarget).sub(this._world).normalize();
              this._direction.lerp(this._desired, Math.min(this.data.curveRate * dtSeconds, 0.16)).normalize();
              holsterable.fallVelocity.copy(this._direction).multiplyScalar(speed);
              this.previousTargetDistance = distance;
            }
          }

          this._direction.copy(holsterable.fallVelocity).normalize();
          this._quat.setFromUnitVectors(this._forward, this._direction);
          this.el.object3D.quaternion.copy(this._quat);
          if (this.data.spinRate) {
            this.spin = (this.spin + this.data.spinRate * dtSeconds) % (Math.PI * 2);
            this.el.object3D.rotateZ(this.spin);
          }
          holsterable.angularVelocity.set(0, 0, 0);
        },

        onImpact: function (evt) {
          var holsterable = this.el.components.holsterable;
          var detail = evt.detail || {};
          if (!holsterable || !detail.point) return;

          this._direction.copy(detail.direction || holsterable.fallVelocity).normalize();
          this._world.copy(detail.point).addScaledVector(this._direction, -this.data.tipOffset);
          this.el.sceneEl.object3D.attach(this.el.object3D);
          this.el.object3D.position.copy(this._world);
          if (detail.hitEl && detail.hitEl.object3D) {
            detail.hitEl.object3D.attach(this.el.object3D);
          }

          holsterable.fallVelocity.set(0, 0, 0);
          holsterable.angularVelocity.set(0, 0, 0);
          holsterable.state = 'resting';
          playThunk();
        },
      });
