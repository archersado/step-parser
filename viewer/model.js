import { Box3, Vector3 } from 'three';

export function createExplosion(nodes, assemblyCenter, distance) {
  return nodes.map((node) => ({
    node,
    origin: node.position.clone(),
    worldOrigin: node.getWorldPosition(new Vector3()),
    offset: new Box3().setFromObject(node).getCenter(new Vector3())
      .sub(assemblyCenter).normalize().multiplyScalar(distance),
  }));
}

// Parent-first traversal compensates for already-moved mesh ancestors.
export function applyExplosion(parts, factor) {
  for (const part of parts) {
    if (factor === 0) part.node.position.copy(part.origin);
    else part.node.position.copy(part.node.parent.worldToLocal(
      part.worldOrigin.clone().addScaledVector(part.offset, factor),
    ));
    part.node.updateWorldMatrix(true, false);
  }
}
