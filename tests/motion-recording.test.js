import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecordingSegmenterState,
  updateRecordingSegmenter,
  MOTION_RECORDING_DEFAULTS,
} from '../common/motion-recording.js';

test('staying below the stillness threshold never starts a clip', () => {
  var state = createRecordingSegmenterState();
  var result = updateRecordingSegmenter(state, 0.05, 40, MOTION_RECORDING_DEFAULTS);
  assert.equal(result.inClip, false);
  assert.equal(result.justStarted, false);
});

test('crossing the threshold starts a clip immediately', () => {
  var state = createRecordingSegmenterState();
  var result = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS);
  assert.equal(result.inClip, true);
  assert.equal(result.justStarted, true);
});

test('staying above the threshold on later ticks does not re-fire justStarted', () => {
  var state = createRecordingSegmenterState();
  state = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS);
  var result = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS);
  assert.equal(result.inClip, true);
  assert.equal(result.justStarted, false);
});

test('a brief dip below threshold that does not reach the stillness gap keeps the clip going', () => {
  var state = createRecordingSegmenterState();
  state = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS); // starts
  state = updateRecordingSegmenter(state, 0.05, 100, MOTION_RECORDING_DEFAULTS); // dips, only 100ms of 400ms gap
  assert.equal(state.inClip, true);
  assert.equal(state.justEnded, false);
  var result = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS); // moving again
  assert.equal(result.inClip, true);
  assert.equal(result.stillnessMs, 0);
});

test('stillness accumulates across ticks and ends the clip once it reaches the gap duration', () => {
  var state = createRecordingSegmenterState();
  state = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS); // starts
  state = updateRecordingSegmenter(state, 0.0, 250, MOTION_RECORDING_DEFAULTS); // 250ms still
  assert.equal(state.inClip, true);
  assert.equal(state.justEnded, false);
  var result = updateRecordingSegmenter(state, 0.0, 250, MOTION_RECORDING_DEFAULTS); // +250ms = 500ms >= 400ms gap
  assert.equal(result.inClip, false);
  assert.equal(result.justEnded, true);
});

test('after a clip ends, moving again starts a fresh clip', () => {
  var state = createRecordingSegmenterState();
  state = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS);
  state = updateRecordingSegmenter(state, 0.0, 500, MOTION_RECORDING_DEFAULTS);
  assert.equal(state.justEnded, true);
  var result = updateRecordingSegmenter(state, 0.5, 40, MOTION_RECORDING_DEFAULTS);
  assert.equal(result.inClip, true);
  assert.equal(result.justStarted, true);
});

test('exactly at the threshold counts as moving', () => {
  var state = createRecordingSegmenterState();
  var result = updateRecordingSegmenter(state, MOTION_RECORDING_DEFAULTS.stillnessSpeedThreshold, 40, MOTION_RECORDING_DEFAULTS);
  assert.equal(result.inClip, true);
});

test('custom thresholds are honored instead of the defaults', () => {
  var config = { stillnessSpeedThreshold: 1.0, stillnessGapMs: 1000 };
  var state = createRecordingSegmenterState();
  var result = updateRecordingSegmenter(state, 0.5, 40, config);
  assert.equal(result.inClip, false, 'below the custom, higher threshold');
  state = updateRecordingSegmenter(state, 1.5, 40, config);
  assert.equal(state.inClip, true);
  var stillNotEnded = updateRecordingSegmenter(state, 0.0, 900, config);
  assert.equal(stillNotEnded.inClip, true, 'short of the custom, longer gap');
  var ended = updateRecordingSegmenter(stillNotEnded, 0.0, 200, config);
  assert.equal(ended.justEnded, true);
});
