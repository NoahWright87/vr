// A game day lasts 24 real minutes: one real minute is one game hour.
var DAY_NIGHT_CYCLE_MS = 24 * 60 * 1000;
var DAY_NIGHT_ORBIT_RADIUS = 120;
var FAST_FORWARD_TIME_SCALE = 20;
var LUNAR_SYNODIC_DAYS = 29.53059;
var LUNAR_ANOMALISTIC_DAYS = 27.55455;
var LUNAR_NODAL_DAYS = 6798.383;
var MOON_ECCENTRICITY = 0.1; // Slightly exaggerated so the effect reads in-game.

AFRAME.registerShader('sunset-gradient', {
  schema: {
    opacity: { type: 'number', is: 'uniform', default: 0 },
    sunDirection: { type: 'vec3', is: 'uniform', default: { x: 1, y: 0, z: 0 } },
  },
  vertexShader: 'varying vec3 vLocal; void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float opacity; uniform vec3 sunDirection; varying vec3 vLocal; void main() { vec3 p = normalize(vLocal); vec3 h = normalize(vec3(p.x, 0.0, p.z)); vec3 s = normalize(vec3(sunDirection.x, 0.0, sunDirection.z)); float horizon = exp(-abs(p.y) * 11.0); float towardSun = pow(max(dot(h, s), 0.0), 2.0); float a = opacity * horizon * (0.28 + 0.72 * towardSun); vec3 color = mix(vec3(1.0, 0.24, 0.06), vec3(1.0, 0.74, 0.28), towardSun); gl_FragColor = vec4(color, a); }',
});

function smoothStep(edge0, edge1, value) {
  var x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

registerComponent('day-night-cycle', {
  schema: {
    // "auto" keeps the authored desktop shadows while choosing a cheaper
    // caster set and map on standalone/mobile headsets.
    shadowQuality: { type: 'string', default: 'auto' },
  },

  init: function () {
    this.elapsedGameMs = DAY_NIGHT_CYCLE_MS * 0.25;
    this.clock = this.elapsedGameMs % DAY_NIGHT_CYCLE_MS; // Begin at high noon.
    this.sunShadows = true;
    this.moonShadows = false;
    this.timeScale = 1;
    this.daySky = document.querySelector('#day-sky');
    this.nightSky = document.querySelector('#night-sky');
    this.gradient = document.querySelector('#sunset-gradient');
    this.scene = this.el.object3D;
    this.lowPowerShadows = this.data.shadowQuality === 'low' ||
      (this.data.shadowQuality === 'auto' && AFRAME.utils.device.isMobile());
    this.shadowMapEnabled = null;
    this.onAreaLoaded = this.enableAreaShadows.bind(this);
    this.onRenderStart = this.onRenderStart.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.el.addEventListener('area-loaded', this.onAreaLoaded);
    this.el.addEventListener('renderstart', this.onRenderStart);
    window.addEventListener('keydown', this.onKeyDown);

    this.sun = new THREE.DirectionalLight('#ffd1aa', 0);
    this.moon = new THREE.DirectionalLight('#9bc7ff', 0);
    this.ambient = new THREE.HemisphereLight('#d9efff', '#1c1b35', 0.2);
    this.sun.target.position.set(0, 0, 0);
    this.moon.target.position.set(0, 0, 0);
    this.configureShadowCamera(this.sun);
    this.configureShadowCamera(this.moon);

    // The hierarchy keeps the lunar orbit easy to extend: a slow nodal
    // precession and the monthly declination change the sky height, then
    // eccentric distance is applied at the anchor. Light and sprite share it.
    this.moonOrbitRoot = new THREE.Object3D();
    this.moonOrbitDeclination = new THREE.Object3D();
    this.moonOrbitPrecession = new THREE.Object3D();
    this.moonOrbitNode = new THREE.Object3D();
    this.moonOrbitInclination = new THREE.Object3D();
    this.moonAnchor = new THREE.Object3D();
    this.moonOrbitRoot.add(this.moonOrbitDeclination);
    this.moonOrbitDeclination.add(this.moonOrbitPrecession);
    this.moonOrbitPrecession.add(this.moonOrbitNode);
    this.moonOrbitNode.add(this.moonOrbitInclination);
    this.moonOrbitInclination.add(this.moonAnchor);
    this.moonAnchor.add(this.moon);
    this.scene.add(this.sun, this.sun.target, this.moonOrbitRoot, this.moon.target, this.ambient);

    this.sunOrb = this.makeCelestialPlane('assets/textures/sun-billboard-v1.png', 24, false);
    this.moonOrb = this.makeCelestialPlane('assets/textures/moon-billboard-v1.png', 13, false);
    // The Moon sits on the anchor's local +X axis, so its fixed plane faces
    // inward along -X toward the world's center. It must never face the camera.
    this.moonOrb.rotation.y = -Math.PI / 2;
    this.scene.add(this.sunOrb);
    this.moonAnchor.add(this.moonOrb);
    this.moonBaseSize = 13;
    this.applyRenderOrder();
    this.applyLighting();
    this.el.emit('day-night-shadow-change', { sun: true, moon: false });
  },

  remove: function () {
    this.el.removeEventListener('area-loaded', this.onAreaLoaded);
    this.el.removeEventListener('renderstart', this.onRenderStart);
    window.removeEventListener('keydown', this.onKeyDown);
    [this.sunOrb, this.moonOrb].forEach(function (body) {
      if (!body) return;
      if (body.parent) body.parent.remove(body);
      body.geometry.dispose();
      if (body.material.map) body.material.map.dispose();
      body.material.dispose();
    });
  },

  onKeyDown: function (evt) {
    if (evt.code !== 'Backslash' || evt.repeat) return;
    evt.preventDefault();
    this.timeScale = this.timeScale === 1 ? FAST_FORWARD_TIME_SCALE : 1;
    this.el.emit('day-night-time-scale-change', { timeScale: this.timeScale });
  },

  enableAreaShadows: function (evt) {
    var root = evt.detail && evt.detail.root;
    if (root && root.object3D) this.applyShadowState(true, root.object3D);
  },

  onRenderStart: function () {
    this.applyRenderOrder();
    if (this.lowPowerShadows && this.el.renderer && this.el.renderer.shadowMap) {
      this.el.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    this.applyShadowState(true);
  },

  applyRenderOrder: function () {
    // Transparent objects need a stable painter's order: skies, celestial
    // bodies, then weather. Depth testing remains enabled so terrain and
    // buildings still occlude the Sun and Moon correctly.
    this.setRenderOrder(this.nightSky, -40);
    this.setRenderOrder(this.daySky, -30);
    this.setRenderOrder(this.gradient, -20);
    if (this.sunOrb) this.sunOrb.renderOrder = -10;
    if (this.moonOrb) this.moonOrb.renderOrder = -10;
  },

  setRenderOrder: function (element, order) {
    if (!element || !element.object3D) return;
    element.object3D.traverse(function (object) { object.renderOrder = order; });
  },

  makeCelestialPlane: function (src, size, additive) {
    var texture = new THREE.TextureLoader().load(src);
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    plane.scale.set(size, size, 1);
    plane.userData.dayNightCelestial = true;
    return plane;
  },

  configureShadowCamera: function (light) {
    light.shadow.mapSize.set(this.lowPowerShadows ? 512 : 1024, this.lowPowerShadows ? 512 : 1024);
    light.shadow.bias = -0.00025;
    light.shadow.normalBias = 0.02;
    light.shadow.camera.left = -85;
    light.shadow.camera.right = 85;
    light.shadow.camera.top = 85;
    light.shadow.camera.bottom = -85;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 220;
    light.shadow.camera.updateProjectionMatrix();
  },

  waitOneHour: function () {
    this.elapsedGameMs += DAY_NIGHT_CYCLE_MS / 24;
    this.clock = this.elapsedGameMs % DAY_NIGHT_CYCLE_MS;
    this.applyLighting();
  },

  setShadow: function (body, enabled) {
    if (body === 'sun') this.sunShadows = enabled;
    else this.moonShadows = enabled;
    this.applyLighting();
    this.el.emit('day-night-shadow-change', { sun: this.sunShadows, moon: this.moonShadows });
  },

  applyShadowState: function (force, root) {
    var any = (this.sunShadows && this.sun.castShadow) || (this.moonShadows && this.moon.castShadow);
    var renderer = this.el.renderer;
    var shadow = this.el.systems.shadow;
    var stateChanged = this.shadowMapEnabled !== any;
    if (stateChanged || (force && !root)) {
      this.shadowMapEnabled = any;
      if (shadow && shadow.setShadowMapEnabled) shadow.setShadowMapEnabled(any);
      if (renderer && renderer.shadowMap) renderer.shadowMap.enabled = any;
    }
    // Lighting updates about five times a second, but the expensive scene walk
    // is only needed when a light crosses the horizon, a setting changes, or a
    // freshly loaded area needs its one-time caster assignment.
    if (!force && !stateChanged && !root) return;
    (root || this.scene).traverse(function (object) {
      var owner = object.el;
      var isSky = owner && (owner.id === 'night-sky' || owner.id === 'day-sky' || owner.id === 'sunset-gradient');
      if (!object.isMesh || object.userData.dayNightCelestial || object.userData.weatherCloud || object.userData.weatherCloudShadow || object.userData.lowPriorityShadow || isSky) return;
      object.castShadow = any && this.shouldCastShadow(object, owner);
      object.receiveShadow = any;
    }.bind(this));
  },

  shouldCastShadow: function (object, owner) {
    if (!this.lowPowerShadows) return true;
    if (!owner) return false;
    var tag = owner.tagName;
    if (tag === 'A-PLANE' || tag === 'A-TEXT' || tag === 'A-SKY' || tag === 'A-CIRCLE' || tag === 'A-RING') return false;
    var materials = Array.isArray(object.material) ? object.material : [object.material];
    for (var i = 0; i < materials.length; i += 1) {
      if (materials[i] && materials[i].transparent && materials[i].opacity < 0.98) return false;
    }
    if (!object.geometry) return false;
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    var radius = object.geometry.boundingSphere ? object.geometry.boundingSphere.radius : 0;
    var scale = object.scale;
    radius *= Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    return radius >= 0.55;
  },

  applyLighting: function () {
    var directions = this.getCelestialDirections();
    var sunDir = directions.sun;
    var moonDir = directions.moon;
    var daylight = smoothStep(-0.5, 0.42, sunDir.y);
    var moonlight = smoothStep(-0.5, 0.28, moonDir.y);
    var twilight = smoothStep(-0.55, 0.05, sunDir.y) * (1 - smoothStep(0.14, 0.72, sunDir.y));
    var sunAboveHorizon = sunDir.y > -0.02;
    var moonAboveHorizon = moonDir.y > -0.02;

    this.syncCelestialPositions(sunDir, directions);
    this.sun.intensity = sunAboveHorizon ? smoothStep(0, 0.2, sunDir.y) * 2.15 : 0;
    this.moon.intensity = moonAboveHorizon ? smoothStep(0, 0.2, moonDir.y) * 0.32 * directions.moonBrightness : 0;
    this.sun.castShadow = this.sunShadows && sunAboveHorizon;
    this.moon.castShadow = this.moonShadows && moonAboveHorizon;
    this.ambient.intensity = 0.07 + daylight * 0.5 + moonlight * 0.12 + twilight * 0.12;
    this.sunOrb.visible = sunDir.y > -0.14;
    this.moonOrb.visible = moonDir.y > -0.14;
    if (this.daySky) {
      this.daySky.object3D.visible = daylight > 0.003;
      this.daySky.setAttribute('material', 'opacity', daylight);
    }
    if (this.nightSky) this.nightSky.object3D.visible = daylight < 0.997;
    if (this.nightSky) this.nightSky.object3D.rotation.y = -(this.clock / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
    if (this.gradient) {
      this.gradient.object3D.visible = twilight > 0.004;
      this.gradient.setAttribute('material', { opacity: twilight * 0.76, sunDirection: sunDir });
    }
    this.applyShadowState();
    this.el.emit('day-night-change', { daylight: daylight, hour: (this.clock / DAY_NIGHT_CYCLE_MS) * 24 });
  },

  getCelestialDirections: function () {
    var solarAngle = (this.clock / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
    // Lunar state uses unbounded game time. Using the wrapped daily clock here
    // reset the orbit at midnight and visibly teleported the Moon.
    var lunarPhase = (this.elapsedGameMs / (DAY_NIGHT_CYCLE_MS * LUNAR_SYNODIC_DAYS)) * Math.PI * 2;
    var anomaly = (this.elapsedGameMs / (DAY_NIGHT_CYCLE_MS * LUNAR_ANOMALISTIC_DAYS)) * Math.PI * 2;
    var node = (this.elapsedGameMs / (DAY_NIGHT_CYCLE_MS * LUNAR_NODAL_DAYS)) * Math.PI * 2;
    var moonAngle = solarAngle + Math.PI - lunarPhase;
    var moonDistance = DAY_NIGHT_ORBIT_RADIUS * (1 - MOON_ECCENTRICITY * MOON_ECCENTRICITY) /
      (1 + MOON_ECCENTRICITY * Math.cos(anomaly));
    // The 23.44° ecliptic tilt is what makes real moon paths noticeably
    // higher or lower throughout a lunar month; the 5.145° orbit inclination
    // and 18.6-year nodal precession add the smaller real-world variation.
    var moonDeclination = 23.44 * Math.sin(lunarPhase + Math.PI * 0.25) * Math.PI / 180;
    var moon = new THREE.Vector3(1, 0, 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), 5.145 * Math.PI / 180)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), node)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), node)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), moonDeclination)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), moonAngle)
      .normalize();
    return {
      sun: new THREE.Vector3(Math.cos(solarAngle), Math.sin(solarAngle), Math.sin(solarAngle * 0.37) * 0.35).normalize(),
      moon: moon,
      moonDistance: moonDistance,
      moonBrightness: Math.max(0.78, Math.min(1.3, Math.pow(DAY_NIGHT_ORBIT_RADIUS / moonDistance, 1.4))),
      moonAngle: moonAngle,
      moonNode: node,
      moonDeclination: moonDeclination,
    };
  },

  syncCelestialPositions: function (sunDir, directions) {
    this.sun.position.copy(sunDir).multiplyScalar(DAY_NIGHT_ORBIT_RADIUS);
    this.sunOrb.position.copy(this.sun.position);
    // Mesh planes keep an authored world orientation. Unlike THREE.Sprite,
    // this turns only as the Sun travels, never when the player's head turns.
    this.sunOrb.lookAt(0, 0, 0);
    this.moonOrbitRoot.rotation.z = directions.moonAngle;
    this.moonOrbitDeclination.rotation.x = directions.moonDeclination;
    this.moonOrbitPrecession.rotation.z = directions.moonNode;
    this.moonOrbitNode.rotation.x = directions.moonNode;
    this.moonOrbitInclination.rotation.y = 5.145 * Math.PI / 180;
    this.moonAnchor.position.set(directions.moonDistance, 0, 0);
    var moonScale = this.moonBaseSize * DAY_NIGHT_ORBIT_RADIUS / directions.moonDistance;
    this.moonOrb.scale.set(moonScale, moonScale, 1);
  },

  tick: function (time, delta) {
    this.elapsedGameMs += Math.min(delta || 16, 100) * this.timeScale;
    this.clock = this.elapsedGameMs % DAY_NIGHT_CYCLE_MS;
    if (!this.lastUpdate || time - this.lastUpdate > 180) {
      this.lastUpdate = time;
      this.applyLighting();
      return;
    }
    var directions = this.getCelestialDirections();
    this.syncCelestialPositions(directions.sun, directions);
    if (this.nightSky) this.nightSky.object3D.rotation.y = -(this.clock / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
  },
});

// PS1-style weather. Twenty independently simulated cloud systems still cross
// the world-space field, but their cards are sent to the GPU in eight instanced
// atlas buckets. A ninth batch contains only the largest few shadow decals.
// The old one-mesh-per-system version cost more than fifty draw calls on its own.
registerComponent('weather-clouds', {
  schema: {
    groupCount: { type: 'int', default: 20 },
    minCloudsPerGroup: { type: 'int', default: 4 },
    maxCloudsPerGroup: { type: 'int', default: 8 },
    minSize: { type: 'number', default: 11 },
    maxSize: { type: 'number', default: 28 },
    sizeChangeRate: { type: 'number', default: 0.032 },
    density: { type: 'number', default: 0.58 },
    minSpeed: { type: 'number', default: 0.62 },
    maxSpeed: { type: 'number', default: 1.2 },
    windDirection: { type: 'number', default: 0 },
    wobbleFrequencyMs: { type: 'number', default: 22000 },
    wobbleAmount: { type: 'number', default: 4 },
    minHeight: { type: 'number', default: 48 },
    maxHeight: { type: 'number', default: 82 },
    minShade: { type: 'number', default: 0.86 },
    maxShade: { type: 'number', default: 1 },
    fieldRadius: { type: 'number', default: 240 },
    formationDistance: { type: 'number', default: 80 },
    shadowOpacity: { type: 'number', default: 0.16 },
    maxShadowGroups: { type: 'int', default: 6 },
    shapeUpdateMs: { type: 'number', default: 125 },
    spriteFamily: { type: 'string', default: 'desert-underside' },
  },

  init: function () {
    this.scene = this.el.object3D;
    this.daylight = 1;
    this.windAngle = this.data.windDirection * Math.PI / 180;
    this.windX = Math.cos(this.windAngle);
    this.windZ = Math.sin(this.windAngle);
    this.perpendicularX = -this.windZ;
    this.perpendicularZ = this.windX;
    this.sunDirection = new THREE.Vector3();
    this.atlasTexture = new THREE.TextureLoader().load(
      'assets/textures/weather-cloud-underside-atlas-v1.png'
    );
    this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.shadowTexture = this.makeShadowTexture();
    this.cloudGroups = [];
    this.shapeElapsedMs = 0;
    this.maxCloudSlots = this.data.groupCount * this.data.maxCloudsPerGroup;
    this.makeCloudBatches();
    this.makeShadowBatch();
    this.onDayNightChange = this.updateAppearance.bind(this);
    this.el.addEventListener('day-night-change', this.onDayNightChange);

    for (var i = 0; i < this.data.groupCount; i += 1) {
      this.cloudGroups.push(this.makeCloudGroup(i));
    }
    this.updateAppearance();
  },

  remove: function () {
    this.el.removeEventListener('day-night-change', this.onDayNightChange);
    this.cloudMeshes.forEach(function (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }, this);
    this.scene.remove(this.shadowMesh);
    this.cloudMaterial.dispose();
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.shadowTexture.dispose();
    this.atlasTexture.dispose();
  },

  makeCloudBatches: function () {
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      alphaTest: 0.025,
      opacity: 0.86,
    });
    this.cloudMeshes = [];
    this.cloudDummy = new THREE.Object3D();
    this.cloudTint = new THREE.Color();
    for (var tile = 0; tile < 8; tile += 1) {
      var geometry = new THREE.PlaneGeometry(1, 1);
      geometry.rotateX(-Math.PI / 2);
      var uv = geometry.attributes.uv.array;
      var paddingU = 0.006;
      var paddingV = 0.012;
      var column = tile % 4;
      var row = Math.floor(tile / 4);
      var u0 = column * 0.25 + paddingU;
      var u1 = (column + 1) * 0.25 - paddingU;
      var v0 = row * 0.5 + paddingV;
      var v1 = (row + 1) * 0.5 - paddingV;
      uv[0] = u0; uv[1] = v1;
      uv[2] = u1; uv[3] = v1;
      uv[4] = u0; uv[5] = v0;
      uv[6] = u1; uv[7] = v0;
      geometry.attributes.uv.needsUpdate = true;
      var mesh = new THREE.InstancedMesh(geometry, this.cloudMaterial, this.maxCloudSlots);
      mesh.name = 'cloud-atlas-tile-' + tile;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.weatherCloud = true;
      mesh.renderOrder = 0;
      mesh.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, (this.data.minHeight + this.data.maxHeight) * 0.5, 0),
        this.data.fieldRadius * 1.55
      );
      this.cloudMeshes.push(mesh);
      this.scene.add(mesh);
    }
  },

  makeShadowBatch: function () {
    var count = Math.max(0, Math.min(this.data.groupCount, this.data.maxShadowGroups));
    this.shadowGeometry = new THREE.PlaneGeometry(1, 1);
    this.shadowGeometry.rotateX(-Math.PI / 2);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      color: '#141820',
      transparent: true,
      depthWrite: false,
      depthTest: true,
      opacity: this.data.shadowOpacity,
      side: THREE.DoubleSide,
    });
    this.shadowMesh = new THREE.InstancedMesh(this.shadowGeometry, this.shadowMaterial, count);
    this.shadowMesh.count = 0;
    this.shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadowMesh.userData.weatherCloudShadow = true;
    this.shadowMesh.renderOrder = 1;
    this.shadowMesh.visible = false;
    this.shadowMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), this.data.fieldRadius * 1.8);
    this.shadowDummy = new THREE.Object3D();
    this.shadowSelection = new Array(count);
    this.shadowScores = new Float32Array(count);
    this.scene.add(this.shadowMesh);
  },

  makeShadowTexture: function () {
    var canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    var context = canvas.getContext('2d');
    var gradient = context.createRadialGradient(32, 32, 3, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(20, 24, 32, 0.72)');
    gradient.addColorStop(0.58, 'rgba(20, 24, 32, 0.38)');
    gradient.addColorStop(1, 'rgba(20, 24, 32, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    var texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  },

  makeCloudGroup: function (index) {
    var group = {
      index: index,
      clouds: [],
      x: 0,
      z: 0,
      age: 0,
      travelDistance: 0,
      speed: 1,
      density: this.data.density,
      shade: 1,
      wobblePhase: 0,
      wobblePeriodMs: this.data.wobbleFrequencyMs,
      wobbleRadians: this.data.wobbleAmount * Math.PI / 180,
      boundsX: 1,
      boundsZ: 1,
      radius: 1,
    };
    this.resetGroup(group, true, index);
    return group;
  },

  resetGroup: function (group, initial, index) {
    group.age = Math.random() * this.data.wobbleFrequencyMs;
    group.speed = this.randomBetween(this.data.minSpeed, this.data.maxSpeed);
    group.density = this.clamp(this.data.density + (Math.random() - 0.5) * 0.2, 0.05, 0.98);
    group.shade = this.randomBetween(this.data.minShade, this.data.maxShade);
    group.wobblePhase = Math.random() * Math.PI * 2;
    group.wobblePeriodMs = this.data.wobbleFrequencyMs * this.randomBetween(0.72, 1.35);
    group.wobbleRadians = this.data.wobbleAmount * Math.PI / 180 * this.randomBetween(0.55, 1.15);
    group.height = this.randomBetween(this.data.minHeight, this.data.maxHeight);
    this.configureGroupClouds(group);

    var lateralLimit = this.data.fieldRadius * 0.84;
    var lateral = this.randomBetween(-lateralLimit, lateralLimit);
    var boundary = Math.sqrt(Math.max(1,
      this.data.fieldRadius * this.data.fieldRadius - lateral * lateral));
    var startForward = -boundary - group.radius;
    var endForward = boundary + group.radius;
    var progress = initial ?
      this.clamp(((index || 0) + Math.random() * 0.72) / Math.max(1, this.data.groupCount), 0, 0.98) :
      0;
    var forward = startForward + (endForward - startForward) * progress;
    group.x = this.windX * forward + this.perpendicularX * lateral;
    group.z = this.windZ * forward + this.perpendicularZ * lateral;
    group.travelDistance = initial ? (endForward - startForward) * progress : 0;
    this.updateGroupShapes(group, 0, true);
  },

  configureGroupClouds: function (group) {
    var count = this.data.minCloudsPerGroup + Math.floor(Math.random() *
      (this.data.maxCloudsPerGroup - this.data.minCloudsPerGroup + 1));
    var spread = 18 + (1 - group.density) * 48;
    group.clouds.length = 0;
    var minX = Infinity;
    var maxX = -Infinity;
    var minZ = Infinity;
    var maxZ = -Infinity;

    for (var i = 0; i < count; i += 1) {
      var angle = Math.random() * Math.PI * 2;
      var distance = spread * Math.pow(Math.random(), 0.78);
      var size = this.randomBetween(this.data.minSize, this.data.maxSize);
      var width = size * this.randomBetween(1.15, 1.85);
      var depth = size * this.randomBetween(0.72, 1.18);
      var cloud = {
        offsetX: Math.cos(angle) * distance,
        offsetZ: Math.sin(angle) * distance,
        height: group.height + this.randomBetween(-4, 4),
        width: width,
        depth: depth,
        rotation: Math.random() * Math.PI * 2,
        tile: Math.floor(Math.random() * 8),
        sizeScale: this.randomBetween(0.88, 1.12),
        sizeVelocity: this.data.sizeChangeRate * this.randomBetween(0.55, 1.25) *
          (Math.random() < 0.5 ? -1 : 1),
      };
      group.clouds.push(cloud);
      minX = Math.min(minX, cloud.offsetX - width * 0.5);
      maxX = Math.max(maxX, cloud.offsetX + width * 0.5);
      minZ = Math.min(minZ, cloud.offsetZ - depth * 0.5);
      maxZ = Math.max(maxZ, cloud.offsetZ + depth * 0.5);
    }
    group.boundsX = Math.max(8, maxX - minX);
    group.boundsZ = Math.max(8, maxZ - minZ);
    group.radius = Math.max(group.boundsX, group.boundsZ) * 0.55;
  },

  updateGroupShapes: function (group, shapeSeconds, forceShape) {
    for (var i = 0; i < group.clouds.length; i += 1) {
      var cloud = group.clouds[i];
      if (forceShape || shapeSeconds > 0) {
        cloud.sizeScale += cloud.sizeVelocity * shapeSeconds;
        if (cloud.sizeScale > 1.18) {
          cloud.sizeScale = 1.18;
          cloud.sizeVelocity = -Math.abs(cloud.sizeVelocity);
        } else if (cloud.sizeScale < 0.82) {
          cloud.sizeScale = 0.82;
          cloud.sizeVelocity = Math.abs(cloud.sizeVelocity);
        }
      }
    }
  },

  updateCloudBatches: function () {
    var i;
    for (i = 0; i < this.cloudMeshes.length; i += 1) this.cloudMeshes[i].count = 0;
    var nightFactor = 0.38 + this.daylight * 0.62;
    var dummy = this.cloudDummy;
    for (i = 0; i < this.cloudGroups.length; i += 1) {
      var group = this.cloudGroups[i];
      var presence = this.getGroupPresence(group);
      if (presence <= 0.01) continue;
      var formationScale = 0.12 + presence * 0.88;
      var shade = group.shade * nightFactor;
      this.cloudTint.setRGB(shade * 0.96, shade * 0.98, Math.min(1, shade + 0.045));
      for (var cloudIndex = 0; cloudIndex < group.clouds.length; cloudIndex += 1) {
        var cloud = group.clouds[cloudIndex];
        var mesh = this.cloudMeshes[cloud.tile];
        var instance = mesh.count;
        dummy.position.set(group.x + cloud.offsetX, cloud.height, group.z + cloud.offsetZ);
        dummy.rotation.set(0, -cloud.rotation, 0);
        dummy.scale.set(
          cloud.width * cloud.sizeScale * formationScale,
          1,
          cloud.depth * cloud.sizeScale * formationScale
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(instance, dummy.matrix);
        mesh.setColorAt(instance, this.cloudTint);
        mesh.count = instance + 1;
      }
    }
    for (i = 0; i < this.cloudMeshes.length; i += 1) {
      var cloudMesh = this.cloudMeshes[i];
      cloudMesh.visible = cloudMesh.count > 0;
      cloudMesh.instanceMatrix.needsUpdate = true;
      if (cloudMesh.instanceColor) cloudMesh.instanceColor.needsUpdate = true;
    }
  },

  getGroupPresence: function (group) {
    return smoothStep(0, this.data.formationDistance, group.travelDistance);
  },

  updateGroup: function (group, elapsed, shapeSeconds) {
    var seconds = elapsed / 1000;
    group.age += elapsed;
    var wobble = Math.sin(group.age / group.wobblePeriodMs * Math.PI * 2 + group.wobblePhase) *
      group.wobbleRadians;
    var heading = this.windAngle + wobble;
    group.x += Math.cos(heading) * group.speed * seconds;
    group.z += Math.sin(heading) * group.speed * seconds;
    group.travelDistance += group.speed * seconds;

    var forward = group.x * this.windX + group.z * this.windZ;
    var lateral = group.x * this.perpendicularX + group.z * this.perpendicularZ;
    var lateralInside = Math.min(Math.abs(lateral), this.data.fieldRadius);
    var boundary = Math.sqrt(Math.max(0,
      this.data.fieldRadius * this.data.fieldRadius - lateralInside * lateralInside));
    if (forward > boundary + group.radius) {
      this.resetGroup(group, false, 0);
      return;
    }
    this.updateGroupShapes(group, shapeSeconds, false);
  },

  updateShadowBatch: function (cycle) {
    var count = this.shadowSelection.length;
    var i;
    for (i = 0; i < count; i += 1) {
      this.shadowSelection[i] = null;
      this.shadowScores[i] = -1;
    }
    // Default/low graphics uses one soft decal for only the most visually
    // important groups. TODO(high-graphics): allow per-cloud or real
    // alpha-tested shadows on roofs and walls.
    if (!count || !cycle || !cycle.sun.castShadow || this.daylight < 0.08) {
      this.shadowMesh.count = 0;
      this.shadowMesh.visible = false;
      return;
    }
    this.sunDirection.copy(cycle.sun.position).normalize();
    if (this.sunDirection.y < 0.12) {
      this.shadowMesh.count = 0;
      this.shadowMesh.visible = false;
      return;
    }

    for (i = 0; i < this.cloudGroups.length; i += 1) {
      var group = this.cloudGroups[i];
      var presence = this.getGroupPresence(group);
      if (presence < 0.08) continue;
      var score = group.boundsX * group.boundsZ * presence * (0.45 + group.density);
      var insertAt = -1;
      for (var candidate = 0; candidate < count; candidate += 1) {
        if (score > this.shadowScores[candidate]) { insertAt = candidate; break; }
      }
      if (insertAt < 0) continue;
      for (var shift = count - 1; shift > insertAt; shift -= 1) {
        this.shadowSelection[shift] = this.shadowSelection[shift - 1];
        this.shadowScores[shift] = this.shadowScores[shift - 1];
      }
      this.shadowSelection[insertAt] = group;
      this.shadowScores[insertAt] = score;
    }

    var visibleCount = 0;
    for (i = 0; i < count; i += 1) {
      group = this.shadowSelection[i];
      if (!group) continue;
      presence = this.getGroupPresence(group);
      var projection = Math.min(130, group.height / Math.max(0.2, this.sunDirection.y));
      var scale = (0.18 + presence * 0.82) * (0.5 + (1 - group.density) * 0.22);
      this.shadowDummy.position.set(
        group.x - this.sunDirection.x * projection,
        0.07,
        group.z - this.sunDirection.z * projection
      );
      this.shadowDummy.rotation.set(0, 0, 0);
      this.shadowDummy.scale.set(group.boundsX * scale, 1, group.boundsZ * scale);
      this.shadowDummy.updateMatrix();
      this.shadowMesh.setMatrixAt(visibleCount, this.shadowDummy.matrix);
      visibleCount += 1;
    }
    this.shadowMaterial.opacity = this.data.shadowOpacity * this.daylight;
    this.shadowMesh.count = visibleCount;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.visible = visibleCount > 0;
  },

  updateAppearance: function (event) {
    if (event && event.detail) this.daylight = event.detail.daylight;
  },

  tick: function (time, delta) {
    var cycle = this.el.components['day-night-cycle'];
    var weatherTimeScale = cycle ? cycle.timeScale : 1;
    var elapsed = Math.min(delta || 16, 100) * weatherTimeScale;
    this.shapeElapsedMs += elapsed;
    var shapeSeconds = 0;
    if (this.shapeElapsedMs >= this.data.shapeUpdateMs) {
      shapeSeconds = this.shapeElapsedMs / 1000;
      this.shapeElapsedMs = 0;
    }
    for (var i = 0; i < this.cloudGroups.length; i += 1) {
      this.updateGroup(this.cloudGroups[i], elapsed, shapeSeconds);
    }
    this.updateCloudBatches();
    this.updateShadowBatch(cycle);
  },

  randomBetween: function (minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  },

  clamp: function (value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  },
});
