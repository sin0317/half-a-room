import { Vector3 } from '@manycore/aholo-viewer';
import type { PerspectiveCamera } from '@manycore/aholo-viewer';

type Vec3 = [number, number, number];

export interface WalkOptions {
  /** 地面高度（场景单位）。3DGS 是 -Y 朝上，所以地面是 y 的最大值 */
  floorY: number;
  /** 相机离地高度（场景单位） */
  eyeHeight: number;
  /** 行走速度（单位/秒） */
  speed?: number;
  /** 行走范围，防止走出扫描区域 */
  bounds?: { x: [number, number]; z: [number, number] };
  onChange?: () => void;
}

/**
 * 第一人称行走。
 *
 * 3DGS 的 up 是 -Y，所以这里的「水平面」是 XZ 平面、yaw 绕 Y 轴。
 * 相机高度锁死在地面之上，永远不会出现翻过来的视角。
 *
 * 视角控制有两条路：
 * 1. 点画面 → 指针锁定，鼠标直接转头（最像走进去）
 * 2. iframe 里拿不到指针锁定时，退回「按住拖动看四周」
 */
export class WalkController {
  private readonly camera: PerspectiveCamera;
  private readonly el: HTMLElement;
  private readonly opts: Required<Omit<WalkOptions, 'onChange'>> & { onChange: () => void };

  private pos: Vec3 = [0, 0, 0];
  private yaw = 0;
  private pitch = 0;
  private active = false;
  private raf: number | null = null;
  private lastTime = 0;
  private readonly keys = new Set<string>();
  private locked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly targetVec = new Vector3();

  constructor(camera: PerspectiveCamera, el: HTMLElement, opts: WalkOptions) {
    this.camera = camera;
    this.el = el;
    this.opts = {
      floorY: opts.floorY,
      eyeHeight: opts.eyeHeight,
      speed: opts.speed ?? 2.6,
      bounds: opts.bounds ?? { x: [-40, 40], z: [-40, 40] },
      onChange: opts.onChange ?? (() => {}),
    };
    this.bind();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 从当前机位接手：水平朝向沿用轨道相机看到的方向，高度拉到人眼 */
  enter(fromEye: Vec3, lookAt: Vec3): void {
    const dx = lookAt[0] - fromEye[0];
    const dz = lookAt[2] - fromEye[2];
    this.pos = [fromEye[0], this.opts.floorY + this.opts.eyeHeight, fromEye[2]];
    if (Math.hypot(dx, dz) > 1e-4) this.yaw = Math.atan2(dx, dz);
    this.pitch = 0;
    this.clampPos();
    this.active = true;
    document.body.classList.add('is-walking');
    this.apply();
    this.lastTime = performance.now();
    this.loop();
    this.el.focus?.();
  }

  exit(): void {
    this.active = false;
    document.body.classList.remove('is-walking');
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (document.pointerLockElement === this.el) document.exitPointerLock?.();
  }

  /** 当前机位，退出行走时交还给轨道相机 */
  getPose(): { eye: Vec3; target: Vec3 } {
    const d = this.forward();
    return {
      eye: [this.pos[0], this.pos[1], this.pos[2]],
      target: [this.pos[0] + d[0], this.pos[1] + d[1], this.pos[2] + d[2]],
    };
  }

  private forward(): Vec3 {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];
  }

  private clampPos(): void {
    const b = this.opts.bounds;
    this.pos[0] = Math.min(b.x[1], Math.max(b.x[0], this.pos[0]));
    this.pos[2] = Math.min(b.z[1], Math.max(b.z[0], this.pos[2]));
    this.pos[1] = this.opts.floorY + this.opts.eyeHeight;
  }

  private apply(): void {
    const f = this.forward();
    this.camera.position.set(this.pos[0], this.pos[1], this.pos[2]);
    this.camera.up.set(0, 1, 0);
    this.targetVec.set(this.pos[0] + f[0], this.pos[1] + f[1], this.pos[2] + f[2]);
    this.camera.lookAt(this.targetVec);
    this.opts.onChange();
  }

  private loop = (): void => {
    if (!this.active) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    let fwd = 0;
    let side = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) fwd += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) fwd -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) side += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) side -= 1;

    if (fwd || side) {
      const speed = this.opts.speed * (this.keys.has('shift') ? 2 : 1) * dt;
      const len = Math.hypot(fwd, side) || 1;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // 前 = (sin yaw, 0, cos yaw)，右 = (cos yaw, 0, -sin yaw)
      this.pos[0] += ((fwd * sin + side * cos) / len) * speed;
      this.pos[2] += ((fwd * cos - side * sin) / len) * speed;
      this.clampPos();
      this.apply();
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  private bind(): void {
    this.el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      // 优先拿指针锁定；拿不到（iframe 没给 allow）就退回拖动
      if (!this.locked && document.pointerLockElement !== this.el) {
        const request = this.el.requestPointerLock?.();
        if (request && typeof request.catch === 'function') request.catch(() => {});
      }
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });

    const endDrag = () => {
      this.dragging = false;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    window.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      const locked = document.pointerLockElement === this.el;
      if (!locked && !this.dragging) return;
      const dx = locked ? e.movementX : e.clientX - this.lastX;
      const dy = locked ? e.movementY : e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw += dx * 0.0022;
      this.pitch = Math.min(1.45, Math.max(-1.45, this.pitch - dy * 0.0022));
      this.apply();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      document.body.classList.toggle('is-locked', this.locked);
    });

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    window.addEventListener('blur', () => this.keys.clear());
  }
}
