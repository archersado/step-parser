import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createExplosion, applyExplosion } from './model.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f3f6fa');
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.2;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room).texture;
room.dispose();
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8794a7, 2));
const grid = new THREE.GridHelper(10, 20, 0xd4dce8, 0xe3e9f1);
scene.add(grid);
const highlight = new THREE.Box3Helper(new THREE.Box3(), 0x397bff);
highlight.visible = false;
scene.add(highlight);
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
  selected = object;
  $('selection').hidden = !object;
  $('selected-name').textContent = object ? rowMap.get(object)?.name ?? object.name : '';
  for (const [node, entry] of rowMap) entry.row.classList.toggle('active', node === object);
}

function fit(preserveDirection = false, target = model) {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(target);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const viewRadius = Math.max(sphere.radius, 0.001);
  const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
  const distance = viewRadius / Math.sin(halfFov) * 1.2;
  const direction = preserveDirection ? camera.position.clone().sub(controls.target) : new THREE.Vector3(1, 0.65, 1);
  controls.target.copy(center);
  camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
  camera.near = Math.max(viewRadius / 1000, 0.000001);
  camera.far = Math.max(distance * 20, viewRadius * 100);
  camera.updateProjectionMatrix();
  controls.minDistance = viewRadius * 0.02;
  controls.maxDistance = camera.far / 2;
  controls.update();
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
  grid.position.set(center.x, box.min.y - radius * 0.015, center.z);
  grid.scale.setScalar(radius * 0.5);
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
  parts = createExplosion(parts, center, radius);
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
  $('explode-hint').textContent = parts.length < 2 ? '当前模型只有一个设备单元，无需爆裂。' : '仅展开根装配的直属设备，内部零件整体移动；收起恢复装配位置。';
  fit();
  status('已加载 · 可旋转、缩放和选择');
  document.body.dataset.loaded = 'true';
}

async function load(files, modelUrl = '../.local-build/piggy.glb') {
  if (loading) return;
  loading = true;
  $('sample').disabled = $('open').disabled = true;
  document.body.dataset.loaded = 'false';
  status('正在加载模型…');
  const urls = [];
  const draco = new DRACOLoader().setWorkerLimit(2);
  draco.setDecoderPath(new URL('./node_modules/three/examples/jsm/libs/draco/gltf/', import.meta.url).href);
  const started = performance.now();
  try {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    let data, filename, bytes;
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
      data = await response.arrayBuffer();
      bytes = data.byteLength;
    }
    const gltf = await loader.parseAsync(data, '');
    show(gltf, filename, bytes, started);
  } catch (error) {
    console.error(error);
    status(`加载失败：${error.message || error.error || String(error)}`, true);
  } finally {
    draco.dispose();
    urls.forEach((url) => URL.revokeObjectURL(url));
    loading = false;
    $('sample').disabled = $('open').disabled = false;
  }
}

$('open').onclick = () => $('files').click();
$('files').onchange = () => { if ($('files').files.length) load([...$('files').files]); $('files').value = ''; };
$('sample').onclick = () => load();
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
  wireframe = !wireframe;
  $('wire').setAttribute('aria-pressed', wireframe);
  model?.traverse((node) => { if (node.isMesh) for (const material of [].concat(node.material)) material.wireframe = wireframe; });
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
  fit(true);
}
$('explode-toggle').onclick = () => {
  const to = (animation?.to ?? explosion) > 0 ? 0 : 1;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { animation = null; setExplosion(to); }
  else animation = { from: explosion, to, start: performance.now() };
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
    const progress = Math.min((performance.now() - animation.start) / 450, 1);
    const eased = progress * progress * (3 - 2 * progress);
    setExplosion(THREE.MathUtils.lerp(animation.from, animation.to, eased));
    if (progress === 1) animation = null;
  }
  controls.update();
  highlight.visible = !!selected;
  if (selected) highlight.box.setFromObject(selected);
  renderer.render(scene, camera);
});
load(null, new URLSearchParams(location.search).get('model') || undefined);
