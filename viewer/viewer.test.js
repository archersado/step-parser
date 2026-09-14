import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, Vector3 } from 'three';
import { createExplosion, applyExplosion } from './model.js';

test('explosion preserves distance under rotated and scaled assembly parents', () => {
  const parent = new Group();
  parent.rotation.z = Math.PI / 2;
  parent.scale.set(2, 4, 1);
  const part = new Mesh(new BoxGeometry());
  parent.add(part);
  part.position.set(10, 0, 0);
  const original = part.position.clone();
  const parts = createExplosion([part], new Vector3(), 5);
  assert.ok(part.position.equals(original));
  applyExplosion(parts, 1);
  assert.ok(part.getWorldPosition(new Vector3()).distanceTo(new Vector3(0, 25, 0)) < 1e-8);
  applyExplosion(parts, 0);
  assert.ok(part.position.equals(original));
  part.position.set(0, 0, 0);
  assert.ok(createExplosion([part], new Vector3(), 5)[0].offset.length() < 1e-8);
  part.geometry.dispose();
});

test('nested mesh parts follow their own world offsets and restore without drift', () => {
  const root = new Group();
  const parent = new Mesh(new BoxGeometry());
  const child = new Mesh(new BoxGeometry());
  root.add(parent);
  parent.add(child);
  parent.position.set(10, 0, 0);
  parent.rotation.z = Math.PI / 2;
  parent.scale.set(2, 4, 1);
  child.position.set(3, 0, 0);
  const parts = createExplosion([parent, child], new Vector3(), 5);
  for (const factor of [1, 0.2, 0.8, 0]) {
    applyExplosion(parts, factor);
    for (const part of parts) {
      assert.ok(part.node.getWorldPosition(new Vector3()).distanceTo(
        part.worldOrigin.clone().addScaledVector(part.offset, factor),
      ) < 1e-8);
      if (factor === 0) assert.ok(part.node.position.equals(part.origin));
    }
  }
  parent.geometry.dispose();
  child.geometry.dispose();
});
