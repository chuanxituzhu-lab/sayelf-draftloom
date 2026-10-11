import * as THREE from 'three';

const PALETTES = Object.freeze({
  nature: { ink: '#173f32', mint: '#72c7a1', gold: '#d2aa62', background: ['#ecf5e9', '#c9e3d7'] },
  technology: { ink: '#153d4d', mint: '#55c6be', gold: '#e4bd70', background: ['#e8f0f4', '#c1d9e2'] },
  work: { ink: '#3c384e', mint: '#a18bd1', gold: '#e4ab6c', background: ['#f1eef6', '#d9d0e7'] },
  general: { ink: '#30434b', mint: '#61b9aa', gold: '#e0b674', background: ['#eef2ee', '#d2e0d8'] }
});

function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text || '')) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return hash >>> 0;
}

export function classifyArticleVisual(text = '') {
  const value = String(text || '').toLowerCase();
  if (/森林|自然|山野|植物|生态|绿色|树木|风景/.test(value)) return 'nature';
  if (/ai|人工智能|大模型|模型|科技|算法|智能|代码|数据|机器人|芯片|数字化|codex|claude|chatgpt|workbuddy/.test(value)) return 'technology';
  if (/工作|团队|流程|效率|组织|创业|商业|管理|方法|实践|成长/.test(value)) return 'work';
  return 'general';
}

function addFloatingObjects(scene, category, palette, seed) {
  const group = new THREE.Group();
  scene.add(group);
  const mainMaterial = new THREE.MeshStandardMaterial({ color: palette.ink, roughness: 0.34, metalness: 0.18 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: palette.mint, roughness: 0.28, metalness: 0.12 });
  const warmMaterial = new THREE.MeshStandardMaterial({ color: palette.gold, roughness: 0.34, metalness: 0.2 });

  if (category === 'nature') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.7, 12), mainMaterial);
    trunk.position.y = -0.1; group.add(trunk);
    [[-0.55, 0.7, 0.62], [0.05, 1.02, 0.8], [0.58, 0.62, 0.67]].forEach(([x, y, scale], index) => {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(scale, 2), index === 1 ? warmMaterial : accentMaterial);
      leaf.position.set(x, y, index === 0 ? 0.1 : -0.05); group.add(leaf);
    });
    const ground = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.07, 10, 80), accentMaterial);
    ground.rotation.x = Math.PI / 2; ground.position.y = -1.15; group.add(ground);
  } else if (category === 'work') {
    for (let index = 0; index < 4; index += 1) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), index % 2 ? accentMaterial : mainMaterial);
      cube.position.set((index - 1.5) * 0.7, ((seed >>> (index * 3)) % 5) * 0.22 - 0.35, index % 2 ? 0.15 : -0.2);
      cube.rotation.set(0.24 + index * 0.1, 0.35, 0.16); group.add(cube);
    }
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.055, 8, 100), warmMaterial);
    orbit.rotation.set(0.6, -0.2, 0.35); group.add(orbit);
  } else {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 2), mainMaterial);
    core.position.x = -0.08; group.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.07, 10, 100), accentMaterial);
    ring.rotation.set(0.9, 0.3, -0.35); group.add(ring);
    const satellite = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), warmMaterial);
    satellite.position.set(1.45, 0.75, 0.35); group.add(satellite);
    if (category === 'technology') {
      const secondRing = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.025, 6, 100), warmMaterial);
      secondRing.rotation.set(1.2, -0.25, 0.5); group.add(secondRing);
    }
  }
  group.rotation.set(0.12, ((seed % 1000) / 1000 - 0.5) * 0.5, -0.1);
  return group;
}

function paintBackground(ctx, width, height, colors, seed) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(width * (0.76 + (seed % 7) * 0.01), height * 0.18, width * 0.22, height * 0.42, -0.45, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

export async function createThreeArticleImage({ text = '', title = '', width = 900, height = 506, palette = 'ral-inspired' } = {}) {
  const topic = classifyArticleVisual(`${title}\n${text}`);
  const colors = PALETTES[topic];
  const seed = hashText(`${title}|${text}`);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('本机浏览器不支持 Canvas，无法生成主题图');
  paintBackground(context, width, height, colors.background, seed);

  let renderer;
  const geometries = [];
  const materials = [];
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    camera.position.set(0, 0.2, 8.8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6c796f, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.1); keyLight.position.set(-3, 5, 7); scene.add(keyLight);
    const fillLight = new THREE.PointLight(colors.mint, 28, 18); fillLight.position.set(3.2, -0.4, 4); scene.add(fillLight);
    addFloatingObjects(scene, topic, colors, seed);
    scene.traverse(object => {
      if (object.geometry) geometries.push(object.geometry);
      if (object.material) materials.push(...(Array.isArray(object.material) ? object.material : [object.material]));
    });
    renderer.render(scene, camera);
    context.drawImage(renderer.domElement, 0, 0, width, height);
    // A restrained edge treatment keeps the generated image clean on both white and dark WeChat themes.
    const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, width * 0.72);
    vignette.addColorStop(0, 'rgba(255,255,255,0)'); vignette.addColorStop(1, 'rgba(22,42,38,0.12)');
    context.fillStyle = vignette; context.fillRect(0, 0, width, height);
    return {
      id: `three-${seed.toString(16)}-${Date.now().toString(36)}`,
      name: `${title || '文章'}-3D主题图.png`.slice(0, 80),
      alt: `${topic === 'nature' ? '自然生态' : topic === 'technology' ? '科技创新' : topic === 'work' ? '工作实践' : '主题'}三维视觉插图`,
      type: 'image/png', size: 0, width, height,
      dataUrl: canvas.toDataURL('image/png'), generated: true,
      source: 'draftloom:three-local', renderer: `three.js-${THREE.REVISION}`,
      visualTopic: topic, palette: palette === 'ral-inspired' ? 'ral-inspired' : 'default',
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    if (/webgl|context|renderer/i.test(error.message)) throw new Error('当前浏览器未开放本机 WebGL；请更新浏览器或切换到内置 SVG 主题图功能');
    throw new Error(`本地 3D 主题图生成失败：${error.message}`);
  } finally {
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    renderer?.dispose();
  }
}
