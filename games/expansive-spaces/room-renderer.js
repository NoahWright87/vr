const THREE = AFRAME.THREE;

// Static room shells have no interaction colliders. All walls/door frames share
// two instanced draws; each floor keeps its own mesh for cheap material swaps.
export function buildRoomMeshes(layout) {
  const group = new THREE.Group(), floors = new Map(), outlines = new Map();
  const unitBox = new THREE.BoxGeometry(1, 1, 1), matrix = new THREE.Matrix4();
  const inactive = new THREE.MeshStandardMaterial({ color: '#b6c3d2', roughness: 1 });
  const active = new THREE.MeshStandardMaterial({ color: '#9cefc5', emissive: '#185637', emissiveIntensity: .45, roughness: 1 });
  const outlineMaterial = new THREE.LineBasicMaterial({ color: '#8ff0ba' });
  const solidBoxes = [], trimBoxes = [], height = 2.7, thickness = .08;
  const box = (list, w, h, d, x, y, z) => list.push({ w, h, d, x, y, z });
  const edgeBox = (list, edge, h, y, depth) => box(list,
    Math.abs(edge.b.x - edge.a.x) + depth, h, Math.abs(edge.b.z - edge.a.z) + depth,
    (edge.a.x + edge.b.x) / 2, y, (edge.a.z + edge.b.z) / 2);
  const foyer = layout.rooms[0].bounds;
  for (const wall of layout.walls) {
    // Keep the original scope experiment's windows on the foyer's east wall.
    if (wall.roomId === 'space-foyer' && Math.abs(wall.a.x - foyer.maxX) < 1e-6 && Math.abs(wall.b.x - foyer.maxX) < 1e-6) continue;
    edgeBox(solidBoxes, wall, height, height / 2, thickness);
    edgeBox(trimBoxes, wall, .08, .04, .1);
  }
  for (const door of layout.lintels) {
    edgeBox(solidBoxes, door, .45, height - .225, thickness);
    edgeBox(trimBoxes, door, .06, 2.25, .12);
    for (const p of [door.a, door.b]) box(trimBoxes, .1, 2.25, .1, p.x, 1.125, p.z);
  }
  const opening = Math.min(3.6, foyer.depth * .8), side = (foyer.depth - opening) / 2;
  box(solidBoxes, thickness, .8, opening, foyer.maxX, .4, foyer.centerZ);
  box(solidBoxes, thickness, .6, opening, foyer.maxX, 2.4, foyer.centerZ);
  for (const sign of [-1, 1]) box(solidBoxes, thickness, height, side, foyer.maxX, height / 2,
    foyer.centerZ + sign * (opening / 2 + side / 2));
  for (const offset of [-opening / 2, -opening / 6, opening / 6, opening / 2])
    box(trimBoxes, .12, 1.3, .055, foyer.maxX, 1.45, foyer.centerZ + offset);
  for (const y of [.8, 2.1]) box(trimBoxes, .12, .06, opening, foyer.maxX, y, foyer.centerZ);
  const instanced = (boxes, color) => {
    const mesh = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ color, roughness: 1 }), boxes.length);
    boxes.forEach((b, i) => { matrix.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z); mesh.setMatrixAt(i, matrix); });
    mesh.instanceMatrix.needsUpdate = true; group.add(mesh); return mesh;
  };
  instanced(solidBoxes, '#70849d'); instanced(trimBoxes, '#263550');
  const ceiling = new THREE.Group(), ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#b2bed0', roughness: 1, side: THREE.DoubleSide });
  group.add(ceiling);
  // Only simple floor polygons are triangulated, once per layout rebuild.
  const ceilingPositions = [];
  for (const room of layout.rooms) {
    const shape = new THREE.Shape(room.points.map(p => new THREE.Vector2(p.x, -p.z)));
    const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geometry, inactive); group.add(floor); floors.set(room.id, floor);
    const flat = geometry.toNonIndexed(), positions = flat.attributes.position;
    for (let i = 0; i < positions.count; i++) ceilingPositions.push(positions.getX(i), height, positions.getZ(i));
    flat.dispose();
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(room.points.map(p => new THREE.Vector3(p.x, .012, p.z))), outlineMaterial);
    line.visible = false; group.add(line); outlines.set(room.id, line);
  }
  const roofGeometry = new THREE.BufferGeometry();
  roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ceilingPositions, 3)); roofGeometry.computeVertexNormals();
  ceiling.add(new THREE.Mesh(roofGeometry, ceilingMaterial));
  return { group, floors, outlines, ceiling, inactive, active };
}
