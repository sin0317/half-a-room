import {
  AmbientLight,
  BackgroundMode,
  Color,
  PerspectiveCamera,
  createViewer,
  setViewerConfig,
} from '@manycore/aholo-viewer';
import { config } from './config';
import { loadCatalog, renderCatalog } from './catalog';

// 出图模式：?chrome=0 时隐藏界面，只留纯渲染
if (new URLSearchParams(location.search).get('chrome') === '0') {
  document.body.classList.add('no-chrome');
}
import { loadMesh, placeMesh } from './mesh-loader';
import { OrbitController } from './orbit';
import { WalkController } from './walk';
import { loadSplatFile } from './splat-loader';
import type { PackType } from './splat-loader';
import './style.css';

const stage = document.getElementById('stage') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const progressBar = document.getElementById('progress') as HTMLDivElement;
const progressFill = progressBar.querySelector('i') as HTMLElement;

function setStatus(text: string, state: 'idle' | 'loading' | 'ok' | 'error' = 'idle'): void {
  statusText.textContent = text;
  statusText.dataset.state = state;
  document.body.dataset.state = state;
}

function setProgress(ratio: number | null): void {
  if (ratio === null) {
    progressBar.style.display = 'none';
    return;
  }
  progressBar.style.display = 'block';
  progressFill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
}

// ---- 1. 起一个 viewer，装上相机 -------------------------------------------

const viewer = createViewer('half-a-room', stage, {});

const camera = new PerspectiveCamera(config.camera.fov, 1, config.camera.near, config.camera.far);

// 重绘调度：只有脏了才真正 render，静止时不烧 GPU
let needsRender = true;
viewer.requestRenderHandler = () => {
  needsRender = true;
};

setViewerConfig(viewer, {
  pipeline: {
    Background: {
      background: {
        active: BackgroundMode.BasicBackground,
        basic: { color: new Color(config.background) },
      },
      ground: { enabled: false },
    },
    Splatting: { enabled: true },
    TAA: { enabled: false },
  },
});

// ---- 2. 相机与尺寸 --------------------------------------------------------

const upFromUrl = config.upParam ? (config.upParam.split(',').map(Number) as [number, number, number]) : null;
const orbit = new OrbitController(camera, stage, {
  up: upFromUrl ?? [0, 1, 0],
  target: config.camera.target,
  eye: config.camera.eye,
  minRadius: config.camera.minRadius,
  maxRadius: config.camera.maxRadius,
  floorY: config.floorY,
  onChange: () => viewer.requestRender(),
});

// ?cam=ex,ey,ez,tx,ty,tz 覆盖默认机位：保证同一个物件不同版本能用同一机位对比
if (config.camParam) {
  const n = config.camParam.split(',').map(Number);
  if (n.length === 6 && n.every(Number.isFinite)) {
    orbit.setPose([n[0], n[1], n[2]], [n[3], n[4], n[5]]);
  } else {
    console.warn('[half-a-room] ?cam 参数格式不对，应为 6 个数字：ex,ey,ez,tx,ty,tz');
  }
}

// ---- 行走模式：自由走动 ------------------------------------------------
const walker = new WalkController(camera, stage, {
  floorY: config.floorY,
  eyeHeight: config.eyeHeightM / config.metersPerUnit,
  speed: 1.4 / config.metersPerUnit,
  bounds: { x: [-4.4, 4.6], z: [-9.5, 3.4] },
  onChange: () => viewer.requestRender(),
});

let walking = false;
const modeBtn = document.getElementById('mode-toggle') as HTMLButtonElement | null;
const hintEl = document.getElementById('hint-text') as HTMLElement | null;

function setMode(next: 'orbit' | 'walk'): void {
  if (next === 'walk' && !walking) {
    const { eye, target } = orbit.getPose();
    orbit.setEnabled(false);
    walker.enter(eye, target);
    walking = true;
    if (modeBtn) modeBtn.textContent = '回到轨道 · F';
    if (hintEl) hintEl.textContent = '点击画面锁定鼠标 · WASD 走动 · Shift 加速 · Esc 退出';
    setStatus('行走模式 · 自由走动', 'ok');
  } else if (next === 'orbit' && walking) {
    const p = walker.getPose();
    walker.exit();
    orbit.setEnabled(true);
    orbit.setPose(p.eye, p.target);
    walking = false;
    if (modeBtn) modeBtn.textContent = '走进去 · F';
    if (hintEl) hintEl.textContent = '拖动旋转 · 滚轮推拉 · 按 P 复制当前机位';
    if (sceneLoaded) refreshStatus();
  }
}

modeBtn?.addEventListener('click', () => setMode(walking ? 'orbit' : 'walk'));

// 一键回到全景：点完图鉴之后不至于迷路
const resetBtn = document.getElementById('reset-view') as HTMLButtonElement | null;
resetBtn?.addEventListener('click', () => {
  if (walking) setMode('orbit');
  orbit.setPose(config.camera.eye, config.camera.target);
  setStatus('全景', 'ok');
});

viewer.setCamera(camera);

function resize(): void {
  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  viewer.resize({ width, height });
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  viewer.requestRender();
}

window.addEventListener('resize', resize);
resize();

function frame(): void {
  if (needsRender) {
    needsRender = false;
    viewer.render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- 3. 载入场景（没有资产就是纯空场景）-----------------------------------

/**
 * 就绪判定：场景、图鉴、全部网格都到位才算「就绪」。
 * 否则截图/录屏会拍到半成品，评委也会看到假的加载完成。
 */
let sceneName = '';
let sceneLoaded = false;
let catalogLoaded = false;
let meshesPending = 0;

function refreshStatus(): void {
  if (!sceneLoaded) return;
  if (!catalogLoaded) {
    setStatus(`${sceneName} · 载入图鉴`, 'loading');
    return;
  }
  if (meshesPending > 0) {
    setStatus(`${sceneName} · 放置物件 ${meshesPending}`, 'loading');
    return;
  }
  setStatus(`${sceneName} · 就绪`, 'ok');
}

async function loadScene(url: string): Promise<void> {
  if (!url) {
    setStatus('空场景 · 未挂资产');
    return;
  }

  sceneName = url.split('/').pop() ?? url;
  setStatus(`载入 ${sceneName}`, 'loading');
  setProgress(0);

  try {
    const splat = await loadSplatFile(
      url,
      (loaded, total) => {
        setProgress(total ? loaded / total : null);
        const mb = (loaded / 1024 / 1024).toFixed(1);
        setStatus(`载入 ${sceneName} · ${mb}MB`, 'loading');
      },
      (config.packParam as PackType | null) ?? 'compressed',
    );

    viewer.getScene().add(splat);
    setProgress(null);
    sceneLoaded = true;
    refreshStatus();
    viewer.requestRender();
    if (config.modeParam === 'walk') setMode('walk');
  } catch (err) {
    setProgress(null);
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`空场景 · ${message}`, 'error');
    console.error('[half-a-room] 场景载入失败', err);
  }
}

setStatus('初始化');
loadScene(config.sceneUrl);

// ---- 4. 图鉴层：讲出来的那些东西，点一条镜头飞过去 -----------------------

const catalogEl = document.getElementById('catalog') as HTMLElement;
const scene = viewer.getScene();

// 3DGS 自带光照，网格没有——不给环境光的话网格会全黑
scene.add(new AmbientLight(0xffffff, 1));

loadCatalog().then((catalog) => {
  renderCatalog(catalogEl, catalog, (item) => {
    if (walking) setMode('orbit');
    orbit.flyTo(item.eye, item.target);
    setStatus(`「${item.name}」`, 'ok');
  });

  // 把生成出来的网格放进 3DGS 场景——这一步就是「放回原位」
  const withMesh = catalog.items.filter((item) => item.mesh && item.position);
  meshesPending = withMesh.length;

  for (const item of withMesh) {
    loadMesh(item.mesh as string, viewer)
      .then((mesh) => {
        placeMesh(mesh, {
          position: item.position as [number, number, number],
          rotationX: item.rotationX,
          rotationY: item.rotationY,
          // Lux3D 资产是米制，扫描件是相对单位，按 1/米每单位 换算
          scale: item.scale ?? 1 / config.metersPerUnit,
        });
        scene.add(mesh);
        viewer.requestRender();
        meshesPending = Math.max(0, meshesPending - 1);
        catalogLoaded = true;
        refreshStatus();
        console.log(`[half-a-room] 已放入网格 ${item.name}`);
      })
      .catch((err) => {
        meshesPending = Math.max(0, meshesPending - 1);
        catalogLoaded = true;
        refreshStatus();
        console.error(`[half-a-room] 网格载入失败 ${item.name}`, err);
      });
  }

  catalogLoaded = true;
  refreshStatus();
});

// ---- 5. 机位复现：按 P 复制当前机位的链接 ---------------------------------
/** 当前机位的完整 URL，粘贴即回到同一视角 */
function pose(): string {
  const { eye, target } = walking ? walker.getPose() : orbit.getPose();
  const url = new URL(location.href);
  url.searchParams.set('cam', [...eye, ...target].join(','));
  return url.toString();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    setMode(walking ? 'orbit' : 'walk');
    return;
  }
  if (e.key !== 'p' && e.key !== 'P') return;
  const link = pose();
  navigator.clipboard?.writeText(link).then(
    () => setStatus('机位已复制 · 粘到记录里', 'ok'),
    () => {
      console.log('[half-a-room] 机位链接\n' + link);
      setStatus('机位已打印到控制台', 'ok');
    },
  );
});

// 调试用：控制台里能摸到
Object.assign(window, { viewer, camera, orbit, walker, pose, setMode });
