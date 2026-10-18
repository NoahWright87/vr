// Lightweight box contacts, intentionally bounded to the Toybox's small scene.
// These are conservative model bounds, not detailed mesh/hinge physics.
export function resolveToyContacts(toys, gravity) {
  const THREE = AFRAME.THREE;
  const bodies = toys.map(el => {
    const body = el.components['simple-grabbable'];
    const h = body.data.halfExtents;
    el.object3D.updateWorldMatrix(true, false);
    const bounds = new THREE.Box3(new THREE.Vector3(-h.x,-h.y,-h.z), new THREE.Vector3(h.x,h.y,h.z)).applyMatrix4(el.object3D.matrixWorld);
    return { el, body, bounds, center: bounds.getCenter(new THREE.Vector3()) };
  });
  for (let i = 0; i < bodies.length; i++) for (let j = i+1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j];
    if (a.body.state === 'held' || b.body.state === 'held') continue;
    if (!a.bounds.intersectsBox(b.bounds)) continue;
    const overlap = ['x','y','z'].map(axis => Math.min(a.bounds.max[axis]-b.bounds.min[axis], b.bounds.max[axis]-a.bounds.min[axis]));
    const index = overlap.indexOf(Math.min(...overlap));
    if (overlap[index] <= 0) continue;
    const axis = ['x','y','z'][index];
    const sign = a.center[axis] < b.center[axis] ? -1 : 1;
    // Under gravity, let an upper toy rest on a lower toy without shoving
    // the supporting toy into the floor. Lateral contacts share displacement.
    if (gravity && axis === 'y') {
      const top = sign > 0 ? a : b;
      top.el.object3D.position.y += overlap[index]+0.001;
      if (top.body.velocity.y < 0) top.body.velocity.y = 0;
      top.body.velocity.x *= 0.92; top.body.velocity.z *= 0.92;
      top.body.angularVelocity.multiplyScalar(0.8);
    } else {
      a.el.object3D.position[axis] += sign*(overlap[index]/2+0.001);
      b.el.object3D.position[axis] -= sign*(overlap[index]/2+0.001);
      const av = a.body.velocity[axis], bv = b.body.velocity[axis];
      if ((av-bv)*sign < 0) {
        a.body.velocity[axis] = bv*0.5; b.body.velocity[axis] = av*0.5;
      }
    }
  }
}
