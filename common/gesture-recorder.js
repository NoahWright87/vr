import './hand-tracking.js';
import { buildMenuChrome } from './menus.js';
import {
  MOTION_RECORDING_DEFAULTS,
  createRecordingSegmenterState,
  updateRecordingSegmenter,
} from './motion-recording.js';

var THREE = AFRAME.THREE;

// Layout constants for the panel built entirely in JS below (no
// <template>, since its row count is dynamic) -- same row/chrome sizing
// family as common/menus.js's buildMenuChrome and menu-option's popup
// list, just laid out by hand instead of borrowing those components
// directly, since neither is built for a permanently-open, arbitrary-
// length list.
var PANEL_WIDTH = 1.1;
var CHROME_HEIGHT = 0.18;
var ROW_HEIGHT = 0.155;
var ROW_GAP = 0.012;
var ROW_STEP = ROW_HEIGHT + ROW_GAP;
var BOTTOM_MARGIN = 0.06;
var TOP_Y = 0.55;
var ICON_SIZE = 0.12;

function makeRow(container, x, y, width, value, label, color, hoverColor) {
  var row = document.createElement('a-entity');
  row.classList.add('pm-target', 'menu-target');
  row.setAttribute('geometry', 'primitive: plane; width: ' + width + '; height: ' + ROW_HEIGHT);
  row.setAttribute('material', 'color: ' + (color || '#182238'));
  var attrs = 'value: ' + value + '; label: ' + label;
  if (hoverColor) attrs += '; hoverColor: ' + hoverColor;
  row.setAttribute('menu-item', attrs);
  row.setAttribute('position', x + ' ' + y + ' 0');
  var text = document.createElement('a-text');
  text.setAttribute('value', label);
  text.setAttribute('align', 'center');
  text.setAttribute('color', '#eee');
  text.setAttribute('width', 2.6);
  text.setAttribute('wrap-count', 30);
  text.setAttribute('position', '0 0 0.01');
  row.appendChild(text);
  container.appendChild(row);
  return row;
}

function makeIconButton(container, x, y, value, label, glyph, color) {
  var btn = document.createElement('a-entity');
  btn.classList.add('pm-target', 'menu-target');
  btn.setAttribute('geometry', 'primitive: plane; width: ' + ICON_SIZE + '; height: ' + ICON_SIZE);
  btn.setAttribute('material', 'color: ' + (color || '#182238'));
  btn.setAttribute('menu-item', 'value: ' + value + '; label: ' + label + '; hoverColor: #5c2a2a');
  btn.setAttribute('position', x + ' ' + y + ' 0.001');
  var glyphEl = document.createElement('a-text');
  glyphEl.setAttribute('value', glyph);
  glyphEl.setAttribute('align', 'center');
  glyphEl.setAttribute('color', '#fff');
  glyphEl.setAttribute('width', 6);
  glyphEl.setAttribute('position', '0 0 0.012');
  btn.appendChild(glyphEl);
  container.appendChild(btn);
  return btn;
}

// The gesture-recording workbench described in the project README's Hand
// Tracking section: a permanent, always-reachable panel (point a finger
// gun and fire at it, the same activation every other menu in this
// codebase already uses -- no proximity/open-close logic, it's just
// always there) that records real WebXR hand tracking into named clips,
// so canonical gestures can be designed and reviewed against real
// recorded motion instead of hand-derived thresholds and verbal
// descriptions of a motion neither party can see. Deliberately scoped to
// recording + review + export only for now -- no live per-hand color
// feedback and no automatic detection-fitting yet, both of which need
// real recorded clips to design against before they're worth building.
AFRAME.registerComponent('motion-recorder', {
  schema: {
    leftHand: { type: 'selector' },
    rightHand: { type: 'selector' },
    statusHud: { type: 'selector' },
    countdownStepMs: { default: 700 },
  },

  init: function () {
    this.phase = 'idle'; // idle | countdown | recording
    this.clips = [];
    this.nextClipNumber = 1;
    this.pendingDeleteId = null;
    this.countdownTimer = null;

    this.segmenterState = createRecordingSegmenterState();
    this.currentFrames = null;
    this.clipStartAt = 0;
    this.lastSampleAt = 0;
    this._awaitingFirstSample = false;
    this._leftLastPos = null;
    this._rightLastPos = null;

    this.playback = null;
    this.playbackClip = null;
    this.playbackStartTime = null;
    this.playbackFrameIndex = 0;
    this._recenterOffset = new THREE.Vector3();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this.stagePosition = new THREE.Vector3(0, 1.2, -1.7);

    this.onSelect = this.onSelect.bind(this);
    this.el.addEventListener('menu-item-select', this.onSelect);

    this.buildPanel();
  },

  buildPanel: function () {
    var chromeBarY = TOP_Y - CHROME_HEIGHT / 2;
    this.background = document.createElement('a-plane');
    this.background.setAttribute('material', 'color: #0b1220; shader: flat');
    this.background.setAttribute('position', '0 0 -0.02');
    this.el.appendChild(this.background);

    buildMenuChrome(this.el, { width: PANEL_WIDTH, barY: chromeBarY, title: 'Gesture Recorder' });

    var toggleY = TOP_Y - CHROME_HEIGHT - ROW_GAP - ROW_HEIGHT / 2;
    this.toggleRowY = toggleY;
    this.toggleRow = makeRow(this.el, 0, toggleY, PANEL_WIDTH, 'record-toggle', '● Record', '#182238');

    this.rowsContainer = document.createElement('a-entity');
    this.el.appendChild(this.rowsContainer);

    this.renderRows();
  },

  setStatus: function (text) {
    var hud = this.data.statusHud;
    if (!hud) return;
    hud.emit('gesture-changed', { gesture: text ? 'recorder-status' : 'none', label: text || '' }, false);
  },

  onSelect: function (evt) {
    var value = evt.detail.value;
    if (value === 'record-toggle') this.onRecordToggle();
    else if (value === 'play-all') this.playAll();
    else if (value === 'export') this.exportSession();
    else if (value === 'confirm-delete') this.confirmDelete();
    else if (value.indexOf('play-') === 0) this.playClip(value.slice(5));
    else if (value.indexOf('delete-') === 0) this.requestDelete(value.slice(7));
    else if (value.indexOf('cancel-') === 0) this.cancelDelete();
  },

  onRecordToggle: function () {
    if (this.phase === 'idle') this.startCountdown();
    else if (this.phase === 'countdown') this.cancelCountdown();
    else if (this.phase === 'recording') this.stopRecording();
  },

  startCountdown: function () {
    this.phase = 'countdown';
    this.pendingDeleteId = null;
    this.renderToggleLabel();
    this.renderRows();
    var steps = ['3', '2', '1', 'GO'];
    var stepIndex = 0;
    var self = this;
    (function next() {
      if (self.phase !== 'countdown') return;
      if (stepIndex >= steps.length) {
        self.beginRecording();
        return;
      }
      self.setStatus(steps[stepIndex]);
      stepIndex++;
      self.countdownTimer = setTimeout(next, self.data.countdownStepMs);
    })();
  },

  cancelCountdown: function () {
    clearTimeout(this.countdownTimer);
    this.phase = 'idle';
    this.setStatus('');
    this.renderToggleLabel();
  },

  beginRecording: function () {
    this.phase = 'recording';
    this.segmenterState = createRecordingSegmenterState();
    this.currentFrames = null;
    this._awaitingFirstSample = true;
    this._leftLastPos = null;
    this._rightLastPos = null;
    this.setStatus('● REC');
    this.renderToggleLabel();
  },

  stopRecording: function () {
    this.phase = 'idle';
    this.finalizeCurrentClip();
    this.setStatus('');
    this.renderToggleLabel();
    this.renderRows();
  },

  renderToggleLabel: function () {
    var labels = { idle: '● Record', countdown: '… starting', recording: '■ Stop' };
    this.toggleRow.setAttribute('menu-item', 'label', labels[this.phase] || labels.idle);
    this.toggleRow.querySelector('a-text').setAttribute('text', 'value', labels[this.phase] || labels.idle);
  },

  tick: function (time) {
    this.updatePlayback(time);
    if (this.phase !== 'recording') return;
    if (this._awaitingFirstSample) {
      this.lastSampleAt = time;
      this._awaitingFirstSample = false;
      return;
    }
    var elapsed = time - this.lastSampleAt;
    if (elapsed < MOTION_RECORDING_DEFAULTS.sampleIntervalMs) return;
    this.lastSampleAt = time;

    var leftComp = this.data.leftHand && this.data.leftHand.components['hand-gesture-controls'];
    var rightComp = this.data.rightHand && this.data.rightHand.components['hand-gesture-controls'];
    var leftSample = leftComp && leftComp.getSample();
    var rightSample = rightComp && rightComp.getSample();
    if (!leftSample || !rightSample) return;

    var leftSpeed = this.trackSpeed('_leftLastPos', leftSample.wristPosition, elapsed);
    var rightSpeed = this.trackSpeed('_rightLastPos', rightSample.wristPosition, elapsed);
    var speed = Math.max(leftSpeed, rightSpeed);

    var result = updateRecordingSegmenter(this.segmenterState, speed, elapsed, MOTION_RECORDING_DEFAULTS);
    this.segmenterState = result;

    if (result.justStarted) {
      this.currentFrames = [];
      this.clipStartAt = time;
    }
    if (result.inClip && this.currentFrames) {
      this.currentFrames.push({ tMs: time - this.clipStartAt, left: leftSample, right: rightSample });
    }
    if (result.justEnded) this.finalizeCurrentClip();
  },

  trackSpeed: function (key, pos, deltaMs) {
    var last = this[key];
    this[key] = pos;
    if (!last || !deltaMs) return 0;
    var dx = pos.x - last.x;
    var dy = pos.y - last.y;
    var dz = pos.z - last.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) / (deltaMs / 1000);
  },

  finalizeCurrentClip: function () {
    var frames = this.currentFrames;
    this.currentFrames = null;
    if (!frames || frames.length < 2) return;
    var durationMs = frames[frames.length - 1].tMs;
    if (durationMs < MOTION_RECORDING_DEFAULTS.minClipDurationMs) return;
    var clip = {
      id: 'clip-' + this.nextClipNumber,
      name: 'Clip ' + this.nextClipNumber,
      durationMs: durationMs,
      frames: frames,
    };
    this.nextClipNumber++;
    this.clips.push(clip);
    if (this.phase === 'recording') this.setStatus('● REC (' + this.clips.length + ')');
    this.renderRows();
  },

  requestDelete: function (clipId) {
    this.pendingDeleteId = clipId;
    this.renderRows();
  },

  cancelDelete: function () {
    this.pendingDeleteId = null;
    this.renderRows();
  },

  confirmDelete: function () {
    var id = this.pendingDeleteId;
    this.pendingDeleteId = null;
    this.clips = this.clips.filter(function (clip) { return clip.id !== id; });
    this.renderRows();
  },

  renderRows: function () {
    while (this.rowsContainer.firstChild) this.rowsContainer.removeChild(this.rowsContainer.firstChild);

    var specs = [];
    if (!this.clips.length) {
      specs.push({ type: 'empty' });
    } else {
      this.clips.forEach(function (clip) { specs.push({ type: 'clip', clip: clip }); });
      if (this.clips.length > 1) specs.push({ type: 'play-all' });
      specs.push({ type: 'export' });
      if (this.pendingDeleteId) specs.push({ type: 'danger' });
    }

    var y = this.toggleRowY - ROW_STEP;
    var self = this;
    specs.forEach(function (spec) {
      self.buildRow(spec, y);
      y -= ROW_STEP;
    });

    var slots = 1 + specs.length;
    var height = CHROME_HEIGHT + ROW_GAP + slots * ROW_STEP + BOTTOM_MARGIN;
    this.background.setAttribute('geometry', 'primitive: plane; width: ' + PANEL_WIDTH + '; height: ' + height);
    this.background.setAttribute('position', '0 ' + (TOP_Y - height / 2) + ' -0.02');
  },

  buildRow: function (spec, y) {
    var container = this.rowsContainer;
    if (spec.type === 'empty') {
      var text = document.createElement('a-text');
      text.setAttribute('value', 'No clips yet -- hit Record');
      text.setAttribute('align', 'center');
      text.setAttribute('color', '#66738c');
      text.setAttribute('width', 2.2);
      text.setAttribute('position', '0 ' + y + ' 0.001');
      container.appendChild(text);
      return;
    }
    if (spec.type === 'clip') {
      var clip = spec.clip;
      if (this.pendingDeleteId === clip.id) {
        makeRow(container, 0, y, PANEL_WIDTH, 'cancel-' + clip.id, '✕ Cancel -- ' + clip.name, '#182238');
        return;
      }
      var playWidth = PANEL_WIDTH - ICON_SIZE - 0.06;
      var seconds = (clip.durationMs / 1000).toFixed(1);
      makeRow(container, -(ICON_SIZE / 2 + 0.03), y, playWidth, 'play-' + clip.id,
        '▶ ' + clip.name + ' (' + seconds + 's)', '#182238');
      makeIconButton(container, PANEL_WIDTH / 2 - ICON_SIZE / 2 - 0.02, y, 'delete-' + clip.id, 'Delete', '🗑');
      return;
    }
    if (spec.type === 'play-all') {
      makeRow(container, 0, y, PANEL_WIDTH, 'play-all', '▶▶ Play All', '#182238');
      return;
    }
    if (spec.type === 'export') {
      makeRow(container, 0, y, PANEL_WIDTH, 'export', '⤓ Export (' + this.clips.length + ')', '#1c3a2a', '#245c3a');
      return;
    }
    if (spec.type === 'danger') {
      var target = this.clips.filter((c) => c.id === this.pendingDeleteId)[0];
      makeRow(container, 0, y, PANEL_WIDTH, 'confirm-delete',
        '⚠ Confirm delete: ' + (target ? target.name : ''), '#3a1616', '#5c2020');
    }
  },

  // --- Ghost replay -------------------------------------------------
  // Recorded clips are stored in whatever local coordinates the rig
  // happened to be in at record time, which may not be a sensible place
  // to stand and look once played back later (the rig could have moved
  // since, or the recording station could move in a future page).
  // Replaying re-centers each clip around a fixed stage position instead
  // of its literal recorded coordinates, so ghost playback always shows
  // up somewhere walkable-around near the recorder regardless of where
  // in the room the original take happened -- the point is seeing the
  // *shape* of the motion, not reproducing exactly where you stood.

  ensureGhosts: function () {
    if (this.leftGhost) return;
    this.leftGhost = this.createGhostMarker('#4fd6ff');
    this.rightGhost = this.createGhostMarker('#ff6fd6');
  },

  createGhostMarker: function (color) {
    var marker = document.createElement('a-entity');
    marker.setAttribute('geometry', 'primitive: cone; radiusBottom: 0.035; radiusTop: 0.006; height: 0.11; segmentsRadial: 10');
    marker.setAttribute('material', 'color: ' + color + '; shader: flat');
    marker.object3D.visible = false;
    this.el.sceneEl.appendChild(marker);
    return marker;
  },

  showGhosts: function (visible) {
    if (this.leftGhost) this.leftGhost.object3D.visible = visible;
    if (this.rightGhost) this.rightGhost.object3D.visible = visible;
  },

  playClip: function (clipId) {
    var clip = this.clips.filter(function (c) { return c.id === clipId; })[0];
    if (!clip) return;
    this.ensureGhosts();
    this.playback = { queue: [clip], index: 0 };
    this.startPlaybackClip(clip);
  },

  playAll: function () {
    if (!this.clips.length) return;
    this.ensureGhosts();
    this.playback = { queue: this.clips.slice(), index: 0 };
    this.startPlaybackClip(this.playback.queue[0]);
  },

  startPlaybackClip: function (clip) {
    var first = clip.frames[0];
    var midpoint = {
      x: (first.left.wristPosition.x + first.right.wristPosition.x) / 2,
      y: (first.left.wristPosition.y + first.right.wristPosition.y) / 2,
      z: (first.left.wristPosition.z + first.right.wristPosition.z) / 2,
    };
    this._recenterOffset.set(
      this.stagePosition.x - midpoint.x,
      this.stagePosition.y - midpoint.y,
      this.stagePosition.z - midpoint.z
    );
    this.playbackClip = clip;
    this.playbackStartTime = null;
    this.playbackFrameIndex = 0;
    this.showGhosts(true);
    this.setStatus('▶ ' + clip.name);
  },

  updatePlayback: function (time) {
    if (!this.playbackClip) return;
    if (this.playbackStartTime === null) this.playbackStartTime = time;
    var elapsed = time - this.playbackStartTime;
    var frames = this.playbackClip.frames;
    while (this.playbackFrameIndex < frames.length - 2 && frames[this.playbackFrameIndex + 1].tMs <= elapsed) {
      this.playbackFrameIndex++;
    }
    var a = frames[this.playbackFrameIndex];
    var b = frames[Math.min(this.playbackFrameIndex + 1, frames.length - 1)];
    var span = Math.max(1, b.tMs - a.tMs);
    var t = Math.min(1, Math.max(0, (elapsed - a.tMs) / span));
    this.applyGhostFrame(this.leftGhost, a.left, b.left, t);
    this.applyGhostFrame(this.rightGhost, a.right, b.right, t);
    if (elapsed >= frames[frames.length - 1].tMs) this.advancePlaybackQueue();
  },

  applyGhostFrame: function (ghostEl, a, b, t) {
    ghostEl.object3D.position.set(
      THREE.MathUtils.lerp(a.wristPosition.x, b.wristPosition.x, t) + this._recenterOffset.x,
      THREE.MathUtils.lerp(a.wristPosition.y, b.wristPosition.y, t) + this._recenterOffset.y,
      THREE.MathUtils.lerp(a.wristPosition.z, b.wristPosition.z, t) + this._recenterOffset.z
    );
    this._qa.set(a.wristQuaternion.x, a.wristQuaternion.y, a.wristQuaternion.z, a.wristQuaternion.w);
    this._qb.set(b.wristQuaternion.x, b.wristQuaternion.y, b.wristQuaternion.z, b.wristQuaternion.w);
    ghostEl.object3D.quaternion.copy(this._qa).slerp(this._qb, t);
  },

  advancePlaybackQueue: function () {
    var queue = this.playback && this.playback.queue;
    if (!queue) { this.stopPlayback(); return; }
    this.playback.index++;
    if (this.playback.index >= queue.length) { this.stopPlayback(); return; }
    this.startPlaybackClip(queue[this.playback.index]);
  },

  stopPlayback: function () {
    this.playback = null;
    this.playbackClip = null;
    this.showGhosts(false);
    this.setStatus('');
  },

  // --- Export ---------------------------------------------------------
  exportSession: function () {
    var payload = {
      version: 1,
      recordedAt: new Date().toISOString(),
      sampleIntervalMs: MOTION_RECORDING_DEFAULTS.sampleIntervalMs,
      clips: this.clips.map(function (clip) {
        return { id: clip.id, name: clip.name, durationMs: clip.durationMs, frameCount: clip.frames.length, frames: clip.frames };
      }),
    };
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'gesture-recordings-' + Date.now() + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  },

  remove: function () {
    clearTimeout(this.countdownTimer);
    this.el.removeEventListener('menu-item-select', this.onSelect);
    if (this.leftGhost && this.leftGhost.parentNode) this.leftGhost.parentNode.removeChild(this.leftGhost);
    if (this.rightGhost && this.rightGhost.parentNode) this.rightGhost.parentNode.removeChild(this.rightGhost);
  },
});
