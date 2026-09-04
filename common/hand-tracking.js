import './interaction-hints.js';

// Bridges A-Frame's built-in `hand-tracking-controls` (real WebXR Hand
// Input tracking) onto the showcase's existing semantic-hand/hint-zone
// system, so a bare-hand pinch plays the same role gripping and pulling
// the trigger on a real Touch controller does: reach near something and
// pinch to grab or hold it, or point at a menu row and pinch to click it.
//
// hand-tracking-controls deliberately does NOT move the entity it's
// attached to the way oculus-touch-controls etc do (which drive
// `el.object3D` straight off the tracked controller pose) -- it holds its
// host entity at identity and tracks the wrist separately, in its own
// world-space `wristObject3D`, so a purely decorative hand mesh can sit
// anywhere without being repositioned by data it never asked for. That
// means it has to live on its own dedicated entity rather than directly on
// #left-hand/#right-hand, which need their OWN transform to BE the wrist
// -- all of hint-zone reach, the watch, and the fingertip raycaster are
// built on `semantic-hand`'s own position. This component reads that
// dedicated entity's tracked wrist pose each frame and feeds it into
// `semantic-hand.setWorldTransform`, the exact same method desktop's
// simulated hand already uses to place itself in world space.
AFRAME.registerComponent('hand-tracking-follow', {
  schema: {
    source: { type: 'selector' },
  },

  init: function () {
    var THREE = AFRAME.THREE;
    this.worldPosition = new THREE.Vector3();
    this.worldQuaternion = new THREE.Quaternion();
    this.present = false;
    this.pinching = false;

    this.onConnected = this.onConnected.bind(this);
    this.onDisconnected = this.onDisconnected.bind(this);
    this.onPinchStarted = this.onPinchStarted.bind(this);
    this.onPinchEnded = this.onPinchEnded.bind(this);

    this.data.source.addEventListener('controllerconnected', this.onConnected);
    this.data.source.addEventListener('controllerdisconnected', this.onDisconnected);
    this.data.source.addEventListener('pinchstarted', this.onPinchStarted);
    this.data.source.addEventListener('pinchended', this.onPinchEnded);
  },

  onConnected: function () {
    this.present = true;
  },

  onDisconnected: function () {
    this.present = false;
    if (this.pinching) this.endPinch();
  },

  // A real Touch controller has two independent buttons -- grip (arms
  // this hand for grabbing/pointing) and trigger (clicks whatever it's
  // currently pointing at) -- a user can hold and pull independently.
  // Pinch is the only gesture bare hand tracking has, so it stands in for
  // both at once: gripdown/up is what actually grabs or drops a nearby
  // simple-grabbable (interaction-hints.js), and triggerdown/up is what
  // the watch/menu fingertip cursor listens for to register a click.
  onPinchStarted: function () {
    if (!this.present || this.pinching) return;
    this.pinching = true;

    // The fingertip raycaster is normally only switched on by gripdown
    // (with a short settle delay, for a smoother-looking laser), so
    // firing triggerdown in the same instant would otherwise see no
    // cached intersection to click -- the ray's had zero chance to have
    // hit anything yet. A-Frame's own cursor component sidesteps the
    // identical problem for mouse-touchstart and xrselect by forcing one
    // fresh raycast right before it looks at what's hovered; do the same
    // here rather than waiting on the settle delay.
    var watch = this.el.components['hand-with-watch'];
    if (watch && watch.fingertipEl && watch.fingertipEl.components.raycaster) {
      watch.fingertipEl.setAttribute('raycaster', 'enabled', true);
      watch.fingertipEl.components.raycaster.checkIntersections();
    }
    this.el.emit('gripdown', null, false);
    this.el.emit('triggerdown', null, false);
  },

  onPinchEnded: function () {
    if (!this.pinching) return;
    this.endPinch();
  },

  endPinch: function () {
    this.pinching = false;
    this.el.emit('triggerup', null, false);
    this.el.emit('gripup', null, false);
  },

  tick: function () {
    if (!this.present) return;
    var source = this.data.source.components['hand-tracking-controls'];
    var hand = this.el.components['semantic-hand'];
    if (!source || !source.hasPoses || !hand) return;
    source.wristObject3D.getWorldPosition(this.worldPosition);
    source.wristObject3D.getWorldQuaternion(this.worldQuaternion);
    hand.setWorldTransform(this.worldPosition, this.worldQuaternion, null, true);
  },

  remove: function () {
    this.data.source.removeEventListener('controllerconnected', this.onConnected);
    this.data.source.removeEventListener('controllerdisconnected', this.onDisconnected);
    this.data.source.removeEventListener('pinchstarted', this.onPinchStarted);
    this.data.source.removeEventListener('pinchended', this.onPinchEnded);
  },
});
