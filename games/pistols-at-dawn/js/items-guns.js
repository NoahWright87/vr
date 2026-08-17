      // ==============================================================
      // ITEMS: guns
      // Pistol, shotgun, scoped rifle, and tommy gun — their visuals
      // (boxy-gun/boxy-shotgun/boxy-sniper/boxy-tommy), the firing
      // mechanism shared by all four (firearm), the scope (also reused as-is
      // for the wardrobe mirror — see boxy-mirror in
      // world-saloon-bar.js), and the pistol/sniper item-maker
      // recipes. Split out of game.js — see DESIGN.md's
      // "File structure" section. castShot/gatherShootableRoots/
      // resolveShootable and MAX_SHOT_RANGE stay in game.js: they're
      // also what the throw-aim system's findLookTarget uses to figure
      // out what you're looking at, not firearm-exclusive.
      // ==============================================================

      // A gun's local -Z (barrel forward) is defined relative to the
      // hand's raw tracked ("grip") orientation, which on Quest Touch
      // controllers does NOT point where your index finger does — this
      // is a well-known WebXR quirk (laser-controls gets away with the
      // same raw orientation because you visually self-correct your
      // aim by watching the laser line; a rigid gun model has no such
      // feedback, so the mismatch just looks wrong). Each pistol's
      // holsterable="...heldRotation: -90 0 0..." markup attribute
      // rotates the held gun to compensate — -90° on X is a reasoned
      // starting estimate (pitching the barrel down out of "grip up"
      // into "pointing forward"), not a verified value; if the barrel
      // still doesn't track your finger, nudge that x value in ~15°
      // steps (or adjust y/z if the mismatch looks like a left/right
      // twist rather than up/down) and reload. The hat has no such
      // problem — it isn't aimed at anything, so its heldRotation is
      // just identity.
      // Defaults for the firearm component — a pistol's recoil. Each
      // shot displaces the tracked grip in all six degrees of freedom;
      // bigger guns override these values in their item declaration.
      var RECOIL_BACK_METERS = 0.025;
      var RECOIL_RISE_DEG = 5;
      var RECOIL_JITTER = 0.18;
      var RECOIL_RETURN_RATE = 7; // exponential settling rate per second
      var TRACER_COLOR = '#ffe066';
      var TRACER_RADIUS = 0.004; // meters
      var TRACER_LIFETIME_MS = 80;
      var IMPACT_RADIUS = 0.04; // meters
      var IMPACT_LIFETIME_MS = 150;
      var SHOTGUN_BARREL_BREECH_Z = -0.135;
      var SHOTGUN_BARREL_FULL_LENGTH = 0.45;
      var SHOTGUN_BARREL_MIN_LENGTH = 0.12;
      var SHOTGUN_BARREL_Y = 0.05;
      var SHOTGUN_MEDIUM_LENGTH = 0.29;
      var SHOTGUN_SMALL_LENGTH = 0.16;
      var SHOTGUN_SUPPORT_MIN_LENGTH = 0.245;
      var SAW_PREVIEW_DISTANCE = 0.14;
      var SAW_REQUIRED_TRAVEL = 0.72;
      // ==============================================================
      // THE SCOPE
      // A real one: a second camera with a narrow field of view,
      // rendering the scene to a texture that is then the glass in the
      // eyepiece. Which is to say it costs an extra pass over the whole
      // scene, and this one is about 160 draw calls.
      //
      // So it only runs when the eyepiece is actually at your eye. That
      // started as the optimisation and turned out to be the mechanic:
      // the glass is dark until you bring the rifle up and put your eye
      // behind it, which is both what a scope does and what stops a
      // magnified view hanging in the middle of the room costing frames
      // while it dangles off your belt. The render target is small on
      // purpose too — a scope image is allowed to look like a scope
      // image.
      // ==============================================================
      var SCOPE_FOV = 11; // degrees — roughly 4x
      var SCOPE_TEXTURE = 256; // square render target; deliberately modest
      var SCOPE_WAKE_DISTANCE = 0.22; // metres from eyepiece to your eye before the glass lights up
      var SCOPE_LENS_RADIUS = 0.026;

      var SNIPER_LENGTH = 1.15;
      // ==============================================================
      // spawnTracer
      // A quick yellow line from the muzzle to wherever the shot ended
      // up (a hit point, or MAX_SHOT_RANGE out into the distance on a
      // miss), plus a small burst at that endpoint. Both are one-shot,
      // throwaway entities — created, shown briefly, removed — so it's
      // a plain function rather than a component.
      // ==============================================================
      function spawnTracer(origin, endPoint) {
        var sceneEl = document.querySelector('a-scene');

        var direction = new THREE.Vector3().subVectors(endPoint, origin);
        var length = direction.length();
        if (length > 0.001) {
          var midpoint = new THREE.Vector3().addVectors(origin, endPoint).multiplyScalar(0.5);
          var quaternion = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.clone().normalize()
          );

          var tracer = document.createElement('a-entity');
          tracer.setAttribute('geometry', { primitive: 'cylinder', radius: TRACER_RADIUS, height: length });
          tracer.setAttribute('material', 'color: ' + TRACER_COLOR + '; shader: flat; opacity: 0.9; transparent: true');
          tracer.object3D.position.copy(midpoint);
          tracer.object3D.quaternion.copy(quaternion);
          sceneEl.appendChild(tracer);
          setTimeout(function () {
            if (tracer.parentNode) tracer.parentNode.removeChild(tracer);
          }, TRACER_LIFETIME_MS);
        }

        var impact = document.createElement('a-sphere');
        impact.setAttribute('radius', IMPACT_RADIUS);
        impact.setAttribute('material', 'color: ' + TRACER_COLOR + '; shader: flat; opacity: 0.9; transparent: true');
        impact.object3D.position.copy(endPoint);
        impact.setAttribute('animation__shrink', {
          property: 'scale',
          to: '0.001 0.001 0.001',
          dur: IMPACT_LIFETIME_MS,
          easing: 'easeInQuad',
        });
        sceneEl.appendChild(impact);
        setTimeout(function () {
          if (impact.parentNode) impact.parentNode.removeChild(impact);
        }, IMPACT_LIFETIME_MS + 20);
      }
      // ==============================================================
      // COMPONENT: boxy-gun
      // Builds a very simple, low-poly pistol out of boxes, sized for a
      // hand-held scale (roughly 20cm long). Local space is defined so
      // the entity's own origin sits at the grip/trigger-guard area —
      // that's what lets holsterable's dangle physics (a separate
      // component, attached alongside this one) treat "pivot around
      // the entity origin" as "pivot around the trigger guard" without
      // needing a separate offset. See boxy-hat, below, for the same
      // trick applied to a very differently-shaped object.
      // ==============================================================
      registerComponent('boxy-gun', {
        init: function () {
          var el = this.el;
          var metal = '#2b2b2f';
          var wood = '#4a2f1c';
          var brass = '#c9962c';

          function addBox(w, h, d, pos, color, rot) {
            var box = document.createElement('a-box');
            box.setAttribute('width', w);
            box.setAttribute('height', h);
            box.setAttribute('depth', d);
            box.setAttribute('position', pos);
            box.setAttribute('color', color);
            if (rot) box.setAttribute('rotation', rot);
            el.appendChild(box);
            return box;
          }

          addBox(0.045, 0.13, 0.05, '0 -0.05 0.02', wood, '12 0 0'); // grip
          addBox(0.045, 0.05, 0.14, '0 0.02 -0.04', metal); // frame
          addBox(0.042, 0.045, 0.22, '0 0.058 -0.12', metal); // slide
          addBox(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard (bottom)
          addBox(0.045, 0.05, 0.006, '0 -0.005 -0.05', metal); // trigger guard (front)
          addBox(0.008, 0.03, 0.008, '0 -0.01 -0.035', brass); // trigger
          addBox(0.03, 0.025, 0.012, '0 0.075 0.025', metal, '20 0 0'); // hammer
          addBox(0.008, 0.012, 0.008, '0 0.085 -0.22', metal); // front sight
          addBox(0.03, 0.01, 0.012, '0 0.083 -0.03', metal); // rear sight

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.03);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', '0 0.058 -0.24');
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', '0 0.058 -0.235');
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-shotgun
      // Same boxy-box-of-boxes approach and the same "origin sits at
      // the trigger guard" convention as boxy-gun (so it dangles/
      // twirls with zero extra physics code), just a lot longer: a
      // long barrel, a pump forend under it, and a stock out the back
      // for shouldering flavor. This is also why it needs a large
      // anchor-slot (see the bandolier in markup) rather than a small
      // one like the pistols — it's sized to obviously not fit in a
      // hip holster.
      // ==============================================================
      registerComponent('boxy-shotgun', {
        init: function () {
          var el = this.el;
          var metal = '#2b2b2f';
          var wood = '#4a2f1c';
          var brass = '#c9962c';

          function addBox(w, h, d, pos, color, rot) {
            var box = document.createElement('a-box');
            box.setAttribute('width', w);
            box.setAttribute('height', h);
            box.setAttribute('depth', d);
            box.setAttribute('position', pos);
            box.setAttribute('color', color);
            if (rot) box.setAttribute('rotation', rot);
            el.appendChild(box);
            return box;
          }

          addBox(0.05, 0.14, 0.055, '0 -0.05 0.02', wood, '10 0 0'); // grip
          addBox(0.05, 0.06, 0.18, '0 0.02 -0.06', metal); // receiver
          this.barrel = addBox(0.035, 0.035, SHOTGUN_BARREL_FULL_LENGTH, '0 0.05 -0.36', metal);
          this.forend = addBox(0.055, 0.045, 0.16, '0 0.01 -0.22', wood);
          addBox(0.06, 0.09, 0.28, '0 -0.02 0.24', wood, '-6 0 0'); // stock
          addBox(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard (bottom)
          addBox(0.045, 0.05, 0.006, '0 -0.005 -0.05', metal); // trigger guard (front)
          addBox(0.008, 0.03, 0.008, '0 -0.01 -0.035', brass); // trigger
          this.frontSight = addBox(0.01, 0.014, 0.01, '0 0.085 -0.58', metal);

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.045);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', '0 0.05 -0.6');
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);
          this.flash = flash;

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', '0 0.05 -0.585');
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);
          this.muzzle = muzzle;
        },

        setBarrelLength: function (length) {
          length = Math.min(Math.max(length, SHOTGUN_BARREL_MIN_LENGTH), SHOTGUN_BARREL_FULL_LENGTH);
          var muzzleZ = SHOTGUN_BARREL_BREECH_Z - length;
          var centerZ = SHOTGUN_BARREL_BREECH_Z - length / 2;
          this.barrel.setAttribute('depth', length);
          this.barrel.setAttribute('position', { x: 0, y: SHOTGUN_BARREL_Y, z: centerZ });
          this.frontSight.setAttribute('position', { x: 0, y: 0.085, z: muzzleZ + 0.005 });
          this.flash.setAttribute('position', { x: 0, y: SHOTGUN_BARREL_Y, z: muzzleZ - 0.015 });
          this.muzzle.setAttribute('position', { x: 0, y: SHOTGUN_BARREL_Y, z: muzzleZ });

          var forendLength = Math.min(0.16, Math.max(length - 0.09, 0.04));
          this.forend.setAttribute('depth', forendLength);
          this.forend.setAttribute('position', {
            x: 0,
            y: 0.01,
            z: SHOTGUN_BARREL_BREECH_Z - 0.045 - forendLength / 2,
          });
          this.forend.setAttribute('visible', length >= SHOTGUN_SUPPORT_MIN_LENGTH);
        },
      });

      // ==============================================================
      // COMPONENT: cuttable-shotgun
      // Owns the one piece of state a customized shotgun needs: how
      // much barrel is left. Everything derived from that state is
      // updated together — model, muzzle, spread, pellet count, slot
      // size, support grip, and recoil — so no half-sawn configuration
      // can escape into the rest of the generic equipment system.
      // ==============================================================
      registerComponent('cuttable-shotgun', {
        init: function () {
          this.barrelLength = SHOTGUN_BARREL_FULL_LENGTH;
          this.applied = false;
          this._local = new THREE.Vector3();

          this.marker = document.createElement('a-entity');
          this.marker.setAttribute('visible', false);
          for (var i = 0; i < 7; i++) {
            var dot = document.createElement('a-sphere');
            dot.setAttribute('radius', 0.007);
            dot.setAttribute('position', { x: -0.06 + i * 0.02, y: 0, z: 0 });
            dot.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.95');
            this.marker.appendChild(dot);
          }
          this.el.appendChild(this.marker);
        },

        tick: function () {
          if (this.applied) return;
          if (!this.el.components['boxy-shotgun'] || !this.el.components.firearm || !this.el.components.holsterable) return;
          this.applied = true;
          this.applyBarrelState();
        },

        muzzleZ: function () {
          return SHOTGUN_BARREL_BREECH_Z - this.barrelLength;
        },

        candidateAt: function (worldPoint) {
          if (this.barrelLength <= SHOTGUN_BARREL_MIN_LENGTH + 0.01) return null;

          this._local.copy(worldPoint);
          this.el.object3D.worldToLocal(this._local);
          var radial = Math.sqrt(
            this._local.x * this._local.x +
            (this._local.y - SHOTGUN_BARREL_Y) * (this._local.y - SHOTGUN_BARREL_Y)
          );
          if (radial > SAW_PREVIEW_DISTANCE) return null;

          var firstUsefulCut = this.muzzleZ() + 0.025;
          var lastUsefulCut = SHOTGUN_BARREL_BREECH_Z - SHOTGUN_BARREL_MIN_LENGTH;
          if (this._local.z < firstUsefulCut || this._local.z > lastUsefulCut + 0.045) return null;

          return {
            z: Math.min(Math.max(this._local.z, firstUsefulCut), lastUsefulCut),
            distance: radial,
          };
        },

        showCutPreview: function (z, progress) {
          this.marker.setAttribute('position', { x: 0, y: SHOTGUN_BARREL_Y, z: z });
          this.marker.setAttribute('visible', true);
          var dots = this.marker.children;
          var lit = Math.round((progress || 0) * dots.length);
          for (var i = 0; i < dots.length; i++) {
            dots[i].setAttribute('material', 'color: ' + (i < lit ? '#ff8c42' : '#ffe066') + '; shader: flat; opacity: 0.95');
          }
        },

        hideCutPreview: function () {
          this.marker.setAttribute('visible', false);
        },

        cutAtZ: function (z) {
          var nextLength = Math.min(
            Math.max(SHOTGUN_BARREL_BREECH_Z - z, SHOTGUN_BARREL_MIN_LENGTH),
            SHOTGUN_BARREL_FULL_LENGTH
          );
          if (nextLength >= this.barrelLength - 0.01) return false;
          this.barrelLength = nextLength;
          this.applyBarrelState();
          return true;
        },

        applyBarrelState: function () {
          var visual = this.el.components['boxy-shotgun'];
          var firearm = this.el.components.firearm;
          var holsterable = this.el.components.holsterable;
          if (!visual || !firearm || !holsterable) return;

          visual.setBarrelLength(this.barrelLength);
          var fullRatio = (this.barrelLength - SHOTGUN_BARREL_MIN_LENGTH) /
            (SHOTGUN_BARREL_FULL_LENGTH - SHOTGUN_BARREL_MIN_LENGTH);
          fullRatio = Math.min(Math.max(fullRatio, 0), 1);
          var shortness = 1 - fullRatio;

          // The spread curve gets violent near the minimum instead of
          // making the first cosmetic trim ruin the weapon. A full
          // tube is substantially tighter than the old fixed 4° cone;
          // the shortest legal tube throws a 12° cloud and twice as
          // many actual rays.
          firearm.data.coneDeg = 0.6 + 11.4 * Math.pow(shortness, 1.35);
          firearm.data.pellets = Math.round(5 + 5 * shortness);

          // Cutting removes leverage and weight, increasing both the
          // rearward shove and muzzle rise. The remaining forend is a
          // progressively worse brace as the barrel gets shorter.
          firearm.data.recoilBack = 0.04 + 0.025 * shortness;
          firearm.data.recoilRiseDeg = 8 + 8 * shortness;
          firearm.data.recoilReturnRate = 4.8 - 0.8 * shortness;
          firearm.data.supportedRiseScale = 0.25 + 0.35 * shortness;
          firearm.data.supportedBackScale = 0.7 + 0.12 * shortness;

          if (this.barrelLength <= SHOTGUN_SMALL_LENGTH) {
            holsterable.data.itemSize = 'small';
          } else if (this.barrelLength <= SHOTGUN_MEDIUM_LENGTH) {
            holsterable.data.itemSize = 'medium';
          } else {
            holsterable.data.itemSize = 'large';
          }
          holsterable.data.grabSpan.z = this.muzzleZ() + 0.06;
          holsterable.data.comOffset.z = -0.08 - this.barrelLength * 0.27;
          holsterable._comLocal.set(
            holsterable.data.comOffset.x,
            holsterable.data.comOffset.y,
            holsterable.data.comOffset.z
          );

          var canSupport = this.barrelLength >= SHOTGUN_SUPPORT_MIN_LENGTH;
          holsterable.data.supportRadius = canSupport ? 0.22 : 0;
          holsterable.data.supportGrip.z = SHOTGUN_BARREL_BREECH_Z - Math.min(this.barrelLength * 0.55, 0.22);
          if (!canSupport && holsterable.supportHand) {
            var supportHand = holsterable.supportHand;
            holsterable.releaseSupport();
            var supportRig = supportHand.components['hand-rig'];
            if (supportRig) supportRig.discard(this.el);
          }
        },
      });

      // ==============================================================
      // COMPONENTS: boxy-handsaw + handsaw
      // The blade is long along local -Z. While the trigger is held,
      // the saw is corrected only perpendicular to that axis: it stays
      // engaged with the chosen cut but remains free to slide along
      // its teeth. Real tracked hand travel along that axis advances
      // the cut, so wagging or merely holding still does nothing.
      // ==============================================================
      registerComponent('boxy-handsaw', {
        init: function () {
          var el = this.el;

          var handle = document.createElement('a-box');
          handle.setAttribute('width', 0.045);
          handle.setAttribute('height', 0.12);
          handle.setAttribute('depth', 0.12);
          handle.setAttribute('position', '0 -0.035 -0.015');
          handle.setAttribute('rotation', '-8 0 0');
          handle.setAttribute('color', '#6b3f20');
          el.appendChild(handle);

          var blade = document.createElement('a-box');
          blade.setAttribute('width', 0.012);
          blade.setAttribute('height', 0.09);
          blade.setAttribute('depth', 0.42);
          blade.setAttribute('position', '0 0 -0.27');
          blade.setAttribute('material', 'color: #aeb5b8; metalness: 0.65; roughness: 0.35');
          el.appendChild(blade);

          for (var i = 0; i < 12; i++) {
            var tooth = document.createElement('a-box');
            tooth.setAttribute('width', 0.016);
            tooth.setAttribute('height', 0.018);
            tooth.setAttribute('depth', 0.014);
            tooth.setAttribute('position', { x: 0, y: -0.052, z: -0.075 - i * 0.034 });
            tooth.setAttribute('rotation', { x: 0, y: 0, z: i % 2 ? 12 : -12 });
            tooth.setAttribute('color', '#858d91');
            el.appendChild(tooth);
          }
        },
      });

      registerComponent('handsaw', {
        init: function () {
          this.target = null;
          this.previewTarget = null;
          this.cutZ = 0;
          this.sawing = false;
          this.travel = 0;
          this.sparkTravel = 0;
          this.seededHand = false;
          this._bladeWorld = new THREE.Vector3();
          this._targetWorld = new THREE.Vector3();
          this._axis = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._delta = new THREE.Vector3();
          this._worldPos = new THREE.Vector3();
          this._handWorld = new THREE.Vector3();
          this._prevHandWorld = new THREE.Vector3();
        },

        onTriggerUse: function () {
          if (this.sawing || !this.previewTarget) return;
          this.target = this.previewTarget;
          this.sawing = true;
          this.travel = 0;
          this.sparkTravel = 0;
          this.seededHand = false;
          this.target.showCutPreview(this.cutZ, 0);
        },

        tick: function (time, dt) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held') {
            this.finishSawing();
            this.clearPreview();
            return;
          }

          if (this.sawing) {
            var handRig = holsterable.hand && holsterable.hand.components['hand-rig'];
            if (!handRig || !handRig.triggerHeld || !this.target.el.parentNode) {
              this.finishSawing();
              return;
            }
            this.updateSawing(Math.min((dt || 16) / 1000, 0.05), holsterable);
          } else {
            this.updatePreview();
          }
        },

        bladeWorldPosition: function () {
          this._bladeWorld.set(0, 0, -0.27);
          this.el.object3D.localToWorld(this._bladeWorld);
          return this._bladeWorld;
        },

        updatePreview: function () {
          var point = this.bladeWorldPosition();
          var shotguns = document.querySelectorAll('[cuttable-shotgun]');
          var best = null;
          var bestCandidate = null;
          for (var i = 0; i < shotguns.length; i++) {
            var component = shotguns[i].components['cuttable-shotgun'];
            if (!component) continue;
            var candidate = component.candidateAt(point);
            if (candidate && (!bestCandidate || candidate.distance < bestCandidate.distance)) {
              best = component;
              bestCandidate = candidate;
            }
          }

          if (this.previewTarget && this.previewTarget !== best) this.previewTarget.hideCutPreview();
          this.previewTarget = best;
          if (best) {
            this.cutZ = bestCandidate.z;
            best.showCutPreview(this.cutZ, 0);
          }
        },

        updateSawing: function (dtSeconds, holsterable) {
          var targetEl = this.target.el;
          this._targetWorld.set(0, SHOTGUN_BARREL_Y, this.cutZ);
          targetEl.object3D.localToWorld(this._targetWorld);

          this.el.object3D.getWorldQuaternion(this._quat);
          this._axis.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          var bladeWorld = this.bladeWorldPosition();

          // Remove only the offset perpendicular to the blade. The
          // remaining freedom along its length is the sawing stroke.
          this._delta.copy(this._targetWorld).sub(bladeWorld);
          this._delta.addScaledVector(this._axis, -this._delta.dot(this._axis));
          this.el.object3D.getWorldPosition(this._worldPos);
          this._worldPos.add(this._delta);
          var parent = this.el.object3D.parent;
          if (parent) {
            parent.worldToLocal(this._worldPos);
            this.el.object3D.position.copy(this._worldPos);
          }

          holsterable.hand.object3D.getWorldPosition(this._handWorld);
          if (!this.seededHand) {
            this._prevHandWorld.copy(this._handWorld);
            this.seededHand = true;
            return;
          }

          var alongBlade = Math.abs(this._delta.copy(this._handWorld).sub(this._prevHandWorld).dot(this._axis));
          this._prevHandWorld.copy(this._handWorld);
          if (alongBlade < 0.002) return;
          alongBlade = Math.min(alongBlade, 0.07);
          this.travel += alongBlade;
          this.sparkTravel += alongBlade;
          this.target.showCutPreview(this.cutZ, Math.min(this.travel / SAW_REQUIRED_TRAVEL, 1));

          if (this.sparkTravel >= 0.12) {
            this.sparkTravel = 0;
            spawnSparks(this._targetWorld, 2);
          }
          if (this.travel >= SAW_REQUIRED_TRAVEL) {
            this.target.cutAtZ(this.cutZ);
            this.finishSawing();
          }
        },

        finishSawing: function () {
          if (this.target) this.target.hideCutPreview();
          this.target = null;
          this.sawing = false;
          this.seededHand = false;
        },

        clearPreview: function () {
          if (this.previewTarget) this.previewTarget.hideCutPreview();
          this.previewTarget = null;
        },
      });

      // ==============================================================
      // COMPONENT: boxy-tommy
      // A deliberately anachronistic Thompson silhouette: slab-sided
      // receiver, finned barrel, vertical foregrip, shoulder stock,
      // and the unmistakable drum hanging below. It keeps the same
      // trigger-guard origin and local -Z barrel convention as every
      // other gun, so all the generic holding/firing code applies.
      // ==============================================================
      registerComponent('boxy-tommy', {
        init: function () {
          var el = this.el;
          var metal = '#25262a';
          var darkMetal = '#17181b';
          var wood = '#6b3f20';

          function box(w, h, d, pos, color, rot) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            if (rot) b.setAttribute('rotation', rot);
            el.appendChild(b);
            return b;
          }

          box(0.052, 0.14, 0.055, '0 -0.05 0.02', wood, '10 0 0'); // pistol grip
          box(0.07, 0.08, 0.23, '0 0.035 -0.08', metal); // receiver
          box(0.032, 0.032, 0.3, '0 0.055 -0.34', darkMetal); // barrel
          box(0.075, 0.1, 0.29, '0 0.015 0.22', wood, '-5 0 0'); // shoulder stock
          box(0.052, 0.15, 0.06, '0 -0.045 -0.25', wood, '-12 0 0'); // vertical foregrip
          box(0.05, 0.008, 0.065, '0 -0.03 -0.025', darkMetal); // trigger guard
          box(0.008, 0.032, 0.008, '0 -0.01 -0.04', '#c9962c'); // trigger
          box(0.018, 0.018, 0.025, '0.045 0.065 -0.02', darkMetal); // charging handle
          box(0.01, 0.014, 0.01, '0 0.082 -0.49', darkMetal); // front sight

          var drum = document.createElement('a-cylinder');
          drum.setAttribute('radius', 0.085);
          drum.setAttribute('height', 0.048);
          drum.setAttribute('segments-radial', 16);
          drum.setAttribute('rotation', '90 0 0');
          drum.setAttribute('position', '0 -0.075 -0.105');
          drum.setAttribute('color', darkMetal);
          el.appendChild(drum);

          for (var i = 0; i < 5; i++) {
            var fin = document.createElement('a-cylinder');
            fin.setAttribute('radius', 0.024);
            fin.setAttribute('height', 0.012);
            fin.setAttribute('segments-radial', 12);
            fin.setAttribute('rotation', '90 0 0');
            fin.setAttribute('position', { x: 0, y: 0.055, z: -0.24 - i * 0.045 });
            fin.setAttribute('color', metal);
            el.appendChild(fin);
          }

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.038);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', '0 0.055 -0.505');
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', '0 0.055 -0.5');
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);
        },
      });
      // itemSize is the only thing deciding which sockets a gun can go
      // in (see holsterable.findNearestSlot) — there's no per-object
      // list of "which anchors" anywhere. A pistol is small and fits
      // everything, up to and including your mouth and the crown of
      // your hat; a shotgun is large and only the bandolier and the
      // armoury's cradles will take it.
      defineItem('pistol', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          heldPosition: { x: 0, y: 0, z: 0 },
          grabRadius: 0.15,
          comOffset: { x: 0, y: 0.03, z: -0.08 },
        });
        el.setAttribute('firearm', '');
        el.setAttribute('ignition-source', { tipSelector: '.muzzle' });
        el.setAttribute('boxy-gun', '');
      });
      // The rifle. A `firearm` with a tighter cone and a heavier kick,
      // and a `scope` — which is a separate component precisely
      // because seeing through a tube has nothing to do with firing
      // one. The support grip at the forestock matters more here than
      // anywhere else: one wrist cannot hold a magnified view still.
      defineItem('sniper', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.24,
          grabSpan: { x: 0, y: 0, z: -0.7 },
          comOffset: { x: 0, y: 0.02, z: -0.28 },
          supportGrip: { x: 0, y: 0.005, z: -0.28 },
          supportRadius: 0.22,
          maxThrowSpeed: 6,
        });
        el.setAttribute('firearm', {
          pellets: 1,
          coneDeg: 0,
          recoilBack: 0.065,
          recoilRiseDeg: 11,
          recoilReturnRate: 3.2,
          supportedRiseScale: 0.28,
          supportedBackScale: 0.72,
          heatPerShot: 0.5,
        });
        el.setAttribute('ignition-source', { tipSelector: '.muzzle' });
        el.setAttribute('boxy-sniper', '');
        el.setAttribute('scope', { offset: { x: 0, y: 0.115, z: 0.03 } });
      });

      // Hold the trigger and it keeps firing at roughly 700 RPM. The
      // interval is opt-in on firearm, so pistols, rifles, and the
      // shotgun remain one shot per trigger pull.
      defineItem('tommy', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.25,
          grabSpan: { x: 0, y: 0, z: -0.42 },
          comOffset: { x: 0, y: 0.01, z: -0.15 },
          supportGrip: { x: 0, y: -0.02, z: -0.25 },
          supportRadius: 0.22,
          maxThrowSpeed: 7,
        });
        el.setAttribute('firearm', {
          pellets: 1,
          coneDeg: 1.2,
          recoilBack: 0.014,
          recoilRiseDeg: 2.4,
          recoilJitter: 0.28,
          recoilReturnRate: 10.5,
          heatPerShot: 0.08,
          fireIntervalMs: 85,
          supportedRiseScale: 0.35,
          supportedBackScale: 0.78,
        });
        el.setAttribute('ignition-source', { tipSelector: '.muzzle' });
        el.setAttribute('boxy-tommy', '');
      });
      // ==============================================================
      // COMPONENT: firearm
      // Everything that can be fired, in one component. This used to
      // be two nearly identical components ("pistol" and "shotgun")
      // that differed only in a handful of numbers, so it's now one
      // with those numbers in its schema — a single-ball pistol is
      // just pellets:1, coneDeg:0. Any new gun is a markup line.
      //
      // A thin companion to holsterable, attached alongside it only on
      // the guns — the hat, bottles, and cigars have no such
      // component, so hand-rig's trigger-pull handler (which looks for
      // this component before calling fire()) is naturally a no-op
      // while holding them. Recoil is delivered to hand-rig's grip
      // offset, beside rather than instead of vice drift, so the hand
      // and gun move together and all those effects stack.
      //
      // `heat` is the other bit of state, and it's what makes rapid
      // fire visibly different from careful shooting: every shot adds
      // some, it bleeds off at GUN_HEAT_DECAY_PER_S, and it drives
      // both how much smoke a shot produces and whether the barrel is
      // hot enough to light a cigar off (see world-systems).
      // ==============================================================
      registerComponent('firearm', {
        schema: {
          pellets: { type: 'number', default: 1 }, // rays per shot
          coneDeg: { type: 'number', default: 0 }, // half-angle of the spread cone
          recoilBack: { type: 'number', default: RECOIL_BACK_METERS },
          recoilRiseDeg: { type: 'number', default: RECOIL_RISE_DEG },
          recoilJitter: { type: 'number', default: RECOIL_JITTER },
          recoilReturnRate: { type: 'number', default: RECOIL_RETURN_RATE },
          supportedRiseScale: { type: 'number', default: 0.32 },
          supportedBackScale: { type: 'number', default: 0.75 },
          heatPerShot: { type: 'number', default: 0.22 },
          fireIntervalMs: { type: 'number', default: 0 }, // zero is semi-auto; otherwise milliseconds between shots while held
        },

        init: function () {
          this.heat = 0; // 0..1 barrel temperature — how hard this barrel has been worked lately
          this.sinceLastShot = Infinity;
          this.curlRemaining = 0; // puffs still to come in the post-shooting curl
          this.curlTimer = 0;
          this.automatic = false;
          this.automaticTimer = 0;

          this._origin = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._forward = new THREE.Vector3();
          this._right = new THREE.Vector3();
          this._up = new THREE.Vector3();
          this._headPosition = new THREE.Vector3();
          this._handPosition = new THREE.Vector3();
          this._headToHand = new THREE.Vector3();
          this._positionImpulse = new THREE.Vector3();
          this._rotationImpulse = new THREE.Vector3();
          this._supportImpulse = new THREE.Vector3();
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          this.sinceLastShot += dtSeconds * 1000;
          this.heat = Math.max(this.heat - GUN_HEAT_DECAY_PER_S * dtSeconds, 0);
          this.updateAutomatic(dtSeconds);
          this.updateBarrelSmoke(dtSeconds);

          // A barrel that's just been fired is hot enough to light a
          // cigar off. firearm doesn't know what a cigar is — it only
          // publishes "this tip is hot right now" (see
          // ignition-source) and lets world-systems do the matching.
          var source = this.el.components['ignition-source'];
          if (source) source.hot = this.heat > MUZZLE_HOT_THRESHOLD;
        },

        // Smoke happens after the shooting, not during it. Once the
        // barrel has been quiet for BARREL_SMOKE_DELAY_MS, however hot
        // it got is converted into a curl of puffs released one at a
        // time so they rise out of the muzzle in a column. Fire again
        // mid-curl and it's cancelled and re-armed — you only get the
        // smoke when you're actually done.
        updateBarrelSmoke: function (dtSeconds) {
          if (this.curlRemaining > 0) {
            this.curlTimer -= dtSeconds * 1000;
            if (this.curlTimer <= 0) {
              this.curlTimer = BARREL_SMOKE_INTERVAL_MS;
              this.curlRemaining--;
              this.emitBarrelPuff();
            }
            return;
          }

          if (this.sinceLastShot < BARREL_SMOKE_DELAY_MS) return;
          if (this.heat < BARREL_SMOKE_MIN_HEAT) return;

          this.curlRemaining = Math.max(Math.round(this.heat * BARREL_SMOKE_MAX_PUFFS), 1);
          this.curlTimer = 0;
          this.heat = 0; // spent — the curl IS the heat leaving the barrel
        },

        emitBarrelPuff: function () {
          var muzzleEl = this.el.querySelector('.muzzle');
          if (!muzzleEl || !muzzleEl.object3D) return;

          muzzleEl.object3D.getWorldPosition(this._origin);
          this._forward.set(0, 0.55, 0); // up and out of the barrel, not down the firing line
          spawnSmoke(this._origin, this._forward, 0.75);
        },

        // hand-rig's generic press dispatch (see useHeldObject) — a
        // trigger pull on a held gun means fire.
        onTriggerUse: function () {
          this.fire();
          if (this.data.fireIntervalMs > 0) {
            this.automatic = true;
            this.automaticTimer = this.data.fireIntervalMs;
          }
        },

        // Automatic fire reads the hand's existing triggerHeld state
        // rather than installing timers or teaching hand-rig about a
        // special weapon. Dropping the gun or releasing the trigger
        // stops the stream on the next frame, even after it has left
        // the hand's heldObjects list.
        updateAutomatic: function (dtSeconds) {
          if (!this.automatic) return;

          var holsterable = this.el.components.holsterable;
          var handRig = holsterable && holsterable.hand && holsterable.hand.components['hand-rig'];
          if (!holsterable || holsterable.state !== 'held' || !handRig || !handRig.triggerHeld) {
            this.automatic = false;
            this.automaticTimer = 0;
            return;
          }

          this.automaticTimer -= dtSeconds * 1000;
          if (this.automaticTimer <= 0) {
            this.fire();
            this.automaticTimer += this.data.fireIntervalMs;
          }
        },

        // Raycasts from the muzzle at everything wearing the
        // "shootable" class (see castShot) — targets, bottles, cigars,
        // whatever gets added next. Only fires while properly held —
        // not while dangling or mid-air, so a twirl in progress can't
        // accidentally go off.
        fire: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held') return;

          var muzzleEl = this.el.querySelector('.muzzle');
          if (!muzzleEl || !muzzleEl.object3D) return;

          muzzleEl.object3D.getWorldPosition(this._origin);
          muzzleEl.object3D.getWorldQuaternion(this._quat);
          this._forward.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          this._right.set(1, 0, 0).applyQuaternion(this._quat).normalize();
          this._up.set(0, 1, 0).applyQuaternion(this._quat).normalize();

          this.playMuzzleEffects();

          var coneRad = (this.data.coneDeg * Math.PI) / 180;
          var hitCount = 0;
          var roots = gatherShootableRoots();

          for (var i = 0; i < this.data.pellets; i++) {
            var direction = this._forward.clone();
            if (coneRad > 0) {
              direction
                .applyAxisAngle(this._right, (Math.random() - 0.5) * 2 * coneRad)
                .applyAxisAngle(this._up, (Math.random() - 0.5) * 2 * coneRad)
                .normalize();
            }

            var hit = castShot(this._origin, direction, roots);
            var endPoint;
            if (hit) {
              endPoint = hit.point;
              // Non-bubbling and aimed straight at the thing that was
              // hit: what a hit MEANS is entirely up to the target
              // (score and tip over, shatter, catch light).
              hit.el.emit('shot', { point: hit.point.clone(), direction: direction.clone() }, false);
              hitCount++;
            } else {
              endPoint = this._origin.clone().addScaledVector(direction, MAX_SHOT_RANGE);
            }

            spawnTracer(this._origin, endPoint);
          }

          if (hitCount === 0) {
            var manager = document.querySelector('#range-manager');
            if (manager) manager.emit('gun-miss', null, false);
          }
        },

        playMuzzleEffects: function () {
          this.applyRecoilImpulse();
          this.heat = Math.min(this.heat + this.data.heatPerShot, 1);
          this.sinceLastShot = 0;
          this.curlRemaining = 0; // still shooting — the curl waits

          flashMuzzle(this.el);
          spawnSparks(this._origin, 3);
        },

        // A deliberately lightweight firearm model. Gas pressure
        // shoves primarily back along the barrel; the player's arms
        // turn some of that into muzzle rise. A low, waist-braced gun
        // has a shorter lever, while a barrel aligned with the line
        // from head to firing hand transfers more force straight back
        // and less upward. Random translation and yaw/roll keep bursts
        // from climbing the same perfect line every time.
        applyRecoilImpulse: function () {
          var holsterable = this.el.components.holsterable;
          var handEl = holsterable && holsterable.hand;
          var handRig = handEl && handEl.components['hand-rig'];
          if (!handRig || !handRig.addRecoilImpulse) return;

          handEl.object3D.getWorldPosition(this._handPosition);
          var supported = holsterable.supportHand && holsterable.data.supportAims;
          var supportGrip = supported ? gripObjectOf(holsterable.supportHand) : null;
          if (supportGrip) supportGrip.getWorldPosition(this._supportImpulse);
          var heightScale = 1;
          var alignmentScale = 1;
          var headEl = document.querySelector('#head-camera');
          if (headEl && headEl.object3D) {
            headEl.object3D.getWorldPosition(this._headPosition);
            // At eye height the full lever is active; around waist
            // height only roughly a quarter of it remains.
            heightScale = Math.min(Math.max(this._origin.y - this._headPosition.y + 1, 0.25), 1);
            // With a supported gun, use the forward hand as the end of
            // the head/arms/barrel chain. Bent or misaligned arms then
            // preserve more rise than a straight shouldered stance.
            this._headToHand.copy(supportGrip ? this._supportImpulse : this._handPosition).sub(this._headPosition);
            if (this._headToHand.lengthSq() > 0.0001) {
              var alignment = Math.max(this._headToHand.normalize().dot(this._forward), 0);
              alignmentScale = 1 - alignment * 0.5;
            }
          }

          var shotVariation = 1 + (Math.random() * 2 - 1) * this.data.recoilJitter;
          var back = this.data.recoilBack * shotVariation * (supported ? this.data.supportedBackScale : 1);
          var rise = (this.data.recoilRiseDeg * Math.PI / 180) *
            heightScale * alignmentScale * shotVariation * (supported ? this.data.supportedRiseScale : 1);
          var sideways = (Math.random() * 2 - 1) * this.data.recoilJitter;
          var verticalNoise = (Math.random() * 2 - 1) * this.data.recoilJitter;
          var rollNoise = (Math.random() * 2 - 1) * this.data.recoilJitter;

          this._positionImpulse.copy(this._forward).multiplyScalar(-back);
          this._positionImpulse.addScaledVector(this._right, back * 0.28 * sideways);
          this._positionImpulse.addScaledVector(this._up, back * (0.08 * verticalNoise + 0.06 * rise));

          // A small axis-angle vector gives all three rotational DOF:
          // dominant pitch around barrel-right, imperfect yaw around
          // barrel-up, and a little torque around the barrel itself.
          this._rotationImpulse.copy(this._right).multiplyScalar(rise);
          this._rotationImpulse.addScaledVector(this._up, rise * 0.22 * sideways);
          this._rotationImpulse.addScaledVector(this._forward, rise * 0.16 * rollNoise);
          handRig.addRecoilImpulse(this._positionImpulse, this._rotationImpulse, this.data.recoilReturnRate);

          if (!supported) return;
          var supportRig = holsterable.supportHand.components['hand-rig'];
          if (!supportRig || !supportRig.addRecoilImpulse) return;

          // Move both hands back together. Raising the forward hand
          // relative to the trigger hand produces the reduced two-hand
          // muzzle rise through the same hand-to-hand aiming geometry
          // used during ordinary movement.
          var handSpan = 0.25;
          if (supportGrip) {
            handSpan = Math.max(this._supportImpulse.distanceTo(this._handPosition), 0.12);
          }
          this._supportImpulse.copy(this._positionImpulse).addScaledVector(this._up, Math.tan(rise) * handSpan);
          supportRig.addRecoilImpulse(this._supportImpulse, this._rotationImpulse, this.data.recoilReturnRate);
        },
      });
      // ==============================================================
      // COMPONENT: scope
      // See THE SCOPE. Generic on purpose — it is "a disc on this
      // object that shows what a narrow-angle camera pointed down this
      // object's -Z can see", so it would work just as well on a
      // spyglass, a periscope, or a mirror behind the bar.
      //
      // Three things it has to be careful about, all of them the same
      // hazard: it renders in the middle of somebody else's frame.
      // The renderer's current target has to be put back, WebXR has to
      // be switched off for the duration (or three.js renders the
      // off-screen pass in stereo into the headset's own framebuffer),
      // and the lens itself has to be hidden or it films its own last
      // frame — an infinite corridor, which is a lovely bug and quite
      // useless as a sight.
      // ==============================================================
      registerComponent('scope', {
        schema: {
          fov: { type: 'number', default: SCOPE_FOV },
          offset: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // where the eyepiece sits on the object
          objective: { type: 'number', default: 0.32 }, // how far ahead of the eyepiece the far end of the tube is
          radius: { type: 'number', default: SCOPE_LENS_RADIUS },
          wake: { type: 'number', default: SCOPE_WAKE_DISTANCE },
        },

        init: function () {
          this.awake = false;
          this._eye = new THREE.Vector3();
          this._lens = new THREE.Vector3();

          this.target = new THREE.WebGLRenderTarget(SCOPE_TEXTURE, SCOPE_TEXTURE);

          // The near plane sits past the end of the tube on purpose. A
          // scope camera parked at the eyepiece films the inside of its
          // own tube, and at eleven degrees the tube walls are most of
          // the picture; clipping everything closer than the objective
          // throws away the tube, the barrel and your own hands, which
          // is exactly what a scope does.
          this.camera = new THREE.PerspectiveCamera(this.data.fov, 1, 0.25, 400);
          this.el.object3D.add(this.camera);
          this.camera.position.set(
            this.data.offset.x,
            this.data.offset.y,
            this.data.offset.z - this.data.objective
          );

          // Facing +Z, i.e. straight back at your eye, which is the
          // default for a CircleGeometry and was the bug: it had been
          // turned to face down the barrel, so the only thing ever
          // visible through the scope was the back of the lens.
          //
          // No mirroring is needed. The scope camera and the eye behind
          // it both look along -Z, so their idea of "right" is the same
          // one.
          //
          // side: double, not the material default of front-only —
          // a held scope is always approached from the +Z side (the
          // shooter's eye behind the eyepiece), but a mirror sitting in
          // the world is approached from whichever side the player
          // happens to be standing on. Without this the glass renders
          // correctly to the render target (proven by reading its
          // pixels back) while being completely invisible on screen —
          // simple back-face culling, not a rendering failure, but easy
          // to chase as one.
          this.lensMesh = new THREE.Mesh(
            new THREE.CircleGeometry(this.data.radius, 20),
            new THREE.MeshBasicMaterial({ map: this.target.texture, side: THREE.DoubleSide })
          );
          this.lensMesh.position.set(this.data.offset.x, this.data.offset.y, this.data.offset.z + 0.005);
          this.lensMesh.visible = false; // asleep, you see straight through the hollow tube at life size
          this.el.object3D.add(this.lensMesh);

          this.liveMaterial = this.lensMesh.material;

          // The crosshair rides on the glass, so it magnifies with it.
          var reticle = new THREE.Mesh(
            new THREE.RingGeometry(this.data.radius * 0.06, this.data.radius * 0.08, 16),
            new THREE.MeshBasicMaterial({ color: '#1a1a1a' })
          );
          reticle.position.z = 0.001;
          this.lensMesh.add(reticle);
          this.reticle = reticle;
          reticle.visible = false;

          this.cameraEl = document.querySelector('#head-camera');
        },

        remove: function () {
          this.el.object3D.remove(this.camera);
          this.el.object3D.remove(this.lensMesh);
          this.target.dispose();
          this.lensMesh.geometry.dispose();
          this.liveMaterial.dispose();
        },

        tick: function () {
          if (!this.cameraEl) return;

          this.lensMesh.getWorldPosition(this._lens);
          this.cameraEl.object3D.getWorldPosition(this._eye);
          var awake = this._lens.distanceTo(this._eye) < this.data.wake;

          if (awake !== this.awake) {
            this.awake = awake;
            this.lensMesh.visible = awake;
            this.reticle.visible = awake;
          }
          if (!awake) return;

          this.renderThrough();
        },

        renderThrough: function () {
          var sceneEl = this.el.sceneEl;
          var renderer = sceneEl && sceneEl.renderer;
          if (!renderer) return;

          var wasXR = renderer.xr.enabled;
          var wasTarget = renderer.getRenderTarget();

          this.lensMesh.visible = false;
          renderer.xr.enabled = false;
          renderer.setRenderTarget(this.target);
          renderer.render(sceneEl.object3D, this.camera);
          renderer.setRenderTarget(wasTarget);
          renderer.xr.enabled = wasXR;
          this.lensMesh.visible = true;
        },
      });

      // ==============================================================
      // COMPONENT: boxy-sniper
      // A long rifle with a tube on top. Same conventions as every
      // other gun here — origin at the trigger guard, -Z down the
      // barrel — so `firearm`, `holsterable` and `scope` all point the
      // same way without being told to.
      // ==============================================================
      registerComponent('boxy-sniper', {
        init: function () {
          var el = this.el;
          var metal = '#2b2b2f';
          var wood = '#5b3a1c';

          function box(w, h, d, pos, color, rot) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            if (rot) b.setAttribute('rotation', rot);
            el.appendChild(b);
            return b;
          }

          box(0.045, 0.13, 0.05, '0 -0.05 0.02', wood, '12 0 0'); // grip
          box(0.048, 0.055, 0.2, '0 0.02 -0.07', metal); // receiver
          box(0.026, 0.026, SNIPER_LENGTH * 0.62, '0 0.045 -0.52', metal); // long barrel
          box(0.05, 0.04, 0.3, '0 0.005 -0.28', wood); // forestock
          box(0.055, 0.1, 0.3, '0 -0.025 0.26', wood, '-7 0 0'); // stock
          box(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard
          box(0.008, 0.03, 0.008, '0 -0.01 -0.035', '#c9962c'); // trigger
          box(0.02, 0.05, 0.02, '0 0.05 0.03', metal, '30 0 0'); // bolt handle

          // The scope tube. The eyepiece end is where `scope` puts its
          // glass, so the two sets of numbers have to agree — the same
          // hand-kept arrangement boxy-gun and the pistol's comOffset
          // already live with.
          // Open-ended and double-sided, so with the scope asleep you
          // are looking through a tube at the world rather than at a
          // solid cylinder. That also makes the moment it wakes read as
          // the view zooming rather than a wall turning into a window.
          var tube = document.createElement('a-cylinder');
          tube.setAttribute('radius', 0.028);
          tube.setAttribute('height', 0.34);
          tube.setAttribute('color', metal);
          tube.setAttribute('open-ended', true);
          tube.setAttribute('material', 'color: ' + metal + '; side: double');
          tube.setAttribute('rotation', '90 0 0');
          tube.setAttribute('position', { x: 0, y: 0.115, z: -0.14 });
          el.appendChild(tube);

          box(0.02, 0.05, 0.03, '0 0.085 -0.26', metal); // front mount
          box(0.02, 0.05, 0.03, '0 0.085 -0.02', metal); // rear mount

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.03);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', { x: 0, y: 0.045, z: -SNIPER_LENGTH + 0.06 });
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', { x: 0, y: 0.045, z: -SNIPER_LENGTH + 0.05 });
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);
        },
      });

      // defineItem('shotgun', ...) — left behind in game.js during
      // the original items-guns.js split, moved here on a later pass.
      // The same firearm declaration with shotgun starting values;
      // cuttable-shotgun derives the live values from however much
      // tube remains after that.
      //
      // supportGrip/supportRadius are what put a second place to hold
      // it at the forend: grip near there with your off hand and the
      // barrel points along the line between your two hands instead of
      // wherever one wrist happens to be. It also scales the actual
      // recoil now, and only the hand on the trigger grip can fire it.
      defineItem('shotgun', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          heldPosition: { x: 0, y: 0, z: 0 },
          grabRadius: 0.28,
          grabSpan: { x: 0, y: 0, z: -0.5 },
          comOffset: { x: 0, y: 0.02, z: -0.2 },
          supportGrip: { x: 0, y: 0.01, z: -0.22 },
          supportRadius: 0.22,
          maxThrowSpeed: 7,
        });
        el.setAttribute('firearm', {
          pellets: 5,
          coneDeg: 0.6,
          recoilBack: 0.04,
          recoilRiseDeg: 8,
          recoilReturnRate: 4.8,
          heatPerShot: 0.4,
          supportedRiseScale: 0.25,
          supportedBackScale: 0.7,
        });
        el.setAttribute('ignition-source', { tipSelector: '.muzzle' });
        el.setAttribute('boxy-shotgun', '');
        el.setAttribute('cuttable-shotgun', '');
      });

      defineItem('handsaw', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'medium',
          holsterRotation: { x: -75, y: 0, z: -8 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.18,
          grabSpan: { x: 0, y: 0, z: -0.48 },
          comOffset: { x: 0, y: 0, z: -0.2 },
          maxThrowSpeed: 7,
        });
        el.setAttribute('boxy-handsaw', '');
        el.setAttribute('handsaw', '');
      });
