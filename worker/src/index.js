// Cloudflare Worker entry point for the hosted signaling relay — see
// worker/src/signal-hub.js for the actual room logic and README.md
// for how to deploy this. Every connection, whether hosting or
// joining, is routed to the same single SignalHub Durable Object
// instance (see signal-hub.js for why one instance is plenty for a
// relay this small).

export { SignalHub } from './signal-hub.js';

export default {
  async fetch (request, env) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('This is the vr signaling relay. Connect with a WebSocket client.', { status: 426 });
    }
    var id = env.SIGNAL_HUB.idFromName('hub');
    var stub = env.SIGNAL_HUB.get(id);
    return stub.fetch(request);
  },
};
