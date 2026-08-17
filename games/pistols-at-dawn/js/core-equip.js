      // ==============================================================
      // CORE: equip
      // The generic hold/holster/dangle/throw/catch contract every
      // grabbable item plugs into (holsterable, anchor-slot), and the
      // two things worn on the body that carry their own slots
      // (body-anchor, belt; vests build on the same contracts in
      // items-throwing-weapons.js). Split out of game.js — see DESIGN.md's
      // "File structure" section. GRAVITY, GROUND_REST_Y, and the
      // shared ballistics helpers (computeThrowVelocity and friends)
      // stay in game.js because they're genuinely used outside this
      // system too (particles, the bow's arc solve).
      // ==============================================================

      var GRAB_RADIUS = 0.15; // meters — how close a hand must be to pick something up
      var HIP_HEIGHT = 0.9; // meters off the ground
      var HIP_SIDE_OFFSET = 0.18; // meters, left/right from body centerline
      var BACK_HEIGHT = 1.3; // meters off the ground — the bandolier's anchor sits higher up the torso than the hips
      var BACK_DEPTH_OFFSET = 0.3; // meters behind the body centerline — the headset sits at the FRONT of your head, so a small offset puts the bandolier inside your chest and makes the shotgun nearly impossible to reach
      var CHEST_HEIGHT = 1.24;
      var CHEST_DEPTH_OFFSET = -0.18; // local -Z is forward: reachable without putting the vest inside the ghost torso
      var BELT_TUBE_RADIUS = 0.012;
      var BELT_COLOR = '#4a3220'; // matches the hip holster leather
      var BELT_BUCKLE_COLOR = '#c9962c'; // matches other brass trim (e.g. boxy-sniper's trigger)
      var DANGLE_GRAVITY_TORQUE = 2.5; // how insistently a dangling gun swings back to hanging straight down
      var DANGLE_INERTIA_SCALE = 6; // how strongly flicking your hand imparts spin — crank this up further if it still feels weak
      var DANGLE_DAMPING = 0.999; // per-frame angular velocity decay while swinging — close to 1 = low friction, keeps spinning
      var MAX_ANGULAR_VELOCITY = 40; // rad/s safety clamp so one noisy tracking spike can't fling it into nonsense
      var FALL_DAMPING = 0.99; // per-frame angular velocity decay while tumbling to the ground
      // ==============================================================
      // ANCHOR SLOTS
      // Any object holsterable declares an itemSize; any anchor
      // declares a slot size. Small fits in small/medium/large, medium
      // fits medium/large, large fits large only — see the "rank"
      // ordering below. Every distance here (how close counts as "in
      // range to snap," how far out the indicator sphere starts
      // reacting) scales with the slot's own size, so a big slot like
      // the bandolier stays proportionally as generous as a small
      // holster rather than sharing one flat radius for everything.
      // ==============================================================
      var SLOT_SIZE_RANK = { small: 0, medium: 1, large: 2 };
      var SLOT_COLOR = { small: '#ffd93d', medium: '#3ddc84', large: '#2196f3' };
      var SLOT_SPHERE_BASE_RADIUS = { small: 0.03, medium: 0.045, large: 0.06 }; // idle indicator size
      var SLOT_SPHERE_MAX_RADIUS = { small: 0.055, medium: 0.075, large: 0.095 }; // indicator size once a carried item is close enough to snap
      var SLOT_SNAP_RADIUS = { small: 0.22, medium: 0.32, large: 0.45 }; // meters — how close a released/thrown item needs to be to anchor here
      var SLOT_APPROACH_RADIUS = { small: 0.42, medium: 0.55, large: 0.75 }; // meters — how far out the indicator starts growing at all
      var SLOT_CLICK_DUR_MS = 220; // ms — fast "click into place" indicator bounce: overshoot, undershoot, settle

      // ==============================================================
      // findCatchingHand
      // Generous catch detection for anything falling/flying (a
      // dropped or thrown holsterable prop — this doesn't know or care
      // which one, it just checks `.hand` elements' public hand-rig
      // state). An EMPTY hand can catch by gripping within
      // THROW_CATCH_RADIUS, or by resting a finger on the trigger in
      // that same radius. A busy hand never passively grows a stack;
      // stacking is reserved for hand-rig's explicit quick re-grip.
      // ==============================================================
      function findCatchingHand(worldPos, radius, isWeapon) {
        var hands = document.querySelectorAll('.hand');
        var handPos = new THREE.Vector3();
        var best = null;
        var bestDist = radius;

        for (var i = 0; i < hands.length; i++) {
          var handEl = hands[i];
          var handRig = handEl.components['hand-rig'];
          if (!handRig) continue;
          if (handRig.isFull()) continue;
          if (handRig.heldObjects.length || handRig.danglingObjects.length || handRig.supportObjects.length) continue;
          if (isWeapon && handRig.hasWeapon()) continue;

          var mode = handRig.gripHeld ? 'grip' : handRig.fingerOnTrigger ? 'trigger' : null;
          if (!mode) continue;

          handEl.object3D.getWorldPosition(handPos);
          var d = handPos.distanceTo(worldPos);
          if (d < bestDist) {
            bestDist = d;
            best = { handEl: handEl, mode: mode };
          }
        }

        return best;
      }

      // ==============================================================
      // findContainerHolsterable
      // Walks a slot entity's object3D ancestors (NOT the DOM — a
      // holsterable object's DOM parent is left alone when it's
      // reparented at runtime, see holsterable's own comment) to find
      // the holsterable component of whatever object this slot is
      // physically attached to, if any. Returns null for a slot that's
      // just a free-standing body anchor (hips, head, back) rather
      // than a slot nested inside another grabbable item (like the
      // hat's inner slot) — that distinction is exactly what
      // findCatchingSlot uses to decide what's allowed to passively
      // "catch" a falling item and what isn't.
      // ==============================================================
      function findContainerHolsterable(slotEl) {
        var node = slotEl.object3D.parent;
        while (node) {
          if (node.el && node.el.components && node.el.components.holsterable) {
            return node.el.components.holsterable;
          }
          node = node.parent;
        }
        return null;
      }

      // ==============================================================
      // findCatchingSlot
      // The "throw your gun up, take off your hat, and use it to catch
      // the gun" mechanic. Only a slot that's nested inside another
      // object AND currently actively gripped in a hand (state ===
      // 'held', per findContainerHolsterable) counts — a slot worn,
      // holstered, or resting is a deliberate-release target only (see
      // holsterable.tryHolsterElse/findNearestSlot), not a passive
      // basket that scoops up anything that flies near it.
      // ==============================================================
      function findCatchingSlot(worldPos, itemSize) {
        var itemRank = SLOT_SIZE_RANK[itemSize];
        var slots = document.querySelectorAll('.anchor-slot');
        var slotPos = new THREE.Vector3();
        var best = null;
        var bestDist = Infinity;

        for (var i = 0; i < slots.length; i++) {
          var slotEl = slots[i];
          var slotComp = slotEl.components['anchor-slot'];
          if (!slotComp || slotComp.isFull()) continue;

          var slotRank = SLOT_SIZE_RANK[slotComp.data.size];
          if (slotRank < itemRank) continue;

          var container = findContainerHolsterable(slotEl);
          if (!container || container.state !== 'held') continue;

          slotEl.object3D.getWorldPosition(slotPos);
          var d = slotPos.distanceTo(worldPos);
          if (d < SLOT_SNAP_RADIUS[slotComp.data.size] && d < bestDist) {
            best = slotEl;
            bestDist = d;
          }
        }

        return best;
      }

      // ==============================================================
      // clickEnvelope
      // A fast "click into place" bounce for the anchor-slot indicator
      // sphere: rises past its target size, dips back below it, then
      // settles — a quick buzz rather than a dramatic wiggle, since
      // controller vibration doesn't reliably work everywhere. Input
      // t is 0..1 progress through SLOT_CLICK_DUR_MS; output is a
      // multiplier on the sphere's fully-expanded radius.
      // ==============================================================
      function clickEnvelope(t) {
        if (t < 0.35) return 1 + 0.35 * (t / 0.35); // quick rise to 1.35x (overshoot)
        if (t < 0.7) return 1.35 - 0.55 * ((t - 0.35) / 0.35); // fall through to 0.8x (undershoot)
        return 0.8 + 0.2 * ((t - 0.7) / 0.3); // settle back to 1x
      }
      // ==============================================================
      // COMPONENT: body-anchor
      // Drives an invisible entity to sit at roughly a fixed spot on
      // the player's body, following the headset's horizontal position
      // and yaw only (deliberately ignoring pitch/roll, so looking up
      // or tilting your head doesn't drag it around) — there's no real
      // body tracking on a Quest, so this is an approximation for both
      // spots it's used for: the waist and the back-center bandolier
      // point. Also builds each spot's own bit of simple "boxy" flavor
      // geometry (a diagonal strap for the back; the waist gets none —
      // see `belt`, which is what's actually visible there) so it's
      // visually obvious where things are meant to go — purely
      // cosmetic, no bearing on the actual anchor-slot component
      // (added separately in markup) that does the real snapping work.
      //
      // The two hips used to be a third/fourth case here (side: left/
      // right), each with its own holster-pouch flavor geometry. Both
      // moved onto `belt` instead — a belt is what actually carries hip
      // slots now, built at ±HIP_SIDE_OFFSET in ITS OWN local frame, so
      // a body-anchor for "the left hip" specifically stopped meaning
      // anything once the belt could be swapped out from under it.
      // ==============================================================
      registerComponent('body-anchor', {
        schema: {
          side: { type: 'string', default: 'waist' }, // 'waist' | 'back' | 'chest'
        },

        init: function () {
          this.camera = document.querySelector('#head-camera');
          this.camPos = new THREE.Vector3();
          this.camQuat = new THREE.Quaternion();
          this.camEuler = new THREE.Euler();
          this.offsetVec = new THREE.Vector3();

          if (this.data.side === 'back') {
            this.localOffset = new THREE.Vector3(0, 0, BACK_DEPTH_OFFSET); // local +Z is behind the player
            this.height = BACK_HEIGHT;
          } else if (this.data.side === 'chest') {
            this.localOffset = new THREE.Vector3(0, 0, CHEST_DEPTH_OFFSET);
            this.height = CHEST_HEIGHT;
          } else {
            this.localOffset = new THREE.Vector3(0, 0, 0);
            this.height = HIP_HEIGHT;
          }

          this.buildProps();
        },

        tick: function () {
          if (!this.camera || !this.camera.object3D) return;

          this.camera.object3D.getWorldPosition(this.camPos);
          this.camera.object3D.getWorldQuaternion(this.camQuat);
          this.camEuler.setFromQuaternion(this.camQuat, 'YXZ');
          var yaw = this.camEuler.y;

          this.offsetVec.copy(this.localOffset).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

          this.el.object3D.position.set(
            this.camPos.x + this.offsetVec.x,
            this.height,
            this.camPos.z + this.offsetVec.z
          );
          this.el.object3D.rotation.set(0, yaw, 0);
        },

        // Cheap, "shitty" flavor geometry — just the back's diagonal
        // bandolier strap now (see the class comment for where the
        // hips' holster pouches went). Estimated proportions, not
        // measured against a real body; expect this to want eyes-on
        // tuning.
        buildProps: function () {
          if (this.data.side !== 'back') return;

          var strap = document.createElement('a-box');
          strap.setAttribute('width', 0.09);
          strap.setAttribute('height', 0.9);
          strap.setAttribute('depth', 0.03);
          strap.setAttribute('color', '#5b3a29');
          strap.setAttribute('rotation', '0 0 35');
          this.el.appendChild(strap);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-belt
      // What a belt looks like: a ring at the ghost's own pill radius
      // (so it wraps the body snugly regardless of which belt is worn)
      // plus a buckle on the front. Schema'd by color so belt-classic
      // and belt-silver (see the item makers) are one component with
      // two paint jobs, not two components.
      // ==============================================================
      registerComponent('boxy-belt', {
        schema: {
          color: { type: 'string', default: BELT_COLOR },
          buckleColor: { type: 'string', default: BELT_BUCKLE_COLOR },
        },

        init: function () {
          var el = this.el;

          var ring = document.createElement('a-torus');
          ring.setAttribute('radius', GHOST_RADIUS);
          ring.setAttribute('radius-tubular', BELT_TUBE_RADIUS);
          ring.setAttribute('color', this.data.color);
          ring.setAttribute('rotation', '90 0 0');
          el.appendChild(ring);

          var buckle = document.createElement('a-box');
          buckle.setAttribute('width', 0.05);
          buckle.setAttribute('height', 0.04);
          buckle.setAttribute('depth', 0.015);
          buckle.setAttribute('color', this.data.buckleColor);
          buckle.setAttribute('position', { x: 0, y: 0, z: -GHOST_RADIUS }); // -Z is the front, same convention as everything else
          el.appendChild(buckle);
        },
      });

      var beltHipSerial = 0; // unique ids for each belt's own hip slots — see the id comment inside belt's init

      // ==============================================================
      // COMPONENT: belt
      // What a belt DOES: carries its own two hip anchor-slots (small,
      // pistol-sized, at ±HIP_SIDE_OFFSET — the exact spot the old
      // standalone hip-left/hip-right body-anchors used to sit) so that
      // holstering is still "release near your hip" no matter which
      // belt is currently worn.
      //
      // The waist anchor it's worn on (see markup) has anchor-slot's
      // `swap` flag set, so putting a new belt on doesn't require
      // taking the old one off by hand first — holsterable.occupySlot
      // evicts it automatically. That alone would just drop your guns
      // on the floor along with the belt, though, which is why this
      // listens for the 'displaced' event occupySlot fires right
      // before evicting: the OLD belt gets first refusal to hand its
      // hip contents on to the NEW one, matched left-to-left and
      // right-to-right by build order.
      // ==============================================================
      registerComponent('belt', {
        schema: {
          stockHips: { type: 'boolean', default: false }, // only the belt that starts already worn needs its hips pre-stocked with pistols — see markup
        },

        init: function () {
          var el = this.el;
          this.hipSlots = [];

          [-1, 1].forEach(function (side) {
            var slot = document.createElement('a-entity');
            slot.setAttribute('id', 'belt-hip-' + beltHipSerial++); // stocked/makeItem require a real id to build into — an easy silent no-op to miss, see makeItem's own early-out
            slot.classList.add('anchor-slot');
            slot.setAttribute('anchor-slot', 'size: small');
            slot.setAttribute('position', { x: side * HIP_SIDE_OFFSET, y: 0, z: 0 });
            if (this.data.stockHips) slot.setAttribute('stocked', 'item: pistol');
            el.appendChild(slot);
            this.hipSlots.push(slot);
          }, this);

          this.onDisplaced = this.onDisplaced.bind(this);
          el.addEventListener('displaced', this.onDisplaced);
        },

        remove: function () {
          this.el.removeEventListener('displaced', this.onDisplaced);
        },

        onDisplaced: function (evt) {
          var newBelt = evt.detail.by.components.belt;
          if (!newBelt) return; // whatever replaced this wasn't a belt (shouldn't happen — only belts fit the waist anchor's medium size the way a belt does — but nothing here should assume it)

          this.hipSlots.forEach(function (oldSlotEl, i) {
            var newSlotEl = newBelt.hipSlots[i];
            var oldSlotComp = oldSlotEl.components['anchor-slot'];
            if (!oldSlotComp || !newSlotEl) return;

            // Slice a copy first — vacateSlot (called via occupySlot's
            // own swap handling, since the new hip slot isn't a swap
            // slot itself but IS currently empty) mutates the array
            // we'd otherwise be iterating.
            oldSlotComp.occupants.slice().forEach(function (occupant) {
              occupant.vacateSlot();
              occupant.state = 'holstered';
              occupant.snapTo(newSlotEl.object3D, occupant.data.holsterPosition, occupant.data.holsterRotation);
              occupant.occupySlot(newSlotEl);
            });
          });
        },
      });

      // ==============================================================
      // COMPONENT: anchor-slot
      // The generic "you can snap a compatible item here" socket.
      // Purely declarative on its own (just a size — small/medium/
      // large) plus a translucent sphere that visually marks the spot
      // and reacts as a compatible carried item approaches; the actual
      // matching/snapping logic lives in holsterable (findNearestSlot)
      // and the free functions above (findCatchingSlot). `occupants`
      // is the one piece of real state here: the holsterable
      // components currently claiming this slot, so items can't pile
      // invisibly into the same spot and so the indicator hides itself
      // once the slot is full.
      //
      // Capacity is what turns "your mouth" into a place five cigars
      // can go at once (see the mouth-anchor in markup) without a
      // single line of cigar-specific code — the occupants are simply
      // fanned out around the slot's origin by fanSpread/fanYaw, and
      // reflow() re-fans everything whenever one arrives or leaves, so
      // pulling the middle cigar out closes the gap.
      // ==============================================================
      registerComponent('anchor-slot', {
        schema: {
          size: { type: 'string', default: 'small' }, // 'small' | 'medium' | 'large'
          capacity: { type: 'number', default: 1 },
          fanSpread: { type: 'number', default: 0.045 }, // meters between stacked occupants
          fanAxis: { type: 'string', default: 'x' }, // which of the slot's own axes they spread along. A row of cigars in your teeth goes across (x); arrows on a bowstring go up it (y)
          fanYaw: { type: 'number', default: 0 }, // degrees of splay per step — only meaningful for things with a long axis, like cigars or barrels
          idleHidden: { type: 'boolean', default: false }, // hide the indicator entirely until a compatible item is on the way in
          indicatorScale: { type: 'number', default: 1 }, // shrink the indicator sphere — a slot right in front of your eyes wants to be a dot, not a ball
          revealDistance: { type: 'number', default: 0 }, // with idleHidden, how close a compatible item must be before the indicator appears at all (0 = the slot's usual approach radius)
          swap: { type: 'boolean', default: false }, // a full slot normally just isn't a candidate (see holsterable.findNearestSlot) — a swap slot stays one, and holsterable.occupySlot evicts whatever was there instead of refusing the newcomer. Built for the waist anchor (see `belt`), so bringing a new belt to an already-worn one replaces it rather than needing it taken off by hand first.
        },

        init: function () {
          this.occupants = [];
          this.wasInRange = false;
          this.clickElapsed = null; // ms into the click bounce, or null when idle

          this.sphere = document.createElement('a-sphere');
          this._shownRadius = SLOT_SPHERE_BASE_RADIUS[this.data.size] * this.data.indicatorScale;
          this._shownOpacity = 0.35;
          this.sphere.setAttribute('radius', this._shownRadius);
          this.sphere.setAttribute(
            'material',
            'color: ' + SLOT_COLOR[this.data.size] + '; shader: flat; opacity: 0.35; transparent: true; depthWrite: false'
          );
          this.el.appendChild(this.sphere);

          this._slotPos = new THREE.Vector3();
          this._itemPos = new THREE.Vector3();
        },

        isFull: function () {
          return this.occupants.length >= this.data.capacity;
        },

        // Called by holsterable whenever this slot's contents change.
        // Re-poses every occupant for its new index in the fan; each
        // one blends there via its own snapTo, so items shuffle over
        // to make room rather than teleporting.
        reflow: function () {
          var self = this;
          this.occupants.forEach(function (holsterable, i) {
            holsterable.setSlotStack(i, self.occupants.length);
            holsterable.applySlotPose(self.el);
          });
        },

        tick: function (time, dt) {
          // A swap slot stays "live" even while full — the indicator
          // should still glow as a replacement approaches, the same
          // invitation an empty slot gives.
          if (this.isFull() && !this.data.swap) {
            this.sphere.setAttribute('visible', false);
            this.wasInRange = false;
            this.clickElapsed = null;
            return;
          }

          var nearestDist = this.findNearestCompatibleHeldDistance();
          var snapRadius = SLOT_SNAP_RADIUS[this.data.size];
          var approachRadius = SLOT_APPROACH_RADIUS[this.data.size];

          // A slot sitting right in front of your eyes (the mouth)
          // would otherwise be a permanent bright ball in the middle
          // of your vision — the approach radius is nearly half a
          // meter, and anything you carry passes through that
          // constantly. So idleHidden slots can set their own, much
          // tighter, reveal distance.
          var revealDist = this.data.revealDistance || approachRadius;
          if (this.data.idleHidden && nearestDist > revealDist && this.clickElapsed === null) {
            this.sphere.setAttribute('visible', false);
            this.wasInRange = false;
            return;
          }
          this.sphere.setAttribute('visible', true);

          var baseR = SLOT_SPHERE_BASE_RADIUS[this.data.size];
          var maxR = SLOT_SPHERE_MAX_RADIUS[this.data.size];

          var inRange = nearestDist <= snapRadius;
          if (inRange && !this.wasInRange) this.clickElapsed = 0;
          this.wasInRange = inRange;

          var t = 0;
          if (isFinite(nearestDist)) {
            t = 1 - (nearestDist - snapRadius) / (approachRadius - snapRadius);
            t = Math.min(Math.max(t, 0), 1);
          }
          var radius = (baseR + (maxR - baseR) * t) * this.data.indicatorScale;
          var opacity = 0.25 + (0.6 - 0.25) * t;

          if (this.clickElapsed !== null) {
            this.clickElapsed += dt || 16;
            if (this.clickElapsed >= SLOT_CLICK_DUR_MS) {
              this.clickElapsed = null;
            } else {
              radius = maxR * this.data.indicatorScale * clickEnvelope(this.clickElapsed / SLOT_CLICK_DUR_MS);
              opacity = 0.6;
            }
          }

          this.setIndicator(radius, opacity);
        },

        // Writing `radius` rebuilds the sphere's geometry outright, so
        // it's only written when the number has actually moved. That
        // was free with five slots in the scene; with the armoury's
        // rack of empty sockets — none of which are ever full, so none
        // of which take the early-out above — it's forty spheres a
        // frame being rebuilt to the same size they already were.
        setIndicator: function (radius, opacity) {
          if (Math.abs(radius - this._shownRadius) > 0.0004) {
            this._shownRadius = radius;
            this.sphere.setAttribute('radius', radius);
          }
          if (Math.abs(opacity - this._shownOpacity) > 0.004) {
            this._shownOpacity = opacity;
            this.sphere.setAttribute('material', 'opacity', opacity);
          }
        },

        // Nearest currently-HELD (actively gripped, not dangling —
        // that's a twirl in progress, not "aiming for a slot")
        // grabbable item whose itemSize actually fits this slot.
        // Infinity if nothing qualifies, which reads as "stay idle."
        // Reads the shared HELD_ITEMS snapshot rather than searching
        // the scene itself — see that list's comment.
        findNearestCompatibleHeldDistance: function () {
          if (!HELD_ITEMS.length) return Infinity;

          var slotRank = SLOT_SIZE_RANK[this.data.size];
          var best = Infinity;
          this.el.object3D.getWorldPosition(this._slotPos);

          for (var i = 0; i < HELD_ITEMS.length; i++) {
            if (HELD_ITEMS[i].rank > slotRank) continue;
            var d = HELD_ITEMS[i].pos.distanceTo(this._slotPos);
            if (d < best) best = d;
          }

          return best;
        },
      });

      // ==============================================================
      // COMPONENT: holsterable
      // The shared state machine and physics behind every grabbable
      // prop in the scene (currently the two pistols and the hat):
      //   holstered -> held (grabbed) -> dangling (grip released while
      //   a finger is still resting on the trigger) -> held again
      //   (caught) or holstered/falling (finger comes off the trigger
      //   too — holstered if that happens near a matching anchor,
      //   falling otherwise) -> resting (on the ground, grabbable
      //   again).
      //
      //   Releasing the grip with NO finger on the trigger and a
      //   deliberate upward hand speed is a throw instead — same
      //   "falling" state, just seeded with a real launch velocity
      //   (see release()/throwWithVelocity()/computeThrowVelocity()).
      //   A calm release with no throw checks the holster immediately
      //   (see release()). A release WITH a finger still on the
      //   trigger always dangles, deliberately skipping both the throw
      //   and holster checks at that moment — those only happen later,
      //   in endDangle(), when the finger actually comes off the
      //   trigger. That's what lets a dangling, spinning object be
      //   aimed into its holster as its own move, rather than only
      //   ever holstering from a plain grip-release.
      //
      //   While falling (dropped OR thrown — same state), it's
      //   generously catchable by either hand: see checkCatch(),
      //   catchThrown(), and catchIntoDangle().
      //
      // Schema is what makes this reusable rather than gun-specific:
      // itemSize is this object's size class (small/medium/large) —
      // see findNearestSlot for how that decides which anchor-slot
      // entities in the scene it's allowed to snap into, generically,
      // with no per-object list of "which holsters" to maintain;
      // holsterPosition/holsterRotation and heldPosition/heldRotation
      // are the local poses snapped to when holstered/held (the same
      // holsterPosition/holsterRotation apply no matter which slot it
      // lands in — a gun tucked into a hat ends up in the same jaunty
      // barrel-down pose it holsters at your hip in, which is a
      // feature, not a bug, for a game this silly); grabRadius is how
      // close a hand needs to be to pick it up (wider than the
      // object's own origin-to-edge distance for something like the
      // hat, whose origin sits well inside its visual silhouette — see
      // the hat's markup comment); comOffset is where this object's
      // true center of mass sits
      // relative to its own entity origin. That origin, per
      // boxy-gun/boxy-hat, is deliberately NOT the object's geometric
      // center but its natural grip/pivot point — the trigger guard
      // for a gun, one edge of the inner brim for a hat — and comOffset
      // (which the dangle physics uses to work out which way "down"
      // pulls it) is the whole reason the same twirl mechanic works
      // for a completely different-shaped object with zero
      // object-specific physics code.
      //
      // Every "snap into a new spot" transition (grab, holster, catch)
      // goes through snapTo(), which blends smoothly over
      // SNAP_BLEND_DUR_MS rather than popping instantly into place —
      // see snapTo/updatePoseBlend.
      //
      // Visual geometry (boxy-gun, boxy-hat, boxy-bottle, boxy-cigar)
      // is a separate component attached alongside this one in markup
      // — this component neither knows nor cares what the object looks
      // like. Behavior isn't here either: firing (firearm), drinking
      // (bottle), and lighting (cigar) are all small companion
      // components that read this one's state and, at most, write into
      // its extraPitchDeg. That's why a bottle is a gun that can't
      // shoot and a cigar is a bottle you can't drink — they're the
      // same object with different companions bolted on.
      //
      // Reparenting is done directly on the three.js object3D graph
      // via Object3D.attach(), which reparents while preserving the
      // object's current world transform — the DOM tree is left alone,
      // since nothing here depends on DOM nesting.
      // ==============================================================
      registerComponent('holsterable', {
        schema: {
          holsterSelector: { type: 'selector' }, // starting holster anchor
          itemSize: { type: 'string', default: 'small' }, // 'small' | 'medium' | 'large' — which anchor-slot sizes this object fits into
          holsterPosition: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          holsterRotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          heldPosition: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          heldRotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          grabRadius: { type: 'number', default: GRAB_RADIUS },
          grabPriority: { type: 'number', default: 0 }, // lower wins before distance; worn equipment opts into larger values so its contents are drawn first
          // Most props are grabbed by their one natural handle, so the
          // grab test is a sphere around the origin. Long thin ones are
          // not: an arrow's origin is at its nock, and being unable to
          // pick one up by the middle of the shaft is maddening.
          // grabSpan is a second point in local space, and the test
          // becomes the distance to the SEGMENT between the two — a
          // capsule rather than a ball, for a couple of dot products.
          grabSpan: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          comOffset: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // center of mass, relative to the entity origin
          maxThrowSpeed: { type: 'number', default: OVERHAND_MAX_DEFAULT_SPEED }, // how hard this particular object can be thrown, whatever your arm does
          gravityScale: { type: 'number', default: 1 }, // multiplies gravity while falling — under 1 keeps a thrown object up longer, which is what makes shooting bottles out of the air possible
          impactDamage: { type: 'number', default: 1 }, // published on projectile `shot` events; current steel targets only care that they were hit, future damageables can care how hard
          supportGrip: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // local position of a second place to hold this, if any
          supportRadius: { type: 'number', default: 0 }, // 0 disables the second grip entirely
          supportAims: { type: 'boolean', default: true }, // does the second hand steer this? A shotgun forend does — the barrel follows the line between your hands. A bowstring does NOT: the bow hand alone aims it, and the string hand only says how far it's drawn
          supportGrab: { type: 'string', default: 'grip' }, // 'grip' or 'trigger' — which button the second hand uses. A forend is held; a bowstring is drawn, and drawing wants the finger that shoots so that gripping can still mean "take the arrow off it"
        },

        init: function () {
          this.state = 'holstered';
          this.hand = null; // the hand entity currently holding/dangling this object
          this.supportHand = null; // a SECOND hand steadying it by its support grip, if it has one
          this.currentSlotEl = null; // the anchor-slot entity this object currently occupies, if holstered

          // Where this object sits in whatever stack currently holds
          // it — a hand's fistful or a slot's fan. Both default to
          // "the only one here," which is the single-item behavior
          // this component had before stacks existed.
          this.stackIndex = 0;
          this.stackCount = 1;
          this.slotIndex = 0;
          this.slotCount = 1;

          // Kept for non-firearm pose effects. Firearm recoil belongs
          // to the hand now (see hand-rig.updateGrip), so the fist and
          // gun kick as one instead of the gun floating in its palm.
          this.extraPitchDeg = 0;
          this._heldElapsed = 0;

          // Whether the last release was a real throw. hand-rig's
          // quick-re-grip window reads this so that re-gripping right
          // after flinging a bottle skyward doesn't yank it back out
          // of the air.
          this.wasThrown = false;

          this.angularVelocity = new THREE.Vector3();
          this.fallVelocity = new THREE.Vector3();
          this.catchCooldown = 0; // ms left during which this can't be caught — see throwWithVelocity
          this.impactCooldown = 0; // ms left during which it can't hit anything again — see checkImpact
          this._impactDir = new THREE.Vector3();
          this.prevPivotPos = new THREE.Vector3();
          this.prevPivotVelocity = new THREE.Vector3();

          this._pivot = new THREE.Vector3();
          this._pivotVelocity = new THREE.Vector3();
          this._pivotAccel = new THREE.Vector3();
          this._comLocal = new THREE.Vector3(this.data.comOffset.x, this.data.comOffset.y, this.data.comOffset.z);
          this._comWorld = new THREE.Vector3();
          this._down = new THREE.Vector3(0, -1, 0);
          this._torque = new THREE.Vector3();
          this._deltaQuat = new THREE.Quaternion();
          this._worldPos = new THREE.Vector3();
          this._holsterPos = new THREE.Vector3();
          this._gripWorld = new THREE.Vector3();
          this._supportWorld = new THREE.Vector3();
          this._aimUp = new THREE.Vector3();
          this._supportUp = new THREE.Vector3();
          this._aimForward = new THREE.Vector3();
          this._aimMatrix = new THREE.Matrix4();
          this._aimQuat = new THREE.Quaternion();
          this._parentQuat = new THREE.Quaternion();
          this._supportQuat = new THREE.Quaternion();
          this._twoHandTargetQuat = new THREE.Quaternion();
          this._twoHandQuat = new THREE.Quaternion();
          this._twoHandSeeded = false;
          this._grabA = new THREE.Vector3();
          this._grabB = new THREE.Vector3();
          this._grabAxis = new THREE.Vector3();
          this._grabScratch = new THREE.Vector3();

          // Smooth pose blend (see snapTo/updatePoseBlend). Starts
          // "already finished" so nothing plays on scene load.
          this._poseBlendFromPos = new THREE.Vector3();
          this._poseBlendFromQuat = new THREE.Quaternion();
          this._poseBlendToPos = new THREE.Vector3();
          this._poseBlendToQuat = new THREE.Quaternion();
          this._poseBlendElapsed = SNAP_BLEND_DUR_MS;

          if (this.data.holsterSelector) {
            // The very first placement, at scene load — instant, via
            // attachTo directly, since there's nothing meaningful to
            // blend from before the object has ever been anywhere.
            this.attachTo(this.data.holsterSelector.object3D, this.data.holsterPosition, this.data.holsterRotation);
          }
        },

        // The pose blend runs regardless of state (held or holstered
        // are both valid snap targets) — cheap to check unconditionally
        // since it's a no-op once finished.
        //
        // The initial slot claim (registering this object as the
        // occupant of whatever it starts holstered on) happens here,
        // on the first tick, rather than in init() — init() order
        // across sibling entities isn't guaranteed, so the target
        // anchor-slot's own component might not have attached yet if
        // checked from init(). By the first tick, the whole scene's
        // initial entities are guaranteed live, and object3D.parent.el
        // reliably points back to whatever this object actually ended
        // up parented under (the same "el" back-reference A-Frame
        // already sets on any object3D/mesh, used elsewhere in this
        // file e.g. for scoring-ring's raycast hits).
        tick: function (time, dt) {
          if (!this._didInitialSlotClaim) {
            this._didInitialSlotClaim = true;
            if (this.state === 'holstered' && !this.currentSlotEl) {
              var parentObj = this.el.object3D.parent;
              var parentEl = parentObj && parentObj.el;
              if (parentEl && parentEl.components && parentEl.components['anchor-slot']) {
                this.occupySlot(parentEl);
              }
            }
          }

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          this.updatePoseBlend(dtSeconds);
          if (this.state === 'dangling') {
            this.updateDangle(dtSeconds);
            this.checkSlip(dtSeconds, SLIP_DANGLE_THRESHOLD, SLIP_DANGLE_CHANCE_PER_S);
          } else if (this.state === 'falling') {
            this.updateFall(dtSeconds);
          } else if (this.state === 'held') {
            this.applyHeldPose(time, dtSeconds);
            this.checkSlip(dtSeconds, SLIP_GRIP_THRESHOLD, SLIP_GRIP_CHANCE_PER_S);
          } else {
            this._heldElapsed = 0;
          }
        },

        // The one place a held object's pose is written: the base held
        // pose, its offset in the hand's fan, and whatever recoil kick
        // firearm has asked for. Unsteadiness doesn't appear here at
        // all — the grip this object is parented to is already
        // wobbling (see hand-rig.updateGrip), so it comes along for
        // free and, crucially, the hand and the gun move together.
        // Skipped entirely while a snap blend is running, since the
        // blend owns the pose until it finishes.
        applyHeldPose: function (time, dtSeconds) {
          this._heldElapsed += dtSeconds * 1000;
          if (this._poseBlendElapsed < SNAP_BLEND_DUR_MS) return;
          if (this.supportHand && this.data.supportAims) return this.applyTwoHandedPose(dtSeconds);

          var d = this.data;
          this.el.object3D.position.set(
            d.heldPosition.x + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_SPREAD),
            d.heldPosition.y,
            d.heldPosition.z
          );
          this.el.object3D.rotation.set(
            ((d.heldRotation.x + this.extraPitchDeg) * Math.PI) / 180,
            ((d.heldRotation.y + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_YAW)) * Math.PI) / 180,
            (d.heldRotation.z * Math.PI) / 180
          );
        },

        // Butterfingers. Something dangling off one finger is barely
        // held at all, so it starts getting away from you at a much
        // lower blood alcohol than something in a closed fist — the
        // thresholds and rates are passed in by the caller rather than
        // read here, since "how firmly is this being held" is the
        // state machine's business, not this function's.
        checkSlip: function (dtSeconds, threshold, chancePerSecond) {
          if (VICES.alcohol <= threshold) return;

          var over = (VICES.alcohol - threshold) / (1 - threshold);
          if (Math.random() > over * chancePerSecond * dtSeconds) return;

          if (this.hand) {
            var handRig = this.hand.components['hand-rig'];
            if (handRig) handRig.forget(this.el);
          }
          this.startFalling();
        },

        // Two hands on one gun. The near hand still owns the position
        // — the object stays exactly where your trigger hand is — but
        // the ORIENTATION comes from the line between the two hands,
        // so the barrel points wherever your off hand puts it. That's
        // what makes it steadier: a shotgun braced at two points can't
        // wander the way one on a single wrist does, and the effect
        // falls out of the geometry rather than from any damping.
        //
        // The hand-to-hand line supplies pitch and yaw. Roll uses the
        // average "up" of both grip poses, projected perpendicular to
        // that line, so one noisy controller cannot whip a long rifle
        // around its barrel. The final quaternion is lightly smoothed
        // to absorb tracking chatter without making aim feel gummy.
        applyTwoHandedPose: function (dtSeconds) {
          var d = this.data;
          this.el.object3D.position.set(d.heldPosition.x, d.heldPosition.y, d.heldPosition.z);

          var parent = this.el.object3D.parent;
          if (!parent) return;
          var supportGrip = gripObjectOf(this.supportHand);
          if (!supportGrip) return;

          parent.getWorldPosition(this._gripWorld);
          supportGrip.getWorldPosition(this._supportWorld);
          if (this._gripWorld.distanceToSquared(this._supportWorld) < 0.0004) return;

          this._aimUp.set(0, 1, 0).applyQuaternion(parent.getWorldQuaternion(this._parentQuat));
          this._supportUp.set(0, 1, 0).applyQuaternion(supportGrip.getWorldQuaternion(this._supportQuat));
          this._aimUp.add(this._supportUp);
          this._aimForward.copy(this._supportWorld).sub(this._gripWorld).normalize();
          this._aimUp.addScaledVector(this._aimForward, -this._aimUp.dot(this._aimForward));
          if (this._aimUp.lengthSq() < 0.0001) {
            this._aimUp.set(0, 1, 0).addScaledVector(this._aimForward, -this._aimForward.y);
            if (this._aimUp.lengthSq() < 0.0001) {
              this._aimUp.set(1, 0, 0).addScaledVector(this._aimForward, -this._aimForward.x);
            }
          }
          this._aimUp.normalize();

          // Matrix4.lookAt builds a rotation whose -Z points from eye
          // to target, matching the weapons' barrel axis.
          this._aimMatrix.lookAt(this._gripWorld, this._supportWorld, this._aimUp);
          this._aimQuat.setFromRotationMatrix(this._aimMatrix);

          parent.getWorldQuaternion(this._parentQuat);
          this._twoHandTargetQuat.copy(this._parentQuat.invert()).multiply(this._aimQuat);
          if (!this._twoHandSeeded) {
            this._twoHandQuat.copy(this._twoHandTargetQuat);
            this._twoHandSeeded = true;
          } else {
            this._twoHandQuat.slerp(this._twoHandTargetQuat, 1 - Math.exp(-18 * dtSeconds));
          }
          this.el.object3D.quaternion.copy(this._twoHandQuat);

          if (this.extraPitchDeg) this.el.object3D.rotateX((this.extraPitchDeg * Math.PI) / 180);
        },

        // Distance from a point to the part of this object you could
        // actually take hold of: its origin, or anywhere along its
        // grabSpan if it has one.
        grabDistanceTo: function (worldPos) {
          this.el.object3D.getWorldPosition(this._grabA);
          var span = this.data.grabSpan;
          if (!span.x && !span.y && !span.z) return this._grabA.distanceTo(worldPos);

          this._grabB.set(span.x, span.y, span.z);
          this.el.object3D.localToWorld(this._grabB);

          this._grabAxis.copy(this._grabB).sub(this._grabA);
          var lengthSq = this._grabAxis.lengthSq();
          if (lengthSq < 0.000001) return this._grabA.distanceTo(worldPos);

          var t = this._grabScratch.copy(worldPos).sub(this._grabA).dot(this._grabAxis) / lengthSq;
          t = Math.min(Math.max(t, 0), 1);
          return this._grabScratch.copy(this._grabA).addScaledVector(this._grabAxis, t).distanceTo(worldPos);
        },

        // World position of this object's second grip, if it declares
        // one. Used both to decide whether an off hand is close enough
        // to take hold and to draw the marker showing where it is.
        supportGripWorldPosition: function (out) {
          out.set(this.data.supportGrip.x, this.data.supportGrip.y, this.data.supportGrip.z);
          this.el.object3D.localToWorld(out);
          return out;
        },

        canSupport: function (handEl) {
          if (this.data.supportRadius <= 0) return false;
          if (this.state !== 'held') return false;
          if (this.supportHand || this.hand === handEl) return false;
          return true;
        },

        grabSupport: function (handEl) {
          this.supportHand = handEl;
          this._twoHandSeeded = false;
        },

        // Announced rather than acted on, like everything else here:
        // letting go of a forend means nothing, and letting go of a
        // bowstring means an arrow leaves. holsterable knows about
        // neither.
        releaseSupport: function () {
          if (!this.supportHand) return;
          // Measured BEFORE letting go, obviously — supportDraw is the
          // distance to a hand that is about to stop existing as far as
          // this object is concerned.
          var draw = this.supportDraw();
          this.supportHand = null;
          this._twoHandSeeded = false;
          this.el.emit('support-released', { draw: draw }, false);
        },

        // How far the second hand has been pulled from the first, in
        // metres. Zero when there's nobody on it.
        supportDraw: function () {
          if (!this.supportHand || !this.el.object3D.parent) return 0;
          this.el.object3D.parent.getWorldPosition(this._gripWorld);
          gripObjectOf(this.supportHand).getWorldPosition(this._supportWorld);
          return this._gripWorld.distanceTo(this._supportWorld);
        },

        setHandStack: function (index, count) {
          this.stackIndex = index;
          this.stackCount = count;
        },

        setSlotStack: function (index, count) {
          this.slotIndex = index;
          this.slotCount = count;
        },

        // Snap (blended) into the given slot at this object's current
        // place in that slot's fan. Split out from tryHolsterElse so
        // anchor-slot.reflow can re-pose occupants when the fan
        // changes shape around them.
        applySlotPose: function (slotEl) {
          var slotComp = slotEl.components['anchor-slot'];
          var spread = slotComp ? slotComp.data.fanSpread : 0;
          var yaw = slotComp ? slotComp.data.fanYaw : 0;
          var axis = slotComp ? slotComp.data.fanAxis : 'x';
          var step = fanOffset(this.slotIndex, this.slotCount, spread);
          var d = this.data;

          this.snapTo(
            slotEl.object3D,
            {
              x: d.holsterPosition.x + (axis === 'x' ? step : 0),
              y: d.holsterPosition.y + (axis === 'y' ? step : 0),
              z: d.holsterPosition.z + (axis === 'z' ? step : 0),
            },
            {
              x: d.holsterRotation.x,
              y: d.holsterRotation.y + fanOffset(this.slotIndex, this.slotCount, yaw),
              z: d.holsterRotation.z,
            }
          );
        },

        // Instant reparent + pose set, no blend — used only for the
        // very first placement at scene load. Every runtime transition
        // uses snapTo() instead.
        attachTo: function (parentObject3D, localPos, localRotDeg) {
          parentObject3D.attach(this.el.object3D);
          if (localPos) this.el.object3D.position.set(localPos.x, localPos.y, localPos.z);
          if (localRotDeg) {
            this.el.object3D.rotation.set(
              (localRotDeg.x * Math.PI) / 180,
              (localRotDeg.y * Math.PI) / 180,
              (localRotDeg.z * Math.PI) / 180
            );
          }
        },

        // Reparents (preserving current world pose as the blend's
        // starting local pose, via Object3D.attach), then smoothly
        // interpolates to the given target local pose over
        // SNAP_BLEND_DUR_MS instead of popping there instantly. Used
        // for every runtime "snap into a new spot" moment: grabbing,
        // holstering, and catching something thrown.
        snapTo: function (parentObject3D, targetLocalPos, targetLocalRotDeg) {
          parentObject3D.attach(this.el.object3D);
          this._poseBlendFromPos.copy(this.el.object3D.position);
          this._poseBlendFromQuat.copy(this.el.object3D.quaternion);

          this._poseBlendToPos.set(targetLocalPos.x, targetLocalPos.y, targetLocalPos.z);
          this._poseBlendToQuat.setFromEuler(
            new THREE.Euler(
              (targetLocalRotDeg.x * Math.PI) / 180,
              (targetLocalRotDeg.y * Math.PI) / 180,
              (targetLocalRotDeg.z * Math.PI) / 180
            )
          );
          this._poseBlendElapsed = 0;
        },

        // Same direct-object3D-write approach used throughout this
        // component rather than through A-Frame's animation component,
        // since that animates the core "rotation" component's own
        // cached state — which everything here bypasses by writing
        // object3D.rotation/quaternion directly — and the two caches
        // falling out of sync is exactly the kind of thing that
        // produces an object that's rotated wrong for no visible
        // reason.
        updatePoseBlend: function (dtSeconds) {
          if (this._poseBlendElapsed >= SNAP_BLEND_DUR_MS) return;

          this._poseBlendElapsed = Math.min(this._poseBlendElapsed + dtSeconds * 1000, SNAP_BLEND_DUR_MS);
          var t = this._poseBlendElapsed / SNAP_BLEND_DUR_MS;

          this.el.object3D.position.lerpVectors(this._poseBlendFromPos, this._poseBlendToPos, t);
          this.el.object3D.quaternion.slerpQuaternions(this._poseBlendFromQuat, this._poseBlendToQuat, t);
        },

        // Called by hand-rig: either a fresh pickup (from a holster or
        // the ground) or catching this same object mid-dangle — both
        // are "snap rigidly into this hand" and need no other
        // distinction. vacateSlot() is a no-op unless this object was
        // actually anchored somewhere (holstered state is the only way
        // in to grab(), so it's the one place a slot ever needs to be
        // freed up again).
        grab: function (handEl) {
          this.state = 'held';
          this.hand = handEl;
          this.vacateSlot();
          this.applyHandPose(handEl);
          this.angularVelocity.set(0, 0, 0);
          this.extraPitchDeg = 0;
          this._heldElapsed = 0;
        },

        // The held-hand equivalent of applySlotPose: snap into this
        // hand at whatever place in its fistful this object currently
        // holds. hand-rig calls it again for every item whenever that
        // fistful changes size.
        applyHandPose: function (handEl) {
          var d = this.data;
          this.snapTo(
            gripObjectOf(handEl),
            {
              x: d.heldPosition.x + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_SPREAD),
              y: d.heldPosition.y,
              z: d.heldPosition.z,
            },
            {
              x: d.heldRotation.x,
              y: d.heldRotation.y + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_YAW),
              z: d.heldRotation.z,
            }
          );
        },

        // Called by hand-rig when the hand currently holding this
        // object releases its grip. fingerOnTrigger reflects whether
        // that hand's finger is resting on (not necessarily pulling)
        // the trigger at that moment. See the state-machine comment
        // above for why the holster and throw checks are both skipped
        // here when a finger is still on the trigger.
        //
        // A throw takes priority over the holster check — a real flick
        // upward is a strong, deliberate signal that shouldn't get
        // reinterpreted as "must be holstering" just because it
        // happened near an anchor.
        release: function (fingerOnTrigger) {
          this.wasThrown = false;
          if (fingerOnTrigger) {
            this.startDangling();
            return;
          }

          var throwVelocity = computeThrowVelocity(this.hand, this.stackIndex, this.stackCount, this);
          if (throwVelocity) {
            this.wasThrown = true;
            this.throwWithVelocity(throwVelocity);
            return;
          }

          this.tryHolsterElse(this.startFalling.bind(this));
        },

        // Called directly by hand-rig when the finger lifts off the
        // trigger while this object is dangling from that hand — the
        // moment that decides whether it lands in a holster, gets
        // thrown, or falls. Mirrors release()'s own priority order: a
        // real upward flick while twirling should send it flying,
        // spin and all, not just drop it straight down.
        endDangle: function () {
          this.wasThrown = false;
          var throwVelocity = computeThrowVelocity(this.hand, this.stackIndex, this.stackCount, this);
          if (throwVelocity) {
            this.wasThrown = true;
            this.throwWithVelocity(throwVelocity);
            return;
          }

          this.tryHolsterElse(this.startFalling.bind(this));
        },

        tryHolsterElse: function (fallback) {
          this.el.object3D.getWorldPosition(this._worldPos);
          var nearestSlot = this.findNearestSlot(this._worldPos);

          if (nearestSlot) {
            this.state = 'holstered';
            this.hand = null;
            this.occupySlot(nearestSlot); // claims a place in the fan, then poses to it
            return;
          }

          fallback();
        },

        // Several items released off one finger at once all pivot
        // around the same point, so anything past the first gets a
        // random spin kick — otherwise they'd swing as perfectly
        // synchronized clones and read as one object.
        startDangling: function () {
          this.state = 'dangling';
          this.el.sceneEl.object3D.attach(this.el.object3D);
          this.el.object3D.getWorldPosition(this.prevPivotPos);
          this.prevPivotVelocity.set(0, 0, 0);
          if (this.stackCount > 1) {
            this.angularVelocity.addScaledVector(randomUnitVector(), DANGLE_STACK_KICK);
          }
          // this.hand stays set — we're still dangling from it
        },

        // Called when nothing is left holding this object up: either
        // tryHolsterElse's fallback, or updateDangle's own safety net
        // below if this.hand ever goes missing mid-dangle.
        startFalling: function () {
          this.state = 'falling';
          this.hand = null;
          this.el.sceneEl.object3D.attach(this.el.object3D); // no-op if already world-parented
          this.fallVelocity.set(0, 0, 0);
        },

        // A throw: the same "falling" state a plain drop uses, just
        // seeded with a real (aimed) launch velocity instead of zero,
        // plus a fixed visual tumble so it reads as a toss rather than
        // an object sliding through the air. updateFall's own gravity
        // integration and catch-check take it from here. Seeds a fresh
        // throw's spin, but if it's already spinning faster than the
        // fixed toss tumble (e.g. thrown straight out of a twirl via
        // endDangle), keeps the existing spin rather than clobbering
        // it — a spinning object thrown should keep spinning, just as
        // hard, not reset to a slower default.
        throwWithVelocity: function (velocity) {
          this.state = 'falling';
          this.hand = null;
          this.releaseSupport();
          this.el.sceneEl.object3D.attach(this.el.object3D);
          this.fallVelocity.copy(velocity);
          // Catching is generous by design, which is exactly wrong for
          // the throw where you're trying to get the thing away from
          // you — without this pause a hurled bottle is plucked back
          // out of the air by the hand that just let go of it.
          this.catchCooldown = velocity.isHurl ? HURL_CATCH_COOLDOWN_MS : 0;
          if (VICES.alcohol > 0) {
            // Drunk throws scatter. Same butterfingers idea as
            // checkSlip, applied to the one moment where your aim was
            // going to matter most.
            this.fallVelocity.x += (Math.random() - 0.5) * SLIP_THROW_SPREAD * VICES.alcohol;
            this.fallVelocity.z += (Math.random() - 0.5) * SLIP_THROW_SPREAD * VICES.alcohol;
          }
          if (this.angularVelocity.length() < THROW_SPIN_RATE) {
            this.angularVelocity.set(THROW_SPIN_RATE, 0, 0);
          }
        },

        // Grip-catch: snaps rigidly into handEl, but blends smoothly
        // into the canonical held pose over SNAP_BLEND_DUR_MS instead
        // of an instant snap (see snapTo/updatePoseBlend) — this is
        // the one reserved for something already falling/flying,
        // deliberately different from grab()'s instant pickup snap.
        // Also updates the catching hand's own bookkeeping directly,
        // since this catch wasn't initiated by that hand's own
        // gripdown handler.
        catchThrown: function (handEl) {
          this.state = 'held';
          this.hand = handEl;
          this.angularVelocity.set(0, 0, 0);
          this.extraPitchDeg = 0;
          this._heldElapsed = 0;
          this.applyHandPose(handEl);

          var handRig = handEl.components['hand-rig'];
          if (handRig) handRig.take(this.el);
        },

        // Catches a falling/flying object directly onto handEl's
        // trigger finger, dangling — no grip needed. angularVelocity
        // is deliberately left alone rather than reset: whatever
        // tumble it had mid-flight carries straight into the twirl.
        catchIntoDangle: function (handEl) {
          this.state = 'dangling';
          this.hand = handEl;
          this.el.object3D.getWorldPosition(this.prevPivotPos);
          this.prevPivotVelocity.set(0, 0, 0);

          var handRig = handEl.components['hand-rig'];
          if (handRig) handRig.takeDangling(this.el);
        },

        // Passively caught by a slot belonging to something another
        // hand is actively holding — "use your hat to catch your gun."
        // See findCatchingSlot for the eligibility rules. Lands
        // straight in 'holstered', occupying the slot, blended in via
        // the usual snapTo rather than an instant pop.
        catchIntoSlot: function (slotEl) {
          this.state = 'holstered';
          this.hand = null;
          this.angularVelocity.set(0, 0, 0);
          this.occupySlot(slotEl);
        },

        // Claiming and releasing a place in a slot's fan. Both end in
        // a reflow, so the slot's other occupants shuffle over to make
        // room (or close the gap) rather than staying where they were.
        occupySlot: function (slotEl) {
          this.currentSlotEl = slotEl;
          var slotComp = slotEl.components['anchor-slot'];
          if (!slotComp) return;

          // A swap slot only ever holds one thing. Whatever's already
          // here gets a chance to react first (see `belt`'s own
          // 'displaced' listener, which is how a belt hands its hip
          // contents on to whatever's replacing it) and then falls —
          // same as letting go of anything else, not a special vanish.
          if (slotComp.data.swap) {
            slotComp.occupants.slice().forEach(function (other) {
              if (other === this) return;
              other.el.emit('displaced', { by: this.el });
              other.evict();
            }, this);
          }

          if (slotComp.occupants.indexOf(this) === -1) slotComp.occupants.push(this);
          slotComp.reflow();
        },

        // Forced out of a slot by something else claiming it (see
        // occupySlot's swap handling) — not a throw, not a drop you
        // chose, just no longer holstered. Same end state either way:
        // it falls, and is generously catchable on the way down like
        // anything else in this state.
        evict: function () {
          this.vacateSlot();
          this.startFalling();
        },

        vacateSlot: function () {
          if (!this.currentSlotEl) return;
          var slotComp = this.currentSlotEl.components['anchor-slot'];
          this.currentSlotEl = null;

          if (!slotComp) return;
          var i = slotComp.occupants.indexOf(this);
          if (i !== -1) slotComp.occupants.splice(i, 1);
          this.setSlotStack(0, 1);
          slotComp.reflow();
        },

        // Checked every frame while falling: is either hand positioned
        // and ready (gripping, or fingertip resting on the trigger)
        // within this object's own catch radius? If so, catch it and
        // report true so updateFall skips the rest of this frame's
        // fall physics. The radius scales with grabRadius so a bigger
        // object (like the hat) stays proportionally as generous to
        // catch as it is to grab, instead of falling back to the
        // gun-sized default. Hand-catching is checked first; only if
        // neither hand is ready does a nearby held item's own slot
        // (see findCatchingSlot) get a shot at it.
        checkCatch: function () {
          this.el.object3D.getWorldPosition(this._worldPos);
          var radius = this.data.grabRadius + (THROW_CATCH_RADIUS - GRAB_RADIUS);
          var handMatch = findCatchingHand(this._worldPos, radius, !!this.el.components.firearm);
          if (handMatch) {
            if (handMatch.mode === 'grip') this.catchThrown(handMatch.handEl);
            else this.catchIntoDangle(handMatch.handEl);
            return true;
          }

          var slotEl = findCatchingSlot(this._worldPos, this.data.itemSize);
          if (slotEl) {
            this.catchIntoSlot(slotEl);
            return true;
          }

          return false;
        },

        // Every anchor-slot in the scene this object's itemSize could
        // fit into, that isn't already claimed by something else, and
        // that's within ITS OWN size's snap radius. Among those,
        // "prefer the smallest slot in range, but the closest one
        // among slots of that same size" — a pistol in range of both a
        // hip holster and the (much larger) bandolier goes in the
        // holster, and between two equally-sized options it's whichever
        // is physically nearer. The object3D ancestry walk guards
        // against a future object nesting into a slot that's actually
        // one of its own descendants (not reachable with today's
        // objects, since nothing with a child slot has a small enough
        // itemSize to fit inside its own slot, but cheap to rule out
        // outright rather than rely on that staying true).
        findNearestSlot: function (worldPos) {
          var itemRank = SLOT_SIZE_RANK[this.data.itemSize];
          var slots = document.querySelectorAll('.anchor-slot');
          var best = null;
          var bestRank = Infinity;
          var bestDist = Infinity;

          for (var i = 0; i < slots.length; i++) {
            var slotEl = slots[i];
            var slotComp = slotEl.components['anchor-slot'];
            if (!slotComp) continue;
            if (slotComp.isFull() && slotComp.occupants.indexOf(this) === -1 && !slotComp.data.swap) continue;

            var slotRank = SLOT_SIZE_RANK[slotComp.data.size];
            if (slotRank < itemRank) continue;

            var ancestor = slotEl.object3D;
            var isOwnDescendant = false;
            while (ancestor) {
              if (ancestor === this.el.object3D) {
                isOwnDescendant = true;
                break;
              }
              ancestor = ancestor.parent;
            }
            if (isOwnDescendant) continue;

            slotEl.object3D.getWorldPosition(this._holsterPos);
            var d = this._holsterPos.distanceTo(worldPos);
            if (d > SLOT_SNAP_RADIUS[slotComp.data.size]) continue;

            if (slotRank < bestRank || (slotRank === bestRank && d < bestDist)) {
              best = slotEl;
              bestRank = slotRank;
              bestDist = d;
            }
          }

          return best;
        },

        // Spherical-pendulum-ish swing around a moving pivot (the
        // hand). Because the object's own origin IS the pivot point
        // (see boxy-gun/boxy-hat), position just tracks the hand
        // exactly each frame — only the orientation swings. Gravity
        // pulls the center of mass (comOffset) toward hanging straight
        // down; the pivot's own acceleration (how fast you're flicking
        // your hand around) injects extra spin, which is what makes a
        // sharp wrist flick throw the object into a twirl. This is a
        // tuned-for-feel approximation, not a rigorous rigid-body
        // simulation.
        updateDangle: function (dt) {
          if (!this.hand) {
            this.startFalling();
            return;
          }

          gripObjectOf(this.hand).getWorldPosition(this._pivot);

          this._pivotVelocity.copy(this._pivot).sub(this.prevPivotPos).divideScalar(dt);
          this._pivotAccel.copy(this._pivotVelocity).sub(this.prevPivotVelocity).divideScalar(dt);
          this.prevPivotVelocity.copy(this._pivotVelocity);
          this.prevPivotPos.copy(this._pivot);

          this._comWorld.copy(this._comLocal).applyQuaternion(this.el.object3D.quaternion).normalize();

          this._torque.crossVectors(this._comWorld, this._down).multiplyScalar(DANGLE_GRAVITY_TORQUE);
          this.angularVelocity.addScaledVector(this._torque, dt);

          this._torque.crossVectors(this._comWorld, this._pivotAccel).multiplyScalar(-DANGLE_INERTIA_SCALE);
          this.angularVelocity.addScaledVector(this._torque, dt);

          this.angularVelocity.multiplyScalar(DANGLE_DAMPING);
          if (this.angularVelocity.length() > MAX_ANGULAR_VELOCITY) {
            this.angularVelocity.setLength(MAX_ANGULAR_VELOCITY);
          }

          this.integrateRotation(dt);
          this.el.object3D.position.copy(this._pivot);
          this.el.object3D.position.x += fanOffset(this.stackIndex, this.stackCount, HAND_STACK_SPREAD);
        },

        // Free-fall under gravity — covers both a plain drop (zero
        // initial velocity) and a throw (see throwWithVelocity), since
        // both are just this same integration seeded differently.
        // Keeps whatever spin it had so it tumbles rather than just
        // sinking straight down. Checked every frame for a generous
        // catch (see checkCatch) before falling through to the normal
        // ground-settle.
        updateFall: function (dt) {
          this.fallVelocity.y -= GRAVITY * this.data.gravityScale * dt;
          this.el.object3D.position.addScaledVector(this.fallVelocity, dt);
          this.angularVelocity.multiplyScalar(FALL_DAMPING);
          this.integrateRotation(dt);

          if (this.catchCooldown > 0) {
            this.catchCooldown -= dt * 1000;
          } else if (this.checkCatch()) {
            return;
          }

          this.checkImpact(dt);
          // Impact companions such as arrows and throwing blades can
          // end flight synchronously (and may reparent themselves to
          // what they struck). Do not then interpret their new local Y
          // as a second, ground-level landing in this same frame.
          if (this.state !== 'falling') return;

          if (this.el.object3D.position.y <= GROUND_REST_Y) {
            var impactSpeed = this.fallVelocity.length();
            this.el.object3D.position.y = GROUND_REST_Y;
            this.fallVelocity.set(0, 0, 0);
            this.angularVelocity.set(0, 0, 0);
            this.state = 'resting';
            // Announced rather than acted on: this component has no
            // opinion about what landing hard means. A gun ignores it;
            // a bottle (see breakable) does not.
            this.el.emit('landed', { speed: impactSpeed }, false);
          }
        },

        // ==========================================================
        // PROJECTILES
        // A thrown thing is a slow bullet. Anything moving fast enough
        // casts along the little bit of ground it covered this frame,
        // and if it crosses something shootable it emits the very same
        // `shot` event a pistol would — so a bottle hurled at a target
        // knocks it over, an arrow scores, and none of that needed a
        // word of new target code. What the impact means to the THING
        // THAT HIT is announced separately, as `impact`, and left to
        // whatever companion cares: glass shatters, dynamite goes off,
        // a pistol just clatters onward.
        //
        // The speed floor is what keeps this from being a menace.
        // Setting a gun down on a bar covered in bottles is not an
        // attack, and without a floor every gentle release next to the
        // shelf would smash something.
        // ==========================================================
        checkImpact: function (dt) {
          if (this.impactCooldown > 0) {
            this.impactCooldown -= dt * 1000;
            return;
          }

          var speed = this.fallVelocity.length();
          if (speed < IMPACT_MIN_SPEED) return;

          this._impactDir.copy(this.fallVelocity).divideScalar(speed);
          this.el.object3D.getWorldPosition(this._worldPos);
          // Back up to where it started the frame, so a fast thing
          // can't tunnel through a target between two positions.
          this._worldPos.addScaledVector(this._impactDir, -speed * dt);

          var hit = castShot(this._worldPos, this._impactDir, gatherShootableRoots(), speed * dt + this.data.grabRadius, this.el);
          if (!hit) return;

          this.impactCooldown = IMPACT_COOLDOWN_MS;
          hit.el.emit('shot', {
            point: hit.point.clone(),
            direction: this._impactDir.clone(),
            damage: this.data.impactDamage,
          }, false);
          this.el.emit('impact', {
            point: hit.point.clone(),
            direction: this._impactDir.clone(),
            speed: speed,
            damage: this.data.impactDamage,
            hitEl: hit.el,
          }, false);

          // Whatever it hit took most of the energy out of it. If it
          // was something that ends on contact, its own impact handler
          // has already dealt with it and this is moot.
          this.fallVelocity.multiplyScalar(-0.15);
        },

        // Standard dq/dt = 0.5 * omega-as-pure-quaternion * q integration.
        integrateRotation: function (dt) {
          var q = this.el.object3D.quaternion;
          this._deltaQuat.set(
            this.angularVelocity.x * dt,
            this.angularVelocity.y * dt,
            this.angularVelocity.z * dt,
            0
          );
          this._deltaQuat.multiply(q);
          q.set(
            q.x + 0.5 * this._deltaQuat.x,
            q.y + 0.5 * this._deltaQuat.y,
            q.z + 0.5 * this._deltaQuat.z,
            q.w + 0.5 * this._deltaQuat.w
          ).normalize();
        },
      });

      // buildBelt + the belt item-maker recipes — left behind in
      // game.js during the original core-equip.js split, moved here
      // on a later pass.
      // Belts. `keep: true` because a belt is equipment, not loot — the
      // same reasoning the nozzle gets (see defineItem's own comment):
      // it doesn't perish lying on the floor after being swapped out,
      // it just sits there until picked back up.
      //
      // stockHips is true only for belt-classic, and only because it's
      // the one named directly in the waist anchor's own `stocked` —
      // see markup. Wardrobe spares start empty; swapping one in is
      // what fills its hips, via `belt`'s own 'displaced' handling.
      function buildBelt(el, slotId, color, buckleColor, stockHips) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'medium',
          grabRadius: 0.22,
          grabPriority: 30,
        });
        el.setAttribute('boxy-belt', { color: color, buckleColor: buckleColor });
        el.setAttribute('belt', { stockHips: !!stockHips });
      }

      defineItem(
        'belt-classic',
        function (el, slotId) {
          buildBelt(el, slotId, BELT_COLOR, BELT_BUCKLE_COLOR, true);
        },
        { keep: true }
      );

      defineItem(
        'belt-silver',
        function (el, slotId) {
          buildBelt(el, slotId, '#2b2b2f', '#c9d3d8');
        },
        { keep: true }
      );
