import { Vector3 } from '@manycore/aholo-viewer';
import type { PerspectiveCamera } from '@manycore/aholo-viewer';

type Vec3 = [number, number, number];

export interface OrbitOptions {
  /** 相机 up 轴。3DGS 是 -Y 朝上，所以默认 [0,-1,0] */
  up?: Vec3;
  target?: Vec3;
  /** 初始机位，控制器会反算出球坐标 */
  eye?: Vec3;
  minRadius?: number;
  maxRadius?: number;
  /** 地面高度：相机不允许转到这个高度以下，否则整个房间会上下颠倒 */
  floorY?: number;
  /** 相机发生变化时回调，用来触发重绘 */
  onChange?: () => void;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * 最小轨道相机：拖动旋转、滚轮推拉。
 * Aholo Viewer 不带控制器，这里自己实现一个，免得多引一个 three 依赖。
 * 关键点是球坐标围绕任意 up 轴计算——3DGS 的 up 是 -Y，不能套用默认的 +Y。
 */
export class OrbitController {
  private readonly up: Vec3;
  private readonly target: Vec3;
  private readonly el: HTMLElement;
  private readonly onChange: () => void;
  private readonly minRadius: number;
  private readonly maxRadius: number;
  private readonly floorY: number | null;

  /** 绕 up 轴的水平角 */
  private theta = 0;
  /** 与 up 轴的夹角 */
  private phi = Math.PI / 2;
  private radius = 1;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** 行走模式下轨道相机让位，不接受交互 */
  private enabled = true;
  /** 正在飞行的动画帧，用于打断 */
  private flyFrame: number | null = null;
  /** lookAt 只接受 Vector3 实例，复用同一个避免每帧分配 */
  private readonly targetVec = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    el: HTMLElement,
    opts: OrbitOptions = {},
  ) {
    this.el = el;
    this.up = norm(opts.up ?? [0, -1, 0]);
    this.target = opts.target ?? [0, 0, 0];
    this.onChange = opts.onChange ?? (() => {});
    this.minRadius = opts.minRadius ?? 0.2;
    this.maxRadius = opts.maxRadius ?? 100;
    this.floorY = opts.floorY ?? null;

    this.setFromEye(opts.eye ?? [0, 0, 2]);
    this.bind();
    this.apply();
  }

  /** 由世界坐标机位反算球坐标 */
  setFromEye(eye: Vec3): void {
    const d = sub(eye, this.target);
    this.radius = Math.min(this.maxRadius, Math.max(this.minRadius, len(d) || 1));
    const n = norm(d);
    this.phi = Math.acos(Math.min(1, Math.max(-1, dot(n, this.up))));

    const { e1, e2 } = this.basis();
    this.theta = Math.atan2(dot(n, e2), dot(n, e1));
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.dragging = false;
  }

  setTarget(target: Vec3): void {
    this.target[0] = target[0];
    this.target[1] = target[1];
    this.target[2] = target[2];
    this.apply();
  }

  /** 一次性设定机位（eye + target），用于从 URL 参数还原标准机位 */
  setPose(eye: Vec3, target: Vec3): void {
    this.target[0] = target[0];
    this.target[1] = target[1];
    this.target[2] = target[2];
    this.setFromEye(eye);
    this.apply();
  }

  /** 当前机位，用于生成可复现的 URL */
  getPose(): { eye: Vec3; target: Vec3 } {
    const { e1, e2 } = this.basis();
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const dir: Vec3 = [
      sinPhi * (Math.cos(this.theta) * e1[0] + Math.sin(this.theta) * e2[0]) + cosPhi * this.up[0],
      sinPhi * (Math.cos(this.theta) * e1[1] + Math.sin(this.theta) * e2[1]) + cosPhi * this.up[1],
      sinPhi * (Math.cos(this.theta) * e1[2] + Math.sin(this.theta) * e2[2]) + cosPhi * this.up[2],
    ];
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      eye: [
        round(this.target[0] + dir[0] * this.radius),
        round(this.target[1] + dir[1] * this.radius),
        round(this.target[2] + dir[2] * this.radius),
      ],
      target: [round(this.target[0]), round(this.target[1]), round(this.target[2])],
    };
  }

  /**
   * 平滑飞到指定机位（给图鉴层用）。
   * 走的是球坐标的线性插值，不是直线飞行，观感更像"走过去"。
   */
  flyTo(eye: Vec3, target: Vec3, duration = 900): void {
    this.cancelFly();
    const current = this.getPose();
    const t0 = performance.now();
    const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k,
    ];

    const step = (): void => {
      const raw = Math.min(1, (performance.now() - t0) / duration);
      const k = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      const e = lerp(current.eye, eye, k);
      this.target[0] = target[0];
      this.target[1] = target[1];
      this.target[2] = target[2];
      this.setFromEye(e);
      this.apply();
      if (raw < 1) {
        this.flyFrame = requestAnimationFrame(step);
      } else {
        this.flyFrame = null;
      }
    };

    this.flyFrame = requestAnimationFrame(step);
  }

  private cancelFly(): void {
    if (this.flyFrame !== null) {
      cancelAnimationFrame(this.flyFrame);
      this.flyFrame = null;
    }
  }

  /** 围绕 up 构造两条水平基向量，任意 up 都成立 */
  private basis(): { e1: Vec3; e2: Vec3 } {    const ref: Vec3 = Math.abs(this.up[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    const e1 = norm(cross(this.up, ref));
    const e2 = norm(cross(this.up, e1));
    return { e1, e2 };
  }

  private apply(): void {
    if (this.floorY !== null) this.clampAboveFloor();
    const { e1, e2 } = this.basis();
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const dir: Vec3 = [
      sinPhi * (Math.cos(this.theta) * e1[0] + Math.sin(this.theta) * e2[0]) + cosPhi * this.up[0],
      sinPhi * (Math.cos(this.theta) * e1[1] + Math.sin(this.theta) * e2[1]) + cosPhi * this.up[1],
      sinPhi * (Math.cos(this.theta) * e1[2] + Math.sin(this.theta) * e2[2]) + cosPhi * this.up[2],
    ];

    this.camera.position.set(
      this.target[0] + dir[0] * this.radius,
      this.target[1] + dir[1] * this.radius,
      this.target[2] + dir[2] * this.radius,
    );
    this.camera.up.set(this.up[0], this.up[1], this.up[2]);
    this.targetVec.set(this.target[0], this.target[1], this.target[2]);
    this.camera.lookAt(this.targetVec);
    this.onChange();
  }

  /**
   * 相机必须在地面之上。
   *
   * eye.y = target.y + cos(phi) * radius * up.y
   * 要求 eye.y >= floorY + 余量（不管 up 是 +Y 还是 -Y，地面都在 y 小的一侧）。
   * 解出 phi 的允许范围，镜头就不会翻到地板下面去——这是「上下颠倒」的根源。
   */
  private clampAboveFloor(): void {
    const r = this.radius || 1;
    const want = ((this.floorY as number) + 0.3 - this.target[1]) / r;
    const upY = this.up[1] >= 0 ? 1 : -1;

    if (upY > 0) {
      // cos(phi) >= want
      if (want >= 1) return;
      const phiMax = Math.acos(Math.max(-0.999, want));
      if (this.phi > phiMax) this.phi = Math.max(0.05, phiMax);
      return;
    }

    // up = -Y：cos(phi) <= want
    if (want <= -1) return;
    const phiMin = Math.acos(Math.min(0.999, want));
    if (this.phi < phiMin) this.phi = Math.min(Math.PI - 0.05, phiMin);
  }

  private bind(): void {
    this.el.style.touchAction = 'none';

    this.el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      this.cancelFly();
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.el.setPointerCapture(e.pointerId);
    });

    this.el.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      this.theta -= dx * 0.005;
      this.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi - dy * 0.005));
      this.apply();
    });

    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);

    this.el.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.radius = Math.min(
          this.maxRadius,
          Math.max(this.minRadius, this.radius * Math.exp(e.deltaY * 0.0012)),
        );
        this.apply();
      },
      { passive: false },
    );
  }
}
