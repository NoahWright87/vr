// Render a thumbnail of every Toybox model into one atlas image per
// collection, for the grid menu's tiles (common/menu-grid.js).
//
//   node scripts/render-toy-thumbnails.mjs
//
// Writes assets/models/thumbnails/<collection>.png and index.json, which
// games/model-viewer/toy-assets.js reads. Rerun it after importing models
// (scripts/import-kenney.mjs) or changing the originals in
// assets/models/catalog.js; it is not part of the build.
//
// Why atlases rather than one PNG per model: a tile showing a cell of an
// atlas shares that atlas's one texture with every other tile from the
// same collection, so browsing 140 pieces of furniture is one texture
// upload, not 140 — which matters on a Quest. Rendered offline, in a
// headless Chromium (the same Playwright the tests use), from the same
// files and the same procedural builder the Toybox loads at runtime, so a
// thumbnail is the model you get.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'assets/models/thumbnails');
const CELL = 128;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.bin': 'application/octet-stream' };

// The page the models are drawn in. Kept here so the script is the whole
// tool; it is served from memory, not written into the repo.
const PAGE = `<!doctype html><html><body>
<script src="/vendor/aframe-1.6.0/aframe-v1.6.0.min.js"></script>
<script type="module">
import { createModel } from '/common/model-library.js';
const THREE = AFRAME.THREE;
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(${CELL}, ${CELL});
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
const loader = new THREE.GLTFLoader();

async function load(model) {
  if (model.procedural) return createModel(THREE, model.id);
  const gltf = await loader.loadAsync(model.file);
  return gltf.scene;
}

// One cell: the model centred, seen from the front and a little above
// and to the right, framed to its bounding sphere so a chair and a
// bookcase each fill their tile.
async function cell(model) {
  const object = await load(model);
  const holder = new THREE.Group();
  holder.add(object);
  // Face the camera, turned a little to show a side. Kenney's models face
  // +Z and the originals -Z, hence the half turn between them.
  holder.rotation.y = Math.PI * (model.procedural ? 1.15 : 0.15);
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1e-3);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.02;
  const direction = new THREE.Vector3(0.35, 0.45, 1).normalize();
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.lookAt(sphere.center);
  renderer.render(scene, camera);
  scene.remove(holder);
  holder.traverse(node => {
    if (node.geometry) node.geometry.dispose();
    const materials = node.material ? [].concat(node.material) : [];
    materials.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  return renderer.domElement;
}

window.renderAtlas = async function (models) {
  const columns = Math.ceil(Math.sqrt(models.length));
  const rows = Math.ceil(models.length / columns);
  const atlas = document.createElement('canvas');
  atlas.width = columns * ${CELL};
  atlas.height = rows * ${CELL};
  const ctx = atlas.getContext('2d');
  const failed = [];
  for (let i = 0; i < models.length; i++) {
    try {
      const canvas = await cell(models[i]);
      ctx.drawImage(canvas, (i % columns) * ${CELL}, Math.floor(i / columns) * ${CELL});
    } catch (error) {
      failed.push(models[i].id + ': ' + error.message);
    }
  }
  return { columns, rows, failed, png: atlas.toDataURL('image/png') };
};
window.thumbnailsReady = true;
</script></body></html>`;

function serve() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (path === '/__thumbnails.html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(PAGE);
      return;
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

// The same lists toy-assets.js builds, grouped by collection.
async function collections() {
  const kenney = JSON.parse(await readFile(resolve(root, 'assets/models/kenney/catalog.json'), 'utf8'));
  const { models } = await import(resolve(root, 'assets/models/catalog.js'));
  const groups = new Map();
  for (const model of kenney) {
    if (!groups.has(model.pack)) groups.set(model.pack, []);
    groups.get(model.pack).push({ id: model.id, file: model.file });
  }
  groups.set('originals', models.map(model => ({ id: model.id, procedural: true })));
  return groups;
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VR_PLAYWRIGHT_PATH || 'playwright');
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('page error:', error.message));
  await page.goto(base + '/__thumbnails.html');
  await page.waitForFunction(() => window.thumbnailsReady === true);
  await mkdir(output, { recursive: true });
  const index = { cell: CELL, atlases: {}, models: {} };
  for (const [name, models] of await collections()) {
    const result = await page.evaluate(list => window.renderAtlas(list), models);
    if (result.failed.length) throw Error(`${name}: ${result.failed.join('; ')}`);
    await writeFile(resolve(output, `${name}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    index.atlases[name] = { file: `/assets/models/thumbnails/${name}.png`, columns: result.columns, rows: result.rows };
    models.forEach((model, i) => { index.models[model.id] = [name, i]; });
    console.log(`${name}: ${models.length} thumbnails, ${result.columns} x ${result.rows}`);
  }
  await writeFile(resolve(output, 'index.json'), JSON.stringify(index) + '\n');
} finally {
  await browser.close();
  server.close();
}
