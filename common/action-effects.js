// ============================================================
// ACTION EFFECTS — sparks, shards, muzzle flashes and tracers, pooled.
//
// Nothing here creates an entity, a mesh or a material per event. Each
// effect type is one THREE.InstancedMesh with a fixed number of slots
// (or, for tracers, one LineSegments buffer), and an event just fills a
// slot. Autofire at 10 shots a second with a swarm of targets is a few
// hundred instances in four draw calls, not a few hundred entities.
//
//   var fx = sceneEl.systems['action-effects'];
//   fx.sparks(point, normal, { count: 8, color: '#ffd27a' });
//   fx.shatter(center, { count: 24, color: '#e8e8f0', velocity, size: 0.06 });
//   fx.flash(muzzlePoint, direction, { size: 0.08 });
//   fx.tracer(from, to, { color: '#ffe9a8' });
//
// Effects are part of the world, so they run on the action clock's
// world time: bullet time slows sparks and shards too.
//
// The particle integration is plain functions over typed arrays,
// tested by tests/action-effects.test.js.
// ============================================================

import './action-clock.js';

// ---------- particle fields (pure) ----------

export function createField(max) {
  var f = { max: max, count: 0 };
  ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'ax', 'ay', 'az', 'age', 'life', 'size', 'spin', 'r', 'g', 'b', 'rest'].forEach(function (k) {
    f[k] = new Float32Array(max);
  });
  return f;
}

// Adds a particle; returns its slot, or -1 when the field is full (a
// full field drops new particles rather than stealing live ones — the
// cap is a budget, and an effect that blows it should look smaller,
// not stutter).
export function emitParticle(f, p) {
  if (f.count >= f.max) return -1;
  var i = f.count++;
  f.px[i] = p.x; f.py[i] = p.y; f.pz[i] = p.z;
  f.vx[i] = p.vx || 0; f.vy[i] = p.vy || 0; f.vz[i] = p.vz || 0;
  var ax = p.axisX === undefined ? 0 : p.axisX;
  var ay = p.axisY === undefined ? 1 : p.axisY;
  var az = p.axisZ === undefined ? 0 : p.axisZ;
  var l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  f.ax[i] = ax / l; f.ay[i] = ay / l; f.az[i] = az / l;
  f.age[i] = 0;
  f.life[i] = p.life || 0.3;
  f.size[i] = p.size || 0.02;
  f.spin[i] = p.spin || 0;
  f.r[i] = p.r === undefined ? 1 : p.r;
  f.g[i] = p.g === undefined ? 1 : p.g;
  f.b[i] = p.b === undefined ? 1 : p.b;
  f.rest[i] = 0;
  return i;
}

function moveSlot(f, from, to) {
  for (var k in f) {
    var arr = f[k];
    if (arr instanceof Float32Array) arr[to] = arr[from];
  }
}

// Integrates every particle by dt seconds. Gravity pulls down, the
// floor stops things (with a bounce, then rest), dead particles are
// removed by moving the last one into their slot so live ones stay
// contiguous for drawing.
export function stepField(f, dt, opts) {
  var gravity = opts && opts.gravity !== undefined ? opts.gravity : 9.8;
  var floorY = opts && opts.floorY !== undefined ? opts.floorY : 0;
  var bounce = opts && opts.bounce !== undefined ? opts.bounce : 0.3;
  var drag = opts && opts.drag !== undefined ? opts.drag : 0;
  var i = 0;
  while (i < f.count) {
    f.age[i] += dt;
    if (f.age[i] >= f.life[i]) {
      f.count--;
      if (i !== f.count) moveSlot(f, f.count, i);
      continue;
    }
    if (!f.rest[i]) {
      if (drag) {
        var k = Math.exp(-drag * dt);
        f.vx[i] *= k; f.vy[i] *= k; f.vz[i] *= k;
      }
      f.vy[i] -= gravity * dt;
      f.px[i] += f.vx[i] * dt;
      f.py[i] += f.vy[i] * dt;
      f.pz[i] += f.vz[i] * dt;
      var floor = floorY + f.size[i] * 0.5;
      if (f.py[i] < floor) {
        f.py[i] = floor;
        if (Math.abs(f.vy[i]) < 0.6) {
          f.rest[i] = 1; // settled: stop integrating it
          f.vx[i] = f.vy[i] = f.vz[i] = 0;
          f.spin[i] = 0;
        } else {
          f.vy[i] = -f.vy[i] * bounce;
          f.vx[i] *= 0.6; f.vz[i] *= 0.6;
          f.spin[i] *= 0.5;
        }
      }
    }
    i++;
  }
}

// ---------- tracers (pure) ----------

export function createTracers(max) {
  return { max: max, count: 0, items: [] };
}

export function addTracer(t, from, to, life, color) {
  var item = { ax: from.x, ay: from.y, az: from.z, bx: to.x, by: to.y, bz: to.z, age: 0, life: life || 0.08, r: color.r, g: color.g, b: color.b };
  if (t.items.length >= t.max) t.items.shift(); // oldest tracer is the least visible one
  t.items.push(item);
}

export function stepTracers(t, dt) {
  for (var i = t.items.length - 1; i >= 0; i--) {
    t.items[i].age += dt;
    if (t.items[i].age >= t.items[i].life) t.items.splice(i, 1);
  }
}

// ---------- the A-Frame system ----------

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['action-effects']) {
  var THREE = AFRAME.THREE;

  // How each field draws. `shrink` is how size follows age: 'fade' gets
  // smaller over its whole life; 'late' holds size, then shrinks over
  // the last 30%; 'grow' swells (a flash).
  var FIELDS = {
    sparks: { max: 400, geometry: function () { return new THREE.BoxGeometry(1, 1, 1); }, additive: true, shrink: 'fade', gravity: 6, drag: 2.5, bounce: 0.25 },
    shards: { max: 600, geometry: function () { return new THREE.TetrahedronGeometry(0.7); }, additive: false, shrink: 'late', gravity: 9.8, drag: 0.3, bounce: 0.35 },
    flashes: { max: 32, geometry: function () { return new THREE.OctahedronGeometry(0.5); }, additive: true, shrink: 'grow', gravity: 0, drag: 0, bounce: 0 },
  };

  function scaleFor(mode, t) {
    if (mode === 'fade') return 1 - t;
    if (mode === 'late') return t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    if (mode === 'grow') return 0.6 + t * 0.8;
    return 1;
  }

  AFRAME.registerSystem('action-effects', {
    init: function () {
      this.color = new THREE.Color();
      this.matrix = new THREE.Matrix4();
      this.quat = new THREE.Quaternion();
      this.axis = new THREE.Vector3();
      this.pos = new THREE.Vector3();
      this.scl = new THREE.Vector3();
      this.fields = {};
      this.meshes = {};
      Object.keys(FIELDS).forEach(function (name) {
        var spec = FIELDS[name];
        var field = createField(spec.max);
        var material = spec.additive
          ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
          : new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
        var mesh = new THREE.InstancedMesh(spec.geometry(), material, spec.max);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setColorAt(0, this.color.set('#ffffff'));
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.name = 'effects-' + name;
        this.el.object3D.add(mesh);
        this.fields[name] = field;
        this.meshes[name] = mesh;
      }, this);

      this.tracers = createTracers(96);
      var tracerPositions = new Float32Array(96 * 2 * 3);
      var tracerColors = new Float32Array(96 * 2 * 3);
      this.tracerGeometry = new THREE.BufferGeometry();
      this.tracerPosAttr = new THREE.BufferAttribute(tracerPositions, 3).setUsage(THREE.DynamicDrawUsage);
      this.tracerColAttr = new THREE.BufferAttribute(tracerColors, 3).setUsage(THREE.DynamicDrawUsage);
      this.tracerGeometry.setAttribute('position', this.tracerPosAttr);
      this.tracerGeometry.setAttribute('color', this.tracerColAttr);
      this.tracerGeometry.setDrawRange(0, 0);
      this.tracerLines = new THREE.LineSegments(this.tracerGeometry, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.tracerLines.frustumCulled = false;
      this.tracerLines.name = 'effects-tracers';
      this.el.object3D.add(this.tracerLines);
    },

    rgb: function (color) {
      this.color.set(color || '#ffffff');
      return { r: this.color.r, g: this.color.g, b: this.color.b };
    },

    // A burst of hot specks off a surface, mostly along its normal.
    sparks: function (point, normal, opts) {
      opts = opts || {};
      var c = this.rgb(opts.color || '#ffd27a');
      var n = normal || { x: 0, y: 1, z: 0 };
      var count = opts.count || 8;
      var speed = opts.speed || 3;
      for (var i = 0; i < count; i++) {
        var rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
        var s = speed * (0.4 + Math.random() * 0.8);
        emitParticle(this.fields.sparks, {
          x: point.x, y: point.y, z: point.z,
          vx: (n.x + rx * 0.7) * s, vy: (n.y + ry * 0.7) * s, vz: (n.z + rz * 0.7) * s,
          life: 0.18 + Math.random() * 0.22, size: (opts.size || 0.012) * (0.7 + Math.random() * 0.6),
          r: c.r, g: c.g, b: c.b,
        });
      }
    },

    // A body breaking into tumbling pieces: the Superhot death. Pieces
    // spread from `center` within `radius`, inherit `velocity`, fly
    // apart at `burst` m/s, bounce, settle and shrink away.
    shatter: function (center, opts) {
      opts = opts || {};
      var c = this.rgb(opts.color || '#e8e8f0');
      var count = opts.count || 24;
      var radius = opts.radius || 0.25;
      var burst = opts.burst === undefined ? 1.6 : opts.burst;
      var v = opts.velocity || { x: 0, y: 0, z: 0 };
      var spread = opts.spread || { x: 1, y: 1, z: 1 };
      for (var i = 0; i < count; i++) {
        var dx = (Math.random() * 2 - 1), dy = (Math.random() * 2 - 1), dz = (Math.random() * 2 - 1);
        var shade = 0.75 + Math.random() * 0.25;
        emitParticle(this.fields.shards, {
          x: center.x + dx * radius * spread.x, y: center.y + dy * radius * spread.y, z: center.z + dz * radius * spread.z,
          vx: v.x + dx * burst, vy: v.y + dy * burst + burst * 0.5, vz: v.z + dz * burst,
          axisX: Math.random() - 0.5, axisY: Math.random() - 0.5, axisZ: Math.random() - 0.5,
          spin: 4 + Math.random() * 10,
          life: (opts.life || 2.2) * (0.8 + Math.random() * 0.4),
          size: (opts.size || 0.07) * (0.6 + Math.random() * 0.8),
          r: c.r * shade, g: c.g * shade, b: c.b * shade,
        });
      }
    },

    // A muzzle flash: a short-lived additive star a little in front of
    // the muzzle.
    flash: function (point, direction, opts) {
      opts = opts || {};
      var c = this.rgb(opts.color || '#ffe2a0');
      var d = direction || { x: 0, y: 0, z: -1 };
      var size = opts.size || 0.08;
      emitParticle(this.fields.flashes, {
        x: point.x + d.x * size * 0.5, y: point.y + d.y * size * 0.5, z: point.z + d.z * size * 0.5,
        axisX: d.x, axisY: d.y, axisZ: d.z, spin: 20,
        life: opts.life || 0.05, size: size, r: c.r, g: c.g, b: c.b,
      });
    },

    tracer: function (from, to, opts) {
      opts = opts || {};
      addTracer(this.tracers, from, to, opts.life || 0.07, this.rgb(opts.color || '#ffe9a8'));
    },

    // How many slots are live, for the HUD and for tests.
    stats: function () {
      return { sparks: this.fields.sparks.count, shards: this.fields.shards.count, flashes: this.fields.flashes.count, tracers: this.tracers.items.length };
    },

    tick: function () {
      var clock = this.el.systems['action-clock'];
      var dt = (clock ? clock.dt(null) : 16) / 1000;
      Object.keys(FIELDS).forEach(function (name) {
        var spec = FIELDS[name];
        var field = this.fields[name];
        if (!field.count && !this.meshes[name].count) return;
        stepField(field, dt, { gravity: spec.gravity, drag: spec.drag, bounce: spec.bounce, floorY: 0 });
        this.draw(name, spec);
      }, this);
      stepTracers(this.tracers, dt);
      this.drawTracers();
    },

    draw: function (name, spec) {
      var f = this.fields[name];
      var mesh = this.meshes[name];
      for (var i = 0; i < f.count; i++) {
        var t = f.age[i] / f.life[i];
        var s = Math.max(0.0001, f.size[i] * scaleFor(spec.shrink, t));
        this.axis.set(f.ax[i], f.ay[i], f.az[i]);
        this.quat.setFromAxisAngle(this.axis, f.spin[i] * f.age[i]);
        this.pos.set(f.px[i], f.py[i], f.pz[i]);
        this.scl.set(s, s, s);
        this.matrix.compose(this.pos, this.quat, this.scl);
        mesh.setMatrixAt(i, this.matrix);
        this.color.setRGB(f.r[i], f.g[i], f.b[i]);
        mesh.setColorAt(i, this.color);
      }
      mesh.count = f.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    drawTracers: function () {
      var items = this.tracers.items;
      var pos = this.tracerPosAttr.array;
      var col = this.tracerColAttr.array;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var fade = 1 - it.age / it.life;
        var o = i * 6;
        pos[o] = it.ax; pos[o + 1] = it.ay; pos[o + 2] = it.az;
        pos[o + 3] = it.bx; pos[o + 4] = it.by; pos[o + 5] = it.bz;
        // The muzzle end fades first, so the tracer reads as travelling.
        col[o] = it.r * fade * fade; col[o + 1] = it.g * fade * fade; col[o + 2] = it.b * fade * fade;
        col[o + 3] = it.r * fade; col[o + 4] = it.g * fade; col[o + 5] = it.b * fade;
      }
      this.tracerGeometry.setDrawRange(0, items.length * 2);
      this.tracerPosAttr.needsUpdate = true;
      this.tracerColAttr.needsUpdate = true;
    },
  });
}
