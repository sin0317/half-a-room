// 轮询 Reality 任务状态（key 从文件读，不进命令行参数）
const fs = require('fs');
const https = require('https');

const CRED = 'C:/Users/10276/.aholo-reality/credentials.json';
const key = JSON.parse(fs.readFileSync(CRED, 'utf8')).api_key;
const RID = process.argv[2] || 'ed9e899d038b4580ec84400718e770b8';
const ROUNDS = parseInt(process.argv[3] || '30', 10);

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: 'studio.aholo3d.cn', path, method: 'GET', headers: { Authorization: 'Bearer ' + key } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('bad json: ' + body.slice(0, 120)));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

(async () => {
  for (let i = 0; i < ROUNDS; i++) {
    try {
      const j = await get(`/api/web-scan/v1/reconstructions/${RID}/jobs`);
      const it = j.items && j.items[0];
      if (!it) {
        console.log(new Date().toISOString(), 'no job');
      } else {
        console.log(
          new Date().toISOString().slice(11, 19),
          it.status,
          it.stage,
          '注册', it.registered_image_count,
          '产物', it.artifacts.length,
          it.error ? 'err=' + it.error : '',
        );
        if (it.status === 'succeeded' || it.status === 'failed') {
          console.log(JSON.stringify(it.artifacts, null, 1));
          return;
        }
      }
    } catch (e) {
      console.log('query error:', e.message);
    }
    await new Promise((r) => setTimeout(r, 20000));
  }
  console.log('轮询结束，任务仍在跑');
})();
