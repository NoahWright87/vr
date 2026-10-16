// Texture repeats in metres, so resizing a floor preserves square size.
AFRAME.registerComponent('checker-floor', {
  schema: {
    colorA: { default: '#263550' },
    colorB: { default: '#1c2940' },
    squareSize: { default: 0.5 },
  },
  init() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    this.context = canvas.getContext('2d');
    this.texture = new AFRAME.THREE.CanvasTexture(canvas);
    this.texture.wrapS = this.texture.wrapT = AFRAME.THREE.RepeatWrapping;
    this.apply = this.apply.bind(this);
    this.onGeometryChange = event => { if (['geometry','material'].includes(event.detail.name)) this.apply(); };
    this.el.addEventListener('object3dset', this.apply);
    this.el.addEventListener('componentchanged', this.onGeometryChange);
  },
  update() {
    this.context.fillStyle = this.data.colorA; this.context.fillRect(0,0,64,64);
    this.context.fillStyle = this.data.colorB; this.context.fillRect(0,0,32,32); this.context.fillRect(32,32,32,32);
    this.texture.needsUpdate = true; this.apply();
  },
  apply() {
    const mesh = this.el.getObject3D('mesh'), geometry = this.el.getAttribute('geometry');
    if (!mesh || !geometry) return;
    const tileSize = 2*Math.max(0.01,this.data.squareSize);
    this.texture.repeat.set(geometry.width/tileSize,geometry.height/tileSize);
    mesh.material.map = this.texture; mesh.material.needsUpdate = true;
  },
  remove() {
    this.el.removeEventListener('object3dset',this.apply); this.el.removeEventListener('componentchanged',this.onGeometryChange); this.texture.dispose();
  },
});
