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

import { DEFAULT_SAFE_RECT } from '../../../common/guardian-bounds.js';
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

// Settings come from three places, in order: the built-in defaults,
// whatever was last saved in this browser, and the query string. The
// middle one is what makes the panel useful on a Quest -- set it up on
// the flat page, then press Enter VR and it is still there.
export function resolveSettings (search, stored) {
  var settings = Object.assign({}, DEFAULT_SETTINGS);
  var overlay = function (source) {
    if (!source) return;
    TUNABLES.forEach(function (tunable) {
      if (source[tunable.key] === undefined || source[tunable.key] === null || source[tunable.key] === '') return;
      settings[tunable.key] = numberOr(source[tunable.key], settings[tunable.key]);
    });
    if (source.safeX !== undefined) settings.safeX = numberOr(source.safeX, settings.safeX);
    if (source.safeZ !== undefined) settings.safeZ = numberOr(source.safeZ, settings.safeZ);
    if (source.debug !== undefined) settings.debug = source.debug === true || source.debug === 'true' || source.debug === '1';
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
      if (this.settings.safeX || this.settings.safeZ) {
        this.rect.sizeX = this.settings.safeX || this.rect.sizeX;
        this.rect.sizeZ = this.settings.safeZ || this.rect.sizeZ;
        this.rect.source = 'override';
      }

      var self = this;
      // Subscribe *before* the first build. The Guardian arrives late and
      // more than once -- see common/guardian-bounds.js for why the first
      // read is not to be trusted -- so the building is rebuilt around
      // whatever finally settles rather than being built once at startup.
      this.el.sceneEl.addEventListener('guardian-bounds', function (event) {
        if (!event.detail || !event.detail.rect) return;
        if (self.settings.safeX || self.settings.safeZ) return;
        self.rect = event.detail.rect;
        self.rebuild();
      });
      // Systems initialise before components, so a rectangle settled
      // this early has already been announced to nobody.
      var guardian = this.el.sceneEl.systems['guardian-bounds'];
      if (guardian && guardian.rect && !this.settings.safeX && !this.settings.safeZ) this.rect = guardian.rect;

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
    rebuild: function () {
      this.plan = planHotel(this.rect, this.settings);
      this.rootEl.object3D.position.set(this.plan.rootX, 0, this.plan.rootZ);
      this.rootEl.object3D.rotation.set(0, AFRAME.THREE.MathUtils.degToRad(this.plan.rootRotationY), 0);
      this.rootEl.object3D.updateMatrixWorld(true);
      this.built = buildHotel(this.rootEl, this.plan);
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

    applySettings: function (next) {
      this.settings = Object.assign({}, this.settings, next);
      writeStoredSettings(this.settings);
      if (this.settings.safeX || this.settings.safeZ) {
        this.rect = Object.assign({}, this.rect, {
          sizeX: this.settings.safeX || this.rect.sizeX,
          sizeZ: this.settings.safeZ || this.rect.sizeZ,
          source: 'override',
        });
      }
      this.rebuild();
      this.syncReadout();
    },

    syncReadout: function () {
      if (!this.cameraEl) return;
      var wanted = this.data.debug || this.settings.debug;
      if (wanted && !this.cameraEl.components['hotel-readout']) this.cameraEl.setAttribute('hotel-readout', '');
      else if (!wanted && this.cameraEl.components['hotel-readout']) this.cameraEl.removeAttribute('hotel-readout');
    },

    applyFloorY: function (floorY) {
      this.floorY = floorY;
      this.built.hallway.object3D.position.y = floorY;
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
        rect: this.rect,
        plan: this.plan,
      };
    },
  });

  // An opt-in readout, pinned to the camera. Off by default and it
  // should stay that way for a real run: the question this POC is asking
  // is whether the *windows* tell you which floor you are on, and a
  // caption saying "Green, floor 4" answers it for the player.
  AFRAME.registerComponent('hotel-readout', {
    schema: { hotel: { type: 'selector' } },

    init: function () {
      this.text = document.createElement('a-text');
      this.text.setAttribute('value', '');
      this.text.setAttribute('align', 'center');
      this.text.setAttribute('color', '#ffffff');
      this.text.setAttribute('width', '1.6');
      this.text.setAttribute('position', '0 -0.32 -0.9');
      this.el.appendChild(this.text);
      this.lastUpdate = 0;
    },

    tick: function (time) {
      // Twice a second. An <a-text> value change rebuilds its geometry,
      // which is not something to do every frame for a debug caption.
      if (time - this.lastUpdate < 500) return;
      this.lastUpdate = time;
      var hotel = (this.data.hotel || this.el.sceneEl).components['rainbow-hotel'];
      if (!hotel || !hotel.plan) return;
      var report = hotel.report();
      this.text.setAttribute('value', [
        report.inHallway
          ? 'hallway ' + (report.junction + 1) + '  walk ' + (report.progress * 100).toFixed(0) + '%  rise ' + (report.rise * 100).toFixed(0) + '%'
          : report.roomName + '  (floor ' + (report.room + 1) + ')',
        'y ' + report.floorY.toFixed(2) + 'm   play space ' +
          report.rect.sizeX.toFixed(2) + 'x' + report.rect.sizeZ.toFixed(2) + ' (' + (report.rect.source || 'fallback') + ')',
      ].join('\n'));
    },
  });
}
