      // Global, 24-minute celestial clock. Directional lights model bodies
      // at infinity; the glowing spheres are deliberately only the visible
      // sun/moon props, not the lights themselves.
      var DAY_NIGHT_CYCLE_MS = 24 * 60 * 1000;
      var DAY_NIGHT_ORBIT_RADIUS = 120;
      var FAST_FORWARD_TIME_SCALE = 20;

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
          this.clock = DAY_NIGHT_CYCLE_MS * 0.25; // begin at high noon
          this.sunShadows = true;
          this.moonShadows = false;
          this.timeScale = 1;
          this.daySky = document.querySelector('#day-sky');
          this.cloudSky = document.querySelector('#cloud-sky');
          this.gradient = document.querySelector('#sunset-gradient');
          this.scene = this.el.object3D;
          this.onAreaLoaded = this.enableAreaShadows.bind(this);
          this.onRenderStart = this.applyShadowState.bind(this);
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
          this.sun.castShadow = this.sunShadows;
          this.moon.castShadow = this.moonShadows;
          this.scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.ambient);

          this.sunOrb = this.makeSprite('assets/textures/sun-billboard-v1.png', 24, true);
          this.moonOrb = this.makeSprite('assets/textures/moon-billboard-v1.png', 13, false);
          this.scene.add(this.sunOrb, this.moonOrb);
          this.applyShadowState();
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
          // Let A-Frame configure material recompilation when a lazy area
          // arrives, rather than relying only on raw Three.js mesh flags.
          var root = evt.detail && evt.detail.root;
          if (root) root.setAttribute('shadow', 'cast: true; receive: true');
          this.applyShadowState();
        },

        makeSprite: function (src, size, additive) {
          var texture = new THREE.TextureLoader().load(src);
          var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
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
          var light = body === 'sun' ? this.sun : this.moon;
          this.configureShadowCamera(light);
          light.castShadow = enabled;
          this.applyShadowState();
          this.el.emit('day-night-shadow-change', { sun: this.sunShadows, moon: this.moonShadows });
        },

        applyShadowState: function () {
          var any = this.sunShadows || this.moonShadows;
          var renderer = this.el.renderer;
          var shadow = this.el.systems.shadow;
          // A-Frame's shadow component also marks existing materials for a
          // shadow-aware recompile. Setting Three.js alone does not do that
          // after the first rendered frame.
          if (shadow && shadow.setShadowMapEnabled) shadow.setShadowMapEnabled(any);
          if (renderer && renderer.shadowMap) renderer.shadowMap.enabled = any;
          this.scene.traverse(function (object) {
            var owner = object.el;
            var isSky = owner && (owner.id === 'night-sky' || owner.id === 'day-sky' || owner.id === 'cloud-sky' || owner.id === 'sunset-gradient');
            if (!object.isMesh || object.userData.dayNightCelestial || isSky) return;
            object.castShadow = any;
            object.receiveShadow = any;
          });
        },

        applyLighting: function () {
          var directions = this.getCelestialDirections();
          var sunDir = directions.sun;
          var moonDir = directions.moon;
          // The sky starts brightening while the sun is still well below the
          // horizon, then lingers after it sets. Direct light stays off until
          // its body is actually above the horizon.
          var daylight = smoothStep(-0.5, 0.42, sunDir.y);
          var moonlight = smoothStep(-0.5, 0.28, moonDir.y);
          var twilight = smoothStep(-0.55, 0.05, sunDir.y) * (1 - smoothStep(0.14, 0.72, sunDir.y));
          var sunAboveHorizon = sunDir.y > -0.02;
          var moonAboveHorizon = moonDir.y > -0.02;

          this.syncCelestialPositions(sunDir, moonDir);
          this.sun.intensity = sunAboveHorizon ? smoothStep(0, 0.2, sunDir.y) * 2.15 : 0;
          this.moon.intensity = moonAboveHorizon ? smoothStep(0, 0.2, moonDir.y) * 0.32 : 0;
          this.sun.castShadow = this.sunShadows && sunAboveHorizon;
          this.moon.castShadow = this.moonShadows && moonAboveHorizon;
          this.ambient.intensity = 0.07 + daylight * 0.5 + moonlight * 0.12 + twilight * 0.12;
          this.sunOrb.visible = sunDir.y > -0.14;
          this.moonOrb.visible = moonDir.y > -0.14;
          if (this.daySky) this.daySky.setAttribute('material', 'opacity', daylight);
          if (this.cloudSky) this.cloudSky.setAttribute('material', 'opacity', 0.28 + daylight * 0.7);
          if (this.gradient) this.gradient.setAttribute('material', { opacity: twilight * 0.76, sunDirection: sunDir });
          this.el.emit('day-night-change', { daylight: daylight, hour: (this.clock / DAY_NIGHT_CYCLE_MS) * 24 });
        },

        getCelestialDirections: function () {
          var angle = (this.clock / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
          var moonAngle = angle + Math.PI * 0.94;
          return {
            sun: new THREE.Vector3(Math.cos(angle), Math.sin(angle), Math.sin(angle * 0.37) * 0.35).normalize(),
            // Keep a distinct, slightly tilted moon orbit so its sprite and
            // light can evolve independently as lunar phases are added.
            moon: new THREE.Vector3(Math.cos(moonAngle), Math.sin(moonAngle) * 0.92, Math.sin(moonAngle * 0.61 + 0.65) * 0.48).normalize(),
          };
        },

        syncCelestialPositions: function (sunDir, moonDir) {
          this.sun.position.copy(sunDir).multiplyScalar(DAY_NIGHT_ORBIT_RADIUS);
          this.moon.position.copy(moonDir).multiplyScalar(DAY_NIGHT_ORBIT_RADIUS);
          this.sunOrb.position.copy(this.sun.position);
          this.moonOrb.position.copy(this.moon.position);
        },

        tick: function (time, delta) {
          this.clock = (this.clock + Math.min(delta || 16, 100) * this.timeScale) % DAY_NIGHT_CYCLE_MS;
          // Material changes only need a modest cadence; lights/orbs still
          // move every rendered frame so the day arc stays smooth.
          if (!this.lastUpdate || time - this.lastUpdate > 180) {
            this.lastUpdate = time;
            this.applyLighting();
            return;
          }
          var directions = this.getCelestialDirections();
          this.syncCelestialPositions(directions.sun, directions.moon);
        },
      });
