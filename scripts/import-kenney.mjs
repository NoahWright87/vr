// Import only web-ready models and their dependencies from official archives
// expanded under .tmp/kenney/<pack>. See the source manifest for archive URLs.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const packs = [
  { id: 'furniture-kit', name: 'Furniture Kit', version: '2.0', folder: 'GLTF format', archive: 'https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip' },
  { id: 'blaster-kit', name: 'Blaster Kit', version: '2.1', folder: 'GLB format', archive: 'https://kenney.nl/media/pages/assets/blaster-kit/261d80a716-1753959510/kenney_blaster-kit_2.1.zip' },
  { id: 'mini-dungeon', name: 'Mini Dungeon', version: '2.0', folder: 'GLB format', archive: 'https://kenney.nl/media/pages/assets/mini-dungeon/6cd72dc849-1785314274/kenney_mini-dungeon.zip' },
  { id: 'blocky-characters', name: 'Blocky Characters', version: '2.0', folder: 'GLB format', archive: 'https://kenney.nl/media/pages/assets/blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip' },
];
const assets = [];
for (const pack of packs) {
  const source = resolve(root, '.tmp/kenney', pack.id);
  const models = resolve(source, 'Models', pack.folder);
  const output = resolve(root, 'assets/models/kenney', pack.id);
  await mkdir(output, { recursive: true });
  await cp(models, output, { recursive: true });
  await cp(resolve(source, 'License.txt'), resolve(output, 'License.txt'));
  const archive = await readFile(resolve(root, '.tmp/kenney', `${pack.id}.zip`));
  pack.sha256 = createHash('sha256').update(archive).digest('hex');
  const files = (await readdir(models)).filter(f => f.endsWith('.glb')).sort();
  pack.count = files.length;
  for (const file of files) {
    const bytes = await readFile(resolve(output, file));
    const json = JSON.parse(bytes.subarray(20, 20+bytes.readUInt32LE(12)).toString());
    // Validate dependencies here: no pack should appear to load successfully
    // while silently fetching a texture from a missing parent directory.
    for (const resource of [...(json.images || []), ...(json.buffers || [])]) {
      if (resource.uri && !resource.uri.startsWith('data:')) {
        if (resource.uri.includes('..') || /^\w+:/.test(resource.uri)) throw Error(`Unexpected URI: ${resource.uri}`);
        await readFile(resolve(output, resource.uri));
      }
    }
    const stem = file.slice(0, -4);
    const name = stem.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
    assets.push({ id: `kenney-${pack.id}-${stem}`, name, creator: 'Kenney', pack: pack.id,
      packName: pack.name, license: 'CC0-1.0', file: `/assets/models/kenney/${pack.id}/${file}`,
      source: `https://kenney.nl/assets/${pack.id}`,
      rigged: Boolean(json.skins?.length), animations: (json.animations || []).map(a => a.name || 'Animation'),
    });
  }
}
await writeFile(resolve(root, 'assets/models/kenney/catalog.json'), JSON.stringify(assets, null, 2)+'\n');
await writeFile(resolve(root, 'assets/models/kenney/sources.json'), JSON.stringify({
  creator: 'Kenney', website: 'https://kenney.nl', downloaded: '2026-10-15',
  logo: { source: 'https://kenney.nl/data/img/logo@2.png', usage: 'Creator attribution; separate from the CC0 model packs.' },
  packs,
}, null, 2)+'\n');
console.log(`Imported ${assets.length} models: ${packs.map(p => `${p.name} (${p.count})`).join(', ')}`);
