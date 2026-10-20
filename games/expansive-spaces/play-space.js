// Geometry stays in bounded-floor coordinates. The room transform maps that
// space into A-Frame's current reference space, including recentering/rotation.
export const DEFAULT_WORLD_SCALE = 1.5;

export function sanitizeWorldScale(value) {
  const parsed = value === null || value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(2, parsed)) : DEFAULT_WORLD_SCALE;
}

// Enlarge the virtual footprint around the physical boundary's center. The
// tracked reference frame, player, checker size and physical polygon stay metric.
export function scaledRoomBounds(bounds, worldScale) {
  const scale = sanitizeWorldScale(worldScale);
  const width = bounds.width * scale, depth = bounds.depth * scale;
  return { ...bounds, width, depth,
    minX: bounds.centerX - width / 2, maxX: bounds.centerX + width / 2,
    minZ: bounds.centerZ - depth / 2, maxZ: bounds.centerZ + depth / 2 };
}

export function measureBounds(points) {
  if (!points || points.length < 3) return null;
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.z))) return null;
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minZ = Math.min(...points.map(point => point.z));
  const maxZ = Math.max(...points.map(point => point.z));
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (width < 0.1 || depth < 0.1) return null;
  return { minX, maxX, minZ, maxZ, width, depth, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
}

export function isInsideBoundary(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    // Include points on the guardian edge.
    const cross = (point.x - a.x) * (b.z - a.z) - (point.z - a.z) * (b.x - a.x);
    if (Math.abs(cross) < 1e-7 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) &&
        point.z >= Math.min(a.z, b.z) && point.z <= Math.max(a.z, b.z)) return true;
    if ((a.z > point.z) !== (b.z > point.z) &&
        point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function mapLayout(bounds, width = 512, height = 384, padding = 44) {
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.depth);
  return {
    scale,
    project: point => ({ x: width / 2 + (point.x - bounds.centerX) * scale,
      y: height / 2 + (point.z - bounds.centerZ) * scale }),
  };
}
