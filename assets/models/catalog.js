// Original, texture-free blockout models. Dimensions are metres; +Y is up.
// Each part is [shape, material, position, size, rotation in degrees].
const box = (m, p, s, r) => ['box', m, p, s, r];
const cylinder = (m, p, s, r) => ['cylinder', m, p, s, r]; // [top radius, bottom radius, height]
const sphere = (m, p, s) => ['sphere', m, p, s]; // XYZ radii
const cone = (m, p, s, r) => ['cone', m, p, s, r]; // [radius, height]
export const palette = {
  steel: '#a9bac8', dark: '#303a48', wood: '#98633e', trim: '#d79a56',
  gold: '#e8b84b', bone: '#e4d9b7', black: '#171f2a', skin: '#dfa982',
  cloth: '#6388b6', stone: '#85939a', leaf: '#668855', red: '#aa5751',
};
const model = (id, name, category, description, parts) => ({
  id, name, category, description, parts, author: 'Noah’s VR projects',
  license: 'BSD-2-Clause', source: 'Original procedural model',
});
const legs = (x, z, height, width, material = 'wood') =>
  [-1, 1].flatMap(a => [-1, 1].map(b => box(material, [a*x, height/2, b*z], [width, height, width])));
function humanoid(skeleton = false) {
  const m = skeleton ? 'bone' : 'cloth';
  const parts = [];
  // Segmented limbs leave obvious elbows and knees, even in a still pose.
  for (const side of [-1, 1]) {
    const x = side * 0.11;
    parts.push(cylinder(m, [x, 0.72, 0], [0.055, 0.045, 0.38]),
      sphere(skeleton ? m : 'dark', [x, 0.51, 0], [0.055, 0.055, 0.055]),
      cylinder(skeleton ? m : 'dark', [x, 0.3, 0], [0.045, 0.035, 0.37]),
      box(skeleton ? m : 'dark', [x, 0.065, -0.045], [0.105, 0.13, 0.22]),
      cylinder(m, [side*0.29, 1.22, 0], [0.045, 0.037, 0.29], [0, 0, side*12]),
      sphere(skeleton ? m : 'skin', [side*0.32, 1.05, 0], [0.045, 0.045, 0.045]),
      cylinder(skeleton ? m : 'skin', [side*0.34, 0.91, 0], [0.036, 0.028, 0.23], [0, 0, side*5]),
      box(skeleton ? m : 'skin', [side*0.35, 0.75, 0], [0.07, 0.105, 0.055]));
  }
  parts.push(cylinder(skeleton ? m : 'skin', [0, 1.46, 0], [0.047, 0.047, 0.13]));
  if (skeleton) {
    parts.push(sphere('bone', [0, 1.65, 0], [0.115, 0.135, 0.105]),
      box('bone', [0, 1.52, -0.025], [0.14, 0.07, 0.12]),
      box('black', [-0.046, 1.66, -0.092], [0.052, 0.05, 0.035]),
      box('black', [0.046, 1.66, -0.092], [0.052, 0.05, 0.035]),
      box('black', [0, 1.6, -0.098], [0.025, 0.035, 0.025]),
      cylinder('bone', [0, 1.13, 0.035], [0.035, 0.035, 0.55]),
      box('bone', [0, 0.94, 0], [0.29, 0.1, 0.15]),
      box('bone', [0, 1.39, 0], [0.43, 0.045, 0.09]));
    for (let i = 0; i < 5; i++) {
      const y = 1.33-i*0.065, w = 0.32-i*0.026;
      parts.push(box('bone', [0, y, -0.055], [w, 0.027, 0.045]),
        ...[-1, 1].map(s => box('bone', [s*w/2, y, 0], [0.027, 0.027, 0.14])));
    }
  } else {
    parts.push(box('cloth', [0, 1.21, 0], [0.38, 0.42, 0.21]),
      box('dark', [0, 0.95, 0], [0.3, 0.12, 0.19]),
      sphere('skin', [0, 1.64, 0], [0.115, 0.145, 0.105]),
      box('dark', [0, 1.745, 0.005], [0.21, 0.06, 0.19]),
      box('black', [-0.043, 1.66, -0.098], [0.023, 0.025, 0.014]),
      box('black', [0.043, 1.66, -0.098], [0.023, 0.025, 0.014]),
      box('skin', [0, 1.61, -0.11], [0.032, 0.045, 0.035]));
  }
  return parts;
}
export const models = [
  model('pistol', 'Pistol', 'Weapons', 'A compact prop pistol with a slide, grip, sights and trigger guard. Static visual; no firing behavior.', [
    box('dark', [0, 0.195, -0.045], [0.043, 0.055, 0.22]),
    box('steel', [0, 0.23, -0.045], [0.047, 0.035, 0.23]),
    box('wood', [0, 0.09, 0.035], [0.041, 0.14, 0.055], [-12, 0, 0]),
    box('dark', [0, 0.115, -0.025], [0.014, 0.014, 0.085]),
    box('dark', [0, 0.145, -0.065], [0.014, 0.06, 0.013]),
    box('steel', [0, 0.155, -0.02], [0.01, 0.037, 0.012], [-20, 0, 0]),
    box('black', [0, 0.263, -0.135], [0.01, 0.03, 0.012]),
    box('black', [0, 0.255, 0.055], [0.026, 0.02, 0.014]),
    cylinder('black', [0, 0.226, -0.164], [0.012, 0.012, 0.003], [90, 0, 0]),
  ]),
  model('rifle', 'Rifle', 'Weapons', 'A wood-stock long gun for distant silhouettes and early weapon prototypes. Barrel faces -Z.', [
    box('wood', [0, 0.16, 0.3], [0.065, 0.15, 0.27], [-8, 0, 0]),
    box('dark', [0, 0.2, 0.04], [0.065, 0.075, 0.3]),
    box('wood', [0, 0.16, -0.23], [0.065, 0.07, 0.28]),
    cylinder('steel', [0, 0.215, -0.29], [0.021, 0.021, 0.65], [90, 0, 0]),
    box('dark', [0, 0.105, 0.035], [0.04, 0.12, 0.06], [-15, 0, 0]),
    box('dark', [0, 0.1, -0.04], [0.012, 0.014, 0.11]),
    box('dark', [0, 0.135, -0.09], [0.012, 0.075, 0.014]),
    box('dark', [0, 0.255, -0.55], [0.014, 0.07, 0.018]),
  ]),
  model('sword', 'Sword', 'Weapons', 'A straight double-edged sword with a pointed tip, crossguard and leather-colored grip.', [
    box('wood', [0, 0.16, 0], [0.038, 0.2, 0.038]),
    sphere('gold', [0, 0.045, 0], [0.04, 0.04, 0.04]),
    box('gold', [0, 0.28, 0], [0.29, 0.045, 0.055]),
    box('steel', [0, 0.63, 0], [0.075, 0.66, 0.023]),
    cone('steel', [0, 1.025, 0], [0.053, 0.13], [0, 45, 0]),
  ]),
  model('axe', 'Axe', 'Weapons', 'A simple hand axe with a broad steel head and wooden handle.', [
    cylinder('wood', [0, 0.34, 0], [0.025, 0.032, 0.68]),
    box('steel', [0.075, 0.59, 0], [0.21, 0.13, 0.045]),
    box('steel', [0.19, 0.59, 0], [0.06, 0.2, 0.025]),
    box('dark', [-0.045, 0.59, 0], [0.06, 0.09, 0.065]),
  ]),
  model('person', 'Person', 'Characters', 'A 1.8 m low-poly standing person. Separate-looking limb segments, but no rig or animation.', humanoid()),
  model('skeleton', 'Skeleton', 'Characters', 'A stylized standing skeleton with skull, eye sockets, ribs, spine and segmented limbs. Static, unrigged blockout.', humanoid(true)),
  model('table', 'Table', 'Furniture', 'A 1.4 × 0.8 m table with a 0.76 m top height.', [
    box('wood', [0, 0.72, 0], [1.4, 0.08, 0.8]), ...legs(0.57, 0.27, 0.68, 0.09),
    box('trim', [0, 0.62, -0.31], [1.2, 0.12, 0.05]),
    box('trim', [0, 0.62, 0.31], [1.2, 0.12, 0.05]),
  ]),
  model('chair', 'Chair', 'Furniture', 'A wooden chair with a 0.46 m seat and an open slatted back. Faces -Z.', [
    box('wood', [0, 0.43, 0], [0.46, 0.06, 0.46]), ...legs(0.18, 0.18, 0.4, 0.055),
    box('wood', [-0.18, 0.73, 0.18], [0.055, 0.6, 0.055]),
    box('wood', [0.18, 0.73, 0.18], [0.055, 0.6, 0.055]),
    box('trim', [0, 0.96, 0.18], [0.41, 0.11, 0.045]),
    box('trim', [0, 0.77, 0.18], [0.41, 0.08, 0.045]),
  ]),
  model('door', 'Door + frame', 'Building', 'A 0.9 × 2.05 m door in a freestanding frame, with raised panels and knobs. Static, no hinge behavior.', [
    box('wood', [0, 1.025, 0], [0.9, 2.05, 0.065]),
    ...[-1, 1].map(s => box('trim', [s*0.51, 1.075, 0], [0.12, 2.15, 0.15])),
    box('trim', [0, 2.13, 0], [1.14, 0.12, 0.15]),
    box('trim', [0, 1.53, -0.043], [0.66, 0.68, 0.027]),
    box('trim', [0, 0.55, -0.043], [0.66, 0.68, 0.027]),
    sphere('gold', [0.34, 1, -0.095], [0.035, 0.035, 0.035]),
    sphere('gold', [0.34, 1, 0.095], [0.035, 0.035, 0.035]),
  ]),
  model('wall', 'Wall section', 'Building', 'A 2 × 2.5 m wall block, 0.16 m thick, with a contrasting baseboard.', [
    box('stone', [0, 1.25, 0], [2, 2.5, 0.16]),
    box('dark', [0, 0.09, 0], [2, 0.18, 0.2]),
  ]),
  model('floor', 'Floor tile', 'Building', 'A 2 × 2 m reusable floor slab, 0.1 m thick.', [
    box('stone', [0, 0.05, 0], [2, 0.1, 2]),
    box('dark', [0, 0.102, 0], [0.012, 0.004, 2]),
    box('dark', [0, 0.102, 0], [2, 0.004, 0.012]),
  ]),
  model('pillar', 'Stone pillar', 'Building', 'A 2.4 m octagonal column with a square base and capital.', [
    box('stone', [0, 0.1, 0], [0.65, 0.2, 0.65]),
    cylinder('stone', [0, 1.2, 0], [0.22, 0.26, 2]),
    box('stone', [0, 2.3, 0], [0.65, 0.2, 0.65]),
  ]),
  model('crate', 'Crate', 'Props', 'A half-metre wooden shipping crate with framing and diagonal braces.', [
    box('wood', [0, 0.25, 0], [0.5, 0.5, 0.5]),
    ...[-1, 1].flatMap(s => [
      box('trim', [s*0.21, 0.25, 0], [0.07, 0.5, 0.54]),
      box('trim', [0, 0.25+s*0.21, 0], [0.54, 0.07, 0.54]),
      box('trim', [0, 0.25, s*0.265], [0.055, 0.58, 0.025], [0, 0, -38]),
    ]),
  ]),
  model('barrel', 'Barrel', 'Props', 'A twelve-sided wooden barrel with three dark metal hoops and a lid.', [
    cylinder('wood', [0, 0.35, 0], [0.25, 0.25, 0.7]),
    ...[0.08, 0.35, 0.62].map(y => cylinder('dark', [0, y, 0], [0.26, 0.26, 0.045])),
    cylinder('trim', [0, 0.704, 0], [0.23, 0.23, 0.015]),
  ]),
];
export const categories = ['All', ...new Set(models.map(m => m.category))];
export function filterModels(category = 'All', query = '') {
  const term = query.trim().toLowerCase();
  return models.filter(m => (category === 'All' || m.category === category) &&
    `${m.name} ${m.category} ${m.description}`.toLowerCase().includes(term));
}
