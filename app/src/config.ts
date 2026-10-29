/**
 * 场景配置。换房间、换机位、换默认资产都只改这里。
 */

const params = new URLSearchParams(location.search);

export const config = {
  /**
   * 默认载入的 3DGS 场景（相对页面路径）。
   * - 带 ?scene=xxx.sog 可以临时换
   * - 传 ?scene= 空值即纯空场景
   */
  sceneUrl: params.get('scene') ?? './scenes/sucant-v3.spz',

  /**
   * 标准机位：?cam=ex,ey,ez,tx,ty,tz（世界坐标，6 个数）。
   * 用途是让「同一物件不同版本」的截图能用同一个机位复现，
   * 控制台里 `pose()` 会打印当前机位的这串参数。
   */
  camParam: params.get('cam'),

  /** 调试：?up=x,y,z 覆盖相机上方向，用来判定模型的实际竖直轴 */
  upParam: params.get('up'),

  /**
   * 打包类型覆盖：?pack=compressed|supercompressed|raw|sog
   * SPZ 这类量化格式不同解法出来的结果不一样，用这个参数做对照测试。
   */
  packParam: params.get('pack'),

  camera: {
    fov: 60,
    near: 0.05,
    far: 2000,
    /** 初始机位。3DGS 资产是 -Y 朝上的 OpenCV 坐标系，见 orbit.ts 里的 up */
    eye: [0.4, -0.2, 3.4] as [number, number, number],
    target: [-1.2, -1.1, -2.2] as [number, number, number],
    minRadius: 0.2,
    maxRadius: 80,
  },

  background: 0x0b0b0c,

  /**
   * 场景单位 → 米。
   *
   * Reality 的 scale.json 写了 has_metric_scale=false，扫描件没有真实尺度。
   * 这个 0.52 是**两路独立测量交叉验证**出来的（针对 v3）：
   *   1. 扫描件里的键盘跨度 0.85 单位，标准键盘宽 44cm → 1 单位 ≈ 0.52m
   *   2. 桌面 y=1.0、地面 y=2.44，差 1.44 单位对应标准桌高 75cm → 1 单位 ≈ 0.52m
   * 房间稳健尺寸 6.8 × 10.1 单位 = 3.5m × 5.3m，与宿舍尺寸吻合。
   *
   * Lux3D 生成的资产本身就是米制（实测台灯 0.264×0.45×0.388 m），
   * 放进场景时统一乘 1/metersPerUnit ≈ 1.92，物件大小就和真实一致。
   */
  metersPerUnit: 0.52,

  /**
   * 地面高度（场景单位）。
   *
   * 从 PLY 的 y 分位数量出：房间竖直范围 -2.18 → 3.14，高度 5.32 单位 = 2.77m，
   * 正好是宿舍层高。所以地面是 y 的最小值那一端——之前按 -Y 朝上摆的所有东西
   * 其实都贴在天花板上，这次统一改过来。
   */
  floorY: -2.45,

  /** 人眼高度（米），行走时换算成场景单位 */
  eyeHeightM: 1.6,

  /** ?mode=walk 直接进入行走模式 */
  modeParam: params.get('mode'),
} as const;
