#!/usr/bin/env node
/**
 * 分析 3DGS 的 PLY 点云，输出：
 *   1. 场景包围盒（场景单位与米）
 *   2. 竖直方向的分布，用来定位地面
 *   3. 俯视密度图（ASCII），直接看出哪些位置是"洞"
 *
 * 用法：node tools/analyze-ply.js <ply路径> [--grid 64]
 */

const fs = require('fs');

function readHeader(fd) {
  const buf = Buffer.alloc(1 << 20);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  const text = buf.slice(0, n).toString('latin1');
  const end = text.indexOf('end_header');
  if (end < 0) throw new Error('不是合法的 PLY 头');
  const headerText = text.slice(0, end + 'end_header'.length);
  const dataStart = headerText.length + (text[end + 'end_header'] === '\r' ? 2 : 1);
  return { headerText, dataStart };
}

function parseVertexProps(headerText) {
  const lines = headerText.split('\n').map((l) => l.trim());
  const props = [];
  let inVertex = false;
  let count = 0;
  for (const line of lines) {
    if (line.startsWith('element vertex')) {
      inVertex = true;
      count = parseInt(line.split(/\s+/)[2], 10);
      continue;
    }
    if (line.startsWith('element')) {
      inVertex = false;
      continue;
    }
    if (inVertex && line.startsWith('property')) {
      const [, type, name] = line.split(/\s+/);
      props.push({ type, name });
    }
  }
  const size = { float: 4, double: 8, float32: 4, float64: 8, int: 4, uint: 4, short: 2, ushort: 2, char: 1, uchar: 1 };
  const stride = props.reduce((a, p) => a + (size[p.type] || 4), 0);
  return { props, count, stride, size };
}

function main() {
  const file = process.argv[2];
  const gridArg = process.argv.indexOf('--grid');
  const GRID = gridArg > 0 ? parseInt(process.argv[gridArg + 1], 10) : 64;

  const fd = fs.openSync(file, 'r');
  const { headerText, dataStart } = readHeader(fd);
  const { props, count, stride, size } = parseVertexProps(headerText);

  const xi = props.findIndex((p) => p.name === 'x');
  const yi = props.findIndex((p) => p.name === 'y');
  const zi = props.findIndex((p) => p.name === 'z');
  if (xi < 0 || yi < 0 || zi < 0) throw new Error('PLY 顶点里没有 x/y/z');

  const offsetOf = (i) => props.slice(0, i).reduce((a, p) => a + (size[p.type] || 4), 0);
  const ox = offsetOf(xi);
  const oy = offsetOf(yi);
  const oz = offsetOf(zi);

  // 采样（最多 60 万点，够用了）
  const SAMPLE = Math.min(count, 600000);
  const step = Math.max(1, Math.floor(count / SAMPLE));
  const chunk = 4096;
  const buf = Buffer.alloc(chunk * stride);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const ys = [];
  const xs = [];
  const zs = [];
  let read = 0;

  while (read < count) {
    const want = Math.min(chunk, count - read);
    const got = fs.readSync(fd, buf, 0, want * stride, dataStart + read * stride);
    if (got <= 0) break;
    const n = Math.floor(got / stride);
    for (let i = 0; i < n; i += step) {
      const base = i * stride;
      const x = buf.readFloatLE(base + ox);
      const y = buf.readFloatLE(base + oy);
      const z = buf.readFloatLE(base + oz);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
      xs.push(x);
      ys.push(y);
      zs.push(z);
    }
    read += n;
  }
  fs.closeSync(fd);

  ys.sort((a, b) => a - b);
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];

  console.log('=== 点云概况 ===');
  console.log(`顶点数 ${count.toLocaleString()}  采样 ${ys.length.toLocaleString()}`);
  console.log(`原始包围盒 min  ${min.map((v) => v.toFixed(3)).join(', ')}`);
  console.log(`原始包围盒 max  ${max.map((v) => v.toFixed(3)).join(', ')}`);
  console.log(`原始尺寸        ${[0, 1, 2].map((i) => (max[i] - min[i]).toFixed(3)).join(' × ')} 场景单位`);

  // 稳健范围（去掉漂浮点）：用 2%–98% 分位
  const lo = [pct(xs, 0.02), pct(ys, 0.02), pct(zs, 0.02)];
  const hi = [pct(xs, 0.98), pct(ys, 0.98), pct(zs, 0.98)];
  console.log(`稳健范围 min    ${lo.map((v) => v.toFixed(3)).join(', ')}`);
  console.log(`稳健范围 max    ${hi.map((v) => v.toFixed(3)).join(', ')}`);
  console.log(`稳健尺寸        ${[0, 1, 2].map((i) => (hi[i] - lo[i]).toFixed(3)).join(' × ')} 场景单位`);

  console.log('\n=== 各轴分位 ===');
  for (const p of [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) {
    console.log(
      `  p${String(p * 100).padStart(3)}   x ${pct(xs, p).toFixed(2)}   y ${pct(ys, p).toFixed(2)}   z ${pct(zs, p).toFixed(2)}`,
    );
  }

  // ---- 俯视密度图（用稳健范围，剔除漂浮点）----
  const w = hi[0] - lo[0];
  const d = hi[2] - lo[2];
  const cell = Math.max(w, d) / GRID;
  const cells = new Int32Array(GRID * GRID);

  const fd2 = fs.openSync(file, 'r');
  const buf2 = Buffer.alloc(chunk * stride);
  let read2 = 0;
  while (read2 < count) {
    const want = Math.min(chunk, count - read2);
    const got = fs.readSync(fd2, buf2, 0, want * stride, dataStart + read2 * stride);
    if (got <= 0) break;
    const n = Math.floor(got / stride);
    for (let i = 0; i < n; i += step) {
      const base = i * stride;
      const x = buf2.readFloatLE(base + ox);
      const z = buf2.readFloatLE(base + oz);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      if (x < lo[0] || x > hi[0] || z < lo[2] || z > hi[2]) continue;
      const gx = Math.min(GRID - 1, Math.max(0, Math.floor((x - lo[0]) / cell)));
      const gz = Math.min(GRID - 1, Math.max(0, Math.floor((z - lo[2]) / cell)));
      cells[gz * GRID + gx]++;
    }
    read2 += n;
  }
  fs.closeSync(fd2);

  const peak = Math.max(...cells);
  const ramp = ' .:-=+*#%@';
  console.log('\n=== 俯视密度图（X→右，Z→下；@ 最密，空格 = 洞）===');
  console.log(`    X: ${lo[0].toFixed(2)} → ${hi[0].toFixed(2)}    Z: ${lo[2].toFixed(2)} → ${hi[2].toFixed(2)}`);
  let holes = 0;
  for (let gz = 0; gz < GRID; gz++) {
    let row = '';
    for (let gx = 0; gx < GRID; gx++) {
      const v = cells[gz * GRID + gx];
      if (v === 0) {
        row += ' ';
        holes++;
      } else {
        const k = peak > 0 ? v / peak : 0;
        row += ramp[Math.min(ramp.length - 1, Math.floor(k * ramp.length))];
      }
    }
    console.log('  ' + row);
  }
  console.log(`\n  空格子 ${holes} / ${GRID * GRID}（${((holes / (GRID * GRID)) * 100).toFixed(0)}% 是扫描没覆盖到的区域）`);

  const out = {
    count,
    bbox: { min, max },
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    yPercentiles: { p0: pct(0), p1: pct(0.01), p5: pct(0.05), p50: pct(0.5), p95: pct(0.95), p100: pct(1) },
    grid: { n: GRID, cell, cells: Array.from(cells) },
  };
  fs.writeFileSync(file.replace(/\.ply$/i, '') + '.analysis.json', JSON.stringify(out));
  console.log(`\n（明细已写入 ${file.replace(/\.ply$/i, '')}.analysis.json）`);
}

main();
