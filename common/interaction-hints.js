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
    this.stillCameraPosition = new THREE.Vector3();
    this.stillCameraQuaternion = new THREE.Quaternion();
    this.stillSince = 0;
    this.stationaryForMs = 0;
    this.stillnessInitialized = false;
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
        stationaryForMs: this.stationaryForMs,
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

  updateCameraStillness: function (cameraEl, time) {
    cameraEl.object3D.getWorldPosition(this.cameraPosition);
    cameraEl.object3D.getWorldQuaternion(this.cameraQuaternion);
    if (!this.stillnessInitialized) {
      this.stillCameraPosition.copy(this.cameraPosition);
      this.stillCameraQuaternion.copy(this.cameraQuaternion);
      this.stillSince = time;
      this.stillnessInitialized = true;
    }
    var movedPosition = this.stillCameraPosition.distanceToSquared(this.cameraPosition) > 0.0001;
    var quaternionDot = Math.abs(this.stillCameraQuaternion.dot(this.cameraQuaternion));
    var movedView = 1 - Math.min(1, quaternionDot) > 0.00004;
    if (movedPosition || movedView) {
      this.stillCameraPosition.copy(this.cameraPosition);
      this.stillCameraQuaternion.copy(this.cameraQuaternion);
      this.stillSince = time;
    }
    this.stationaryForMs = Math.max(0, time - this.stillSince);
  },

  tick: function (time) {
    var cameraEl = this.getCameraEl();
    if (!cameraEl || !cameraEl.object3D) return;
    this.updateCameraStillness(cameraEl, time);
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
    hintOffsetSpace: { default: 'world', oneOf: ['world', 'target'] },
    hintLockX: { default: false },
    hintLockY: { default: false },
    hintLockZ: { default: false },
    hintScale: { default: 1 },
    hintFadeDuration: { default: 550 },
    previewStandoff: { default: 0.22 },
    highlightColor: { type: 'color', default: '#8de5ff' },
    highlightOpacity: { default: 0.2 },
    highlightScale: { default: 1.035 },
    enabled: { default: true },
  },

  init: function () {
    this.hintSystem = this.el.sceneEl.systems['interaction-hints'];
    this.selected = false;
    this.selectedAt = 0;
    this.selectionToken = '';
    this.dynamicDesktopLabel = null;
    this.dynamicXrLabel = null;
    this.hintShouldShow = false;
    this.hintOpacity = 0;
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
    this.highlightRoot = new THREE.Group();
    this.highlightRoot.visible = false;
    this.highlightMeshes = [];
    this.highlightSignature = '';
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: this.data.highlightColor,
      opacity: this.data.highlightOpacity,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    });
    this.el.sceneEl.object3D.add(this.highlightRoot);
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
    if (this.dynamicDesktopLabel !== (desktopLabel || null) || this.dynamicXrLabel !== (xrLabel || null)) {
      this.hintShouldShow = false;
    }
    this.dynamicDesktopLabel = desktopLabel || null;
    this.dynamicXrLabel = xrLabel || null;
  },

  setSelected: function (selected, context) {
    if (!selected) {
      this.selected = false;
      this.selectionToken = '';
      this.hintShouldShow = false;
      this.highlightRoot.visible = false;
      this.el.removeAttribute('data-hint-selected');
      return;
    }

    var token = (context.isXr ? 'xr:' : 'desktop:') +
      (context.hand ? context.hand.data.hand : 'none') + ':' +
      (this.dynamicDesktopLabel || '') + ':' + (this.dynamicXrLabel || '');
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
    var sourceMeshes = [];
    target.traverse(function (object) {
      if (!object.isMesh || !object.geometry) return;
      // SDF text is rendered as textured quads. Replacing its material with
      // the glow material reveals those quads as solid rectangles, so glow
      // the authored prop meshes and leave labels legible on top.
      for (var ancestor = object; ancestor && ancestor !== target; ancestor = ancestor.parent) {
        if (ancestor.el && ancestor.el.tagName === 'A-TEXT') return;
      }
      sourceMeshes.push(object);
    });
    var signature = sourceMeshes.map(function (mesh) { return mesh.uuid; }).join('|');
    if (signature !== this.highlightSignature) {
      while (this.highlightRoot.children.length) this.highlightRoot.remove(this.highlightRoot.children[0]);
      this.highlightMeshes = sourceMeshes.map(function (source) {
        var glow = new THREE.Mesh(source.geometry, this.highlightMaterial);
        glow.matrixAutoUpdate = false;
        glow.frustumCulled = false;
        glow.renderOrder = 1000;
        this.highlightRoot.add(glow);
        return { source: source, glow: glow };
      }, this);
      this.highlightSignature = signature;
    }

    var scaleMultiplier = Math.max(1, this.data.highlightScale);
    var position = new THREE.Vector3();
    var quaternion = new THREE.Quaternion();
    var scale = new THREE.Vector3();
    this.highlightMeshes.forEach(function (entry) {
      entry.source.matrixWorld.decompose(position, quaternion, scale);
      scale.multiplyScalar(scaleMultiplier);
      entry.glow.matrix.compose(position, quaternion, scale);
      entry.glow.visible = visibleInHierarchy(entry.source);
    });
    this.highlightRoot.visible = this.highlightMeshes.length > 0;
  },

  updateHintCard: function (context, selectedForMs) {
    var grabbable = this.el.components['simple-grabbable'];
    var stationaryDelay = grabbable && grabbable.state === 'held'
      ? grabbable.data.dropHintDelay
      : 0;
    var show = shouldShowInteractionHint(
      context.hintMode,
      selectedForMs,
      context.hintDelay,
      context.stationaryForMs,
      stationaryDelay
    );
    this.hintShouldShow = show;
    if (!show) return;

    var isXr = context.isXr;
    var key = isXr ? this.data.xrKey : this.data.desktopKey;
    var label = isXr
      ? (this.dynamicXrLabel || this.data.xrLabel)
      : (this.dynamicDesktopLabel || this.data.desktopLabel);
    this.keyTextEl.setAttribute('text', 'value', key || '');
    this.labelTextEl.setAttribute('text', 'value', label || '');

    this.updateHintTransform();
  },

  applyHintOpacity: function () {
    var opacity = this.hintOpacity;
    this.cardEl.object3D.traverse(function (object) {
      if (!object.material) return;
      var materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(function (material) {
        if (material.userData.interactionHintBaseOpacity === undefined) {
          material.userData.interactionHintBaseOpacity = material.opacity;
        }
        material.transparent = true;
        material.opacity = material.userData.interactionHintBaseOpacity * opacity;
      });
    });
  },

  updateHintFade: function (delta) {
    var target = this.hintShouldShow ? 1 : 0;
    if (target > 0 && !this.cardEl.object3D.visible) this.cardEl.setAttribute('visible', true);
    var duration = Math.max(1, this.data.hintFadeDuration);
    var step = Math.min(1, Math.max(0, delta || 0) / duration);
    if (this.hintOpacity < target) this.hintOpacity = Math.min(target, this.hintOpacity + step);
    else if (this.hintOpacity > target) this.hintOpacity = Math.max(target, this.hintOpacity - step);
    this.applyHintOpacity();
    if (this.hintOpacity <= 0 && target === 0 && this.cardEl.object3D.visible) {
      this.cardEl.setAttribute('visible', false);
    }
  },

  updateHintTransform: function () {
    var target = this.getHighlightObject3D();
    var cameraEl = this.hintSystem.getCameraEl();
    if (!target || !cameraEl) return;

    this.cardEl.object3D.scale.setScalar(Math.max(0.1, this.data.hintScale));

    var position = new THREE.Vector3();
    var targetQuaternion = new THREE.Quaternion();
    target.getWorldPosition(position);
    target.getWorldQuaternion(targetQuaternion);
    var offset = new THREE.Vector3(this.data.hintOffset.x, this.data.hintOffset.y, this.data.hintOffset.z);
    if (this.data.hintOffsetSpace === 'target') offset.applyQuaternion(targetQuaternion);
    this.cardEl.object3D.position.copy(position.add(offset));

    var cameraPosition = new THREE.Vector3();
    cameraEl.object3D.getWorldPosition(cameraPosition);
    var billboard = new THREE.Object3D();
    billboard.position.copy(this.cardEl.object3D.position);
    billboard.lookAt(cameraPosition);
    if (!this.data.hintLockX && !this.data.hintLockY && !this.data.hintLockZ) {
      this.cardEl.object3D.quaternion.copy(billboard.quaternion);
      return;
    }
    if (this.data.hintLockX && this.data.hintLockY && this.data.hintLockZ) {
      this.cardEl.object3D.quaternion.copy(targetQuaternion);
      return;
    }

    var billboardEuler = new THREE.Euler().setFromQuaternion(billboard.quaternion, 'YXZ');
    var targetEuler = new THREE.Euler().setFromQuaternion(targetQuaternion, 'YXZ');
    billboardEuler.x = this.data.hintLockX ? targetEuler.x : billboardEuler.x;
    billboardEuler.y = this.data.hintLockY ? targetEuler.y : billboardEuler.y;
    billboardEuler.z = this.data.hintLockZ ? targetEuler.z : billboardEuler.z;
    this.cardEl.object3D.quaternion.setFromEuler(billboardEuler);
  },

  tick: function (time, delta) {
    if (this.selected) this.updateHighlight();
    this.updateHintFade(delta);
    if (this.cardEl.object3D.visible) this.updateHintTransform();
  },

  remove: function () {
    this.hintSystem.unregisterZone(this);
    if (this.cardEl.parentNode) this.cardEl.parentNode.removeChild(this.cardEl);
    this.el.sceneEl.object3D.remove(this.highlightRoot);
    this.highlightMaterial.dispose();
  },
});

AFRAME.registerComponent('semantic-hand', {
  schema: {
    hand: { default: 'left', oneOf: ['left', 'right'] },
    maxReach: { default: 1.0 },
    moveSpeed: { default: 0.9 },
    turnSpeed: { default: 360 },
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

    this.visualModel = document.createElement('a-entity');
    this.visualModel.classList.add('desktop-hand-visual');
    this.visualModel.setAttribute('gltf-model', HAND_MODELS[this.data.hand]);
    var watchComponent = this.el.components['hand-with-watch'];
    this.handSpaceEl = watchComponent && watchComponent.wrapperEl
      ? watchComponent.wrapperEl
      : this.el;
    this.handSpaceEl.appendChild(this.visualModel);
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
      self.indexFingerBase = model.getObjectByName('F1b');
      self.indexFingerTip = model.getObjectByName('F1c');
      self.playPose(self.desktopPose);
    });

    this.rawFingerDirection = new THREE.Vector3(side * FINGER_POINT_DIR.x, FINGER_POINT_DIR.y, FINGER_POINT_DIR.z).normalize();
    this.localFingerDirection = this.rawFingerDirection.clone();
    this.localFingertipOffset = new THREE.Vector3(side * FINGERTIP_OFFSET.x, FINGERTIP_OFFSET.y, FINGERTIP_OFFSET.z);
    this._calibrationPosition = new THREE.Vector3();
    this._calibrationQuaternion = new THREE.Quaternion();
    this._handWorldQuaternion = new THREE.Quaternion();
    this._fingerBaseWorld = new THREE.Vector3();
    this._fingerJointWorld = new THREE.Vector3();
    this._fingerTipWorld = new THREE.Vector3();
    this._fingerDirectionWorld = new THREE.Vector3();
    this._fingerDirectionLocal = new THREE.Vector3();
    this._fingertipParentQuaternion = new THREE.Quaternion();
    this._moveDelta = new THREE.Vector3();

    if (watchComponent && watchComponent.fingertipEl) {
      watchComponent.fingertipEl.addEventListener('raycaster-intersection', function (evt) {
        var hit = evt.detail.els && evt.detail.els[0];
        var menuItem = hit && hit.getAttribute('menu-item');
        self.el.setAttribute('data-ray-target', hit
          ? ((menuItem && (menuItem.value || menuItem.label)) || hit.id || 'target')
          : 'target');
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

  updateDesktopFingerCalibration: function () {
    var watch = this.el.components['hand-with-watch'];
    if (!watch || !watch.fingertipEl || !this.indexFingerBase || !this.indexFingerTip) return false;

    this.visualModel.object3D.updateMatrixWorld(true);
    this.indexFingerBase.getWorldPosition(this._fingerBaseWorld);
    this.indexFingerTip.getWorldPosition(this._fingerJointWorld);
    this._fingerDirectionWorld.copy(this._fingerJointWorld).sub(this._fingerBaseWorld).normalize();
    // F1c is the final index-finger joint. Extend slightly to the visible
    // mesh tip so the ray begins where the rendered fingertip actually ends.
    this._fingerTipWorld.copy(this._fingerJointWorld).addScaledVector(this._fingerDirectionWorld, 0.018);

    this.el.object3D.getWorldQuaternion(this._handWorldQuaternion);
    this.localFingerDirection.copy(this._fingerDirectionWorld)
      .applyQuaternion(this._handWorldQuaternion.clone().invert())
      .normalize();
    this.localFingertipOffset.copy(this.el.object3D.worldToLocal(this._fingerTipWorld.clone()));

    var fingertipObject = watch.fingertipEl.object3D;
    var fingertipParent = fingertipObject.parent;
    fingertipObject.position.copy(fingertipParent.worldToLocal(this._fingerTipWorld.clone()));
    fingertipParent.getWorldQuaternion(this._fingertipParentQuaternion);
    this._fingerDirectionLocal.copy(this._fingerDirectionWorld)
      .applyQuaternion(this._fingertipParentQuaternion.invert())
      .normalize();
    watch.fingertipEl.setAttribute('raycaster', 'direction', this._fingerDirectionLocal);
    return true;
  },

  setPointPose: function (fingertipWorldPosition, worldDirection, pose, snap) {
    var watch = this.el.components['hand-with-watch'];
    if (!this.updateDesktopFingerCalibration() && watch && watch.fingertipEl) {
      this.el.object3D.updateMatrixWorld(true);
      watch.fingertipEl.object3D.getWorldPosition(this._calibrationPosition);
      this.localFingertipOffset.copy(this.el.object3D.worldToLocal(this._calibrationPosition.clone()));
      watch.fingertipEl.object3D.getWorldQuaternion(this._calibrationQuaternion);
      this.el.object3D.getWorldQuaternion(this._handWorldQuaternion);
      this.localFingerDirection.copy(this.rawFingerDirection)
        .applyQuaternion(this._calibrationQuaternion)
        .applyQuaternion(this._handWorldQuaternion.invert())
        .normalize();
    }
    var direction = worldDirection.clone().normalize();
    var worldQuaternion = new THREE.Quaternion().setFromUnitVectors(this.localFingerDirection, direction);
    var offset = this.localFingertipOffset.clone().applyQuaternion(worldQuaternion);
    var handPosition = fingertipWorldPosition.clone().sub(offset);
    this.setWorldTransform(handPosition, worldQuaternion, pose || 'Point', snap);
  },

  tick: function (time, delta) {
    var isXr = xrIsPresenting(this.el.sceneEl);
    this.visualModel.object3D.visible = !isXr;
    if (this.mixer) this.mixer.update(Math.min(delta || 0, 50) / 1000);
    if (isXr) return;
    if (this.desktopPose === 'Point') this.updateDesktopFingerCalibration();
    var dt = Math.min(delta || 0, 50) / 1000;
    this._moveDelta.copy(this.desiredPosition).sub(this.el.object3D.position);
    var moveDistance = this._moveDelta.length();
    var maxMove = this.data.moveSpeed * dt;
    if (moveDistance <= maxMove || !moveDistance) this.el.object3D.position.copy(this.desiredPosition);
    else this.el.object3D.position.addScaledVector(this._moveDelta, maxMove / moveDistance);

    var angle = this.el.object3D.quaternion.angleTo(this.desiredQuaternion);
    var maxAngle = THREE.MathUtils.degToRad(this.data.turnSpeed) * dt;
    if (angle <= maxAngle || !angle) this.el.object3D.quaternion.copy(this.desiredQuaternion);
    else this.el.object3D.quaternion.slerp(this.desiredQuaternion, maxAngle / angle);
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
    dropHintDelay: { default: 2500 },
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
