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

    this.sunOrb = this.makeSprite('assets/textures/sun-billboard-v1.png', 24, false);
    this.moonOrb = this.makeSprite('assets/textures/moon-billboard-v1.png', 13, false);
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
  },

  onKeyDown: function (evt) {
    if (evt.code !== 'Backslash' || evt.repeat) return;
    evt.preventDefault();
    this.timeScale = this.timeScale === 1 ? FAST_FORWARD_TIME_SCALE : 1;
    this.el.emit('day-night-time-scale-change', { timeScale: this.timeScale });
  },

  enableAreaShadows: function (evt) {
    var root = evt.detail && evt.detail.root;
    if (root) root.setAttribute('shadow', 'cast: true; receive: true');
    this.applyShadowState();
  },

  onRenderStart: function () {
    this.applyRenderOrder();
    this.applyShadowState();
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

  makeSprite: function (src, size, additive) {
    var texture = new THREE.TextureLoader().load(src);
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    sprite.scale.set(size, size, 1);
    sprite.userData.dayNightCelestial = true;
    return sprite;
  },

  configureShadowCamera: function (light) {
    light.shadow.mapSize.set(1024, 1024);
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

  applyShadowState: function () {
    var any = (this.sunShadows && this.sun.castShadow) || (this.moonShadows && this.moon.castShadow);
    var renderer = this.el.renderer;
    var shadow = this.el.systems.shadow;
    if (shadow && shadow.setShadowMapEnabled) shadow.setShadowMapEnabled(any);
    if (renderer && renderer.shadowMap) renderer.shadowMap.enabled = any;
    this.scene.traverse(function (object) {
      var owner = object.el;
      var isSky = owner && (owner.id === 'night-sky' || owner.id === 'day-sky' || owner.id === 'sunset-gradient');
      if (!object.isMesh || object.userData.dayNightCelestial || object.userData.weatherCloud || object.userData.weatherCloudShadow || isSky) return;
      object.castShadow = any;
      object.receiveShadow = any;
    });
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
    if (this.daySky) this.daySky.setAttribute('material', 'opacity', daylight);
    if (this.nightSky) this.nightSky.object3D.rotation.y = -(this.clock / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
    if (this.gradient) this.gradient.setAttribute('material', { opacity: twilight * 0.76, sunDirection: sunDir });
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

// Cheap, PS1-style weather: single cloud cards live on a player-centered
// hemisphere. Cards face the hemisphere center, never the headset, so their
// orientation is stable in VR. Invisible data-only weather cells make clouds
// form, drift, and dissipate in related families instead of independently.
registerComponent('weather-clouds', {
  schema: {
    count: { type: 'int', default: 36 },
    cellCount: { type: 'int', default: 5 },
    minCloudsPerCell: { type: 'int', default: 4 },
    maxCloudsPerCell: { type: 'int', default: 8 },
    spawnIntervalMs: { type: 'number', default: 30000 },
    minSize: { type: 'number', default: 4 },
    maxSize: { type: 'number', default: 24 },
    driftSpeed: { type: 'number', default: 0.65 },
    darkness: { type: 'number', default: 0.18 },
    lifetimeMs: { type: 'number', default: 240000 },
    maxLifetimeMs: { type: 'number', default: 720000 },
    formationMs: { type: 'number', default: 50000 },
    dissipationMs: { type: 'number', default: 70000 },
    hemisphereRadius: { type: 'number', default: 155 },
    minElevation: { type: 'number', default: 12 },
    maxElevation: { type: 'number', default: 72 },
    shadowCasters: { type: 'int', default: 6 },
  },

  init: function () {
    this.scene = this.el.object3D;
    this.playerRig = document.querySelector('#player-rig');
    this.cloudRoot = new THREE.Group();
    this.cloudRoot.name = 'weather-cloud-hemisphere';
    this.scene.add(this.cloudRoot);
    this.cloudGeometry = new THREE.PlaneGeometry(1, 1);
    this.textures = [
      new THREE.TextureLoader().load('assets/textures/weather-cloud-cumulus-v1.png'),
      new THREE.TextureLoader().load('assets/textures/weather-cloud-wispy-v1.png'),
      new THREE.TextureLoader().load('assets/textures/weather-cloud-puff-v1.png'),
    ];
    this.profiles = [
      { texture: 0, opacity: 0.88, sizeScale: 1, shade: 1, shadows: true },
      { texture: 1, opacity: 0.64, sizeScale: 1.15, shade: 0.98, shadows: false },
      { texture: 2, opacity: 0.82, sizeScale: 0.86, shade: 0.96, shadows: true },
    ];
    this.clouds = [];
    this.cells = [];
    this.nextCellId = 1;
    this.nextSpawn = 0;
    this.nextShadowUpdate = 0;
    this.daylight = 1;
    this.rootWorldPosition = new THREE.Vector3();
    this.inwardNormal = new THREE.Vector3();
    this.planeNormal = new THREE.Vector3(0, 0, 1);
    this.shadowDirection = new THREE.Vector3();
    this.onDayNightChange = this.updateAppearance.bind(this);
    this.el.addEventListener('day-night-change', this.onDayNightChange);
    for (var i = 0; i < this.data.count; i += 1) {
      this.clouds.push(this.makeCloud());
    }
    for (var cellIndex = 0; cellIndex < this.data.cellCount; cellIndex += 1) {
      this.spawnCell(true, cellIndex);
    }
    this.syncRootToPlayer();
    this.updateCells(0);
    this.updateAppearance();
  },

  remove: function () {
    this.el.removeEventListener('day-night-change', this.onDayNightChange);
    this.clouds.forEach(function (cloud) {
      cloud.mesh.material.dispose();
      cloud.shadowProxy.material.dispose();
      cloud.shadowProxy.customDepthMaterial.dispose();
    });
    this.scene.remove(this.cloudRoot);
    this.cloudGeometry.dispose();
  },

  makeCloud: function () {
    var group = new THREE.Group();
    var material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      alphaTest: 0.035,
      opacity: 0,
    });
    var mesh = new THREE.Mesh(this.cloudGeometry, material);
    mesh.userData.weatherCloud = true;
    mesh.renderOrder = 0;
    var shadowProxy = new THREE.Mesh(this.cloudGeometry, new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    }));
    shadowProxy.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      alphaTest: 0.055,
      side: THREE.DoubleSide,
    });
    shadowProxy.userData.weatherCloudShadow = true;
    shadowProxy.visible = false;
    shadowProxy.castShadow = false;
    group.add(mesh);
    group.visible = false;
    this.cloudRoot.add(group);
    this.cloudRoot.add(shadowProxy);
    return {
      group: group,
      mesh: mesh,
      shadowProxy: shadowProxy,
      active: false,
      cell: null,
      presence: 0,
      baseSize: 1,
    };
  },

  availableClouds: function () {
    return this.clouds.filter(function (cloud) { return !cloud.active; });
  },

  spawnCell: function (initial, initialIndex) {
    var available = this.availableClouds();
    if (available.length < this.data.minCloudsPerCell) return null;
    var desired = this.data.minCloudsPerCell + Math.floor(Math.random() *
      (this.data.maxCloudsPerCell - this.data.minCloudsPerCell + 1));
    var memberCount = Math.min(desired, available.length);
    var minElevation = this.data.minElevation * Math.PI / 180;
    var maxElevation = this.data.maxElevation * Math.PI / 180;
    var cell = {
      id: this.nextCellId,
      active: true,
      age: 0,
      lifetimeMs: this.data.lifetimeMs + Math.random() * (this.data.maxLifetimeMs - this.data.lifetimeMs),
      formationMs: this.data.formationMs * (0.72 + Math.random() * 0.65),
      dissipationMs: this.data.dissipationMs * (0.72 + Math.random() * 0.65),
      azimuth: Math.random() * Math.PI * 2,
      elevation: minElevation + Math.random() * (maxElevation - minElevation),
      spread: (5 + Math.random() * 13) * Math.PI / 180,
      angularSpeed: (this.data.driftSpeed / this.data.hemisphereRadius) * (0.7 + Math.random() * 0.75),
      profile: Math.floor(Math.random() * this.profiles.length),
      phase: Math.random() * Math.PI * 2,
      replacementStarted: false,
      members: [],
    };
    this.nextCellId += 1;
    if (initial) {
      var matureStart = cell.formationMs * 1.15;
      var matureEnd = Math.max(matureStart, cell.lifetimeMs - cell.dissipationMs * 1.2);
      var fraction = ((initialIndex || 0) + 0.35) / Math.max(1, this.data.cellCount);
      cell.age = matureStart + (matureEnd - matureStart) * Math.min(0.78, fraction);
    }
    for (var i = 0; i < memberCount; i += 1) {
      this.attachCloudToCell(available[i], cell);
    }
    this.cells.push(cell);
    return cell;
  },

  attachCloudToCell: function (cloud, cell) {
    var profile = this.profiles[cell.profile];
    var angle = Math.random() * Math.PI * 2;
    // Bias members toward the center while retaining a few ragged outliers.
    var distance = cell.spread * Math.pow(Math.random(), 1.65);
    var size = (this.data.minSize + Math.random() * (this.data.maxSize - this.data.minSize)) * profile.sizeScale;
    var centerBias = 1 - Math.min(0.38, distance / Math.max(cell.spread, 0.001) * 0.38);
    cloud.cell = cell;
    cloud.active = true;
    cloud.profile = profile;
    cloud.azimuthOffset = Math.cos(angle) * distance / Math.max(0.32, Math.cos(cell.elevation));
    cloud.elevationOffset = Math.sin(angle) * distance;
    cloud.baseSize = size * centerBias;
    cloud.roll = (Math.random() - 0.5) * 0.18;
    cloud.birthDelay = Math.random() * cell.formationMs * 0.62;
    cloud.growMs = 22000 + Math.random() * 36000;
    cloud.deathAdvance = Math.random() * cell.dissipationMs * 0.62;
    cloud.shrinkMs = 26000 + Math.random() * 42000;
    cloud.pulsePhase = Math.random() * Math.PI * 2;
    cloud.pulseMs = 50000 + Math.random() * 90000;
    cloud.mesh.material.map = this.textures[profile.texture];
    cloud.mesh.material.needsUpdate = true;
    cloud.shadowProxy.customDepthMaterial.map = this.textures[profile.texture];
    cloud.shadowProxy.customDepthMaterial.needsUpdate = true;
    cloud.mesh.scale.set(cloud.baseSize * 1.9, cloud.baseSize, 1);
    cloud.mesh.castShadow = false;
    cloud.shadowProxy.scale.set(cloud.baseSize * 1.9, cloud.baseSize, 1);
    cloud.shadowProxy.visible = false;
    cloud.shadowProxy.castShadow = false;
    cloud.group.visible = true;
    cell.members.push(cloud);
    this.updateCloud(cloud);
  },

  releaseCell: function (cell) {
    cell.members.forEach(function (cloud) {
      cloud.active = false;
      cloud.cell = null;
      cloud.presence = 0;
      cloud.mesh.castShadow = false;
      cloud.shadowProxy.castShadow = false;
      cloud.shadowProxy.visible = false;
      cloud.group.visible = false;
    });
    cell.members.length = 0;
    cell.active = false;
  },

  updateCloud: function (cloud) {
    var cell = cloud.cell;
    if (!cell || !cell.active) return;
    var grow = smoothStep(cloud.birthDelay, cloud.birthDelay + cloud.growMs, cell.age);
    var deathEnd = cell.lifetimeMs - cloud.deathAdvance;
    var shrink = 1 - smoothStep(deathEnd - cloud.shrinkMs, deathEnd, cell.age);
    var presence = Math.min(grow, shrink);
    var pulse = 1 + Math.sin(cell.age / cloud.pulseMs * Math.PI * 2 + cloud.pulsePhase) * 0.025;
    var scale = (0.42 + presence * 0.58) * pulse;
    cloud.presence = presence;
    cloud.group.scale.set(scale, scale, scale);
    cloud.mesh.material.opacity = cloud.profile.opacity * presence;
    cloud.group.visible = presence > 0.012;

    var elevationWobble = Math.sin(cell.age / 110000 + cell.phase) * 0.012;
    var elevation = Math.max(0.08, Math.min(Math.PI * 0.46,
      cell.elevation + cloud.elevationOffset + elevationWobble));
    var azimuth = cell.azimuth + cloud.azimuthOffset;
    var horizontal = this.data.hemisphereRadius * Math.cos(elevation);
    cloud.group.position.set(
      Math.cos(azimuth) * horizontal,
      Math.sin(elevation) * this.data.hemisphereRadius,
      Math.sin(azimuth) * horizontal
    );
    // Orient to the hemisphere center. This depends only on the cloud's sky
    // position; headset yaw and pitch never enter the calculation.
    this.inwardNormal.copy(cloud.group.position).normalize().multiplyScalar(-1);
    cloud.group.quaternion.setFromUnitVectors(this.planeNormal, this.inwardNormal);
    cloud.group.rotateZ(cloud.roll);
    // Keep the shadow caster near town and inside the Sun's compact shadow
    // camera. It represents the distant card without expanding that camera.
    cloud.shadowProxy.position.set(
      cloud.group.position.x * 0.38,
      42,
      cloud.group.position.z * 0.38
    );
    cloud.shadowProxy.scale.set(
      cloud.baseSize * 1.9 * scale,
      cloud.baseSize * scale,
      1
    );
  },

  updateCells: function (elapsed) {
    this.cells.forEach(function (cell) {
      if (!cell.active) return;
      cell.age += elapsed;
      cell.azimuth = (cell.azimuth + cell.angularSpeed * elapsed / 1000) % (Math.PI * 2);
      if (!cell.replacementStarted && cell.age >= cell.lifetimeMs - cell.dissipationMs) {
        cell.replacementStarted = true;
        this.spawnCell(false);
      }
      cell.members.forEach(this.updateCloud, this);
      if (cell.age >= cell.lifetimeMs) this.releaseCell(cell);
    }, this);
    this.cells = this.cells.filter(function (cell) { return cell.active; });
  },

  updateAppearance: function (event) {
    if (event && event.detail) this.daylight = event.detail.daylight;
    var shade = 1 - this.data.darkness * (0.55 + this.daylight * 0.45);
    this.clouds.forEach(function (cloud) {
      var profileShade = cloud.profile ? cloud.profile.shade : 1;
      cloud.mesh.material.color.setRGB(
        shade * profileShade,
        shade * profileShade,
        Math.min(1, shade * profileShade + 0.025)
      );
    });
  },

  syncRootToPlayer: function () {
    if (!this.playerRig || !this.playerRig.object3D) return;
    this.playerRig.object3D.getWorldPosition(this.rootWorldPosition);
    this.cloudRoot.position.set(this.rootWorldPosition.x, 0, this.rootWorldPosition.z);
  },

  updateShadows: function (cycle) {
    this.clouds.forEach(function (cloud) {
      cloud.mesh.castShadow = false;
      cloud.shadowProxy.castShadow = false;
      cloud.shadowProxy.visible = false;
    });
    if (!cycle || !cycle.sun.castShadow || this.data.shadowCasters <= 0) return;
    var candidates = this.clouds.filter(function (cloud) {
      return cloud.active && cloud.group.visible && cloud.profile.shadows && cloud.presence > 0.45;
    });
    candidates.sort(function (a, b) {
      return b.baseSize * b.presence - a.baseSize * a.presence;
    });
    candidates.slice(0, this.data.shadowCasters).forEach(function (cloud) {
      cloud.shadowProxy.visible = true;
      cloud.shadowProxy.castShadow = true;
      this.shadowDirection.copy(cycle.sun.position).normalize();
      cloud.shadowProxy.quaternion.setFromUnitVectors(this.planeNormal, this.shadowDirection);
      cloud.shadowProxy.rotateZ(cloud.roll);
    }, this);
  },

  tick: function (time, delta) {
    var cycle = this.el.components['day-night-cycle'];
    var weatherTimeScale = cycle ? cycle.timeScale : 1;
    var elapsed = Math.min(delta || 16, 100) * weatherTimeScale;
    this.syncRootToPlayer();
    this.updateCells(elapsed);
    this.nextSpawn += elapsed;
    if (this.nextSpawn >= this.data.spawnIntervalMs) {
      var activeCells = this.cells.filter(function (cell) { return cell.active; }).length;
      if (activeCells < this.data.cellCount) this.spawnCell(false);
      this.nextSpawn = 0;
    }
    this.nextShadowUpdate += elapsed;
    if (this.nextShadowUpdate >= 500) {
      this.updateShadows(cycle);
      this.nextShadowUpdate = 0;
    }
  },
});
