// The same canvas checker used by the room-scale prototypes. Keeping the
// repeat in metres means resizing a room never stretches its floor squares.
AFRAME.registerComponent('checker-floor', {
  schema: {
    colorA: { default: '#263550' },
    colorB: { default: '#1c2940' },
    squareSize: { default: 0.5 },
  },
  init: function () {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    this.context = canvas.getContext('2d');
    this.texture = new AFRAME.THREE.CanvasTexture(canvas);
    this.texture.wrapS = this.texture.wrapT = AFRAME.THREE.RepeatWrapping;
    this.apply = this.apply.bind(this);
    this.onGeometryChange = function (evt) {
      if (evt.detail.name === 'geometry' || evt.detail.name === 'material') this.apply();
    }.bind(this);
    this.el.addEventListener('object3dset', this.apply);
    this.el.addEventListener('componentchanged', this.onGeometryChange);
  },
  update: function () {
    this.context.fillStyle = this.data.colorA;
    this.context.fillRect(0, 0, 64, 64);
    this.context.fillStyle = this.data.colorB;
    this.context.fillRect(0, 0, 32, 32);
    this.context.fillRect(32, 32, 32, 32);
    this.texture.needsUpdate = true;
    this.apply();
  },
  apply: function () {
    var mesh = this.el.getObject3D('mesh');
    var geometry = this.el.getAttribute('geometry');
    if (!mesh || !geometry) return;
    var tileSize = 2 * Math.max(0.01, this.data.squareSize);
    this.texture.repeat.set(geometry.width / tileSize, geometry.height / tileSize);
    mesh.material.map = this.texture;
    mesh.material.needsUpdate = true;
  },
  remove: function () {
    this.el.removeEventListener('object3dset', this.apply);
    this.el.removeEventListener('componentchanged', this.onGeometryChange);
    this.texture.dispose();
  },
});
