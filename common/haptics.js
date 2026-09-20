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
