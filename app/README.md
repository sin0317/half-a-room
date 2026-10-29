# 场景工程（app/ → viewer/）

半间屋的 Web 场景：Vite + `@manycore/aholo-viewer`，渲染 3DGS 与网格。

## 命令

```bash
cd app
npm install
npm run dev      # 开发，http://localhost:5173
npm run build    # 构建到 ../viewer（仓库根目录的 viewer/）
```

`npm run build` 会自动清空并重写 `../viewer`，**构建产物要一起提交**——ModelScope 创空间是 static 类型，不接受构建步骤，只能本地 build 后把产物推上去。

## 目录

```
app/
├── index.html          页面骨架 + HUD
├── vite.config.ts      base './'、产物出到 ../viewer
├── src/
│   ├── main.ts         viewer 装配、相机、渲染循环、场景载入
│   ├── config.ts       场景地址 / 机位 / 背景色，改这里
│   ├── orbit.ts        轨道相机（拖动旋转、滚轮推拉）
│   ├── splat-loader.ts 3DGS 流式加载 + 进度
│   └── style.css
└── public/scenes/      随页面分发的场景资产（会复制到 viewer/scenes/）
```

## 四个必须记住的坑

1. **坐标系**：3DGS 是 **-Y 朝上**的 OpenCV 坐标系。相机必须 `camera.up.set(0, -1, 0)`，否则整个场景是倒的。`orbit.ts` 里的球坐标是围绕任意 up 轴算的，别改成默认 +Y。
2. **`base: './'` 不能改**：创空间把页面挂在子路径下，绝对路径 `/assets/...` 会 404。
3. **worker 文件必须独立存在**：包内部用 `new URL('./splat-worker.js', import.meta.url)` 找 worker，所以 `assetsInlineLimit: 0`、`optimizeDeps.exclude` 都不能删。构建后 `viewer/assets/` 里应该有 `splat-worker-*.js`、`splat-sort-worker-*.js`。
4. **场景资产不要用 LFS**：创空间的静态部署不做 LFS smudge，文件会以 133 字节的 pointer 形式被发出去，页面报 `Unexpected token 'v'`。`.sog/.ply/.spz/.glb/.gltf` 已从 `.gitattributes` 撤掉 LFS 规则，按普通二进制提交（单文件 <100MB）。
   超过 100MB 的扫描件走另一条路：放魔搭 dataset 仓库，用它的 resolve 绝对链接加载，仓库里不存大文件。

## 换场景 / 换机位

- 临时换资产：`http://localhost:5173/?scene=./scenes/xxx.sog`（`?scene=` 留空即纯空场景）
- 改默认值：`src/config.ts` 里的 `sceneUrl` 与 `camera.eye / camera.target`
- 真实房间扫描件的机位要按人眼高度重设，别沿用样例熊的机位

### 机位复现（做迭代对比用）

`?cam=ex,ey,ez,tx,ty,tz` 六个数字直接指定眼位与注视点，例如：

```
/viewer/?cam=-1.1,-0.35,0.2,0,-0.05,0
```

在页面里按 **P** 会把当前机位的完整链接复制到剪贴板（控制台里也可 `pose()`）。同一个物件的不同版本，用同一条链接截图，才谈得上对比。规则见 `../报告书/01-留证清单.md`。

## 部署

```bash
cd app && npm run build
cd .. && git add -A && git commit -m "..." && git push modelscope master
# 然后调 ModelScope 的 deploy 接口触发重建，见根目录 HANDOFF.md
```

验证清单：页面能出画、`viewer/assets/` 里 worker 齐全、控制台无 404。
