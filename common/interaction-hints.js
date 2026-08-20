import {
  chooseInteractionCandidate,
  isWithinSemanticReach,
  shouldShowInteractionHint,
} from './interaction-targeting.js';

var THREE = AFRAME.THREE;
var HAND_MODELS = {
  left: new URL('../vendor/aframe-1.6.0/controllers/hands/leftHandLow.glb', import.meta.url).href,
  right: new URL('../vendor/aframe-1.6.0/controllers/hands/rightHandLow.glb', import.meta.url).href,
};
var FINGERTIP_OFFSET = { x: 0.038, y: 0.026, z: -0.089 };
var FINGER_POINT_DIR = { x: 0.0649, y: 0.0816, z: -0.9946 };

function xrIsPresenting(sceneEl) {
  return Boolean(sceneEl && sceneEl.renderer && sceneEl.renderer.xr && sceneEl.renderer.xr.isPresenting);
}

function visibleInHierarchy(object3D) {
  for (var current = object3D; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

AFRAME.registerSystem('interaction-hints', {
  init: function () {
    this.zones = [];
    this.hands = {};
    this.hintMode = 'delayed';
    this.hintDelay = 900;
    this.handedness = 'right';
    this.targetingEnabled = true;
    this.desktopCandidate = null;
    this.activeSelections = new Map();
    this.raycaster = new THREE.Raycaster();
    this.cameraPosition = new THREE.Vector3();
    this.cameraQuaternion = new THREE.Quaternion();
    this.cameraForward = new THREE.Vector3();
    this.zonePosition = new THREE.Vector3();
    this.shoulderPosition = new THREE.Vector3();
    this.handPosition = new THREE.Vector3();
  },

  registerZone: function (zone) {
    if (this.zones.indexOf(zone) === -1) this.zones.push(zone);
  },

  unregisterZone: function (zone) {
    var index = this.zones.indexOf(zone);
    if (index !== -1) this.zones.splice(index, 1);
  },

  registerHand: function (hand) {
    this.hands[hand.data.hand] = hand;
  },

  unregisterHand: function (hand) {
    if (this.hands[hand.data.hand] === hand) delete this.hands[hand.data.hand];
  },

  setPreferences: function (preferences) {
    if (preferences.hintMode) this.hintMode = preferences.hintMode;
    if (preferences.handedness) this.handedness = preferences.handedness;
  },

  setTargetingEnabled: function (enabled) {
    this.targetingEnabled = Boolean(enabled);
  },

  getCameraEl: function () {
    return this.sceneEl.camera && this.sceneEl.camera.el
      ? this.sceneEl.camera.el
      : this.sceneEl.querySelector('a-camera');
  },

  getPreferredHand: function () {
    return this.hands[this.handedness] || this.hands.right || this.hands.left || null;
  },

  makeDesktopCandidate: function (zone, cameraEl) {
    if (!zone.isAvailable('desktop')) return null;
    zone.getWorldPosition(this.zonePosition);
    var toZone = this.zonePosition.clone().sub(this.cameraPosition);
    var viewDistance = toZone.length();
    if (!viewDistance) return null;
    var gazeDot = toZone.normalize().dot(this.cameraForward);
    if (gazeDot < zone.data.gazeThreshold) return null;

    var preferred = this.getPreferredHand();
    var alternate = preferred && preferred.data.hand === 'left' ? this.hands.right : this.hands.left;
    var hand = null;
    var reachDistance = Infinity;
    [preferred, alternate].forEach(function (candidateHand) {
      if (!candidateHand) return;
      candidateHand.getShoulderWorldPosition(this.shoulderPosition, cameraEl);
      var distance = this.shoulderPosition.distanceTo(this.zonePosition);
      if (isWithinSemanticReach(distance, Math.min(candidateHand.data.maxReach, zone.data.maxReach), zone.data.radius * 0.2) && distance < reachDistance) {
        hand = candidateHand;
        reachDistance = distance;
      }
    }, this);
    if (!hand) return null;

    this.raycaster.set(this.cameraPosition, this.cameraForward);
    var targetObject = zone.getHighlightObject3D();
    var directHit = targetObject ? this.raycaster.intersectObject(targetObject, true).length > 0 : false;
    return {
      id: zone.el.id || zone.attrName,
      zone: zone,
      hand: hand,
      directHit: directHit,
      priority: zone.data.priority,
      gazeDot: gazeDot,
      distance: reachDistance,
      eligible: true,
    };
  },

  resolveDesktop: function (cameraEl) {
    if (!this.targetingEnabled) return null;
    var heldHand = this.getPreferredHand();
    if (!heldHand || !heldHand.heldEl) {
      heldHand = (this.hands.left && this.hands.left.heldEl) ? this.hands.left :
        ((this.hands.right && this.hands.right.heldEl) ? this.hands.right : null);
    }
    if (heldHand && heldHand.heldEl) {
      var heldZone = heldHand.heldEl.components['hint-zone'];
      if (heldZone) {
        return {
          id: heldZone.el.id || heldZone.attrName,
          zone: heldZone,
          hand: heldHand,
          directHit: true,
          priority: 10000,
          gazeDot: 1,
          distance: 0,
          eligible: true,
        };
      }
    }
    cameraEl.object3D.getWorldPosition(this.cameraPosition);
    cameraEl.object3D.getWorldQuaternion(this.cameraQuaternion);
    this.cameraForward.set(0, 0, -1).applyQuaternion(this.cameraQuaternion).normalize();
    var candidates = this.zones.map(function (zone) {
      return this.makeDesktopCandidate(zone, cameraEl);
    }, this);
    return chooseInteractionCandidate(candidates);
  },

  resolveXrForHand: function (hand) {
    if (!this.targetingEnabled || !hand) return null;
    hand.getInteractionWorldPosition(this.handPosition);
    var candidates = this.zones.map(function (zone) {
      if (!zone.isAvailable('xr')) return null;
      zone.getWorldPosition(this.zonePosition);
      var distance = this.handPosition.distanceTo(this.zonePosition);
      if (distance > zone.data.radius) return null;
      return {
        id: zone.el.id || zone.attrName,
        zone: zone,
        hand: hand,
        directHit: false,
        priority: zone.data.priority,
        gazeDot: 0,
        distance: distance,
        eligible: true,
      };
    }, this);
    return chooseInteractionCandidate(candidates);
  },

  updateSelections: function (selections, isXr, time) {
    var next = new Map();
    selections.filter(Boolean).forEach(function (selection) {
      var existing = next.get(selection.zone);
      if (!existing || selection.distance < existing.distance) next.set(selection.zone, selection);
    });

    this.activeSelections.forEach(function (selection, zone) {
      if (!next.has(zone)) zone.setSelected(false);
    });
    next.forEach(function (selection, zone) {
      zone.setSelected(true, {
        isXr: isXr,
        hand: selection.hand,
        time: time,
        hintMode: this.hintMode,
        hintDelay: this.hintDelay,
      });
    }, this);
    this.activeSelections = next;
  },

  getDesktopCandidate: function (action) {
    if (!this.desktopCandidate) return null;
    return !action || this.desktopCandidate.zone.data.action === action ? this.desktopCandidate : null;
  },

  getXrCandidate: function (handEl, action) {
    var hand = handEl && handEl.components['semantic-hand'];
    if (!hand) return null;
    var selection = this.resolveXrForHand(hand);
    return selection && (!action || selection.zone.data.action === action) ? selection : null;
  },

  activateForHand: function (action, handEl, phase, source) {
    var candidate = source === 'desktop'
      ? this.getDesktopCandidate(action)
      : this.getXrCandidate(handEl, action);
    if (!candidate) return false;
    candidate.zone.el.emit('semantic-action', {
      action: action,
      handEl: handEl,
      phase: phase || 'start',
      source: source || 'xr',
      zone: candidate.zone,
    }, false);
    return true;
  },

  tick: function (time) {
    var cameraEl = this.getCameraEl();
    if (!cameraEl || !cameraEl.object3D) return;
    var isXr = xrIsPresenting(this.sceneEl);
    if (isXr) {
      this.desktopCandidate = null;
      this.updateSelections([
        this.resolveXrForHand(this.hands.left),
        this.resolveXrForHand(this.hands.right),
      ], true, time);
    } else {
      this.desktopCandidate = this.resolveDesktop(cameraEl);
      this.updateSelections([this.desktopCandidate], false, time);
    }
  },
});

AFRAME.registerComponent('hint-zone', {
  schema: {
    action: { type: 'string' },
    radius: { default: 0.32 },
    maxReach: { default: 1.0 },
    gazeThreshold: { default: 0.9 },
    priority: { default: 0 },
    highlight: { type: 'selector' },
    desktopKey: { type: 'string' },
    desktopLabel: { type: 'string' },
    xrKey: { type: 'string' },
    xrLabel: { type: 'string' },
    hintOffset: { type: 'vec3', default: { x: 0, y: 0.32, z: 0 } },
    enabled: { default: true },
  },

  init: function () {
    this.hintSystem = this.el.sceneEl.systems['interaction-hints'];
    this.selected = false;
    this.selectedAt = 0;
    this.selectionToken = '';
    this.dynamicDesktopLabel = null;
    this.dynamicXrLabel = null;
    this.createHintCard();
    this.createHighlight();
    this.hintSystem.registerZone(this);
  },

  createHintCard: function () {
    var card = document.createElement('a-entity');
    card.classList.add('interaction-hint-card');
    card.setAttribute('visible', false);

    var background = document.createElement('a-plane');
    background.setAttribute('geometry', 'primitive: plane; width: 0.72; height: 0.24');
    background.setAttribute('material', 'color: #080b12; opacity: 0.88; transparent: true; shader: flat; side: double');
    background.setAttribute('position', '0 0 -0.012');
    card.appendChild(background);

    var keyOutline = document.createElement('a-plane');
    keyOutline.setAttribute('geometry', 'primitive: plane; width: 0.2; height: 0.16');
    keyOutline.setAttribute('material', 'color: #fff; shader: flat; side: double');
    keyOutline.setAttribute('position', '-0.22 0 0');
    card.appendChild(keyOutline);

    var keyFill = document.createElement('a-plane');
    keyFill.setAttribute('geometry', 'primitive: plane; width: 0.176; height: 0.136');
    keyFill.setAttribute('material', 'color: #111722; shader: flat; side: double');
    keyFill.setAttribute('position', '-0.22 0 0.002');
    card.appendChild(keyFill);

    var keyText = document.createElement('a-text');
    keyText.setAttribute('align', 'center');
    keyText.setAttribute('color', '#fff');
    keyText.setAttribute('width', '1.15');
    keyText.setAttribute('position', '-0.22 0 0.006');
    card.appendChild(keyText);

    var labelText = document.createElement('a-text');
    labelText.setAttribute('align', 'center');
    labelText.setAttribute('color', '#cbd5e1');
    labelText.setAttribute('width', '1.25');
    labelText.setAttribute('wrap-count', '18');
    labelText.setAttribute('position', '0.13 0 0.006');
    card.appendChild(labelText);

    this.el.sceneEl.appendChild(card);
    this.cardEl = card;
    this.keyTextEl = keyText;
    this.labelTextEl = labelText;
  },

  createHighlight: function () {
    this.highlightBox = new THREE.Box3();
    this.highlightHelper = new THREE.Box3Helper(this.highlightBox, 0x8de5ff);
    this.highlightHelper.visible = false;
    this.highlightHelper.renderOrder = 1000;
    this.el.sceneEl.object3D.add(this.highlightHelper);
  },

  getHighlightEl: function () {
    return this.data.highlight || this.el;
  },

  getHighlightObject3D: function () {
    var target = this.getHighlightEl();
    return target && target.object3D;
  },

  getWorldPosition: function (target) {
    this.el.object3D.getWorldPosition(target);
    return target;
  },

  isAvailable: function () {
    if (!this.data.enabled || !visibleInHierarchy(this.el.object3D)) return false;
    var grabbable = this.el.components['simple-grabbable'];
    if (grabbable && grabbable.state === 'held') return false;
    var menu = this.el.components['projected-menu'];
    if (menu && menu.active) return false;
    var mounted = this.el.components['mounted-interaction'];
    return !(mounted && mounted.active);
  },

  setLabels: function (desktopLabel, xrLabel) {
    this.dynamicDesktopLabel = desktopLabel || null;
    this.dynamicXrLabel = xrLabel || null;
  },

  setSelected: function (selected, context) {
    if (!selected) {
      this.selected = false;
      this.selectionToken = '';
      this.cardEl.setAttribute('visible', false);
      this.highlightHelper.visible = false;
      this.el.removeAttribute('data-hint-selected');
      return;
    }

    var token = (context.isXr ? 'xr:' : 'desktop:') + (context.hand ? context.hand.data.hand : 'none');
    if (!this.selected || this.selectionToken !== token) {
      this.selectedAt = context.time;
      this.selectionToken = token;
    }
    this.selected = true;
    this.el.setAttribute('data-hint-selected', context.hand ? context.hand.data.hand : 'true');
    this.updateHighlight();
    this.updateHintCard(context, context.time - this.selectedAt);
  },

  updateHighlight: function () {
    var target = this.getHighlightObject3D();
    if (!target) return;
    this.highlightBox.setFromObject(target);
    this.highlightHelper.visible = !this.highlightBox.isEmpty();
  },

  updateHintCard: function (context, selectedForMs) {
    var show = shouldShowInteractionHint(context.hintMode, selectedForMs, context.hintDelay);
    this.cardEl.setAttribute('visible', show);
    if (!show) return;

    var isXr = context.isXr;
    var key = isXr ? this.data.xrKey : this.data.desktopKey;
    var label = isXr
      ? (this.dynamicXrLabel || this.data.xrLabel)
      : (this.dynamicDesktopLabel || this.data.desktopLabel);
    this.keyTextEl.setAttribute('text', 'value', key || '');
    this.labelTextEl.setAttribute('text', 'value', label || '');

    var position = new THREE.Vector3();
    this.getHighlightObject3D().getWorldPosition(position);
    position.x += this.data.hintOffset.x;
    position.y += this.data.hintOffset.y;
    position.z += this.data.hintOffset.z;
    this.cardEl.object3D.position.copy(position);
    var cameraEl = this.hintSystem.getCameraEl();
    if (cameraEl) {
      cameraEl.object3D.getWorldPosition(position);
      this.cardEl.object3D.lookAt(position);
    }
  },

  tick: function () {
    if (!this.selected) return;
    this.updateHighlight();
    var position = new THREE.Vector3();
    var cameraEl = this.hintSystem.getCameraEl();
    if (cameraEl && this.cardEl.object3D.visible) {
      cameraEl.object3D.getWorldPosition(position);
      this.cardEl.object3D.lookAt(position);
    }
  },

  remove: function () {
    this.hintSystem.unregisterZone(this);
    if (this.cardEl.parentNode) this.cardEl.parentNode.removeChild(this.cardEl);
    this.el.sceneEl.object3D.remove(this.highlightHelper);
    this.highlightHelper.geometry.dispose();
    this.highlightHelper.material.dispose();
  },
});

AFRAME.registerComponent('semantic-hand', {
  schema: {
    hand: { default: 'left', oneOf: ['left', 'right'] },
    maxReach: { default: 1.0 },
  },

  init: function () {
    var self = this;
    var side = this.data.hand === 'left' ? 1 : -1;
    this.side = side;
    this.desiredPosition = this.el.object3D.position.clone();
    this.desiredQuaternion = this.el.object3D.quaternion.clone();
    this.desktopPose = 'Open';
    this.heldEl = null;
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.hintSystem = this.el.sceneEl.systems['interaction-hints'];

    this.gripEl = document.createElement('a-entity');
    this.gripEl.classList.add('semantic-hand-grip');
    this.el.appendChild(this.gripEl);

    this.visualWrapper = document.createElement('a-entity');
    this.visualWrapper.classList.add('desktop-hand-visual');
    this.visualWrapper.setAttribute('rotation', '0 0 ' + (side === 1 ? 90 : -90));
    this.el.appendChild(this.visualWrapper);

    this.visualModel = document.createElement('a-entity');
    this.visualModel.setAttribute('gltf-model', HAND_MODELS[this.data.hand]);
    this.visualWrapper.appendChild(this.visualModel);
    this.visualModel.addEventListener('model-loaded', function (evt) {
      var model = evt.detail.model;
      model.traverse(function (object) {
        if (!object.material) return;
        object.material = object.material.clone();
        object.material.color.set('#3a3a3a');
      });
      self.mixer = new THREE.AnimationMixer(model);
      (model.animations || []).forEach(function (clip) {
        self.actions[clip.name] = self.mixer.clipAction(clip);
      });
      self.playPose(self.desktopPose);
    });

    var watchComponent = this.el.components['hand-with-watch'];
    var wrapperObject = watchComponent && watchComponent.fingertipEl
      ? watchComponent.fingertipEl.object3D.parent
      : null;
    var wrapperQuat = wrapperObject
      ? wrapperObject.quaternion.clone()
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side === 1 ? Math.PI / 2 : -Math.PI / 2));
    this.localFingerDirection = new THREE.Vector3(side * FINGER_POINT_DIR.x, FINGER_POINT_DIR.y, FINGER_POINT_DIR.z)
      .applyQuaternion(wrapperQuat).normalize();
    this.localFingertipOffset = new THREE.Vector3(side * FINGERTIP_OFFSET.x, FINGERTIP_OFFSET.y, FINGERTIP_OFFSET.z)
      .applyQuaternion(wrapperQuat);
    if (wrapperObject) this.localFingertipOffset.add(wrapperObject.position);

    if (watchComponent && watchComponent.fingertipEl) {
      watchComponent.fingertipEl.addEventListener('raycaster-intersection', function (evt) {
        var hit = evt.detail.els && evt.detail.els[0];
        self.el.setAttribute('data-ray-target', hit ? (hit.getAttribute('menu-item') || hit.id || 'target') : 'target');
      });
      watchComponent.fingertipEl.addEventListener('raycaster-intersection-cleared', function () {
        self.el.removeAttribute('data-ray-target');
      });
    }

    this.onGripDown = function () {
      if (!xrIsPresenting(self.el.sceneEl) || self.heldEl) return;
      self.hintSystem.activateForHand('grab', self.el, 'start', 'xr');
    };
    this.onGripUp = function () {
      if (!xrIsPresenting(self.el.sceneEl) || !self.heldEl) return;
      var grabbable = self.heldEl.components['simple-grabbable'];
      if (grabbable) grabbable.release(self.el);
    };
    this.el.addEventListener('gripdown', this.onGripDown);
    this.el.addEventListener('gripup', this.onGripUp);
    this.hintSystem.registerHand(this);
  },

  playPose: function (pose) {
    this.desktopPose = pose || 'Open';
    if (!this.mixer) return;
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
    if (pose === 'Open') return;
    var action = this.actions[pose] || this.actions.Point || null;
    if (!action) return;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    this.currentAction = action;
  },

  setHeld: function (el) {
    this.heldEl = el;
    this.playPose(el ? 'Hold' : 'Open');
  },

  getInteractionWorldPosition: function (target) {
    var watch = this.el.components['hand-with-watch'];
    if (watch && watch.fingertipEl) return watch.fingertipEl.object3D.getWorldPosition(target);
    return this.el.object3D.getWorldPosition(target);
  },

  getShoulderWorldPosition: function (target, cameraEl) {
    var offset = new THREE.Vector3(this.data.hand === 'left' ? -0.19 : 0.19, -0.17, 0.02);
    var cameraQuat = new THREE.Quaternion();
    cameraEl.object3D.getWorldQuaternion(cameraQuat);
    var yaw = new THREE.Euler().setFromQuaternion(cameraQuat, 'YXZ').y;
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    cameraEl.object3D.getWorldPosition(target);
    return target.add(offset);
  },

  setWorldTransform: function (worldPosition, worldQuaternion, pose, snap) {
    var parent = this.el.object3D.parent;
    parent.updateMatrixWorld(true);
    var localPosition = parent.worldToLocal(worldPosition.clone());
    var parentQuaternion = new THREE.Quaternion();
    parent.getWorldQuaternion(parentQuaternion);
    var localQuaternion = parentQuaternion.invert().multiply(worldQuaternion);
    this.desiredPosition.copy(localPosition);
    this.desiredQuaternion.copy(localQuaternion);
    if (pose && pose !== this.desktopPose) this.playPose(pose);
    if (snap) {
      this.el.object3D.position.copy(this.desiredPosition);
      this.el.object3D.quaternion.copy(this.desiredQuaternion);
      this.el.object3D.updateMatrixWorld(true);
    }
  },

  setPointPose: function (fingertipWorldPosition, worldDirection, pose, snap) {
    var direction = worldDirection.clone().normalize();
    var worldQuaternion = new THREE.Quaternion().setFromUnitVectors(this.localFingerDirection, direction);
    var offset = this.localFingertipOffset.clone().applyQuaternion(worldQuaternion);
    var handPosition = fingertipWorldPosition.clone().sub(offset);
    this.setWorldTransform(handPosition, worldQuaternion, pose || 'Point', snap);
  },

  tick: function (time, delta) {
    var isXr = xrIsPresenting(this.el.sceneEl);
    this.visualWrapper.object3D.visible = !isXr;
    if (this.mixer) this.mixer.update(Math.min(delta || 0, 50) / 1000);
    if (isXr) return;
    this.el.object3D.position.lerp(this.desiredPosition, 0.24);
    this.el.object3D.quaternion.slerp(this.desiredQuaternion, 0.24);
  },

  remove: function () {
    this.hintSystem.unregisterHand(this);
    this.el.removeEventListener('gripdown', this.onGripDown);
    this.el.removeEventListener('gripup', this.onGripUp);
  },
});

AFRAME.registerComponent('simple-grabbable', {
  schema: {
    heldPosition: { type: 'vec3', default: { x: 0, y: 0, z: -0.08 } },
    heldRotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    floorY: { default: 0.13 },
    gravity: { default: 9.8 },
  },

  init: function () {
    this.state = 'resting';
    this.handEl = null;
    this.fallVelocity = 0;
    this.spawnParent = this.el.object3D.parent;
    this.spawnPosition = this.el.object3D.position.clone();
    this.spawnQuaternion = this.el.object3D.quaternion.clone();
    this.el.setAttribute('data-grab-state', this.state);
    this.onSemanticAction = this.onSemanticAction.bind(this);
    this.el.addEventListener('semantic-action', this.onSemanticAction);
  },

  onSemanticAction: function (evt) {
    if (evt.detail.action !== 'grab') return;
    if (this.state === 'held') this.release(evt.detail.handEl);
    else this.grab(evt.detail.handEl);
  },

  grab: function (handEl) {
    var hand = handEl && handEl.components['semantic-hand'];
    if (!hand || hand.heldEl || this.state === 'held') return false;
    hand.gripEl.object3D.attach(this.el.object3D);
    this.el.object3D.position.set(this.data.heldPosition.x, this.data.heldPosition.y, this.data.heldPosition.z);
    this.el.object3D.rotation.set(
      THREE.MathUtils.degToRad(this.data.heldRotation.x),
      THREE.MathUtils.degToRad(this.data.heldRotation.y),
      THREE.MathUtils.degToRad(this.data.heldRotation.z)
    );
    this.state = 'held';
    this.handEl = handEl;
    this.fallVelocity = 0;
    hand.setHeld(this.el);
    this.el.setAttribute('data-grab-state', this.state);
    var zone = this.el.components['hint-zone'];
    if (zone) zone.setLabels('Drop', '');
    this.el.emit('simple-grabbed', { handEl: handEl }, false);
    return true;
  },

  release: function (handEl) {
    if (this.state !== 'held' || (handEl && this.handEl !== handEl)) return false;
    this.el.sceneEl.object3D.attach(this.el.object3D);
    var hand = this.handEl && this.handEl.components['semantic-hand'];
    if (hand) hand.setHeld(null);
    this.handEl = null;
    this.state = 'falling';
    this.fallVelocity = 0;
    this.el.setAttribute('data-grab-state', this.state);
    var zone = this.el.components['hint-zone'];
    if (zone) zone.setLabels(null, null);
    this.el.emit('simple-released', null, false);
    return true;
  },

  resetToSpawn: function () {
    if (this.handEl) {
      var hand = this.handEl.components['semantic-hand'];
      if (hand) hand.setHeld(null);
    }
    this.spawnParent.attach(this.el.object3D);
    this.el.object3D.position.copy(this.spawnPosition);
    this.el.object3D.quaternion.copy(this.spawnQuaternion);
    this.handEl = null;
    this.fallVelocity = 0;
    this.state = 'resting';
    this.el.setAttribute('data-grab-state', this.state);
    var zone = this.el.components['hint-zone'];
    if (zone) zone.setLabels(null, null);
  },

  tick: function (time, delta) {
    if (this.state !== 'falling') return;
    var dt = Math.min(delta || 0, 50) / 1000;
    this.fallVelocity -= this.data.gravity * dt;
    this.el.object3D.position.y += this.fallVelocity * dt;
    if (this.el.object3D.position.y <= this.data.floorY) {
      this.el.object3D.position.y = this.data.floorY;
      this.fallVelocity = 0;
      this.state = 'resting';
      this.el.setAttribute('data-grab-state', this.state);
      this.el.emit('simple-rested', null, false);
    }
  },

  remove: function () {
    this.el.removeEventListener('semantic-action', this.onSemanticAction);
  },
});

AFRAME.registerComponent('mounted-interaction', {
  schema: {
    action: { default: 'mounted' },
    anchor: { type: 'selector' },
    normal: { type: 'vec3', default: { x: 0, y: 0, z: 1 } },
    previewStandoff: { default: 0.12 },
  },

  init: function () {
    var self = this;
    this.active = false;
    this.onSemanticAction = function (evt) {
      if (evt.detail.action !== self.data.action) return;
      self.el.sceneEl.emit('mounted-interaction-request', {
        component: self,
        handEl: evt.detail.handEl,
        source: evt.detail.source,
      }, false);
    };
    this.el.addEventListener('semantic-action', this.onSemanticAction);
  },

  getActionWorldPosition: function (target) {
    return this.el.object3D.getWorldPosition(target);
  },

  getWorldNormal: function (target) {
    var quaternion = new THREE.Quaternion();
    this.el.object3D.getWorldQuaternion(quaternion);
    return target.set(this.data.normal.x, this.data.normal.y, this.data.normal.z).applyQuaternion(quaternion).normalize();
  },

  getAnchorWorldPosition: function (target) {
    if (!this.data.anchor) return null;
    return this.data.anchor.object3D.getWorldPosition(target);
  },

  open: function () {
    this.active = true;
    this.el.setAttribute('data-mounted-active', 'true');
    var menu = this.el.components['projected-menu'];
    if (menu) menu.open();
    this.el.emit('mounted-interaction-entered', null, false);
  },

  close: function () {
    this.active = false;
    this.el.removeAttribute('data-mounted-active');
    var menu = this.el.components['projected-menu'];
    if (menu) menu.close();
    this.el.emit('mounted-interaction-exited', null, false);
  },

  remove: function () {
    this.el.removeEventListener('semantic-action', this.onSemanticAction);
  },
});
