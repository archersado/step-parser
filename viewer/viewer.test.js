import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, Vector3, MeshStandardMaterial } from 'three';
import { createExplosion, applyExplosion, highlightObject } from './model.js';

test('reference explosion fixes the nearest device and moves only along world X, with exact restore', () => {
  const parent = new Group();
  parent.rotation.z = Math.PI / 2;
  parent.scale.set(2, 4, 1);
  const geometry = new BoxGeometry();
  const nodes = [0, -2, 4].map((y) => {
    const group = new Group();
    group.position.y = y;
    group.add(new Mesh(geometry));
    parent.add(group);
    return group;
  });
  const childOrigin = nodes[2].children[0].position.clone();
  const parts = createExplosion(nodes, new Vector3(), 5);
  assert.equal(parts[0].offset.length(), 0);
  assert.ok(parts[1].offset.x > 0 && parts[2].offset.x < 0);
  assert.ok(Math.abs(parts[2].offset.x + 4.8) < 1e-8);
  for (const factor of [1, 0.2, 0.8, 0]) {
    applyExplosion(parts, factor);
    for (const part of parts) {
      assert.ok(part.node.getWorldPosition(new Vector3()).distanceTo(
        part.worldOrigin.clone().addScaledVector(part.offset, factor)) < 1e-8);
      if (factor === 0) assert.ok(part.node.position.equals(part.origin));
    }
    assert.ok(nodes[2].children[0].position.equals(childOrigin));
  }
  applyExplosion(parts, 1, 0);
  assert.ok(parts.every((part) => part.node.position.equals(part.origin)));
  applyExplosion(parts, 1, 10000);
  assert.ok(parts[2].node.getWorldPosition(new Vector3()).distanceTo(
    parts[2].worldOrigin.clone().add(parts[2].offset)) < 1e-8);
  applyExplosion(parts, 0, 1500, 1);
  assert.ok(parts.every((part) => part.node.position.equals(part.origin)));
  geometry.dispose();
});

test('single multi-primitive part stays whole; yellow selection restores material arrays', () => {
  const parent = new Group(), device = new Group();
  parent.add(device);
  const original = [new MeshStandardMaterial(), new MeshStandardMaterial()];
  const geometry = new BoxGeometry(), mesh = new Mesh(geometry, original);
  device.add(mesh);
  const parts = createExplosion([device], new Vector3(), 5);
  applyExplosion(parts, 1);
  assert.ok(device.position.equals(new Vector3()));
  const yellow = new MeshStandardMaterial({ color: 0xffff00 });
  const restore = highlightObject(device, yellow);
  assert.deepEqual(mesh.material, [yellow, yellow]);
  restore();
  assert.equal(mesh.material, original);
  original.forEach((material) => material.dispose());
  yellow.dispose(); geometry.dispose();
});
