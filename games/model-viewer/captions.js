// Canvas captions keep the small inspection labels crisp without the distance
// field atlas artifacts visible in this scene's fine text. Keep A-Frame's text
// data contract so the shared wrist-menu components can still update labels.
AFRAME.registerComponent('viewer-caption', {
  dependencies: ['text'],
  init() {
    const THREE = AFRAME.THREE;
    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.el.setObject3D('caption', this.mesh);
    this.onChange = event => { if (!event.detail?.name || event.detail.name === 'text') this.render(); };
    this.el.addEventListener('componentchanged', this.onChange);
    this.el.addEventListener('textfontset', this.onChange);
    this.render();
  },
  render() {
    const data = this.el.components.text.data;
    const original = this.el.getObject3D('text');
    if (original) original.visible = false;
    this.mesh.material.opacity = data.opacity;
    const signature = JSON.stringify([data.value,data.width,data.wrapCount,data.color,data.align,data.anchor,data.baseline]);
    if (signature === this.signature) return;
    this.signature = signature;
    const context = this.canvas.getContext('2d');
    const fontSize = 64;
    const font = `${fontSize}px system-ui, sans-serif`;
    context.font = font;
    const lines = [];
    const maxWidth = (data.wrapCount+0.5)*fontSize*0.55;
    for (const paragraph of String(data.value).replace(/\\n/g, '\n').split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
        else line = candidate;
      }
      lines.push(line);
    }
    const width = Math.max(1, ...lines.map(line => context.measureText(line).width));
    const lineHeight = fontSize*1.4;
    this.canvas.width = Math.ceil(width + 16); this.canvas.height = Math.ceil(lines.length*lineHeight);
    context.font = font; context.fillStyle = data.color; context.textBaseline = 'middle';
    context.textAlign = data.align === 'right' ? 'right' : data.align === 'center' ? 'center' : 'left';
    const x = data.align === 'right' ? this.canvas.width-8 : data.align === 'center' ? this.canvas.width/2 : 8;
    lines.forEach((line, i) => context.fillText(line, x, (i+0.5)*lineHeight));
    // Match the shared menu's width/wrapCount convention, using the average
    // glyph advance of the original Roboto font (about 0.55 em).
    const scale = (data.width || 1)/((data.wrapCount+0.5)*fontSize*0.55);
    this.mesh.scale.set(this.canvas.width*scale, this.canvas.height*scale, 1);
    const anchor = data.anchor === 'align' ? data.align : data.anchor;
    this.mesh.position.x = (anchor === 'left' ? 0.5 : anchor === 'right' ? -0.5 : 0)*this.canvas.width*scale;
    this.mesh.position.y = (data.baseline === 'bottom' ? 0.5 : data.baseline === 'top' ? -0.5 : 0)*this.canvas.height*scale;
    this.mesh.position.z = 0.002;
    this.mesh.material.opacity = data.opacity;
    // WebGL textures cannot be resized after their first upload. A changed
    // caption often changes canvas dimensions, so replace the texture rather
    // than squeezing stale pixels into the new label geometry.
    this.texture.dispose();
    this.texture = new AFRAME.THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = AFRAME.THREE.SRGBColorSpace;
    this.texture.minFilter = AFRAME.THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.mesh.material.map = this.texture;
  },
  tick() {
    const data = this.el.components.text.data;
    this.mesh.material.opacity = data.opacity;
    const signature = JSON.stringify([data.value,data.width,data.wrapCount,data.color,data.align,data.anchor,data.baseline]);
    if (signature !== this.signature) this.render();
    const original = this.el.getObject3D('text'); if (original) original.visible = false;
  },
  remove() {
    this.el.removeEventListener('componentchanged', this.onChange);
    this.el.removeEventListener('textfontset', this.onChange);
    this.el.removeObject3D('caption'); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.texture.dispose();
    const original = this.el.getObject3D('text'); if (original) original.visible = true;
  },
});

export function refreshCaptions() {
  document.querySelectorAll('a-scene a-text, a-scene [text]').forEach(el => {
    if (!el.hasAttribute('viewer-caption')) el.setAttribute('viewer-caption', '');
  });
}
