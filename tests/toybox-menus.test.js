import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMenu } from '../common/menu-model.js';
import { createToyboxCatalog, toyboxControlItems } from '../games/model-viewer/toybox-menus.js';

const imported = JSON.parse(readFileSync(new URL('../assets/models/kenney/catalog.json',import.meta.url)));
const assets = imported.map(a => ({...a,creatorId:'kenney'}));
const creators = [{id:'kenney',name:'Kenney'},{id:'originals',name:'Originals'}];

test('the Toybox uses shared crossbar focus for preview and confirmation for spawn', () => {
  const menu = createMenu(createToyboxCatalog(assets,creators,asset => asset.name));
  const actions=[];menu.on('action',event=>actions.push(event.id));menu.open();
  assert.equal(menu.focusedRow().item.id,'toy-creator:kenney');
  assert.match(menu.getInfo().text,/kenney.nl/);
  menu.forward();assert.equal(menu.focusedRow().item.id,'toy-pack:furniture-kit');
  menu.forward();
  assert.equal(menu.getInfo().item.modelId,assets[0].id);
  menu.moveFocus(12);assert.equal(actions.length,0);
  const chosen=menu.focusedRow().item.modelId;
  assert.ok(chosen);menu.forward();assert.deepEqual(actions,[`toy-spawn:${chosen}`]);
  menu.forward();assert.deepEqual(actions,[`toy-spawn:${chosen}`,`toy-spawn:${chosen}`]);
});

test('watch and visor controls expose live gravity, size, arrangement and clear actions', () => {
  let state={gravity:true,spawnSize:'toy',count:3};
  const page={title:'TOYBOX',items:()=>toyboxControlItems(()=>state)};
  const menu=createMenu(page);const commits=[];menu.on('commit',event=>commits.push(event));menu.open();
  menu.moveFocus(1);menu.forward();assert.equal(commits[0].item.id,'toy-gravity');assert.equal(commits[0].value,false);
  state={gravity:false,spawnSize:'real',count:12};menu.refresh();
  assert.equal(menu.focusedRow().item.value,false);
  menu.moveFocus(1);assert.match(menu.focusedRow().label,/Actual size/);
  menu.moveFocus(2);assert.match(menu.getInfo().text,/12 \/ 32/);
});

test('the experience imports the current menus and includes a visor and crossbar watch', () => {
  const page=readFileSync(new URL('../games/model-viewer/index.html',import.meta.url),'utf8');
  const script=readFileSync(new URL('../games/model-viewer/toybox.js',import.meta.url),'utf8');
  assert.match(page,/watch-crossbar-template/);assert.match(page,/grid-menu="page: toybox-catalog/);
  assert.doesNotMatch(page,/menu-item=|menu-chrome-slot|data-menu-page/);
  assert.match(script,/registerVisorPage\('visor', controlPage\)/);
  assert.match(script,/import '..\/..\/common\/menu-grid.js'/);
  const vite=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
  assert.match(vite,/modelViewer: resolve\(root, 'games\/model-viewer\/index.html'\)/);
});

test('the chest catalog is a grid of thumbnails with a details pane for each toy', async () => {
  const thumbnails = JSON.parse(readFileSync(new URL('../assets/models/thumbnails/index.json',import.meta.url)));
  // Every imported model has a rendered thumbnail.
  for (const asset of assets) assert.ok(thumbnails.models[asset.id], asset.id);
  const thumbnail = asset => ({ src: '/atlas.png', rect: [0, 0, 1, 1], id: asset.id });
  const page = createToyboxCatalog(assets, creators, asset => asset.name, {
    thumbnail, details: asset => ({ subtitle: asset.license, stats: [{ label: 'Collection', text: asset.packName }] }),
  });
  const menu = createMenu(page, { gridColumns: 4, gridRows: 3 });
  menu.open();
  assert.equal(menu.isGrid(), true);
  // Creators and collections are tiles too, pictured by their first toy.
  assert.equal(menu.getGrid().cells[0].thumbnail.id, assets[0].id);
  menu.forward(); menu.forward();
  const grid = menu.getGrid();
  assert.equal(grid.columns, 4);
  assert.equal(grid.cells.length, 12);
  assert.ok(grid.cells.every(cell => cell.thumbnail && cell.item.modelId === cell.thumbnail.id));
  menu.moveGrid(1, 0); menu.moveGrid(0, 1);
  assert.equal(menu.focusedRow().item.modelId, assets[5].id);
  const details = menu.getDetails();
  assert.equal(details.title, assets[5].name);
  assert.equal(details.stats[0].text, assets[5].packName);
  assert.equal(details.actionLabel, 'Take out a copy');
});
