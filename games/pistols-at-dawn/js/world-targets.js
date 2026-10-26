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

      // ==============================================================
      // DUEL PIECES: cardboard cowboys, the lane they stand in, and the
      // board that announces the duel.
      //
      // The duel framework itself (rounds, signals, false starts,
      // scoring) is js/duel.js + js/duel-model.js and is persistent.
      // These are only what a duel looks like at the Range, so they live
      // with the other targets and load with the area.
      // ==============================================================

      var CARDBOARD_COLOR = '#b98f55';
      var CARDBOARD_DOWN_ANGLE = -1.48; // radians about X: flat on its back, the same lie steel-silhouette's own 'tip' death uses

      // A man-shaped pop-up cutout. It IS a steel-silhouette
      // (common/dummies.js) restyled as cardboard and told to stay where
      // it is, not a second target type: the silhouette already owns hit
      // zones (head, torso, legs), the rock-and-fall reaction and the
      // popup motion we drive from outside here.
      //
      // The one thing it adds is the ADAPTER between the two hit
      // vocabularies. Pistols' guns emit `shot` (a point and a direction)
      // on whatever they hit; the dummies react to `action-hit` (a zone,
      // damage and force) from combat-target. So a `shot` here is turned
      // into the zone the point landed nearest to and handed to
      // combat-target.applyHit, and the resulting action-hit is
      // re-announced, bubbling, as `cutout-hit` for the duel to count.
      // Anything else that raises action-hit (a thrown knife, a fist)
      // reaches the same announcement without more code.
      //
      // Hidden and unshootable until pop(true) (the start signal), and
      // unshootable again once it is down so a lying cutout does not eat
      // the next bullet.
      registerComponent('cardboard-cowboy', {
        schema: {
          color: { type: 'color', default: CARDBOARD_COLOR },
        },
        dependencies: ['steel-silhouette'],

        init: function () {
          this.ready = false;
          this.hideAt = 0;
          this._pt = new THREE.Vector3();
          this._a = new THREE.Vector3();
          this._b = new THREE.Vector3();
          this._ab = new THREE.Vector3();
          this.onShot = this.onShot.bind(this);
          this.onActionHit = this.onActionHit.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('action-hit', this.onActionHit);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('action-hit', this.onActionHit);
        },

        // steel-silhouette builds its body in its own init, which may
        // run after ours; finish setting up the first time it is there.
        ensure: function () {
          if (this.ready) return true;
          var steel = this.el.components['steel-silhouette'];
          var target = this.el.components['combat-target'];
          if (!steel || !target || !steel.body) return false;
          this.steel = steel;
          this.target = target;
          this.ready = true;
          this.paint();
          this.pop(false, true);
          return true;
        },

        // PLACEHOLDER-ASSET: a hand-painted cardboard cutout of a cowboy
        // (a flat texture on the same silhouette) -- the painted rings
        // and hat here are boxes and discs standing in for it.
        paint: function () {
          var body = this.steel.body;
          this.steel.setColor(this.data.color);
          var paintRing = function (inner, outer, y, color) {
            var ring = document.createElement('a-entity');
            ring.setAttribute('geometry', { primitive: 'ring', radiusInner: inner, radiusOuter: outer, segmentsTheta: 16 });
            ring.setAttribute('material', { color: color, shader: 'flat' });
            ring.setAttribute('position', { x: 0, y: y, z: 0.021 });
            body.appendChild(ring);
          };
          // Painted hit areas, one per zone (steel-silhouette's zones).
          paintRing(0.05, 0.11, 1.53, '#a3281f'); // head
          paintRing(0.08, 0.2, 1.03, '#2c2c2c'); // torso
          paintRing(0.04, 0.12, 0.38, '#2c2c2c'); // legs
          var hatPiece = function (w, h, y) {
            var piece = document.createElement('a-entity');
            piece.setAttribute('geometry', { primitive: 'box', width: w, height: h, depth: 0.04 });
            piece.setAttribute('material', { color: '#6b4a2b', flatShading: true });
            piece.setAttribute('position', { x: 0, y: y, z: 0 });
            body.appendChild(piece);
          };
          hatPiece(0.38, 0.03, 1.655); // brim
          hatPiece(0.2, 0.1, 1.71); // crown
        },

        // Closest zone to a world point: the distance to each zone's
        // capsule axis, less its radius.
        zoneAt: function (point) {
          var zones = this.target.worldZones();
          var best = null;
          var bestDist = Infinity;
          var p = this._pt.set(point.x, point.y, point.z);
          for (var i = 0; i < zones.length; i++) {
            var z = zones[i];
            if (z.obstacle) continue;
            var a = this._a.set(z.a.x, z.a.y, z.a.z);
            var ab = this._ab.set(z.b.x - z.a.x, z.b.y - z.a.y, z.b.z - z.a.z);
            var len2 = ab.lengthSq();
            var t = len2 > 1e-9 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / len2)) : 0;
            var closest = a.clone().addScaledVector(ab, t);
            var d = closest.distanceTo(p) - z.r;
            if (d < bestDist) { bestDist = d; best = z.name; }
          }
          return best || 'torso';
        },

        onShot: function (evt) {
          if (!this.ensure() || !this.target.alive || this.target.available === false) return;
          var d = evt.detail || {};
          if (!d.point) return;
          this.target.applyHit({
            zone: this.zoneAt(d.point),
            point: d.point,
            direction: d.direction,
            damage: d.damage === undefined ? 1 : d.damage,
            force: 1,
            source: 'gun',
          });
        },

        onActionHit: function (evt) {
          var hit = evt.detail;
          if (hit.blocked) return;
          if (hit.killed) {
            this.el.classList.remove('shootable');
            this.target.available = false;
          }
          this.el.emit('cutout-hit', {
            id: this.el.id,
            el: this.el,
            zone: hit.zone,
            killed: Boolean(hit.killed),
            point: hit.point,
          }, true);
        },

        // up: appear (the signal). down: fall back and vanish.
        pop: function (up, instant) {
          if (!this.ready && !this.ensure()) return;
          var steel = this.steel;
          if (up) {
            this.hideAt = 0;
            this.el.object3D.visible = true;
            steel.standUp();
            steel.angle = CARDBOARD_DOWN_ANGLE; // spring up from flat
            steel.angleVel = 2;
            steel.restAngle = 0;
            this.target.available = true;
            this.el.classList.add('shootable');
          } else {
            this.el.classList.remove('shootable');
            this.target.available = false;
            steel.restAngle = CARDBOARD_DOWN_ANGLE;
            if (instant) {
              steel.angle = CARDBOARD_DOWN_ANGLE;
              this.el.object3D.visible = false;
            } else {
              this.hideAt = performance.now() + 400;
            }
          }
        },

        isUp: function () { return this.el.classList.contains('shootable'); },

        tick: function () {
          if (!this.ready) { this.ensure(); return; }
          if (this.hideAt && performance.now() >= this.hideAt) {
            this.hideAt = 0;
            this.el.object3D.visible = false;
          }
        },
      });

      // A tossed coin. A start signal in its own right ("draw when it
      // lands"): it flies a plain arc and announces `landed` in the same
      // shape holsterable does ({ speed }), so the signal listens for the
      // event exactly the way anything else interested in a landing
      // would. Not a holsterable on purpose -- nothing can grab it.
      //
      // PLACEHOLDER-ASSET: a real coin model that glints as it turns.
      registerComponent('duel-coin', {
        schema: {
          upSpeed: { type: 'number', default: 5 },
        },

        init: function () {
          this.vy = this.data.upSpeed;
          this.landed = false;
          this.age = 0;
          this.el.object3D.rotation.x = 0.4;
        },

        tick: function (time, dt) {
          var step = Math.min((dt || 16) / 1000, 0.05);
          this.age += step;
          if (this.landed) {
            if (this.age > 3) this.el.parentNode && this.el.parentNode.removeChild(this.el);
            return;
          }
          var o = this.el.object3D;
          this.vy -= 9.8 * step;
          o.position.y += this.vy * step;
          o.rotation.x += 14 * step;
          if (o.position.y <= 0.02 && this.vy < 0) {
            var speed = Math.abs(this.vy);
            o.position.y = 0.02;
            o.rotation.x = Math.PI / 2;
            this.landed = true;
            this.age = 0;
            this.el.emit('landed', { speed: speed }, false);
          }
        },
      });

      var DUEL_TONE_COLORS = { info: '#f4e6c8', go: '#8dff7a', warn: '#ff6a4d', win: '#ffd75e' };

      function duelSound(name) {
        if (typeof playTone !== 'function') return;
        // PLACEHOLDER-ASSET: recorded shout / starter pistol / counting
        // voice / flag whoosh / coin clink. Everything here is a few
        // synthesized oscillators and noise bursts, like the rest of the
        // game's sound (core.js SOUND).
        if (name === 'shout') {
          playTone({ type: 'sawtooth', freq: 190, sweep: 330, duration: 0.3, volume: 0.16 });
          playNoise({ duration: 0.2, freq: 1200, q: 0.7, volume: 0.07 });
        } else if (name === 'tick') {
          playTone({ type: 'square', freq: 640, duration: 0.05, volume: 0.06 });
        } else if (name === 'turn') {
          playTone({ type: 'square', freq: 880, sweep: 1180, duration: 0.18, volume: 0.1 });
        } else if (name === 'bang') {
          playNoise({ duration: 0.28, freq: 900, q: 0.5, volume: 0.45 });
          playTone({ type: 'square', freq: 150, sweep: 45, duration: 0.22, volume: 0.22 });
        } else if (name === 'whoosh') {
          playNoise({ duration: 0.3, freq: 500, q: 0.4, volume: 0.12 });
        } else if (name === 'ping') {
          playTone({ type: 'sine', freq: 1900, sweep: 1500, duration: 0.35, volume: 0.1 });
        } else if (name === 'buzz') {
          playTone({ type: 'sawtooth', freq: 120, duration: 0.35, volume: 0.14 });
        } else if (name === 'ding') {
          playTone({ type: 'sine', freq: 1320, duration: 0.5, volume: 0.1 });
        }
      }

      // The lane a duel is fought in, at the Range. It owns what a duel
      // looks like here (the cardboard cowboys, the board, and the props
      // the start signals use) and exposes it to the persistent director
      // as a small API; the director never reaches into the pieces.
      registerComponent('duel-lane', {
        init: function () {
          this.cutouts = [];
          this.props = [];
          this.buildBoard();
        },

        // PLACEHOLDER-ASSET: a painted wooden scoreboard.
        buildBoard: function () {
          var board = document.createElement('a-entity');
          // High enough that the cutouts' hats (about 1.8 m, 8-11 m out)
          // stay clear of its lower edge from standing eye height.
          board.setAttribute('position', { x: 0, y: 3.05, z: -4.2 });
          var backing = document.createElement('a-box');
          backing.setAttribute('width', 3.7);
          backing.setAttribute('height', 1.75);
          backing.setAttribute('depth', 0.06);
          backing.setAttribute('color', '#2b1d12');
          board.appendChild(backing);
          var make = function (y, attrs) {
            var t = document.createElement('a-entity');
            t.setAttribute('position', { x: 0, y: y, z: 0.04 });
            t.setAttribute('text', Object.assign({ align: 'center', color: DUEL_TONE_COLORS.info, wrapCount: 40 }, attrs));
            board.appendChild(t);
            return t;
          };
          this.titleEl = make(0.7, { value: 'DUEL RANGE', width: 3.1, color: '#d9b36a' });
          this.statusEl = make(0.27, { value: 'Pick a duel from the watch: Duels', width: 3.4 });
          this.bodyEl = make(-0.38, { value: '', width: 3.4, baseline: 'top', anchor: 'center', align: 'center', wrapCount: 52 });
          this.bodyEl.setAttribute('position', { x: 0, y: -0.02, z: 0.04 });
          this.el.appendChild(board);
          this.boardEl = board;
        },

        title: function (text) { this.titleEl.setAttribute('text', 'value', text); },

        status: function (text, tone) {
          this.statusEl.setAttribute('text', { value: text, color: DUEL_TONE_COLORS[tone] || DUEL_TONE_COLORS.info });
          this.statusText = text;
        },

        info: function (lines) {
          var value = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
          this.bodyEl.setAttribute('text', 'value', value);
          this.infoText = value;
        },

        // (Re)build one cardboard cowboy per opponent. An opponent is
        // { x, z } in lane space; each is turned to face the player.
        setup: function (opponents) {
          this.clearCutouts();
          var self = this;
          (opponents || []).forEach(function (o, i) {
            var cut = document.createElement('a-entity');
            cut.setAttribute('id', 'duel-cutout-' + i);
            cut.setAttribute('position', { x: o.x || 0, y: 0, z: o.z || -8 });
            cut.setAttribute('rotation', { x: 0, y: (Math.atan2(-(o.x || 0), -(o.z || -8)) * 180) / Math.PI, z: 0 });
            cut.setAttribute('steel-silhouette', { color: CARDBOARD_COLOR, health: 0.4, death: 'tip', mover: 'none', resetMs: 1e9 });
            cut.setAttribute('cardboard-cowboy', '');
            self.el.appendChild(cut);
            self.cutouts.push(cut);
          });
        },

        clearCutouts: function () {
          this.cutouts.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
          this.cutouts = [];
        },

        popAll: function (up) {
          this.cutouts.forEach(function (c) {
            var comp = c.components['cardboard-cowboy'];
            if (comp) comp.pop(up);
          });
        },

        upCount: function () {
          return this.cutouts.filter(function (c) { return c.classList.contains('shootable'); }).length;
        },

        addProp: function (el) {
          this.el.appendChild(el);
          this.props.push(el);
          return el;
        },

        clearProps: function () {
          this.props.forEach(function (p) { if (p.parentNode) p.parentNode.removeChild(p); });
          this.props = [];
          this.flagEl = null;
        },

        // The world half of a start signal's plan step (the pure half is
        // SIGNAL_KINDS in js/duel-model.js). `fire` is the director's
        // callback for "this is the signal". A step that waits on an
        // event (the coin) calls it when the event arrives; every other
        // firing step calls it right after showing itself.
        signalStep: function (step, fire) {
          var tone = step.fire ? 'go' : 'info';
          if (step.text) this.status(step.text, tone);
          var kind = step.kind;
          if (kind === 'draw-shout') {
            duelSound('shout');
          } else if (kind === 'ten-paces') {
            duelSound(step.fire ? 'turn' : 'tick');
          } else if (kind === 'starter-pistol') {
            if (step.fire) this.fireStarter();
          } else if (kind === 'flag-drop') {
            if (step.fire) this.dropFlag();
            else this.raiseFlag();
          } else if (kind === 'coin-toss') {
            this.tossCoin(fire);
            return;
          }
          if (step.fire) fire();
        },

        // PLACEHOLDER-ASSET: the starter's pistol (a small box gun) and
        // a real muzzle flash; the shot sound is synthesized.
        fireStarter: function () {
          var gun = document.createElement('a-entity');
          gun.setAttribute('position', { x: -1.6, y: 1.9, z: -3.6 });
          var barrel = document.createElement('a-box');
          barrel.setAttribute('width', 0.05); barrel.setAttribute('height', 0.05); barrel.setAttribute('depth', 0.26);
          barrel.setAttribute('color', '#3a3a3f');
          gun.appendChild(barrel);
          var flash = document.createElement('a-sphere');
          flash.setAttribute('radius', 0.1);
          flash.setAttribute('position', { x: 0, y: 0, z: -0.2 });
          flash.setAttribute('material', { color: '#ffd24a', shader: 'flat' });
          gun.appendChild(flash);
          this.addProp(gun);
          duelSound('bang');
          if (typeof spawnSparks === 'function') {
            var p = new THREE.Vector3(-1.6, 1.9, -3.8);
            this.el.object3D.localToWorld(p);
            spawnSparks(p, 6);
          }
          setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 90);
        },

        // PLACEHOLDER-ASSET: a pole and a red cloth flag.
        raiseFlag: function () {
          if (this.flagEl) return;
          var pole = document.createElement('a-entity');
          pole.setAttribute('position', { x: 1.7, y: 0, z: -3.6 });
          var stick = document.createElement('a-box');
          stick.setAttribute('width', 0.05); stick.setAttribute('height', 2.6); stick.setAttribute('depth', 0.05);
          stick.setAttribute('position', { x: 0, y: 1.3, z: 0 });
          stick.setAttribute('color', '#6b4a2b');
          pole.appendChild(stick);
          var flag = document.createElement('a-box');
          flag.setAttribute('width', 0.7); flag.setAttribute('height', 0.42); flag.setAttribute('depth', 0.02);
          flag.setAttribute('position', { x: 0.37, y: 2.35, z: 0 });
          flag.setAttribute('color', '#c0392b');
          pole.appendChild(flag);
          this.addProp(pole);
          this.flagEl = flag;
        },

        dropFlag: function () {
          if (!this.flagEl) this.raiseFlag();
          duelSound('whoosh');
          this.flagEl.setAttribute('animation', { property: 'position', to: '0.37 0.35 0', dur: 280, easing: 'easeInQuad' });
        },

        // PLACEHOLDER-ASSET: a gold coin model.
        tossCoin: function (fire) {
          var coin = document.createElement('a-cylinder');
          coin.setAttribute('radius', 0.03);
          coin.setAttribute('height', 0.006);
          coin.setAttribute('color', '#e8c14a');
          coin.setAttribute('position', { x: 0, y: 1.4, z: -2.2 });
          coin.setAttribute('duel-coin', '');
          coin.addEventListener('landed', function () {
            duelSound('ping');
            fire();
          }, { once: true });
          this.addProp(coin);
          duelSound('ping');
          this.coinEl = coin;
        },

        remove: function () {
          this.clearCutouts();
        },
      });
