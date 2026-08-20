// Thin client for the local signaling relay (server/signal-server.js)
// — moves the offer/answer text automatically over a plain
// WebSocket instead of a human copy/pasting it. This never touches
// game traffic; it only exists to complete the handshake that
// common/multiplayer.js's createHostConnection/createJoinConnection
// already do the real WebRTC work for.

export function hostViaRelay (relayUrl, connection, callbacks) {
  callbacks = callbacks || {};
  var ws = new WebSocket(relayUrl);

  ws.addEventListener('open', function () {
    ws.send(JSON.stringify({ type: 'host' }));
  });

  ws.addEventListener('message', async function (evt) {
    var message = JSON.parse(evt.data);
    if (message.type === 'hosting') {
      if (callbacks.onRoomCode) callbacks.onRoomCode(message.code);
      var offer = await connection.createOffer();
      ws.send(JSON.stringify({ type: 'offer', sdp: offer }));
    } else if (message.type === 'answer') {
      await connection.acceptAnswer(message.sdp);
      if (callbacks.onHandshakeComplete) callbacks.onHandshakeComplete();
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
