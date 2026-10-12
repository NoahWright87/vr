import { DEFAULT_SCOPE_SETTINGS, sanitizeScopeSettings, ScopePoseFilter } from './scope-filter.js';

const THREE = AFRAME.THREE, STORAGE_KEY = 'vr-expansive-binoculars-v1';
const OPTIONS = { 'space-scope-enabled': 'enabled', 'space-scope-stabilize': 'stabilize', 'space-scope-zoom': 'zoom',
  'space-scope-rotation': 'rotationLag', 'space-scope-position': 'positionLag' };

AFRAME.registerComponent('scope-landscape', {
  init: function () {
    this.group = new THREE.Group(); this.targets = [];
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#4d854c', roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.set(40, -.025, 0); this.group.add(grass);
    for (let i = 0; i < 18; i++) {
      const target = new THREE.Group(); target.userData.scopeTarget = true; target.userData.targetId = i;
      const x = 8 + (i % 6) * 4, z = (Math.floor(i / 6) - 1) * 7 + (i % 2 ? 1.5 : -1.5);
      if (i % 3 === 0) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, 1.4, 6), new THREE.MeshStandardMaterial({ color: '#6a4933' }));
        trunk.position.y = .7; target.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(.8, 2.4, 7), new THREE.MeshStandardMaterial({ color: '#315f3c' }));
        crown.position.y = 2; target.add(crown);
      } else {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(.4 + (i % 4) * .12, 0), new THREE.MeshStandardMaterial({ color: i % 2 ? '#aa9783' : '#8295a8', roughness: 1 }));
        rock.position.y = .5; rock.scale.set(1.2, .8, .9); target.add(rock);
      }
      target.position.set(x, 0, z); this.targets.push(target); this.group.add(target);
    }
    this.el.setObject3D('landscape', this.group);
    this.onResize = evt => this.align(evt.detail.bounds);
    this.el.sceneEl.addEventListener('space-room-resized', this.onResize);
    const room = this.el.parentEl.components['expansive-space'];
    if (room?.virtualBounds) this.align(room.virtualBounds);
  },
  align: function (bounds) { this.el.object3D.position.set(bounds.maxX, 0, bounds.centerZ); },
  flash: function (target, time) {
    if (!target.userData.colors) {
      target.userData.colors = [];
      target.traverse(object => { if (object.material?.color) target.userData.colors.push([object.material, object.material.color.clone()]); });
    }
    target.userData.colors.forEach(([material]) => material.color.set('#ff3030'));
    target.userData.flashUntil = time + 250;
  },
  resetTargets: function () {
    this.targets.forEach(target => {
      target.userData.colors?.forEach(([material, color]) => material.color.copy(color));
      target.userData.flashUntil = 0;
    });
  },
  tick: function (time) {
    this.targets.forEach(target => {
      if (target.userData.flashUntil && time >= target.userData.flashUntil) {
        target.userData.colors.forEach(([material, color]) => material.color.copy(color)); target.userData.flashUntil = 0;
      }
    });
  },
  remove: function () {
    this.el.sceneEl.removeEventListener('space-room-resized', this.onResize);
    this.group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    this.el.removeObject3D('landscape');
  },
});

AFRAME.registerComponent('space-binoculars', {
  init: function () {
    let saved; try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
    this.settings = sanitizeScopeSettings(saved || DEFAULT_SCOPE_SETTINGS);
    this.filter = new ScopePoseFilter(); this.active = false; this.uiDirty = true; this.lastRender = -Infinity;
    this.renderedPose = null;
    this.scores = { raw: { hits: 0, shots: 0 }, damped: { hits: 0, shots: 0 } };
    this.position = new THREE.Vector3(); this.quaternion = new THREE.Quaternion();
    this.headPosition = new THREE.Vector3(); this.headQuaternion = new THREE.Quaternion();
    this.eyePosition = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.headDirection = new THREE.Vector3();
    this.ray = new THREE.Raycaster(); this.scopeCamera = new THREE.PerspectiveCamera(12, 1, .05, 120);
    this.renderTarget = new THREE.WebGLRenderTarget(512, 512);
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.model = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: '#233c46', roughness: .7 });
    const lens = new THREE.MeshStandardMaterial({ color: '#68cbe3', metalness: .4, roughness: .2 });
    for (const x of [-.085, .085]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.065, .055, .24, 16), body);
      barrel.rotation.x = Math.PI / 2; barrel.position.set(x, 0, -.02); this.model.add(barrel);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(.06, 24), lens);
      glass.rotation.y = Math.PI; glass.position.set(x, 0, -.145); this.model.add(glass);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(.16, .045, .09), body); this.model.add(bridge);
    this.el.setObject3D('binocular-model', this.model);
    this.strap = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#43464a' }));
    this.strap.frustumCulled = false; this.el.sceneEl.object3D.add(this.strap);
    this.cameraEl = document.querySelector('#space-camera');
    this.hud = document.createElement('a-entity'); this.hud.setAttribute('visible', false);
    this.hud.setAttribute('position', '0 0 -.65');
    this.hud.innerHTML = '<a-ring radius-inner=".25" radius-outer=".275" color="#07111b" material="shader: flat; depthTest: false"></a-ring>' +
      '<a-entity class="scope-image"></a-entity>' +
      '<a-entity line="start: -.025 0 .003; end: .025 0 .003; color: #ffdf60"></a-entity>' +
      '<a-entity line="start: 0 -.025 .003; end: 0 .025 .003; color: #ffdf60"></a-entity>' +
      '<a-text class="scope-score" font="sourcecodepro" align="center" width=".8" color="#fff0ae" position="0 -.29 .01"></a-text>';
    this.cameraEl.appendChild(this.hud);
    this.screen = new THREE.Mesh(new THREE.CircleGeometry(.25, 48), new THREE.MeshBasicMaterial({ map: this.renderTarget.texture, depthTest: false }));
    this.screen.renderOrder = 20;
    this.hud.querySelector('.scope-image').setObject3D('mesh', this.screen);
    this.onOption = evt => {
      const key = OPTIONS[evt.detail.key]; if (!key) return;
      this.settings = sanitizeScopeSettings({ ...this.settings, [key]: evt.detail.value });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch (_) {}
      this.filter.reset(); this.uiDirty = true;
      if (!this.settings.enabled) this.returnToNeck();
    };
    this.onSelection = evt => { if (evt.detail.value === 'space-reset-targets') this.resetScores(); };
    this.onReady = () => { this.uiDirty = true; };
    this.onRelease = () => {
      this.el.components['simple-grabbable'].resetToSpawn(); this.setActive(false); this.restoreWatch();
      document.querySelector('#space-rig').components['desktop-controls']?.stopAiming();
    };
    this.onGrab = evt => {
      const watch = evt.detail.handEl.components['hand-with-watch']?.projectedMenu;
      if (watch) { this.heldWatch = watch; this.oldAutomatic = watch.data.automatic; watch.data.automatic = false; watch.close(); }
    };
    this.onKey = evt => {
      if (evt.code !== 'KeyB' || evt.repeat || !this.settings.enabled || this.el.sceneEl.renderer.xr.getSession()) return;
      const desktop = document.querySelector('#space-rig').components['desktop-controls'];
      if (desktop.mode !== 'normal') return;
      const grab = this.el.components['simple-grabbable'];
      if (grab.state === 'held') grab.release(); else grab.grab(desktop.getDominantHand()?.el);
    };
    this.fireBindings = [];
    for (const hand of this.el.sceneEl.querySelectorAll('.hand')) {
      const fire = () => { if (this.el.components['simple-grabbable']?.handEl === hand) this.fire(); };
      hand.addEventListener('triggerdown', fire); hand.addEventListener('desktop-trigger-attempt', fire);
      this.fireBindings.push([hand, fire]);
    }
    this.el.addEventListener('simple-released', this.onRelease); this.el.addEventListener('simple-grabbed', this.onGrab);
    this.el.sceneEl.addEventListener('menu-option-change', this.onOption); this.el.sceneEl.addEventListener('menu-item-select', this.onSelection);
    this.el.sceneEl.addEventListener('watch-menu-ready', this.onReady); this.el.sceneEl.addEventListener('exit-vr', this.onRelease);
    window.addEventListener('keydown', this.onKey);
  },
  restoreWatch: function () {
    if (this.heldWatch) this.heldWatch.data.automatic = this.oldAutomatic;
    this.heldWatch = null;
  },
  returnToNeck: function () {
    const grab = this.el.components['simple-grabbable'];
    if (grab?.state === 'held') grab.release();
    this.setActive(false); this.restoreWatch();
  },
  setActive: function (active) {
    const wasActive = this.active;
    if (active !== this.active) { this.filter.reset(); this.lastRender = -Infinity; this.renderedPose = null; }
    this.active = active; this.hud.object3D.visible = active;
    this.model.visible = !active;
    if (active && !this.hiddenHand) {
      const hand = this.el.components['simple-grabbable']?.handEl?.components['semantic-hand'];
      if (hand) { this.hiddenHand = (hand.handSpaceEl || hand.visualModel).object3D; this.handWasVisible = this.hiddenHand.visible; }
    }
    if (active && this.hiddenHand) this.hiddenHand.visible = false;
    if (!active && this.hiddenHand) { this.hiddenHand.visible = this.handWasVisible; this.hiddenHand = null; }
    const zone = this.el.components['hint-zone'];
    if (active && zone) {
      zone.cardEl.object3D.visible = false; zone.highlightRoot.visible = false;
    } else if (wasActive && zone) zone.cardEl.object3D.visible = zone.hintOpacity > 0;
    this.el.setAttribute('data-scope-active', active ? 'true' : 'false');
  },
  renderUI: function () {
    let count = 0;
    for (const el of this.el.sceneEl.querySelectorAll('[menu-option]')) {
      const row = el.components['menu-option'], key = row && OPTIONS[row.data.key];
      if (key) { row.setValue(this.settings[key]); row.valueTextEl.setAttribute('width', 1.2); count++; }
    }
    this.uiDirty = count < Object.keys(OPTIONS).length * 2;
    this.el.sceneEl.querySelectorAll('.space-scope-link').forEach(el => el.setAttribute('text', 'value', 'Binoculars: ' + (this.settings.enabled ? 'ON >' : 'OFF >')));
    const raw = this.scores.raw, damp = this.scores.damped;
    this.el.sceneEl.querySelectorAll('.space-scope-live').forEach(el => el.setAttribute('text', 'value', `Raw ${raw.hits}/${raw.shots} | Damped ${damp.hits}/${damp.shots}`));
  },
  resetScores: function () {
    this.scores = { raw: { hits: 0, shots: 0 }, damped: { hits: 0, shots: 0 } };
    document.querySelector('#space-landscape')?.components['scope-landscape']?.resetTargets(); this.renderUI();
  },
  fire: function () {
    if (!this.active || !this.renderedPose || this.lastShot === this.lastTime) return false;
    this.lastShot = this.lastTime;
    const room = document.querySelector('#space-room'), landscapeEl = document.querySelector('#space-landscape');
    const landscape = landscapeEl?.components['scope-landscape']; if (!landscape) return false;
    this.el.sceneEl.object3D.updateMatrixWorld(true);
    // Scope refresh is capped at 30 Hz. Hit-test the exact displayed pose,
    // rather than a newer filtered pose which has not reached the texture yet.
    this.direction.set(0, 0, -1).applyQuaternion(this.renderedPose.quaternion);
    this.ray.set(this.renderedPose.position, this.direction);
    const objects = [landscapeEl.object3D, room.getObject3D('room-shell'), document.querySelector('#space-floor').object3D].filter(Boolean);
    const hit = this.ray.intersectObjects(objects, true)[0];
    let target = hit?.object;
    while (target && !target.userData.scopeTarget) target = target.parent;
    const score = this.scores[this.renderedPose.stabilize ? 'damped' : 'raw']; score.shots++;
    if (target) { score.hits++; landscape.flash(target, this.lastTime); }
    this.renderUI(); return Boolean(target);
  },
  tick: function (time) {
    this.lastTime = time;
    if (this.uiDirty) this.renderUI();
    const grab = this.el.components['simple-grabbable'];
    if (!grab) return;
    const rig = document.querySelector('#space-rig'), gain = rig.components['speed-dependent-gain'];
    this.cameraEl.object3D.getWorldPosition(this.headPosition); this.cameraEl.object3D.getWorldQuaternion(this.headQuaternion);
    // Hanging prop follows chest yaw, not the pitch of looking down at it.
    const yaw = new THREE.Euler().setFromQuaternion(this.headQuaternion, 'YXZ').y;
    const chest = this.headPosition.clone().add(new THREE.Vector3(0, -.43, -.18).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    const anchor = this.el.parentEl.object3D;
    anchor.parent.updateWorldMatrix(true, false);
    anchor.position.copy(anchor.parent.worldToLocal(chest.clone()));
    const parentQ = anchor.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    anchor.quaternion.copy(parentQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)));
    anchor.updateMatrixWorld(true);
    this.el.object3D.visible = this.settings.enabled;
    this.strap.visible = this.settings.enabled;
    if (!this.settings.enabled) { this.setActive(false); return; }
    const hand = grab.handEl?.components['semantic-hand'];
    const xr = this.el.sceneEl.renderer.xr.getSession();
    if (hand && !xr && hand.isAiming) {
      const pose = this.headPosition.clone().add(new THREE.Vector3(0, -.015, -.14).applyQuaternion(this.headQuaternion));
      hand.setWorldTransform(pose, this.headQuaternion, 'Hold');
    }
    this.el.object3D.getWorldPosition(this.position); this.el.object3D.getWorldQuaternion(this.quaternion);
    const strapPositions = this.strap.geometry.attributes.position;
    strapPositions.setXYZ(0, chest.x, chest.y + .1, chest.z); strapPositions.setXYZ(1, this.position.x, this.position.y, this.position.z);
    strapPositions.needsUpdate = true;
    this.eyePosition.set(0, 0, .13).applyQuaternion(this.quaternion).add(this.position);
    this.direction.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.headDirection.set(0, 0, -1).applyQuaternion(this.headQuaternion);
    const active = grab.state === 'held' && this.eyePosition.distanceTo(this.headPosition) < .3 &&
      this.direction.dot(this.headDirection) > .85 && !gain.watchOpen() && (!xr || gain.hasPose);
    this.setActive(active);
    if (!active) return;
    this.hud.object3D.traverse(object => {
      object.renderOrder = object === this.screen ? 20 : 22;
      if (object.material) object.material.depthTest = false;
    });
    this.eyePosition.set(0, 0, -.16).applyQuaternion(this.quaternion).add(this.position);
    const filtered = this.filter.sample(this.eyePosition, this.quaternion, time, this.settings);
    if (!filtered) { this.setActive(false); return; }
    this.scopeCamera.position.copy(filtered.position); this.scopeCamera.quaternion.copy(filtered.quaternion);
    this.scopeCamera.fov = 48 / this.settings.zoom; this.scopeCamera.updateProjectionMatrix();
    const score = this.scores[this.settings.stabilize ? 'damped' : 'raw'];
    this.hud.querySelector('.scope-score').setAttribute('text', 'value', `${this.settings.stabilize ? 'Damped' : 'Raw'} ${score.hits}/${score.shots} hits`);
    if (time - this.lastRender < 33) return;
    this.lastRender = time;
    const renderer = this.el.sceneEl.renderer, target = renderer.getRenderTarget(), xrEnabled = renderer.xr.enabled;
    const hidden = [...this.el.sceneEl.querySelectorAll('.hand, .watch-menu-panel, .interaction-hint-card')]
      .map(el => [el.object3D, el.object3D.visible]);
    hidden.forEach(([object]) => { object.visible = false; });
    this.hud.object3D.visible = false;
    try {
      renderer.xr.enabled = false; renderer.setRenderTarget(this.renderTarget);
      renderer.render(this.el.sceneEl.object3D, this.scopeCamera);
      this.renderedPose = { position: this.scopeCamera.position.clone(), quaternion: this.scopeCamera.quaternion.clone(),
        stabilize: this.settings.stabilize };
    } finally {
      renderer.setRenderTarget(target); renderer.xr.enabled = xrEnabled;
      hidden.forEach(([object, visible]) => { object.visible = visible; });
      this.hud.object3D.visible = this.active;
    }
  },
  remove: function () {
    this.returnToNeck();
    this.el.removeEventListener('simple-released', this.onRelease); this.el.removeEventListener('simple-grabbed', this.onGrab);
    this.el.sceneEl.removeEventListener('menu-option-change', this.onOption); this.el.sceneEl.removeEventListener('menu-item-select', this.onSelection);
    this.el.sceneEl.removeEventListener('watch-menu-ready', this.onReady); this.el.sceneEl.removeEventListener('exit-vr', this.onRelease);
    window.removeEventListener('keydown', this.onKey);
    this.fireBindings.forEach(([hand, fn]) => { hand.removeEventListener('triggerdown', fn); hand.removeEventListener('desktop-trigger-attempt', fn); });
    const materials = new Set(); this.model.traverse(object => { object.geometry?.dispose(); if (object.material) materials.add(object.material); });
    materials.forEach(material => material.dispose());
    this.strap.geometry.dispose(); this.strap.material.dispose(); this.el.sceneEl.object3D.remove(this.strap);
    this.renderTarget.dispose(); this.screen.geometry.dispose(); this.screen.material.dispose(); this.hud.remove();
    this.el.removeObject3D('binocular-model');
  },
});
