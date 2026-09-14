import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createExplosion, applyExplosion, highlightObject } from './model.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5d6d7e);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.8;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.2;
// Lighting from engine-checker-fe/src/components/3DModel/index.tsx.
scene.add(new THREE.AmbientLight(0x707070, 2.5));
for (const [intensity, position] of [[2, [0, 20, 10]], [0.8, [-15, 10, 15]], [0.4, [0, -10, 5]]]) {
  const light = new THREE.DirectionalLight(0xffffff, intensity);
  light.position.set(...position);
  scene.add(light);
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
  color: 0x566573, metalness: 0.1, roughness: 0.8, transparent: true, opacity: 0.7,
}));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const selectionMaterial = new THREE.MeshStandardMaterial({
  color: 0xffff00, metalness: 0.9, roughness: 0.1, emissive: 0x001122, emissiveIntensity: 0.2,
});
let restoreMaterials = () => {}, cameraAnimation = null, initialCamera;
let model, selected, loading = false, entries = [], parts = [];
let radius = 1;
let wireframe = false;
let explosion = 0, animation = null;
const rowMap = new Map();

function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function select(object) {
  restoreMaterials();
  selected = object;
  restoreMaterials = highlightObject(object, selectionMaterial);
  $('selection').hidden = !object;
  $('selected-name').textContent = object ? rowMap.get(object)?.name ?? object.name : '';
  for (const [node, entry] of rowMap) entry.row.classList.toggle('active', node === object);
}

function fit(preserveDirection = false, target = model, smooth = false) {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(target);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const viewRadius = Math.max(sphere.radius, 0.001);
  const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
  const distance = viewRadius / Math.sin(halfFov) * 1.2;
  const direction = preserveDirection ? camera.position.clone().sub(controls.target) : new THREE.Vector3(1, 0.65, 1);
  const position = center.clone().add(direction.normalize().multiplyScalar(distance));
  moveCamera(position, center, smooth);
  camera.near = Math.max(viewRadius / 1000, 0.000001);
  camera.far = Math.max(distance * 20, viewRadius * 100);
  camera.updateProjectionMatrix();
  controls.minDistance = viewRadius * 0.02;
  controls.maxDistance = camera.far / 2;
  controls.update();
}

function moveCamera(position, target, smooth = true) {
  cameraAnimation = null;
  if (smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cameraAnimation = { from: camera.position.clone(), targetFrom: controls.target.clone(),
      position, target, start: performance.now() };
  } else { camera.position.copy(position); controls.target.copy(target); }
}

function dispose(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.material) for (const material of [].concat(node.material)) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) { texture.source.data?.close?.(); texture.dispose(); }
}

function show(gltf, filename, bytes, started) {
  const next = gltf.scene;
  let triangles = 0;
  next.traverse((node) => {
    if (!node.isMesh) return;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    for (const material of [].concat(node.material)) material.wireframe = wireframe;
  });
  const box = new THREE.Box3().setFromObject(next);
  if (!triangles || box.isEmpty()) { dispose(next); throw new Error('模型中没有可显示的三角网格'); }
  select(null);
  if (model) { scene.remove(model); dispose(model); }
  model = next;
  scene.add(model);
  const center = box.getCenter(new THREE.Vector3());
  radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
  ground.position.set(center.x, box.min.y - radius * 0.015, center.z);
  ground.scale.setScalar(radius * 3);
  entries = [];
  parts = [];
  rowMap.clear();
  $('tree').replaceChildren();
  model.traverse((node) => {
    const index = gltf.parser.associations.get(node)?.nodes;
    if (index === undefined) return;
    let depth = 0;
    for (let parent = node.parent; parent && parent !== model; parent = parent.parent) depth++;
    if (depth > 1) return;
    const name = gltf.parser.json.nodes[index].name || node.name || `节点 ${index + 1}`;
    const row = document.createElement('div');
    row.className = 'node';
    row.style.paddingLeft = `${Math.min(depth, 8) * 12}px`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = node.visible;
    checkbox.setAttribute('aria-label', `显示 ${name}`);
    checkbox.onchange = () => { node.visible = checkbox.checked; select(null); };
    const icon = document.createElement('span');
    icon.className = 'node-icon';
    icon.textContent = '◇';
    const button = document.createElement('button');
    button.textContent = name;
    button.title = name;
    button.onclick = () => select(node);
    row.append(checkbox, icon, button);
    $('tree').append(row);
    rowMap.set(node, { name, row, checkbox });
    entries.push(node);
    if ((depth === 1 || (depth === 0 && !gltf.parser.json.nodes[index].children?.length)) && !new THREE.Box3().setFromObject(node).isEmpty()) {
      parts.push(node);
    }
  });
  const baseUnitDistance = 10 ** Math.floor(Math.log10(box.getSize(new THREE.Vector3()).length() || 1));
  parts = createExplosion(parts, center, baseUnitDistance);
  $('filename').textContent = filename;
  $('size').textContent = `${(bytes / 1e6).toFixed(2)} MB`;
  $('parts').textContent = parts.length.toLocaleString();
  $('part-count').textContent = `${entries.length} 节点`;
  $('triangles').textContent = Math.round(triangles).toLocaleString();
  $('elapsed').textContent = `${((performance.now() - started) / 1000).toFixed(2)} s`;
  $('explode').value = 0;
  $('explode-value').textContent = '0%';
  explosion = 0;
  animation = null;
  $('explode-toggle').textContent = '一键爆裂';
  $('explode-toggle').setAttribute('aria-pressed', 'false');
  $('explode-toggle').disabled = $('explode').disabled = parts.length < 2;
  $('explode-hint').textContent = parts.length < 2 ? '当前模型只有一个设备单元，无需爆裂。' : '沿 X 轴分批展开直属设备，中心设备固定；内部零件整体移动。';
  fit();
  initialCamera = { position: camera.position.clone(), target: controls.target.clone() };
  status('已加载 · 可旋转、缩放和选择');
  document.body.dataset.loaded = 'true';
}

async function load(files, modelUrl = '../.local-build/models/assembly-web.glb') {
  if (loading) return;
  loading = true;
  $('assembly').disabled = $('sample').disabled = $('open').disabled = true;
  document.body.dataset.loaded = 'false';
  status('正在加载模型…');
  const urls = [];
  const draco = new DRACOLoader().setWorkerLimit(2);
  draco.setDecoderPath(new URL('./node_modules/three/examples/jsm/libs/draco/gltf/', import.meta.url).href);
  const started = performance.now();
  try {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    let data, filename, bytes, resourcePath = '';
    if (files) {
      const models = files.filter((file) => /\.(glb|gltf)$/i.test(file.name));
      if (models.length !== 1) throw new Error('请选择一个 GLB 或 glTF 模型，以及它需要的资源文件');
      const resources = new Map(files.map((file) => [file.name, file]));
      if (resources.size !== files.length) throw new Error('资源文件名重复，请分别加载模型');
      manager.setURLModifier((url) => {
        if (/^(data:|blob:)/.test(url)) return url;
        const name = decodeURIComponent(url.split('/').pop());
        const file = resources.get(name);
        if (!file) throw new Error(`缺少资源 ${name}，请和模型一起选择`);
        const blob = URL.createObjectURL(file);
        urls.push(blob);
        return blob;
      });
      filename = models[0].name;
      bytes = files.reduce((sum, file) => sum + file.size, 0);
      data = await models[0].arrayBuffer();
    } else {
      const url = new URL(modelUrl, location.href);
      if (url.origin !== location.origin) throw new Error('只支持当前本地服务中的模型地址');
      filename = decodeURIComponent(url.pathname.split('/').pop());
      const response = await fetch(url);
      if (!response.ok) throw new Error('找不到 GLB，请先运行转换命令');
      resourcePath = new URL('.', url).href;
      const total = Number(response.headers.get('content-length'));
      if (response.body && total > 0) {
        const reader = response.body.getReader(), chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); received += value.length;
          status(`正在下载模型… ${Math.min(100, Math.round(received / total * 100))}%`);
        }
        const merged = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
        data = merged.buffer;
      } else data = await response.arrayBuffer();
      bytes = data.byteLength;
    }
    status('正在解码并准备模型…');
    const gltf = await loader.parseAsync(data, resourcePath);
    show(gltf, filename, bytes, started);
  } catch (error) {
    console.error(error);
    status(`加载失败：${error.message || error.error || String(error)}`, true);
  } finally {
    draco.dispose();
    urls.forEach((url) => URL.revokeObjectURL(url));
    loading = false;
    $('assembly').disabled = $('sample').disabled = $('open').disabled = false;
  }
}

$('open').onclick = () => $('files').click();
$('files').onchange = () => { if ($('files').files.length) load([...$('files').files]); $('files').value = ''; };
$('sample').onclick = () => load(null, '../.local-build/piggy.glb');
$('assembly').onclick = () => load();
$('reset-camera').onclick = () => { if (initialCamera) moveCamera(initialCamera.position, initialCamera.target); };
$('fit').onclick = () => fit();
$('clear').onclick = () => select(null);
$('focus').onclick = () => { if (selected) fit(false, selected); };
$('hide').onclick = () => {
  if (!selected) return;
  selected.visible = false;
  rowMap.get(selected).checkbox.checked = false;
  select(null);
};
$('wire').onclick = () => {
  const object = selected;
  select(null);
  wireframe = !wireframe;
  selectionMaterial.wireframe = wireframe;
  $('wire').setAttribute('aria-pressed', wireframe);
  model?.traverse((node) => { if (node.isMesh) for (const material of [].concat(node.material)) material.wireframe = wireframe; });
  select(object);
};
$('rotate').onclick = () => {
  controls.autoRotate = !controls.autoRotate;
  $('rotate').setAttribute('aria-pressed', controls.autoRotate);
};
function setExplosion(factor) {
  explosion = factor;
  applyExplosion(parts, factor);
  $('explode').value = Math.round(factor * 100);
  $('explode-value').textContent = `${Math.round(factor * 100)}%`;
  $('explode-toggle').textContent = factor > 0 ? '收起零件' : '一键爆裂';
  $('explode-toggle').setAttribute('aria-pressed', factor > 0);
  fit(true, model, true);
}
$('explode-toggle').onclick = () => {
  const to = (animation?.to ?? explosion) > 0 ? 0 : 1;
  if (animation) { applyExplosion(parts, explosion); animation = null; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { animation = null; setExplosion(to); }
  else animation = { from: explosion, to, start: performance.now(),
    duration: 1500 + (to > 0 ? Math.max(0, ...parts.map((part) => part.delay)) : 0) };
};
$('explode').oninput = () => {
  animation = null;
  setExplosion(Number($('explode').value) / 100);
};
$('restore').onclick = () => {
  for (const node of entries) { node.visible = true; rowMap.get(node).checkbox.checked = true; }
  $('explode').value = 0;
  $('explode').oninput();
  select(null);
  fit();
};
const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
let pointerStart;
renderer.domElement.addEventListener('pointerdown', (event) => { pointerStart = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!model || event.button !== 0 || !pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(model, true).find(({ object }) => {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return object.isMesh;
  });
  let node = hit?.object;
  while (node && !rowMap.has(node)) node = node.parent;
  select(node ?? null);
});
new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}).observe(viewport);
renderer.setAnimationLoop(() => {
  if (animation) {
    const elapsed = performance.now() - animation.start;
    const progress = Math.min(elapsed / animation.duration, 1);
    applyExplosion(parts, animation.to, elapsed, animation.from);
    explosion = THREE.MathUtils.lerp(animation.from, animation.to, progress);
    $('explode').value = Math.round(explosion * 100);
    $('explode-value').textContent = `${Math.round(explosion * 100)}%`;
    if (progress === 1) {
      const to = animation.to;
      animation = null;
      setExplosion(to);
      if (to === 0 && initialCamera) moveCamera(initialCamera.position, initialCamera.target);
    }
  }
  if (cameraAnimation) {
    const t = Math.min((performance.now() - cameraAnimation.start) / 800, 1);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    camera.position.lerpVectors(cameraAnimation.from, cameraAnimation.position, eased);
    controls.target.lerpVectors(cameraAnimation.targetFrom, cameraAnimation.target, eased);
    if (t === 1) cameraAnimation = null;
  }
  controls.update();
  renderer.render(scene, camera);
});
load(null, new URLSearchParams(location.search).get('model') || undefined);
