import '../../common/watch-menu.js';
import '../../common/locomotion.js';
import '../../common/desktop-controls.js';
import '../../common/checker-floor.js';
import './movement-gain.js';
import { measureBounds, isInsideBoundary, mapLayout, sanitizeWorldScale, scaledRoomBounds } from './play-space.js';
import { boundaryTarget } from './redirection.js';
import { TravelTrail, TRAIL_METRES } from './travel-trail.js';
import { installExperimentMenus } from './experiment-menus.js';
import './binoculars.js';

installExperimentMenus();

const THREE = AFRAME.THREE;
const PREVIEW = [{ x: -2, z: -1.5 }, { x: 2, z: -1.5 }, { x: 2, z: 1.5 }, { x: -2, z: 1.5 }];
const PHYSICAL_COLOR = '#ffad54', VIRTUAL_COLOR = '#c084fc';
const WORLD_SCALE_KEY = 'vr-expansive-world-scale-v1';

AFRAME.registerComponent('expansive-space', {
  init: function () {
    let savedScale;
    try { savedScale = JSON.parse(localStorage.getItem(WORLD_SCALE_KEY))?.worldScale; } catch (_) {}
    this.worldScale = sanitizeWorldScale(savedScale);
    this.scaleSettingsDirty = true;
    this.session = null;
    this.boundedSpace = null;
    this.frameHandle = null;
    this.detected = false;
    this.lastDraw = -Infinity;
    this.matrix = new THREE.Matrix4();
    this.viewerMatrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.virtualPosition = new THREE.Vector3();
    this.virtualDirection = new THREE.Vector3(0, 0, -1);
    this.physicalTrail = new TravelTrail();
    this.virtualTrail = new TravelTrail();
    this.lastTravelEpoch = null;
    this.inverseWorld = new THREE.Matrix4();
    this.outlineMatrix = new THREE.Matrix4();
    this.effectMatrix = new THREE.Matrix4();
    this.guideDirection = new THREE.Vector3();
    this.guideHit = new THREE.Vector3();
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 384;
    this.context = this.canvas.getContext('2d');
    this.mapTexture = new THREE.CanvasTexture(this.canvas);
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.minFilter = THREE.LinearFilter;
    this.mapTexture.generateMipmaps = false;
    this.onEnter = this.start.bind(this);
    this.onExit = this.stop.bind(this);
    this.onWatchReady = function (evt) {
      evt.detail.panelEl.querySelectorAll('a-text').forEach(el => {
        el.setAttribute('font', 'sourcecodepro');
        el.setAttribute('shader', 'sdf');
      });
      this.renderStatus();
      this.scaleSettingsDirty = true;
    }.bind(this);
    this.onReset = this.refreshBoundary.bind(this);
    this.onTravelReset = this.clearTrails.bind(this);
    this.onWorldScale = function (evt) {
      if (evt.detail.key !== 'space-world-scale') return;
      this.worldScale = sanitizeWorldScale(evt.detail.value);
      try { localStorage.setItem(WORLD_SCALE_KEY, JSON.stringify({ worldScale: this.worldScale })); } catch (_) {}
      // Resize only the room geometry: preserve the pose transform and trails.
      this.buildRoom();
      this.renderWorldScale();
      this.renderStatus();
      this.drawMap();
    }.bind(this);
    this.el.sceneEl.addEventListener('enter-vr', this.onEnter);
    this.el.sceneEl.addEventListener('exit-vr', this.onExit);
    this.el.sceneEl.addEventListener('watch-menu-ready', this.onWatchReady);
    this.el.sceneEl.addEventListener('space-travel-reset', this.onTravelReset);
    this.el.sceneEl.addEventListener('menu-option-change', this.onWorldScale);
    this.setBoundary(PREVIEW);
    this.setStatus('Preview boundary - 4.0 x 3.0 m', 'Enter VR to read your boundary.');
    this.drawMap();
  },

  setStatus: function (status, detail) {
    this.status = status;
    this.detail = detail;
    this.renderStatus();
  },

  renderStatus: function () {
    const b = this.virtualBounds;
    const roomSize = b ? '\nRoom ' + b.width.toFixed(1) + ' x ' + b.depth.toFixed(1) + ' m (' + this.worldScale.toFixed(2) + 'x)' : '';
    this.el.sceneEl.querySelectorAll('.space-status').forEach(el => el.setAttribute('text', 'value', this.status + roomSize));
    this.el.sceneEl.querySelectorAll('.space-detail').forEach(el => el.setAttribute('text', 'value', this.detail));
  },

  renderWorldScale: function () {
    let synchronized = 0;
    this.el.sceneEl.querySelectorAll('[menu-option]').forEach(el => {
      const row = el.components['menu-option'];
      if (!row || row.data.key !== 'space-world-scale') return;
      row.setValue(this.worldScale);
      row.valueTextEl.setAttribute('width', 1.4);
      synchronized++;
    });
    this.scaleSettingsDirty = synchronized < 2;
  },

  setBoundary: function (points) {
    const bounds = measureBounds(points);
    if (!bounds) return false;
    this.points = Array.from(points, point => ({ x: point.x, z: point.z }));
    this.bounds = bounds;
    this.steeringCenter = boundaryTarget(this.points);
    this.clearTrails();
    this.layout = mapLayout(bounds);
    this.buildRoom();
    this.buildBoundaryOutline();
    return true;
  },

  clearTrails: function () {
    this.physicalTrail.clear();
    this.virtualTrail.clear();
    this.lastTravelEpoch = null;
    this.virtualPosition.copy(this.position);
    this.virtualDirection.copy(this.direction);
  },

  disposeRoom: function (removeOutline = true) {
    const outline = this.el.getObject3D('boundary-outline');
    if (outline && removeOutline) {
      outline.geometry.dispose();
      outline.material.dispose();
      this.el.removeObject3D('boundary-outline');
    }
    const group = this.el.getObject3D('room-shell');
    if (!group) return;
    const materials = new Set();
    group.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) materials.add(object.material);
    });
    materials.forEach(material => material.dispose());
    this.el.removeObject3D('room-shell');
  },

  buildRoom: function () {
    this.disposeRoom(false);
    const b = this.virtualBounds = scaledRoomBounds(this.bounds, this.worldScale);
    const height = 2.7, thickness = 0.08;
    const group = new THREE.Group();
    const wallMaterial = new THREE.MeshStandardMaterial({ color: '#70849d', roughness: 1 });
    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#b2bed0', roughness: 1 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: '#263550', roughness: 1 });
    function box(width, h, depth, x, y, z, material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, h, depth), material);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    }
    // Grow width/depth around the boundary center without scaling the room
    // entity itself: raw tracking, hand reach and checker size stay unchanged.
    [b.minZ - thickness / 2, b.maxZ + thickness / 2].forEach(z => {
      box(b.width + thickness * 2, height, thickness, b.centerX, height / 2, z, wallMaterial);
      box(b.width, .09, .02, b.centerX, .045, z < b.centerZ ? b.minZ + .01 : b.maxZ - .01, trimMaterial);
    });
    box(thickness, height, b.depth, b.minX - thickness / 2, height / 2, b.centerZ, wallMaterial);
    box(.02, .09, b.depth, b.minX + .01, .045, b.centerZ, trimMaterial);
    const opening = Math.min(3.6, b.depth * .8), side = (b.depth - opening) / 2, x = b.maxX + thickness / 2;
    box(thickness, .8, opening, x, .4, b.centerZ, wallMaterial);
    box(thickness, .6, opening, x, 2.4, b.centerZ, wallMaterial);
    for (const sign of [-1, 1]) box(thickness, height, side, x, height / 2,
      b.centerZ + sign * (opening / 2 + side / 2), wallMaterial);
    for (const z of [-opening / 2, -opening / 6, opening / 6, opening / 2])
      box(.12, 1.3, .055, x, 1.45, b.centerZ + z, trimMaterial);
    box(.12, .06, opening, x, .8, b.centerZ, trimMaterial);
    box(.12, .06, opening, x, 2.1, b.centerZ, trimMaterial);
    this.ceiling = box(b.width, thickness, b.depth, b.centerX, height + thickness / 2, b.centerZ, ceilingMaterial);
    this.el.setObject3D('room-shell', group);
    const floor = this.el.querySelector('#space-floor');
    floor.setAttribute('width', b.width);
    floor.setAttribute('height', b.depth);
    floor.setAttribute('position', { x: b.centerX, y: 0, z: b.centerZ });
    const panel = this.el.querySelector('#space-wall-panel');
    panel.setAttribute('position', { x: b.centerX, y: 1.6, z: b.minZ + .025 });
    panel.object3D.scale.setScalar(Math.min(1, b.width / 1.7));
    this.el.sceneEl.emit('space-room-resized', { bounds: b }, false);
  },

  buildBoundaryOutline: function () {
    const previous = this.el.getObject3D('boundary-outline');
    if (previous) {
      previous.geometry.dispose(); previous.material.dispose();
      this.el.removeObject3D('boundary-outline');
    }
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(this.points.map(point => new THREE.Vector3(point.x, .025, point.z)));
    const outline = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({ color: '#22d3ee', depthTest: false }));
    outline.renderOrder = 1;
    // This outline follows the physical room even when gain moves the virtual
    // viewpoint. The shell/floor remain in virtual coordinates.
    this.el.setObject3D('boundary-outline', outline);
  },

  resetRig: function () {
    const rig = document.querySelector('#space-rig');
    if (!rig) return;
    const gain = rig.components['speed-dependent-gain'];
    if (gain) gain.resetTravel();
    rig.object3D.position.set(0, 0, 0);
    rig.object3D.quaternion.identity();
  },

  start: function () {
    const xr = this.el.sceneEl.renderer && this.el.sceneEl.renderer.xr;
    const session = xr && xr.getSession();
    if (!session || session === this.session) return;
    this.releaseSession();
    this.session = session;
    this.resetRig();
    this.showPreview();
    this.setStatus('Reading headset boundary…', 'Waiting for bounded-floor data.');
    session.requestReferenceSpace('bounded-floor').then(space => {
      if (this.session !== session) return;
      this.boundedSpace = space;
      space.addEventListener('reset', this.onReset);
      this.refreshBoundary();
      const onFrame = (time, frame) => {
        if (this.session !== session) return;
        this.updateFromFrame(frame);
        this.frameHandle = session.requestAnimationFrame(onFrame);
      };
      this.frameHandle = session.requestAnimationFrame(onFrame);
    }).catch(() => {
      if (this.session !== session) return;
      this.setStatus('Preview boundary - boundary unavailable', 'This browser did not expose a boundary.\nUsing a 4 x 3 m preview footprint.');
    });
  },

  refreshBoundary: function () {
    const points = this.boundedSpace && this.boundedSpace.boundsGeometry;
    if (!this.setBoundary(points)) {
      this.showPreview();
      this.setStatus('Preview boundary - no boundary supplied', 'No usable boundary geometry.\nUsing a 4 x 3 m preview footprint.');
      return false;
    }
    this.boundaryValid = true;
    this.detected = false; // A pose is required before claiming alignment.
    this.setStatus('Aligning room to boundary…', 'Waiting for headset tracking.');
    return true;
  },

  updateFromFrame: function (frame) {
    const baseSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();
    if (!baseSpace || !this.boundedSpace || !this.boundaryValid) return;
    const pose = frame.getPose(this.boundedSpace, baseSpace);
    const viewer = frame.getViewerPose(this.boundedSpace);
    if (!pose || !viewer) return;
    this.matrix.fromArray(pose.transform.matrix);
    this.matrix.decompose(this.el.object3D.position, this.el.object3D.quaternion, this.el.object3D.scale);
    this.viewerMatrix.fromArray(viewer.transform.matrix);
    this.position.setFromMatrixPosition(this.viewerMatrix);
    this.direction.set(0, 0, -1).transformDirection(this.viewerMatrix);
    if (!this.detected) {
      this.clearTrails(); // Discard samples taken in the unaligned preview frame.
      this.detected = true;
      const b = this.bounds;
      this.setStatus('Headset boundary - ' + b.width.toFixed(1) + ' x ' + b.depth.toFixed(1) + ' m',
        'Cyan = physical boundary.\nGray = virtual room footprint.');
    }
  },

  releaseSession: function () {
    if (this.boundedSpace) this.boundedSpace.removeEventListener('reset', this.onReset);
    if (this.session && this.frameHandle !== null) this.session.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.session = null;
    this.boundedSpace = null;
    this.detected = false;
    this.boundaryValid = false;
  },

  stop: function () {
    this.releaseSession();
    this.showPreview();
    this.resetRig();
    this.setStatus('Preview boundary - 4.0 x 3.0 m', 'Enter VR to read your boundary.');
  },

  showPreview: function () {
    this.detected = false;
    this.boundaryValid = false;
    this.el.object3D.position.set(0, 0, 0);
    this.el.object3D.quaternion.identity();
    this.el.object3D.scale.setScalar(1);
    this.setBoundary(PREVIEW);
  },

  drawMap: function () {
    const gain = document.querySelector('#space-rig')?.components['speed-dependent-gain'];
    let reachable = this.points;
    if (gain) {
      this.effectMatrix.makeRotationY(gain.extraYaw).setPosition(gain.extraTranslation);
      this.outlineMatrix.copy(this.inverseWorld).multiply(this.effectMatrix).multiply(this.el.object3D.matrixWorld);
      reachable = this.points.map(point => {
        this.guideHit.set(point.x, 0, point.z).applyMatrix4(this.outlineMatrix);
        return { x: this.guideHit.x, z: this.guideHit.z };
      });
    }
    // Both trajectories use the same metric frame. Include retained history
    // and current markers so gained travel is never pinned to the map edge.
    const room = this.virtualBounds;
    this.layout = mapLayout(measureBounds([...this.points, ...reachable, { x: room.minX, z: room.minZ }, { x: room.maxX, z: room.maxZ }, ...this.physicalTrail.points,
      ...this.virtualTrail.points, this.position, this.virtualPosition]), 512, 384, 60);
    const ctx = this.context, b = room, physical = this.bounds, project = this.layout.project;
    ctx.fillStyle = '#101827';
    ctx.fillRect(0, 0, 512, 384);
    const topLeft = project({ x: b.minX, z: b.minZ });
    ctx.fillStyle = '#25344a';
    ctx.fillRect(topLeft.x, topLeft.y, b.width * this.layout.scale, b.depth * this.layout.scale);
    ctx.strokeStyle = '#788ba5';
    ctx.lineWidth = 2;
    ctx.strokeRect(topLeft.x, topLeft.y, b.width * this.layout.scale, b.depth * this.layout.scale);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 4;
    ctx.beginPath();
    this.points.forEach((point, index) => {
      const p = project(point);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    reachable.forEach((point, index) => {
      const p = project(point);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    ctx.save();
    ctx.beginPath(); ctx.rect(8, 40, 496, 294); ctx.clip();
    const drawTrail = (trail, color, width, dash) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      trail.points.forEach(point => {
        const p = project(point);
        if (point.start) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    };
    drawTrail(this.physicalTrail, PHYSICAL_COLOR, 5, []);
    // Dashes leave the physical line visible where the two paths coincide.
    drawTrail(this.virtualTrail, VIRTUAL_COLOR, 3, [7, 5]);
    ctx.setLineDash([]);
    const drawHeading = (position, direction, color, size, filled) => {
      const p = project(position);
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(direction.x, -direction.z));
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -size); ctx.lineTo(size * .53, size * .37);
      ctx.lineTo(0, size * .16); ctx.lineTo(-size * .53, size * .37);
      ctx.closePath();
      if (filled) ctx.fill(); else ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, filled ? 5 : 8, 0, Math.PI * 2);
      if (filled) ctx.fill(); else ctx.stroke();
      ctx.restore();
    };
    const inside = isInsideBoundary(this.position, this.points);
    const guide = gain?.redirection.guidance, settings = gain?.redirection.settings;
    const showGuide = guide?.valid && guide.urgency > .05 &&
      ((settings.steeringEnabled && settings.steeringMode === 'adaptive') || settings.turnEnabled);
    if (showGuide) {
      this.guideDirection.set(-Math.sin(guide.desiredHeading), 0, -Math.cos(guide.desiredHeading))
        .transformDirection(this.inverseWorld);
      const from = project(this.position), to = project({ x: this.position.x + this.guideDirection.x * .65,
        z: this.position.z + this.guideDirection.z * .65 });
      ctx.strokeStyle = '#6ee7a8'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      drawHeading({ x: this.position.x + this.guideDirection.x * .65, z: this.position.z + this.guideDirection.z * .65 },
        this.guideDirection, '#6ee7a8', 10, true);
      this.guideHit.set(guide.hit.x, 0, guide.hit.z).applyMatrix4(this.inverseWorld);
      const hit = project(this.guideHit);
      ctx.strokeStyle = '#fb7185'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(hit.x, hit.y, 7, 0, Math.PI * 2); ctx.stroke();
    }
    drawHeading(this.position, this.direction, PHYSICAL_COLOR, 19, true);
    drawHeading(this.virtualPosition, this.virtualDirection, VIRTUAL_COLOR, 13, false);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText('Real ' + physical.width.toFixed(1) + ' × ' + physical.depth.toFixed(1) +
      ' m | Room ' + b.width.toFixed(1) + ' × ' + b.depth.toFixed(1) + ' m', 256, 26);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('Dashed boundary: reachable game space now', 256, 46);
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillStyle = PHYSICAL_COLOR; ctx.fillText('Real', 64, 350);
    ctx.fillStyle = VIRTUAL_COLOR; ctx.fillText('Game', 155, 350);
    ctx.fillStyle = '#bfcee2';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Last ' + TRAIL_METRES + ' m | Green: desired path', 345, 350);
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillStyle = inside ? '#aab8d2' : '#fb7185';
    ctx.fillText(!inside ? 'OUTSIDE ' + (this.detected ? 'BOUNDARY' : 'PREVIEW FOOTPRINT') :
      this.detected ? 'LIVE HEADSET BOUNDARY' : 'PREVIEW · NOT A DETECTED BOUNDARY', 256, 371);
    this.mapTexture.needsUpdate = true;
  },

  sampleTravel: function (gain, xrSession) {
    if (gain && !gain.hasPose) return;
    this.el.object3D.updateWorldMatrix(true, false);
    this.inverseWorld.copy(this.el.object3D.matrixWorld).invert();
    if (xrSession && gain) {
      // Sample the raw XR pose and its corrected pose together. The scene
      // camera can still contain the previous render frame's tracked pose.
      this.position.copy(gain.rawPosition).applyMatrix4(this.inverseWorld);
      this.direction.copy(gain.direction).transformDirection(this.inverseWorld);
      this.virtualPosition.copy(gain.rawPosition).applyQuaternion(gain.el.object3D.quaternion)
        .add(gain.el.object3D.position).applyMatrix4(this.inverseWorld);
      this.virtualDirection.copy(gain.direction).applyQuaternion(gain.el.object3D.quaternion)
        .transformDirection(this.inverseWorld);
    } else {
      const camera = document.querySelector('#space-camera');
      if (!camera) return;
      camera.object3D.getWorldPosition(this.virtualPosition);
      camera.object3D.getWorldDirection(this.virtualDirection).negate();
      this.position.copy(this.virtualPosition);
      this.direction.copy(this.virtualDirection);
      if (gain) {
        gain.physicalPosition(this.position, this.position);
        gain.physicalDirection(this.direction);
      }
      this.position.applyMatrix4(this.inverseWorld);
      this.direction.transformDirection(this.inverseWorld);
      this.virtualPosition.applyMatrix4(this.inverseWorld);
      this.virtualDirection.transformDirection(this.inverseWorld);
    }
    const epoch = gain ? gain.travelEpoch : 0;
    const interrupted = this.lastTravelEpoch !== epoch;
    this.physicalTrail.add(this.position, interrupted);
    this.virtualTrail.add(this.virtualPosition, interrupted);
    this.lastTravelEpoch = epoch;
  },

  tick: function (time) {
    if (this.scaleSettingsDirty) this.renderWorldScale();
    // enter-vr can precede the renderer attaching its session by a frame.
    const xr = this.el.sceneEl.renderer && this.el.sceneEl.renderer.xr;
    if (xr && xr.getSession() && xr.getSession() !== this.session) this.start();
    const rig = document.querySelector('#space-rig');
    const gain = rig && rig.components['speed-dependent-gain'];
    if (this.ceiling) this.ceiling.visible = !(gain?.motion.settings.jumpEnabled && gain.motion.settings.jumpVerticalGain > 1);
    const outline = this.el.getObject3D('boundary-outline');
    if (outline && gain) {
      // The physical boundary receives the same full transform as the rig.
      // Conjugate it into room-local coordinates for rotated bounded spaces.
      this.el.object3D.updateWorldMatrix(true, false);
      this.effectMatrix.makeRotationY(gain.extraYaw).setPosition(gain.extraTranslation);
      this.outlineMatrix.copy(this.el.object3D.matrixWorld).invert()
        .multiply(this.effectMatrix).multiply(this.el.object3D.matrixWorld);
      this.outlineMatrix.decompose(outline.position, outline.quaternion, outline.scale);
    }
    if (time - this.lastDraw < 100) return;
    this.lastDraw = time;
    this.sampleTravel(gain, xr && xr.getSession());
    this.drawMap();
  },

  remove: function () {
    this.releaseSession();
    this.el.sceneEl.removeEventListener('enter-vr', this.onEnter);
    this.el.sceneEl.removeEventListener('exit-vr', this.onExit);
    this.el.sceneEl.removeEventListener('watch-menu-ready', this.onWatchReady);
    this.el.sceneEl.removeEventListener('space-travel-reset', this.onTravelReset);
    this.el.sceneEl.removeEventListener('menu-option-change', this.onWorldScale);
    this.disposeRoom();
    this.mapTexture.dispose();
  },
});

// All three displays share one texture; no extra scene camera/render pass.
AFRAME.registerComponent('boundary-map', {
  schema: { width: { default: .96 }, height: { default: .72 } },
  init: function () {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.data.width, this.data.height),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.el.setObject3D('mesh', this.mesh);
  },
  tick: function () {
    if (this.mesh.material.map) return;
    const room = document.querySelector('#space-room');
    const component = room && room.components['expansive-space'];
    if (!component) return;
    this.mesh.material.map = component.mapTexture;
    this.mesh.material.needsUpdate = true;
  },
  remove: function () {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.el.removeObject3D('mesh');
  },
});
