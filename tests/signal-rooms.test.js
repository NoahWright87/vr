import assert from 'node:assert/strict';
import test from 'node:test';

import { makeRoomCode, ROOM_CODE_CHARS } from '../server/signal-rooms.js';

test('room codes are four characters from the unambiguous alphabet', () => {
  var code = makeRoomCode();
  assert.equal(code.length, 4);
  for (var ch of code) assert.ok(ROOM_CODE_CHARS.includes(ch));
});

test('a colliding code is retried until a free one is found', () => {
  var calls = 0;
  var realRandom = Math.random;
  Math.random = function () {
    calls += 1;
    // The first four calls spell out an already-taken code; every
    // call after that lands on a different, free one.
    return calls <= 4 ? 0 : 0.5;
  };
  try {
    var code = makeRoomCode(new Set(['AAAA']));
    assert.notEqual(code, 'AAAA');
  } finally {
    Math.random = realRandom;
  }
});
