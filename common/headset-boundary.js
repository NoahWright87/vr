import { fitBoundaryRectangle } from './boundary-geometry.js';

// Boundary Lab boundary detection, shared by room-scale experiences.
AFRAME.registerComponent('headset-boundary', {
  schema: { showFit: { default: false } },
  init: function () {
    var THREE = AFRAME.THREE;
    this.session = null;
    this.boundedSpace = null;
    this.pending = false;
    this.status = 'Enter VR to detect';
    this.detail = 'The cyan ground outline will match\nthe headset\'s reported play space.';
    this.matrix = new THREE.Matrix4();
    this.point = new THREE.Vector3();
    this.lastMatrix = null;
    this.lastBounds = null;
    this.fit = null;
    this.revision = (this.revision || 0) + 1;
    this.geometry = new THREE.BufferGeometry();
    this.cornerGeometry = new THREE.BufferGeometry();
    this.fitGeometry = new THREE.BufferGeometry();
    this.fitOutline = new THREE.LineLoop(this.fitGeometry,
      new THREE.LineDashedMaterial({ color: '#fbbf24', transparent: true, opacity: 1, dashSize: 0.12, gapSize: 0.08, depthTest: false }));
    this.fitOutline.renderOrder = 2;
    this.fitOutline.visible = false;
    this.outline = new THREE.LineLoop(
      this.geometry,
      new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.95, depthTest: false })
    );
    this.corners = new THREE.Points(
      this.cornerGeometry,
      new THREE.PointsMaterial({ color: '#f8fafc', size: 0.055, sizeAttenuation: true, depthTest: false })
    );
    this.outline.renderOrder = this.corners.renderOrder = 1;
    this.outline.visible = this.corners.visible = false;
    // Do not parent the detected outline to #boundary-rig: smooth or
    // teleport locomotion moves that rig, while boundsGeometry is in
    // the XR reference space. Keeping the visual at the scene root
    // makes it stay fixed to the real room as the player moves.
    this.renderRoot = this.el.sceneEl.object3D;
    this.renderRoot.add(this.outline);
    this.renderRoot.add(this.corners);
    this.renderRoot.add(this.fitOutline);

    this.onEnterVR = this.start.bind(this);
    this.onExitVR = this.stop.bind(this);
    this.onWatchReady = this.renderStatus.bind(this);
    this.el.sceneEl.addEventListener('enter-vr', this.onEnterVR);
    this.el.sceneEl.addEventListener('exit-vr', this.onExitVR);
    this.el.sceneEl.addEventListener('watch-menu-ready', this.onWatchReady);

  },

  setStatus: function (status, detail) {
    this.status = status;
    this.detail = detail;
    this.renderStatus();
  },

  renderStatus: function () {
    var status = this.status;
    var detail = this.detail;
    document.querySelectorAll('.boundary-status').forEach(function (el) {
      el.setAttribute('text', 'value', status);
    });
    document.querySelectorAll('.boundary-detail').forEach(function (el) {
      el.setAttribute('text', 'value', detail);
    });
  },

  start: function () {
    var renderer = this.el.sceneEl.renderer;
    var session = renderer && renderer.xr && renderer.xr.getSession && renderer.xr.getSession();
    if (!session || this.pending || this.session === session) return;
    this.pending = true;
    this.session = session;
    this.setStatus('Requesting headset boundary…', 'Reading the room-scale play space\nfrom this XR session.');

    var self = this;
    session.requestReferenceSpace('bounded-floor').then(function (space) {
      if (self.session !== session) return;
      self.pending = false;
      self.boundedSpace = space;
      self.onSpaceReset = function () { self.lastMatrix = null; self.lastBounds = null; self.revision++; self.el.sceneEl.emit('headset-boundary-reset', {}, false); };
      space.addEventListener('reset', self.onSpaceReset);
      if (!space.boundsGeometry || space.boundsGeometry.length < 3) {
        self.el.sceneEl.emit('headset-boundary-unavailable', {}, false);
        self.setStatus('No boundary geometry supplied', 'This headset/browser supports XR,\nbut did not expose a play-space outline.');
      } else {
        self.setStatus('Boundary detected', 'Compare the cyan reported polygon\nwith your headset safety boundary.');
      }
      session.requestAnimationFrame(function onXRFrame(time, frame) {
        if (self.session !== session) return;
        self.updateFromFrame(frame);
        session.requestAnimationFrame(onXRFrame);
      });
    }).catch(function () {
      if (self.session !== session) return;
      self.pending = false;
      self.el.sceneEl.emit('headset-boundary-unavailable', {}, false);
      self.setStatus('Boundary unavailable', 'This headset or browser does not\nprovide bounded-floor play-space data.');
    });
  },

  stop: function () {
    if (this.boundedSpace && this.onSpaceReset) this.boundedSpace.removeEventListener('reset', this.onSpaceReset);
    this.session = null;
    this.boundedSpace = null;
    this.pending = false;
    this.lastMatrix = null;
    this.el.sceneEl.emit('headset-boundary-ended', {}, false);
    this.outline.visible = this.corners.visible = this.fitOutline.visible = false;
    this.lastBounds = null;
    this.fit = null;
    this.setStatus('Enter VR to detect', 'The cyan outline appears only when\na headset supplies boundary data.');
  },

  updateFromFrame: function (frame) {
    var renderer = this.el.sceneEl.renderer;
    var baseSpace = renderer && renderer.xr && renderer.xr.getReferenceSpace && renderer.xr.getReferenceSpace();
    if (!baseSpace || !this.boundedSpace) return;
    var bounds = this.boundedSpace.boundsGeometry;
    if (!bounds || bounds.length < 3 || Array.from(bounds).some(function (p) { return !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z); })) {
      if (this.lastBounds !== null) this.revision++;
      this.lastBounds = this.lastMatrix = null;
      this.fit = null;
      this.outline.visible = this.corners.visible = this.fitOutline.visible = false;
      this.el.sceneEl.emit('headset-boundary-unavailable', {}, false);
      this.setStatus('No boundary geometry supplied', 'Waiting for a headset-reported polygon.');
      return;
    }
    var boundsKey = Array.from(bounds, function (p) { return p.x + ',' + p.y + ',' + p.z; }).join(';');
    var boundsChanged = this.lastBounds !== boundsKey;
    if (this.lastBounds !== null && boundsChanged) {
      this.revision++;
      this.el.sceneEl.emit('headset-boundary-reset', {}, false);
    }
    if (boundsChanged) {
      this.fit = this.data && this.data.showFit ? fitBoundaryRectangle(Array.from(bounds, function (p) { return { x: p.x, y: p.z }; })) : null;
      this.lastBounds = boundsKey;
    }
    var pose = frame.getPose(this.boundedSpace, baseSpace);
    var viewer = frame.getViewerPose(this.boundedSpace);
    if (!pose || !viewer) {
      this.lastMatrix = null;
      this.outline.visible = this.corners.visible = this.fitOutline.visible = false;
      this.el.sceneEl.emit('headset-boundary-tracking-lost', {}, false);
      return;
    }
    this.el.sceneEl.emit('headset-boundary-frame', {
      points: Array.from(this.boundedSpace.boundsGeometry, function (p) { return { x: p.x, y: p.z }; }),
      matrix: Array.from(pose.transform.matrix),
      position: { x: viewer.transform.position.x, y: viewer.transform.position.z },
      revision: this.revision
    }, false);

    this.matrix.fromArray(pose.transform.matrix);
    var elements = this.matrix.elements;
    if (!boundsChanged && this.lastMatrix && elements.every(function (value, index) {
      return Math.abs(value - this.lastMatrix[index]) < 0.0001;
    }, this)) return;
    this.lastMatrix = elements.slice();

    var positions = new Float32Array(bounds.length * 3);
    var minX = Infinity;
    var maxX = -Infinity;
    var minZ = Infinity;
    var maxZ = -Infinity;
    for (var i = 0; i < bounds.length; i++) {
      var bound = bounds[i];
      minX = Math.min(minX, bound.x);
      maxX = Math.max(maxX, bound.x);
      minZ = Math.min(minZ, bound.z);
      maxZ = Math.max(maxZ, bound.z);
      this.point.set(bound.x, bound.y + 0.028, bound.z).applyMatrix4(this.matrix);
      positions[i * 3] = this.point.x;
      positions[i * 3 + 1] = this.point.y;
      positions[i * 3 + 2] = this.point.z;
    }
    this.geometry.setAttribute('position', new AFRAME.THREE.Float32BufferAttribute(positions, 3));
    this.cornerGeometry.setAttribute('position', new AFRAME.THREE.Float32BufferAttribute(positions, 3));
    this.geometry.computeBoundingSphere();
    this.cornerGeometry.computeBoundingSphere();
    this.outline.visible = this.corners.visible = this.showOutline !== false;
    this.fitOutline.visible = !!this.fit && this.showOutline !== false;
    if (this.fit) {
      var fittedPositions = [];
      for (var corner of this.fit.points) {
        this.point.set(corner.x, 0.034, corner.y).applyMatrix4(this.matrix);
        fittedPositions.push(this.point.x, this.point.y, this.point.z);
      }
      this.fitGeometry.setAttribute('position', new AFRAME.THREE.Float32BufferAttribute(fittedPositions, 3));
      this.fitGeometry.computeBoundingSphere();
      this.fitOutline.computeLineDistances();
    }
    this.setStatus(
      'Boundary detected · ' + bounds.length + ' corners',
      this.data && this.data.showFit
        ? (this.fit ? 'Cyan: reported polygon (' + this.fit.polygonArea.toFixed(2) + ' m²)\nAmber dashed: fitted rectangle\n' + this.fit.width.toFixed(2) + ' × ' + this.fit.depth.toFixed(2) + ' m (' + this.fit.area.toFixed(2) + ' m²)' : 'Cyan: reported polygon\nNo contained rectangle found.')
        : (maxX - minX).toFixed(1) + ' × ' + (maxZ - minZ).toFixed(1) + ' m play-space bounds\nCyan: headset-reported polygon.'
    );
  },

  remove: function () {
    this.stop();
    this.el.sceneEl.removeEventListener('enter-vr', this.onEnterVR);
    this.el.sceneEl.removeEventListener('exit-vr', this.onExitVR);
    this.el.sceneEl.removeEventListener('watch-menu-ready', this.onWatchReady);
    this.renderRoot.remove(this.outline);
    this.renderRoot.remove(this.corners);
    this.renderRoot.remove(this.fitOutline);
    this.geometry.dispose();
    this.cornerGeometry.dispose();
    this.fitGeometry.dispose();
    this.fitOutline.material.dispose();
    this.outline.material.dispose();
    this.corners.material.dispose();
  },
});
