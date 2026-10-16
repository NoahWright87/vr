import '../../common/watch-menu.js';
import '../../common/locomotion.js';
import '../../common/desktop-controls.js';
import '../../common/checker-floor.js';
import '../../common/visor-menu.js';
import { registerMenuPage } from '../../common/menu-crossbar.js';
import { registerVisorPage } from '../../common/visor-page.js';
import { createToyboxCatalog, toyboxControlItems } from './toybox-menus.js';
import { assets, creators, packsFor, toysFor, loadToy, measureToy, disposeModel } from './toy-assets.js';
import { resolveToyContacts } from './toy-contacts.js';
import { refreshCaptions } from './captions.js';

const THREE = AFRAME.THREE;
const LIMIT = 32, PAGE_SIZE = 8;
const dimensions = size => [size.x,size.y,size.z].map(n => n.toFixed(2)).join(' x ')+' m';
const toybox = () => document.querySelector('a-scene')?.components.toybox;
const state = () => ({ gravity: toybox()?.gravity ?? true, spawnSize: toybox()?.spawnSize || 'toy', count: toybox()?.toys.length || 0 });
registerMenuPage('toybox-catalog', createToyboxCatalog(assets, creators, asset => {
  const current = toybox(), selected = current?.selected?.id === asset.id;
  return [asset.name, `${asset.creator} · ${asset.license}`, asset.packName,
    ...(selected && current.selectedSize ? ['Authored: '+dimensions(current.selectedSize)] : []),
    selected && current.previewMessage ? current.previewMessage : 'Confirm to take out a copy.'];
}));
const controlPage = { title: 'TOYBOX', items: () => toyboxControlItems(state), info: () => `${state().count} / 32 toys out.\nGrip to arrange; release to toss.` };
registerMenuPage('toybox-watch', controlPage);
registerVisorPage('visor', controlPage);

AFRAME.registerComponent('toybox', {
  init() {
    this.toys = []; this.pending = 0; this.generation = 0; this.previewToken = 0; this.nextToyId = 0;
    this.gravity = true; this.spawnSize = 'toy'; this.creator = 'kenney'; this.pack = ''; this.query = ''; this.page = 0;
    this.selected = null; this.preview = null;
    this.abort = new AbortController(); const options = { signal: this.abort.signal };
    this.onSelect = event => {
      if (event.detail.id?.startsWith('toy-')) this.action(event.detail.id.slice(4));
    };
    this.onCommit = event => {
      if (event.detail.id === 'toy-gravity' && this.gravity !== event.detail.value) this.action('gravity');
      if (event.detail.id === 'toy-size') { this.spawnSize = event.detail.value; this.sync(); }
    };
    this.onWatchReady = () => { this.sync(); refreshCaptions(); };
    this.onEnter = () => { if (this.el.renderer.xr.isPresenting) document.body.classList.add('in-xr'); };
    this.onExit = () => {
      document.body.classList.remove('in-xr');
      if (this.menu) { this.menu.data.laserScale = 1.2; this.menu.data.offset = { x: 0, y: 1.2, z: 0 }; this.menu.data.closeDistance = 8; }
    };
    this.onLoaded = () => this.setupMenu();
    this.el.addEventListener('menu-action', this.onSelect);
    this.el.addEventListener('menu-commit', this.onCommit);
    this.el.addEventListener('watch-menu-ready', this.onWatchReady);
    this.el.addEventListener('visor-menu-opened', this.onWatchReady);
    this.el.addEventListener('loaded', this.onLoaded, { once: true });
    this.el.addEventListener('enter-vr', this.onEnter); this.el.addEventListener('exit-vr', this.onExit);
    document.querySelector('#open-toybox').addEventListener('click', () => this.open(), options);
    document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => this.action(button.dataset.action), options));
    document.querySelectorAll('.desktop-ui').forEach(el => {
      for (const event of ['mousedown','mouseup','click','touchstart','touchend','keydown','keyup']) el.addEventListener(event, e => e.stopPropagation(), options);
    });
    const creator = document.querySelector('#creator');
    for (const source of creators) creator.add(new Option(source.name, source.id));
    creator.addEventListener('change', () => { this.creator = creator.value; this.pack = ''; this.page = 0; this.query = ''; this.render(); }, options);
    document.querySelector('#pack').addEventListener('change', event => { this.pack = event.target.value; this.page = 0; this.render(); }, options);
    document.querySelector('#search').addEventListener('input', event => { this.query = event.target.value; this.page = 0; this.render(); }, options);
    window.addEventListener('keydown', event => {
      if (event.repeat || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName)) return;
      if (event.code === 'KeyR') this.action('rotate');
      if (event.code === 'KeyT') this.toss();
    }, options);
    this.renderFlat();
  },
  setupMenu() {
    this.trigger = document.querySelector('#chest-trigger');
    this.trigger.setAttribute('projected-menu', {
      template: '#toybox-menu-template', mode: 'laser', laserScale: 1.2,
      offset: { x: 0, y: 1.2, z: 0 }, closeDistance: 8, lookAwayDelay: 8000,
    });
    this.menu = this.trigger.components['projected-menu']; this.panel = this.menu.panelEl;
    this.trigger.addEventListener('projected-crossbar-ready', event => {
      this.catalog = event.detail.menu;
      this.previewHost = this.catalog.sidecarContentEl.object3D;
      const logo = document.createElement('a-image'); logo.setAttribute('src','/assets/models/kenney/logo.png');
      logo.setAttribute('width','0.55'); logo.setAttribute('height','0.18');
      this.catalog.sidecarContentEl.appendChild(logo); this.brandEl = logo;
      this.catalog.menu.on('change', () => this.onCatalogChange());
      this.catalog.menu.on('open', () => this.focusPending());
      this.onCatalogChange(); refreshCaptions();
      const initial = assets.find(a => a.id === new URLSearchParams(location.search).get('model'));
      if (initial) this.pendingFocus = initial.id;
    }, { signal: this.abort.signal });
    this.trigger.setAttribute('projected-crossbar','');
    this.trigger.addEventListener('projected-menu-opened', () => {
      this.placeXrMenu(); this.focusPending(); this.sync(); refreshCaptions();
    }, { signal: this.abort.signal });
    // Poking the latch already opens the shared projected menu in XR.
    // Keep mounted-interaction's state in sync for semantic hints as well.
    this.trigger.addEventListener('projected-menu-closed', () => {
      const mounted = this.trigger.components['mounted-interaction'];
      mounted.active = false; this.trigger.removeAttribute('data-mounted-active');
    }, { signal: this.abort.signal });
    this.render(); refreshCaptions();
  },
  open() {
    if (!this.trigger) return;
    const desktop = document.querySelector('#viewer-rig').components['desktop-controls'];
    const mounted = this.trigger.components['mounted-interaction'];
    this.el.systems['visor-menu']?.close();
    document.querySelectorAll('[hand-with-watch]').forEach(el => el.components['hand-with-watch']?.crossbarMenu?.close());
    if (this.el.renderer.xr.isPresenting) mounted.open();
    else {
      if (desktop.mode !== 'normal') desktop.exitInteraction();
      desktop.beginMounted(mounted, desktop.getDominantHand());
    }
    this.render();
  },
  focusModel(id) {
    this.pendingFocus = id;
    if (!this.menu?.active) this.open();
    else this.focusPending();
  },
  focusPending() {
    const definition = assets.find(a => a.id === this.pendingFocus);
    if (!definition || !this.catalog?.menu.isOpen) return;
    this.pendingFocus = null;
    const menu = this.catalog.menu; menu.reset();
    menu.moveFocus(creators.findIndex(c => c.id === definition.creatorId)); menu.forward();
    menu.moveFocus(packsFor(definition.creatorId).findIndex(p => p.id === definition.pack)); menu.forward();
    menu.moveFocus(toysFor(definition.creatorId,definition.pack).findIndex(a => a.id === definition.id));
    this.onCatalogChange(); this.catalog.render();
  },
  onCatalogChange() {
    if (!this.catalog) return;
    const info = this.catalog.menu.getInfo(), id = info?.item?.modelId;
    if (this.preview) this.preview.visible = Boolean(id);
    if (this.brandEl) this.brandEl.object3D.visible = !id && info?.item?.creatorId === 'kenney';
    if (id && this.selected?.id !== id) this.select(id);
    refreshCaptions();
  },
  placeXrMenu() {
    if (!this.el.renderer.xr.isPresenting) return;
    // Place a large, world-fixed menu at reading distance without moving the
    // XR player. This also makes the watch's Open Toybox useful away from it.
    const camera = document.querySelector('#viewer-camera').object3D;
    const position = camera.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0,0,-1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    direction.y = 0; if (direction.lengthSq() < 0.001) direction.set(0,0,-1); direction.normalize();
    position.addScaledVector(direction,2.3);
    const parent = this.trigger.object3D.parent; parent.updateWorldMatrix(true,false); parent.worldToLocal(position);
    position.sub(this.trigger.object3D.position);
    this.menu.data.offset = { x: position.x, y: position.y, z: position.z };
    this.menu.data.laserScale = 0.9; this.menu.data.closeDistance = 30;
  },
  results() { return toysFor(this.creator, this.pack, this.query); },
  renderFlat() {
    document.querySelector('#creator').value = this.creator;
    const select = document.querySelector('#pack'); select.replaceChildren(new Option('All collections', ''));
    for (const pack of packsFor(this.creator)) select.add(new Option(pack.name, pack.id));
    select.value = this.pack; document.querySelector('#search').value = this.query;
    document.querySelector('.kenney-credit').hidden = this.creator !== 'kenney';
    const results = this.results(), pages = Math.max(1, Math.ceil(results.length/PAGE_SIZE));
    this.page = Math.min(this.page, pages-1);
    const list = document.querySelector('#flat-models'); list.replaceChildren();
    if (!results.length) list.textContent = 'No matching toys.';
    for (const model of results.slice(this.page*PAGE_SIZE, (this.page+1)*PAGE_SIZE)) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.model = model.id;
      button.textContent = model.name; button.setAttribute('aria-pressed', String(this.selected?.id === model.id));
      button.addEventListener('click', () => this.focusModel(model.id)); list.appendChild(button);
    }
    document.querySelectorAll('.page-label').forEach(el => el.textContent = `${this.page+1} / ${pages} · ${results.length} toys`);
  },
  render() { this.renderFlat(); this.catalog?.render(); refreshCaptions(); },
  async select(id) {
    const definition = assets.find(a => a.id === id); if (!definition) return;
    this.creator = definition.creatorId; this.pack = definition.pack; this.query = '';
    this.page = Math.floor(toysFor(this.creator,this.pack).findIndex(a => a.id === id)/PAGE_SIZE);
    this.selected = definition; this.selectedSize = null; const token = ++this.previewToken;
    if (this.preview) { this.previewHost.remove(this.preview); disposeModel(this.preview); this.preview = null; }
    this.previewMessage = 'Loading preview…'; this.render();
    const url = new URL(location.href); url.searchParams.set('model',id); history.replaceState(null,'',url);
    try {
      const model = await loadToy(definition);
      if (token !== this.previewToken) { disposeModel(model); return; }
      const { size, center } = measureToy(model); this.selectedSize = size;
      const preview = new THREE.Group(); model.position.sub(center); preview.add(model);
      preview.scale.setScalar(0.48/Math.max(size.x,size.y,size.z)); preview.rotation.y = Math.PI*1.15;
      this.previewHost.add(preview); this.preview = preview; this.previewMessage = '';
      preview.visible = this.catalog?.menu.getInfo()?.item?.modelId === id;
    } catch (error) {
      if (token === this.previewToken) this.previewMessage = 'Could not load. Select again to retry.';
      console.error('Toy preview failed', definition.id, error);
    }
    if (token === this.previewToken) this.sync();
  },
  sync() {
    const name = this.selected?.name || 'Pick a toy to preview';
    const credit = this.selected ? `${this.selected.creator} · ${this.selected.license}\n${this.selected.packName}` : 'Kenney & original models';
    document.querySelectorAll('.toy-count').forEach(el => el.textContent = `${this.toys.length} / ${LIMIT} toys`);
    document.querySelectorAll('.selected-name').forEach(el => el.textContent = name);
    document.querySelectorAll('.selected-credit').forEach(el => el.textContent = credit.replace('\n',' · '));
    const download = document.querySelector('#asset-download');
    download.href = this.selected?.file || '#'; download.hidden = !this.selected;
    const gravity = document.querySelector('[data-action=gravity]'); gravity.textContent = `Gravity: ${this.gravity ? 'ON' : 'OFF'}`; gravity.setAttribute('aria-pressed',String(this.gravity));
    this.catalog?.render();
    document.querySelectorAll('[hand-with-watch]').forEach(el => el.components['hand-with-watch']?.crossbarComponent?.menu.refresh());
    this.el.systems['visor-menu']?.component?.menu.refresh();
  },
  message(value) { document.querySelector('#status').textContent = value; },
  spawnPosition(index = this.toys.length) {
    const camera = document.querySelector('#viewer-camera').object3D;
    const position = camera.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.negate(); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
    position.addScaledVector(forward,0.85).addScaledVector(right,((index%3)-1)*0.32); position.y = 1.05;
    // Keep spawned toys out of the chest even if the player is right at it.
    if (Math.abs(position.x) < 0.8 && Math.abs(position.z+1.3) < 0.65) position.x += 1;
    return position;
  },
  async spawn() {
    if (!this.selected) { this.message('Choose a toy first.'); return; }
    if (this.toys.length+this.pending >= LIMIT) { this.message('Toybox full (32). Put some toys away first.'); return; }
    const definition = this.selected, generation = this.generation, sizeMode = this.spawnSize;
    this.pending++; this.message(`Taking out ${definition.name}…`);
    try {
      const model = await loadToy(definition);
      if (generation !== this.generation) { disposeModel(model); return; }
      const { size, center } = measureToy(model), max = Math.max(size.x,size.y,size.z);
      const scale = sizeMode === 'real' ? 1 : (sizeMode === 'large' ? 0.7 : 0.35)/max;
      const group = new THREE.Group(); model.position.sub(center); group.add(model); group.scale.setScalar(scale);
      const toy = document.createElement('a-entity'); toy.classList.add('toy'); toy.dataset.model = definition.id;
      toy.id = `toy-${++this.nextToyId}`;
      toy.toyModel = group; toy.toyDefinition = definition; toy.toySize = size.clone().multiplyScalar(scale);
      toy.setObject3D('mesh',group);
      const pos = this.spawnPosition(); toy.setAttribute('position',`${pos.x} ${pos.y} ${pos.z}`);
      toy.setAttribute('rotation','0 180 0');
      toy.setAttribute('simple-grabbable', {
        floorY: 0.005, gravity: this.gravity ? 9.8 : 0, throwEnabled: true, preserveGrabTransform: true,
        halfExtents: { x: size.x*scale/2, y: size.y*scale/2, z: size.z*scale/2 },
      });
      toy.setAttribute('hint-zone', {
        action: 'grab', radius: Math.max(0.18, Math.min(0.5,max*scale/2)), maxReach: 1.2,
        gazeThreshold: 0.86, priority: 10, desktopKey: 'F', desktopLabel: `Grab ${definition.name}`, xrKey: 'GRIP', xrLabel: 'Grab toy', hintScale: 0.6,
      });
      document.querySelector('#toys').appendChild(toy); this.toys.push(toy);
      toy.components['simple-grabbable'].state = this.gravity ? 'falling' : 'resting';
      toy.addEventListener('simple-grabbed', () => this.wakeToys());
      this.message(`${definition.name} is out. Grip / F to grab it.`); this.sync(); refreshCaptions();
    } catch (error) { this.message('Could not load this toy. Try again.'); console.error(error); }
    finally { this.pending--; }
  },
  wakeToys() {
    if (!this.gravity) return;
    for (const toy of this.toys) if (toy.components['simple-grabbable'].state !== 'held') toy.components['simple-grabbable'].state = 'falling';
  },
  activeToy() {
    for (const id of ['left-hand','right-hand']) {
      const held = document.querySelector(`#${id}`).components['semantic-hand'].heldEl;
      if (held?.classList.contains('toy')) return held;
    }
    return this.toys.at(-1);
  },
  putAway(toy) {
    if (!toy) return;
    const body = toy.components['simple-grabbable']; if (body.state === 'held') body.release(body.handEl);
    toy.object3D.removeFromParent(); disposeModel(toy.toyModel); toy.remove();
    this.toys = this.toys.filter(other => other !== toy); this.wakeToys(); this.sync();
  },
  toss() {
    const toy = this.activeToy(), body = toy?.components['simple-grabbable'];
    if (body?.state !== 'held') return;
    body.release(body.handEl);
    document.querySelector('#viewer-camera').object3D.getWorldDirection(body.velocity); body.velocity.multiplyScalar(-3); body.velocity.y += 1;
    body.angularVelocity.set(0,2,1);
  },
  action(action) {
    if (action.startsWith('spawn:')) {
      const id = action.slice(6);
      if (this.selected?.id !== id) this.select(id);
      this.spawn(); return;
    }
    if (action === 'open') { this.open(); return; }
    if (action === 'spawn') { this.spawn(); return; }
    if (action === 'next' || action === 'previous') {
      const pages = Math.max(1,Math.ceil(this.results().length/PAGE_SIZE)); this.page = (this.page+(action === 'next' ? 1 : -1)+pages)%pages; this.render(); return;
    }
    if (action === 'site') {
      window.open('https://kenney.nl','_blank','noopener,noreferrer'); return;
    }
    if (action === 'gravity') {
      this.gravity = !this.gravity;
      for (const toy of this.toys) {
        const body = toy.components['simple-grabbable']; toy.setAttribute('simple-grabbable','gravity',this.gravity ? 9.8 : 0);
        if (body.state !== 'held') { body.velocity.set(0,0,0); body.angularVelocity.set(0,0,0); body.state = this.gravity ? 'falling' : 'resting'; }
      }
      this.message(this.gravity ? 'Gravity on. Free toys fall.' : 'Gravity off. Arrange toys in the air.');
    }
    if (action === 'clear') { this.generation++; for (const toy of [...this.toys]) this.putAway(toy); this.message('All toys put away.'); }
    const toy = this.activeToy(), body = toy?.components['simple-grabbable'];
    if (toy && ['smaller','larger'].includes(action)) {
      const scale = THREE.MathUtils.clamp(toy.object3D.scale.x*(action === 'larger' ? 1.25 : 0.8),0.2,4);
      toy.object3D.scale.setScalar(scale); this.wakeToys();
    }
    if (toy && action === 'rotate') { toy.object3D.rotateY(Math.PI/6); this.wakeToys(); }
    if (toy && action === 'recall') {
      if (body.state === 'held') body.release(body.handEl);
      toy.object3D.position.copy(this.spawnPosition(1)); body.velocity.set(0,0,0); body.angularVelocity.set(0,0,0); body.state = this.gravity ? 'falling' : 'resting';
    }
    if (toy && action === 'remove') this.putAway(toy);
    if (action === 'size') this.spawnSize = this.spawnSize === 'toy' ? 'large' : this.spawnSize === 'large' ? 'real' : 'toy';
    this.sync();
  },
  tick(_time,delta) {
    if (this.preview && this.menu?.visible) this.preview.rotation.y += Math.min(delta || 0,100)*0.00035;
    if (this.menu) {
      const lid = document.querySelector('#chest-lid').object3D;
      const target = this.menu.active ? -1.5 : 0; lid.rotation.x += (target-lid.rotation.x)*Math.min(1,(delta || 0)*0.012);
    }
    for (const toy of this.toys) {
      const body = toy.components['simple-grabbable']; if (body.state === 'held') continue;
      const p = toy.object3D.position;
      for (const axis of ['x','z']) if (Math.abs(p[axis]) > 12) { p[axis] = Math.sign(p[axis])*12; body.velocity[axis] *= -0.4; }
      if (p.y > 8) { p.y = 8; body.velocity.y = Math.min(0,body.velocity.y); }
    }
  },
  tock() { resolveToyContacts(this.toys,this.gravity); },
  remove() {
    this.generation++; this.previewToken++; this.abort.abort();
    this.el.removeEventListener('menu-action',this.onSelect); this.el.removeEventListener('menu-commit',this.onCommit); this.el.removeEventListener('watch-menu-ready',this.onWatchReady);
    this.el.removeEventListener('visor-menu-opened',this.onWatchReady);
    this.el.removeEventListener('loaded',this.onLoaded); this.el.removeEventListener('enter-vr',this.onEnter); this.el.removeEventListener('exit-vr',this.onExit);
    for (const toy of [...this.toys]) this.putAway(toy);
    if (this.preview) { this.previewHost.remove(this.preview); disposeModel(this.preview); }
    document.body.classList.remove('in-xr');
  },
});
