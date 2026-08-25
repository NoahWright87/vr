// The hosted signaling relay's wss:// address, baked in at build
// time by vite.config.js (see build-relay-url.js for how it's
// computed) via Vite's `define`. The typeof guard matters because
// tests run under plain `node --test`, which doesn't go through Vite
// at all, so __RELAY_URL__ is never declared there — typeof is safe
// on an undeclared identifier, unlike referencing it directly.
import { PRODUCTION_RELAY_URL } from '../build-relay-url.js';

export var RELAY_URL = typeof __RELAY_URL__ !== 'undefined' ? __RELAY_URL__ : PRODUCTION_RELAY_URL;
