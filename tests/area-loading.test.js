import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/pistols-at-dawn/index.html', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../games/pistols-at-dawn/js/world-town.js', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../games/pistols-at-dawn/js/world-menu.js', import.meta.url), 'utf8');
const dayNight = readFileSync(new URL('../games/pistols-at-dawn/js/world-day-night.js', import.meta.url), 'utf8');
const ghostTown = readFileSync(new URL('../games/pistols-at-dawn/areas/ghost-town.html', import.meta.url), 'utf8');
const saloonInterior = readFileSync(new URL('../games/pistols-at-dawn/js/world-saloon-interior.js', import.meta.url), 'utf8');
const hubInteriors = readFileSync(new URL('../games/pistols-at-dawn/js/world-hub-interiors.js', import.meta.url), 'utf8');

test('destinations are lazy fragments instead of simultaneous scene entities', () => {
  for (const id of ['ghost-town', 'range', 'saloon', 'farm', 'stable', 'sheriff-office', 'general-store', 'bank', 'pharmacy', 'post-office', 'boots-suits', 'shooting-gallery']) {
    assert.match(loader, new RegExp(`fragment: 'areas/${id}\\.html'`));
  }
  assert.match(page, /<a-entity id="area-host" data-area-persistent><\/a-entity>/);
  assert.match(page, /id="carried-items" data-area-persistent/);
  assert.match(page, /<a-scene pistols-watch-menu area-manager scene-index day-night-cycle weather-clouds shadow="enabled: true; type: pcfsoft">/);
  assert.match(dayNight, /FAST_FORWARD_TIME_SCALE = 20/);
  assert.match(dayNight, /LUNAR_SYNODIC_DAYS = 29\.53059/);
  assert.match(dayNight, /this\.elapsedGameMs \+= Math\.min\(delta \|\| 16, 100\) \* this\.timeScale/);
  assert.match(dayNight, /this\.elapsedGameMs \/ \(DAY_NIGHT_CYCLE_MS \* LUNAR_SYNODIC_DAYS\)/);
  assert.match(dayNight, /nightSky\.object3D\.rotation\.y/);
  assert.match(dayNight, /registerComponent\('weather-clouds'/);
  assert.match(dayNight, /groupCount: \{ type: 'int', default: 20 \}/);
  assert.match(dayNight, /minCloudsPerGroup: \{ type: 'int', default: 4 \}/);
  assert.match(dayNight, /maxCloudsPerGroup: \{ type: 'int', default: 8 \}/);
  assert.match(dayNight, /windDirection: \{ type: 'number', default: 0 \}/);
  assert.match(dayNight, /formationDistance: \{ type: 'number', default: 80 \}/);
  assert.match(dayNight, /weatherTimeScale = cycle \? cycle\.timeScale : 1/);
  assert.match(dayNight, /group\.mesh\.position\.x \+= Math\.cos\(heading\)/);
  assert.match(dayNight, /var heading = this\.windAngle \+ wobble/);
  assert.match(dayNight, /this\.resetGroup\(group, false, 0\)/);
  assert.match(dayNight, /new THREE\.BufferGeometry\(\)/);
  assert.match(dayNight, /one soft ground decal per cloud group/);
  assert.match(dayNight, /TODO\(high-graphics\): add an option for real alpha-tested cloud shadow/);
  assert.doesNotMatch(dayNight, /spawnCell/);
  assert.doesNotMatch(dayNight, /setFromUnitVectors|setFromRotationMatrix/);
  assert.match(dayNight, /this\.sunOrb\.renderOrder = -10/);
  assert.match(dayNight, /weather-cloud-underside-atlas-v1\.png/);
  assert.doesNotMatch(dayNight, /new THREE\.BoxGeometry\(1, 0\.18, 0\.62\)/);
  assert.match(dayNight, /evt\.code !== 'Backslash'/);
  assert.match(page, /desert-day-skybox-v2\.png/);
  assert.match(page, /id="night-sky" radius="650"/);
  assert.doesNotMatch(page, /cloud-sky/);
  assert.match(dayNight, /sun-billboard-v1\.png/);
  assert.match(dayNight, /makeCelestialPlane\('assets\/textures\/sun-billboard-v1\.png', 24, false\)/);
  assert.match(dayNight, /this\.scene\.add\(this\.sunOrb\)/);
  assert.match(dayNight, /moon-billboard-v1\.png/);
  assert.match(dayNight, /this\.moonOrb\.rotation\.y = -Math\.PI \/ 2/);
  assert.match(dayNight, /this\.sunOrb\.lookAt\(0, 0, 0\)/);
  assert.match(dayNight, /new THREE\.Mesh\(new THREE\.PlaneGeometry\(1, 1\), new THREE\.MeshBasicMaterial/);
  assert.doesNotMatch(dayNight, /new THREE\.Sprite/);
  assert.match(dayNight, /this\.sunShadows = true/);
  assert.match(loader, /preservePlayerItems: function/);
  assert.doesNotMatch(page, /<a-entity (?:saloon-darts|farm|stable)>/);
});

test('Ghost Town is the startup hub with its two welcome gateways, nine building blockouts, and horse stalls', () => {
  assert.match(loader, /this\.switchTo\('ghost-town'\)/);
  assert.match(loader, /id: 'ghost-town', label: 'Ghost Town', position: \{ x: 0, y: 0, z: 24 \}/);
  assert.match(loader, /rig\.object3D\.position\.set\(location\.position\.x, location\.position\.y, location\.position\.z\)/);
  assert.match(page, /menu-item="value: teleport-ghost-town; label: Ghost Town"/);
  assert.equal((ghostTown.match(/class="ghost-town-welcome-gateway/g) || []).length, 2);
  assert.equal((ghostTown.match(/Welcome to Ghost Town!/g) || []).length, 2);
  assert.match(ghostTown, /class="ghost-town-welcome-gateway" position="0 0 20">/);
  assert.match(ghostTown, /class="ghost-town-welcome-gateway" position="0 0 -20" rotation="0 180 0">/);
  assert.equal((ghostTown.match(/class="ghost-town-building/g) || []).length, 9);
  assert.match(ghostTown, /class="ghost-town-horse-stalls" ghost-town-stalls/);
  assert.match(ghostTown, /class="ghost-town-building ghost-town-gallery" ghost-town-gallery/);
  assert.match(loader, /js\/world-ghost-town-gallery\.js/);
  assert.match(loader, /fragment: 'areas\/ghost-town\.html',[\s\S]*?js\/world-targets\.js/);
  assert.match(loader, /js\/world-ghost-town-stalls\.js/);
  assert.match(ghostTown, /class="ghost-town-building ghost-town-carriage-tickets" carriage-ticket-stall/);
  assert.match(loader, /js\/world-ghost-town-carriage\.js/);
});

test('the Shooting Gallery facade leads to an intentionally oversized indoor target room', () => {
  const gallery = readFileSync(new URL('../games/pistols-at-dawn/areas/shooting-gallery.html', import.meta.url), 'utf8');
  const galleryBuilder = readFileSync(new URL('../games/pistols-at-dawn/js/world-ghost-town-gallery.js', import.meta.url), 'utf8');
  assert.match(loader, /id: 'shooting-gallery', label: 'Shooting Gallery'/);
  assert.match(page, /menu-item="value: teleport-shooting-gallery; label: Shooting Gallery"/);
  assert.match(galleryBuilder, /ghost-town-gallery-door/);
  assert.match(galleryBuilder, /destination: shooting-gallery/);
  assert.match(gallery, /shooting-gallery-interior/);
  assert.match(galleryBuilder, /registerComponent\('shooting-gallery-interior'/);
  assert.match(galleryBuilder, /target-group', 'count: 5; distance: 12/);
  assert.match(galleryBuilder, /shooting-gallery-exit-door/);
  assert.match(galleryBuilder, /destination: ghost-town; arrival: shooting-gallery-entrance/);
  assert.match(loader, /fragment: 'areas\/shooting-gallery\.html', scripts: \['js\/world-targets\.js', 'js\/world-ghost-town-gallery\.js'\]/);
});

test('the Saloon door uses the shared semantic controls to enter the Saloon', () => {
  assert.match(page, /src="\.\.\/\.\.\/common\/locomotion\.js"/);
  assert.match(page, /src="\.\.\/\.\.\/common\/desktop-controls\.js"/);
  assert.match(page, /gamepad-input="leftHand: #left-hand; rightHand: #right-hand; sprintAction: sprint"/);
  assert.match(page, /touch-controls="leftHand: #left-hand; rightHand: #right-hand/);
  assert.match(page, /desktop-controls="camera: #head-camera; leftHand: #left-hand; rightHand: #right-hand; sprintEnabled: true"/);
  assert.match(ghostTown, /class="ghost-town-building ghost-town-saloon"/);
  assert.match(ghostTown, /id="ghost-town-saloon-door"/);
  assert.match(ghostTown, /town-door="destination: saloon"/);
  assert.match(ghostTown, /desktopKey: E; desktopLabel: Enter Saloon/);
  assert.match(ghostTown, /radius: 0\.8; maxReach: 1\.65; gazeThreshold: 0\.78/);
  assert.match(loader, /registerComponent\('town-door'/);
  assert.match(loader, /hub\.teleportTo\(this\.data\.destination, arrival\)/);
});

test('the expanded Saloon has a shared interior, return door, and dart lanes', () => {
  const saloon = readFileSync(new URL('../games/pistols-at-dawn/areas/saloon.html', import.meta.url), 'utf8');
  assert.match(saloon, /saloon-interior/);
  assert.match(loader, /js\/world-saloon-interior\.js/);
  assert.match(loader, /'saloon-entrance': \{ position: \{ x: -5\.7, y: 0, z: 12 \}, rotationY: 90 \}/);
  assert.match(loader, /teleportTo: function \(id, arrival\)/);
  assert.match(loader, /location\.arrivals\[this\.data\.arrival\]/);
  assert.match(saloonInterior, /SALOON_WIDTH = 16/);
  assert.match(saloonInterior, /addBottle/);
  assert.match(saloonInterior, /buildTables/);
  assert.match(saloonInterior, /buildPianoNook/);
  assert.match(saloonInterior, /buildWindows/);
  assert.match(saloonInterior, /classList\.add\('saloon-window'\)/);
  assert.match(saloonInterior, /SALOO?N_WIDTH, 0\.18, SALOON_DEPTH/);
  assert.match(saloonInterior, /type: ambient; color: #e8cda8; intensity: 0\.58/);
  assert.match(saloonInterior, /classList\.add\('saloon-lantern'\)/);
  assert.match(saloonInterior, /id', 'saloon-exit-door'/);
  assert.match(saloonInterior, /destination: ghost-town; arrival: saloon-entrance/);
});

test('Ghost Town connects to a Sheriff’s Office and stocked General Store', () => {
  const sheriff = readFileSync(new URL('../games/pistols-at-dawn/areas/sheriff-office.html', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../games/pistols-at-dawn/areas/general-store.html', import.meta.url), 'utf8');
  assert.match(loader, /id: 'sheriff-office', label: "Sheriff's Office"/);
  assert.match(loader, /id: 'general-store', label: 'General Store'/);
  assert.match(loader, /js\/world-hub-interiors\.js/);
  assert.match(page, /menu-item="value: teleport-sheriff-office; label: Sheriff's Office"/);
  assert.match(page, /menu-item="value: teleport-general-store; label: General Store"/);
  assert.match(ghostTown, /id="ghost-town-sheriff-door"/);
  assert.match(ghostTown, /town-door="destination: sheriff-office"/);
  assert.match(ghostTown, /id="ghost-town-store-door"/);
  assert.match(ghostTown, /town-door="destination: general-store"/);
  assert.match(sheriff, /sheriff-office/);
  assert.match(store, /general-store/);
  assert.match(hubInteriors, /registerComponent\('sheriff-office'/);
  assert.match(hubInteriors, /registerComponent\('general-store'/);
  assert.match(hubInteriors, /WANTED\\nDEAD OR ALIVE/);
  assert.match(hubInteriors, /hubExit\(this\.el, 'sheriff-entrance'\)/);
  assert.match(hubInteriors, /hubExit\(this\.el, 'store-entrance'\)/);
  assert.match(hubInteriors, /type: ambient; color: #d9b887; intensity: \.42/);
  assert.match(hubInteriors, /type: point; color: #ffd48a; intensity: 1\.25; distance: 9/);
  assert.match(hubInteriors, /radius: \.8; maxReach: 1\.65; gazeThreshold: \.78/);
  for (const item of ['pistol', 'shotgun', 'tommy', 'bow', 'dynamite', 'launcher', 'rocket']) {
    assert.match(hubInteriors, new RegExp(`'${item}'`));
  }
});

test('the Bank is a hub interior with a street door and vault', () => {
  const bank = readFileSync(new URL('../games/pistols-at-dawn/areas/bank.html', import.meta.url), 'utf8');
  assert.match(loader, /id: 'bank', label: 'The Bank'/);
  assert.match(page, /menu-item="value: teleport-bank; label: The Bank"/);
  assert.match(ghostTown, /id="ghost-town-bank-door"/);
  assert.match(ghostTown, /town-door="destination: bank"/);
  assert.match(bank, /bank-interior/);
  assert.match(hubInteriors, /registerComponent\('bank-interior'/);
  assert.match(hubInteriors, /hubExit\(this\.el, 'bank-entrance'\)/);
  assert.match(hubInteriors, /a-torus/);
});

test('the Pharmacy brings elixirs, soda, and medical supplies to Ghost Town', () => {
  const pharmacy = readFileSync(new URL('../games/pistols-at-dawn/areas/pharmacy.html', import.meta.url), 'utf8');
  assert.match(loader, /id: 'pharmacy', label: 'The Pharmacy'/);
  assert.match(page, /menu-item="value: teleport-pharmacy; label: The Pharmacy"/);
  assert.match(ghostTown, /id="ghost-town-pharmacy-door"/);
  assert.match(ghostTown, /town-door="destination: pharmacy"/);
  assert.match(pharmacy, /pharmacy-interior/);
  assert.match(hubInteriors, /registerComponent\('pharmacy-interior'/);
  assert.match(hubInteriors, /SARSAPARILLA  •  TONICS  •  BANDAGES/);
  assert.match(hubInteriors, /hubExit\(this\.el, 'pharmacy-entrance'\)/);
});

test('the Post Office and Boots & Suits fill the final town building slots', () => {
  const postOffice = readFileSync(new URL('../games/pistols-at-dawn/areas/post-office.html', import.meta.url), 'utf8');
  const bootsSuits = readFileSync(new URL('../games/pistols-at-dawn/areas/boots-suits.html', import.meta.url), 'utf8');
  assert.match(loader, /id: 'post-office', label: 'Post Office'/);
  assert.match(loader, /id: 'boots-suits', label: 'Boots & Suits'/);
  assert.match(page, /menu-item="value: teleport-post-office; label: Post Office"/);
  assert.match(page, /menu-item="value: teleport-boots-suits; label: Boots &amp; Suits"/);
  assert.match(ghostTown, /town-door="destination: post-office"/);
  assert.match(ghostTown, /town-door="destination: boots-suits"/);
  assert.match(postOffice, /post-office-interior/);
  assert.match(bootsSuits, /boots-suits-interior/);
  assert.match(hubInteriors, /registerComponent\('post-office-interior'/);
  assert.match(hubInteriors, /registerComponent\('boots-suits-interior'/);
  assert.match(hubInteriors, /FRIENDS &amp; INVITES/);
  assert.match(hubInteriors, /HATS • BOOTS • VESTS/);
});

test('Carriage Tickets use the projected menu to reach out-of-town destinations', () => {
  const carriage = readFileSync(new URL('../games/pistols-at-dawn/js/world-ghost-town-carriage.js', import.meta.url), 'utf8');
  assert.match(carriage, /registerComponent\('carriage-ticket-stall'/);
  assert.match(carriage, /projected-menu/);
  assert.match(carriage, /laserScale: 1; offset: 0 \.45 0/);
  assert.match(carriage, /radius: 1\.6; maxReach: 1\.65; gazeThreshold: \.72/);
  for (const id of ['range', 'farm', 'stable']) assert.match(carriage, new RegExp(`carriage-${id}`));
  assert.match(carriage, /hub\.teleportTo\(value\.slice\('carriage-'\.length\)\)/);
});

test('destination builders are absent from the eager script list', () => {
  for (const script of [
    'items-siege-weapons', 'world-saloon-bar', 'world-shooting-stall',
    'world-targets', 'world-saloon-darts', 'world-farm', 'world-stable',
    'world-saloon-interior', 'world-hub-interiors', 'world-ghost-town-stalls', 'world-ghost-town-gallery', 'world-ghost-town-carriage',
  ]) {
    assert.doesNotMatch(page, new RegExp(`<script src="js/${script}\\.js"`));
    assert.match(loader, new RegExp(`js/${script}\\.js`));
  }
});

test('HUD visibility is exposed through the watch menu', () => {
  assert.match(page, /menu-item="value: toggle-hud; label: Hide HUD"/);
  assert.match(page, /id="player-hud"/);
  assert.match(menu, /PLAYER_HUD_VISIBLE = this\.hudVisible/);
  assert.match(page, /menu-item="value: toggle-performance; label: Show Performance"/);
});
