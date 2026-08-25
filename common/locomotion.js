  import './control-mode.js';

  AFRAME.registerComponent('locomotion-demo', {
    schema: {
      moveMode: { default: 'smooth' },
      turnMode: { default: 'snap' },
      speed: { default: 1.5 },
      speedMultiplier: { default: 1 },
      sprintMultiplier: { default: 1.5 },
      snapAngle: { default: 30 },
      teleportDistance: { default: 2.8 },
      comfortVignette: { default: true },
      vignetteStrength: { default: 0.2 },
      vignetteSoftness: { default: 0.45 },
      vignetteInset: { default: 0.78 },
      vignetteRadius: { default: 0.95 },
      moveDeadzone: { default: 0.2 },
      turnDeadzone: { default: 0.25 },
      teleportDeadzone: { default: 0.55 },
      teleportCommitDeadzone: { default: 0.12 },
      teleportMinDistance: { default: 1.0 },
      driftMode: { default: 'medium' },
    },

    init: function () {
      this.rigEl = this.el;
      this.cameraEl = this.el.querySelector('a-camera') || document.querySelector('a-camera');
      this.controlMode = this.el.sceneEl.systems['control-mode'];
      this.turnCooldown = 0;
      this.leftAxes = [0, 0, 0, 0];
      this.rightAxes = [0, 0, 0, 0];
      this._teleportReady = false;
      this._teleportAimX = 0;
      this._teleportAimY = 0;
      this._teleportAimMag = 0;
      this._teleportHand = 'left';
      this.onMenuOptionChange = this.onMenuOptionChange.bind(this);
      this.onSemanticMove = this.onSemanticMove.bind(this);
      this.onSemanticAction = this.onSemanticAction.bind(this);
      this.gamepadSprinting = false;

      var self = this;
      var sceneEl = this.el.sceneEl;
      sceneEl.addEventListener('menu-option-change', this.onMenuOptionChange);
      this.el.addEventListener('semantic-move', this.onSemanticMove);
      this.el.addEventListener('semantic-action-intent', this.onSemanticAction);
      sceneEl.addEventListener('loaded', function () {
        var leftEl = document.querySelector('#left-hand');
        var rightEl = document.querySelector('#right-hand');
        if (leftEl) {
          leftEl.addEventListener('axismove', function (evt) {
            self.leftAxes = evt.detail.axis || self.leftAxes;
          });
        }
        if (rightEl) {
          rightEl.addEventListener('axismove', function (evt) {
            self.rightAxes = evt.detail.axis || self.rightAxes;
          });
        }
      });

      this.teleportPreview = document.createElement('a-ring');
      this.teleportPreview.setAttribute('radius-inner', '0.45');
      this.teleportPreview.setAttribute('radius-outer', '0.6');
      this.teleportPreview.setAttribute('rotation', '-90 0 0');
      this.teleportPreview.setAttribute('material', 'color: #7dd3fc; transparent: true; opacity: 0.75; shader: flat');
      this.teleportPreview.setAttribute('visible', false);
      this.el.parentNode.appendChild(this.teleportPreview);

      this.vignette = document.createElement('a-plane');
      this.vignette.setAttribute('material', 'color: #000; transparent: true; opacity: 0.2; shader: flat');
      this.vignette.setAttribute('width', '1.5');
      this.vignette.setAttribute('height', '1.5');
      this.vignette.setAttribute('position', '0 0 -0.3');
      this.vignette.setAttribute('visible', false);
      this.updateVignetteStyle();
      if (this.cameraEl) this.cameraEl.appendChild(this.vignette);
    },

    setMoveMode: function (mode) {
      this.data.moveMode = mode;
    },

    setTurnMode: function (mode) {
      this.data.turnMode = mode;
    },

    setSpeedMultiplier: function (multiplier) {
      var next = Number(multiplier);
      if (!Number.isFinite(next) || next <= 0) return;
      this.data.speedMultiplier = next;
      this.el.setAttribute('data-move-speed-multiplier', String(next));
    },

    onMenuOptionChange: function (evt) {
      if (!evt.detail || evt.detail.key !== 'move-speed') return;
      this.setSpeedMultiplier(evt.detail.value);
    },

    setVignette: function (enabled) {
      this.data.comfortVignette = !!enabled;
      this.updateVignetteStyle();
    },

    setVignetteStrength: function (strength) {
      this.data.vignetteStrength = strength;
      this.updateVignetteStyle();
    },

    setVignetteSoftness: function (softness) {
      this.data.vignetteSoftness = softness;
      this.updateVignetteStyle();
    },

    setVignetteInset: function (inset) {
      this.data.vignetteInset = inset;
      this.updateVignetteStyle();
    },

    setVignetteRadius: function (radius) {
      this.data.vignetteRadius = radius;
      this.updateVignetteStyle();
    },

    setStickDriftCompensation: function (preset) {
      var map = {
        off: { move: 0.08, turn: 0.08, teleport: 0.35, teleportCommit: 0.05 },
        low: { move: 0.14, turn: 0.16, teleport: 0.45, teleportCommit: 0.08 },
        medium: { move: 0.2, turn: 0.25, teleport: 0.55, teleportCommit: 0.12 },
        high: { move: 0.28, turn: 0.35, teleport: 0.68, teleportCommit: 0.18 },
      };
      var next = map[preset] || map.medium;
      this.data.driftMode = preset || 'medium';
      this.data.moveDeadzone = next.move;
      this.data.turnDeadzone = next.turn;
      this.data.teleportDeadzone = next.teleport;
      this.data.teleportCommitDeadzone = next.teleportCommit;
    },

    updateVignetteStyle: function () {
      if (!this.vignette) return;
      var enabled = this.controlMode.isMode('xr') && !!this.data.comfortVignette && this.data.moveMode === 'smooth';
      var strength = Math.max(0, Math.min(1, this.data.vignetteStrength));
      var softness = Math.max(0.05, Math.min(1, this.data.vignetteSoftness));
      var inset = Math.max(0.25, Math.min(1.2, this.data.vignetteInset));
      var radius = Math.max(0.4, Math.min(1.4, this.data.vignetteRadius));
      this.vignette.setAttribute('visible', enabled);
      this.vignette.setAttribute('width', (1.5 * radius).toFixed(3));
      this.vignette.setAttribute('height', (1.5 * radius).toFixed(3));
      this.vignette.setAttribute('position', '0 0 -' + (0.3 * inset).toFixed(3));
      this.vignette.setAttribute('material', 'color: #000; transparent: true; opacity: ' + (0.08 + 0.32 * strength).toFixed(3) + '; shader: flat; side: double; depthTest: false');
      this.vignette.object3D.scale.setScalar(softness);
    },

    setStationPositions: function (stations) {
      this.stationPositions = stations || {};
    },

    goToStation: function (key) {
      var station = this.stationPositions && this.stationPositions[key];
      if (!station) return;
      var current = this.rigEl.object3D.position;
      var nextY = station.y !== undefined ? station.y : current.y;
      this.rigEl.object3D.position.set(station.x || 0, nextY, station.z || 0);
    },

    updateTeleportPreview: function () {
      if (!this.cameraEl) {
        this.teleportPreview.setAttribute('visible', false);
        return;
      }

      var hand = this.getTeleportHand();
      var axes = hand === 'right' ? this.rightAxes : this.leftAxes;
      var axisX = axes[2] !== undefined ? axes[2] : axes[0] || 0;
      var axisY = axes[3] !== undefined ? axes[3] : axes[1] || 0;
      var active = this.data.moveMode === 'teleport' && (Math.abs(axisX) > this.data.teleportCommitDeadzone || Math.abs(axisY) > this.data.teleportCommitDeadzone);
      if (!active) {
        this.teleportPreview.setAttribute('visible', false);
        return;
      }

      var stickDistance = Math.hypot(axisX, axisY);
      if (stickDistance < this.data.teleportDeadzone) {
        this.teleportPreview.setAttribute('visible', false);
        return;
      }

      var cameraPos = new AFRAME.THREE.Vector3();
      this.cameraEl.object3D.getWorldPosition(cameraPos);
      var direction = new AFRAME.THREE.Vector3(axisX, 0, axisY);
      var cameraQuat = new AFRAME.THREE.Quaternion();
      this.cameraEl.object3D.getWorldQuaternion(cameraQuat);
      direction.applyQuaternion(cameraQuat);
      direction.y = 0;
      if (direction.lengthSq() === 0) direction.set(0, 0, -1);
      direction.normalize();

      var distance = this.data.teleportDistance * Math.min(1, stickDistance);
      var targetPos = cameraPos.clone().add(direction.multiplyScalar(distance));
      targetPos.y = 0.02;
      this.teleportPreview.object3D.position.copy(targetPos);
      this.teleportPreview.setAttribute('visible', true);
    },

    getTeleportHand: function () {
      return this._teleportHand === 'right' ? 'right' : 'left';
    },

    setTeleportHand: function (hand) {
      this._teleportHand = hand === 'right' ? 'right' : 'left';
    },

    applySmoothMove: function (deltaMs) {
      if (this.data.moveMode !== 'smooth') return;
      var moveX = this.leftAxes[2] !== undefined ? this.leftAxes[2] : this.leftAxes[0] || 0;
      var moveY = this.leftAxes[3] !== undefined ? this.leftAxes[3] : this.leftAxes[1] || 0;
      var moveAmount = Math.hypot(moveX, moveY);
      if (moveAmount < this.data.moveDeadzone) return;

      this.applyMoveVector(moveX, moveY, deltaMs);
    },

    // Input-source-neutral movement core. XR thumbsticks and desktop WASD
    // both express a local x/z intent and arrive here.
    applyMoveVector: function (moveX, moveY, deltaMs, sprinting) {
      if (!this.cameraEl) return;

      var direction = new AFRAME.THREE.Vector3(moveX, 0, moveY);
      var cameraQuat = new AFRAME.THREE.Quaternion();
      this.cameraEl.object3D.getWorldQuaternion(cameraQuat);
      var worldMove = direction.applyQuaternion(cameraQuat).setY(0);
      var sprint = sprinting || this.gamepadSprinting;
      var rate = this.data.speed * this.data.speedMultiplier * (sprint ? this.data.sprintMultiplier : 1);
      worldMove.normalize().multiplyScalar(rate * (deltaMs / 1000));
      this.rigEl.object3D.position.add(worldMove);
    },

    applyDesktopMove: function (moveX, moveY, deltaMs, sprinting) {
      var amount = Math.hypot(moveX, moveY);
      if (!amount) return;
      this.applyMoveVector(moveX / amount, moveY / amount, deltaMs, sprinting);
    },

    onSemanticMove: function (evt) {
      if (!evt.detail) return;
      this.applyDesktopMove(evt.detail.x || 0, evt.detail.z || 0, evt.detail.deltaMs || 0, !!evt.detail.sprint);
    },

    onSemanticAction: function (evt) {
      if (!evt.detail || evt.detail.action !== 'sprint') return;
      this.gamepadSprinting = evt.detail.phase === 'start';
    },

    applySmoothTurn: function (deltaMs) {
      var turnX = this.rightAxes[2] !== undefined ? this.rightAxes[2] : this.rightAxes[0] || 0;
      if (Math.abs(turnX) < this.data.turnDeadzone) return;
      this.rigEl.object3D.rotation.y -= turnX * 1.25 * (deltaMs / 1000);
    },

    applySnapTurn: function () {
      var turnX = this.rightAxes[2] !== undefined ? this.rightAxes[2] : this.rightAxes[0] || 0;
      if (Math.abs(turnX) < Math.max(0.8, this.data.turnDeadzone + 0.4)) {
        this.turnCooldown = 0;
        return;
      }
      if (!this.turnCooldown) {
        this.turnCooldown = 1;
        this.rigEl.object3D.rotation.y -= Math.sign(turnX) * AFRAME.THREE.MathUtils.degToRad(this.data.snapAngle);
      }
    },

    tick: function (time, delta) {
      if (this.data.moveMode === 'smooth') {
        this.applySmoothMove(delta);
      } else if (this.data.moveMode === 'teleport') {
        this.updateTeleportPreview();
        var teleportAxes = this.getTeleportHand() === 'right' ? this.rightAxes : this.leftAxes;
        var moveX = teleportAxes[2] !== undefined ? teleportAxes[2] : teleportAxes[0] || 0;
        var moveY = teleportAxes[3] !== undefined ? teleportAxes[3] : teleportAxes[1] || 0;
        var stickDistance = Math.hypot(moveX, moveY);

        if (Math.abs(moveX) < this.data.teleportCommitDeadzone && Math.abs(moveY) < this.data.teleportCommitDeadzone) {
          if (this._teleportReady && this._teleportAimMag >= this.data.teleportDeadzone) {
            var cameraPos = new AFRAME.THREE.Vector3();
            this.cameraEl.object3D.getWorldPosition(cameraPos);
            var cameraQuat = new AFRAME.THREE.Quaternion();
            this.cameraEl.object3D.getWorldQuaternion(cameraQuat);
            var forward = new AFRAME.THREE.Vector3(this._teleportAimX, 0, this._teleportAimY);
            forward.applyQuaternion(cameraQuat);
            forward.y = 0;
            if (forward.lengthSq() === 0) forward.set(0, 0, -1);
            forward.normalize();
            var teleportDistance = this.data.teleportDistance * Math.min(1, this._teleportAimMag);
            if (teleportDistance >= this.data.teleportMinDistance) {
              var targetPos = cameraPos.clone().add(forward.multiplyScalar(teleportDistance));
              targetPos.y = this.rigEl.object3D.position.y;
              this.rigEl.object3D.position.copy(targetPos);
            }
          }
          this._teleportReady = false;
          this._teleportAimX = 0;
          this._teleportAimY = 0;
          this._teleportAimMag = 0;
          this.teleportPreview.setAttribute('visible', false);
        } else if (stickDistance > this.data.teleportDeadzone) {
          this._teleportReady = true;
          this._teleportAimX = moveX;
          this._teleportAimY = moveY;
          this._teleportAimMag = stickDistance;
        } else {
          this._teleportReady = false;
          this._teleportAimX = 0;
          this._teleportAimY = 0;
          this._teleportAimMag = 0;
          this.teleportPreview.setAttribute('visible', false);
        }
      } else {
        this.teleportPreview.setAttribute('visible', false);
        this._teleportReady = false;
        this._teleportAimX = 0;
        this._teleportAimY = 0;
        this._teleportAimMag = 0;
      }

      if (this.data.turnMode === 'smooth') {
        this.applySmoothTurn(delta);
      } else if (this.data.turnMode === 'snap') {
        this.applySnapTurn();
      } else {
        this.turnCooldown = 0;
      }

      if (this.vignette) {
        var lx = this.leftAxes[2] !== undefined ? this.leftAxes[2] : this.leftAxes[0] || 0;
        var ly = this.leftAxes[3] !== undefined ? this.leftAxes[3] : this.leftAxes[1] || 0;
        this.vignette.setAttribute('visible', this.controlMode.isMode('xr') && !!this.data.comfortVignette && this.data.moveMode === 'smooth' && Math.hypot(lx, ly) > 0.12);
      }
    },

    remove: function () {
      this.el.sceneEl.removeEventListener('menu-option-change', this.onMenuOptionChange);
      this.el.removeEventListener('semantic-move', this.onSemanticMove);
      this.el.removeEventListener('semantic-action-intent', this.onSemanticAction);
    },
  });
