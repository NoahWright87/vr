// Tiny local relay for the multiplayer connection POC's offer/answer
// handshake — see common/signal-relay.js for the browser-side client
// that talks to this. Deliberately dumb: it only ever forwards a
// host's offer to whichever peer joins its room code, and that
// peer's answer back, then forgets the room. It never sees game
// traffic — actual gameplay still goes directly peer-to-peer over
// WebRTC once this handshake completes (see common/multiplayer.js).
//
// Run with `npm run signal`. Both headsets' browsers need to be on
// the same local network as whatever machine this is running on —
// it does not (and cannot) work over the open internet.

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

// code -> { hostWs, hostOffer, joinerWs }
var rooms = new Map();

var wss = new WebSocketServer({ port: PORT });

wss.on('connection', function (ws) {
  var roomCode = null;
  var role = null;

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
      rooms.set(roomCode, { hostWs: ws, hostOffer: null, joinerWs: null });
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
      joinRoom.joinerWs = ws;
      if (joinRoom.hostOffer) ws.send(JSON.stringify({ type: 'offer', sdp: joinRoom.hostOffer }));
      return;
    }

    if (message.type === 'offer' && role === 'host') {
      var hostRoom = rooms.get(roomCode);
      if (!hostRoom) return;
      hostRoom.hostOffer = message.sdp;
      if (hostRoom.joinerWs) hostRoom.joinerWs.send(JSON.stringify({ type: 'offer', sdp: message.sdp }));
      return;
    }

    if (message.type === 'answer' && role === 'joiner') {
      var answerRoom = rooms.get(roomCode);
      if (!answerRoom || !answerRoom.hostWs) return;
      answerRoom.hostWs.send(JSON.stringify({ type: 'answer', sdp: message.sdp }));
      return;
    }
  });

  ws.on('close', function () {
    if (role === 'host' && roomCode) rooms.delete(roomCode);
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
