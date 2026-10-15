// ============================================================
// PLAYER HURT — what being hit feels like, without moving the camera.
//
// A red flash around the edge of view, a haptic pulse in both hands, a
// sound, and a health counter. Never a camera shake or a push: a view
// that moves on its own is the fastest way to make someone ill.
//
// The flash is a quad drawn in clip space — its vertex shader ignores
// every camera — so it covers the edge of each eye identically in a
// headset, where WebXR renders two per-eye projections and a world
// quad can't match both (the same trick as Pistols at Dawn's vices
// vignette, games/pistols-at-dawn/js/items-vices.js).
//
//   var hurt = sceneEl.systems['player-hurt'];
//   hurt.hurt(1, worldPoint);   // damage, where it came from (for sound)
//   hurt.health, hurt.hits
// ============================================================

import { haptic, sound } from './action-feedback.js';
import { registerReadout, logAction } from './debug-hud.js';
import { defineTunables } from './tunables.js';

var tune = defineTunables('player', 'Player', [
  { key: 'health', label: 'Health', value: 10, min: 1, max: 100, step: 1 },
  { key: 'flash', label: 'Flash', value: 0.8, min: 0, max: 100, step: 10, unit: '%', scale: 100 },
], function (values, key) {
  var scene = document.querySelector('a-scene');
  var sys = scene && scene.systems['player-hurt'];
  if (sys && (key === 'health' || key === null)) sys.reset();
});

var self = null;
registerReadout('player', 'Player', function () {
  return self ? 'health ' + self.health + '/' + tune.values.health + '  hits taken ' + self.hits : '';
});

var VERTEX = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = position.xy;',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}',
].join('\n');

var FRAGMENT = [
  'uniform float strength;',
  'varying vec2 vUv;',
  'void main() {',
  '  float d = length(vUv * vec2(1.0, 0.9));',
  '  float edge = smoothstep(0.55, 1.25, d);',
  '  gl_FragColor = vec4(0.85, 0.05, 0.02, edge * strength);',
  '}',
].join('\n');

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['player-hurt']) {
  var THREE = AFRAME.THREE;
  AFRAME.registerSystem('player-hurt', {
    init: function () {
      self = this;
      this.health = tune.values.health;
      this.hits = 0;
      this.flash = 0;
      this.material = new THREE.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader: FRAGMENT,
        uniforms: { strength: { value: 0 } },
        transparent: true, depthTest: false, depthWrite: false,
      });
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
      this.quad.frustumCulled = false;
      this.quad.renderOrder = 10001;
      this.quad.visible = false;
      this.quad.name = 'player-hurt-flash';
      this.el.object3D.add(this.quad);
    },

    reset: function () {
      this.health = tune.values.health;
      this.hits = 0;
    },

    hurt: function (damage, from) {
      this.hits++;
      this.health = Math.max(0, this.health - (damage || 1));
      this.flash = 1;
      // Both real hands: whichever the page's motion-sense reads.
      var rig = this.el.querySelector('[motion-sense]');
      var sense = rig && rig.components['motion-sense'];
      if (sense) [sense.data.leftHand, sense.data.rightHand].forEach(function (el) { haptic(el, 'hurt'); });
      sound('thump', from);
      logAction('YOU were hit (' + this.health + ' left)');
      // No death yet: at zero you get your health back, so a test can
      // keep going.
      if (this.health <= 0) {
        logAction('YOU went down — health restored');
        this.health = tune.values.health;
      }
    },

    tick: function (time, dt) {
      if (this.flash <= 0) { this.quad.visible = false; return; }
      this.flash = Math.max(0, this.flash - (dt || 16) / 450);
      this.quad.visible = true;
      this.material.uniforms.strength.value = this.flash * tune.values.flash;
    },
  });
}
