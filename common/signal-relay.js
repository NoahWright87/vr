// Thin client for the signaling relay (worker/src/signal-hub.js) —
// moves offer/answer text automatically over a plain WebSocket
// instead of a human copy/pasting it. This never touches game
// traffic; it only exists to complete the handshake that
// common/multiplayer.js's connection helpers already do the real
// WebRTC work for.

// One host session, any number of joiners: the relay assigns each
// joiner a peerId and tells the host about it (message.peerId below);
// the host creates a fresh RTCPeerConnection for THAT joiner via
// session.createOfferForJoiner and sends its offer back tagged with
// the same peerId, so the relay knows which joiner to forward it to.
export function hostSessionViaRelay (relayUrl, session, callbacks) {
  callbacks = callbacks || {};
  var ws = new WebSocket(relayUrl);

  ws.addEventListener('open', function () {
    ws.send(JSON.stringify({ type: 'host' }));
  });

  ws.addEventListener('message', async function (evt) {
    var message = JSON.parse(evt.data);
    if (message.type === 'hosting') {
      if (callbacks.onRoomCode) callbacks.onRoomCode(message.code);
    } else if (message.type === 'joiner-joined') {
      var offer = await session.createOfferForJoiner(message.peerId);
      ws.send(JSON.stringify({ type: 'offer', peerId: message.peerId, sdp: offer }));
    } else if (message.type === 'answer') {
      await session.acceptAnswerFromJoiner(message.peerId, message.sdp);
    }
  });

  ws.addEventListener('error', function () {
    if (callbacks.onError) callbacks.onError('Could not reach the signaling relay.');
  });

  return ws;
}

export function joinViaRelay (relayUrl, code, connection, callbacks) {
  callbacks = callbacks || {};
  var ws = new WebSocket(relayUrl);

  ws.addEventListener('open', function () {
    ws.send(JSON.stringify({ type: 'join', code: code }));
  });

  ws.addEventListener('message', async function (evt) {
    var message = JSON.parse(evt.data);
    if (message.type === 'offer') {
      var answer = await connection.acceptOffer(message.sdp);
      ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
      if (callbacks.onHandshakeComplete) callbacks.onHandshakeComplete();
    } else if (message.type === 'error') {
      if (callbacks.onError) callbacks.onError(message.message);
    }
  });

  ws.addEventListener('error', function () {
    if (callbacks.onError) callbacks.onError('Could not reach the signaling relay.');
  });

  return ws;
}
