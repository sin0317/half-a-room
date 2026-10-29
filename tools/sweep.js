// 一次加载场景、连续切换机位批量截图（CDP）。
//
// 为什么要这个：软件 GL（swiftshader）下每次新开 Edge 重载 80–95MB spz 要几十秒，
// 逐机位跑 shot.js 太慢；这里只加载一次，之后用页面里暴露的 window.orbit.setPose()
// 换机位，每张只等一帧。用于「同一物件多版本找同一取景」的人工筛选。
//
// 用法: node tools/sweep.js <场景文件(相对 viewer/)> <spec.json> <输出目录>
// spec.json: { "base": [ex,ey,ez,tx,ty,tz], "shots": [ {"name":"a","eye":[..],"tgt":[..]}, ... ] }
// 环境: WIN=1280,800  SHOT_WAIT=1600  PORT=8099  DBG_PORT=9333
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PY = process.env.PY || 'python';

const scene = process.argv[2];
const specPath = process.argv[3];
const outDirArg = process.argv[4];
const PORT = Number(process.env.PORT || 8099);
const DBG = Number(process.env.DBG_PORT || 9333);
const WIN = process.env.WIN || '1280,800';
const WAIT = Number(process.env.SHOT_WAIT || 1600);
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 300000);

if (!scene || !specPath || !outDirArg) {
  console.error('用法: node tools/sweep.js <场景文件> <spec.json> <输出目录>');
  process.exit(1);
}
const OUT = path.resolve(ROOT, outDirArg);
fs.mkdirSync(OUT, { recursive: true });
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

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
      `--window-size=${WIN}`,
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

    const url = `http://127.0.0.1:${PORT}/?scene=${scene}&cam=${spec.base.join(',')}`;
    let target;
    try {
      const res = await fetch(`http://127.0.0.1:${DBG}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
      target = await res.json();
    } catch { target = undefined; }
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
        if (t.includes('· 就绪')) return t;
        if (/失败|HTTP|错误/.test(t)) throw new Error('场景载入失败: ' + t.replace(/\n/g, ' | '));
        return undefined;
      },
      READY_TIMEOUT_MS,
      1000,
    );
    console.log(stamp(), '就绪:', status.split('\n').filter((l) => l.trim()).slice(-3).join(' / '));

    const tLoad = Date.now();
    console.log(stamp(), `加载+首帧用时 ${((tLoad - tLoad) / 1000).toFixed(1)}s（见上）`);

    for (const s of spec.shots) {
      const expr = `(() => { window.orbit.setPose(${JSON.stringify(s.eye)}, ${JSON.stringify(s.tgt)});`
        + ` const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();`
        + ` const cs = getComputedStyle(c);`
        + ` return JSON.stringify({pose: window.orbit.getPose(), aspect: window.camera.aspect,`
        + ` fov: window.camera.fov, dpr: window.devicePixelRatio,`
        + ` canvas: [c.width, c.height], style: [cs.width, cs.height],`
        + ` rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],`
        + ` inner: [window.innerWidth, window.innerHeight]}); })()`;
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      const info = r.result && r.result.value ? r.result.value : '(无返回)';
      await sleep(WAIT);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(OUT, `${s.name}.png`);
      fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
      console.log(stamp(), s.name, (fs.statSync(f).size / 1024).toFixed(0) + 'KB', info);
    }
  } finally {
    try { ws && ws.close(); } catch {}
    cleanup();
  }
}

main().catch((e) => {
  console.error(stamp(), '失败:', e.message);
  process.exit(1);
});