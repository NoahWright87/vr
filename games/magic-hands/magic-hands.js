import { SpellGestures } from '../../common/hand-gestures.js';
import { HandInput } from './hand-input.js';
import { SpellEffects } from './spells.js';
import { SandboxView } from './sandbox-view.js';
const THREE = AFRAME.THREE;

AFRAME.registerComponent('magic-hands', {
  init() {
    this.camera = document.querySelector('#magic-camera');
    this.input = new HandInput(this.el.sceneEl, this.camera);
    this.effects = new SpellEffects(this.el.sceneEl, this.input.root);
    this.sandbox = new SandboxView(this.el.sceneEl);
    this.gestures = new SpellGestures(); this.score = 0; this.shots = 0; this.hits = 0; this.lastHud = -Infinity;
    this.head = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), forward: new THREE.Vector3(), up: new THREE.Vector3() };
    this.status = document.querySelector('#status'); this.hud = document.querySelector('#magic-hud');
    this.reset = () => {
      this.score = this.shots = this.hits = 0; this.gestures.reset(); this.effects.clear(); this.sandbox.engine.reset(); this.lastHud = -Infinity;
      this.onUp(); this.input.resetActions();
      this.el.sceneEl.querySelectorAll('[magic-receiver]').forEach(el => el.components['magic-receiver']?.reset());
    };
    this.onScore = e => { this.score += e.detail.points; this.hits++; };
    this.onCast = () => { this.shots++; };
    this.onMode = e => this.setMode(e.target.closest('[data-spell]')?.dataset.spell);
    this.onKey = e => {
      if (this.el.sceneEl.renderer.xr.isPresenting || /INPUT|BUTTON|SELECT/.test(e.target.tagName)) return;
      if (e.code === 'Digit1') this.setMode('lightning');
      if (e.code === 'Digit2') this.setMode('farsight');
      if (e.code === 'Digit3') this.setMode('shield');
      if (e.code === 'Digit4') this.setMode('boulder');
      if (e.code === 'Digit5') this.setMode('fireball');
      if (e.code === 'Digit6') this.setMode('telekinesis');
      if (e.code === 'KeyG') this.input.pull = true;
      if (e.code === 'KeyT' && !e.repeat) this.input.pushAt = this.el.sceneEl.time;
      if (e.code === 'Space' || e.code === 'KeyQ') { e.preventDefault(); this.input.hammerDown[e.code === 'KeyQ' ? 'left' : 'right'] = true; }
      if (e.code === 'KeyR' && !e.repeat) this.reset();
      if (e.code === 'KeyH' && !e.repeat) this.input.shieldHands = this.input.shieldHands === 1 ? 2 : 1;
    };
    this.onRelease = e => { if (e.code === 'Space' || e.code === 'KeyQ') this.input.hammerDown[e.code === 'KeyQ' ? 'left' : 'right'] = false; };
    this.onDown = e => { if (!this.el.sceneEl.renderer.xr.isPresenting && e.button === 0 && e.target === this.el.sceneEl.canvas) this.input.hammerDown.right = true; };
    this.onUp = () => { this.input.hammerDown.left = this.input.hammerDown.right = false; };
    this.onWheel = e => {
      if (this.el.sceneEl.renderer.xr.isPresenting || this.input.mode !== 'farsight') return;
      e.preventDefault(); this.input.faceDistance = Math.max(.12, Math.min(.65, this.input.faceDistance + Math.sign(e.deltaY) * .025));
      document.querySelector('#face-distance').value = this.input.faceDistance;
    };
    this.onDistance = e => { this.input.faceDistance = Number(e.target.value); };
    this.onReach = e => { this.input.shieldDistance = Number(e.target.value); };
    this.onLifecycle = () => { this.onUp(); this.gestures.reset(); this.effects.clear(); this.sandbox.engine.suspend(); this.input.resetActions(); this.input.aimHistory = {}; };
    this.onVisibility = () => { if (document.hidden) this.onLifecycle(); };
    this.listeners = [
      [this.el.sceneEl, 'magic-scored', this.onScore], [this.el.sceneEl, 'magic-cast', this.onCast],
      [this.el.sceneEl, 'enter-vr', this.onLifecycle], [this.el.sceneEl, 'exit-vr', this.onLifecycle],
      [document.querySelector('#spell-controls'), 'click', this.onMode], [document.querySelector('#reset'), 'click', this.reset],
      [document.querySelector('#face-distance'), 'input', this.onDistance], [document.querySelector('#shield-distance'), 'input', this.onReach],
      [window, 'keydown', this.onKey], [window, 'keyup', this.onRelease], [window, 'pointerdown', this.onDown],
      [window, 'pointerup', this.onUp], [window, 'pointercancel', this.onUp], [window, 'blur', this.onLifecycle],
      [window, 'wheel', this.onWheel], [document, 'visibilitychange', this.onVisibility],
    ];
    this.listeners.forEach(([el, event, fn]) => el.addEventListener(event, fn, event === 'wheel' ? { passive: false } : undefined));
  },
  setMode(mode) {
    if (!['lightning', 'farsight', 'shield', 'boulder', 'fireball', 'telekinesis'].includes(mode) || this.el.sceneEl.renderer.xr.isPresenting) return;
    this.input.mode = mode; this.onLifecycle();
    document.querySelectorAll('[data-spell]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.spell === mode)));
    document.querySelector('#farsight-controls').hidden = mode !== 'farsight';
    document.querySelector('#shield-controls').hidden = mode !== 'shield';
  },
  tick(time, dt) {
    if (!this.el.sceneEl.renderer || !this.camera?.object3D) return;
    const head = this.head;
    this.camera.object3D.getWorldPosition(head.position); this.camera.object3D.getWorldQuaternion(head.quaternion);
    head.forward.set(0, 0, -1).applyQuaternion(head.quaternion); head.up.set(0, 1, 0).applyQuaternion(head.quaternion);
    const hands = this.input.sample(head, time);
    const actions = this.sandbox.update(hands, head, time);
    const result = this.gestures.update(hands, head, time, actions.reserved);
    for (const side of ['left', 'right']) if (actions.reserved[side]) result[side] = actions.hands[side].mode;
    this.effects.update(result, hands, head, time, dt);
    if (time - this.lastHud < 120) return; this.lastHud = time;
    const xr = !!this.el.sceneEl.renderer.xr.getSession();
    const label = side => hands[side] ? (result[side] || 'idle') : 'untracked';
    const spell = result.lens ? `Farsight ${this.effects.lastZoom.toFixed(1)}x` : `L: ${label('left')}  |  R: ${label('right')}`;
    const text = `${spell}  |  ${this.score} points  |  ${this.hits} hits / ${this.shots} casts`;
    this.status.textContent = `${xr ? 'Hand tracking' : 'Desktop rehearsal'} · ${text}`;
    this.hud.setAttribute('value', text);
    document.querySelector('#desktop-rehearsal').hidden = xr;
  },
  remove() { this.listeners.forEach(([el, event, fn]) => el.removeEventListener(event, fn)); this.input.dispose(); this.effects.dispose(); this.sandbox.dispose(); },
});
