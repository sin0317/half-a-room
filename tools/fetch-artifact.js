// 下载 Reality 重建产物（key 从文件读，不进命令行参数）
// 用法: node tools/fetch-artifact.js <重建ID> <任务ID> <产物名> <输出路径>
const fs = require('fs');
const https = require('https');
const path = require('path');

const CRED = 'C:/Users/10276/.aholo-reality/credentials.json';
const key = JSON.parse(fs.readFileSync(CRED, 'utf8')).api_key;
const HOST = 'studio.aholo3d.cn';

const [rid, jid, name, out] = process.argv.slice(2);
if (!rid || !jid || !name || !out) {
  console.error('用法: node fetch-artifact.js <重建ID> <任务ID> <产物名> <输出路径>');
  process.exit(1);
}

const apiPath = `/api/web-scan/v1/reconstructions/${rid}/jobs/${jid}/artifacts/${name}`;

function request(url, headers, onData) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(request(res.headers.location, {}, onData));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.on('data', onData);
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

(async () => {
  const dir = path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = out + '.part';
  const stream = fs.createWriteStream(tmp);

  const res = await request(`https://${HOST}${apiPath}`, { Authorization: 'Bearer ' + key }, (c) =>
    stream.write(c),
  );
  await new Promise((r) => stream.end(r));
  const size = fs.statSync(tmp).size;
  fs.renameSync(tmp, out);
  console.log(`已下载 ${name} → ${out}  ${size} 字节  (${res.statusCode})`);
})().catch((e) => {
  console.error('下载失败:', e.message);
  process.exit(1);
});
