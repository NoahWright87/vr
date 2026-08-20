import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseInteractionCandidate,
  isWithinSemanticReach,
  shouldShowInteractionHint,
} from '../common/interaction-targeting.js';

test('a direct gaze hit wins before priority, gaze angle, and distance', () => {
  var result = chooseInteractionCandidate([
    { id: 'near', directHit: false, priority: 50, gazeDot: 0.99, distance: 0.1 },
    { id: 'looked-at', directHit: true, priority: 0, gazeDot: 0.9, distance: 0.8 },
  ]);
  assert.equal(result.id, 'looked-at');
});

test('overlapping hint zones resolve deterministically to one action target', () => {
  var result = chooseInteractionCandidate([
    { id: 'far-box', priority: 10, gazeDot: 0.96, distance: 0.7 },
    { id: 'near-box', priority: 10, gazeDot: 0.96, distance: 0.35 },
    { id: 'disabled-box', eligible: false, priority: 100, gazeDot: 1, distance: 0.1 },
  ]);
  assert.equal(result.id, 'near-box');
});

test('semantic hand reach is a hard limit with only an authored zone allowance', () => {
  assert.equal(isWithinSemanticReach(1.04, 1, 0.05), true);
  assert.equal(isWithinSemanticReach(1.06, 1, 0.05), false);
});

test('hint visibility supports always, delayed, and never policies', () => {
  assert.equal(shouldShowInteractionHint('always', 0, 900), true);
  assert.equal(shouldShowInteractionHint('delayed', 899, 900), false);
  assert.equal(shouldShowInteractionHint('delayed', 900, 900), true);
  assert.equal(shouldShowInteractionHint('never', 5000, 900), false);
});
