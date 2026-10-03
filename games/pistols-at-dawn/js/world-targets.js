      // ==============================================================
      // WORLD: targets
      // The shooting range: every gallery type (stationary stand,
      // wheel, conveyor, popper), the shared bullseye-face/reset-group
      // helpers they all build on, scoring, and the range's own
      // score/shots HUD manager. Split out of game.js — see DESIGN.md's
      // "File structure" section.
      // ==============================================================

      var FALL_ROTATION_X = -90; // degrees a hit target tips backward, hinged at its base
      var FALL_DUR_MS = 220;
      var STAND_UP_DUR_MS = 350;
      var RESET_DELAY_MS = 700; // pause after a group's last target falls, before that group pops back up

      var RING_Z = 0.1; // safely in front of the board; rings never overlap each other
      // ==============================================================
      // createTargetFace
      // The reusable "bullseye" visual: a board plus five scored rings,
      // with no pop-target/hit-reaction logic of its own and no
      // assumption about how it's mounted. Every gallery type below
      // (stationary stand, wheel spoke, conveyor, popper) builds its
      // own "hinge" entity — the thing that actually has pop-target
      // attached and physically falls — and appends one of these as a
      // child of it. `scale` shrinks the whole face uniformly, since a
      // 1.1m board that looks right on a stationary stand would be
      // absurd sticking out of a wheel spoke.
      // ==============================================================
      function createTargetFace(scale) {
        scale = scale || 1;
        var face = document.createElement('a-entity');

        var board = document.createElement('a-box');
        board.setAttribute('width', 1.1 * scale);
        board.setAttribute('height', 1.1 * scale);
        board.setAttribute('depth', 0.04);
        board.setAttribute('color', '#8a6d4b');
        face.appendChild(board);

        var rings = [
          { radius: 0.5, color: '#f4f1de', score: 10, label: 'Outer ring' },
          { radius: 0.4, color: '#1b1b1b', score: 25, label: 'Black ring' },
          { radius: 0.3, color: '#2274a5', score: 50, label: 'Blue ring' },
          { radius: 0.2, color: '#c1121f', score: 75, label: 'Red ring' },
          { radius: 0.1, color: '#ffd60a', score: 100, label: 'BULLSEYE' },
        ];

        rings.forEach(function (ring, i) {
          // Nested full disks required tiny Z offsets to reveal each color.
          // At 30m+ those planes collapse to the same depth-buffer value and
          // flicker. Annuli do not overlap at all, so every scoring zone can
          // share one stable plane.
          var zone = document.createElement(i === rings.length - 1 ? 'a-circle' : 'a-ring');
          if (i === rings.length - 1) zone.setAttribute('radius', ring.radius * scale);
          else {
            zone.setAttribute('radius-inner', rings[i + 1].radius * scale);
            zone.setAttribute('radius-outer', ring.radius * scale);
          }
          zone.setAttribute('color', ring.color);
          zone.setAttribute('position', { x: 0, y: 0, z: RING_Z });
          zone.classList.add('shootable');
          zone.setAttribute('scoring-ring', { score: ring.score, label: ring.label });
          face.appendChild(zone);
        });

        return face;
      }

      // ==============================================================
      // placeInArc
      // Positions an entity at a given angle/distance from the player
      // (0° = straight ahead, negative = left, positive = right) and
      // rotates it to face back roughly toward center — the same
      // convention target-group's internal layout already used for
      // individual stands, generalized here for gallery pieces that
      // place themselves as a whole.
      // ==============================================================
      function placeInArc(el, angleDeg, distance) {
        var angleRad = (angleDeg * Math.PI) / 180;
        el.object3D.position.set(distance * Math.sin(angleRad), 0, -distance * Math.cos(angleRad));
        el.object3D.rotation.set(0, (-angleDeg * Math.PI) / 180, 0);
      }

      // ==============================================================
      // makeGroupResetHandler
      // Every gallery type manages a group of pop-target hinges and
      // needs the identical "once they're all down, wait and stand
      // them back up together" behavior. Takes a function returning
      // the current list of hinge entities (rather than the list
      // itself) since it's called before that list exists yet.
      // ==============================================================
      function makeGroupResetHandler(getTargets) {
        return function () {
          var targets = getTargets();
          var allDown = targets.every(function (hingeEl) {
            return hingeEl.components['pop-target'].fallen;
          });
          if (!allDown) return;

          setTimeout(function () {
            targets.forEach(function (hingeEl) {
              hingeEl.components['pop-target'].standUp();
            });
          }, RESET_DELAY_MS);
        };
      }
      // ==============================================================
      // COMPONENT: pop-target
      // Attached to a target's "hinge" entity — the thing that
      // physically tips over when the target is hit. Whatever the
      // hinge carries as children (a stationary stand's post, a wheel
      // spoke's target face, a conveyor target, a popper) all move
      // together as one rigid piece — nothing is ever removed or
      // altered on a hit. Ignores further hits while already fallen;
      // standUp() resets it.
      // ==============================================================
      registerComponent('pop-target', {
        init: function () {
          this.fallen = false;
        },

        fall: function () {
          if (this.fallen) return;
          this.fallen = true;
          this.el.setAttribute('animation__fall', {
            property: 'rotation',
            to: FALL_ROTATION_X + ' 0 0',
            dur: FALL_DUR_MS,
            easing: 'easeInQuad',
          });
          // Bubbles up to whichever gallery-group entity spawned this
          // hinge (target-group, wheel-target, conveyor-target, or
          // popper-target) — each listens for it on itself.
          this.el.emit('target-fallen', null, true);
        },

        standUp: function () {
          if (!this.fallen) return;
          this.fallen = false;
          this.el.setAttribute('animation__fall', {
            property: 'rotation',
            to: '0 0 0',
            dur: STAND_UP_DUR_MS,
            easing: 'easeOutBack',
          });
        },
      });

      // ==============================================================
      // COMPONENT: wheel-target
      // A carnival wheel: targets mounted on spokes around a hub that
      // spins continuously. The hub's rotation is a plain per-frame
      // object3D write (like the gun's physics), independent of each
      // spoke's own pop-target-driven fall animation — different
      // entities, so the two never conflict. A fallen spoke keeps
      // spinning with the wheel, tipped over; that's intentional, not
      // a bug, and matches how a hit conveyor target keeps sliding.
      // ==============================================================
      registerComponent('wheel-target', {
        schema: {
          spokeCount: { type: 'number', default: 4 },
          wheelRadius: { type: 'number', default: 0.9 }, // meters, hub center to target center
          speed: { type: 'number', default: 40 }, // degrees/second
          targetScale: { type: 'number', default: 0.5 },
          hubHeight: { type: 'number', default: 1.4 },
          angle: { type: 'number', default: 0 }, // this wheel's own spot in the arc in front of the player
          distance: { type: 'number', default: 5.5 },
        },

        init: function () {
          placeInArc(this.el, this.data.angle, this.data.distance);

          this.paused = false;

          this.targets = [];
          var self = this;
          this.onTargetFallen = makeGroupResetHandler(function () { return self.targets; });
          this.el.addEventListener('target-fallen', this.onTargetFallen);

          this.support = document.createElement('a-box');
          this.support.setAttribute('width', 0.08);
          this.support.setAttribute('depth', 0.08);
          this.support.setAttribute('height', this.data.hubHeight);
          this.support.setAttribute('position', { x: 0, y: this.data.hubHeight / 2, z: 0 });
          this.support.setAttribute('color', '#5b4633');
          this.el.appendChild(this.support);

          this.hub = document.createElement('a-entity');
          this.hub.setAttribute('position', { x: 0, y: this.data.hubHeight, z: 0 });
          this.el.appendChild(this.hub);

          var axle = document.createElement('a-cylinder');
          axle.setAttribute('radius', 0.06);
          axle.setAttribute('height', 0.1);
          axle.setAttribute('rotation', '90 0 0');
          axle.setAttribute('color', '#2b2b2f');
          this.hub.appendChild(axle);

          this.spokeEls = [];
          this.layerEls = [];
          this.buildSpokes();
        },

        update: function (oldData) {
          if (!this.hub) return;
          if (
            oldData.distance !== undefined &&
            (oldData.distance !== this.data.distance || oldData.angle !== this.data.angle)
          ) {
            placeInArc(this.el, this.data.angle, this.data.distance);
          }
          if (oldData.spokeCount !== undefined && oldData.spokeCount !== this.data.spokeCount) this.buildSpokes();
        },

        buildSpokes: function () {
          this.layerEls.forEach(function (layerEl) {
            if (layerEl.parentNode) layerEl.parentNode.removeChild(layerEl);
          });
          this.layerEls.length = 0;
          this.spokeEls.length = 0;
          this.targets.length = 0;
          var spokeCount = Math.max(1, Math.round(this.data.spokeCount));
          var layerCount = spokeCount <= 8 ? 1 : spokeCount <= 16 ? 2 : 3;
          var layerGap = Math.max(0.95, this.data.targetScale * 1.1 + 0.3);
          var outerRadius = this.data.wheelRadius + (layerCount - 1) * layerGap;
          var hubHeight = Math.max(this.data.hubHeight, outerRadius + 0.2);
          this.hub.setAttribute('position', { x: 0, y: hubHeight, z: 0 });
          this.support.setAttribute('height', hubHeight);
          this.support.setAttribute('position', { x: 0, y: hubHeight / 2, z: 0 });
          var remaining = spokeCount;

          for (var layerIndex = 0; layerIndex < layerCount; layerIndex++) {
            var layerSpokeCount = Math.ceil(remaining / (layerCount - layerIndex));
            remaining -= layerSpokeCount;
            var radius = this.data.wheelRadius + layerIndex * layerGap;
            var layer = document.createElement('a-entity');
            layer._spinDirection = layerIndex % 2 === 0 ? 1 : -1;
            this.hub.appendChild(layer);
            this.layerEls.push(layer);

            for (var i = 0; i < layerSpokeCount; i++) {
              var angleDeg = (360 / layerSpokeCount) * i + layerIndex * 12;
              var angleRad = (angleDeg * Math.PI) / 180;
              var x = radius * Math.cos(angleRad);
              var y = radius * Math.sin(angleRad);

              var spoke = document.createElement('a-box');
              spoke.setAttribute('width', 0.04);
              spoke.setAttribute('depth', 0.04);
              spoke.setAttribute('height', radius);
              spoke.setAttribute('position', { x: x / 2, y: y / 2, z: -layerIndex * 0.04 });
              spoke.setAttribute('rotation', { x: 0, y: 0, z: angleDeg - 90 });
              spoke.setAttribute('color', '#5b4633');
              layer.appendChild(spoke);
              this.spokeEls.push(spoke);

              var hinge = document.createElement('a-entity');
              hinge.setAttribute('pop-target', '');
              hinge.setAttribute('position', { x: x, y: y, z: -layerIndex * 0.04 });
              layer.appendChild(hinge);
              hinge.appendChild(createTargetFace(this.data.targetScale));

              this.spokeEls.push(hinge);
              this.targets.push(hinge);
            }
          }
        },

        tick: function (time, dt) {
          if (this.paused) return;
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var delta = ((this.data.speed * Math.PI) / 180) * dtSeconds;
          this.layerEls.forEach(function (layer) {
            layer.object3D.rotation.z += delta * layer._spinDirection;
          });
        },

        setPaused: function (paused) {
          this.paused = !!paused;
        },
      });

      // ==============================================================
      // COMPONENT: conveyor-target
      // Targets sliding steadily along a track, wrapping around to the
      // start when they reach the end. `direction` flips which way —
      // line up a few of these with opposite directions for a belt
      // wall that alternates.
      // ==============================================================
      registerComponent('conveyor-target', {
        schema: {
          count: { type: 'number', default: 3 },
          conveyorCount: { type: 'number', default: 1 },
          length: { type: 'number', default: 3.2 }, // meters of track, end to end
          speed: { type: 'number', default: 0.45 }, // meters/second
          direction: { type: 'number', default: 1 }, // 1 = left-to-right, -1 = right-to-left
          height: { type: 'number', default: 1.3 },
          targetScale: { type: 'number', default: 0.5 },
          angle: { type: 'number', default: 0 },
          distance: { type: 'number', default: 5.5 },
        },

        init: function () {
          placeInArc(this.el, this.data.angle, this.data.distance);

          this.paused = false;
          this.targets = [];
          var self = this;
          this.onTargetFallen = makeGroupResetHandler(function () { return self.targets; });
          this.el.addEventListener('target-fallen', this.onTargetFallen);

          var halfLength = this.data.length / 2;
          var conveyorCount = Math.max(1, Math.min(4, Math.round(this.data.conveyorCount)));
          var basePerConveyor = Math.floor(this.data.count / conveyorCount);
          var extras = this.data.count % conveyorCount;

          for (var lane = 0; lane < conveyorCount; lane++) {
            var laneTargetCount = basePerConveyor + (lane < extras ? 1 : 0);
            var laneY = this.data.height + lane * 1.2 * this.data.targetScale;
            var laneZ = -lane * 0.12;
            var laneDirection = lane % 2 === 0 ? this.data.direction : -this.data.direction;

            var track = document.createElement('a-box');
            track.setAttribute('width', this.data.length + 0.3);
            track.setAttribute('height', 0.05);
            track.setAttribute('depth', 0.05);
            track.setAttribute('position', { x: 0, y: laneY, z: laneZ });
            track.setAttribute('color', '#2b2b2f');
            this.el.appendChild(track);

            var spacing = this.data.length / laneTargetCount;
            for (var i = 0; i < laneTargetCount; i++) {
              var startX = -halfLength + spacing * (i + 0.5);
              var hinge = document.createElement('a-entity');
              hinge.setAttribute('pop-target', '');
              hinge.setAttribute('position', { x: startX, y: laneY, z: laneZ });
              hinge._conveyorDirection = laneDirection;
              this.el.appendChild(hinge);
              var face = createTargetFace(this.data.targetScale);
              if (laneDirection < 0) face.setAttribute('rotation', '0 0 180');
              hinge.appendChild(face);
              this.targets.push(hinge);
            }
          }
        },

        tick: function (time, dt) {
          if (this.paused) return;
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var speed = this.data.speed;
          var halfLength = this.data.length / 2;

          this.targets.forEach(function (hingeEl) {
            var pos = hingeEl.object3D.position;
            var delta = speed * hingeEl._conveyorDirection * dtSeconds;
            pos.x += delta;
            if (pos.x > halfLength) pos.x -= halfLength * 2;
            else if (pos.x < -halfLength) pos.x += halfLength * 2;
          });
        },

        setPaused: function (paused) {
          this.paused = !!paused;
        },
      });

      // ==============================================================
      // COMPONENT: popper-target
      // The surprise: targets that spend most of their time hidden
      // below ground and rise up for a stretch on a randomized timer,
      // whack-a-mole style — a reflex/timing challenge rather than the
      // continuous motion of a wheel or conveyor. Each pops on its own
      // schedule (staggered random start so they don't all rise in
      // unison). Position is driven entirely by A-Frame's animation
      // component here, which is safe to mix with pop-target's own
      // rotation animation on the same hinge since they target
      // different properties and neither one touches object3D
      // directly.
      // ==============================================================
      registerComponent('popper-target', {
        schema: {
          count: { type: 'number', default: 4 },
          spacing: { type: 'number', default: 0.8 },
          targetScale: { type: 'number', default: 0.5 },
          cycleMinMs: { type: 'number', default: 2000 }, // shortest time spent hidden between pops
          cycleMaxMs: { type: 'number', default: 4500 }, // longest time spent hidden between pops
          upDurationMs: { type: 'number', default: 2200 }, // how long it stays up before ducking back down
          angle: { type: 'number', default: 0 },
          distance: { type: 'number', default: 3 },
        },

        init: function () {
          this.paused = false;
          this.targets = [];
          this.poppers = [];
          var self = this;
          this.onTargetFallen = makeGroupResetHandler(function () { return self.targets; });
          this.el.addEventListener('target-fallen', this.onTargetFallen);
          var targetHalfHeight = 0.55 * this.data.targetScale;
          var upY = targetHalfHeight; // target's bottom edge rests on the ground
          var downY = -targetHalfHeight - 0.05; // top edge clears the ground while hidden

          for (var i = 0; i < this.data.count; i++) {
            var t = this.data.count === 1 ? 0 : i / (this.data.count - 1) - 0.5;
            var angleDeg = this.data.angle + t * 120;
            var angleRad = angleDeg * Math.PI / 180;
            var staggeredDistance = Math.max(2, this.data.distance + (i % 3 - 1));
            var x = staggeredDistance * Math.sin(angleRad);
            var z = -staggeredDistance * Math.cos(angleRad);

            var hole = document.createElement('a-circle');
            hole.setAttribute('radius', 0.18);
            hole.setAttribute('rotation', '-90 0 0');
            hole.setAttribute('color', '#3a2f22');
            hole.setAttribute('position', { x: x, y: 0.005, z: z });
            this.el.appendChild(hole);

            var hinge = document.createElement('a-entity');
            hinge.setAttribute('pop-target', '');
            hinge.setAttribute('position', { x: x, y: downY, z: z });
            this.el.appendChild(hinge);
            var face = createTargetFace(this.data.targetScale);
            face.setAttribute('rotation', { x: 0, y: -angleDeg, z: 0 });
            hinge.appendChild(face);

            this.targets.push(hinge);
            this.poppers.push({
              hinge: hinge,
              x: x,
              z: z,
              upY: upY,
              downY: downY,
              isUp: false,
              timer: Math.random() * this.data.cycleMaxMs, // stagger initial pops
            });
          }
        },

        tick: function (time, dt) {
          if (this.paused) return;
          var self = this;
          this.poppers.forEach(function (popper) {
            popper.timer -= dt || 16;
            if (popper.timer > 0) return;

            popper.isUp = !popper.isUp;
            var targetY = popper.isUp ? popper.upY : popper.downY;
            popper.hinge.setAttribute('animation__pop', {
              property: 'position',
              to: popper.x + ' ' + targetY + ' ' + popper.z,
              dur: 220,
              easing: popper.isUp ? 'easeOutQuad' : 'easeInQuad',
            });
            popper.timer = popper.isUp
              ? self.data.upDurationMs
              : self.data.cycleMinMs + Math.random() * (self.data.cycleMaxMs - self.data.cycleMinMs);
          });
        },

        setPaused: function (paused) {
          this.paused = !!paused;
        },
      });

      // ==============================================================
      // COMPONENT: scoring-ring
      // Attached to each colored disc of a bullseye. Invincible by
      // design — a hit never changes its appearance or removes it,
      // just scores it and tips the whole target over via its parent
      // pop-target component. Listens for both "shot" (a fired round —
      // see castShot) and the standard "click" (a desktop/phone
      // reticle tap), since it doesn't care which one it was. Ignores
      // hits once the target it belongs to is already fallen.
      //
      // Looks up its owning pop-target via closest() rather than
      // assuming it's the direct parent, since a ring's parent is
      // actually the shared "face" createTargetFace built, one level
      // below whatever hinge pop-target is really attached to.
      //
      // Emits "ring-hit" directly at #range-manager rather than
      // bubbling, since target groups are now siblings of the range
      // manager (not descendants of it) — bubbling wouldn't reach it.
      // ==============================================================
      registerComponent('scoring-ring', {
        schema: {
          score: { type: 'number' },
          label: { type: 'string' },
        },

        init: function () {
          this.onClick = this.onClick.bind(this);
          this.el.addEventListener('click', this.onClick);
          this.el.addEventListener('shot', this.onClick);
        },

        remove: function () {
          this.el.removeEventListener('click', this.onClick);
          this.el.removeEventListener('shot', this.onClick);
        },

        onClick: function () {
          var hingeEl = this.el.closest('[pop-target]');
          var popTarget = hingeEl && hingeEl.components['pop-target'];
          if (popTarget && popTarget.fallen) return;

          var manager = document.querySelector('#range-manager');
          if (manager) {
            manager.emit('ring-hit', { score: this.data.score, label: this.data.label }, false);
          }

          if (popTarget) popTarget.fall();
        },
      });

      // ==============================================================
      // COMPONENT: shooting-range
      // The range manager: just score/shots/HUD now. Listens for
      // "ring-hit" and "gun-miss", both emitted directly at this
      // entity (not bubbled — see scoring-ring's comment for why).
      // Target spawning and per-group reset logic live in
      // target-group, below, since there are now multiple independent
      // groups of targets sharing this one HUD.
      // ==============================================================
      registerComponent('shooting-range', {
        init: function () {
          this.score = 0;
          this.shots = 0;
          this.hud = document.querySelector('#hud-text');

          this.onRingHit = this.onRingHit.bind(this);
          this.onMiss = this.onMiss.bind(this);
          this.el.addEventListener('ring-hit', this.onRingHit);
          this.el.addEventListener('gun-miss', this.onMiss);

          this.updateHud('Draw a pistol and take aim');
        },

        onRingHit: function (evt) {
          this.shots++;
          this.score += evt.detail.score;
          this.updateHud(evt.detail.label + '  +' + evt.detail.score);
        },

        onMiss: function () {
          this.shots++;
          this.updateHud('MISS');
        },

        updateHud: function (message) {
          this.hud.setAttribute(
            'text',
            'value',
            'Score: ' + this.score + '   Shots: ' + this.shots + '\n' + message
          );
        },
      });

      // ==============================================================
      // COMPONENT: target-group
      // Spawns one distance-tier's worth of pop-up target stands (see
      // pop-target) in a shallow arc, and owns resetting just that
      // group: once every stand it spawned has fallen, it waits
      // RESET_DELAY_MS and stands them all back up together. Other
      // groups are unaffected — "target-fallen" only bubbles up to
      // this entity (the ancestor of the stands it spawned), not to
      // sibling groups or the range manager.
      // ==============================================================
      registerComponent('target-group', {
        schema: {
          count: { type: 'number', default: 3 },
          distanceScale: { type: 'number', default: 1 }, // multiplies how far this group stands from the player
          distance: { type: 'number', default: 0 }, // absolute distance; zero preserves distanceScale compatibility
        },

        init: function () {
          this.targets = []; // the hinge entities, one per stand in this group

          var self = this;
          this.onTargetFallen = makeGroupResetHandler(function () { return self.targets; });
          this.el.addEventListener('target-fallen', this.onTargetFallen);

          var distance = this.data.distance || 4.5 * this.data.distanceScale;
          this.buildLayout(this.data.count, distance).forEach(function (spot) {
            self.targets.push(self.spawnTarget(spot.x, spot.standHeight, spot.z, spot.rotY));
          });
        },

        // Fill a 120-degree firing arc. Nearby targets occupy several
        // height/depth tiers because a single 1.1m board subtends far more of
        // the player's view at 5m than it does at 45m.
        buildLayout: function (count, distance) {
          var targetAngle = 2 * Math.atan2(0.65, distance) * 180 / Math.PI;
          var capacity = Math.max(4, Math.floor(120 / (targetAngle * 1.25)));
          var rowCount = Math.ceil(count / capacity);
          var remaining = count;
          var positions = [];

          for (var row = 0; row < rowCount; row++) {
            var rowTargetCount = Math.ceil(remaining / (rowCount - row));
            remaining -= rowTargetCount;
            var rowDistance = distance + row * 1.5;
            for (var column = 0; column < rowTargetCount; column++) {
              var t = rowTargetCount === 1 ? 0 : column / (rowTargetCount - 1) - 0.5;
              var angleDeg = t * 120;
              var angleRad = angleDeg * Math.PI / 180;
              positions.push({
                x: rowDistance * Math.sin(angleRad),
                z: -rowDistance * Math.cos(angleRad),
                standHeight: 1.1 + row * 1.15 + (column % 2) * 0.12,
                rotY: -angleDeg,
              });
            }
          }

          return positions;
        },

        // Builds one wooden target stand and returns its "hinge"
        // entity: the thing pop-target rotates when hit. The hinge
        // sits at the stand's origin (ground level, the base of the
        // post) and carries the post and the target face all as
        // children, so the whole stand tips over as one rigid piece
        // rather than just the board flopping at the top of a
        // stationary post.
        spawnTarget: function (x, standHeight, z, rotY) {
          var stand = document.createElement('a-entity');
          stand.setAttribute('position', { x: x, y: 0, z: z });
          stand.setAttribute('rotation', { x: 0, y: rotY, z: 0 });

          var hinge = document.createElement('a-entity');
          hinge.setAttribute('pop-target', '');
          stand.appendChild(hinge);

          var post = document.createElement('a-box');
          post.setAttribute('width', 0.08);
          post.setAttribute('depth', 0.08);
          post.setAttribute('height', standHeight);
          post.setAttribute('position', { x: 0, y: standHeight / 2, z: 0 });
          post.setAttribute('color', '#5b4633');
          hinge.appendChild(post);

          var face = createTargetFace(1);
          face.setAttribute('position', { x: 0, y: standHeight, z: 0 });
          hinge.appendChild(face);

          this.el.appendChild(stand);
          return hinge;
        },
      });
