      // ==============================================================
      // CORE: hand-rig
      // The player's hands: grip/trigger bookkeeping, what's held,
      // and proximity haptics. Split out of game.js — see DESIGN.md's
      // "File structure" section.
      // ==============================================================

      var PROXIMITY_HAPTIC_RADIUS = 0.2; // meters — a bit past GRAB_RADIUS, so the buzz gives you a heads-up just before you're in range
      var PROXIMITY_HAPTIC_INTENSITY = 0.15; // 0-1, deliberately light ("slight buzz", not a jolt)
      var PROXIMITY_HAPTIC_CHECK_MS = 80; // advisory feedback does not need a full scene scan at headset refresh rate
      var PROXIMITY_HAPTIC_PULSE_MS = 90; // overlaps the throttled check slightly for a continuous-feeling buzz
      var REGRIP_WINDOW_MS = 400; // release and re-squeeze inside this and you keep what you were holding — see hand-rig.reclaimStash
      var RECOIL_MAX_POSITION = 0.18; // meters; automatic fire can kick hard, but never detach the hand from the arm
      var RECOIL_MAX_ROTATION = 0.7; // radians, about 40 degrees on any local axis
      var HAND_REACH_MOTION_MS = 180; // how long a scripted desktop/mobile reach (draw, holster, swap) takes to arrive — see hand-rig.animateGripDown/animateRelease; tune by feel
      var THROW_HAND_SPEED = 3.5; // m/s — desktop/mobile's fabricated hand speed for a scripted blade throw (see hand-rig.throwHeldItem); a plausible brisk flick, not a real measurement

      // Ambient-wobble steadiness multipliers -- see hand-rig.getSteadinessMultiplier.
      // Separate from firearm's own bracedRiseScale/supportedRiseScale
      // (items-guns.js), which scale a shot's recoil KICK; these scale
      // the continuous idle/weight/exertion/vice sway between shots.
      var SUPPORTED_STEADY_SCALE = 0.6; // two-handed, not braced against anything
      var BRACED_STEADY_SCALE = 0.3; // resting on a gun-brace-surface
      var AIMED_STEADY_SCALE = 0.55; // ADS held (common/desktop-controls.js) -- desktop/mobile/gamepad only
      var CROUCH_STEADY_REDUCTION = 0.35; // fraction of ambient wobble removed at full crouch

      // A self-calibrating crouch heuristic shared by both hands (see
      // getSteadinessMultiplier): rather than reading desktop-controls'
      // crouch flags directly (VR has no equivalent flag -- crouching is
      // just physically lowering your head), track a slowly-adapting
      // "standing height" baseline off the live camera and treat a
      // noticeable drop below it as crouched. This works identically for
      // VR (real head height) and desktop (desktop-controls' own
      // updateCrouch already moves the camera down) with no branching.
      // Deduped to once per frame via `time` (shared across every
      // component's tick this frame) since both hands call it.
      var STANDING_HEIGHT_TRACK_MARGIN = 0.12; // meters -- within this of the estimate still counts as "standing," for recalibration
      var STANDING_HEIGHT_ADAPT_PER_S = 0.4; // how fast the standing baseline follows a genuine height change while apparently standing
      var CROUCH_SOFTEN_HEIGHT = 0.35; // meters below standing that reads as fully crouched -- tune by feel
      var _standingHeightEstimate = null;
      var _lastCrouchUpdateTime = -1;
      var _crouchFactorCache = 0;

      function crouchSteadinessFactor(time, dtSeconds) {
        if (time === _lastCrouchUpdateTime) return _crouchFactorCache;
        _lastCrouchUpdateTime = time;
        var headEl = document.querySelector('#head-camera');
        if (!headEl || !headEl.object3D) return _crouchFactorCache;
        var height = headEl.object3D.position.y;
        if (_standingHeightEstimate === null || height > _standingHeightEstimate - STANDING_HEIGHT_TRACK_MARGIN) {
          _standingHeightEstimate = _standingHeightEstimate === null
            ? height
            : _standingHeightEstimate + (height - _standingHeightEstimate) * Math.min(1, STANDING_HEIGHT_ADAPT_PER_S * dtSeconds);
        }
        var drop = Math.max(0, _standingHeightEstimate - height);
        _crouchFactorCache = Math.max(0, Math.min(1, drop / CROUCH_SOFTEN_HEIGHT));
        return _crouchFactorCache;
      }

      // ==============================================================
      // clearOtherHandIfExclusive
      // Shared by hand-rig's own onDesktopGrabAttempt (the F key) and
      // core-equip.js's activateHotbarSlot (the number-key holster
      // system): a "large" item (itemSize other than 'small' — a
      // shotgun or long gun, per items-guns.js) is exclusive of
      // anything the OTHER hand holds, and vice versa. Only pistols
      // and other small hip-holsterable items are meant to be dual-
      // wielded. This foreshadows a real future two-handed grip for
      // weapons like the shotgun (which already has a supportGrip/
      // supportRadius forend in items-guns.js) without needing one yet
      // — today it just means drawing or picking up a large item bumps
      // whatever the other hand holds, and picking up anything while a
      // large item is out bumps that large item first.
      //
      // MUST run AFTER the grab it's paired with, never before:
      // releasing the other hand's item first would send it looking
      // for a home (tryHolsterElse) before the newly grabbed item has
      // vacated its own slot, so a same-slot swap (drawing the shotgun
      // while a same-sized rifle sits in the other hand) would race for
      // that slot and drop the rifle instead of landing it there.
      // ==============================================================
      function clearOtherHandIfExclusive(grabbingHandRig, grabbedObj) {
        var grabbedHolsterable = grabbedObj.components.holsterable;
        var grabbedIsLarge = !grabbedHolsterable || grabbedHolsterable.data.itemSize !== 'small';

        var otherHandEl = findOtherHand(grabbingHandRig.el);
        var otherHandRig = otherHandEl && otherHandEl.components['hand-rig'];
        if (!otherHandRig || !otherHandRig.heldObjects.length) return;

        var otherHeld = otherHandRig.heldObjects[0];
        var otherHolsterable = otherHeld.components.holsterable;
        var otherIsLarge = !otherHolsterable || otherHolsterable.data.itemSize !== 'small';

        if (!grabbedIsLarge && !otherIsLarge) return;

        // A plain release lets the departing item go wherever
        // tryHolsterElse's ordinary distance check finds it from the
        // hand's CURRENT pose, which on desktop is whatever fixed
        // formula desktop-controls.js's placeRestHand/placeHeldHand
        // happens to be using — not a real physical position, and not
        // reliably near where the item actually needs to land. Reach
        // that hand to the right destination first (animateRelease —
        // a real animated motion, not a teleport, so it's visible and
        // reads as the same kind of reach a VR player's arm would need
        // to physically make), in one of two shapes depending on which
        // item is large:
        //
        //  - both large: there is exactly one such slot on the body
        //    (the back bandolier), so the departing item is aimed at
        //    the SAME slot the incoming one just vacated — the "swap"
        //    the request describes (holster the rifle onto your back
        //    while the other hand takes the shotgun off it).
        //  - otherwise, the departing item is aimed at its OWN home
        //    (holsterSelector) instead — drawing a pistol while the
        //    shotgun is out should send the shotgun back to the back
        //    bandolier specifically, not wherever drawing a hip pistol
        //    happens to leave the other hand.
        //
        // holsterSelector is schema'd as type: 'selector', so .data
        // already holds the resolved element, not a string to re-query.
        var destinationSlotEl = grabbedIsLarge && otherIsLarge
          ? grabbedHolsterable.data.holsterSelector
          : otherHolsterable && otherHolsterable.data.holsterSelector;

        if (destinationSlotEl) {
          var pos = new THREE.Vector3();
          var quat = new THREE.Quaternion();
          destinationSlotEl.object3D.getWorldPosition(pos);
          destinationSlotEl.object3D.getWorldQuaternion(quat);
          otherHandRig.animateRelease(pos, quat);
        } else {
          otherHandRig.onGripUp();
        }
      }

      // ==============================================================
      // reachAndGrabItem
      // The actual "animate the hand to it, then let gripdown resolve
      // it" reach shared by every desktop/mobile grab that already
      // knows exactly WHICH object it wants — hand-rig's own F-key
      // blind-proximity search (onDesktopGrabAttempt) and
      // core-equip.js's slot-reach-grab (a hint-zone-driven long
      // reach for shop/bar props a fixed idle hand pose could never
      // get physically close enough to on its own — see that
      // component's own comment). Deliberately thin: it doesn't grab
      // anything itself, just like onDesktopGrabAttempt never did —
      // arriving fires the real `gripdown`, and findGrabbableObject's
      // own tight, VR-precision radius re-resolves obj from there, the
      // same way a real controller reach already would. `onComplete`,
      // if given, runs after clearOtherHandIfExclusive — core-equip.js's
      // performEquipDraw uses it to know exactly when the reach has
      // landed before starting its own twirl-to-ready sequence.
      // ==============================================================
      function reachAndGrabItem(handRig, obj, onComplete) {
        var pos = new THREE.Vector3();
        var quat = new THREE.Quaternion();
        obj.object3D.getWorldPosition(pos);
        obj.object3D.getWorldQuaternion(quat);
        handRig.animateGripDown(pos, quat, function () {
          clearOtherHandIfExclusive(handRig, obj);
          if (onComplete) onComplete();
        });
      }

      // Releases whatever `handRig` currently holds, first reaching that
      // hand to the item's own home slot (holsterSelector) if it has
      // one — see clearOtherHandIfExclusive's own comment for why a
      // plain release can't rely on tryHolsterElse's ordinary distance
      // check succeeding from wherever the hand's desktop rest/carry
      // pose happens to be. Used by activateHotbarSlot (core-equip.js)
      // to bump whatever a target hand already holds before it takes a
      // numbered slot's item — a deliberate "put this specific known
      // thing away," unlike F's own plain release, which keeps falling
      // wherever a real mid-air VR drop would. `onComplete`, if given,
      // runs once the release has actually finished (immediately, for
      // the no-known-home fallback) — activateHotbarSlot uses it to
      // sequence "put the old thing away, THEN reach for the new one"
      // on the same hand, since one hand can only run one motion at a
      // time.
      function releaseToOwnHome(handRig, onComplete) {
        var held = handRig.heldObjects[0];
        var holsterable = held && held.components.holsterable;
        var homeSlotEl = holsterable && holsterable.data.holsterSelector;
        if (homeSlotEl) {
          var pos = new THREE.Vector3();
          var quat = new THREE.Quaternion();
          homeSlotEl.object3D.getWorldPosition(pos);
          homeSlotEl.object3D.getWorldQuaternion(quat);
          handRig.animateRelease(pos, quat, onComplete);
        } else {
          handRig.onGripUp();
          if (onComplete) onComplete();
        }
      }

      function xrIsPresenting(sceneEl) {
        var controlMode = sceneEl && sceneEl.systems && sceneEl.systems['control-mode'];
        return Boolean(controlMode && controlMode.isMode('xr'));
      }

      // Desktop/mobile/gamepad-only (see the !xrIsPresenting call site in
      // hand-rig.onGripDown): a real VR player two-hands a shotgun by
      // physically reaching their off hand within holsterable.supportRadius
      // of the forend (hand-rig.findSupportGrip) -- there's no such reach
      // to make on desktop, and the request was explicit that "both hands
      // should hold the gun when it's drawn" there. So the moment a
      // support-capable weapon (supportRadius > 0) is drawn by a non-VR
      // input, automatically send the other hand -- if it's empty -- to
      // the weapon's own supportGrip point.
      function autoGrabSupport(dominantHandRig, item) {
        var holsterable = item.components.holsterable;
        if (holsterable.data.supportRadius <= 0) return;
        var otherHandEl = findOtherHand(dominantHandRig.el);
        var otherHandRig = otherHandEl && otherHandEl.components['hand-rig'];
        // danglingObjects belongs here too: a hand mid-twirl (see
        // core-equip.js's performEquipDraw) isn't holding or supporting
        // anything by this component's own bookkeeping, but scripting a
        // completely unrelated support-grab motion onto it right then
        // would still cancel that twirl's own in-flight motion out from
        // under it (animateSupportGrab's cancelMotion() doesn't know or
        // care why the hand was already moving).
        if (!otherHandRig || otherHandRig.heldObjects.length || otherHandRig.supportObjects.length || otherHandRig.danglingObjects.length) return;

        var pos = holsterable.supportGripWorldPosition(new THREE.Vector3());
        var quat = new THREE.Quaternion();
        item.object3D.getWorldQuaternion(quat);
        otherHandRig.animateSupportGrab(item, pos, quat);
      }
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
          this.activeGripInteraction = null; // fixed machinery handles are gripped without joining the carry stack
          this.suppressAutoSupport = false; // true mid-twirl (core-equip.js's performEquipDraw) so the initial grab doesn't jump the off-hand to the forend before the flourish has even started

          this.velocity = new THREE.Vector3();
          this._prevPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(this._prevPos); // avoid a garbage first-frame velocity spike

          // The grip: a child entity that everything held attaches to,
          // carrying however unsteady this hand currently is.
          this.gripEl = document.createElement('a-entity');
          this.el.appendChild(this.gripEl);

          this._wobbleSeed = Math.random() * 100;
          this._wobble = { x: 0, y: 0, z: 0 };
          this._idleWobble = { x: 0, y: 0, z: 0 };
          this._weightWobble = { x: 0, y: 0, z: 0 };
          this._exertionWobble = { x: 0, y: 0, z: 0 };
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
          this.onDesktopGrabAttempt = this.onDesktopGrabAttempt.bind(this);
          this.onDesktopTriggerAttempt = this.onDesktopTriggerAttempt.bind(this);
          this.onMotionComplete = this.onMotionComplete.bind(this);
          this._motionCompleteCallback = null; // see animateGripDown/animateRelease

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
          // desktop-controls.js (common/, game-agnostic) fires these two
          // generic events on this hand's element when a desktop/mobile
          // grab or trigger press wasn't claimed by the hint-zone/
          // simple-grabbable candidate system it already knows about —
          // see its own emitGrabFallback/emitTriggerFallback. Pistols'
          // physically-grabbed holsterable props are exactly the kind of
          // thing that system doesn't know about, so this hand answers
          // for itself, by translating straight into the same raw
          // gripdown/gripup/triggerdown/triggerup events a real Touch
          // controller squeeze already fires above — no new state
          // machine, just a second source for the same four events.
          this.el.addEventListener('desktop-grab-attempt', this.onDesktopGrabAttempt);
          this.el.addEventListener('desktop-trigger-attempt', this.onDesktopTriggerAttempt);
          // Fired by semantic-hand.runWorldMotion (interaction-hints.js)
          // once an animated reach finishes — see animateGripDown/
          // animateRelease, which are what drive that motion for every
          // desktop/mobile grab/holster/swap. Non-bubbling, so this has
          // to listen on the hand element directly, same as
          // common/semantic-punch.js's identical pattern.
          this.el.addEventListener('semantic-hand-motion-complete', this.onMotionComplete);
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
          this.el.removeEventListener('desktop-grab-attempt', this.onDesktopGrabAttempt);
          this.el.removeEventListener('desktop-trigger-attempt', this.onDesktopTriggerAttempt);
          this.el.removeEventListener('semantic-hand-motion-complete', this.onMotionComplete);
        },

        // Toggle, not a hold: on desktop/mobile there's no physical grip to
        // keep squeezed, so one press draws (grip down and held) and a
        // second press on an already-full hand releases (grip up) — see
        // onGripDown/onGripUp just below for what each actually does; this
        // only decides which one applies. Releasing doesn't reposition the
        // hand first, so it holsters/drops from wherever the hand already
        // is, identically to a real mid-air VR release.
        //
        // This is deliberately a plain reach now, not a wide/aimed search:
        // the hip holsters and back bandolier have their own dedicated
        // number-key hotbar (see core-equip.js's activateHotbarSlot) that
        // sidesteps aiming entirely, because a desktop/mobile player can't
        // turn their head independently of their body to actually look at
        // a holster the way a VR player can. F is for a ".grabbable" prop
        // that's actually in front of the player right now — walk up to a
        // rifle on a rack and press F, same as a real VR reach would need
        // you to be genuinely close.
        onDesktopGrabAttempt: function () {
          if (this.heldObjects.length || this.supportObjects.length) {
            this.onGripUp();
            return;
          }
          var obj = this.findGrabbableObject();
          if (!obj) return;
          // Animated reach (animateGripDown, via reachAndGrabItem), not a
          // teleport: the hand visibly arrives at obj's transform before
          // gripdown actually fires — findGrabbableObject() (tuned tight
          // for a real tracked hand's precision) will then resolve to the
          // same object from there, the way a precise VR reach already would.
          reachAndGrabItem(this, obj);
        },

        // A tap, not a hold — Pistols' pistols/shotgun are single-action,
        // so this mirrors a quick real trigger pull rather than adding a
        // separate "held down" desktop firing mode. Blade weapons (knives,
        // stars) have no trigger to pull at all -- tapping throws them
        // instead, via throwHeldItem below.
        onDesktopTriggerAttempt: function () {
          if (!this.heldObjects.length) return;
          var held = this.heldObjects[0];
          if (held.components['blade-projectile']) {
            this.throwHeldItem();
            return;
          }
          this.el.emit('triggerdown', null, false);
          this.el.emit('triggerup', null, false);
        },

        // Desktop/mobile has no real hand velocity to throw with, so this
        // fabricates one just deliberate enough to clear
        // computeThrowVelocity's gates (core.js). A knife doesn't care what
        // direction this points -- its flight is always fully re-solved
        // toward the camera's look target (blade-projectile.onThrown). A
        // guided star DOES care: onThrown blends 32% of this exact
        // vector's raw direction into its real launch direction, so it
        // has to actually look like a throw aimed where the camera is
        // pointed, not an arbitrary toss -- an earlier version fixed the
        // vertical component at a steep, constant elevation regardless of
        // camera pitch, which dragged every star's launch angle upward by
        // ~10-15 degrees and sent it arcing clean over anything close or
        // below eye level (confirmed against real gallery targets before
        // this fix). Using the camera's own full look direction keeps
        // this blend close to the correctly-solved angle in the vast
        // majority of aims, since both are derived from the same camera
        // orientation; only a near-vertical aim (looking almost straight
        // down) can fail computeThrowVelocity's gates entirely, which is
        // an acceptable, rare edge case (the item just drops instead).
        // Bypasses animateRelease entirely (straight to onGripUp) so
        // settleVelocity never zeroes this.velocity before release() reads
        // it, and forces fingerOnTrigger off so release() evaluates a throw
        // instead of starting a dangle.
        throwHeldItem: function () {
          var camera = document.querySelector('#head-camera');
          var forward = new THREE.Vector3(0, 0, -1);
          if (camera) {
            var camQuat = new THREE.Quaternion();
            camera.object3D.getWorldQuaternion(camQuat);
            forward.applyQuaternion(camQuat);
          }
          this.velocity.copy(forward).multiplyScalar(THROW_HAND_SPEED);
          this.fingerOnTrigger = false;
          this.onGripUp();
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
        // Every ambient contributor (vice wobble/drift, idle tremor,
        // held-weight tremor, exertion breathing) is summed here and
        // scaled together by one steadiness multiplier before recoil --
        // which keeps its own separate scaling -- is added on top
        // unscaled. See getSteadinessMultiplier for what feeds that
        // multiplier, and DESIGN.md's "perturb the hand, not the held
        // object" rule for why this all lands on the grip child rather
        // than the gun itself.
        updateGrip: function (time, dtSeconds) {
          var w = viceWobble(this._wobbleSeed, time, this._wobble);
          var idle = idleTremor(this._wobbleSeed, time, this._idleWobble);
          var held = this.heldObjects[0];
          var weight = held && held.components.holsterable ? held.components.holsterable.data.weight : 0;
          var weightW = weightWobble(this._wobbleSeed, time, weight, this._weightWobble);
          var exertionW = exertionWobble(this._wobbleSeed, time, this._exertionWobble);
          this.updateGhostHand(dtSeconds);
          this.updateRecoil(dtSeconds);

          var steadiness = this.getSteadinessMultiplier(time, dtSeconds);

          var grip = this.gripEl.object3D;
          grip.position.set(
            this._drift.x * DRIFT_POSITION_GAIN * steadiness + this.recoilPosition.x,
            this._drift.y * DRIFT_POSITION_GAIN * steadiness + this.recoilPosition.y,
            this._drift.z * DRIFT_POSITION_GAIN * steadiness + this.recoilPosition.z
          );
          if (this.gripAnchored) {
            this._gripAnchorLocal.copy(this.gripAnchorWorld);
            this.el.object3D.worldToLocal(this._gripAnchorLocal);
            grip.position.copy(this._gripAnchorLocal);
          }
          var ambientXDeg = (w.x - this._drift.y * DRIFT_ROTATION_GAIN) + idle.x + weightW.x + exertionW.x;
          var ambientYDeg = (w.y + this._drift.x * DRIFT_ROTATION_GAIN) + idle.y + weightW.y + exertionW.y;
          var ambientZDeg = w.z + idle.z + weightW.z + exertionW.z;
          grip.rotation.set(
            (ambientXDeg * steadiness * Math.PI) / 180 + this.recoilRotation.x,
            (ambientYDeg * steadiness * Math.PI) / 180 + this.recoilRotation.y,
            (ambientZDeg * steadiness * Math.PI) / 180 + this.recoilRotation.z
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

        // A single 0..1 multiplier applied to every AMBIENT wobble
        // contributor below (idle tremor, weight, exertion, vice wobble
        // and drift) -- never to recoil, which keeps its own existing
        // braced/supported/aimed scaling applied at the impulse itself
        // (items-guns.js's applyRecoilImpulse). Reasons to steady down
        // multiply together, so bracing AND aiming AND crouching all at
        // once is steadier than any one alone, and it never reaches
        // exactly zero -- "wobble less," not "wobble not at all."
        getSteadinessMultiplier: function (time, dtSeconds) {
          var holdFactor = 1;
          var held = this.heldObjects[0];
          if (held) {
            var firearmComp = held.components.firearm;
            var holsterableComp = held.components.holsterable;
            var supported = Boolean(holsterableComp && holsterableComp.supportHand && holsterableComp.data.supportAims);
            if (firearmComp && firearmComp.braced) holdFactor = BRACED_STEADY_SCALE;
            else if (supported) holdFactor = SUPPORTED_STEADY_SCALE;
          }
          var aimFactor = this.isAiming() ? AIMED_STEADY_SCALE : 1;
          var crouch = crouchSteadinessFactor(time, dtSeconds);
          return holdFactor * aimFactor * (1 - crouch * CROUCH_STEADY_REDUCTION);
        },

        // ADS (isAiming) is owned by common/interaction-hints.js's
        // semantic-hand, not this component -- it's desktop/mobile/
        // gamepad input state (see common/desktop-controls.js), and this
        // file only ever reads it, the same way onGripDown/onGripUp
        // already reach into semantic-hand for setHeld.
        isAiming: function () {
          var semanticHand = this.el.components['semantic-hand'];
          return Boolean(semanticHand && semanticHand.isAiming);
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

        // Desktop/mobile grab/holster/swap motions are real animated
        // reaches (animateGripDown/animateRelease below), not an instant
        // teleport, so tick()'s velocity smoothing sees an ordinary
        // decelerating approach rather than a one-frame jump — the
        // smoothstep easing runWorldMotion uses (interaction-hints.js)
        // has zero speed right at each keyframe's end. This is a
        // defensive backstop for that, not the fix: a very short or
        // interrupted motion could still leave a sliver of residual
        // velocity, and without settling it the next release could read
        // that as real motion and computeThrowVelocity (core.js) could
        // call it an overhand throw or upward toss instead of a
        // deliberate holster. Called from onMotionComplete, right before
        // the gripdown/gripup a scripted reach was arriving for.
        settleVelocity: function () {
          this.velocity.set(0, 0, 0);
          this.el.object3D.getWorldPosition(this._prevPos);
        },

        // The shared primitive underneath every scripted desktop/mobile
        // hand motion — animateGripDown/animateRelease below, and
        // performEquipDraw/performEquipHolster's own cosmetic
        // repositioning beats (core-equip.js), which move a hand
        // through one or more keyframes without either of those two's
        // own automatic gripdown/gripup at the end. Same runWorldMotion keyframe
        // mechanism common/semantic-punch.js already uses for a punch's
        // windup/strike, not a teleport — multiple keyframes chain
        // sequentially (interaction-hints.js's updateMotion carries the
        // hand's position at the end of one keyframe into the next as
        // its new start), which is what lets a single call trace out a
        // real arc rather than a straight line. cancelMotion() first
        // mirrors semantic-punch's own defensive pattern, in case a
        // previous scripted reach on this hand is still mid-flight.
        animateHandMotion: function (keyframes, onComplete) {
          var semanticHand = this.el.components['semantic-hand'];
          if (!semanticHand) {
            if (onComplete) onComplete();
            return;
          }
          semanticHand.cancelMotion();
          this._motionCompleteCallback = onComplete || null;
          semanticHand.runWorldMotion(keyframes, {});
        },

        // Runs a real animated reach to a world pose and fires the
        // actual gripdown only once the hand visibly arrives, via
        // onMotionComplete below. `onComplete`, if given, runs after the
        // gripdown fires — activateHotbarSlot (core-equip.js) uses it to
        // bump the other hand only once the new item has actually been
        // grabbed. A single keyframe today; a future flourish (spin the
        // gun up into view before it settles into the held pose) is
        // just another entry in this same array, not new machinery.
        animateGripDown: function (worldPosition, worldQuaternion, onComplete) {
          var semanticHand = this.el.components['semantic-hand'];
          if (!semanticHand) {
            this.el.emit('gripdown', null, false);
            if (onComplete) onComplete();
            return;
          }
          var self = this;
          this.animateHandMotion([{
            position: worldPosition,
            quaternion: worldQuaternion,
            pose: 'Hold',
            duration: HAND_REACH_MOTION_MS,
          }], function () {
            self.settleVelocity();
            self.el.emit('gripdown', null, false);
            if (onComplete) onComplete();
          });
        },

        // The release-side mirror of animateGripDown: reach to a known
        // destination (a slot the item should land in) and only then
        // let go, so tryHolsterElse's distance check runs from the hand
        // actually being there rather than wherever its ordinary
        // desktop rest/carry pose left it. Used for every scripted
        // "put this specific known thing away" — the numbered hotbar's
        // own toggle-off and target-hand pre-clear, and
        // clearOtherHandIfExclusive's bump — never for F's plain
        // release, which has no destination to reach for and should
        // keep falling wherever a real mid-air VR drop would.
        animateRelease: function (worldPosition, worldQuaternion, onComplete) {
          var semanticHand = this.el.components['semantic-hand'];
          if (!worldPosition || !semanticHand) {
            this.onGripUp();
            if (onComplete) onComplete();
            return;
          }
          var self = this;
          this.animateHandMotion([{
            position: worldPosition,
            quaternion: worldQuaternion,
            pose: 'Hold',
            duration: HAND_REACH_MOTION_MS,
          }], function () {
            self.settleVelocity();
            self.onGripUp();
            if (onComplete) onComplete();
          });
        },

        // Desktop/mobile/gamepad only (see onGripDown's call site): reach
        // this (empty) hand to a two-handed weapon's own supportGrip
        // point and become its support hand, the scripted equivalent of
        // a real VR player physically reaching their off hand to the
        // forend. Deliberately does NOT emit gripdown -- becoming a
        // support hand is a different event than picking something up
        // (see holsterable.grabSupport), so this bypasses onGripDown's
        // own pickup logic entirely rather than routing through it.
        animateSupportGrab: function (item, worldPosition, worldQuaternion) {
          var semanticHand = this.el.components['semantic-hand'];
          var self = this;
          function complete() {
            item.components.holsterable.grabSupport(self.el);
            self.supportObjects.push(item);
          }
          if (!semanticHand) {
            complete();
            return;
          }
          semanticHand.cancelMotion();
          this._motionCompleteCallback = complete;
          semanticHand.runWorldMotion([{
            position: worldPosition,
            quaternion: worldQuaternion,
            pose: 'Hold',
            duration: HAND_REACH_MOTION_MS,
          }], {});
        },

        // semantic-hand-motion-complete fires once for every finished
        // runWorldMotion call regardless of who started it (in Pistols,
        // always animateGripDown/animateRelease above), so the pending
        // callback is stored on this component rather than assumed —
        // starting a new motion before the old one finishes (cancelMotion)
        // simply overwrites it, which is correct: the player reaching for
        // something else mid-motion abandons the interrupted one.
        onMotionComplete: function () {
          var callback = this._motionCompleteCallback;
          this._motionCompleteCallback = null;
          if (callback) callback();
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
            components.nozzle ||
            components['blade-projectile']
          ));
        },

        // Whether this hand already has a weapon among heldObjects.
        // Guns, bow, launcher, tank nozzle, and thrown blades all occupy
        // the hand by themselves; throwable explosives remain
        // deliberately stackable props.
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
          if (!this.heldObjects.length && !this.supportObjects.length) {
            var interaction = this.findGripInteraction();
            if (interaction) {
              this.activeGripInteraction = interaction;
              interaction.grab(this.el);
              return;
            }
          }
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
            var semanticHand = this.el.components['semantic-hand'];
            if (semanticHand) semanticHand.setHeld(obj);
            if (!xrIsPresenting(this.el.sceneEl) && !this.suppressAutoSupport) autoGrabSupport(this, obj);
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

          if (this.activeGripInteraction) {
            this.activeGripInteraction.release(this.el);
            this.activeGripInteraction = null;
          }

          this.dropSupport('grip');

          if (!this.heldObjects.length) return;

          var objs = this.heldObjects;
          var self = this;
          this.heldObjects = [];
          this.stash = [];
          this.stashTime = performance.now();

          // desktop-controls' generic hand placement (placeHeldHand vs.
          // placeRestHand) branches on semantic-hand's own heldEl, which
          // Pistols' holsterable grabs otherwise never touch — without
          // this, a drawn gun is invisibly treated as "resting" by every
          // desktop/mobile-only system built on top of semantic-hand.
          var semanticHand = this.el.components['semantic-hand'];
          if (semanticHand) semanticHand.setHeld(null);

          objs.forEach(function (obj) {
            var holsterable = obj.components.holsterable;
            // The dominant hand letting go doesn't imply the support
            // hand ever will (nothing here calls its own onGripUp/
            // onTriggerUp) -- most relevantly for the auto-grabbed
            // desktop/mobile case (see autoGrabSupport), where the
            // player never controls the support hand directly at all.
            if (holsterable.supportHand) {
              var supportRig = holsterable.supportHand.components['hand-rig'];
              if (supportRig) {
                supportRig.supportObjects = supportRig.supportObjects.filter(function (o) { return o !== obj; });
              }
              holsterable.releaseSupport();
            }
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

          if (this.activeGripInteraction) {
            this.activeGripInteraction.onTriggerUse();
            return;
          }

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

          var objects = sceneElements('.grabbable');
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

          var objects = sceneElements('.grabbable');
          var self = this;
          var nearest = null;
          var nearestDist = Infinity;
          var nearestPriority = Infinity;
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
            var priority = holsterable.data.grabPriority || 0;
            if (d < holsterable.data.grabRadius &&
                (priority < nearestPriority || (priority === nearestPriority && d < nearestDist))) {
              nearest = objEl;
              nearestDist = d;
              nearestPriority = priority;
            }
          });

          return nearest;
        },

        findGripInteraction: function () {
          var handPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(handPos);
          var handles = sceneElements('.grip-interactable');
          var best = null;
          var bestDist = Infinity;
          for (var i = 0; i < handles.length; i++) {
            var control = handles[i].components['siege-control'];
            if (!control || !control.canGrab(this.el)) continue;
            var d = control.grabDistance(handPos);
            if (d < control.data.grabRadius && d < bestDist) {
              best = control;
              bestDist = d;
            }
          }
          return best;
        },
      });

      // ==============================================================
      // COMPONENT: reticle-fallback
      // The fixed center reticle (index.html) is a desktop/phone-only
      // sanity-check for target scoring when there's no gun in hand yet
      // (see its own comment there) — it fires a plain "click" on
      // whatever ".shootable" thing it's pointed at, which scoring-ring
      // and friends already treat identically to a real fired "shot"
      // (world-targets.js). Once a hand can actually draw and fire a
      // real gun on desktop too (see hand-rig's onDesktopTriggerAttempt),
      // leaving the reticle's raycaster live at the same time would let
      // one physical click register as BOTH a real shot and a reticle
      // click on the same target — a genuine double-hit, not just visual
      // clutter. Disabling its raycaster (which A-Frame's own `cursor`
      // component reads before ever emitting that synthetic click) is
      // what actually prevents the double-count; hiding the ring is just
      // keeping the visual honest about it being off.
      // ==============================================================
      registerComponent('reticle-fallback', {
        init: function () {
          this.lastEnabled = null;
        },

        tick: function () {
          var hands = sceneElements('.hand');
          var holding = false;
          for (var i = 0; i < hands.length; i++) {
            var rig = hands[i].components['hand-rig'];
            if (rig && rig.hasWeapon()) {
              holding = true;
              break;
            }
          }
          var enabled = !holding;
          if (enabled === this.lastEnabled) return;
          this.lastEnabled = enabled;
          this.el.setAttribute('raycaster', 'enabled', enabled);
          this.el.setAttribute('visible', enabled);
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
          this.checkElapsed = Math.random() * PROXIMITY_HAPTIC_CHECK_MS; // stagger the two hands
        },

        tick: function (time, dt) {
          this.checkElapsed -= dt || 16;
          if (this.checkElapsed > 0) return;
          this.checkElapsed = PROXIMITY_HAPTIC_CHECK_MS;

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

          var targets = sceneElements('.grabbable');
          var inRange = false;

          var grip = gripObjectOf(this.el);
          for (var i = 0; i < targets.length; i++) {
            var targetEl = targets[i];
            if (targetEl.object3D.parent === grip) continue; // already holding this one

            targetEl.object3D.getWorldPosition(this.targetPos);
            if (this.handPos.distanceToSquared(this.targetPos) < PROXIMITY_HAPTIC_RADIUS * PROXIMITY_HAPTIC_RADIUS) {
              inRange = true;
              break;
            }
          }

          if (inRange) {
            actuator.pulse(PROXIMITY_HAPTIC_INTENSITY, PROXIMITY_HAPTIC_PULSE_MS);
          }
        },
      });
