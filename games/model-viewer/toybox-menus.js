// Pure page data: the shared crossbar model supplies scrolling, focus,
// breadcrumbs and confirmation for the chest, watches and visor.
export function createToyboxCatalog(assets, creators, describe) {
  return {
    title: '3D MODEL TOYBOX',
    info: ['Choose a creator and collection.', 'Focus a toy to preview it.', 'Confirm to take out a copy.'],
    items: creators.map(creator => ({
      kind: 'submenu', id: `toy-creator:${creator.id}`, label: creator.name, creatorId: creator.id,
      info: creator.id === 'kenney' ? ['KENNEY', 'Free game assets by Kenney.', 'kenney.nl', 'CC0 model packs — thank you!'] : ['ORIGINALS', '14 original low-poly blockouts.', 'BSD-2-Clause'],
      items: [...new Map(assets.filter(a => a.creatorId === creator.id).map(a => [a.pack, a.packName]))].map(([pack, name]) => ({
        kind: 'submenu', id: `toy-pack:${pack}`, label: name, creatorId: creator.id,
        info: [creator.name, name, 'Choose a toy to preview it.'],
        items: assets.filter(a => a.creatorId === creator.id && a.pack === pack).map(asset => ({
          kind: 'action', id: `toy-spawn:${asset.id}`, label: asset.name, modelId: asset.id, creatorId: creator.id,
          info: () => describe(asset),
        })),
      })),
    })).concat([{ kind: 'action', id: 'toy-site', label: 'Visit Kenney.nl', creatorId: 'kenney', info: ['KENNEY', 'kenney.nl', 'Original creator of 228 toys.'] }]),
  };
}

export function toyboxControlItems(state) {
  const current = state();
  return [
    { kind: 'action', id: 'toy-open', label: 'Open toybox' },
    { kind: 'toggle', id: 'toy-gravity', label: 'Gravity', value: current.gravity },
    { kind: 'select', id: 'toy-size', label: 'New toys', value: current.spawnSize, options: [
      { value: 'toy', label: '35 cm' }, { value: 'large', label: '70 cm' }, { value: 'real', label: 'Actual size' },
    ] },
    { kind: 'submenu', id: 'toy-arrange', label: 'Held / latest toy', info: 'These controls affect the held toy, otherwise the latest toy.', items: [
      { kind: 'action', id: 'toy-smaller', label: 'Smaller' },
      { kind: 'action', id: 'toy-larger', label: 'Larger' },
      { kind: 'action', id: 'toy-rotate', label: 'Rotate' },
      { kind: 'action', id: 'toy-recall', label: 'Bring here' },
      { kind: 'action', id: 'toy-remove', label: 'Put away' },
    ] },
    { kind: 'action', id: 'toy-clear', label: 'Put ALL toys away', info: `${current.count} / 32 toys out. Clears this playroom.` },
  ];
}
