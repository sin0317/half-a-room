// 用 CDP 真实等待场景「就绪」后再截图。
//
// 为什么不用 `--screenshot --virtual-time-budget`：虚拟时间会在流式加载
// 83MB 的 spz 之前就走完，截出来是空场景（纯 HUD，约 66KB）。实测同一个
// 页面用 CDP 等「就绪」再截，是真实渲染。
//
// 用法: node tools/shot.js <场景文件(相对 viewer/)> <cam 或空串> <输出 png> [端口]
// 例:   node tools/shot.js ./scenes/sucant-v1.spz "3.5,1.0,1.5,3.5,2.0,-4.0" .verify/x.png
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PY = process.env.PY || 'python';

const scene = process.argv[2];
const cam = process.argv[3] || '';
const outArg = process.argv[4];
const PORT = Number(process.argv[5] || 8099);
const DBG = Number(process.env.DBG_PORT || 9333);
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 300000);

if (!scene || !outArg) {
  console.error('用法: node tools/shot.js <场景文件> <cam 或空串> <输出 png> [端口]');
  process.exit(1);
}
const OUT = path.isAbsolute(outArg) ? outArg : path.join(ROOT, outArg);
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

async function waitFor(label, fn, timeoutMs, stepMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label} 超时 ${timeoutMs}ms`);
    await sleep(stepMs);
  }
}

async function main() {
  const profile = path.join(ROOT, '.verify', 'edgeprofile-cdp');
  const server = spawn(PY, ['-m', 'http.server', String(PORT), '--directory', path.join(ROOT, 'viewer')], {
    stdio: 'ignore',
  });
  const edge = spawn(
    EDGE,
    [
      '--headless',
      '--disable-gpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--hide-scrollbars',
      '--window-size=1280,800',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${DBG}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const cleanup = () => {
    try { edge.kill(); } catch {}
    try { server.kill(); } catch {}
  };

  let ws;
  try {
    await waitFor('Edge CDP 端口', async () => (await fetch(`http://127.0.0.1:${DBG}/json/version`)).ok, 30000);
    await waitFor('本地静态服务', async () => (await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok, 15000);

    const q = [`scene=${scene}`];
    if (cam) q.push(`cam=${cam}`);
    const url = `http://127.0.0.1:${PORT}/?${q.join('&')}`;

    let target;
    try {
      const res = await fetch(`http://127.0.0.1:${DBG}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
      target = await res.json();
    } catch {
      target = undefined;
    }
    if (!target || !target.webSocketDebuggerUrl) {
      const res = await fetch(`http://127.0.0.1:${DBG}/json/new?${encodeURIComponent(url)}`);
      target = await res.json();
    }

    ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true });
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });

    await send('Page.enable');
    await send('Runtime.enable');

    const text = () =>
      send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }).then(
        (r) => r.result && r.result.value,
      );

    const status = await waitFor(
      '场景就绪',
      async () => {
        const t = await text();
        if (!t) return undefined;
        if (t.includes('· 就绪') || t.includes('空场景')) return t;
        if (/空场景 · [^未]/.test(t) && /失败|HTTP|错误/.test(t)) throw new Error('场景载入失败: ' + t.replace(/\n/g, ' | '));
        return undefined;
      },
      READY_TIMEOUT_MS,
      1000,
    );

    await sleep(2500); // 等最后一帧真正画出来
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
    console.log(stamp(), 'OK', `${kb}KB`, OUT);
    console.log(stamp(), 'HUD:', status.split('\n').filter((l) => l.trim()).slice(0, 6).join(' / '));
  } finally {
    try { ws && ws.close(); } catch {}
    cleanup();
  }
}

main().catch((e) => {
  console.error(stamp(), '失败:', e.message);
  process.exit(1);
});