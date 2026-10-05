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
      var owner = this.findOwnerElement(object);
      var isSky = owner && (owner.id === 'night-sky' || owner.id === 'day-sky' || owner.id === 'sunset-gradient');
      if (!object.isMesh || object.userData.dayNightCelestial || object.userData.weatherCloud || object.userData.weatherCloudShadow || object.userData.lowPriorityShadow || isSky) return;
      object.castShadow = any && this.shouldCastShadow(object, owner);
      object.receiveShadow = any && this.shouldReceiveShadow(object, owner);
    }.bind(this));
  },

  findOwnerElement: function (object) {
    var node = object;
    while (node) {
      if (node.el) return node.el;
      node = node.parent;
    }
    return null;
  },

  isPlayerVisual: function (owner) {
    return Boolean(owner && owner.closest && owner.closest('#player-rig'));
  },

  hasTransparentMaterial: function (object) {
    var materials = Array.isArray(object.material) ? object.material : [object.material];
    for (var i = 0; i < materials.length; i += 1) {
      if (materials[i] && materials[i].transparent && materials[i].opacity < 0.98) return true;
    }
    return false;
  },

  shouldCastShadow: function (object, owner) {
    if (!owner) return false;
    if (this.isPlayerVisual(owner)) return false;
    var tag = owner.tagName;
    if (tag === 'A-PLANE' || tag === 'A-TEXT' || tag === 'A-SKY' || tag === 'A-CIRCLE' || tag === 'A-RING') return false;
    if (this.hasTransparentMaterial(object)) return false;
    if (!object.geometry) return false;
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    var radius = object.geometry.boundingSphere ? object.geometry.boundingSphere.radius : 0;
    var scale = object.scale;
    radius *= Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    return radius >= (this.lowPowerShadows ? 0.55 : 0.18);
  },

  shouldReceiveShadow: function (object, owner) {
    if (!owner || this.isPlayerVisual(owner)) return false;
    var tag = owner.tagName;
    if (tag === 'A-TEXT' || tag === 'A-SKY' || tag === 'A-CIRCLE' || tag === 'A-RING') return false;
    return !this.hasTransparentMaterial(object);
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
    this.sun.visible = sunAboveHorizon;
    this.moon.visible = moonAboveHorizon;
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
    if (this.nightSky) {
      this.nightSky.object3D.rotation.y = -(this.elapsedGameMs / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
    }
    if (this.gradient) {
      this.gradient.object3D.visible = twilight > 0.004;
      this.gradient.setAttribute('material', { opacity: twilight * 0.76, sunDirection: sunDir });
    }
    this.applyShadowState();
    this.el.emit('day-night-change', { daylight: daylight, hour: (this.clock / DAY_NIGHT_CYCLE_MS) * 24 });
  },

  getCelestialDirections: function () {
    // All orbit angles use unbounded game time. Cosine and sine naturally wrap,
    // while the slowly changing third axis stays continuous between 359° and
    // 0°. Feeding a wrapped angle into that deviation visibly teleported both
    // celestial hierarchies at sunrise.
    var solarAngle = (this.elapsedGameMs / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
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
    if (this.nightSky) {
      this.nightSky.object3D.rotation.y = -(this.elapsedGameMs / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
    }
  },
});

// PS1-style weather. Twenty independently simulated cloud systems cross the
// world-space field. The default renderer is one horizontal, alpha-tested card
// per group in a single draw. An optional 3D mode keeps the 36-triangle puff
// batch, while a second batch contains only the largest few shadow decals.
registerComponent('weather-clouds', {
  schema: {
    quality: { type: 'string', default: 'sprites' },
    groupCount: { type: 'int', default: 20 },
    minCloudsPerGroup: { type: 'int', default: 5 },
    maxCloudsPerGroup: { type: 'int', default: 13 },
    minSize: { type: 'number', default: 8 },
    maxSize: { type: 'number', default: 34 },
    sizeChangeRate: { type: 'number', default: 0.028 },
    density: { type: 'number', default: 0.58 },
    minSpeed: { type: 'number', default: 0.62 },
    maxSpeed: { type: 'number', default: 1.2 },
    windDirection: { type: 'number', default: 0 },
    wobbleFrequencyMs: { type: 'number', default: 22000 },
    wobbleAmount: { type: 'number', default: 4 },
    minHeight: { type: 'number', default: 90 },
    maxHeight: { type: 'number', default: 165 },
    verticalSpread: { type: 'number', default: 8 },
    minShade: { type: 'number', default: 0.72 },
    maxShade: { type: 'number', default: 1 },
    fieldRadius: { type: 'number', default: 360 },
    formationDistance: { type: 'number', default: 120 },
    shadowOpacity: { type: 'number', default: 0.16 },
    maxShadowGroups: { type: 'int', default: 6 },
    shapeUpdateMs: { type: 'number', default: 125 },
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
    this.shadowTexture = this.makeShadowTexture();
    this.cloudGroups = [];
    this.shapeElapsedMs = 0;
    this.quality = this.normalizeQuality(this.data.quality);
    this.maxCloudSlots = this.data.groupCount * this.data.maxCloudsPerGroup;
    this.makeCloudBatch();
    this.makeCloudSpriteBatch();
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
    this.scene.remove(this.cloudMesh);
    this.scene.remove(this.cloudSpriteMesh);
    this.scene.remove(this.shadowMesh);
    this.cloudGeometry.dispose();
    this.cloudMaterial.dispose();
    this.cloudSpriteGeometry.dispose();
    this.cloudSpriteMaterial.dispose();
    this.cloudSpriteTexture.dispose();
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.shadowTexture.dispose();
  },

  makeCloudBatch: function () {
    // Detail zero is just 12 pentagonal faces (36 GPU triangles). Flat Lambert
    // shading gives each puff a deliberately faceted silhouette while it still
    // responds to the shared sun, moon, and ambient environment lights.
    this.cloudGeometry = new THREE.DodecahedronGeometry(0.5, 0);
    this.cloudMaterial = new THREE.MeshLambertMaterial({
      color: '#ffffff',
      flatShading: true,
      depthWrite: true,
      depthTest: true,
    });
    this.cloudDummy = new THREE.Object3D();
    this.cloudTint = new THREE.Color();
    this.cloudMesh = new THREE.InstancedMesh(
      this.cloudGeometry,
      this.cloudMaterial,
      this.maxCloudSlots
    );
    this.cloudMesh.name = 'low-poly-cloud-puffs';
    this.cloudMesh.count = 0;
    this.cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cloudMesh.userData.weatherCloud = true;
    this.cloudMesh.userData.lowPriorityShadow = true;
    this.cloudMesh.castShadow = false;
    this.cloudMesh.receiveShadow = false;
    this.cloudMesh.renderOrder = 0;
    this.cloudMesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, (this.data.minHeight + this.data.maxHeight) * 0.5, 0),
      this.data.fieldRadius * 1.55
    );
    this.scene.add(this.cloudMesh);
  },

  makeCloudSpriteBatch: function () {
    var groupCount = this.data.groupCount;
    var vertexCount = groupCount * 6;
    this.cloudSpritePositions = new Float32Array(vertexCount * 3);
    this.cloudSpriteNormals = new Float32Array(vertexCount * 3);
    this.cloudSpriteUvs = new Float32Array(vertexCount * 2);
    this.cloudSpriteColors = new Float32Array(vertexCount * 3);
    for (var i = 0; i < vertexCount; i += 1) {
      this.cloudSpriteNormals[i * 3 + 1] = -1;
    }

    this.cloudSpriteGeometry = new THREE.BufferGeometry();
    this.cloudSpritePositionAttribute = new THREE.BufferAttribute(this.cloudSpritePositions, 3);
    this.cloudSpriteUvAttribute = new THREE.BufferAttribute(this.cloudSpriteUvs, 2);
    this.cloudSpriteColorAttribute = new THREE.BufferAttribute(this.cloudSpriteColors, 3);
    this.cloudSpritePositionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.cloudSpriteUvAttribute.setUsage(THREE.DynamicDrawUsage);
    this.cloudSpriteColorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.cloudSpriteGeometry.setAttribute('position', this.cloudSpritePositionAttribute);
    this.cloudSpriteGeometry.setAttribute('normal', new THREE.BufferAttribute(this.cloudSpriteNormals, 3));
    this.cloudSpriteGeometry.setAttribute('uv', this.cloudSpriteUvAttribute);
    this.cloudSpriteGeometry.setAttribute('color', this.cloudSpriteColorAttribute);
    this.cloudSpriteGeometry.setDrawRange(0, 0);
    this.cloudSpriteGeometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, (this.data.minHeight + this.data.maxHeight) * 0.5, 0),
      this.data.fieldRadius * 1.55
    );

    this.cloudSpriteTexture = new THREE.TextureLoader().load(
      'assets/textures/weather-cloud-underside-atlas-v1.png'
    );
    this.cloudSpriteTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.cloudSpriteTexture.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in this.cloudSpriteTexture && THREE.SRGBColorSpace) {
      this.cloudSpriteTexture.colorSpace = THREE.SRGBColorSpace;
    }
    this.cloudSpriteMaterial = new THREE.MeshBasicMaterial({
      map: this.cloudSpriteTexture,
      vertexColors: true,
      alphaTest: 0.2,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });
    this.cloudSpriteMesh = new THREE.Mesh(this.cloudSpriteGeometry, this.cloudSpriteMaterial);
    this.cloudSpriteMesh.name = 'sprite-cloud-groups';
    this.cloudSpriteMesh.userData.weatherCloud = true;
    this.cloudSpriteMesh.userData.lowPriorityShadow = true;
    this.cloudSpriteMesh.castShadow = false;
    this.cloudSpriteMesh.receiveShadow = false;
    this.cloudSpriteMesh.renderOrder = 0;
    this.scene.add(this.cloudSpriteMesh);
  },

  normalizeQuality: function (quality) {
    if (quality === 'off' || quality === '3d') return quality;
    return 'sprites';
  },

  setQuality: function (quality) {
    this.quality = this.normalizeQuality(quality);
    this.cloudMesh.visible = this.quality === '3d';
    this.cloudSpriteMesh.visible = this.quality === 'sprites';
    if (this.quality === 'off') {
      this.cloudMesh.count = 0;
      this.cloudSpriteGeometry.setDrawRange(0, 0);
      this.shadowMesh.count = 0;
      this.shadowMesh.visible = false;
    }
  },

  update: function () {
    if (this.cloudMesh && this.cloudSpriteMesh && this.shadowMesh) {
      this.setQuality(this.data.quality);
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
      side: THREE.FrontSide,
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
      warmth: 0,
      spread: 1,
      boundsX: 1,
      boundsZ: 1,
      radius: 1,
      spriteTile: 0,
      spriteRotation: 0,
      spriteScale: 1,
    };
    this.resetGroup(group, true, index);
    return group;
  },

  resetGroup: function (group, initial, index) {
    group.age = Math.random() * this.data.wobbleFrequencyMs;
    group.speed = this.randomBetween(this.data.minSpeed, this.data.maxSpeed);
    group.density = this.clamp(this.data.density + (Math.random() - 0.5) * 0.55, 0.12, 0.94);
    group.shade = this.randomBetween(this.data.minShade, this.data.maxShade);
    group.warmth = this.randomBetween(-0.035, 0.045);
    group.spriteTile = Math.floor(Math.random() * 8);
    group.spriteRotation = Math.random() * Math.PI * 2;
    group.spriteScale = this.randomBetween(0.86, 1.2);
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
    var spread = 4 + (1 - group.density) * 32;
    group.spread = spread;
    group.clouds.length = 0;
    var minX = Infinity;
    var maxX = -Infinity;
    var minZ = Infinity;
    var maxZ = -Infinity;

    var altitudeRange = Math.max(1, this.data.maxHeight - this.data.minHeight);
    var altitudeFactor = this.clamp((group.height - this.data.minHeight) / altitudeRange, 0, 1);
    var sizeCeiling = this.data.minSize + (this.data.maxSize - this.data.minSize) *
      (0.55 + altitudeFactor * 0.45);
    for (var i = 0; i < count; i += 1) {
      var angle = Math.random() * Math.PI * 2;
      // Anchor each system with one central puff, then overlap the rest into an
      // irregular formation instead of scattering obvious individual objects.
      var distance = i === 0 ? 0 : spread * Math.pow(Math.random(), 0.72);
      var size = this.randomBetween(this.data.minSize, sizeCeiling);
      var width = size * this.randomBetween(0.78, 1.62);
      var depth = size * this.randomBetween(0.65, 1.42);
      var minScale = this.randomBetween(0.56, 0.88);
      var maxScale = this.randomBetween(1.08, 1.52);
      var cloud = {
        offsetX: Math.cos(angle) * distance,
        offsetZ: Math.sin(angle) * distance,
        height: group.height + this.randomBetween(-this.data.verticalSpread, this.data.verticalSpread),
        width: width,
        depth: depth,
        thickness: size * this.randomBetween(0.38, 0.92),
        rotationX: this.randomBetween(-0.12, 0.12),
        rotationY: Math.random() * Math.PI * 2,
        rotationZ: this.randomBetween(-0.1, 0.1),
        shadeVariation: this.randomBetween(0.82, 1.12),
        shadeTarget: this.randomBetween(0.82, 1.12),
        shadeRate: this.randomBetween(0.0025, 0.009),
        minScale: minScale,
        maxScale: maxScale,
        sizeScale: this.randomBetween(minScale, maxScale),
        sizeTarget: this.randomBetween(minScale, maxScale),
        sizeRate: this.data.sizeChangeRate * this.randomBetween(0.35, 1.35),
        targetOffsetX: 0,
        targetOffsetZ: 0,
        offsetRate: this.randomBetween(0.04, 0.18),
      };
      this.pickCloudOffsetTarget(group, cloud);
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
      if (!forceShape && shapeSeconds <= 0) continue;
      var sizeStep = cloud.sizeRate * shapeSeconds;
      var sizeDifference = cloud.sizeTarget - cloud.sizeScale;
      if (Math.abs(sizeDifference) <= sizeStep) {
        cloud.sizeScale = cloud.sizeTarget;
        cloud.sizeTarget = this.randomBetween(cloud.minScale, cloud.maxScale);
        cloud.sizeRate = this.data.sizeChangeRate * this.randomBetween(0.25, 1.5);
      } else {
        cloud.sizeScale += Math.sign(sizeDifference) * sizeStep;
      }

      var shadeStep = cloud.shadeRate * shapeSeconds;
      var shadeDifference = cloud.shadeTarget - cloud.shadeVariation;
      if (Math.abs(shadeDifference) <= shadeStep) {
        cloud.shadeVariation = cloud.shadeTarget;
        cloud.shadeTarget = this.randomBetween(0.82, 1.12);
        cloud.shadeRate = this.randomBetween(0.0025, 0.009);
      } else {
        cloud.shadeVariation += Math.sign(shadeDifference) * shadeStep;
      }

      var offsetX = cloud.targetOffsetX - cloud.offsetX;
      var offsetZ = cloud.targetOffsetZ - cloud.offsetZ;
      var offsetDistance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
      var offsetStep = cloud.offsetRate * shapeSeconds;
      if (offsetDistance <= offsetStep) {
        cloud.offsetX = cloud.targetOffsetX;
        cloud.offsetZ = cloud.targetOffsetZ;
        this.pickCloudOffsetTarget(group, cloud);
        cloud.offsetRate = this.randomBetween(0.04, 0.18);
      } else if (offsetDistance > 0) {
        cloud.offsetX += offsetX / offsetDistance * offsetStep;
        cloud.offsetZ += offsetZ / offsetDistance * offsetStep;
      }
    }
  },

  pickCloudOffsetTarget: function (group, cloud) {
    var angle = Math.random() * Math.PI * 2;
    var distance = group.spread * Math.pow(Math.random(), 0.72);
    cloud.targetOffsetX = Math.cos(angle) * distance;
    cloud.targetOffsetZ = Math.sin(angle) * distance;
  },

  updateCloudBatch: function () {
    var i;
    this.cloudMesh.count = 0;
    if (this.quality !== '3d') {
      this.cloudMesh.visible = false;
      return;
    }
    // The Lambert material already follows the celestial lights. This small
    // tint shift keeps moonlit clouds legible without lighting them twice.
    var nightFactor = 0.76 + this.daylight * 0.24;
    var dummy = this.cloudDummy;
    for (i = 0; i < this.cloudGroups.length; i += 1) {
      var group = this.cloudGroups[i];
      var presence = this.getGroupPresence(group);
      if (presence <= 0.01) continue;
      var formationScale = presence;
      for (var cloudIndex = 0; cloudIndex < group.clouds.length; cloudIndex += 1) {
        var cloud = group.clouds[cloudIndex];
        var instance = this.cloudMesh.count;
        var shade = group.shade * cloud.shadeVariation * nightFactor;
        this.cloudTint.setRGB(
          this.clamp(shade * (0.96 + group.warmth), 0, 1),
          this.clamp(shade * 0.98, 0, 1),
          this.clamp(shade * (1.02 - group.warmth * 0.4) + 0.025, 0, 1)
        );
        var worldX = group.x + cloud.offsetX;
        var worldZ = group.z + cloud.offsetZ;
        dummy.position.set(worldX, cloud.height, worldZ);
        dummy.rotation.set(cloud.rotationX, cloud.rotationY, cloud.rotationZ);
        dummy.scale.set(
          cloud.width * cloud.sizeScale * formationScale,
          cloud.thickness * cloud.sizeScale * formationScale,
          cloud.depth * cloud.sizeScale * formationScale
        );
        dummy.updateMatrix();
        this.cloudMesh.setMatrixAt(instance, dummy.matrix);
        this.cloudMesh.setColorAt(instance, this.cloudTint);
        this.cloudMesh.count = instance + 1;
      }
    }
    this.cloudMesh.visible = this.cloudMesh.count > 0;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    if (this.cloudMesh.instanceColor) this.cloudMesh.instanceColor.needsUpdate = true;
  },

  updateCloudSpriteBatch: function () {
    var geometry = this.cloudSpriteGeometry;
    if (this.quality !== 'sprites') {
      geometry.setDrawRange(0, 0);
      this.cloudSpriteMesh.visible = false;
      return;
    }

    var positions = this.cloudSpritePositions;
    var uvs = this.cloudSpriteUvs;
    var colors = this.cloudSpriteColors;
    var visibleCount = 0;
    // MeshBasic keeps the cutout shader cheaper than a lit material, so apply
    // the day/night response directly to its vertex tint.
    var nightFactor = 0.28 + this.daylight * 0.72;
    var atlasColumns = 4;
    var atlasRows = 2;
    var paddingU = 0.006;
    var paddingV = 0.012;

    for (var i = 0; i < this.cloudGroups.length; i += 1) {
      var group = this.cloudGroups[i];
      var presence = this.getGroupPresence(group);
      if (presence <= 0.01) continue;

      var averageScale = 0;
      var averageShade = 0;
      for (var cloudIndex = 0; cloudIndex < group.clouds.length; cloudIndex += 1) {
        averageScale += group.clouds[cloudIndex].sizeScale;
        averageShade += group.clouds[cloudIndex].shadeVariation;
      }
      averageScale /= Math.max(1, group.clouds.length);
      averageShade /= Math.max(1, group.clouds.length);

      // Each group is one world-fixed horizontal card. It never reads the
      // camera pose, so head turns cannot make the cloud rotate or slide.
      var width = Math.min(105, group.boundsX * (0.9 + (1 - group.density) * 0.22)) *
        averageScale * group.spriteScale * presence;
      var depth = Math.min(82, group.boundsZ * (0.92 + (1 - group.density) * 0.18)) *
        averageScale * group.spriteScale * presence;
      var halfWidth = width * 0.5;
      var halfDepth = depth * 0.5;
      var cosine = Math.cos(group.spriteRotation);
      var sine = Math.sin(group.spriteRotation);
      var rightX = cosine * halfWidth;
      var rightZ = sine * halfWidth;
      var forwardX = -sine * halfDepth;
      var forwardZ = cosine * halfDepth;
      var x0 = group.x - rightX - forwardX;
      var z0 = group.z - rightZ - forwardZ;
      var x1 = group.x + rightX - forwardX;
      var z1 = group.z + rightZ - forwardZ;
      var x2 = group.x + rightX + forwardX;
      var z2 = group.z + rightZ + forwardZ;
      var x3 = group.x - rightX + forwardX;
      var z3 = group.z - rightZ + forwardZ;
      var y = group.height;
      var positionOffset = visibleCount * 18;

      // Clockwise from above means the visible/front face points down toward
      // the player. Two triangles, no per-card object or draw call.
      positions[positionOffset] = x0;
      positions[positionOffset + 1] = y;
      positions[positionOffset + 2] = z0;
      positions[positionOffset + 3] = x1;
      positions[positionOffset + 4] = y;
      positions[positionOffset + 5] = z1;
      positions[positionOffset + 6] = x2;
      positions[positionOffset + 7] = y;
      positions[positionOffset + 8] = z2;
      positions[positionOffset + 9] = x0;
      positions[positionOffset + 10] = y;
      positions[positionOffset + 11] = z0;
      positions[positionOffset + 12] = x2;
      positions[positionOffset + 13] = y;
      positions[positionOffset + 14] = z2;
      positions[positionOffset + 15] = x3;
      positions[positionOffset + 16] = y;
      positions[positionOffset + 17] = z3;

      var tile = group.spriteTile % (atlasColumns * atlasRows);
      var column = tile % atlasColumns;
      var row = Math.floor(tile / atlasColumns);
      var u0 = column / atlasColumns + paddingU;
      var u1 = (column + 1) / atlasColumns - paddingU;
      var v0 = row / atlasRows + paddingV;
      var v1 = (row + 1) / atlasRows - paddingV;
      var uvOffset = visibleCount * 12;
      uvs[uvOffset] = u0;
      uvs[uvOffset + 1] = v0;
      uvs[uvOffset + 2] = u1;
      uvs[uvOffset + 3] = v0;
      uvs[uvOffset + 4] = u1;
      uvs[uvOffset + 5] = v1;
      uvs[uvOffset + 6] = u0;
      uvs[uvOffset + 7] = v0;
      uvs[uvOffset + 8] = u1;
      uvs[uvOffset + 9] = v1;
      uvs[uvOffset + 10] = u0;
      uvs[uvOffset + 11] = v1;

      var shade = group.shade * averageShade * nightFactor;
      var red = this.clamp(shade * (0.96 + group.warmth), 0, 1);
      var green = this.clamp(shade * 0.98, 0, 1);
      var blue = this.clamp(shade * (1.02 - group.warmth * 0.4) + 0.025, 0, 1);
      var colorOffset = visibleCount * 18;
      for (var vertex = 0; vertex < 6; vertex += 1) {
        colors[colorOffset + vertex * 3] = red;
        colors[colorOffset + vertex * 3 + 1] = green;
        colors[colorOffset + vertex * 3 + 2] = blue;
      }
      visibleCount += 1;
    }

    geometry.setDrawRange(0, visibleCount * 6);
    this.cloudSpritePositionAttribute.needsUpdate = true;
    this.cloudSpriteUvAttribute.needsUpdate = true;
    this.cloudSpriteColorAttribute.needsUpdate = true;
    this.cloudSpriteMesh.visible = visibleCount > 0;
  },

  getGroupPresence: function (group) {
    var forward = group.x * this.windX + group.z * this.windZ;
    var lateral = group.x * this.perpendicularX + group.z * this.perpendicularZ;
    var lateralInside = Math.min(Math.abs(lateral), this.data.fieldRadius);
    var boundary = Math.sqrt(Math.max(0,
      this.data.fieldRadius * this.data.fieldRadius - lateralInside * lateralInside));
    var exitDistance = boundary + group.radius - forward;
    var fadeIn = smoothStep(0, this.data.formationDistance, group.travelDistance);
    var fadeOut = smoothStep(0, this.data.formationDistance, exitDistance);
    return fadeIn * fadeOut;
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
    if (this.quality === 'off' || !count || !cycle || !cycle.sun.castShadow || this.daylight < 0.08) {
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
      var scale = presence * (0.5 + (1 - group.density) * 0.22);
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
    this.updateCloudSpriteBatch();
    this.updateCloudBatch();
    this.updateShadowBatch(cycle);
  },

  randomBetween: function (minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  },

  clamp: function (value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  },
});
