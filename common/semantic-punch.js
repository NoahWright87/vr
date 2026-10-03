import './desktop-input.js';

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  AFRAME.registerComponent('semantic-punch-controls', {
    schema: {
      camera: { type: 'selector' },
      leftHand: { type: 'selector' },
      rightHand: { type: 'selector' },
    },

    init: function () {
      this.cameraPosition = new THREE.Vector3();
      this.cameraQuaternion = new THREE.Quaternion();
      this.yawQuaternion = new THREE.Quaternion();
      this.worldPosition = new THREE.Vector3();
      this.worldQuaternion = new THREE.Quaternion();
      this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
      this.onIntent = this.onIntent.bind(this);
      this.onMotionComplete = this.onMotionComplete.bind(this);
      this.el.addEventListener('semantic-action-intent', this.onIntent);
      if (this.data.leftHand) this.data.leftHand.addEventListener('semantic-hand-motion-complete', this.onMotionComplete);
      if (this.data.rightHand) this.data.rightHand.addEventListener('semantic-hand-motion-complete', this.onMotionComplete);
    },

    isBlocked: function () {
      return this.el.sceneEl.getAttribute('data-world-menu-open') === 'true';
    },

    getWorldFrame: function (offset) {
      this.data.camera.object3D.getWorldPosition(this.cameraPosition);
      this.data.camera.object3D.getWorldQuaternion(this.cameraQuaternion);
      this.euler.setFromQuaternion(this.cameraQuaternion);
      this.yawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);
      return {
        position: this.worldPosition.copy(offset).applyQuaternion(this.yawQuaternion).add(this.cameraPosition).clone(),
        quaternion: this.worldQuaternion.copy(this.yawQuaternion).clone(),
      };
    },

    getSide: function (handEl) {
      var hand = handEl && handEl.components['semantic-hand'];
      return hand && hand.data.hand === 'left' ? -1 : 1;
    },

    startWindup: function (action, handEl) {
      var hand = handEl && handEl.components['semantic-hand'];
      if (!hand || !this.data.camera) return;
      var side = this.getSide(handEl);
      var offset = action === 'uppercut'
        ? new THREE.Vector3(side * 0.2, -0.54, -0.08)
        : new THREE.Vector3(side * 0.24, -0.31, 0.1);
      var windup = this.getWorldFrame(offset);
      hand.cancelMotion();
      handEl.setAttribute('data-semantic-action-active', action);
      hand.setWorldTransform(windup.position, windup.quaternion, 'Hold', false);
    },

    performPunch: function (action, handEl, strength) {
      var hand = handEl && handEl.components['semantic-hand'];
      if (!hand || !this.data.camera) return;
      var side = this.getSide(handEl);
      var power = Math.max(0.35, Math.min(1, strength || 0.35));
      var strikeOffset;
      if (action === 'uppercut') {
        strikeOffset = new THREE.Vector3(side * 0.12, 0.5 + power * 0.12, -0.22);
      } else {
        strikeOffset = new THREE.Vector3(side * 0.1, -0.24, -0.58 - power * 0.16);
      }
      var strike = this.getWorldFrame(strikeOffset);
      var recover = this.getWorldFrame(new THREE.Vector3(side * 0.24, -0.34, -0.14));
      hand.runWorldMotion([
        {
          position: strike.position,
          quaternion: strike.quaternion,
          pose: 'Hold',
          duration: 175 - power * 80,
        },
        {
          position: recover.position,
          quaternion: recover.quaternion,
          pose: 'Hold',
          duration: 230,
        },
      ], { action: action, source: 'desktop' });
    },

    onIntent: function (evt) {
      if (!evt.detail || (evt.detail.action !== 'jab' && evt.detail.action !== 'uppercut')) return;
      var handEl = evt.detail.handEl;
      if (evt.detail.phase === 'cancel' || this.isBlocked()) {
        if (handEl) handEl.removeAttribute('data-semantic-action-active');
        return;
      }
      if (evt.detail.phase === 'start') this.startWindup(evt.detail.action, handEl);
      if (evt.detail.phase === 'perform') this.performPunch(evt.detail.action, handEl, evt.detail.strength);
    },

    onMotionComplete: function (evt) {
      evt.target.removeAttribute('data-semantic-action-active');
      var hand = evt.target.components['semantic-hand'];
      if (hand) hand.playPose('Open');
    },

    remove: function () {
      this.el.removeEventListener('semantic-action-intent', this.onIntent);
      if (this.data.leftHand) this.data.leftHand.removeEventListener('semantic-hand-motion-complete', this.onMotionComplete);
      if (this.data.rightHand) this.data.rightHand.removeEventListener('semantic-hand-motion-complete', this.onMotionComplete);
    },
  });
}
