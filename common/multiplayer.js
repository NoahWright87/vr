// Peer-to-peer connection between two browsers on the same local
// network, with no signaling server involved: the offer/answer SDP is
// exchanged out of band (copy/paste today, maybe a QR code later) as
// an opaque base64 string the caller is responsible for moving from
// one peer to the other. No STUN/TURN server either — only host ICE
// candidates are gathered, which is all two peers on the same LAN
// need to find each other.

var ICE_SERVERS = [];

function waitForIceGatheringComplete (pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(function (resolve) {
    pc.addEventListener('icegatheringstatechange', function onChange () {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    });
  });
}

export function encodeDescription (description) {
  return btoa(JSON.stringify(description));
}

export function decodeDescription (text) {
  return JSON.parse(atob(text.trim()));
}

function wireConnection (pc, channel, callbacks) {
  callbacks = callbacks || {};
  var closed = false;
  function fireClose () {
    if (closed) return;
    closed = true;
    if (callbacks.onClose) callbacks.onClose();
  }
  channel.addEventListener('open', function () { if (callbacks.onOpen) callbacks.onOpen(); });
  channel.addEventListener('message', function (evt) { if (callbacks.onMessage) callbacks.onMessage(evt.data); });
  channel.addEventListener('close', fireClose);
  pc.addEventListener('connectionstatechange', function () {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fireClose();
  });
}

// The side that starts the connection: opens the data channel and
// produces the initial offer for the other side to accept.
export function createHostConnection (callbacks) {
  var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  var channel = pc.createDataChannel('game');
  wireConnection(pc, channel, callbacks);

  return {
    pc: pc,
    send: function (message) {
      if (channel.readyState === 'open') channel.send(message);
    },
    createOffer: async function () {
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      return encodeDescription(pc.localDescription);
    },
    acceptAnswer: async function (answerText) {
      await pc.setRemoteDescription(decodeDescription(answerText));
    },
  };
}

// The side that responds to an offer: waits for the host's data
// channel to arrive and produces the answer to send back.
export function createJoinConnection (callbacks) {
  var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  var connection = {
    pc: pc,
    channel: null,
    send: function (message) {
      if (connection.channel && connection.channel.readyState === 'open') connection.channel.send(message);
    },
    acceptOffer: async function (offerText) {
      await pc.setRemoteDescription(decodeDescription(offerText));
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);
      return encodeDescription(pc.localDescription);
    },
  };

  pc.addEventListener('datachannel', function (evt) {
    connection.channel = evt.channel;
    wireConnection(pc, connection.channel, callbacks);
  });

  return connection;
}
