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

// PS1-style weather. Stars rotate with the celestial sphere; clouds do not.
// Cloud systems cross a persistent world-space field along a shared wind
// vector, with a small smooth heading wobble. Each system is one batched mesh
// plus one inexpensive ground-shadow decal.
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
    spriteFamily: { type: 'string', default: 'desert-underside' },
  },

  init: function () {
    this.scene = this.el.object3D;
    this.daylight = 1;
    this.windAngle = this.data.windDirection * Math.PI / 180;
    this.wind = new THREE.Vector3(Math.cos(this.windAngle), 0, Math.sin(this.windAngle));
    this.windPerpendicular = new THREE.Vector3(-this.wind.z, 0, this.wind.x);
    this.sunDirection = new THREE.Vector3();
    this.atlasTexture = new THREE.TextureLoader().load(
      'assets/textures/weather-cloud-underside-atlas-v1.png'
    );
    this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.shadowTexture = this.makeShadowTexture();
    this.shadowGeometry = new THREE.PlaneGeometry(2, 2);
    this.cloudGroups = [];
    this.onDayNightChange = this.updateAppearance.bind(this);
    this.el.addEventListener('day-night-change', this.onDayNightChange);

    for (var i = 0; i < this.data.groupCount; i += 1) {
      this.cloudGroups.push(this.makeCloudGroup(i));
    }
    this.updateAppearance();
  },

  remove: function () {
    this.el.removeEventListener('day-night-change', this.onDayNightChange);
    this.cloudGroups.forEach(function (group) {
      this.scene.remove(group.mesh);
      this.scene.remove(group.shadow);
      group.mesh.geometry.dispose();
      group.mesh.material.dispose();
      group.shadow.material.dispose();
    }, this);
    this.shadowGeometry.dispose();
    this.shadowTexture.dispose();
    this.atlasTexture.dispose();
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
    var cloudMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      alphaTest: 0.025,
      opacity: 0,
    });
    var mesh = new THREE.Mesh(new THREE.BufferGeometry(), cloudMaterial);
    mesh.userData.weatherCloud = true;
    mesh.renderOrder = 0;
    mesh.frustumCulled = false;

    var shadowMaterial = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      color: '#141820',
      transparent: true,
      depthWrite: false,
      depthTest: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    var shadow = new THREE.Mesh(this.shadowGeometry, shadowMaterial);
    shadow.userData.weatherCloudShadow = true;
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.07;
    shadow.renderOrder = 1;
    shadow.visible = false;

    this.scene.add(mesh);
    this.scene.add(shadow);
    var group = {
      mesh: mesh,
      shadow: shadow,
      clouds: [],
      age: 0,
      travelDistance: 0,
      speed: 1,
      density: this.data.density,
      shade: 1,
      baseOpacity: 0.86,
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
    group.baseOpacity = this.randomBetween(0.76, 0.9);
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
    group.mesh.position.set(
      this.wind.x * forward + this.windPerpendicular.x * lateral,
      0,
      this.wind.z * forward + this.windPerpendicular.z * lateral
    );
    group.travelDistance = initial ? (endForward - startForward) * progress : 0;
    group.mesh.visible = true;
    group.shadow.visible = false;
    this.updateGroupGeometry(group, 0);
  },

  configureGroupClouds: function (group) {
    var count = this.data.minCloudsPerGroup + Math.floor(Math.random() *
      (this.data.maxCloudsPerGroup - this.data.minCloudsPerGroup + 1));
    var spread = 18 + (1 - group.density) * 48;
    group.clouds = [];
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
    if (group.mesh.geometry) group.mesh.geometry.dispose();
    group.mesh.geometry = this.makeGroupGeometry(group);
    group.shadow.scale.set(
      group.boundsX * (0.5 + (1 - group.density) * 0.22),
      group.boundsZ * (0.5 + (1 - group.density) * 0.22),
      1
    );
  },

  makeGroupGeometry: function (group) {
    var positions = new Float32Array(group.clouds.length * 12);
    var uvs = new Float32Array(group.clouds.length * 8);
    var indices = [];
    var paddingU = 0.006;
    var paddingV = 0.012;

    group.clouds.forEach(function (cloud, i) {
      var column = cloud.tile % 4;
      var row = Math.floor(cloud.tile / 4);
      var u0 = column * 0.25 + paddingU;
      var u1 = (column + 1) * 0.25 - paddingU;
      var v0 = row * 0.5 + paddingV;
      var v1 = (row + 1) * 0.5 - paddingV;
      var uvOffset = i * 8;
      uvs[uvOffset] = u0;
      uvs[uvOffset + 1] = v0;
      uvs[uvOffset + 2] = u1;
      uvs[uvOffset + 3] = v0;
      uvs[uvOffset + 4] = u1;
      uvs[uvOffset + 5] = v1;
      uvs[uvOffset + 6] = u0;
      uvs[uvOffset + 7] = v1;
      var vertex = i * 4;
      indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
    });

    var geometry = new THREE.BufferGeometry();
    var positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
  },

  updateGroupGeometry: function (group, elapsedSeconds) {
    var positions = group.mesh.geometry.attributes.position.array;
    var presence = this.getGroupPresence(group);
    var formationScale = 0.12 + presence * 0.88;

    group.clouds.forEach(function (cloud, i) {
      cloud.sizeScale += cloud.sizeVelocity * elapsedSeconds;
      if (cloud.sizeScale > 1.18) {
        cloud.sizeScale = 1.18;
        cloud.sizeVelocity = -Math.abs(cloud.sizeVelocity);
      } else if (cloud.sizeScale < 0.82) {
        cloud.sizeScale = 0.82;
        cloud.sizeVelocity = Math.abs(cloud.sizeVelocity);
      }

      var halfWidth = cloud.width * cloud.sizeScale * formationScale * 0.5;
      var halfDepth = cloud.depth * cloud.sizeScale * formationScale * 0.5;
      var cosine = Math.cos(cloud.rotation);
      var sine = Math.sin(cloud.rotation);
      var corners = [
        [-halfWidth, -halfDepth],
        [halfWidth, -halfDepth],
        [halfWidth, halfDepth],
        [-halfWidth, halfDepth],
      ];
      var positionOffset = i * 12;
      corners.forEach(function (corner, cornerIndex) {
        var x = corner[0] * cosine - corner[1] * sine;
        var z = corner[0] * sine + corner[1] * cosine;
        var offset = positionOffset + cornerIndex * 3;
        positions[offset] = cloud.offsetX + x;
        positions[offset + 1] = cloud.height;
        positions[offset + 2] = cloud.offsetZ + z;
      });
    });
    group.mesh.geometry.attributes.position.needsUpdate = true;
    if (!group.mesh.geometry.boundingSphere) group.mesh.geometry.computeBoundingSphere();
  },

  getGroupPresence: function (group) {
    return smoothStep(0, this.data.formationDistance, group.travelDistance);
  },

  updateGroup: function (group, elapsed, cycle) {
    var seconds = elapsed / 1000;
    group.age += elapsed;
    var wobble = Math.sin(group.age / group.wobblePeriodMs * Math.PI * 2 + group.wobblePhase) *
      group.wobbleRadians;
    var heading = this.windAngle + wobble;
    group.mesh.position.x += Math.cos(heading) * group.speed * seconds;
    group.mesh.position.z += Math.sin(heading) * group.speed * seconds;
    group.travelDistance += group.speed * seconds;
    this.updateGroupGeometry(group, seconds);

    var presence = this.getGroupPresence(group);
    var forward = group.mesh.position.dot(this.wind);
    var lateral = group.mesh.position.dot(this.windPerpendicular);
    var lateralInside = Math.min(Math.abs(lateral), this.data.fieldRadius);
    var boundary = Math.sqrt(Math.max(0,
      this.data.fieldRadius * this.data.fieldRadius - lateralInside * lateralInside));
    if (forward > boundary + group.radius) {
      this.resetGroup(group, false, 0);
      return;
    }

    group.mesh.material.opacity = group.baseOpacity * presence;
    group.mesh.visible = presence > 0.01;
    this.applyGroupColor(group);
    this.updateGroupShadow(group, cycle, presence);
  },

  applyGroupColor: function (group) {
    var nightFactor = 0.38 + this.daylight * 0.62;
    var shade = group.shade * nightFactor;
    group.mesh.material.color.setRGB(
      shade * 0.96,
      shade * 0.98,
      Math.min(1, shade + 0.045)
    );
  },

  updateGroupShadow: function (group, cycle, presence) {
    // Low-quality/default weather uses one soft ground decal per cloud group.
    // TODO(high-graphics): add an option for real alpha-tested cloud shadow
    // casters, optionally per cloud, so roofs and walls receive moving shadows.
    if (!cycle || !cycle.sun.castShadow || presence < 0.08 || this.daylight < 0.08) {
      group.shadow.visible = false;
      return;
    }

    this.sunDirection.copy(cycle.sun.position).normalize();
    if (this.sunDirection.y < 0.12) {
      group.shadow.visible = false;
      return;
    }

    var averageHeight = group.height;
    var projection = Math.min(130, averageHeight / Math.max(0.2, this.sunDirection.y));
    group.shadow.position.set(
      group.mesh.position.x - this.sunDirection.x * projection,
      0.07,
      group.mesh.position.z - this.sunDirection.z * projection
    );
    group.shadow.material.opacity = this.data.shadowOpacity * presence * this.daylight *
      (0.32 + group.density * 0.82) *
      Math.min(1, group.clouds.length / Math.max(1, this.data.maxCloudsPerGroup));
    group.shadow.visible = group.shadow.material.opacity > 0.006;
  },

  updateAppearance: function (event) {
    if (event && event.detail) this.daylight = event.detail.daylight;
    this.cloudGroups.forEach(this.applyGroupColor, this);
  },

  tick: function (time, delta) {
    var cycle = this.el.components['day-night-cycle'];
    var weatherTimeScale = cycle ? cycle.timeScale : 1;
    var elapsed = Math.min(delta || 16, 100) * weatherTimeScale;
    this.cloudGroups.forEach(function (group) {
      this.updateGroup(group, elapsed, cycle);
    }, this);
  },

  randomBetween: function (minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  },

  clamp: function (value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  },
});
