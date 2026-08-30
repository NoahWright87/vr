// Pure computation of the hosted relay's wss:// address at build
// time, kept separate from vite.config.js so it's testable under
// plain `node --test` without invoking Vite. See
// common/relay-config.js for how the browser bundle consumes this,
// and README.md's "Hardcoding the relay address" section for the
// full picture.
//
// Netlify sets CONTEXT and REVIEW_ID automatically on every build —
// no secrets, nothing configured in this repo — and REVIEW_ID lines
// up exactly with preview-signal-hub.yml's vr-signal-relay-pr-<number>
// naming, so a PR's Netlify preview build automatically points at
// that same PR's Worker preview.

export var PRODUCTION_RELAY_URL = 'wss://vr-signal-relay.noahwright87.workers.dev';

export function computeRelayUrl (env) {
  env = env || {};
  if (env.VITE_RELAY_URL) return env.VITE_RELAY_URL;
  if (env.CONTEXT === 'deploy-preview' && env.REVIEW_ID) {
    return 'wss://vr-signal-relay-pr-' + env.REVIEW_ID + '.noahwright87.workers.dev';
  }
  return PRODUCTION_RELAY_URL;
}
