// Tiny local relay for the multiplayer connection POC's offer/answer
// handshakes — see common/signal-relay.js for the browser-side client
// that talks to this. Deliberately dumb: a room is one host and any
// number of joiners, each with its own separate offer/answer
// exchange (a "star" — joiners never talk to each other, only ever
// to the host), routed by a peerId this relay assigns. It never
// forwards anything beyond that one-time handshake — actual gameplay
// goes directly peer-to-peer over WebRTC once each exchange completes
// (see common/multiplayer.js's createHostSession).
//
// Run with `npm run signal`. Everyone's browser needs to be on the
// same local network as whatever machine this is running on — it
// does not (and cannot) work over the open internet.

import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'node:os';
import { makeRoomCode } from './signal-rooms.js';

var PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

function localAddresses () {
  var nets = networkInterfaces();
  var addresses = [];
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (net) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    });
  });
  return addresses;
}

// code -> { hostWs, nextPeerNum, joiners: Map<peerId, ws> }
var rooms = new Map();

var wss = new WebSocketServer({ port: PORT });

wss.on('connection', function (ws) {
  var roomCode = null;
  var role = null;
  var peerId = null; // only ever set for a joiner

  ws.on('message', function (raw) {
    var message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      return;
    }

    if (message.type === 'host') {
      roomCode = makeRoomCode(new Set(rooms.keys()));
      role = 'host';
      rooms.set(roomCode, { hostWs: ws, nextPeerNum: 1, joiners: new Map() });
      ws.send(JSON.stringify({ type: 'hosting', code: roomCode }));
      return;
    }

    if (message.type === 'join') {
      var joinRoom = rooms.get(message.code);
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
      var hostRoom = rooms.get(roomCode);
      if (!hostRoom) return;
      var joinerWs = hostRoom.joiners.get(message.peerId);
      if (joinerWs) joinerWs.send(JSON.stringify({ type: 'offer', sdp: message.sdp }));
      return;
    }

    if (message.type === 'answer' && role === 'joiner') {
      var answerRoom = rooms.get(roomCode);
      if (!answerRoom || !answerRoom.hostWs) return;
      answerRoom.hostWs.send(JSON.stringify({ type: 'answer', peerId: peerId, sdp: message.sdp }));
      return;
    }
  });

  ws.on('close', function () {
    if (role === 'host' && roomCode) {
      rooms.delete(roomCode);
      return;
    }
    if (role === 'joiner' && roomCode) {
      var room = rooms.get(roomCode);
      if (room) room.joiners.delete(peerId);
    }
  });
});

console.log('Signaling relay listening on port ' + PORT + '.');
console.log("Point each headset's browser at one of these (same Wi-Fi only):");
var addresses = localAddresses();
if (addresses.length) {
  addresses.forEach(function (address) {
    console.log('  ws://' + address + ':' + PORT);
  });
} else {
  console.log('  (no non-internal IPv4 interface found — check your network connection)');
}
