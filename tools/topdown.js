#!/usr/bin/env node
/**
 * 从 3DGS 的 PLY 点云生成俯视密度图（PPM），用 ffmpeg 转 PNG。
 *
 * 用途：
 *   1. 看清房间平面布局（窗、桌、床各在哪）
 *   2. 直接看出哪些位置是「洞」——扫描没覆盖到的地方
 *   3. 报告书 P6/P7 的图
 *
 * 用法: node tools/topdown.js <ply> [--width 1400] [--height 900] [--out x.ppm]
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const file = process.argv[2] || process.env.PLY || '';
if (!file) {
  console.error('用法: node tools/topdown.js <ply> [--width 1400] [--height 900] [--out x.ppm]');
  process.exit(1);
}
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const W = parseInt(arg('--width', '1400'), 10);
const H = parseInt(arg('--height', '900'), 10);
const outPpm = arg('--out', '.verify/topdown.ppm');
const outPng = outPpm.replace(/\.ppm$/i, '.png');

// ---- 解析 PLY 头 ----
const fd = fs.openSync(file, 'r');
const head = Buffer.alloc(1 << 20);
const hn = fs.readSync(fd, head, 0, head.length, 0);
const text = head.slice(0, hn).toString('latin1');
const end = text.indexOf('end_header');
const header = text.slice(0, end);
const dataStart = end + 'end_header'.length + (text[end + 11] === '\r' ? 2 : 1);

const props = [];
let count = 0;
let inV = false;
for (const line of header.split('\n').map((s) => s.trim())) {
  if (line.startsWith('element vertex')) { inV = true; count = parseInt(line.split(/\s+/)[2], 10); continue; }
  if (line.startsWith('element')) { inV = false; continue; }
  if (inV && line.startsWith('property')) { const [, t, nm] = line.split(/\s+/); props.push({ t, nm }); }
}
const SZ = { float: 4, double: 8, int: 4, uint: 4, short: 2, ushort: 2, char: 1, uchar: 1 };
const stride = props.reduce((a, p) => a + (SZ[p.t] || 4), 0);
const off = (i) => props.slice(0, i).reduce((a, p) => a + (SZ[p.t] || 4), 0);
const ox = off(props.findIndex((p) => p.nm === 'x'));
const oy = off(props.findIndex((p) => p.nm === 'y'));
const oz = off(props.findIndex((p) => p.nm === 'z'));

// ---- 两遍扫描：先定范围，再统计 ----
const CH = 4096;
const buf = Buffer.alloc(CH * stride);
const step = Math.max(1, Math.floor(count / 1500000));

function scan(cb) {
  let read = 0;
  while (read < count) {
    const want = Math.min(CH, count - read);
    const got = fs.readSync(fd, buf, 0, want * stride, dataStart + read * stride);
    if (got <= 0) break;
    const n = Math.floor(got / stride);
    for (let i = 0; i < n; i += step) {
      cb(buf.readFloatLE(i * stride + ox), buf.readFloatLE(i * stride + oy), buf.readFloatLE(i * stride + oz));
    }
    read += n;
  }
}
let lo = [Infinity, Infinity, Infinity];
let hi = [-Infinity, -Infinity, -Infinity];
scan((x, y, z) => {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
  if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
  if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
});

// 稳健范围（去掉漂浮点）
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
const xs = [], ys = [], zs = [];
scan((x, y, z) => { if (Number.isFinite(x)) { xs.push(x); ys.push(y); zs.push(z); } });
xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); zs.sort((a, b) => a - b);
const X0 = q(xs, 0.02), X1 = q(xs, 0.98);
const Z0 = q(zs, 0.02), Z1 = q(zs, 0.98);
const Y0 = q(ys, 0.02), Y1 = q(ys, 0.98);
fs.closeSync(fd);

// ---- 密度统计 ----
const grid = new Float64Array(W * H);
const yGrid = new Float64Array(W * H); // 每格最高点（Y 越小越高）
const yMin = new Float64Array(W * H).fill(Infinity);
const ySum = new Float64Array(W * H);
const yCnt = new Float64Array(W * H);
const sx = (X1 - X0) / W;
const sz = (Z1 - Z0) / H;

const fd2 = fs.openSync(file, 'r');
const buf2 = Buffer.alloc(CH * stride);
let read = 0;
while (read < count) {
  const want = Math.min(CH, count - read);
  const got = fs.readSync(fd2, buf2, 0, want * stride, dataStart + read * stride);
  if (got <= 0) break;
  const n = Math.floor(got / stride);
  for (let i = 0; i < n; i += step) {
    const x = buf2.readFloatLE(i * stride + ox);
    const y = buf2.readFloatLE(i * stride + oy);
    const z = buf2.readFloatLE(i * stride + oz);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < X0 || x > X1 || z < Z0 || z > Z1) continue;
    const px = Math.min(W - 1, Math.floor((x - X0) / sx));
    // 图像上方 = -Z（远处），和渲染时「往里看」一致
    const pz = Math.min(H - 1, Math.floor((z - Z0) / sz));
    const k = pz * W + px;
    grid[k]++;
    ySum[k] += y;
    yCnt[k]++;
    if (y < yMin[k]) yMin[k] = y;
  }
  read += n;
}
fs.closeSync(fd2);

// ---- 出图 ----
const pix = Buffer.alloc(W * H * 3);
let peak = 0;
for (let i = 0; i < grid.length; i++) if (grid[i] > peak) peak = grid[i];
for (let i = 0; i < W * H; i++) {
  const v = grid[i];
  const k = Math.log1p(v) / Math.log1p(peak); // 对数拉伸，暗处才看得见
  // 空 = 纯黑（洞）；有数据 = 冷暖渐变
  const r = Math.round(255 * Math.min(1, k * 1.35));
  const g = Math.round(255 * Math.min(1, k * 1.05));
  const b = Math.round(255 * Math.min(1, k * 0.75 + (1 - k) * 0.12));
  pix[i * 3] = r; pix[i * 3 + 1] = g; pix[i * 3 + 2] = b;
}
// 每 1 单位画一条网格线
for (let x = Math.ceil(X0); x <= X1; x++) {
  const px = Math.round((x - X0) / sx);
  for (let pz = 0; pz < H; pz++) {
    const k = (pz * W + px) * 3;
    pix[k] = Math.min(255, pix[k] + 26); pix[k + 1] = Math.min(255, pix[k + 1] + 26); pix[k + 2] = Math.min(255, pix[k + 2] + 26);
  }
}
for (let z = Math.ceil(Z0); z <= Z1; z++) {
  const pz = Math.round((z - Z0) / sz);
  for (let px = 0; px < W; px++) {
    const k = (pz * W + px) * 3;
    pix[k] = Math.min(255, pix[k] + 26); pix[k + 1] = Math.min(255, pix[k + 1] + 26); pix[k + 2] = Math.min(255, pix[k + 2] + 26);
  }
}
fs.mkdirSync(require('path').dirname(outPpm), { recursive: true });
fs.writeFileSync(outPpm, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), pix]));

// ---- 第二张图：高度图（每格取最高点 = 最小 Y）----------------------------
const hpix = Buffer.alloc(W * H * 3);
const hmin = new Float64Array(W * H).fill(Infinity);
for (let i = 0; i < grid.length; i++) {
  if (grid[i] > 0 && yMin[i] < hmin[i]) hmin[i] = yMin[i];
}
const hLo = Y0;
const hHi = Y1;
for (let i = 0; i < W * H; i++) {
  let v;
  if (hmin[i] === Infinity) v = 0;              // 没数据 = 纯黑
  else {
    const t = (hmin[i] - hLo) / (hHi - hLo);      // 0 = 最高, 1 = 最低
    v = Math.round(255 * (1 - t));
  }
  // 冷色表示高（+Y 朝下，Y 小 = 高）
  hpix[i * 3] = Math.round(v * 0.55);
  hpix[i * 3 + 1] = Math.round(v * 0.85);
  hpix[i * 3 + 2] = Math.round(v * 0.45 + (1 - v / 255) * 60);
}
const hPpm = outPpm.replace(/\.ppm$/i, '.height.ppm');
const hPng = hPpm.replace(/\.ppm$/i, '.png');
fs.writeFileSync(hPpm, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), hpix]));
try {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', hPpm, hPng]);
  console.log('高度图:', hPng);
} catch (e) {
  console.log('高度图 PPM:', hPpm);
}
try {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', outPpm, outPng]);
  console.log('已生成:', outPng);
} catch (e) {
  console.log('已生成 PPM:', outPpm, '（ffmpeg 转 PNG 失败）');
}
console.log(`范围 X[${X0.toFixed(2)}, ${X1.toFixed(2)}]  Y[${Y0.toFixed(2)}, ${Y1.toFixed(2)}]  Z[${Z0.toFixed(2)}, ${Z1.toFixed(2)}]`);
console.log(`网格 1 单位 = ${(1 / sx).toFixed(1)} px`);
fs.writeFileSync(outPpm.replace(/\.ppm$/i, '.meta.json'), JSON.stringify({ X0, X1, Y0, Y1, Z0, Z1, sx, sz, W, H, peak }));
