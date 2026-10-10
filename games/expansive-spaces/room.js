import '../../common/watch-menu.js';
import '../../common/locomotion.js';
import '../../common/desktop-controls.js';
import '../../common/checker-floor.js';
import './movement-gain.js';
import { measureBounds, isInsideBoundary, mapLayout } from './play-space.js';
import { boundaryTarget } from './redirection.js';

const THREE = AFRAME.THREE;
const PREVIEW = [{ x: -2, z: -1.5 }, { x: 2, z: -1.5 }, { x: 2, z: 1.5 }, { x: -2, z: 1.5 }];

AFRAME.registerComponent('expansive-space', {
  init: function () {
    this.session = null;
    this.boundedSpace = null;
    this.frameHandle = null;
    this.detected = false;
    this.lastDraw = -Infinity;
    this.matrix = new THREE.Matrix4();
    this.viewerMatrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.outlineMatrix = new THREE.Matrix4();
    this.effectMatrix = new THREE.Matrix4();
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
    }.bind(this);
    this.onReset = this.refreshBoundary.bind(this);
    this.el.sceneEl.addEventListener('enter-vr', this.onEnter);
    this.el.sceneEl.addEventListener('exit-vr', this.onExit);
    this.el.sceneEl.addEventListener('watch-menu-ready', this.onWatchReady);
    this.setBoundary(PREVIEW);
    this.setStatus('Preview room - 4.0 x 3.0 m', 'Enter VR to read your boundary.');
    this.drawMap();
  },

  setStatus: function (status, detail) {
    this.status = status;
    this.detail = detail;
    this.renderStatus();
  },

  renderStatus: function () {
    this.el.sceneEl.querySelectorAll('.space-status').forEach(el => el.setAttribute('text', 'value', this.status));
    this.el.sceneEl.querySelectorAll('.space-detail').forEach(el => el.setAttribute('text', 'value', this.detail));
  },

  setBoundary: function (points) {
    const bounds = measureBounds(points);
    if (!bounds) return false;
    this.points = Array.from(points, point => ({ x: point.x, z: point.z }));
    this.bounds = bounds;
    this.steeringCenter = boundaryTarget(this.points);
    this.layout = mapLayout(bounds);
    this.buildRoom();
    return true;
  },

  disposeRoom: function () {
    const outline = this.el.getObject3D('boundary-outline');
    if (outline) {
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
    this.disposeRoom();
    const b = this.bounds;
    const height = 2.7, thickness = 0.08;
    const group = new THREE.Group();
    const wallMaterial = new THREE.MeshStandardMaterial({ color: '#70849d', roughness: 1 });
    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#b2bed0', roughness: 1 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: '#263550', roughness: 1 });
    function box(width, h, depth, x, y, z, material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, h, depth), material);
      mesh.position.set(x, y, z);
      group.add(mesh);
    }
    // Inner wall faces sit on the rectangular extents, not a thickness inside
    // them. For irregular guardians the cyan polygon is still the actual edge.
    [b.minZ - thickness / 2, b.maxZ + thickness / 2].forEach(z => {
      box(b.width + thickness * 2, height, thickness, b.centerX, height / 2, z, wallMaterial);
      box(b.width, .09, .02, b.centerX, .045, z < b.centerZ ? b.minZ + .01 : b.maxZ - .01, trimMaterial);
    });
    [b.minX - thickness / 2, b.maxX + thickness / 2].forEach(x => {
      box(thickness, height, b.depth, x, height / 2, b.centerZ, wallMaterial);
      box(.02, .09, b.depth, x < b.centerX ? b.minX + .01 : b.maxX - .01, .045, b.centerZ, trimMaterial);
    });
    box(b.width, thickness, b.depth, b.centerX, height + thickness / 2, b.centerZ, ceilingMaterial);
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(this.points.map(point => new THREE.Vector3(point.x, .025, point.z)));
    const outline = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({ color: '#22d3ee', depthTest: false }));
    outline.renderOrder = 1;
    // This outline follows the physical room even when gain moves the virtual
    // viewpoint. The shell/floor remain in virtual coordinates.
    this.el.setObject3D('boundary-outline', outline);
    this.el.setObject3D('room-shell', group);
    const floor = this.el.querySelector('#space-floor');
    floor.setAttribute('width', b.width);
    floor.setAttribute('height', b.depth);
    floor.setAttribute('position', { x: b.centerX, y: 0, z: b.centerZ });
    const panel = this.el.querySelector('#space-wall-panel');
    panel.setAttribute('position', { x: b.centerX, y: 1.6, z: b.minZ + .025 });
    // Keep the map inside a very small reported room as well.
    panel.object3D.scale.setScalar(Math.min(1, b.width / 1.7));
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
      this.setStatus('Preview room - boundary unavailable', 'This browser did not expose a boundary.\nRoom dimensions are a 4 x 3 m preview.');
    });
  },

  refreshBoundary: function () {
    const points = this.boundedSpace && this.boundedSpace.boundsGeometry;
    if (!this.setBoundary(points)) {
      this.showPreview();
      this.setStatus('Preview room - no boundary supplied', 'No usable boundary geometry.\nRoom dimensions are a 4 x 3 m preview.');
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
      this.detected = true;
      const b = this.bounds;
      this.setStatus('Headset boundary - ' + b.width.toFixed(1) + ' x ' + b.depth.toFixed(1) + ' m',
        'Room = rectangular boundary extents.\nCyan = exact headset outline.');
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
    this.setStatus('Preview room - 4.0 x 3.0 m', 'Enter VR to read your boundary.');
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
    const ctx = this.context, b = this.bounds, project = this.layout.project;
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
    const inside = isInsideBoundary(this.position, this.points);
    const p = project(this.position);
    const x = Math.max(14, Math.min(498, p.x)), y = Math.max(44, Math.min(340, p.y));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(this.direction.x, -this.direction.z));
    ctx.fillStyle = inside ? '#ffad54' : '#fb7185';
    ctx.beginPath();
    ctx.moveTo(0, -19); ctx.lineTo(10, 7); ctx.lineTo(0, 3); ctx.lineTo(-10, 7);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText(b.width.toFixed(1) + ' × ' + b.depth.toFixed(1) + ' m', 256, 26);
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillStyle = inside ? '#aab8d2' : '#fb7185';
    ctx.fillText(!inside ? 'OUTSIDE ' + (this.detected ? 'BOUNDARY' : 'PREVIEW ROOM') :
      this.detected ? 'LIVE HEADSET BOUNDARY' : 'PREVIEW · NOT A DETECTED BOUNDARY', 256, 371);
    this.mapTexture.needsUpdate = true;
  },

  tick: function (time) {
    // enter-vr can precede the renderer attaching its session by a frame.
    const xr = this.el.sceneEl.renderer && this.el.sceneEl.renderer.xr;
    if (xr && xr.getSession() && xr.getSession() !== this.session) this.start();
    const rig = document.querySelector('#space-rig');
    const gain = rig && rig.components['speed-dependent-gain'];
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
    if (!this.detected) {
      const camera = document.querySelector('#space-camera');
      if (camera) {
        camera.object3D.getWorldPosition(this.position);
        if (gain) gain.physicalPosition(this.position, this.position);
        this.el.object3D.worldToLocal(this.position);
        camera.object3D.getWorldDirection(this.direction).negate();
        if (gain) gain.physicalDirection(this.direction);
        this.direction.transformDirection(this.el.object3D.matrixWorld.clone().invert());
      }
    }
    this.drawMap();
  },

  remove: function () {
    this.releaseSession();
    this.el.sceneEl.removeEventListener('enter-vr', this.onEnter);
    this.el.sceneEl.removeEventListener('exit-vr', this.onExit);
    this.el.sceneEl.removeEventListener('watch-menu-ready', this.onWatchReady);
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
