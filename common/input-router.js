import './control-mode.js';
import { chargedActionStrength } from './desktop-action-utils.js';

export function applyInputDeadzone(value, deadzone = 0.18) {
  var magnitude = Math.abs(Number(value) || 0);
  var threshold = Math.max(0, Math.min(0.95, Number(deadzone) || 0));
  if (magnitude <= threshold) return 0;
  return Math.sign(value) * (magnitude - threshold) / (1 - threshold);
}

export function createStandardGamepadButtonBindings(actions) {
  return {
    0: actions.primary,
    1: actions.back,
    2: actions.interact,
    3: actions.watch,
    4: actions.grab,
    5: actions.secondary,
    6: actions.secondary,
    7: actions.primary,
    9: actions.watch,
    10: actions.sprint || actions.crouch,
  };
}

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  AFRAME.registerSystem('input-router', {
    init: function () {
      this.gamepad = null;
      this.hasTouch = Boolean(
        navigator.maxTouchPoints > 0 ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        new URLSearchParams(window.location.search).get('touch') === '1'
      );
      this.activeFamily = this.hasTouch ? 'touch' : 'keyboard';
      this.lastFlatFamily = this.activeFamily;
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onControlModeChanged = this.onControlModeChanged.bind(this);
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('pointerdown', this.onPointerDown, true);
      this.sceneEl.addEventListener('control-mode-changed', this.onControlModeChanged);
      this.publish();
    },

    onKeyDown: function () {
      this.setActiveFamily('keyboard');
    },

    onPointerDown: function (evt) {
      var virtualTouchControl = this.hasTouch && evt.target && evt.target.closest && evt.target.closest('.semantic-touch-controls');
      this.setActiveFamily(evt.pointerType === 'touch' || virtualTouchControl ? 'touch' : 'keyboard');
    },

    onControlModeChanged: function (evt) {
      this.setActiveFamily(evt.detail.mode === 'xr' ? 'xr' : this.lastFlatFamily, true);
    },

    setActiveFamily: function (family, force) {
      if (family !== 'xr') this.lastFlatFamily = family;
      if (!force && this.activeFamily === family) return;
      var previousFamily = this.activeFamily;
      this.activeFamily = family;
      this.publish();
      this.sceneEl.emit('input-family-changed', {
        family: family,
        previousFamily: previousFamily,
        hasTouch: this.hasTouch,
        hasGamepad: Boolean(this.gamepad),
      }, false);
    },

    publish: function () {
      this.sceneEl.setAttribute('data-input-family', this.activeFamily);
      this.sceneEl.setAttribute('data-has-touch', this.hasTouch ? 'true' : 'false');
      document.documentElement.setAttribute('data-input-family', this.activeFamily);
      document.documentElement.setAttribute('data-has-touch', this.hasTouch ? 'true' : 'false');
    },

    getActiveFamily: function () {
      return this.activeFamily;
    },

    getGamepad: function () {
      return this.gamepad;
    },

    tick: function () {
      var mode = this.sceneEl.systems['control-mode'];
      if (mode && mode.isMode('xr')) {
        if (this.activeFamily !== 'xr') this.setActiveFamily('xr', true);
        return;
      }
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      var next = null;
      for (var i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) {
          next = pads[i];
          break;
        }
      }
      var hadGamepad = Boolean(this.gamepad);
      this.gamepad = next;
      if (!next) {
        if (hadGamepad && this.activeFamily === 'gamepad') {
          this.setActiveFamily(this.hasTouch ? 'touch' : 'keyboard');
        }
        return;
      }
      var meaningfulAxis = Array.prototype.some.call(next.axes || [], function (axis) {
        return Math.abs(axis) > 0.22;
      });
      var meaningfulButton = Array.prototype.some.call(next.buttons || [], function (button) {
        return button && (button.pressed || button.value > 0.25);
      });
      if (meaningfulAxis || meaningfulButton) this.setActiveFamily('gamepad');
    },

    remove: function () {
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('pointerdown', this.onPointerDown, true);
      this.sceneEl.removeEventListener('control-mode-changed', this.onControlModeChanged);
    },
  });

  AFRAME.registerComponent('input-family-visibility', {
    schema: {
      families: { default: 'keyboard|gamepad|touch|xr' },
    },

    init: function () {
      this.router = this.el.sceneEl.systems['input-router'];
      this.authoredVisible = this.el.getAttribute('visible') !== false;
      this.onChanged = this.applyVisibility.bind(this);
      this.el.sceneEl.addEventListener('input-family-changed', this.onChanged);
      this.applyVisibility();
    },

    applyVisibility: function () {
      var accepted = String(this.data.families).split(/[|,\s]+/);
      var visible = this.authoredVisible && accepted.indexOf(this.router.getActiveFamily()) !== -1;
      this.el.object3D.visible = visible;
      this.el.setAttribute('data-input-family-visible', visible ? 'true' : 'false');
    },

    remove: function () {
      this.el.sceneEl.removeEventListener('input-family-changed', this.onChanged);
      this.el.object3D.visible = this.authoredVisible;
    },
  });

  AFRAME.registerComponent('semantic-look-controls', {
    schema: {
      camera: { type: 'selector' },
      gamepadDegreesPerSecond: { default: 150 },
      touchDegreesPerPixel: { default: 0.16 },
      invertY: { default: false },
    },

    init: function () {
      this.onLook = this.onLook.bind(this);
      this.el.addEventListener('semantic-look', this.onLook);
    },

    onLook: function (evt) {
      if (!evt.detail || !this.data.camera) return;
      var detail = evt.detail;
      var yawDelta;
      var pitchDelta;
      if (detail.kind === 'delta') {
        yawDelta = -THREE.MathUtils.degToRad(detail.x * this.data.touchDegreesPerPixel);
        pitchDelta = -THREE.MathUtils.degToRad(detail.y * this.data.touchDegreesPerPixel);
      } else {
        var seconds = Math.min(detail.deltaMs || 0, 50) / 1000;
        yawDelta = -THREE.MathUtils.degToRad(detail.x * this.data.gamepadDegreesPerSecond * seconds);
        pitchDelta = -THREE.MathUtils.degToRad(detail.y * this.data.gamepadDegreesPerSecond * seconds);
      }
      if (this.data.invertY) pitchDelta *= -1;
      var look = this.data.camera.components['look-controls'];
      if (look && look.yawObject) {
        look.yawObject.rotation.y += yawDelta;
        if (look.pitchObject) {
          look.pitchObject.rotation.x = THREE.MathUtils.clamp(
            look.pitchObject.rotation.x + pitchDelta,
            -Math.PI / 2,
            Math.PI / 2
          );
        }
        if (look.updateOrientation) look.updateOrientation();
      } else {
        this.data.camera.object3D.rotation.y += yawDelta;
        this.data.camera.object3D.rotation.x = THREE.MathUtils.clamp(
          this.data.camera.object3D.rotation.x + pitchDelta,
          -Math.PI / 2,
          Math.PI / 2
        );
      }
    },

    remove: function () {
      this.el.removeEventListener('semantic-look', this.onLook);
    },
  });

  AFRAME.registerComponent('gamepad-input', {
    schema: {
      leftHand: { type: 'selector' },
      rightHand: { type: 'selector' },
      dominantHand: { default: 'right', oneOf: ['left', 'right'] },
      alternateHands: { default: true },
      primaryAction: { default: 'activate' },
      secondaryAction: { default: 'secondary' },
      interactAction: { default: 'interact' },
      grabAction: { default: 'grab' },
      watchAction: { default: 'watch' },
      backAction: { default: 'back' },
      crouchAction: { default: 'crouch' },
      sprintAction: { default: 'none' },
      deadzone: { default: 0.18 },
      chargeMs: { default: 900 },
      minimumStrength: { default: 0.35 },
    },

    init: function () {
      this.router = this.el.sceneEl.systems['input-router'];
      this.activeButtons = new Map();
      this.nextHand = this.data.dominantHand;
      this.buttonBindings = createStandardGamepadButtonBindings({
        primary: this.data.primaryAction,
        secondary: this.data.secondaryAction,
        interact: this.data.interactAction,
        grab: this.data.grabAction,
        watch: this.data.watchAction,
        back: this.data.backAction,
        crouch: this.data.crouchAction,
        sprint: this.data.sprintAction,
      });
    },

    chooseHand: function () {
      var side = this.nextHand;
      var handEl = side === 'left' ? this.data.leftHand : this.data.rightHand;
      if (!handEl) {
        side = side === 'left' ? 'right' : 'left';
        handEl = side === 'left' ? this.data.leftHand : this.data.rightHand;
      }
      if (this.data.alternateHands) this.nextHand = side === 'left' ? 'right' : 'left';
      return handEl;
    },

    emitAction: function (action, phase, button, handEl, heldMs) {
      if (!action || action === 'none') return;
      this.el.setAttribute('data-last-semantic-action', action + ':' + phase + ':gamepad');
      this.el.emit('semantic-action-intent', {
        action: action,
        phase: phase,
        button: button,
        handEl: handEl,
        heldMs: heldMs,
        strength: chargedActionStrength(heldMs, this.data.chargeMs, this.data.minimumStrength),
        source: 'gamepad',
      }, true);
    },

    updateButtons: function (gamepad) {
      var self = this;
      Object.keys(this.buttonBindings).forEach(function (key) {
        var index = Number(key);
        var button = gamepad.buttons[index];
        var pressed = Boolean(button && (button.pressed || button.value > 0.55));
        var pending = self.activeButtons.get(index);
        if (pressed && !pending) {
          pending = {
            action: self.buttonBindings[index],
            handEl: self.chooseHand(),
            startedAt: performance.now(),
          };
          self.activeButtons.set(index, pending);
          self.emitAction(pending.action, 'start', index, pending.handEl, 0);
        } else if (!pressed && pending) {
          self.activeButtons.delete(index);
          var heldMs = Math.max(0, performance.now() - pending.startedAt);
          self.emitAction(pending.action, 'perform', index, pending.handEl, heldMs);
        }
      });
    },

    cancelButtons: function () {
      var self = this;
      this.activeButtons.forEach(function (pending, index) {
        self.emitAction(pending.action, 'cancel', index, pending.handEl, 0);
      });
      this.activeButtons.clear();
    },

    tick: function (time, delta) {
      var gamepad = this.router.getGamepad();
      if (!gamepad || this.el.sceneEl.systems['control-mode'].isMode('xr')) {
        if (this.activeButtons.size) this.cancelButtons();
        return;
      }
      var moveX = applyInputDeadzone(gamepad.axes[0], this.data.deadzone);
      var moveY = applyInputDeadzone(gamepad.axes[1], this.data.deadzone);
      if (moveX || moveY) {
        this.el.emit('semantic-move', {
          x: moveX,
          z: moveY,
          deltaMs: delta,
          source: 'gamepad',
        }, false);
      }
      var lookX = applyInputDeadzone(gamepad.axes[2], this.data.deadzone);
      var lookY = applyInputDeadzone(gamepad.axes[3], this.data.deadzone);
      if (lookX || lookY) {
        this.el.emit('semantic-look', {
          x: lookX,
          y: lookY,
          deltaMs: delta,
          kind: 'rate',
          source: 'gamepad',
        }, false);
      }
      this.updateButtons(gamepad);
    },

    remove: function () {
      this.cancelButtons();
    },
  });

  AFRAME.registerComponent('touch-controls', {
    schema: {
      leftHand: { type: 'selector' },
      rightHand: { type: 'selector' },
      dominantHand: { default: 'right', oneOf: ['left', 'right'] },
      alternateHands: { default: true },
      primaryAction: { default: 'activate' },
      primaryLabel: { default: 'USE' },
      secondaryAction: { default: 'none' },
      secondaryLabel: { default: 'ALT' },
      interactAction: { default: 'none' },
      interactLabel: { default: 'INTERACT' },
      grabAction: { default: 'none' },
      grabLabel: { default: 'GRAB' },
      watchAction: { default: 'none' },
      watchLabel: { default: 'MENU' },
      crouchAction: { default: 'none' },
      crouchLabel: { default: 'CROUCH' },
      chargeMs: { default: 900 },
      minimumStrength: { default: 0.35 },
    },

    init: function () {
      this.router = this.el.sceneEl.systems['input-router'];
      this.move = { x: 0, z: 0 };
      this.joystickPointer = null;
      this.lookPointer = null;
      this.lookLast = null;
      this.activeActions = new Map();
      this.nextHand = this.data.dominantHand;
      this.onFamilyChanged = this.updateVisibility.bind(this);
      this.el.sceneEl.addEventListener('input-family-changed', this.onFamilyChanged);
      this.createUi();
      this.updateVisibility();
    },

    createUi: function () {
      var root = document.createElement('div');
      root.className = 'semantic-touch-controls';
      root.innerHTML = '<div class="semantic-touch-look" aria-label="Look area"></div>' +
        '<div class="semantic-touch-stick" aria-label="Movement joystick"><div class="semantic-touch-stick-knob"></div></div>' +
        '<div class="semantic-touch-actions"></div>';
      var style = document.createElement('style');
      style.textContent = [
        '.semantic-touch-controls{position:fixed;inset:0;z-index:30;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none}',
        '.semantic-touch-look{position:absolute;inset:0 0 0 38%;pointer-events:auto;touch-action:none}',
        '.semantic-touch-stick{position:absolute;left:max(22px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom));width:112px;height:112px;border-radius:50%;border:2px solid rgba(255,255,255,.65);background:rgba(10,15,25,.38);pointer-events:auto;touch-action:none}',
        '.semantic-touch-stick-knob{position:absolute;left:31px;top:31px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.72);box-shadow:0 2px 8px #0008;transform:translate(0,0)}',
        '.semantic-touch-actions{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(72px,calc(env(safe-area-inset-bottom) + 12px));display:grid;grid-template-columns:repeat(2,74px);gap:12px;pointer-events:none}',
        '.semantic-touch-button{width:74px;height:56px;border:2px solid #fff;border-radius:18px;background:rgba(12,18,30,.7);color:#fff;font:700 12px system-ui;letter-spacing:.03em;pointer-events:auto;touch-action:none;box-shadow:0 2px 9px #0008}',
        '.semantic-touch-button[data-primary="true"]{height:74px;border-radius:50%;background:rgba(20,105,155,.78)}',
        '.semantic-touch-button.is-held{transform:scale(.94);background:rgba(38,170,225,.88)}',
        'html[data-input-family="touch"] #debug-controls,html[data-input-family="touch"] #reset-button-html{display:none!important}',
        '@media (orientation:portrait){.semantic-touch-stick{width:96px;height:96px}.semantic-touch-stick-knob{left:27px;top:27px;width:42px;height:42px}.semantic-touch-actions{grid-template-columns:repeat(2,66px)}.semantic-touch-button{width:66px}}',
      ].join('');
      document.head.appendChild(style);
      document.body.appendChild(root);
      this.root = root;
      this.styleEl = style;
      this.stickEl = root.querySelector('.semantic-touch-stick');
      this.knobEl = root.querySelector('.semantic-touch-stick-knob');
      this.lookEl = root.querySelector('.semantic-touch-look');
      this.actionsEl = root.querySelector('.semantic-touch-actions');
      this.bindJoystick();
      this.bindLook();
      this.addActionButton(this.data.watchAction, this.data.watchLabel, false);
      this.addActionButton(this.data.crouchAction, this.data.crouchLabel, false);
      this.addActionButton(this.data.interactAction, this.data.interactLabel, false);
      this.addActionButton(this.data.grabAction, this.data.grabLabel, false);
      this.addActionButton(this.data.secondaryAction, this.data.secondaryLabel, true);
      this.addActionButton(this.data.primaryAction, this.data.primaryLabel, true);
    },

    bindJoystick: function () {
      var self = this;
      this.stickEl.addEventListener('pointerdown', function (evt) {
        if (self.joystickPointer !== null) return;
        evt.preventDefault(); evt.stopPropagation();
        self.joystickPointer = evt.pointerId;
        self.stickEl.setPointerCapture(evt.pointerId);
        self.updateJoystick(evt);
      });
      this.stickEl.addEventListener('pointermove', function (evt) {
        if (evt.pointerId !== self.joystickPointer) return;
        evt.preventDefault(); evt.stopPropagation(); self.updateJoystick(evt);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
        self.stickEl.addEventListener(name, function (evt) {
          if (evt.pointerId !== self.joystickPointer) return;
          self.joystickPointer = null;
          self.move.x = 0; self.move.z = 0;
          self.knobEl.style.transform = 'translate(0px,0px)';
        });
      });
    },

    updateJoystick: function (evt) {
      var rect = this.stickEl.getBoundingClientRect();
      var dx = evt.clientX - (rect.left + rect.width / 2);
      var dy = evt.clientY - (rect.top + rect.height / 2);
      var radius = rect.width * 0.32;
      var length = Math.hypot(dx, dy);
      if (length > radius) { dx *= radius / length; dy *= radius / length; }
      this.move.x = dx / radius;
      this.move.z = dy / radius;
      this.knobEl.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    },

    bindLook: function () {
      var self = this;
      this.lookEl.addEventListener('pointerdown', function (evt) {
        if (self.lookPointer !== null) return;
        evt.preventDefault(); evt.stopPropagation();
        self.lookPointer = evt.pointerId;
        self.lookLast = { x: evt.clientX, y: evt.clientY };
        self.lookEl.setPointerCapture(evt.pointerId);
      });
      this.lookEl.addEventListener('pointermove', function (evt) {
        if (evt.pointerId !== self.lookPointer || !self.lookLast) return;
        evt.preventDefault(); evt.stopPropagation();
        var dx = evt.clientX - self.lookLast.x;
        var dy = evt.clientY - self.lookLast.y;
        self.lookLast = { x: evt.clientX, y: evt.clientY };
        self.el.emit('semantic-look', { x: dx, y: dy, kind: 'delta', source: 'touch' }, false);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
        self.lookEl.addEventListener(name, function (evt) {
          if (evt.pointerId !== self.lookPointer) return;
          self.lookPointer = null; self.lookLast = null;
        });
      });
    },

    chooseHand: function () {
      var side = this.nextHand;
      var handEl = side === 'left' ? this.data.leftHand : this.data.rightHand;
      if (!handEl) handEl = side === 'left' ? this.data.rightHand : this.data.leftHand;
      if (this.data.alternateHands) this.nextHand = side === 'left' ? 'right' : 'left';
      return handEl;
    },

    addActionButton: function (action, label, primary) {
      if (!action || action === 'none') return;
      var self = this;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'semantic-touch-button';
      button.textContent = label;
      button.dataset.action = action;
      button.dataset.primary = primary ? 'true' : 'false';
      button.setAttribute('aria-label', label);
      button.addEventListener('pointerdown', function (evt) {
        evt.preventDefault(); evt.stopPropagation();
        button.setPointerCapture(evt.pointerId);
        button.classList.add('is-held');
        var pending = { action: action, handEl: self.chooseHand(), startedAt: performance.now() };
        self.activeActions.set(evt.pointerId, pending);
        self.emitAction(pending, 'start', 0);
      });
      function finish(evt, phase) {
        var pending = self.activeActions.get(evt.pointerId);
        if (!pending) return;
        evt.preventDefault(); evt.stopPropagation();
        self.activeActions.delete(evt.pointerId);
        button.classList.remove('is-held');
        self.emitAction(pending, phase, Math.max(0, performance.now() - pending.startedAt));
      }
      button.addEventListener('pointerup', function (evt) { finish(evt, 'perform'); });
      button.addEventListener('pointercancel', function (evt) { finish(evt, 'cancel'); });
      button.addEventListener('lostpointercapture', function (evt) { finish(evt, 'cancel'); });
      this.actionsEl.appendChild(button);
    },

    emitAction: function (pending, phase, heldMs) {
      this.el.setAttribute('data-last-semantic-action', pending.action + ':' + phase + ':touch');
      this.el.emit('semantic-action-intent', {
        action: pending.action,
        phase: phase,
        handEl: pending.handEl,
        heldMs: heldMs,
        strength: chargedActionStrength(heldMs, this.data.chargeMs, this.data.minimumStrength),
        source: 'touch',
      }, true);
    },

    updateVisibility: function () {
      if (!this.root) return;
      var flat = !this.el.sceneEl.systems['control-mode'].isMode('xr');
      var family = this.router.getActiveFamily();
      this.root.style.display = flat && this.router.hasTouch && family === 'touch' ? 'block' : 'none';
    },

    tick: function (time, delta) {
      if (!this.root || this.root.style.display === 'none' || (!this.move.x && !this.move.z)) return;
      this.el.emit('semantic-move', {
        x: this.move.x,
        z: this.move.z,
        deltaMs: delta,
        source: 'touch',
      }, false);
    },

    remove: function () {
      this.el.sceneEl.removeEventListener('input-family-changed', this.onFamilyChanged);
      var self = this;
      this.activeActions.forEach(function (pending) {
        self.emitAction(pending, 'cancel', 0);
      });
      this.activeActions.clear();
      if (this.root) this.root.remove();
      if (this.styleEl) this.styleEl.remove();
    },
  });

  AFRAME.registerComponent('semantic-gaze-action', {
    schema: {
      cursor: { type: 'selector' },
      action: { default: 'activate' },
    },

    init: function () {
      this.onAction = this.onAction.bind(this);
      this.el.addEventListener('semantic-action-intent', this.onAction);
    },

    onAction: function (evt) {
      if (!evt.detail || evt.detail.action !== this.data.action || evt.detail.phase !== 'perform') return;
      var cursor = this.data.cursor && this.data.cursor.components.cursor;
      var raycaster = this.data.cursor && this.data.cursor.components.raycaster;
      var target = (cursor && cursor.intersectedEl) ||
        (raycaster && raycaster.intersectedEls && raycaster.intersectedEls[0]);
      this.el.setAttribute('data-last-gaze-target', target ? (target.id || target.className || target.tagName) : 'none');
      if (target) target.emit('click', { source: evt.detail.source }, false);
    },

    remove: function () {
      this.el.removeEventListener('semantic-action-intent', this.onAction);
    },
  });
}
