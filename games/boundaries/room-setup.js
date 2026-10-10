import { BoundaryObservation } from './boundary-observation.js';

AFRAME.registerComponent('boundary-room-lab', {
  init: function () {
    this.observation = new BoundaryObservation();
    this.session = null;
    this.planes = new Map();
    this.roomSnapshot = [];
    this.roomStatus = 'Choose Test Room Setup before entering XR';
    this.captureUsed = false;
    this.capturePending = false;
    this.captureMessage = '';
    this.elapsed = 0;
    this.reportedPlanes = 0;
    this.planeAPI = false;
    this.nextStatusTime = 0;
    this.handlers = {
      'enter-vr': () => this.start(),
      'exit-vr': () => this.stop(),
      'watch-menu-ready': () => this.renderStatus(),
      'headset-boundary-sample': e => this.sampleBoundary(e.detail),
      'menu-item-select': e => { if (e.detail.value === 'room-capture') this.captureRoom(); }
    };
    for (const [name, fn] of Object.entries(this.handlers)) this.el.addEventListener(name, fn);
    this.enterButton = document.querySelector('#test-room-setup');
    this.downloadButton = document.querySelector('#download-boundary-report');
    this.onEnterClick = () => this.enterRoomSetup();
    this.onDownloadClick = () => this.downloadReport();
    this.enterButton.addEventListener('click', this.onEnterClick);
    this.downloadButton.addEventListener('click', this.onDownloadClick);
    this.renderStatus();
  },

  enterRoomSetup: async function () {
    if (this.el.is('vr-mode') || this.el.is('ar-mode') || this.entering) return;
    this.entering = true;
    this.enterButton.disabled = true;
    // Only this explicit passthrough test requests access to room information.
    const original = this.el.getAttribute('webxr');
    this.originalWebXR = { ...original, requiredFeatures: [...original.requiredFeatures], optionalFeatures: [...original.optionalFeatures] };
    this.el.setAttribute('webxr', { ...original, requiredFeatures: [...new Set([...original.requiredFeatures, 'plane-detection'])] });
    try {
      await this.el.enterAR();
    } catch (error) {
      this.roomStatus = `Room Setup could not start: ${error.cause?.name || error.name}. Check passthrough support and room-data permission.`;
      this.restoreWebXR();
      this.renderStatus();
    } finally {
      this.entering = false;
      this.enterButton.disabled = false;
    }
  },

  restoreWebXR: function () {
    if (this.originalWebXR) this.el.setAttribute('webxr', this.originalWebXR);
    this.originalWebXR = null;
  },

  start: function () {
    if (this.session) return;
    this.observation = new BoundaryObservation();
    this.nextBoundaryStatus = 0;
    this.roomSnapshot = [];
    this.reportedPlanes = 0;
    this.planeAPI = false;
    this.elapsed = 0;
    this.roomStatus = 'Choose Test Room Setup before entering XR';
    this.renderStatus();
    if (!this.el.is('ar-mode')) return;
    const session = this.el.renderer.xr.getSession();
    if (!session || this.session === session) return;
    this.session = session;
    this.startTime = null;
    this.elapsed = 0;
    this.captureUsed = this.capturePending = false;
    this.captureMessage = '';
    this.nextStatusTime = 0;
    this.reportedPlanes = 0;
    this.planeAPI = false;
    this.roomSnapshot = [];
    // Leave only diagnostic outlines, hands, and menus in passthrough.
    this.hiddenObjects = Array.from(this.el.querySelectorAll('[data-room-opaque]'), el => ({ el, visible: el.object3D.visible }));
    this.hiddenObjects.forEach(({el}) => { el.object3D.visible = false; });
    this.savedBackground = this.el.object3D.background;
    this.el.object3D.background = null;
    this.savedClearAlpha = this.el.renderer.getClearAlpha();
    this.el.renderer.setClearAlpha(0);
    const rig = this.el.querySelector('#boundary-rig');
    this.savedRigPosition = rig.object3D.position.clone();
    this.savedRigQuaternion = rig.object3D.quaternion.clone();
    rig.object3D.position.set(0,0,0);
    rig.object3D.quaternion.identity();
    this.locomotion = rig.components['locomotion-demo'];
    // Pausing A-Frame only stops tick; semantic input handlers remain active.
    // Remove the Lab's locomotion component for the room test, then restore it.
    this.savedLocomotion = {...this.locomotion.data};
    rig.removeAttribute('locomotion-demo');
    this.roomStatus = 'Waiting for Room Setup surfaces…';
    this.renderStatus();
    const onFrame = (time, frame) => {
      if (this.session !== session) return;
      this.updateRoomFrame(time, frame);
      session.requestAnimationFrame(onFrame);
    };
    session.requestAnimationFrame(onFrame);
  },

  sampleBoundary: function ({time, points}) {
    this.observation.sample(time, points);
    if (time >= this.nextBoundaryStatus) {
      this.nextBoundaryStatus = time + 1000;
      this.renderStatus();
    }
  },

  updateRoomFrame: function (time, frame) {
    if (this.startTime === null) this.startTime = time;
    this.elapsed = Math.max(0,(time-this.startTime)/1000);
    // Modern WebXR exposes planes on XRFrame. Some older Meta implementations
    // exposed them on XRSession. Never retain an XRFrame outside its callback.
    const detected = frame.detectedPlanes ?? this.session.detectedPlanes;
    this.planeAPI = detected != null;
    const current = new Set(detected || []);
    this.reportedPlanes = current.size;
    for (const [plane, line] of this.planes) if (!current.has(plane)) this.disposePlane(plane, line);
    const reference = this.el.renderer.xr.getReferenceSpace();
    const viewerTracked = reference && !!frame.getViewerPose(reference);
    let tracked = 0, horizontal = 0, vertical = 0;
    this.roomSnapshot = [];
    for (const plane of current) {
      let line = this.planes.get(plane);
      const points = Array.from(plane.polygon || []);
      if (points.length < 3 || points.some(p => ![p.x,p.y,p.z].every(Number.isFinite))) {
        if (line) line.visible = false;
        continue;
      }
      if (!line) {
        line = new AFRAME.THREE.LineLoop(new AFRAME.THREE.BufferGeometry(), new AFRAME.THREE.LineBasicMaterial({depthTest:false}));
        line.matrixAutoUpdate = false;
        line.renderOrder = 3;
        this.planes.set(plane,line);
        this.el.object3D.add(line);
      }
      // Pose changes do not update lastChangedTime; transform on every frame.
      const pose = viewerTracked && frame.getPose(plane.planeSpace, reference);
      line.visible = !!pose;
      if (!pose) continue;
      if (line.changedTime !== plane.lastChangedTime || !line.geometry.attributes.position) {
        line.geometry.setAttribute('position', new AFRAME.THREE.Float32BufferAttribute(points.flatMap(p => [p.x,p.y+0.008,p.z]),3));
        line.geometry.computeBoundingSphere();
        line.changedTime = plane.lastChangedTime;
      }
      const color = plane.orientation === 'horizontal' ? '#86efac' : plane.orientation === 'vertical' ? '#c084fc' : '#f9a8d4';
      line.material.color.set(color);
      line.matrix.fromArray(pose.transform.matrix);
      line.matrixWorldNeedsUpdate = true;
      tracked++;
      if (plane.orientation === 'horizontal') horizontal++;
      if (plane.orientation === 'vertical') vertical++;
      this.roomSnapshot.push({orientation:plane.orientation || 'unknown', label:plane.semanticLabel || '', points:points.map(p=>({x:p.x,y:p.y,z:p.z})), matrix:Array.from(pose.transform.matrix)});
    }
    if (time >= this.nextStatusTime) {
      this.nextStatusTime = time + 1000;
      this.roomStatus = current.size
        ? `${tracked}/${current.size} surfaces tracked · ${horizontal} horizontal · ${vertical} vertical`
        : this.elapsed < 3 ? 'Waiting for Room Setup surfaces…'
        : this.planeAPI ? 'No surfaces supplied. You can try Open Quest Room Setup.'
        : 'Plane data unavailable. Check room-data permission and browser support.';
      this.renderStatus();
    }
  },

  captureRoom: async function () {
    const session = this.session;
    if (!session) { this.roomStatus = 'Exit VR, then choose Test Room Setup on the page.'; this.renderStatus(); return; }
    if (this.elapsed < 3) { this.captureMessage = 'Wait at least 3 seconds for saved surfaces.'; this.renderStatus(); return; }
    if (this.reportedPlanes) { this.captureMessage = 'Saved surfaces are present. Edit Room Setup in Quest settings, then re-enter this test.'; this.renderStatus(); return; }
    if (this.captureUsed) { this.captureMessage = 'Room Setup was already requested. Re-enter the test to try again.'; this.renderStatus(); return; }
    if (typeof session.initiateRoomCapture !== 'function') { this.captureMessage = 'This browser has no Room Setup launcher. Use Quest settings, then re-enter.'; this.renderStatus(); return; }
    this.captureUsed = this.capturePending = true;
    this.captureMessage = 'Quest Room Setup requested…';
    this.renderStatus();
    try {
      await session.initiateRoomCapture();
      if (this.session !== session) return;
      this.captureMessage = 'Room Setup returned. Continuing to look for surfaces.';
    } catch (error) {
      if (this.session !== session) return;
      this.captureMessage = `Room Setup did not complete (${error.name}). Re-enter to retry.`;
    }
    if (this.session === session) { this.capturePending = false; this.renderStatus(); }
  },

  renderStatus: function () {
    document.querySelectorAll('.boundary-observation').forEach(el => el.setAttribute('text','value',this.observation.text()));
    document.querySelectorAll('.room-status').forEach(el => el.setAttribute('text','value',this.roomStatus));
    const detail = this.session ? `${Math.floor(this.elapsed)} s in passthrough\n${this.captureMessage || 'Green: horizontal · Purple: vertical\nPink: unclassified surfaces'}` : 'Surfaces describe the room, not Guardian.\nThey are not a safe walking footprint.';
    document.querySelectorAll('.room-detail').forEach(el => el.setAttribute('text','value',detail));
    const status = document.querySelector('#lab-diagnostics');
    status.textContent = this.observation.text().replaceAll('\n',' · ') + ' | ' + this.roomStatus;
    document.querySelectorAll('[menu-item]').forEach(el => {
      if (el.getAttribute('menu-item')?.value === 'room-capture') el.setAttribute('material','color',this.session && this.elapsed >= 3 && !this.captureUsed && !this.reportedPlanes ? '#235d48' : '#263550');
    });
  },

  downloadReport: function () {
    const report = {schema:1, userAgent:navigator.userAgent, boundary:this.observation, room:{status:this.roomStatus, seconds:this.elapsed, planeAPI:this.planeAPI, reportedPlanes:this.reportedPlanes, surfaces:this.roomSnapshot}, note:'Boundary points use bounded-floor coordinates. Plane polygons use their own plane spaces; matrices map them to the current XR reference space. Room surfaces are not Guardian boundaries.'};
    const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download='boundary-lab-report.json'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },

  disposePlane: function (plane,line) {
    this.el.object3D.remove(line); line.geometry.dispose(); line.material.dispose(); this.planes.delete(plane);
  },

  stop: function () {
    if (this.session) this.roomStatus = 'Last Room Setup: ' + this.roomStatus;
    this.session = null;
    for (const [plane,line] of this.planes) this.disposePlane(plane,line);
    if (this.hiddenObjects) {
      this.hiddenObjects.forEach(({el,visible})=>{el.object3D.visible=visible;});
      this.el.object3D.background = this.savedBackground;
      this.el.renderer.setClearAlpha(this.savedClearAlpha);
      const rig = this.el.querySelector('#boundary-rig');
      rig.object3D.position.copy(this.savedRigPosition);
      rig.object3D.quaternion.copy(this.savedRigQuaternion);
      rig.setAttribute('locomotion-demo',this.savedLocomotion);
      this.hiddenObjects = null;
    }
    this.restoreWebXR();
    this.capturePending = false;
    // Keep the last observations for download after leaving the headset.
    this.renderStatus();
  },

  remove: function () {
    this.stop();
    for (const [name,fn] of Object.entries(this.handlers)) this.el.removeEventListener(name,fn);
    this.enterButton.removeEventListener('click',this.onEnterClick);
    this.downloadButton.removeEventListener('click',this.onDownloadClick);
  }
});
