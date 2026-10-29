import { GLTFLoader, downloadTexture } from '@manycore/aholo-viewer';
import type { Object3D, Viewer } from '@manycore/aholo-viewer';

/**
 * 载入一个 glTF/GLB 网格。
 *
 * Lux3D 生成的资产是标准 glTF（+Y 朝上），而 3DGS 扫描件是 OpenCV 坐标系（-Y 朝上）。
 * 两者要同框，必须先把网格转 180°，否则物件是倒的——这是同帧混合最容易翻车的地方。
 */
export async function loadMesh(url: string, viewer: Viewer): Promise<Object3D> {
  // GLB 自己解析，不能把 URL 字符串直接丢进去（那是给 JSON 格式 glTF 用的）
  const res = await fetch(url);
  if (!res.ok) throw new Error(`网格载入失败 HTTP ${res.status} · ${url}`);
  const buffer = await res.arrayBuffer();

  // glTF 里的贴图若是相对路径，要按 GLB 所在目录解析，不能按页面目录
  const base = new URL(url, location.href);
  const textureLoader = (textureUrl: string) =>
    downloadTexture(new URL(textureUrl, base).toString(), { context: viewer });

  const { scene } = await GLTFLoader.loadGLTF(buffer, { textureLoader });
  return scene;
}

/** 网格摆放参数 */
export interface MeshPlacement {
  /** 位置（场景坐标，-Y 朝上） */
  position: [number, number, number];
  /** 绕 X 轴的额外旋转（弧度） */
  rotationX?: number;
  /** 绕 Y 轴的额外旋转（弧度） */
  rotationY?: number;
  /** 统一缩放 */
  scale?: number;
  /**
   * 是否把网格从标准 glTF 朝向翻到 3DGS 朝向（绕 X 轴 180°）。
   * 默认开——Lux3D 的资产是 +Y 朝上，扫描件是 -Y 朝上。
   */
  alignToSplat?: boolean;
}

/** 把网格摆到指定位置并返回它 */
export function placeMesh(mesh: Object3D, placement: MeshPlacement): Object3D {
  const flip = placement.alignToSplat === true ? Math.PI : 0;

  mesh.position.set(placement.position[0], placement.position[1], placement.position[2]);
  mesh.rotation.set(
    flip + (placement.rotationX ?? 0),
    placement.rotationY ?? 0,
    0,
  );
  const s = placement.scale ?? 1;
  mesh.scale.set(s, s, s);
  return mesh;
}
