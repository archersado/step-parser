import { Box3, Vector3 } from 'three';

// Ported from engine-checker-fe/src/components/3DModel/explosion.tsx:
// one device layer, X-axis separation, nearest device fixed, staggered motion.
export function createExplosion(nodes, assemblyCenter, baseUnitDistance) {
  const parts = nodes.map((node) => {
    const center = new Vector3();
    let meshes = 0;
    node.updateWorldMatrix(true, true);
    node.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.computeBoundingBox();
      center.add(child.localToWorld(child.geometry.boundingBox.getCenter(new Vector3())));
      meshes++;
    });
    if (meshes) center.divideScalar(meshes);
    else new Box3().setFromObject(node).getCenter(center);
    return { node, origin: node.position.clone(), worldOrigin: node.getWorldPosition(new Vector3()),
      offset: new Vector3(), center, distance: center.distanceTo(assemblyCenter),
      positive: center.x >= assemblyCenter.x, delay: 0 };
  }).sort((a, b) => a.distance - b.distance);

  parts.forEach((part, index) => {
    if (index === 0) return;
    const rank = index / (parts.length - 1);
    let factor = 1 - (1 - rank) ** 3;
    if (rank < 0.3) factor = Math.min(1, factor * (1 + 0.5 * (1 - rank / 0.3)));
    const boost = rank < 0.2 ? 1 + 0.5 * (1 - rank / 0.2) : 1;
    const distance = Math.max(baseUnitDistance * 0.8 * factor * 1.2 * boost, baseUnitDistance * 0.5);
    part.offset.x = (part.positive ? 1 : -1) * distance;
  });
  for (const positive of [true, false]) {
    const side = parts.filter((part) => part.positive === positive);
    side.forEach((part, index) => {
      part.delay = (index * 0.5 / 3 * (index / side.length < 0.3 ? 0.5 : 1)
        + (positive ? 0 : 0.5 / 4)) * 1000;
    });
  }
  return parts;
}

export function applyExplosion(parts, factor, elapsed = Infinity, from = 0) {
  for (const part of parts) {
    let value = factor;
    if (Number.isFinite(elapsed)) {
      const progress = Math.max(0, Math.min(1, (elapsed - (factor > from ? part.delay : 0)) / 1500));
      const eased = factor > from ? 1 - (1 - progress) ** 3 : progress ** 3;
      value = from + (factor - from) * eased;
    }
    if (value === 0) part.node.position.copy(part.origin);
    else part.node.position.copy(part.node.parent.worldToLocal(
      part.worldOrigin.clone().addScaledVector(part.offset, value),
    ));
    part.node.updateWorldMatrix(true, false);
  }
}

// Match index.tsx's yellow selection while preserving original materials.
export function highlightObject(object, material) {
  const originals = new Map();
  object?.traverse((node) => {
    if (!node.isMesh) return;
    originals.set(node, node.material);
    node.material = Array.isArray(node.material) ? node.material.map(() => material) : material;
  });
  return () => { for (const [node, original] of originals) node.material = original; };
}
