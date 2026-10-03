// WebXR controllers have exposed haptics through more than one Gamepad API
// over time. Quest Browser builds in the wild can provide either the older
// hapticActuators array or the newer vibrationActuator, so keep the
// compatibility work in one shared place instead of letting every experience
// guess which one it received.

function controllerGamepads(handEl) {
  var tracked = handEl && handEl.components && handEl.components['tracked-controls'];
  var controller = tracked && tracked.controller;
  var gamepads = [];

  // A-Frame's tracked-controls normally exposes the WebXR Gamepad directly,
  // while a few browser/controller combinations wrap it on .gamepad.
  if (controller) {
    gamepads.push(controller.gamepad || controller);
  }

  // The active XR session is a useful fallback while A-Frame is still wiring
  // its controller reference (or if a browser changes that internal shape).
  var sceneEl = handEl && handEl.sceneEl;
  var xr = sceneEl && sceneEl.renderer && sceneEl.renderer.xr;
  var session = xr && typeof xr.getSession === 'function' && xr.getSession();
  var hand = handEl && handEl.getAttribute && handEl.getAttribute('hand-with-watch');
  var handedness = hand && hand.hand;
  if (session && session.inputSources) {
    for (var i = 0; i < session.inputSources.length; i++) {
      var source = session.inputSources[i];
      if (source.handedness === handedness && source.gamepad) gamepads.push(source.gamepad);
    }
  }

  return gamepads.filter(function (gamepad, index) {
    return gamepad && gamepads.indexOf(gamepad) === index;
  });
}

export function getHapticOutput(handEl) {
  var gamepads = controllerGamepads(handEl);
  for (var i = 0; i < gamepads.length; i++) {
    var gamepad = gamepads[i];
    if (gamepad.vibrationActuator && typeof gamepad.vibrationActuator.playEffect === 'function') {
      return { type: 'vibration-actuator', actuator: gamepad.vibrationActuator };
    }
    if (gamepad.hapticActuators && gamepad.hapticActuators[0] && typeof gamepad.hapticActuators[0].pulse === 'function') {
      return { type: 'haptic-actuator', actuator: gamepad.hapticActuators[0] };
    }
  }
  return null;
}

// Resolves to a small diagnostic object rather than throwing. Haptics are
// optional in normal experiences, but a dedicated test needs to tell the
// player whether a request actually reached the browser API.
export function pulseHaptics(handEl, intensity, durationMs) {
  var output = getHapticOutput(handEl);
  var clampedIntensity = Math.max(0, Math.min(1, Number(intensity) || 0));
  var duration = Math.max(1, Math.round(Number(durationMs) || 1));
  if (!output) return Promise.resolve({ status: 'unavailable' });

  try {
    var result = output.type === 'vibration-actuator'
      ? output.actuator.playEffect('dual-rumble', {
        duration: duration,
        startDelay: 0,
        strongMagnitude: clampedIntensity,
        weakMagnitude: clampedIntensity,
      })
      : output.actuator.pulse(clampedIntensity, duration);

    return Promise.resolve(result).then(function (played) {
      return { status: played === false ? 'rejected' : 'sent', api: output.type };
    }, function (error) {
      return { status: 'failed', error: error && error.message ? error.message : String(error) };
    });
  } catch (error) {
    return Promise.resolve({ status: 'failed', error: error && error.message ? error.message : String(error) });
  }
}

// A compact, edge-triggered cue for any hand near an ordinary
// simple-grabbable + hint-zone pair. The shared interaction-hints system uses
// the zone's radius to decide whether a real XR grip can grab the object, so
// using that same radius means the buzz says exactly "grip will work now".
//
// This belongs with the shared haptics adapter rather than a particular game:
// adding `grabbable-proximity-haptics` to a hand gives every small prototype
// the same tactile affordance without coupling it to a prop's visuals.
if (typeof AFRAME !== 'undefined') {
  AFRAME.registerComponent('grabbable-proximity-haptics', {
    schema: {
      intensity: { default: 0.35 },
      duration: { default: 45 },
      interval: { default: 40 },
    },

    init: function () {
      this.nextCheckAt = 0;
      this.wasInRange = false;
      this.handPosition = new AFRAME.THREE.Vector3();
      this.targetPosition = new AFRAME.THREE.Vector3();
    },

    tick: function (time) {
      if (time < this.nextCheckAt) return;
      this.nextCheckAt = time + this.data.interval;

      var controlMode = this.el.sceneEl.systems['control-mode'];
      if (!controlMode || !controlMode.isMode('xr')) {
        this.wasInRange = false;
        return;
      }

      var hand = this.el.components['semantic-hand'];
      if (!hand || hand.heldEl) {
        this.wasInRange = false;
        return;
      }
      hand.getInteractionWorldPosition(this.handPosition);

      var targets = this.el.sceneEl.querySelectorAll('[simple-grabbable][hint-zone]');
      var inRange = false;
      for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        var zone = target.components['hint-zone'];
        var grabbable = target.components['simple-grabbable'];
        if (!zone || !grabbable || zone.data.action !== 'grab' || grabbable.state === 'held' || !zone.isAvailable('xr')) continue;
        target.object3D.getWorldPosition(this.targetPosition);
        if (this.handPosition.distanceToSquared(this.targetPosition) <= zone.data.radius * zone.data.radius) {
          inRange = true;
          break;
        }
      }

      if (inRange && !this.wasInRange) {
        var self = this;
        pulseHaptics(this.el, this.data.intensity, this.data.duration).then(function (result) {
          self.el.emit('grabbable-proximity-haptic-result', {
            status: result.status,
            durationMs: self.data.duration,
          }, true);
        });
      }
      this.wasInRange = inRange;
    },
  });
}
