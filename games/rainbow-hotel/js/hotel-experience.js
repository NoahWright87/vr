// The runtime: which room the player is in, how far along the hallway
// they have walked, and therefore how high the hallway is.
//
// The whole of it is one rule:
//
//     floorY = Y(junction) + floorHeight * rise(progress)
//
// with `junction` unset (and floorY simply the current room's level)
// whenever the player is standing in a room. Both the hallway entity and
// the player's rig are placed at floorY every frame, so the player and
// the hallway never move relative to each other -- which is the entire
// reason the rise is invisible. Progress is read from the plan's walked-
// distance field, so it is a pure function of where the player is
// standing: stop and the rise stops, walk back and it comes back down,
// and the doorway you came in by is re-aligned by the time you can see
// it again.
//
// Nothing here is time-based. A timed rise would keep climbing while the
// player stood still reading a wall, and would arrive at the far doorway
// out of step with them.

import { DEFAULT_SAFE_RECT, rectsAgree } from '../../../common/guardian-bounds.js';
import { planHotel, hallwayProgress, riseFraction, riseProfile, DEFAULT_SETTINGS } from './hotel-layout.js';
import { buildHotel, buildSky } from './hotel-architecture.js';

var STORAGE_KEY = 'rainbow-hotel-settings-v1';

// The knobs worth reaching for, in the order they matter. The pre-VR
// panel builds itself from this list, so adding a tunable is one entry
// here rather than a slider plus a handler plus a label.
export var TUNABLES = [
  { key: 'floorHeight', label: 'Floor height', min: 2.6, max: 6, step: 0.1, unit: 'm',
    hint: 'How far the hallway rises per walk. Bigger jumps are more legible from the windows and no harder to hide.' },
  { key: 'baffles', label: 'Extra turns', min: 0, max: 5, step: 1, unit: '',
    hint: 'Piers added between the two that always stand at the doorways. 0 is the spec’s baseline; more is the tighter-spiral end.' },
  { key: 'laneWidth', label: 'Hallway width', min: 0.8, max: 1.6, step: 0.02, unit: 'm',
    hint: 'Comes straight off the depth of every room.' },
  { key: 'stubDepth', label: 'Doorway recess', min: 0.15, max: 0.9, step: 0.05, unit: 'm',
    hint: 'How far each doorway is set back off the run. Deeper hides more, and also comes off the rooms.' },
  { key: 'passGap', label: 'Gap past each pier', min: 0.5, max: 0.95, step: 0.02, unit: 'm',
    hint: 'Narrower blocks more sightlines; too narrow and there is no way through.' },
  { key: 'doorWidth', label: 'Doorway width', min: 0.55, max: 1, step: 0.05, unit: 'm',
    hint: 'Narrow doorways are much easier to hide -- the far edge of a wide one stays visible a long way down the run.' },
  { key: 'doorSpread', label: 'Doorway spread', min: 0.3, max: 1, step: 0.05, unit: '',
    hint: '1 puts the two doorways in opposite corners; lower pulls them toward the middle of the wall.' },
  { key: 'roomHeight', label: 'Room ceiling', min: 2.2, max: 3.4, step: 0.1, unit: 'm', hint: '' },
  { key: 'shieldSafety', label: 'Pier safety factor', min: 1, max: 3, step: 0.1, unit: 'x',
    hint: 'Multiplier on the computed minimum spacing between each doorway’s two piers.' },
];

function numberOr (value, fallback) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : fallback;
}

function isTruthy (value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

// Is the hand-entered play space the one to build against?
//
// This used to be "are safeX/safeZ set at all", which turned out to be a
// trap: the settings panel writes every field it holds to local storage,
// so nudging the play-space boxes once -- on a *desktop*, weeks ago --
// left a saved override that silently outranked the real Guardian
// forever after, on that device, in a headset. The override now has to
// be switched on deliberately, and a saved size with no switch is
// ignored.
export function overrideActive (settings) {
  return Boolean(settings && settings.useOverride && (settings.safeX || settings.safeZ));
}

// Settings come from three places, in order: the built-in defaults,
// whatever was last saved in this browser, and the query string. The
// middle one is what makes the panel useful on a Quest -- set it up on
// the flat page, then press Enter VR and it is still there.
export function resolveSettings (search, stored) {
  var settings = Object.assign({}, DEFAULT_SETTINGS, {
    // The in-headset readout starts on. See the hotel-readout component
    // for why that flipped; the settings panel turns it off for a run
    // where the windows are supposed to do the talking.
    debug: true,
    useOverride: false,
    // The building starts *off*. It is standing on a floor rectangle
    // that has not yet been shown to land inside a real Guardian -- and
    // while it is up, it hides the one thing worth looking at, which is
    // that rectangle drawn on the ground next to the boundary it is
    // meant to fit. The plan is still computed every rebuild; only the
    // geometry is withheld. Tick this back on once the floor is right.
    showHotel: false,
    // Build on the floor the player drew by hand, when there is one.
    // That rectangle is the only one anybody has stood in the room and
    // confirmed; the boundary read is still under suspicion. Untick to
    // see what the read alone would have produced.
    useHandFloor: true,
  });
  var overlay = function (source) {
    if (!source) return;
    TUNABLES.forEach(function (tunable) {
      if (source[tunable.key] === undefined || source[tunable.key] === null || source[tunable.key] === '') return;
      settings[tunable.key] = numberOr(source[tunable.key], settings[tunable.key]);
    });
    if (source.safeX !== undefined) settings.safeX = numberOr(source.safeX, settings.safeX);
    if (source.safeZ !== undefined) settings.safeZ = numberOr(source.safeZ, settings.safeZ);
    if (source.useOverride !== undefined) settings.useOverride = isTruthy(source.useOverride);
    if (source.debug !== undefined) settings.debug = isTruthy(source.debug);
    if (source.showHotel !== undefined) settings.showHotel = isTruthy(source.showHotel);
    if (source.useHandFloor !== undefined) settings.useHandFloor = isTruthy(source.useHandFloor);
  };
  overlay(stored);
  if (search) {
    var params = {};
    new URLSearchParams(search).forEach(function (value, key) { params[key] = value; });
    overlay(params);
  }
  return settings;
}

export function readStoredSettings () {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch (error) {
    // Private windows and embedded browsers can refuse storage; the
    // defaults are a perfectly good answer.
    return null;
  }
}

export function writeStoredSettings (settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // Settings still apply for this session.
  }
}

// Switching the building off has to take down whatever is already
// standing, not merely stop putting more up. Returns null so callers can
// assign it straight to `built` and have "there is no building" be one
// falsy check everywhere downstream.
function clearHotel (root) {
  while (root.firstChild) root.removeChild(root.firstChild);
  return null;
}

if (typeof AFRAME !== 'undefined') {
  AFRAME.registerComponent('rainbow-hotel', {
    schema: {
      rig: { type: 'selector' },
      camera: { type: 'selector' },
      root: { type: 'selector' },
      debug: { default: false },
    },

    init: function () {
      this.rigEl = this.data.rig || document.querySelector('#player-rig');
      this.cameraEl = this.data.camera || document.querySelector('a-camera');
      this.rootEl = this.data.root || document.querySelector('#hotel-root');
      this.headWorld = new AFRAME.THREE.Vector3();
      this.headLocal = new AFRAME.THREE.Vector3();

      this.state = { room: 0, junction: null, progress: 0, rise: 0, inHallway: false };
      this.settings = resolveSettings(window.location.search, readStoredSettings());
      this.rect = Object.assign({}, DEFAULT_SAFE_RECT);
      this.guardianRect = null;
      this.handRect = null;
      this.awaitingBoundary = false;
      this.lastDiagnostics = null;

      var self = this;
      // Subscribe *before* the first build. The Guardian arrives late and
      // more than once -- see common/guardian-bounds.js for why the first
      // read is not to be trusted -- so the building is rebuilt around
      // whatever finally settles rather than being built once at startup.
      this.el.sceneEl.addEventListener('guardian-bounds', function (event) {
        if (!event.detail || !event.detail.rect) return;
        self.lastDiagnostics = event.detail.diagnostics || null;
        self.awaitingBoundary = false;
        self.guardianRect = event.detail.rect;
        if (self.chooseRect()) self.rebuild();
      });

      // A floor dragged out by hand outranks the read. See chooseRect.
      this.el.sceneEl.addEventListener('floor-calibration-changed', function (event) {
        self.handRect = event.detail ? event.detail.rect : null;
        if (self.chooseRect()) self.rebuild();
      });

      // Entering VR is the first moment the real play space can be known,
      // and the building that is already standing was put up against a
      // guess. Rather than leave that guess in place and hope a rebuild
      // turns up, mark the wait explicitly: the readout says the boundary
      // is being read, and the guardian system guarantees a publish (with
      // the fallback if it has to) within a few seconds, which rebuilds.
      this.el.sceneEl.addEventListener('enter-vr', function () {
        if (overrideActive(self.settings)) return;
        self.awaitingBoundary = true;
      });
      // Systems initialise before components, so a rectangle settled
      // this early has already been announced to nobody.
      var guardian = this.el.sceneEl.systems['guardian-bounds'];
      if (guardian && guardian.rect) this.guardianRect = guardian.rect;
      this.chooseRect();

      buildSky(this.el.sceneEl);
      this.rebuild();
      this.syncReadout();

      // A way back to the start that doesn't involve walking down five
      // flights. Keyboard only, which is fine: in a headset the way back
      // to Red *is* walking down five flights, and whether that is
      // pleasant is one of the things being tested.
      window.addEventListener('keydown', function (event) {
        if (event.key === 'r' || event.key === 'R') self.rebuild();
      });
    },

    // Rebuilds the plan and the geometry, and puts the player back in
    // the Red room. Called at startup, when the Guardian settles, and
    // whenever the settings panel changes something.
    //
    // The plan is always computed -- the settings panel's measurements,
    // the warnings and the floor rectangle all come off it. Whether the
    // walls actually go up is a separate question, and the answer is no
    // until the floor has been shown to land inside a real Guardian. See
    // `showHotel` in resolveSettings.
    rebuild: function () {
      this.plan = planHotel(this.rect, this.settings);
      this.rootEl.object3D.position.set(this.plan.rootX, 0, this.plan.rootZ);
      this.rootEl.object3D.rotation.set(0, AFRAME.THREE.MathUtils.degToRad(this.plan.rootRotationY), 0);
      this.rootEl.object3D.updateMatrixWorld(true);
      this.built = this.settings.showHotel ? buildHotel(this.rootEl, this.plan) : clearHotel(this.rootEl);
      this.state = { room: 0, junction: null, progress: 0, rise: 0, inHallway: false };
      this.applyFloorY(this.plan.floors[0].floorY);
      this.placeFlatScreenViewer();
      this.el.sceneEl.emit('hotel-rebuilt', { plan: this.plan, profile: riseProfile(this.plan) }, false);
    },

    // Outside XR only. A headset's tracking owns where the head is, and
    // the answer there is "wherever you are standing" -- which, note, is
    // the *middle of your play space*, and therefore right up against
    // the hallway wall, since the rooms only get the part of the
    // rectangle the hallway doesn't. That is real and worth knowing; on
    // a flat screen there is no real room to respect, so start the
    // viewer back by the windows looking at the two archways instead of
    // with their nose against them.
    placeFlatScreenViewer: function () {
      if (!this.cameraEl || this.el.sceneEl.is('vr-mode')) return;
      var target = new AFRAME.THREE.Vector3(0, 0, this.plan.roomRect.maxZ - Math.min(0.6, this.plan.roomDepth * 0.3));
      this.rootEl.object3D.localToWorld(target);
      var rig = this.rigEl.object3D.position;
      this.cameraEl.object3D.position.set(target.x - rig.x, 1.62, target.z - rig.z);

      var yaw = AFRAME.THREE.MathUtils.degToRad(this.plan.rootRotationY);
      var look = this.cameraEl.components['look-controls'];
      // look-controls drives the camera's rotation from its own yaw/pitch
      // objects every frame, so writing object3D.rotation alone would be
      // overwritten on the next tick.
      if (look && look.yawObject) look.yawObject.rotation.y = yaw;
      else this.cameraEl.object3D.rotation.y = yaw;
    },

    // Which rectangle the building stands on, decided in exactly one
    // place. Three answers used to be derived independently at three
    // decision points, and they drifted apart -- that is how a saved
    // play-space size came to silently outrank a real Guardian.
    //
    // In order: a hand-entered override, because someone typed it and
    // meant it; then a floor dragged out by hand in the headset, because
    // that is the one rectangle a person has stood in the room and
    // confirmed is inside their actual boundary; then the boundary read,
    // which is still the only one that can be wrong without anybody
    // noticing. Returns whether the answer changed.
    chooseRect: function () {
      var next;
      if (overrideActive(this.settings)) {
        next = Object.assign({}, this.guardianRect || DEFAULT_SAFE_RECT, {
          sizeX: this.settings.safeX || this.rect.sizeX,
          sizeZ: this.settings.safeZ || this.rect.sizeZ,
          rotationY: 0,
          centerX: 0,
          centerZ: 0,
          source: 'override',
        });
      } else if (this.settings.useHandFloor && this.handRect) {
        next = Object.assign({}, this.handRect);
      } else if (this.guardianRect) {
        next = Object.assign({}, this.guardianRect);
      } else {
        next = Object.assign({}, this.rect);
      }
      var changed = !rectsAgree(next, this.rect, 0.005) || next.source !== this.rect.source;
      this.rect = next;
      return changed;
    },

    applySettings: function (next) {
      this.settings = Object.assign({}, this.settings, next);
      writeStoredSettings(this.settings);
      this.chooseRect();
      this.rebuild();
      this.syncReadout();
    },

    syncReadout: function () {
      if (!this.cameraEl) return;
      var wanted = this.data.debug || this.settings.debug;
      if (wanted && !this.cameraEl.components['hotel-readout']) this.cameraEl.setAttribute('hotel-readout', '');
      else if (!wanted && this.cameraEl.components['hotel-readout']) this.cameraEl.removeAttribute('hotel-readout');

      var scene = this.el.sceneEl;
      if (wanted && !scene.querySelector('#boundary-overlay')) {
        var overlay = document.createElement('a-entity');
        overlay.setAttribute('id', 'boundary-overlay');
        overlay.setAttribute('boundary-overlay', '');
        // Into the play space, not the scene: the boundary it draws is
        // measured in play-space coordinates now, so this is the one
        // parent that makes those numbers land where they mean.
        (scene.querySelector('#play-space') || scene).appendChild(overlay);
      } else if (!wanted) {
        var existing = scene.querySelector('#boundary-overlay');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      }
    },

    applyFloorY: function (floorY) {
      this.floorY = floorY;
      // The rig is set either way: with the building switched off the
      // player still stands on floor zero, which is where the floor
      // rectangle and the boundary overlay are drawn.
      if (this.built && this.built.hallway) this.built.hallway.object3D.position.y = floorY;
      this.rigEl.object3D.position.y = floorY;
    },

    // The state machine. Two states -- standing in a room, or walking
    // the hallway -- and the transitions between them are decided purely
    // by where the player's head is on the floor plan.
    step: function (x, z) {
      var plan = this.plan;
      var state = this.state;
      var threshold = 0.02;
      var topFloor = plan.floors.length - 1;

      if (state.junction === null) {
        // Crossed the shared wall into the hallway. Which junction that
        // is depends on which of the room's two doorways they used: the
        // one nearer the first doorway leads up from this floor, the one
        // nearer the second leads down from it.
        if (z < plan.doorPlaneZ - threshold) {
          var usedUpDoor = Math.abs(x - plan.doorAX) <= Math.abs(x - plan.doorBX);
          var junction = usedUpDoor ? state.room : state.room - 1;
          if (junction >= 0 && junction < topFloor) {
            state.junction = junction;
            state.inHallway = true;
          }
        }
        if (state.junction === null) {
          state.progress = 0;
          state.rise = 0;
          return plan.floors[state.room].floorY;
        }
      }

      state.progress = hallwayProgress(plan, x, z);
      state.rise = riseFraction(plan, state.progress);

      // Back out through the shared wall: whichever floor the hallway is
      // actually level with is the room they have stepped into. Rounding
      // is safe because the rise is pinned to 0 or 1 near both doorways
      // by construction -- that is what the occlusion window buys.
      if (z > plan.doorPlaneZ + threshold) {
        var arrived = state.junction + Math.round(state.rise);
        state.room = Math.max(0, Math.min(topFloor, arrived));
        state.junction = null;
        state.inHallway = false;
        state.progress = 0;
        state.rise = 0;
        return plan.floors[state.room].floorY;
      }

      return plan.floors[state.junction].floorY + plan.floorHeight * state.rise;
    },

    tick: function () {
      // No building means no rooms to be in and no hallway to walk, so
      // the state machine simply doesn't run and the rig stays on floor
      // zero with the floor rectangle.
      if (!this.plan || !this.built || !this.cameraEl) return;
      this.cameraEl.object3D.getWorldPosition(this.headWorld);
      this.headLocal.copy(this.headWorld);
      this.rootEl.object3D.worldToLocal(this.headLocal);
      // Only the floor plan matters. The head's height is driven by the
      // rig, which is driven by this function's own output, so feeding it
      // back in would be a loop.
      this.applyFloorY(this.step(this.headLocal.x, this.headLocal.z));
    },

    // For the readout and for tests: everything the runtime currently
    // believes, in one object.
    report: function () {
      var floor = this.plan.floors[this.state.room];
      return {
        room: this.state.room,
        roomName: floor ? floor.name : '?',
        junction: this.state.junction,
        progress: this.state.progress,
        rise: this.state.rise,
        floorY: this.floorY,
        inHallway: this.state.junction !== null,
        standing: Boolean(this.built),
        rect: this.rect,
        plan: this.plan,
      };
    },
  });

  // The in-headset readout.
  //
  // On by default, which is a deliberate reversal. It was off so that the
  // windows would have to do the work of saying which floor you are on --
  // which is still the right test, and the switch is in the settings
  // panel. But the first real headset session failed on something no
  // amount of looking could diagnose (the play space was never read, and
  // nothing anywhere said so), and a POC you cannot debug from inside is
  // worse than one that tells you too much.
  AFRAME.registerComponent('hotel-readout', {
    schema: { hotel: { type: 'selector' } },

    init: function () {
      this.panel = document.createElement('a-entity');
      // High and a metre out, rather than low and close. The thing this
      // panel is currently reporting on is drawn on the floor, and a
      // head-locked board below the horizon sits exactly on top of it.
      this.panel.setAttribute('position', '0 0.34 -0.95');

      var backing = document.createElement('a-plane');
      backing.setAttribute('width', '0.94');
      backing.setAttribute('height', '0.80');
      backing.setAttribute('material', 'color: #05070c; opacity: 0.85; transparent: true; shader: flat');
      this.panel.appendChild(backing);

      this.text = document.createElement('a-text');
      this.text.setAttribute('value', 'reading play space...');
      this.text.setAttribute('align', 'left');
      this.text.setAttribute('color', '#d8e4f2');
      // width is the metre span the block wraps into and wrapCount is how
      // many characters go in it, so the two together are what set the
      // glyph size. Left to their defaults the text came out several
      // times too big and ran off the panel.
      this.text.setAttribute('width', '0.90');
      this.text.setAttribute('wrap-count', '52');
      this.text.setAttribute('baseline', 'top');
      this.text.setAttribute('anchor', 'left');
      this.text.setAttribute('position', '-0.45 0.385 0.002');
      this.panel.appendChild(this.text);

      this.el.appendChild(this.panel);
      this.lastUpdate = 0;

      // A head-locked panel is still a real object in the world, so a
      // wall a foot in front of your face hides it -- which is most of
      // the time, in a building made of small rooms. Drawing it last and
      // without a depth test is what makes it a heads-up display rather
      // than a sign on the far side of the plasterboard.
      var lift = function (el, name) {
        var apply = function () {
          var mesh = el.getObject3D(name);
          if (!mesh || !mesh.material) return;
          mesh.material.depthTest = false;
          mesh.renderOrder = 999;
        };
        if (el.getObject3D(name)) apply();
        el.addEventListener('loaded', apply);
        el.addEventListener('object3dset', apply);
      };
      lift(backing, 'mesh');
      lift(this.text, 'text');
    },

    remove: function () {
      if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    },

    tick: function (time) {
      // Three times a second. An <a-text> value change rebuilds its
      // geometry, which is not something to do every frame.
      if (time - this.lastUpdate < 330) return;
      this.lastUpdate = time;
      var hotel = (this.data.hotel || this.el.sceneEl).components['rainbow-hotel'];
      if (!hotel || !hotel.plan) return;
      var guardian = this.el.sceneEl.systems['guardian-bounds'];
      var calibration = this.el.sceneEl.components['floor-calibration'];
      this.text.setAttribute('value', describeBoundaryState(
        guardian ? guardian.diagnostics() : null,
        hotel.report(),
        hotel.awaitingBoundary,
        calibration && calibration.corners ? calibration.report() : null
      ));
    },
  });

  // Your actual boundary, drawn on the floor you are standing on.
  //
  // Numbers tell you whether a rectangle was read; this tells you whether
  // it is the *right* rectangle, which is the question that matters and
  // the one that is impossible to answer by looking at a hotel. Cyan is
  // the polygon the headset handed over, amber is the rectangle fitted
  // inside it, magenta is the tracking origin -- and if the amber box
  // doesn't sit inside your real Guardian, the building won't either.
  //
  // Bounds arrive in the same space the rig lives in, and the rig is
  // never moved horizontally, so these go straight into world XZ. Only
  // the height follows the player, so the overlay is on the floor of
  // whichever storey they are currently on.
  AFRAME.registerComponent('boundary-overlay', {
    init: function () {
      this.drawnFor = null;
      this.segments = document.createElement('a-entity');
      this.el.appendChild(this.segments);
    },

    segment: function (from, to, color, thickness) {
      var dx = to.x - from.x;
      var dz = to.z - from.z;
      var length = Math.hypot(dx, dz);
      if (length < 1e-4) return;
      var box = document.createElement('a-box');
      box.setAttribute('width', length.toFixed(4));
      box.setAttribute('height', '0.012');
      box.setAttribute('depth', String(thickness));
      box.setAttribute('position', ((from.x + to.x) / 2).toFixed(4) + ' 0 ' + ((from.z + to.z) / 2).toFixed(4));
      box.setAttribute('rotation', '0 ' + (-Math.atan2(dz, dx) * 180 / Math.PI).toFixed(2) + ' 0');
      box.setAttribute('material', 'color: ' + color + '; shader: flat');
      this.segments.appendChild(box);
    },

    redraw: function (diagnostics) {
      while (this.segments.firstChild) this.segments.removeChild(this.segments.firstChild);

      var polygon = diagnostics && diagnostics.polygon;
      if (polygon && polygon.length > 2) {
        for (var i = 0; i < polygon.length; i++) {
          this.segment(polygon[i], polygon[(i + 1) % polygon.length], '#33e0ff', 0.035);
        }
      }

      var rect = diagnostics && diagnostics.rect;
      if (rect) {
        var radians = AFRAME.THREE.MathUtils.degToRad(rect.rotationY || 0);
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        var halfX = rect.sizeX / 2;
        var halfZ = rect.sizeZ / 2;
        var corners = [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]].map(function (corner) {
          // Same convention as the building root's own rotation, so the
          // outline lands exactly where the walls do.
          return {
            x: rect.centerX + corner[0] * cos + corner[1] * sin,
            z: rect.centerZ - corner[0] * sin + corner[1] * cos,
          };
        });
        for (var c = 0; c < 4; c++) this.segment(corners[c], corners[(c + 1) % 4], '#ffc24a', 0.05);
      }

      // Where the tracking origin actually is. If this isn't near the
      // middle of your room, that alone explains a building that feels
      // shifted.
      this.segment({ x: -0.15, z: 0 }, { x: 0.15, z: 0 }, '#ff5fd2', 0.04);
      this.segment({ x: 0, z: -0.15 }, { x: 0, z: 0.15 }, '#ff5fd2', 0.04);
    },

    tick: function () {
      var hotel = this.el.sceneEl.components['rainbow-hotel'];
      var guardian = this.el.sceneEl.systems['guardian-bounds'];
      if (!hotel || !guardian) return;
      this.el.object3D.position.y = (hotel.floorY || 0) + 0.015;

      var diagnostics = guardian.diagnostics();
      // Redrawing is entity churn, so only when the answer has changed.
      var signature = [
        diagnostics.polygon ? diagnostics.polygon.length : 0,
        diagnostics.rect.sizeX.toFixed(3),
        diagnostics.rect.sizeZ.toFixed(3),
        diagnostics.rect.centerX.toFixed(3),
        diagnostics.rect.centerZ.toFixed(3),
        (diagnostics.rect.rotationY || 0).toFixed(2),
      ].join('|');
      if (signature === this.drawnFor) return;
      this.drawnFor = signature;
      this.redraw(diagnostics);
    },
  });
}

// Pure, so the wording can be checked without a headset. Written to be
// read at arm's length in a headset: the state first, then the numbers
// that explain it.
export function describeBoundaryState (diagnostics, report, awaiting, floor) {
  var lines = [];
  if (!diagnostics) {
    lines.push('PLAY SPACE  no guardian-bounds system');
  } else {
    var rect = diagnostics.rect || {};
    var source = rect.source || 'fallback';
    var headline = awaiting ? 'reading...'
      : (diagnostics.overridden ? 'HAND-SET' : String(source).toUpperCase());
    lines.push('PLAY SPACE  ' + headline);
    lines.push('  size  ' + (rect.sizeX || 0).toFixed(2) + ' x ' + (rect.sizeZ || 0).toFixed(2) +
      ' m   turned ' + (rect.rotationY || 0).toFixed(1) + ' deg');
    lines.push('  centre  ' + (rect.centerX || 0).toFixed(2) + ', ' + (rect.centerZ || 0).toFixed(2));

    lines.push('BOUNDARY READ  ' + (diagnostics.spaceState || 'idle') +
      (diagnostics.finishedBecause ? ', ' + diagnostics.finishedBecause : ''));
    if (diagnostics.spaceError) lines.push('  ! ' + trim(diagnostics.spaceError, 44));
    lines.push('  vr ' + yesNo(diagnostics.xrSupported) + '/' + yesNo(diagnostics.sessionActive) +
      '   points ' + diagnostics.rawPoints + (diagnostics.rawExtent
      ? '   raw ' + diagnostics.rawExtent.sizeX.toFixed(2) + ' x ' + diagnostics.rawExtent.sizeZ.toFixed(2)
      : '   raw --'));
    // Both of these climbing is the boundary being re-measured while you
    // stand there: `recentred` because the headset said its origin
    // moved, `moved` because a re-read disagreed with what was published.
    // A building put up before either was standing in the wrong place.
    lines.push('  fits ' + diagnostics.goodReads + '   recentred x' + (diagnostics.resets || 0) +
      '   moved x' + (diagnostics.drifts || 0));
    if (diagnostics.poseFailures) lines.push('  pose failures: ' + diagnostics.poseFailures);
    if (diagnostics.fitFailures) lines.push('  saw boundary, no rectangle fitted x' + diagnostics.fitFailures);
  }

  // The hand-drawn floor, and what to press to change it. This is the
  // panel's whole reason for existing right now: the numbers above say a
  // rectangle was read, and only this says whether it is the *right*
  // rectangle, by letting it be compared to one dragged out by hand.
  if (floor) {
    lines.push('FLOOR  ' + (floor.editing ? 'EDITING' : 'locked') +
      '   ' + (floor.edited ? 'hand-set' : 'from the read'));
    if (floor.sides) {
      // The sides themselves, not the bounding box: a rectangle turned
      // 18 degrees has a box half a metre bigger than itself in both
      // directions, which reads as "too big" next to a Guardian you are
      // standing comfortably inside.
      var acrossA = (floor.sides[0] + floor.sides[2]) / 2;
      var acrossB = (floor.sides[1] + floor.sides[3]) / 2;
      var outOfSquare = Math.max(Math.abs(floor.sides[0] - floor.sides[2]),
        Math.abs(floor.sides[1] - floor.sides[3]));
      lines.push('  sides ' + acrossA.toFixed(2) + ' x ' + acrossB.toFixed(2) +
        '   area ' + floor.area.toFixed(2) + ' m2');
      lines.push('  centre ' + floor.extent.centerX.toFixed(2) + ', ' + floor.extent.centerZ.toFixed(2) +
        '   skew ' + outOfSquare.toFixed(2) + ' m');
    }
    // The whole point of drawing a floor by hand: this line says what
    // kind of error the boundary read is making. A pure offset is a
    // stale origin, a turn is the fitted frame, a size difference is the
    // fit or the inset.
    if (floor.versus) {
      lines.push('  vs read  ' + floor.versus.offset.toFixed(2) + ' m off (' +
        signed(floor.versus.offsetX) + ', ' + signed(floor.versus.offsetZ) + ')');
      lines.push('    turned ' + signed(floor.versus.turn, 1) + ' deg   sides ' +
        signed(floor.versus.longBy) + ' / ' + signed(floor.versus.shortBy));
    }
    if (!floor.editing) lines.push('  A/B/X/Y to edit the corners');
    else if (floor.holding >= 0) lines.push('  holding corner ' + (floor.holding + 1) + ' -- release grip to drop');
    else if (floor.hovered >= 0) lines.push('  corner ' + (floor.hovered + 1) + ' -- grip to grab, trigger resets');
    else lines.push('  point at a corner -- grip grabs, trigger resets');
  }

  if (report && report.plan) {
    lines.push('HOTEL  ' + (report.standing ? 'standing' : 'hidden'));
    lines.push('  rooms ' + report.plan.runLength.toFixed(2) + ' x ' + report.plan.roomDepth.toFixed(2) +
      '   hall ' + report.plan.laneWidth.toFixed(2) + ' gap ' + report.plan.passGap.toFixed(2));
    if (report.standing) {
      lines.push('  ' + (report.inHallway
        ? 'hallway ' + (report.junction + 1) + '  walk ' + (report.progress * 100).toFixed(0) + '%'
        : report.roomName + ' (floor ' + (report.room + 1) + ')'));
    }
  }
  return lines.join('\n');
}

function yesNo (value) {
  if (value === null || value === undefined) return '?';
  return value ? 'yes' : 'no';
}

// Signs matter here: "0.9m off" says nothing about which way, and which
// way is what tells a shifted origin from a mis-fitted rectangle.
function signed (value, digits) {
  var fixed = Number(value).toFixed(digits === undefined ? 2 : digits);
  return Number(fixed) > 0 ? '+' + fixed : fixed;
}

function trim (text, max) {
  var value = String(text);
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
