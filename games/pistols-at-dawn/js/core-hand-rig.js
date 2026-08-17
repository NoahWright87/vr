      // ==============================================================
      // CORE: hand-rig
      // The player's hands: grip/trigger bookkeeping, what's held,
      // and proximity haptics. Split out of game.js — see DESIGN.md's
      // "File structure" section.
      // ==============================================================

      var PROXIMITY_HAPTIC_RADIUS = 0.2; // meters — a bit past GRAB_RADIUS, so the buzz gives you a heads-up just before you're in range
      var PROXIMITY_HAPTIC_INTENSITY = 0.15; // 0-1, deliberately light ("slight buzz", not a jolt)
      var PROXIMITY_HAPTIC_PULSE_MS = 60; // re-issued every tick while in range, so this just needs to outlast one frame
      var REGRIP_WINDOW_MS = 400; // release and re-squeeze inside this and you keep what you were holding — see hand-rig.reclaimStash
      var RECOIL_MAX_POSITION = 0.18; // meters; automatic fire can kick hard, but never detach the hand from the arm
      var RECOIL_MAX_ROTATION = 0.7; // radians, about 40 degrees on any local axis
      // ==============================================================
      // gripObjectOf
      // Where an object held by this hand should actually hang. Not
      // the hand entity itself: hand-rig keeps a child "grip" that
      // carries drink sway, cigar tremor, drunk aim drift and recoil
      // (see hand-rig.updateGrip), so that an offset hand takes
      // whatever it's holding along with it instead of the object
      // swimming inside a steady fist.
      // ==============================================================
      function gripObjectOf(handEl) {
        var handRig = handEl && handEl.components['hand-rig'];
        return handRig ? handRig.gripObject3D() : handEl.object3D;
      }
      // ==============================================================
      // COMPONENT: hand-rig
      // Listens to one hand's grip/trigger buttons. Owns the "what am
      // I currently holding" bookkeeping and delegates all the actual
      // state/physics work to the holsterable component on whatever
      // object is involved — completely object-agnostic, it never
      // checks whether that object is a gun, a hat, or anything else.
      // Firing is the one exception: onTriggerDown looks specifically
      // for co-located "firearm" components and calls fire() on each,
      // which is naturally a no-op while holding anything that isn't
      // a gun.
      //
      // A hand can stack up to HAND_CAPACITY props, but only through
      // the deliberate quick re-grip gesture: release and squeeze
      // again inside REGRIP_WINDOW_MS. A continuously closed hand no
      // longer absorbs nearby catches or repeated gripdown events.
      // Weapons are exclusive — a hand containing one cannot add a
      // prop, and a hand containing props cannot add a weapon.
      //
      // It also owns where your hand actually IS, which is not the
      // same thing as where the controller is once you've been
      // drinking. Everything held hangs off a child "grip" entity
      // rather than off this one, and updateGrip below moves that grip
      // around with drink sway, cigar tremor, drunk aim drift and gun
      // recoil. That's why those effects live here rather
      // than in holsterable: a wobble applied per-object made the gun
      // swim inside a perfectly steady fist. Applied to the grip, the
      // hand and everything in it move together, which is what being
      // unsteady actually looks like. The offset goes on a CHILD
      // because tracked-controls rewrites this entity's own pose from
      // the headset every frame and would erase anything written here.
      //
      // Also tracks this hand's own world-space velocity and current
      // button state (gripHeld, fingerOnTrigger) as plain public
      // fields — generic hand-side data that computeThrowVelocity,
      // findCatchingHand, and the smoke wind simulation (all reusable,
      // object-agnostic) read directly rather than going through
      // holsterable-specific accessors.
      // ==============================================================
      registerComponent('hand-rig', {
        schema: {
          visual: { type: 'selector' }, // this hand's cosmetic twin, so the rendered hand shakes too
        },

        init: function () {
          this.heldObjects = []; // objects currently rigidly held by this hand
          this.supportObjects = []; // objects this hand is steadying by their second grip — held, but not by the trigger hand
          this.danglingObjects = []; // objects currently dangling from this hand's trigger finger
          this.stash = []; // what the last release let go of, briefly reclaimable — see reclaimStash
          this.stashTime = 0;
          this.fingerOnTrigger = false; // capacitive touch, not a pull — see triggertouchstart/end below
          this.gripHeld = false; // true for the whole time the grip is squeezed, not just the initial press
          this.triggerHeld = false; // and the same for the trigger, which a bowstring and a hose nozzle both need

          this.velocity = new THREE.Vector3();
          this._prevPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(this._prevPos); // avoid a garbage first-frame velocity spike

          // The grip: a child entity that everything held attaches to,
          // carrying however unsteady this hand currently is.
          this.gripEl = document.createElement('a-entity');
          this.el.appendChild(this.gripEl);

          this._wobbleSeed = Math.random() * 100;
          this._wobble = { x: 0, y: 0, z: 0 };
          this._ghostHand = new THREE.Vector3();
          this._ghostVel = new THREE.Vector3();
          this._handWorld = new THREE.Vector3();
          this._drift = new THREE.Vector3();
          this._handQuat = new THREE.Quaternion();
          this.recoilPosition = new THREE.Vector3(); // independent from vice effects so all offsets stack
          this.recoilRotation = new THREE.Vector3();
          this._recoilScratchPosition = new THREE.Vector3();
          this._recoilScratchRotation = new THREE.Vector3();
          this.gripAnchorWorld = new THREE.Vector3(); // a scenery brace pins the grip child here while its trigger is held
          this.gripAnchored = false;
          this._gripAnchorLocal = new THREE.Vector3();
          this.recoilReturnRate = 8;
          this._ghostSeeded = false;
          this._visualBase = null; // the cosmetic hand mesh's own resting transform, captured once

          this.onGripDown = this.onGripDown.bind(this);
          this.onGripUp = this.onGripUp.bind(this);
          this.onTriggerDown = this.onTriggerDown.bind(this);
          this.onTriggerUp = this.onTriggerUp.bind(this);
          this.onTriggerTouchStart = this.onTriggerTouchStart.bind(this);
          this.onTriggerTouchEnd = this.onTriggerTouchEnd.bind(this);
          this.onFaceButton = this.onFaceButton.bind(this);

          this.el.addEventListener('gripdown', this.onGripDown);
          this.el.addEventListener('gripup', this.onGripUp);
          this.el.addEventListener('triggerdown', this.onTriggerDown);
          this.el.addEventListener('triggerup', this.onTriggerUp);
          this.el.addEventListener('triggertouchstart', this.onTriggerTouchStart);
          this.el.addEventListener('triggertouchend', this.onTriggerTouchEnd);
          // Both face buttons on both controllers do the same thing,
          // so there's nothing to remember about which is which.
          FACE_BUTTON_EVENTS.forEach(function (name) {
            this.el.addEventListener(name, this.onFaceButton);
          }, this);
        },

        remove: function () {
          this.el.removeEventListener('gripdown', this.onGripDown);
          this.el.removeEventListener('gripup', this.onGripUp);
          this.el.removeEventListener('triggerdown', this.onTriggerDown);
          this.el.removeEventListener('triggerup', this.onTriggerUp);
          this.el.removeEventListener('triggertouchstart', this.onTriggerTouchStart);
          this.el.removeEventListener('triggertouchend', this.onTriggerTouchEnd);
          FACE_BUTTON_EVENTS.forEach(function (name) {
            this.el.removeEventListener(name, this.onFaceButton);
          }, this);
        },

        // Smoothed (50%-blended) world-space velocity, so a single
        // noisy tracking frame right at release doesn't get read as a
        // huge spurious throw speed.
        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          if (dtSeconds <= 0) return;

          this.el.object3D.getWorldPosition(this._handWorld);
          this._drift.copy(this._handWorld).sub(this._prevPos).divideScalar(dtSeconds);
          this.velocity.lerp(this._drift, 0.5);
          this._prevPos.copy(this._handWorld);

          this.updateGrip(time, dtSeconds);
        },

        // Where your hand really is this frame. Two contributions,
        // both from VICES and both applied to the grip child:
        //
        //   - the tremor/sway, straight out of viceWobble, as a small
        //     rotation (nicotine is fast and tight, alcohol slow and
        //     wide);
        //   - drunk aim drift, a spring-damped "ghost hand" chasing
        //     your real one. It's deliberately under-damped, so at
        //     speed your hand trails behind you and then swings past
        //     where you stopped. Driven entirely by your own motion —
        //     hold still and it settles; whip the gun around and it
        //     punishes you.
        updateGrip: function (time, dtSeconds) {
          var w = viceWobble(this._wobbleSeed, time, this._wobble);
          this.updateGhostHand(dtSeconds);
          this.updateRecoil(dtSeconds);

          var grip = this.gripEl.object3D;
          grip.position.set(
            this._drift.x * DRIFT_POSITION_GAIN + this.recoilPosition.x,
            this._drift.y * DRIFT_POSITION_GAIN + this.recoilPosition.y,
            this._drift.z * DRIFT_POSITION_GAIN + this.recoilPosition.z
          );
          if (this.gripAnchored) {
            this._gripAnchorLocal.copy(this.gripAnchorWorld);
            this.el.object3D.worldToLocal(this._gripAnchorLocal);
            grip.position.copy(this._gripAnchorLocal);
          }
          grip.rotation.set(
            ((w.x - this._drift.y * DRIFT_ROTATION_GAIN) * Math.PI) / 180 + this.recoilRotation.x,
            ((w.y + this._drift.x * DRIFT_ROTATION_GAIN) * Math.PI) / 180 + this.recoilRotation.y,
            (w.z * Math.PI) / 180 + this.recoilRotation.z
          );

          this.applyToVisual(grip);
        },

        setGripAnchor: function (worldPoint) {
          this.gripAnchorWorld.copy(worldPoint);
          this.gripAnchored = true;
        },

        clearGripAnchor: function () {
          this.gripAnchored = false;
        },

        // Firearms calculate kick in world space from the barrel and
        // player stance. Convert it into this tracked hand's frame,
        // accumulate it, and let it settle independently of vice
        // drift. worldRotation is a small axis-angle vector whose
        // magnitude is radians.
        addRecoilImpulse: function (worldPosition, worldRotation, returnRate) {
          this.el.object3D.getWorldQuaternion(this._handQuat).invert();
          this.recoilPosition.add(this._recoilScratchPosition.copy(worldPosition).applyQuaternion(this._handQuat));
          this.recoilRotation.add(this._recoilScratchRotation.copy(worldRotation).applyQuaternion(this._handQuat));

          if (this.recoilPosition.lengthSq() > RECOIL_MAX_POSITION * RECOIL_MAX_POSITION) {
            this.recoilPosition.setLength(RECOIL_MAX_POSITION);
          }
          this.recoilRotation.x = Math.max(-RECOIL_MAX_ROTATION, Math.min(RECOIL_MAX_ROTATION, this.recoilRotation.x));
          this.recoilRotation.y = Math.max(-RECOIL_MAX_ROTATION, Math.min(RECOIL_MAX_ROTATION, this.recoilRotation.y));
          this.recoilRotation.z = Math.max(-RECOIL_MAX_ROTATION, Math.min(RECOIL_MAX_ROTATION, this.recoilRotation.z));
          this.recoilReturnRate = Math.max(returnRate || 8, 0.1);
        },

        updateRecoil: function (dtSeconds) {
          var remaining = Math.exp(-this.recoilReturnRate * dtSeconds);
          this.recoilPosition.multiplyScalar(remaining);
          this.recoilRotation.multiplyScalar(remaining);
          if (this.recoilPosition.lengthSq() < 0.00000001) this.recoilPosition.set(0, 0, 0);
          if (this.recoilRotation.lengthSq() < 0.00000001) this.recoilRotation.set(0, 0, 0);
        },

        updateGhostHand: function (dtSeconds) {
          this._drift.set(0, 0, 0);

          if (!this._ghostSeeded) {
            this._ghostHand.copy(this._handWorld);
            this._ghostVel.set(0, 0, 0);
            this._ghostSeeded = true;
            return;
          }

          this._drift.copy(this._handWorld).sub(this._ghostHand);
          this._ghostVel.addScaledVector(this._drift, DRIFT_STIFFNESS * dtSeconds);
          this._ghostVel.multiplyScalar(Math.max(1 - DRIFT_DAMPING * dtSeconds, 0));
          this._ghostHand.addScaledVector(this._ghostVel, dtSeconds);

          if (VICES.alcohol <= 0.001) return this._drift.set(0, 0, 0);

          // How far the ghost is lagging, in the hand's own frame so
          // "left" means left of the barrel however you're facing.
          this._drift.copy(this._ghostHand).sub(this._handWorld);
          if (this._drift.lengthSq() > DRIFT_MAX_LAG * DRIFT_MAX_LAG) {
            this._drift.setLength(DRIFT_MAX_LAG);
          }
          this.el.object3D.getWorldQuaternion(this._handQuat);
          this._drift.applyQuaternion(this._handQuat.invert());
          this._drift.multiplyScalar(VICES.alcohol);
        },

        // The rendered hand is a separate entity (see the markup
        // comment), so it needs the same offset or the gun would
        // visibly float out of an unnervingly steady fist. Applied to
        // the loaded model rather than the entity, since
        // tracked-controls owns the entity's pose — and composed on
        // top of whatever resting transform hand-controls set up,
        // captured the first time the model exists.
        applyToVisual: function (grip) {
          if (!this.data.visual) return;
          var mesh = this.data.visual.getObject3D('mesh');
          if (!mesh) return;

          if (!this._visualBase) {
            this._visualBase = {
              position: mesh.position.clone(),
              quaternion: mesh.quaternion.clone(),
            };
          }

          mesh.position.copy(this._visualBase.position).add(grip.position);
          mesh.quaternion.copy(this._visualBase.quaternion);
          mesh.rotateX(grip.rotation.x);
          mesh.rotateY(grip.rotation.y);
          mesh.rotateZ(grip.rotation.z);
        },

        // Everything held attaches here rather than to the hand
        // itself. Falls back to the hand if called before init, which
        // can happen on the very first frame.
        gripObject3D: function () {
          return this.gripEl ? this.gripEl.object3D : this.el.object3D;
        },

        isFull: function () {
          return this.heldObjects.length >= HAND_CAPACITY;
        },

        isWeaponObject: function (objEl) {
          var components = objEl && objEl.components;
          return !!(components && (
            components.firearm ||
            components.bow ||
            components.launcher ||
            components.nozzle
          ));
        },

        // Whether this hand already has a weapon among heldObjects.
        // Guns, bow, launcher and tank nozzle all occupy the hand by
        // themselves; throwable explosives remain deliberately
        // stackable props.
        hasWeapon: function () {
          var self = this;
          return this.heldObjects.some(function (objEl) {
            return self.isWeaponObject(objEl);
          });
        },

        // The invariant at the boundary where something joins a
        // rigidly held stack. Non-weapons may stack with non-weapons;
        // a weapon always occupies the hand by itself.
        canAddToHeld: function (objEl) {
          if (!objEl || this.isFull()) return false;
          if (!this.heldObjects.length) return true;
          if (this.hasWeapon()) return false;
          return !this.isWeaponObject(objEl);
        },

        // Public "this hand now holds that" used both by this
        // component's own grip handler and by holsterable.catchThrown,
        // which catches things this hand never deliberately grabbed.
        take: function (objEl) {
          if (this.heldObjects.indexOf(objEl) === -1) this.heldObjects.push(objEl);
          var d = this.danglingObjects.indexOf(objEl);
          if (d !== -1) this.danglingObjects.splice(d, 1);
          this.reflowHeld();
        },

        takeDangling: function (objEl) {
          if (this.danglingObjects.indexOf(objEl) === -1) this.danglingObjects.push(objEl);
          this.reflowStack(this.danglingObjects);
        },

        // Something left this hand without going through a normal
        // release — a bottle shattering in your fist, mostly.
        forget: function (objEl) {
          var h = this.heldObjects.indexOf(objEl);
          if (h !== -1) {
            this.heldObjects.splice(h, 1);
            this.reflowHeld();
          }
          var d = this.danglingObjects.indexOf(objEl);
          if (d !== -1) {
            this.danglingObjects.splice(d, 1);
            this.reflowStack(this.danglingObjects);
          }
        },

        // Everything this hand might still be remembering about an
        // object that has stopped existing. forget() covers the two
        // lists it's actively holding by; the stash in particular has
        // to go too, or a quick re-grip reaches for a gun that isn't
        // in the scene any more.
        discard: function (objEl) {
          this.forget(objEl);
          var s = this.supportObjects.indexOf(objEl);
          if (s !== -1) this.supportObjects.splice(s, 1);
          var t = this.stash.indexOf(objEl);
          if (t !== -1) this.stash.splice(t, 1);
        },

        // Re-tells every item where it sits in the fistful. Same idea
        // (and same reason) as anchor-slot.reflow: the fan has to
        // re-shape itself whenever it gains or loses a member.
        reflowStack: function (list) {
          list.forEach(function (objEl, i) {
            var holsterable = objEl.components.holsterable;
            if (holsterable) holsterable.setHandStack(i, list.length);
          });
        },

        reflowHeld: function () {
          var self = this;
          this.reflowStack(this.heldObjects);
          this.heldObjects.forEach(function (objEl) {
            var holsterable = objEl.components.holsterable;
            if (holsterable) holsterable.applyHandPose(self.el);
          });
        },

        // Grip is a hold, not a toggle, which means there's no such
        // thing as "press it again while still holding" — you'd have
        // to let go first, and letting go drops everything. So the way
        // to build up a fistful is a quick re-grip: release and
        // squeeze again within REGRIP_WINDOW_MS and whatever you just
        // put down comes back with you, plus whatever's nearest now.
        // Sweep down the bar tapping the grip and you collect bottles.
        //
        // The release itself still happens immediately and normally —
        // deferring it would put latency on every throw — so this is
        // purely a matter of remembering what left and being willing
        // to take it back.
        onGripDown: function () {
          this.gripHeld = true;
          var deliberateRegrip = this.reclaimStash();
          if (this.hasWeapon()) return;
          // Already holding something without having just performed
          // the release/re-press gesture: this is a duplicate input,
          // not permission to grow the stack.
          if (this.heldObjects.length && !deliberateRegrip) return;
          if (this.isFull()) return;

          var obj = this.findGrabbableObject();
          if (obj && this.canAddToHeld(obj)) {
            obj.components.holsterable.grab(this.el);
            this.take(obj);
            return;
          }

          // Nothing to pick up (or it was a second firearm this hand
          // won't take — see hasWeapon), but maybe something in your
          // OTHER hand offers a second place to hold it — a shotgun
          // forend.
          if (!this.heldObjects.length) this.takeSupport('grip');
        },

        // Shared by both buttons; which one an object answers to is the
        // object's business (see holsterable's supportGrab).
        takeSupport: function (mode) {
          var support = this.findSupportGrip(mode);
          if (!support) return false;
          support.components.holsterable.grabSupport(this.el);
          this.supportObjects.push(support);
          return true;
        },

        dropSupport: function (mode) {
          this.supportObjects = this.supportObjects.filter(function (objEl) {
            var holsterable = objEl.components.holsterable;
            if (!holsterable || holsterable.data.supportGrab !== mode) return true;
            holsterable.releaseSupport();
            return false;
          });
        },

        // Lets go of everything at once. Each item runs its own
        // release() and therefore makes its own decision — dangle,
        // throw, holster, or fall — which is how a fistful of bottles
        // released over the bar can have some of them land back in
        // their slots while the rest hit the floor.
        onGripUp: function () {
          this.gripHeld = false;

          this.dropSupport('grip');

          if (!this.heldObjects.length) return;

          var objs = this.heldObjects;
          var self = this;
          this.heldObjects = [];
          this.stash = [];
          this.stashTime = performance.now();

          objs.forEach(function (obj) {
            var holsterable = obj.components.holsterable;
            holsterable.release(self.fingerOnTrigger);

            if (holsterable.state === 'dangling') {
              self.danglingObjects.push(obj);
              return;
            }
            // Two things are excluded from the stash. A real throw,
            // because flinging a bottle up and immediately gripping to
            // draw a pistol shouldn't snatch it back out of the air.
            // And anything that landed in a SOCKET, because putting a
            // thing somewhere is a decision — nocking an arrow and then
            // squeezing the grip to steady yourself was pulling the
            // arrow straight back out of the bow.
            if (holsterable.wasThrown || holsterable.state === 'holstered') return;
            self.stash.push(obj);
          });
          this.reflowStack(this.danglingObjects);
        },

        // Take back everything from the last release, if it was recent
        // enough and nothing else has claimed it in the meantime.
        reclaimStash: function () {
          if (!this.stash || !this.stash.length) return false;

          if (performance.now() - this.stashTime > REGRIP_WINDOW_MS) {
            this.stash = [];
            return false;
          }

          var self = this;
          var weapon = this.stash.find(function (obj) {
            return self.isWeaponObject(obj);
          });
          // A stale mixed stash can exist after upgrading from the old
          // behavior. Prefer reclaiming its weapon alone instead of
          // recreating the invalid gun-plus-props stack.
          var candidates = weapon ? [weapon] : this.stash;
          var reclaimed = false;
          candidates.forEach(function (obj) {
            if (!self.canAddToHeld(obj)) return;
            var holsterable = obj.components.holsterable;
            if (!holsterable) return;
            // Somebody else picked it up, or it broke, in the
            // meantime — it isn't yours to take back any more.
            if (holsterable.hand && holsterable.hand !== self.el) return;
            if (holsterable.state === 'broken') return;
            // It found a home in the meantime. Leave it there.
            if (holsterable.state === 'holstered') return;

            holsterable.grab(self.el);
            self.take(obj);
            reclaimed = true;
          });
          this.stash = [];
          return reclaimed;
        },

        // An actual pull (past the digital press threshold), not just
        // a touch. Dispatched generically: anything in this hand with
        // an onTriggerUse method gets it, so a gun fires and a lighter
        // flips its lid without hand-rig knowing either exists. Only
        // heldObjects, never supportObjects — the hand on a shotgun's
        // forend is on a forend, not a trigger.
        onTriggerDown: function () {
          this.triggerHeld = true;

          // The trigger on a hand already holding a support grip is a
          // separate control from the gun's firing trigger. Firearms
          // use it to clamp that hand to nearby scenery; bows and any
          // other support object simply ignore the generic dispatch.
          if (this.supportObjects.length) {
            this.supportObjects.forEach(function (objEl) {
              useHeldObject(objEl, 'onSupportTriggerUse');
            });
            return;
          }

          // A bowstring is drawn with the finger that would shoot,
          // which is both how a bow works and what keeps GRIP free to
          // mean "take the arrow off it". Checked before the press is
          // dispatched, and only when this hand is empty, so a trigger
          // pull on something you're holding still means what it always
          // meant.
          if (!this.heldObjects.length && this.takeSupport('trigger')) return;

          this.heldObjects.forEach(function (objEl) {
            useHeldObject(objEl, 'onTriggerUse');
          });
        },

        // A/X or B/Y, either controller. Same generic dispatch.
        onFaceButton: function () {
          this.heldObjects.forEach(function (objEl) {
            useHeldObject(objEl, 'onFaceButtonUse');
          });
        },

        onTriggerTouchStart: function () {
          this.fingerOnTrigger = true;
        },

        // Finger fully lifts off the trigger surface. Anything
        // dangling from this hand has just lost the only thing holding
        // it up — this is the moment that decides holster vs. fall,
        // per item.
        onTriggerTouchEnd: function () {
          this.fingerOnTrigger = false;
          if (!this.danglingObjects.length) return;

          var objs = this.danglingObjects;
          this.danglingObjects = [];
          objs.forEach(function (obj) {
            obj.components.holsterable.endDangle();
          });
        },

        // The nearest object being held by the OTHER hand that offers
        // a second grip within reach of this one. Deliberately checked
        // only after a normal grab fails, so a forend never steals a
        // pickup from something lying right there.
        onTriggerUp: function () {
          this.triggerHeld = false;
          this.supportObjects.forEach(function (objEl) {
            useHeldObject(objEl, 'onSupportTriggerEnd');
          });
          this.dropSupport('trigger');
        },

        findSupportGrip: function (mode) {
          var handPos = new THREE.Vector3();
          var gripPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(handPos);

          var objects = document.querySelectorAll('.grabbable');
          var nearest = null;
          var nearestDist = Infinity;

          for (var i = 0; i < objects.length; i++) {
            var holsterable = objects[i].components.holsterable;
            if (!holsterable || !holsterable.canSupport(this.el)) continue;
            if (holsterable.data.supportGrab !== mode) continue;

            holsterable.supportGripWorldPosition(gripPos);
            var d = gripPos.distanceTo(handPos);
            if (d < holsterable.data.supportRadius && d < nearestDist) {
              nearest = objects[i];
              nearestDist = d;
            }
          }

          return nearest;
        },

        // Nearest object this hand is currently allowed to grab:
        // anything holstered or resting on the ground, or the object
        // already dangling from this specific hand's finger (a
        // "catch"). Any ".grabbable" entity qualifies, regardless of
        // what it is — guns, hat, or anything added later. Each
        // object's own grabRadius gates its eligibility (a bulky
        // object like the hat can declare a bigger grab box than a
        // gun without changing anything here), so nearestDist starts
        // wide open and lets the per-object check do the filtering.
        findGrabbableObject: function () {
          var handPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(handPos);

          var objects = Array.prototype.slice.call(document.querySelectorAll('.grabbable'));
          var self = this;
          var nearest = null;
          var nearestDist = Infinity;
          var objPos = new THREE.Vector3();

          objects.forEach(function (objEl) {
            var holsterable = objEl.components.holsterable;
            if (!holsterable) return;

            var eligible =
              holsterable.state === 'holstered' ||
              holsterable.state === 'resting' ||
              (holsterable.state === 'dangling' && holsterable.hand === self.el);
            if (!eligible) return;

            var d = holsterable.grabDistanceTo(handPos);
            if (d < holsterable.data.grabRadius && d < nearestDist) {
              nearest = objEl;
              nearestDist = d;
            }
          });

          return nearest;
        },
      });

      // ==============================================================
      // COMPONENT: proximity-haptics
      // Generic and reusable — has no idea what a pistol is. Buzzes
      // this hand's controller whenever the nearest ".grabbable"
      // entity in the scene is within PROXIMITY_HAPTIC_RADIUS. Future
      // interactive props just need class="grabbable" to opt into the
      // same behavior; nothing here needs to change for them.
      //
      // Two things it skips, so it doesn't buzz misleadingly:
      //   - whatever this hand is already holding (its object3D is
      //     currently parented under this hand's grip — true for
      //     anything that follows the same "attach to the grip when
      //     held" convention holsterable.grab() uses)
      //   - everything, if hand-rig (when present) reports this hand
      //     as already full, since you can't grab a second thing
      //     right now anyway
      // ==============================================================
      registerComponent('proximity-haptics', {
        init: function () {
          this.handPos = new THREE.Vector3();
          this.targetPos = new THREE.Vector3();
        },

        tick: function () {
          var handRig = this.el.components['hand-rig'];
          if (handRig && (
            handRig.isFull() ||
            handRig.heldObjects.length ||
            handRig.danglingObjects.length ||
            handRig.supportObjects.length
          )) return;

          var trackedControls = this.el.components['tracked-controls'];
          var gamepad = trackedControls && trackedControls.controller;
          var actuator = gamepad && gamepad.hapticActuators && gamepad.hapticActuators[0];
          if (!actuator) return;

          this.el.object3D.getWorldPosition(this.handPos);

          var targets = document.querySelectorAll('.grabbable');
          var inRange = false;

          var grip = gripObjectOf(this.el);
          for (var i = 0; i < targets.length; i++) {
            var targetEl = targets[i];
            if (targetEl.object3D.parent === grip) continue; // already holding this one

            targetEl.object3D.getWorldPosition(this.targetPos);
            if (this.handPos.distanceTo(this.targetPos) < PROXIMITY_HAPTIC_RADIUS) {
              inRange = true;
              break;
            }
          }

          if (inRange) {
            actuator.pulse(PROXIMITY_HAPTIC_INTENSITY, PROXIMITY_HAPTIC_PULSE_MS);
          }
        },
      });
