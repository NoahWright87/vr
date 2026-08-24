// The internet-reachable counterpart to server/signal-server.js — see
// that file's header comment for the message protocol and star
// topology this mirrors exactly (host + any number of joiners, each
// with its own offer/answer exchange, routed by a relay-assigned
// peerId). This class is a near line-for-line port of that file's
// connection handling into a Durable Object, so the two should be
// kept in sync if the protocol ever changes.
//
// One Durable Object instance (this class, addressed by the fixed
// name "hub" — see worker/src/index.js) holds every room the relay
// currently knows about, in memory, just like the local relay's
// single Node process holds its `rooms` map. A signaling handshake
// moves a few KB of text once per connection, so one instance is
// nowhere near the ceiling this would need to become one Durable
// Object per room. That split only becomes worth its complexity if
// this project starts routing ongoing game state (not just the
// handshake) through Durable Objects — see TODO.md.

import { makeRoomCode } from '../../server/signal-rooms.js';

export class SignalHub {
  constructor (state) {
    this.state = state;
    // code -> { hostWs, nextPeerNum, joiners: Map<peerId, WebSocket> }
    this.rooms = new Map();
  }

  async fetch (request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    var pair = new WebSocketPair();
    var client = pair[0];
    var server = pair[1];
    server.accept();
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Split out from fetch() so tests can drive it directly against a
  // fake WebSocket-like object, without needing the Workers runtime's
  // WebSocketPair/Response(status: 101) machinery.
  handleSession (ws) {
    var self = this;
    var roomCode = null;
    var role = null;
    var peerId = null; // only ever set for a joiner

    ws.addEventListener('message', function (evt) {
      var message;
      try {
        message = JSON.parse(evt.data);
      } catch (err) {
        return;
      }

      if (message.type === 'host') {
        roomCode = makeRoomCode(new Set(self.rooms.keys()));
        role = 'host';
        self.rooms.set(roomCode, { hostWs: ws, nextPeerNum: 1, joiners: new Map() });
        ws.send(JSON.stringify({ type: 'hosting', code: roomCode }));
        return;
      }

      if (message.type === 'join') {
        var joinRoom = self.rooms.get(message.code);
        if (!joinRoom) {
          ws.send(JSON.stringify({ type: 'error', message: 'No room with that code.' }));
          return;
        }
        roomCode = message.code;
        role = 'joiner';
        peerId = 'peer-' + joinRoom.nextPeerNum++;
        joinRoom.joiners.set(peerId, ws);
        if (joinRoom.hostWs) joinRoom.hostWs.send(JSON.stringify({ type: 'joiner-joined', peerId: peerId }));
        return;
      }

      if (message.type === 'offer' && role === 'host') {
        var hostRoom = self.rooms.get(roomCode);
        if (!hostRoom) return;
        var joinerWs = hostRoom.joiners.get(message.peerId);
        if (joinerWs) joinerWs.send(JSON.stringify({ type: 'offer', sdp: message.sdp }));
        return;
      }

      if (message.type === 'answer' && role === 'joiner') {
        var answerRoom = self.rooms.get(roomCode);
        if (!answerRoom || !answerRoom.hostWs) return;
        answerRoom.hostWs.send(JSON.stringify({ type: 'answer', peerId: peerId, sdp: message.sdp }));
        return;
      }
    });

    ws.addEventListener('close', function () {
      if (role === 'host' && roomCode) {
        self.rooms.delete(roomCode);
        return;
      }
      if (role === 'joiner' && roomCode) {
        var room = self.rooms.get(roomCode);
        if (room) room.joiners.delete(peerId);
      }
    });
  }
}
