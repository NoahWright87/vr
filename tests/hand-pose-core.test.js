import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINGERS, JOINTS, blendPoses, boneName, compactPose, fingerCurl, normalizePose, poseEquals,
  setFingerCurl, setJoint, validatePose,
} from '../common/hand-pose-core.js';

test('bones are named the way the hand model names them', () => {
  assert.equal(boneName('thumb', 0), 'Ta');
  assert.equal(boneName('index', 2), 'F1c');
  assert.equal(boneName('pinky', 1), 'F4b');
  assert.deepEqual(FINGERS, ['thumb', 'index', 'middle', 'ring', 'pinky']);
});

test('a pose with no fingers is the open hand, and every shorthand spells out the same way', () => {
  const open = normalizePose({});
  for (const finger of FINGERS) {
    assert.equal(open.fingers[finger].length, JOINTS);
    for (const joint of open.fingers[finger]) assert.deepEqual(joint, { curl: 0, spread: 0, twist: 0 });
  }
  const number = normalizePose({ fingers: { index: 0.5 } });
  const array = normalizePose({ fingers: { index: [0.5, 0.5, { curl: 0.5 }] } });
  assert.deepEqual(number, array);
});

test('compacting uses a number for a plain uniform finger, joints otherwise, and drops open fingers', () => {
  const pose = { fingers: {
    thumb: [0.6, { curl: 0.5, spread: 12 }, 0.4],
    index: [0.3, 0.3, 0.3],
    middle: 0,
    ring: [0.5, 0.7, 0.9],
  } };
  const compact = compactPose(pose);
  assert.deepEqual(compact.fingers, {
    thumb: [0.6, { curl: 0.5, spread: 12 }, 0.4],
    index: 0.3,
    ring: [0.5, 0.7, 0.9],
  });
  assert.deepEqual(compactPose(compact), compact, 'compacting twice changes nothing');
  assert.equal(JSON.stringify(compactPose({ fingers: { ring: 1, thumb: 1 } })), JSON.stringify(compactPose({ fingers: { thumb: 1, ring: 1 } })));
});

test('equal poses compare equal whatever shorthand wrote them, and float dust does not count', () => {
  assert.ok(poseEquals({ fingers: { index: 0.4 } }, { fingers: { index: [0.4, 0.4, 0.4] } }));
  assert.ok(poseEquals({ fingers: { index: 0.4 } }, { fingers: { index: 0.4000000001 } }));
  assert.ok(!poseEquals({ fingers: { index: 0.4 } }, { fingers: { index: 0.45 } }));
  assert.ok(poseEquals({}, { fingers: { index: 0 } }));
});

test('validation names the problem and where it is', () => {
  assert.deepEqual(validatePose({ fingers: { index: 0.5 } }), []);
  assert.match(validatePose({ fingers: { toe: 1 } })[0], /unknown finger "toe"/);
  assert.match(validatePose({ fingers: { index: [1, 1] } })[0], /needs 3 joints/);
  assert.match(validatePose({ fingers: { index: 3 } })[0], /index\.curl: 3 is outside/);
  assert.match(validatePose({ fingers: { thumb: [{ spred: 4 }, 0, 0] } })[0], /unknown key "spred"/);
  assert.match(validatePose({ fingers: { thumb: [{ twist: NaN }, 0, 0] } })[0], /must be a number/);
  assert.match(validatePose({ colour: 'red' })[0], /unknown key "colour"/);
  assert.match(validatePose(null)[0], /must be an object/);
});

test('editing one joint, or one whole finger, clamps to the limits and leaves the rest alone', () => {
  const start = { fingers: { index: 0.2, middle: 0.8 } };
  const edited = setJoint(start, 'index', 1, 'spread', 500);
  assert.equal(edited.fingers.index[1].spread, 60);
  assert.equal(edited.fingers.index[0].spread, 0);
  assert.equal(edited.fingers.middle[2].curl, 0.8);
  assert.equal(start.fingers.index, 0.2, 'the input is not modified');
  const closed = setFingerCurl(start, 'ring', 9);
  assert.deepEqual(closed.fingers.ring.map(j => j.curl), [1.5, 1.5, 1.5]);
  assert.ok(Math.abs(fingerCurl({ fingers: { thumb: [0.3, 0.6, 0.9] } }, 'thumb') - 0.6) < 1e-9);
});

test('blending runs every degree of freedom between two poses', () => {
  const a = { fingers: { index: 0 } };
  const b = { fingers: { index: [1, 1, { curl: 1, spread: 10 }] } };
  const half = blendPoses(a, b, 0.5);
  assert.deepEqual(half.fingers.index.map(j => j.curl), [0.5, 0.5, 0.5]);
  assert.equal(half.fingers.index[2].spread, 5);
  assert.ok(poseEquals(blendPoses(a, b, 0), a));
  assert.ok(poseEquals(blendPoses(a, b, 1), b));
});
