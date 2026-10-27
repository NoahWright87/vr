// Pure page data: the shared menu model supplies scrolling, focus,
// breadcrumbs and confirmation for the chest, watches and visor. The
// catalog is laid out as a grid (`layout: 'grid'`), so the chest's grid
// menu shows a dozen toys at a time with a picture of each, while the
// same page still reads as a list on any crossbar.
//
// `options.thumbnail(asset)` gives a toy's tile picture and
// `options.details(asset)` its details pane (see menu-model.js DETAILS);
// both optional, so the page works without either.
export function createToyboxCatalog(assets, creators, describe, options = {}) {
  const thumbnail = options.thumbnail || (() => null);
  const firstOf = list => list.length ? thumbnail(list[0]) : null;
  return {
    title: '3D MODEL TOYBOX',
    layout: 'grid',
    info: ['Choose a creator and collection.', 'Focus a toy to preview it.', 'Confirm to take out a copy.'],
    items: creators.map(creator => {
      const own = assets.filter(a => a.creatorId === creator.id);
      return {
        kind: 'submenu', id: `toy-creator:${creator.id}`, label: creator.name, creatorId: creator.id, layout: 'grid',
        thumbnail: firstOf(own), subtitle: `${own.length} toys`,
        info: creator.id === 'kenney' ? ['KENNEY', 'Free game assets by Kenney.', 'kenney.nl', 'CC0 model packs — thank you!'] : ['ORIGINALS', '14 original low-poly blockouts.', 'BSD-2-Clause'],
        // The same words without the heading the sidecar needs: the details
        // pane already titles it.
        details: { text: creator.id === 'kenney' ? ['Free game assets by Kenney.', 'kenney.nl', 'CC0 model packs — thank you!'] : ['14 original low-poly blockouts.', 'BSD-2-Clause'] },
        items: [...new Map(own.map(a => [a.pack, a.packName]))].map(([pack, name]) => {
          const toys = own.filter(a => a.pack === pack);
          return {
            kind: 'submenu', id: `toy-pack:${pack}`, label: name, creatorId: creator.id, layout: 'grid',
            thumbnail: firstOf(toys), subtitle: `${toys.length} toys`,
            info: [creator.name, name, 'Choose a toy to preview it.'],
            details: { subtitle: creator.name, text: 'Choose a toy to preview it.' },
            items: toys.map(asset => ({
              kind: 'action', id: `toy-spawn:${asset.id}`, label: asset.name, modelId: asset.id, creatorId: creator.id,
              actionLabel: 'Take out a copy', thumbnail: thumbnail(asset),
              info: () => describe(asset),
              details: options.details ? () => options.details(asset) : undefined,
            })),
          };
        }),
      };
    }).concat([{ kind: 'action', id: 'toy-site', label: 'Visit Kenney.nl', creatorId: 'kenney', actionLabel: 'Open the website', info: ['KENNEY', 'kenney.nl', 'Original creator of 228 toys.'] }]),
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
    { kind: 'action', id: 'toy-clear', label: 'Put ALL toys away', hold: 'long', info: `${current.count} / 32 toys out. Clears this playroom.` },
  ];
}
