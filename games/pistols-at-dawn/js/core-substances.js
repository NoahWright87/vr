      // ==============================================================
      // CORE: substances
      // The liquid/fire system's one-shot mutation API (spillPuddle,
      // ignitePool, dousePool/douseFires, the pool math, spawnDroplet)
      // plus the components that hang the liquid system off an object:
      // pourable (a bottle), breakable (comes apart when hit hard
      // enough), and ignition-source/lightable/burnable (the fuse
      // contract). Split out of game.js — see DESIGN.md's "File
      // structure" section. The LIQUIDS/POOLS/HOT_POINTS data itself
      // and the FIRE_*/POOL_*/WATER_* tuning constants stay in
      // game.js: world-systems' own per-frame tick is what actually
      // drives the simulation, and is by far their biggest reader.
      // ==============================================================

      // One shared point light, moved to whichever fire is biggest.
      // Real per-fire lights would mean a material recompile and
      // per-fragment cost each; one light that follows the action buys
      // the flicker on the bar for the price of one. Added as a raw
      // three.js light rather than an <a-light>, because adding an
      // A-Frame light makes it tear out the scene's default rig.
      var fireLight = null;

      function ensureFireLight(sceneEl) {
        if (fireLight) return fireLight;
        fireLight = new THREE.PointLight(FIRE_LIGHT_COLOR, 0, FIRE_LIGHT_RANGE);
        sceneEl.object3D.add(fireLight);
        return fireLight;
      }

      // ---------------------------------------------------------------
      // Droplets
      // ---------------------------------------------------------------
      function spawnDroplet(worldPos, velocity, type) {
        type = LIQUIDS[type] ? type : 'beer';
        var liquid = LIQUIDS[type];
        var scale = liquid.dropRadius * (0.7 + Math.random() * 0.6);

        // Dispersion is seeded once, at birth, as a fixed sideways
        // nudge. Applying it as per-frame noise instead makes a random
        // walk that averages back to zero — measured, that was five
        // millimetres of spread over a whole fall. A stream is a cone
        // because each drop leaves on a slightly different heading.
        var vel = velocity.clone();
        if (liquid.dispersion) {
          vel.x += (Math.random() - 0.5) * liquid.dispersion;
          vel.z += (Math.random() - 0.5) * liquid.dispersion;
        }

        return addParticle('sphere', worldPos, liquid.dropColor, scale, {
          kind: 'liquid',
          liquid: type,
          vel: vel,
          angVel: null,
          life: liquid.isFire ? FIRE_DROPLET_LIFETIME_MS : DROPLET_LIFETIME_MS,
          opacity: liquid.isFire ? 0.9 : 0.85,
          restY: 0.01,
          phase: Math.random() * 100,
        });
      }

      // ---------------------------------------------------------------
      // Pools
      // ---------------------------------------------------------------
      function acquirePoolEl() {
        var el = POOL_POOL.pop();
        if (el) {
          el.object3D.visible = true;
          return el;
        }

        el = document.createElement('a-entity');

        var disc = document.createElement('a-circle');
        disc.setAttribute('radius', 1);
        disc.setAttribute('rotation', '-90 0 0');
        disc.setAttribute('material', 'shader: flat; transparent: true; opacity: 0.55; depthWrite: false; side: double');
        disc.classList.add('pool-disc');
        el.appendChild(disc);

        // The steady flame every burning pool keeps, on top of the
        // droplets it throws. Without it a fire reads as popcorn; with
        // it, the jumping droplets are tongues coming off something
        // solid. Set FIRE_JUMP_RATE to 0 and only this remains.
        var flame = document.createElement('a-entity');
        flame.classList.add('pool-flame');
        flame.setAttribute('visible', false);

        var outer = document.createElement('a-sphere');
        outer.setAttribute('radius', 1);
        outer.setAttribute('material', 'color: #ff6a1a; shader: flat; transparent: true; opacity: 0.72; depthWrite: false');
        flame.appendChild(outer);

        var inner = document.createElement('a-sphere');
        inner.setAttribute('radius', 0.55);
        inner.setAttribute('material', 'color: #ffd84a; shader: flat; transparent: true; opacity: 0.9; depthWrite: false');
        flame.appendChild(inner);

        el.appendChild(flame);
        document.querySelector('a-scene').appendChild(el);
        return el;
      }

      function releasePool(index) {
        var pool = POOLS[index];
        pool.el.object3D.visible = false;
        POOL_POOL.push(pool.el);
        POOLS.splice(index, 1);
      }

      // ==============================================================
      // HOW MUCH LIQUID IS IN A PUDDLE
      // Area, not radius. A puddle twice as wide holds four times the
      // beer, so everything that adds or removes liquid has to do it in
      // those terms: a drop adds a drop's worth of AREA. Getting this
      // wrong stops being subtle once puddles have no maximum size —
      // adding radius per drop turned two seconds of pouring into a
      // metre-and-a-half lake.
      //
      // Amounts are still quoted as radii, because "a drop is 11mm" is
      // easier to reason about than "a drop is 0.00038 square metres".
      // ==============================================================
      function poolArea(radius) {
        return Math.PI * radius * radius;
      }

      function poolRadiusFor(area) {
        return Math.sqrt(Math.max(area, 0) / Math.PI);
      }

      function growPool(pool, amount, times) {
        pool.radius = poolRadiusFor(poolArea(pool.radius) + poolArea(amount) * (times === undefined ? 1 : times));
      }

      function shrinkPool(pool, amount) {
        pool.radius = poolRadiusFor(poolArea(pool.radius) - poolArea(amount));
      }

      // Liquid arriving on a surface. Joins whatever compatible pool is
      // already there, or starts a new one. Merging is what keeps the
      // count in the dozens however much you spill — and it's also why
      // fire spreads as a growing patch rather than a scattering of
      // separate flames.
      function addToPool(worldPos, surfaceY, type, amount) {
        for (var i = 0; i < POOLS.length; i++) {
          var pool = POOLS[i];
          if (Math.abs(pool.y - surfaceY) > 0.06) continue; // the bar and the floor are different places
          var dx = pool.x - worldPos.x;
          var dz = pool.z - worldPos.z;
          var reach = pool.radius + POOL_ABSORB_SKIN;
          if (dx * dx + dz * dz > reach * reach) continue;

          // Fire landing in beer converts the whole spill to fuel; beer
          // landing in fire just feeds it. Either way one pool, not two
          // overlapping ones arguing about which is on top.
          if (pool.type !== type) {
            if (!mixPools(pool, type, amount)) continue;
            return pool;
          }

          growPool(pool, amount);
          pool.age = 0;
          // Creeps toward whatever is feeding it, so a moving pour
          // draws a trail instead of growing one blob.
          pool.x += (worldPos.x - pool.x) * 0.12;
          pool.z += (worldPos.z - pool.z) * 0.12;
          return pool;
        }

        // Out of puddles. The liquid does NOT disappear: it joins
        // whichever puddle is nearest, however far that is. A spill
        // arriving in slightly the wrong place is a small lie; a spill
        // arriving nowhere is a bucket of beer the game quietly threw
        // away, and that used to be what happened.
        if (POOLS.length >= MAX_POOLS) {
          var nearest = null;
          var nearestDist = Infinity;
          for (var n = 0; n < POOLS.length; n++) {
            if (POOLS[n].type !== type) continue;
            var ndx = POOLS[n].x - worldPos.x;
            var ndz = POOLS[n].z - worldPos.z;
            var nd = ndx * ndx + ndz * ndz;
            if (nd >= nearestDist) continue;
            nearest = POOLS[n];
            nearestDist = nd;
          }
          if (!nearest) return null;
          growPool(nearest, amount);
          nearest.age = 0;
          return nearest;
        }

        var el = acquirePoolEl();
        var created = {
          el: el,
          disc: el.querySelector('.pool-disc'),
          flame: el.querySelector('.pool-flame'),
          x: worldPos.x,
          y: surfaceY,
          z: worldPos.z,
          radius: poolRadiusFor(poolArea(LIQUIDS[type].startRadius || POOL_START_RADIUS) + poolArea(amount)),
          type: type,
          age: 0,
          dousedUntil: 0,
          jumpTimer: 0,
          phase: Math.random() * 100,
          needsColor: true,
        };
        POOLS.push(created);
        return created;
      }

      // What happens when one liquid lands in a pool of another. Kept
      // in one place so the interactions are legible rather than
      // scattered through the update loop.
      function mixPools(pool, incomingType, amount) {
        var incoming = LIQUIDS[incomingType];
        var existing = LIQUIDS[pool.type];

        // Fire meeting something flammable: the spill becomes fuel.
        if (incoming.isFire && existing.flammable) {
          if (pool.dousedUntil > 0) return false;
          ignitePool(pool);
          return true;
        }

        // Something flammable poured onto fire: more fuel.
        if (existing.isFire && incoming.flammable) {
          growPool(pool, amount, incoming.fuelMultiplier);
          return true;
        }

        // Water on fire: puts it out and leaves the scorch behind.
        if (incoming.douses && existing.isFire) {
          dousePool(pool);
          return true;
        }

        // Fire meeting water, or anything meeting a scorch mark: the
        // arrival simply doesn't stick.
        if (incoming.isFire && (existing.douses || existing.inert)) return true;
        if (existing.inert) {
          pool.type = incomingType;
          pool.needsColor = true;
          pool.age = 0;
          return true;
        }

        return false;
      }

      function ignitePool(pool) {
        if (LIQUIDS[pool.type].isFire || pool.dousedUntil > 0) return;
        if (!LIQUIDS[pool.type].flammable) return;

        pool.radius = poolRadiusFor(poolArea(pool.radius) * LIQUIDS[pool.type].fuelMultiplier);
        pool.type = 'fire';
        pool.needsColor = true;
        pool.age = 0;
        spawnSparks(poolPosition(pool, _poolScratch), 6);
      }

      function dousePool(pool) {
        if (!LIQUIDS[pool.type].isFire) return;
        pool.type = 'scorch';
        pool.needsColor = true;
        pool.dousedUntil = POOL_RELIGHT_DELAY_MS;
        pool.age = 0;
        if (pool.flame) pool.flame.setAttribute('visible', false);
        spawnSmoke(poolPosition(pool, _poolScratch), null, 0.7);
      }

      var _poolScratch = new THREE.Vector3();

      function poolPosition(pool, out) {
        return out.set(pool.x, pool.y, pool.z);
      }

      // Which surface is under a point — the bar top if you're over it,
      // the floor otherwise. Shared by anything that needs to know
      // where liquid would land.
      function surfaceUnder(worldPos) {
        var best = 0;
        for (var i = 0; i < HARD_SURFACES.length; i++) {
          var s = HARD_SURFACES[i];
          if (s.y <= best || s.y > worldPos.y + 0.02) continue;
          if (!overSurface(s, worldPos)) continue;
          best = s.y;
        }
        return best;
      }

      // Used by anything that spills without pouring — a bottle
      // smashing, a flame landing.
      function spillPuddle(worldPos, type, amount) {
        return addToPool(worldPos, surfaceUnder(worldPos), type, amount);
      }

      // The nearest burning thing, for anything that wants to know if
      // it's standing in a fire (see burnable).
      function nearestFire(worldPos, maxDistance) {
        var bestDist = maxDistance;
        var best = null;

        for (var i = 0; i < POOLS.length; i++) {
          if (!LIQUIDS[POOLS[i].type].isFire) continue;
          var d = poolPosition(POOLS[i], _poolScratch).distanceTo(worldPos);
          if (d - POOLS[i].radius < bestDist) {
            bestDist = Math.max(d - POOLS[i].radius, 0);
            best = POOLS[i];
          }
        }

        return best;
      }

      // Water's whole job, and the jug's reason to exist. Puts out both
      // the flames in the air and the ground burning underneath them —
      // dousing only the flame meant the spill relit itself the next
      // frame, which is realistic and infuriating.
      function douseFires(worldPos, radius, amount) {
        var doused = false;

        for (var i = 0; i < POOLS.length; i++) {
          var pool = POOLS[i];
          if (!LIQUIDS[pool.type].isFire) continue;
          var dx = pool.x - worldPos.x;
          var dz = pool.z - worldPos.z;
          var reach = radius + pool.radius;
          if (dx * dx + dz * dz > reach * reach) continue;

          pool.radius -= amount;
          if (pool.radius <= 0.02) dousePool(pool);
          doused = true;
        }

        // Flames in mid-air are put out too, otherwise a thrown jug
        // leaves the sparks it was aimed at still hanging there.
        for (var j = 0; j < PARTICLES.length; j++) {
          var p = PARTICLES[j];
          if (p.dead || p.kind !== 'liquid' || p.liquid !== 'fire') continue;
          if (p.el.object3D.position.distanceTo(worldPos) > radius) continue;
          killParticle(p);
          doused = true;
        }

        return doused;
      }

      // Fire's party trick, and the reason it's a liquid at all: a
      // burning patch spits flame back into the air. Bigger patch means
      // more often, higher and larger, so a big spill looks like a
      // proper blaze rather than a scaled-up candle — and since those
      // droplets land somewhere slightly else, this IS how fire
      // spreads.
      function jumpFlame(pool) {
        var strength = Math.min(pool.radius / POOL_REFERENCE_RADIUS, 1);
        var spread = pool.radius * 0.8;

        _poolScratch.set(
          pool.x + (Math.random() - 0.5) * spread,
          pool.y + 0.02,
          pool.z + (Math.random() - 0.5) * spread
        );

        var up = FIRE_JUMP_SPEED_MIN + (FIRE_JUMP_SPEED_MAX - FIRE_JUMP_SPEED_MIN) * strength;
        var velocity = new THREE.Vector3(
          (Math.random() - 0.5) * FIRE_JUMP_SPREAD,
          up * (0.7 + Math.random() * 0.6),
          (Math.random() - 0.5) * FIRE_JUMP_SPREAD
        );

        // A jump costs the pool more fuel than the landing gives back,
        // so a fire always runs down. Spread comes from a flame landing
        // on something ELSE that will burn, never from fire creating
        // its own fuel.
        shrinkPool(pool, FIRE_JUMP_COST);

        var droplet = spawnDroplet(_poolScratch, velocity, 'fire');
        if (droplet) droplet.baseScale *= 0.7 + strength * 0.8;
        return droplet;
      }
      // ==============================================================
      // COMPONENT: pourable
      // Anything with liquid in it, which is now a beer bottle and a
      // water jug. Same relationship to holsterable that firearm has:
      // it reads state, owns a little of its own (capped or not), and
      // knows nothing about hands, slots, or throwing.
      //
      // What the liquid DOES isn't here either — the droplets it emits
      // carry their kind, and the world decides what beer and water
      // mean when they land on you, on the floor, or on a fire. That's
      // why a jug of water needed no new pouring code, only a
      // different word in its markup.
      //
      // Two physical moves, no buttons:
      //   - Knock the CAP against something solid — the edge of the
      //     bar, the floor — and it pops off and spins away. The check
      //     is a crossing of the cap's own collider through a surface
      //     (see findHardSurfaceStrike), not proximity, and it's
      //     suppressed for a moment after a grab; the first version
      //     tested the whole bottle and opened every beer the instant
      //     you picked it up, because the snap-into-hand blend counts
      //     as a fast downward move while the base is still at counter
      //     height.
      //   - Tip an open one past horizontal and it pours, forever, at
      //     a rate set by how far over it is. Drinking isn't a
      //     separate mechanic: the droplets are real particles, and
      //     world-systems swallows any that reach your mouth.
      // ==============================================================
      registerComponent('pourable', {
        schema: {
          liquid: { type: 'string', default: 'beer' }, // 'beer' burns and gets you drunk; 'water' puts fires out
          capped: { type: 'boolean', default: true }, // a jug has no cap to knock off
        },

        init: function () {
          this.capped = this.data.capped;
          this.pourAccumulator = 0; // fractional droplets carried between frames

          this.capEl = this.el.querySelector('.bottle-cap');
          this.spoutEl = this.el.querySelector('.spout');

          this._capWorld = new THREE.Vector3();
          this._prevCapWorld = new THREE.Vector3();
          this._spoutWorld = new THREE.Vector3();
          this._prevSpoutWorld = new THREE.Vector3();
          this._neck = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._vel = new THREE.Vector3();
          this._dropVel = new THREE.Vector3();
          this._jitter = new THREE.Vector3();
          this._hasPrev = false;

          this.onShattered = this.onShattered.bind(this);
          this.el.addEventListener('shattered', this.onShattered);
        },

        remove: function () {
          this.el.removeEventListener('shattered', this.onShattered);
        },

        tick: function (time, dt) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          if (dtSeconds <= 0) return;

          if (this.capped) {
            this.updateCap(holsterable, dtSeconds);
            return;
          }

          // Only pours while it's in play. A bottle you set down or
          // dropped stops, which is a small lie — a tipped-over open
          // bottle really ought to keep spilling — but an unattended
          // one pouring forever would quietly evict every other
          // particle in the shared pool.
          if (holsterable.state === 'held' || holsterable.state === 'dangling' || holsterable.state === 'falling') {
            this.updatePour(holsterable, dtSeconds);
          } else {
            this.pourAccumulator = 0;
            this._hasPrev = false;
          }
        },

        // The trigger is the lid button. A Zippo already worked this
        // way, so a bottle cap and (see hatch) a tank hatch now do too:
        // whatever you're holding, the trigger opens it.
        onTriggerUse: function () {
          if (this.capped) this.popCap();
        },

        updateCap: function (holsterable, dtSeconds) {
          if (!this.capEl) return;

          this.capEl.object3D.getWorldPosition(this._capWorld);
          var hadPrev = this._hasPrev;
          var fallSpeed = hadPrev ? (this._prevCapWorld.y - this._capWorld.y) / dtSeconds : 0;
          var prev = this._prevCapWorld.clone();
          this._prevCapWorld.copy(this._capWorld);
          this._hasPrev = true;

          if (holsterable.state !== 'held') return;
          if (!hadPrev) return;
          // A snap blend is the game moving the bottle, not you
          // swinging it, and it's fast enough to read as a strike.
          if (holsterable._heldElapsed < BOTTLE_STRIKE_GRACE_MS) return;

          if (findHardSurfaceStrike(prev, this._capWorld, fallSpeed, CAP_HITBOX_RADIUS)) this.popCap();
        },

        popCap: function () {
          if (!this.capped) return;
          this.capped = false;
          this._hasPrev = false; // the pour tracks the spout, not the cap — start it clean

          this.capEl.object3D.getWorldPosition(this._capWorld);
          this.capEl.setAttribute('visible', false);

          spawnDebris(this._capWorld, { count: 1, color: '#c9a227', size: 0.03, speed: 3.2, life: 2200 });
          spawnSparks(this._capWorld, 4);
          playClink();
        },

        // Pouring. The neck's world direction is the whole input: at
        // horizontal nothing comes out, and the further past that it
        // tips the faster it runs, up to a full stream when it's
        // straight upside down. Droplets inherit the bottle's own
        // motion, so swinging an open bottle around throws an arc of
        // beer across the room, which is the correct behavior.
        updatePour: function (holsterable, dtSeconds) {
          if (!this.spoutEl) return;

          this.spoutEl.object3D.getWorldPosition(this._spoutWorld);
          if (this._hasPrev) {
            this._vel.copy(this._spoutWorld).sub(this._prevSpoutWorld).divideScalar(dtSeconds);
          } else {
            this._vel.set(0, 0, 0);
          }
          this._prevSpoutWorld.copy(this._spoutWorld);
          this._hasPrev = true;

          // Local +Y runs up the neck; -y of that in world space is
          // how far past horizontal it's tipped.
          this.el.object3D.getWorldQuaternion(this._quat);
          this._neck.set(0, 1, 0).applyQuaternion(this._quat);

          var tilt = -this._neck.y;
          if (tilt <= POUR_TILT_START) {
            this.pourAccumulator = 0;
            return;
          }

          var rate = POUR_RATE_MAX * Math.min((tilt - POUR_TILT_START) / (1 - POUR_TILT_START), 1);
          this.pourAccumulator += rate * dtSeconds;

          var count = Math.floor(this.pourAccumulator);
          this.pourAccumulator -= count;

          for (var k = 0; k < count; k++) {
            this._dropVel
              .copy(this._vel)
              .addScaledVector(this._neck, POUR_SPEED)
              .add(this._jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.05));

            // Several droplets in one frame were all emitted at
            // different moments during it, so they're advanced along
            // their own paths by however long ago that was. Without
            // this they stack up at the spout and a long frame turns
            // the stream into a string of blobs.
            var age = count > 1 ? (dtSeconds * k) / count : 0;
            this._jitter.copy(this._spoutWorld).addScaledVector(this._dropVel, age);
            this._jitter.y -= 0.5 * GRAVITY * age * age;
            spawnDroplet(this._jitter, this._dropVel, this.data.liquid);
          }
        },

        // A smashed bottle doesn't just make glass: it puts its
        // contents on the floor. That's the missing half of the
        // Molotov — throw a beer into a lit puddle and the spill it
        // leaves is already touching flame.
        onShattered: function (evt) {
          var point = (evt.detail && evt.detail.point) || this._spoutWorld;
          spillPuddle(point, this.data.liquid, POOL_SPILL_RADIUS);
        },

        // Called by breakable when a shattered bottle comes back as a
        // fresh one — a respawned beer is a capped beer.
        recap: function () {
          this.capped = this.data.capped;
          if (this.capEl) this.capEl.setAttribute('visible', true);
          this._hasPrev = false;
        },
      });
      // ==============================================================
      // COMPONENT: breakable
      // Generic "this comes apart when something hits it hard enough."
      // It listens for the same "shot" event a scoring ring does, plus
      // the "landed" event holsterable emits when something it was
      // simulating hits the ground — so a bottle you shoot out of the
      // air and a bottle you simply throw at the floor both shatter,
      // through two completely different code paths that neither know
      // about bottles.
      //
      // Nothing is destroyed permanently: the entity hides, stops
      // being grabbable/shootable, and comes back on its home slot
      // after respawnMs, the same way a knocked-down target stands
      // back up. That's what keeps the bar stocked while you work
      // through it.
      //
      // autoShatter:false turns off both event triggers and leaves
      // only the explicit shatter() call, which is how a cigar reuses
      // the whole hide/respawn/pop-back-in cycle for burning down to a
      // stub without also exploding every time you shoot it or drop
      // it — it has its own opinions about both of those.
      // ==============================================================
      registerComponent('breakable', {
        schema: {
          color: { type: 'color', default: '#3f6b3a' },
          shards: { type: 'number', default: SHARD_COUNT },
          respawnMs: { type: 'number', default: BOTTLE_RESPAWN_MS },
          score: { type: 'number', default: 25 },
          label: { type: 'string', default: 'BOTTLE' },
          impactSpeed: { type: 'number', default: 3.5 }, // m/s of landing that counts as "dropped hard enough"
          autoShatter: { type: 'boolean', default: true },
          sound: { type: 'boolean', default: true },
        },

        init: function () {
          this.broken = false;
          this.respawnTimer = 0;
          this.popTimer = 0;
          this._world = new THREE.Vector3();

          this.onShot = this.onShot.bind(this);
          this.onLanded = this.onLanded.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
          this.el.addEventListener('landed', this.onLanded);
          // Hitting something on the way down is the same event as
          // hitting the floor, as far as glass is concerned — which is
          // what makes a bottle hurled at a target smash against it
          // instead of sailing through and breaking on the ground
          // behind.
          this.el.addEventListener('impact', this.onLanded);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
          this.el.removeEventListener('landed', this.onLanded);
          this.el.removeEventListener('impact', this.onLanded);
        },

        onShot: function () {
          if (this.data.autoShatter) this.shatter(true);
        },

        onLanded: function (evt) {
          if (!this.data.autoShatter) return;
          if (evt.detail && evt.detail.speed >= this.data.impactSpeed) this.shatter(false);
        },

        tick: function (time, dt) {
          if (this.popTimer > 0) {
            this.popTimer = Math.max(this.popTimer - (dt || 16), 0);
            var t = 1 - this.popTimer / 260;
            this.el.object3D.scale.setScalar(0.35 + 0.65 * t * (2 - t)); // ease-out toward full size
            return;
          }

          if (!this.broken) return;
          this.respawnTimer -= dt || 16;
          if (this.respawnTimer <= 0) this.respawn();
        },

        shatter: function (scored) {
          if (this.broken) return;
          this.broken = true;
          this.respawnTimer = this.data.respawnMs;

          this.el.object3D.getWorldPosition(this._world);
          spawnDebris(this._world, { count: this.data.shards, color: this.data.color, size: SHARD_SIZE });
          spawnDebris(this._world, { count: 4, color: '#e8e4d8', size: SHARD_SIZE * 0.7, speed: SHARD_SPEED * 1.3 });
          if (this.data.sound) playSmash();

          var holsterable = this.el.components.holsterable;
          if (holsterable) {
            // Prised out of whatever was holding it, without going
            // through a normal release — a bottle that explodes in
            // your fist doesn't get holstered or thrown.
            if (holsterable.hand) {
              var handRig = holsterable.hand.components['hand-rig'];
              if (handRig) handRig.forget(this.el);
            }
            holsterable.vacateSlot();
            holsterable.hand = null;
            holsterable.state = 'broken';
            holsterable.angularVelocity.set(0, 0, 0);
            holsterable.fallVelocity.set(0, 0, 0);
            this.el.sceneEl.object3D.attach(this.el.object3D);
          }

          this.el.object3D.visible = false;
          this.el.classList.remove('shootable');
          this.el.classList.remove('grabbable');

          // Announced rather than acted on, the same way holsterable
          // emits "landed": breakable has no idea some things are full
          // of liquid.
          this.el.emit('shattered', { point: this._world.clone() }, false);

          if (scored) {
            var manager = document.querySelector('#range-manager');
            if (manager) {
              manager.emit('ring-hit', { score: this.data.score, label: this.data.label }, false);
            }
          }
        },

        respawn: function () {
          var holsterable = this.el.components.holsterable;
          var homeSlot = holsterable && holsterable.data.holsterSelector;
          var slotComp = homeSlot && homeSlot.components['anchor-slot'];

          // Somebody parked something else in its spot; wait it out
          // rather than double-stacking or popping in mid-air.
          if (slotComp && slotComp.isFull()) {
            this.respawnTimer = this.data.respawnMs;
            return;
          }

          this.broken = false;
          this.el.classList.add('shootable');
          this.el.classList.add('grabbable');
          this.el.object3D.visible = true;

          var pourable = this.el.components.pourable;
          if (pourable) pourable.recap();
          var burnable = this.el.components.burnable;
          if (burnable) burnable.restore();

          if (holsterable && homeSlot) {
            holsterable.state = 'holstered';
            // Placed instantly first, so the blend inside occupySlot
            // starts from the shelf instead of from wherever this
            // bottle happened to be standing when it was shot.
            holsterable.attachTo(homeSlot.object3D, holsterable.data.holsterPosition, holsterable.data.holsterRotation);
            holsterable.occupySlot(homeSlot);
          } else if (holsterable) {
            // Nothing declared a home for it — leave it where it broke,
            // as an ordinary pick-up-off-the-ground object.
            holsterable.state = 'resting';
          }

          this.popTimer = 260;
          this.el.object3D.scale.setScalar(0.35);
        },
      });
      // ==============================================================
      // COMPONENT: ignition-source / lightable
      // The smallest possible "one thing can set another thing on
      // fire" contract, deliberately split from anything that knows
      // what a cigar is. A source publishes a tip position and a
      // public `hot` flag that its owning component sets (a firearm
      // from barrel heat, a cigar from being lit); a lightable
      // publishes a tip position and fires an "ignite" event when a
      // hot tip touches it. world-systems does the matching.
      //
      // The payoff is that the ways to light a cigar were never
      // enumerated anywhere: off another lit cigar, off the barrel of
      // a gun you just emptied, or by shooting it (cigar's own "shot"
      // handler just calls ignite). Adding a lantern or a stick of
      // dynamite is two attributes.
      // ==============================================================
      registerComponent('ignition-source', {
        schema: {
          tipSelector: { type: 'string', default: '' }, // empty = the entity's own origin
        },

        init: function () {
          this.hot = false;
        },

        tipObject: function () {
          if (!this.data.tipSelector) return this.el.object3D;
          var tip = this.el.querySelector(this.data.tipSelector);
          return tip ? tip.object3D : this.el.object3D;
        },
      });

      registerComponent('lightable', {
        schema: {
          tipSelector: { type: 'string', default: '' },
        },

        init: function () {
          this.lit = false;
          // A public veto another component can raise: a Zippo with
          // the lid shut shouldn't catch light off a passing cigar.
          this.blocked = false;
        },

        tipObject: function () {
          if (!this.data.tipSelector) return this.el.object3D;
          var tip = this.el.querySelector(this.data.tipSelector);
          return tip ? tip.object3D : this.el.object3D;
        },

        ignite: function () {
          if (this.lit || this.blocked) return;
          this.lit = true;
          this.el.emit('ignite', null, false);
        },

        extinguish: function () {
          if (!this.lit) return;
          this.lit = false;
          this.el.emit('extinguish', null, false);
        },
      });
      // ==============================================================
      // COMPONENT: burnable
      // Anything that's consumed by being on fire. Owns how much is
      // left and how much of the tip has turned to ash; drives a
      // co-located visual component's layout(); and hands the object
      // over to breakable's hide-and-come-back-later cycle when
      // there's nothing left, rather than reimplementing that.
      //
      // Ash comes off two ways, both of them "you shook it":
      //   - a sharp flick of the wrist (see createFlickDetector), or
      //   - twirling it off your trigger finger, where the tip is
      //     whipping round fast enough that ash has no business
      //     staying on.
      // The second one exists because twirling a cigar is the single
      // most obvious thing to try and it did nothing — a spin has no
      // velocity reversal for a flick detector to notice, so it needs
      // asking about directly.
      //
      // burnMultiplier is a public field other components set: the
      // cigar cranks it while you're drawing on one.
      // ==============================================================
      registerComponent('burnable', {
        schema: {
          visual: { type: 'string', default: '' }, // co-located component exposing layout()/setEmber()
          length: { type: 'number', default: CIGAR_LENGTH },
          ashRate: { type: 'number', default: CIGAR_ASH_RATE }, // meters of tip per second
          minLength: { type: 'number', default: CIGAR_MIN_LENGTH },
          ashColor: { type: 'color', default: '#9c968c' },
          shakeSpeed: { type: 'number', default: CIGAR_SHAKE_SPEED },
          twirlRate: { type: 'number', default: CIGAR_TWIRL_ASH_RATE }, // rad/s of dangle spin that flings ash off
        },

        init: function () {
          this.length = this.data.length;
          this.ash = 0;
          this.burnMultiplier = 1;

          this.emberEl = this.el.querySelector('.ember');
          this._tip = new THREE.Vector3();
          this.flick = createFlickDetector(this.data.shakeSpeed, CIGAR_SHAKE_REVERSAL);

          this.onIgnite = this.onIgnite.bind(this);
          this.onExtinguish = this.onExtinguish.bind(this);
          this.el.addEventListener('ignite', this.onIgnite);
          this.el.addEventListener('extinguish', this.onExtinguish);
        },

        remove: function () {
          this.el.removeEventListener('ignite', this.onIgnite);
          this.el.removeEventListener('extinguish', this.onExtinguish);
        },

        isLit: function () {
          var lightable = this.el.components.lightable;
          return !!(lightable && lightable.lit);
        },

        onIgnite: function () {
          this.setEmber(true);
          this.tipWorldPosition(this._tip);
          spawnSparks(this._tip, 6);
        },

        onExtinguish: function () {
          this.setEmber(false);
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var lit = this.isLit();

          var source = this.el.components['ignition-source'];
          if (source) source.hot = lit;

          this.checkShake(dtSeconds);
          if (!lit) return;

          // Sitting in a flame burns it down far faster than smoking
          // it does. Asked of the fire list directly rather than
          // routed through ignition, since this is about being IN a
          // fire rather than being lit by one.
          this.tipWorldPosition(this._tip);
          var inFire = nearestFire(this._tip, FIRE_ASH_RADIUS) ? FIRE_ASH_MULTIPLIER : 1;

          var rate = this.data.ashRate * this.burnMultiplier * inFire;
          this.ash = Math.min(this.ash + rate * dtSeconds, this.length);
          this.applyLayout();

          // Never tapped, so it burnt all the way down. Note this is
          // the slow way to lose one — knocking the ash off is what
          // actually shortens it.
          if (this.length - this.ash <= 0.003) this.burnOut();
        },

        checkShake: function (dtSeconds) {
          if (this.ash <= 0.0005) {
            this.tipWorldPosition(this._tip);
            this.flick.update(this._tip, dtSeconds);
            return;
          }

          var holsterable = this.el.components.holsterable;
          if (
            holsterable &&
            holsterable.state === 'dangling' &&
            holsterable.angularVelocity.length() > this.data.twirlRate
          ) {
            this.dropAsh();
            return;
          }

          this.tipWorldPosition(this._tip);
          if (this.flick.update(this._tip, dtSeconds)) this.dropAsh();
        },

        // The ash breaks off and it's that much shorter for good.
        dropAsh: function () {
          var lost = this.ash;
          this.ash = 0;
          this.length = Math.max(this.length - lost, 0);

          this.tipWorldPosition(this._tip);
          spawnDebris(this._tip, {
            count: 5,
            color: this.data.ashColor,
            size: 0.012,
            speed: 0.9,
            life: 1400,
          });

          if (this.length <= this.data.minLength) this.burnOut();
          else this.applyLayout();
        },

        // Nothing left. Goes through breakable's hide/respawn cycle
        // rather than reimplementing it — see that component's
        // autoShatter note.
        burnOut: function () {
          var lightable = this.el.components.lightable;
          if (lightable) lightable.extinguish();
          this.setEmber(false);
          this.el.emit('burnt-out', null, false);

          var holsterable = this.el.components.holsterable;
          if (holsterable) {
            if (holsterable.hand) {
              var handRig = holsterable.hand.components['hand-rig'];
              if (handRig) handRig.forget(this.el);
            }
            holsterable.vacateSlot();
          }

          var breakable = this.el.components.breakable;
          if (breakable) breakable.shatter(false);
        },

        // Called by breakable when a burnt-out one comes back: fresh,
        // full length, unlit.
        restore: function () {
          this.length = this.data.length;
          this.ash = 0;
          this.burnMultiplier = 1;
          this.flick.reset();
          this.setEmber(false);
          this.applyLayout();
        },

        applyLayout: function () {
          var visual = this.data.visual && this.el.components[this.data.visual];
          if (visual) visual.layout(this.length, this.ash);
        },

        setEmber: function (lit) {
          var visual = this.data.visual && this.el.components[this.data.visual];
          if (visual) visual.setEmber(lit);
        },

        tipWorldPosition: function (out) {
          if (this.emberEl) this.emberEl.object3D.getWorldPosition(out);
          else this.el.object3D.getWorldPosition(out);
          return out;
        },
      });
