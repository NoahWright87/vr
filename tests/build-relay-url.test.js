import assert from 'node:assert/strict';
import test from 'node:test';

import { computeRelayUrl, PRODUCTION_RELAY_URL } from '../build-relay-url.js';

test('defaults to the production relay when no build context is set', () => {
  assert.equal(computeRelayUrl({}), PRODUCTION_RELAY_URL);
});

test('a Netlify deploy-preview build points at its matching PR preview Worker', () => {
  assert.equal(
    computeRelayUrl({ CONTEXT: 'deploy-preview', REVIEW_ID: '42' }),
    'wss://vr-signal-relay-pr-42.noahwright87.workers.dev',
  );
});

test('a branch-deploy build (no REVIEW_ID) falls back to production', () => {
  assert.equal(computeRelayUrl({ CONTEXT: 'branch-deploy' }), PRODUCTION_RELAY_URL);
});

test('an explicit VITE_RELAY_URL overrides everything else', () => {
  assert.equal(
    computeRelayUrl({ VITE_RELAY_URL: 'ws://localhost:8787', CONTEXT: 'deploy-preview', REVIEW_ID: '7' }),
    'ws://localhost:8787',
  );
});
