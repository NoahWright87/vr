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
    this.clock = DAY_NIGHT_CYCLE_MS * 0.25; // Begin at high noon.
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

    this.sunOrb = this.makeSprite('assets/textures/sun-billboard-v1.png', 24, true);
    this.moonOrb = this.makeSprite('assets/textures/moon-billboard-v1.png', 13, false);
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
    // A transparent day sphere otherwise may be sorted after the sun sprite,
    // painting clean blue sky over it. These fixed orders also keep the two
    // sky layers stable while the distant star layer rotates.
    this.setSkyRenderOrder(this.nightSky, -30);
    this.setSkyRenderOrder(this.daySky, -20);
    this.setSkyRenderOrder(this.gradient, -10);
    if (this.sunOrb) this.sunOrb.renderOrder = 20;
    if (this.moonOrb) this.moonOrb.renderOrder = 20;
  },

  setSkyRenderOrder: function (element, order) {
    if (!element || !element.object3D) return;
    element.object3D.traverse(function (object) { object.renderOrder = order; });
  },

  makeSprite: function (src, size, additive) {
    var texture = new THREE.TextureLoader().load(src);
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
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
    this.clock = (this.clock + DAY_NIGHT_CYCLE_MS / 24) % DAY_NIGHT_CYCLE_MS;
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
      if (!object.isMesh || object.userData.dayNightCelestial || object.userData.weatherCloudShadow || isSky) return;
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
    var lunarPhase = (this.clock / (DAY_NIGHT_CYCLE_MS * LUNAR_SYNODIC_DAYS)) * Math.PI * 2;
    var anomaly = (this.clock / (DAY_NIGHT_CYCLE_MS * LUNAR_ANOMALISTIC_DAYS)) * Math.PI * 2;
    var node = (this.clock / (DAY_NIGHT_CYCLE_MS * LUNAR_NODAL_DAYS)) * Math.PI * 2;
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
    this.clock = (this.clock + Math.min(delta || 16, 100) * this.timeScale) % DAY_NIGHT_CYCLE_MS;
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

// A deliberately modest foundation for weather: 28 pooled billboards.
// Cloud shadows stay scaffolded but disabled until they have a reliable,
// artifact-free proxy material in every A-Frame renderer we target.
registerComponent('weather-clouds', {
  schema: {
    count: { type: 'int', default: 28 },
    spawnIntervalMs: { type: 'number', default: 900 },
    minSize: { type: 'number', default: 3.5 },
    maxSize: { type: 'number', default: 30 },
    driftSpeed: { type: 'number', default: 0.75 },
    darkness: { type: 'number', default: 0.18 },
    lifetimeMs: { type: 'number', default: 120000 },
    maxLifetimeMs: { type: 'number', default: 720000 },
    minAltitude: { type: 'number', default: 26 },
    maxAltitude: { type: 'number', default: 44 },
    spawnRadius: { type: 'number', default: 100 },
    shadowCasters: { type: 'int', default: 0 },
  },

  init: function () {
    this.scene = this.el.object3D;
    this.textures = [
      new THREE.TextureLoader().load('assets/textures/weather-cloud-cumulus-v1.png'),
      new THREE.TextureLoader().load('assets/textures/weather-cloud-wispy-v1.png'),
      new THREE.TextureLoader().load('assets/textures/weather-cloud-puff-v1.png'),
    ];
    this.clouds = [];
    this.nextSpawn = 0;
    this.onDayNightChange = this.updateAppearance.bind(this);
    this.el.addEventListener('day-night-change', this.onDayNightChange);
    for (var i = 0; i < this.data.count; i += 1) {
      var cloud = this.makeCloud();
      this.clouds.push(cloud);
      this.spawn(cloud, true);
      cloud.age = (i / this.data.count) * cloud.lifetimeMs;
      this.updateCloudTransition(cloud);
    }
  },

  remove: function () {
    this.el.removeEventListener('day-night-change', this.onDayNightChange);
    this.clouds.forEach(function (cloud) { this.scene.remove(cloud.group); }, this);
  },

  makeCloud: function () {
    var group = new THREE.Group();
    var material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0.86 });
    var sprite = new THREE.Sprite(material);
    var detail = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0.42 }));
    detail.position.set(1.5, -0.5, -0.3);
    detail.material.rotation = Math.random() * 0.16 - 0.08;
    group.add(sprite, detail);
    group.visible = false;
    this.scene.add(group);
    return { group: group, sprite: sprite, detail: detail, active: false, age: 0 };
  },

  spawn: function (cloud, initial) {
    var size = this.data.minSize + Math.random() * (this.data.maxSize - this.data.minSize);
    cloud.lifetimeMs = this.data.lifetimeMs + Math.random() * (this.data.maxLifetimeMs - this.data.lifetimeMs);
    cloud.sprite.material.map = this.textures[Math.floor(Math.random() * this.textures.length)];
    cloud.detail.material.map = this.textures[Math.floor(Math.random() * this.textures.length)];
    cloud.sprite.scale.set(size * 1.75, size, 1);
    cloud.detail.scale.set(size * 1.15, size * 0.68, 1);
    cloud.group.position.set(
      (Math.random() - 0.5) * this.data.spawnRadius * 2,
      this.data.minAltitude + Math.random() * (this.data.maxAltitude - this.data.minAltitude),
      (Math.random() - 0.5) * this.data.spawnRadius * 2
    );
    if (!initial) cloud.group.position.x = -this.data.spawnRadius * 1.25;
    cloud.velocity = new THREE.Vector3(this.data.driftSpeed * (0.45 + Math.random() * 1.7), 0, (Math.random() - 0.5) * this.data.driftSpeed * 0.45);
    cloud.age = 0;
    cloud.active = true;
    cloud.group.visible = true;
    this.updateCloudTransition(cloud);
    this.updateAppearance();
  },

  updateCloudTransition: function (cloud) {
    var transitionMs = Math.min(35000, cloud.lifetimeMs * 0.16);
    var grow = smoothStep(0, transitionMs, cloud.age);
    var shrink = 1 - smoothStep(cloud.lifetimeMs - transitionMs, cloud.lifetimeMs, cloud.age);
    var presence = Math.min(grow, shrink);
    var scale = 0.12 + presence * 0.88;
    cloud.group.scale.set(scale, scale, scale);
    cloud.sprite.material.opacity = 0.86 * presence;
    cloud.detail.material.opacity = 0.42 * presence;
    cloud.group.visible = presence > 0.01;
  },

  updateAppearance: function (event) {
    var daylight = event && event.detail ? event.detail.daylight : 1;
    var shade = 1 - this.data.darkness * (0.55 + daylight * 0.45);
    this.clouds.forEach(function (cloud) {
      cloud.sprite.material.color.setRGB(shade, shade, shade + 0.02);
      cloud.detail.material.color.setRGB(shade * 0.92, shade * 0.95, shade);
    });
  },

  updateShadows: function () {
    // Do not attach a transparent box just to cast shadows: on the deployed
    // WebGL path it rendered as an opaque black rectangle. The setting remains
    // for a future, tested shadow-proxy implementation.
  },

  tick: function (time, delta) {
    var cycle = this.el.components['day-night-cycle'];
    var weatherTimeScale = cycle ? cycle.timeScale : 1;
    var elapsed = Math.min(delta || 16, 100) * weatherTimeScale;
    this.clouds.forEach(function (cloud) {
      if (!cloud.active) return;
      cloud.age += elapsed;
      cloud.group.position.addScaledVector(cloud.velocity, elapsed / 1000);
      this.updateCloudTransition(cloud);
      if (cloud.age >= cloud.lifetimeMs) {
        cloud.active = false;
        cloud.group.visible = false;
      }
    }, this);
    this.nextSpawn += elapsed;
    if (this.nextSpawn >= this.data.spawnIntervalMs) {
      var available = this.clouds.find(function (cloud) { return !cloud.active; });
      if (available) this.spawn(available, false);
      this.nextSpawn = 0;
    }
    this.updateShadows();
  },
});
