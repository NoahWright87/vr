import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeDescription, decodeDescription } from '../common/multiplayer.js';

test('a description round-trips through encode/decode unchanged', () => {
  var description = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' };
  assert.deepEqual(decodeDescription(encodeDescription(description)), description);
});

test('decodeDescription tolerates surrounding whitespace from a pasted blob', () => {
  var description = { type: 'answer', sdp: 'v=0\r\n' };
  var encoded = '  ' + encodeDescription(description) + '\n';
  assert.deepEqual(decodeDescription(encoded), description);
});
