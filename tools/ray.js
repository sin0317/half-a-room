#!/usr/bin/env node
/**
 * 相机投影 / 反投影工具。
 *
 * 约定与 three.js 一致：
 *   localZ = normalize(eye - target)（相机朝自己的 -Z 看）
 *   localX = normalize(cross(up, localZ))
 *   localY = cross(localZ, localX)
 *   屏幕右 = localX，屏幕上 = localY
 *
 * 视口默认 1250×705（tools/shot.js 的窗口），垂直 fov 60°。
 *
 * 用法（自检）：
 *   node tools/ray.js
 */
const fs = require('fs');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

function basis(eye, target, up = [0, -1, 0]) {
  const localZ = norm(sub(eye, target));
  const localX = norm(cross(up, localZ));
  const localY = cross(localZ, localX);
  return { localX, localY, localZ };
}

/** 世界点 → 画布像素（px 从左、py 从上） */
function project(eye, target, W, H, fovDeg, p, up = [0, -1, 0]) {
  const { localX, localY, localZ } = basis(eye, target, up);
  const v = sub(p, eye);
  const xc = dot(v, localX);
  const yc = dot(v, localY);
  const zc = dot(v, localZ);
  const tanH = Math.tan((fovDeg * Math.PI) / 180 / 2);
  const ndcX = xc / (-zc * tanH * (W / H));
  const ndcY = yc / (-zc * tanH);
  return [(ndcX + 1) / 2 * W, (1 - ndcY) / 2 * H];
}

/** 画布像素 → 世界方向 */
function rayDir(eye, target, W, H, fovDeg, px, py, up = [0, -1, 0]) {
  const { localX, localY, localZ } = basis(eye, target, up);
  const tanH = Math.tan((fovDeg * Math.PI) / 180 / 2);
  const ndcX = (px / W) * 2 - 1;
  const ndcY = 1 - (py / H) * 2;
  const d = [
    localX[0] * ndcX * tanH * (W / H) + localY[0] * ndcY * tanH - localZ[0],
    localX[1] * ndcX * tanH * (W / H) + localY[1] * ndcY * tanH - localZ[1],
    localX[2] * ndcX * tanH * (W / H) + localY[2] * ndcY * tanH - localZ[2],
  ];
  return norm(d);
}

/** 画布像素 → 落在水平面 y=const 上的世界坐标 */
function onPlane(eye, target, W, H, fovDeg, px, py, yPlane, up = [0, -1, 0]) {
  const d = rayDir(eye, target, W, H, fovDeg, px, py, up);
  if (Math.abs(d[1]) < 1e-9) return null;
  const t = (yPlane - eye[1]) / d[1];
  if (t <= 0) return null;
  return [eye[0] + t * d[0], yPlane, eye[2] + t * d[2]];
}

module.exports = { project, rayDir, onPlane, basis };

if (require.main === module) {
  const W = 1250, H = 705, FOV = 60;
  const eye = [1.3199, 0.7407, 1.4932];
  const target = [0.5439, 1.0877, -2.1755];

  console.log('=== 自检 1：target 应投影到画面中心 ===');
  const c = project(eye, target, W, H, FOV, target);
  console.log('  投影结果:', c.map((v) => v.toFixed(1)).join(', '), '（应为 ' + W / 2 + ', ' + H / 2 + '）');

  console.log('\n=== 自检 2：反投影回到 target ===');
  const back = onPlane(eye, target, W, H, FOV, c[0], c[1], target[1]);
  console.log('  反投影:', back ? back.map((v) => v.toFixed(3)).join(', ') : 'null', '（应为 ' + target.map((v) => v.toFixed(3)).join(', ') + '）');

  console.log('\n=== 自检 3：已验证的台灯位置投在哪 ===');
  const lamp = [0.8, 1.77, -1.1];
  const lp = project(eye, target, W, H, FOV, lamp);
  console.log('  台灯(0.8,1.77,-1.1) → 画布像素', lp.map((v) => v.toFixed(0)).join(', '));

  console.log('\n=== 屏幕特征 → 水平面坐标 ===');
  const feats = JSON.parse(fs.readFileSync(process.env.FEATS || '[]', 'utf8'));
  for (const f of feats) {
    for (const yp of f.planes || []) {
      const p = onPlane(eye, target, W, H, FOV, f.px, f.py, yp);
      console.log(`  ${f.name} 像素(${f.px},${f.py}) 平面y=${yp} → ` + (p ? `x=${p[0].toFixed(2)} z=${p[2].toFixed(2)}` : '（射线不与该面相交）'));
    }
  }
}
