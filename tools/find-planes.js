#!/usr/bin/env node
/**
 * 找出 PLY 里的水平面（地面、桌面、床板、天花板）。
 * 两遍扫描：第一遍定范围，第二遍统计分布。
 *
 * 用法：node tools/find-planes.js <ply> [--bins 240]
 */
const fs = require('fs');

const file = process.argv[2];
const bi = process.argv.indexOf('--bins');
const BINS = bi > 0 ? parseInt(process.argv[bi + 1], 10) : 240;

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
const oy = off(props.findIndex((p) => p.nm === 'y'));
const ox = off(props.findIndex((p) => p.nm === 'x'));
const oz = off(props.findIndex((p) => p.nm === 'z'));

const CH = 4096;
const buf = Buffer.alloc(CH * stride);
const step = Math.max(1, Math.floor(count / 400000));

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

let lo = Infinity;
let hi = -Infinity;
scan((x, y) => { if (Number.isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; } });

const hist = new Float64Array(BINS);
const span = hi - lo;
scan((x, y, z) => {
  if (!Number.isFinite(y)) return;
  const k = Math.min(BINS - 1, Math.max(0, Math.floor((y - lo) / span * BINS)));
  hist[k]++;
});

fs.closeSync(fd);

const yOf = (i) => lo + ((i + 0.5) / BINS) * span;
const peak = Math.max(...hist);
console.log(`y 范围 ${lo.toFixed(2)} → ${hi.toFixed(2)}   峰值 ${peak}`);
console.log('\n=== y 分布（横条=点数密度；尖峰=水平面）===');
for (let i = 0; i < BINS; i++) {
  const v = hist[i];
  const bar = v > 0 ? '#'.repeat(Math.min(72, Math.round((v / peak) * 72))) : '';
  console.log(String(yOf(i).toFixed(2)).padStart(7) + ' ' + bar);
}

// 找局部极大（比左右邻居都高 3 倍以上）
console.log('\n=== 水平面候选 ===');
const found = [];
for (let i = 2; i < BINS - 2; i++) {
  const v = hist[i];
  if (v <= 0) continue;
  const nb = Math.max(hist[i - 1], hist[i - 2], hist[i + 1], hist[i + 2]);
  if (v > nb * 3 && v > peak * 0.05) {
    if (!found.length || Math.abs(found[found.length - 1].y - yOf(i)) > 0.15) {
      found.push({ y: yOf(i), n: Math.round(v) });
    }
  }
}
for (const f of found) console.log(`  y = ${f.y.toFixed(2)}   点数 ${f.n}`);
