// Peer-to-peer connection between two browsers on the same local
// network, with no signaling server involved: the offer/answer SDP is
// exchanged out of band (copy/paste today, maybe a QR code later) as
// an opaque base64 string the caller is responsible for moving from
// one peer to the other. No STUN/TURN server either — only host ICE
// candidates are gathered, which is all two peers on the same LAN
// need to find each other.

var ICE_SERVERS = [];

// Waiting for the full 'complete' state can hang indefinitely on some
// networks/interfaces (observed in sandboxed environments, but not
// only there) — a couple of seconds is enough to gather host
// candidates on a LAN, so proceed with whatever's been found rather
// than blocking the whole handshake on a state that may never come.
var ICE_GATHERING_TIMEOUT_MS = 2000;

function waitForIceGatheringComplete (pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(function (resolve) {
    var timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
    function finish () {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }
    function onChange () {
      if (pc.iceGatheringState === 'complete') finish();
    }
    pc.addEventListener('icegatheringstatechange', onChange);
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

// A star-topology host: a separate RTCPeerConnection per joiner, so
// more than one person can connect at once. Joiners never connect to
// each other — only ever to this session — so anything a joiner
// needs to know about another joiner has to be relayed through here
// (see the peer-aim handling in primitives/menus/index.html for the
// actual relay). createHostConnection above stays as it was and
// keeps being used by the manual copy/paste fallback, which only
// ever supports one joiner and isn't worth the same treatment.
export function createHostSession (callbacks) {
  callbacks = callbacks || {};
  var peers = new Map(); // peerId -> { pc, channel }

  function wirePeerChannel (peerId, pc, channel) {
    var closed = false;
    function fireClose () {
      if (closed) return;
      closed = true;
      peers.delete(peerId);
      if (callbacks.onPeerClose) callbacks.onPeerClose(peerId);
    }
    channel.addEventListener('open', function () { if (callbacks.onPeerOpen) callbacks.onPeerOpen(peerId); });
    channel.addEventListener('message', function (evt) { if (callbacks.onPeerMessage) callbacks.onPeerMessage(peerId, evt.data); });
    channel.addEventListener('close', fireClose);
    pc.addEventListener('connectionstatechange', function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fireClose();
    });
  }

  return {
    createOfferForJoiner: async function (peerId) {
      var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      var channel = pc.createDataChannel('game');
      peers.set(peerId, { pc: pc, channel: channel });
      wirePeerChannel(peerId, pc, channel);
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      return encodeDescription(pc.localDescription);
    },
    acceptAnswerFromJoiner: async function (peerId, answerText) {
      var peer = peers.get(peerId);
      if (!peer) return;
      await peer.pc.setRemoteDescription(decodeDescription(answerText));
    },
    send: function (peerId, message) {
      var peer = peers.get(peerId);
      if (peer && peer.channel.readyState === 'open') peer.channel.send(message);
    },
    // exceptPeerId lets the host re-broadcast one peer's own update
    // to everyone else without echoing it straight back to them.
    broadcast: function (message, exceptPeerId) {
      peers.forEach(function (peer, peerId) {
        if (peerId === exceptPeerId) return;
        if (peer.channel.readyState === 'open') peer.channel.send(message);
      });
    },
  };
}
