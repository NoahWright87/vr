import assert from 'node:assert/strict';
import test from 'node:test';

import { SignalHub } from '../worker/src/signal-hub.js';
import { ROOM_CODE_CHARS } from '../worker/src/signal-rooms.js';

// A minimal stand-in for the Workers-runtime WebSocket that
// SignalHub#handleSession talks to — just enough of the
// EventTarget-ish surface (addEventListener + send) to drive it the
// same way a real connection would, without needing WebSocketPair or
// any other Workers-only global.
function fakeSocket () {
  var listeners = { message: [], close: [] };
  return {
    sent: [],
    send: function (raw) { this.sent.push(JSON.parse(raw)); },
    addEventListener: function (type, fn) { listeners[type].push(fn); },
    receive: function (message) {
      listeners.message.forEach(function (fn) { fn({ data: JSON.stringify(message) }); });
    },
    close: function () {
      listeners.close.forEach(function (fn) { fn(); });
    },
  };
}

function connect (hub, ws) {
  hub.handleSession(ws);
  return ws;
}

test('hosting assigns a room code from the unambiguous alphabet', () => {
  var hub = new SignalHub({});
  var host = connect(hub, fakeSocket());
  host.receive({ type: 'host' });

  assert.equal(host.sent.length, 1);
  assert.equal(host.sent[0].type, 'hosting');
  var code = host.sent[0].code;
  assert.equal(code.length, 4);
  for (var ch of code) assert.ok(ROOM_CODE_CHARS.includes(ch));
});

test('joining an unknown code gets an error, not a crash', () => {
  var hub = new SignalHub({});
  var joiner = connect(hub, fakeSocket());
  joiner.receive({ type: 'join', code: 'ZZZZ' });

  assert.deepEqual(joiner.sent, [{ type: 'error', message: 'No room with that code.' }]);
});

test('a full offer/answer handshake is relayed by peerId, star-topology style', () => {
  var hub = new SignalHub({});
  var host = connect(hub, fakeSocket());
  host.receive({ type: 'host' });
  var code = host.sent[0].code;

  var joiner = connect(hub, fakeSocket());
  joiner.receive({ type: 'join', code: code });

  assert.deepEqual(host.sent[1], { type: 'joiner-joined', peerId: 'peer-1' });

  host.receive({ type: 'offer', peerId: 'peer-1', sdp: 'offer-sdp' });
  assert.deepEqual(joiner.sent[0], { type: 'offer', sdp: 'offer-sdp' });

  joiner.receive({ type: 'answer', sdp: 'answer-sdp' });
  assert.deepEqual(host.sent[2], { type: 'answer', peerId: 'peer-1', sdp: 'answer-sdp' });
});

test('a second joiner gets its own peerId and does not see the first joiner\'s traffic', () => {
  var hub = new SignalHub({});
  var host = connect(hub, fakeSocket());
  host.receive({ type: 'host' });
  var code = host.sent[0].code;

  var joinerA = connect(hub, fakeSocket());
  joinerA.receive({ type: 'join', code: code });
  var joinerB = connect(hub, fakeSocket());
  joinerB.receive({ type: 'join', code: code });

  assert.deepEqual(host.sent[1], { type: 'joiner-joined', peerId: 'peer-1' });
  assert.deepEqual(host.sent[2], { type: 'joiner-joined', peerId: 'peer-2' });

  host.receive({ type: 'offer', peerId: 'peer-2', sdp: 'for-b' });
  assert.equal(joinerA.sent.length, 0);
  assert.deepEqual(joinerB.sent[0], { type: 'offer', sdp: 'for-b' });
});

test('the room is gone once the host disconnects', () => {
  var hub = new SignalHub({});
  var host = connect(hub, fakeSocket());
  host.receive({ type: 'host' });
  var code = host.sent[0].code;
  host.close();

  var joiner = connect(hub, fakeSocket());
  joiner.receive({ type: 'join', code: code });
  assert.deepEqual(joiner.sent, [{ type: 'error', message: 'No room with that code.' }]);
});

test('a departed joiner is dropped from the room without affecting others', () => {
  var hub = new SignalHub({});
  var host = connect(hub, fakeSocket());
  host.receive({ type: 'host' });
  var code = host.sent[0].code;

  var joiner = connect(hub, fakeSocket());
  joiner.receive({ type: 'join', code: code });
  joiner.close();

  assert.equal(hub.rooms.get(code).joiners.has('peer-1'), false);

  host.receive({ type: 'offer', peerId: 'peer-1', sdp: 'ignored' });
  assert.equal(joiner.sent.length, 0);
});
