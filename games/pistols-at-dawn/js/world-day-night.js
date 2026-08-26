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
          this.sunShadows = false;
          this.moonShadows = false;
          this.timeScale = 1;
          this.daySky = document.querySelector('#day-sky');
          this.gradient = document.querySelector('#sunset-gradient');
          this.scene = this.el.object3D;
          this.onAreaLoaded = this.applyShadowState.bind(this);
          this.onKeyDown = this.onKeyDown.bind(this);
          this.el.addEventListener('area-loaded', this.onAreaLoaded);
          window.addEventListener('keydown', this.onKeyDown);

          this.sun = new THREE.DirectionalLight('#ffd1aa', 0);
          this.moon = new THREE.DirectionalLight('#9bc7ff', 0);
          this.ambient = new THREE.HemisphereLight('#d9efff', '#1c1b35', 0.2);
          this.sun.target.position.set(0, 0, 0);
          this.moon.target.position.set(0, 0, 0);
          this.scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.ambient);

          this.sunOrb = this.makeOrb('#ffe3b0', 3.4);
          this.moonOrb = this.makeOrb('#bbd7ff', 2.5);
          this.scene.add(this.sunOrb, this.moonOrb);
          this.applyLighting();
          this.el.emit('day-night-shadow-change', { sun: false, moon: false });
        },

        remove: function () {
          this.el.removeEventListener('area-loaded', this.onAreaLoaded);
          window.removeEventListener('keydown', this.onKeyDown);
        },

        onKeyDown: function (evt) {
          if (evt.code !== 'Backslash' || evt.repeat) return;
          evt.preventDefault();
          this.timeScale = this.timeScale === 1 ? FAST_FORWARD_TIME_SCALE : 1;
          this.el.emit('day-night-time-scale-change', { timeScale: this.timeScale });
        },

        makeOrb: function (color, radius) {
          var mesh = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 20, 12),
            new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          mesh.userData.dayNightCelestial = true;
          return mesh;
        },

        waitOneHour: function () {
          this.clock = (this.clock + DAY_NIGHT_CYCLE_MS / 24) % DAY_NIGHT_CYCLE_MS;
          this.applyLighting();
        },

        setShadow: function (body, enabled) {
          if (body === 'sun') this.sunShadows = enabled;
          else this.moonShadows = enabled;
          var light = body === 'sun' ? this.sun : this.moon;
          light.castShadow = enabled;
          light.shadow.mapSize.set(1024, 1024);
          this.applyShadowState();
          this.el.emit('day-night-shadow-change', { sun: this.sunShadows, moon: this.moonShadows });
        },

        applyShadowState: function () {
          var any = this.sunShadows || this.moonShadows;
          var renderer = this.el.renderer;
          if (renderer && renderer.shadowMap) renderer.shadowMap.enabled = any;
          this.scene.traverse(function (object) {
            var owner = object.el;
            var isSky = owner && (owner.id === 'night-sky' || owner.id === 'day-sky' || owner.id === 'sunset-gradient');
            if (!object.isMesh || object.userData.dayNightCelestial || isSky) return;
            object.castShadow = any;
            object.receiveShadow = any;
          });
        },

        applyLighting: function () {
          var angle = (this.clock / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
          var sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), Math.sin(angle * 0.37) * 0.35).normalize();
          var moonDir = sunDir.clone().multiplyScalar(-1);
          var daylight = smoothStep(-0.14, 0.16, sunDir.y);
          var moonlight = smoothStep(-0.05, 0.2, moonDir.y);
          var twilight = daylight * Math.max(0, 1 - Math.abs(sunDir.y) * 4.5);

          this.sun.position.copy(sunDir).multiplyScalar(DAY_NIGHT_ORBIT_RADIUS);
          this.moon.position.copy(moonDir).multiplyScalar(DAY_NIGHT_ORBIT_RADIUS);
          this.sunOrb.position.copy(this.sun.position);
          this.moonOrb.position.copy(this.moon.position);
          this.sun.intensity = daylight * 2.15;
          this.moon.intensity = moonlight * 0.32;
          this.ambient.intensity = 0.1 + daylight * 0.62 + moonlight * 0.12;
          this.sunOrb.visible = sunDir.y > -0.1;
          this.moonOrb.visible = moonDir.y > -0.1;
          if (this.daySky) this.daySky.setAttribute('material', 'opacity', daylight);
          if (this.gradient) this.gradient.setAttribute('material', { opacity: twilight * 0.76, sunDirection: sunDir });
          this.el.emit('day-night-change', { daylight: daylight, hour: (this.clock / DAY_NIGHT_CYCLE_MS) * 24 });
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
          var angle = (this.clock / DAY_NIGHT_CYCLE_MS) * Math.PI * 2;
          var dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), Math.sin(angle * 0.37) * 0.35).normalize();
          this.sun.position.copy(dir).multiplyScalar(DAY_NIGHT_ORBIT_RADIUS); this.sunOrb.position.copy(this.sun.position);
          this.moon.position.copy(dir).multiplyScalar(-DAY_NIGHT_ORBIT_RADIUS); this.moonOrb.position.copy(this.moon.position);
        },
      });
