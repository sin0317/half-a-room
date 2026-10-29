// 从 job.json 读取产物链接并下载。
// 产物链接会 302 跳到对象存储，需要跟随重定向；key 只发给 studio 域名。
// 用法: node tools/dl-artifacts.js <输出目录>
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

const CRED = 'C:/Users/10276/.aholo-reality/credentials.json';
const key = JSON.parse(fs.readFileSync(CRED, 'utf8')).api_key;

const OUT = process.argv[2];
const job = JSON.parse(fs.readFileSync(path.join(OUT, 'job.json'), 'utf8'));
const BASE = 'https://studio.aholo3d.cn';

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

function stream(urlStr, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const headers = {};
    if (u.hostname === 'studio.aholo3d.cn') headers.Authorization = 'Bearer ' + key;
    const r = mod.request(
      {
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'GET',
        headers,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (depth > 6) return reject(new Error('too many redirects'));
          return stream(new URL(res.headers.location, urlStr).toString(), dest, depth + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const ws = fs.createWriteStream(dest);
        let bytes = 0;
        res.on('data', (c) => (bytes += c.length));
        res.pipe(ws);
        ws.on('finish', () => resolve(bytes));
        ws.on('error', reject);
      },
    );
    r.on('error', reject);
    r.setTimeout(600000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}

(async () => {
  const rank = (n) => (n === 'scale.json' ? 0 : n === 'scene.spz' ? 1 : n === 'point_cloud.ply' ? 2 : 3);
  const arts = [...job.artifacts].sort((a, b) => rank(a.name) - rank(b.name));
  for (const a of arts) {
    const dest = path.join(OUT, a.name);
    const url = a.href.startsWith('http') ? a.href : BASE + a.href;
    const t0 = Date.now();
    try {
      const n = await stream(url, dest);
      console.log(stamp(), 'downloaded', a.name, (n / 1048576).toFixed(1) + 'MB', ((Date.now() - t0) / 1000).toFixed(0) + 's');
    } catch (e) {
      console.log(stamp(), 'FAILED', a.name, e.message);
    }
  }
  console.log('ALL DONE');
})();