// 等 Aholo Reality 任务结束，并把产物下载到指定目录。
// key 从凭据文件读，不进命令行参数（见交接文档坑 14）。
// 用法: node tools/wait-job.js <重建ID> <输出目录> [轮数] [间隔秒]
const fs = require('fs');
const https = require('https');
const path = require('path');

const CRED = 'C:/Users/10276/.aholo-reality/credentials.json';
const key = JSON.parse(fs.readFileSync(CRED, 'utf8')).api_key;

const RID = process.argv[2];
const OUT = process.argv[3];
const ROUNDS = parseInt(process.argv[4] || '60', 10);
const INTERVAL = parseInt(process.argv[5] || '30', 10);
const SKIP = (process.argv[6] || ''); // 逗号分隔的不下载文件名

function request(pathname) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        host: 'studio.aholo3d.cn',
        path: pathname,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + key },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
      },
    );
    r.on('error', reject);
    r.setTimeout(120000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}

(async () => {
  for (let i = 0; i < ROUNDS; i++) {
    let it = null;
    try {
      const r = await request(`/api/web-scan/v1/reconstructions/${RID}/jobs`);
      const j = JSON.parse(r.buf.toString('utf8'));
      it = j.items && j.items[0];
    } catch (e) {
      console.log(stamp(), 'query error:', e.message);
    }

    if (!it) {
      console.log(stamp(), 'no job');
      await sleep(INTERVAL);
      continue;
    }

    console.log(
      stamp(),
      it.status,
      it.stage,
      '注册 ' + it.registered_image_count + '/' + it.input_image_count,
      '产物 ' + it.artifacts.length,
    );

    if (it.status === 'succeeded') {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'job.json'), JSON.stringify(it, null, 2));
      const rank = (n) => (n === 'scale.json' ? 0 : n === 'scene.spz' ? 1 : n === 'point_cloud.ply' ? 2 : 3);
      const arts = [...it.artifacts].sort((a, b) => rank(a.name) - rank(b.name));
      for (const a of arts) {
        if (SKIP.split(',').includes(a.name)) {
          console.log(stamp(), 'skip', a.name);
          continue;
        }
        const dest = path.join(OUT, a.name);
        const t0 = Date.now();
        try {
          const res = await request(a.href);
          if (res.status !== 200) throw new Error('HTTP ' + res.status);
          fs.writeFileSync(dest, res.buf);
          console.log(
            stamp(),
            'downloaded',
            a.name,
            (res.buf.length / 1048576).toFixed(1) + 'MB',
            ((Date.now() - t0) / 1000).toFixed(0) + 's',
          );
        } catch (e) {
          console.log(stamp(), 'download FAILED', a.name, e.message);
        }
      }
      console.log('DONE');
      return;
    }

    if (it.status === 'failed') {
      console.log(stamp(), 'FAILED', it.error);
      return;
    }

    await sleep(INTERVAL);
  }
  console.log('轮询结束，任务仍在跑');
})();

function sleep(s) {
  return new Promise((r) => setTimeout(r, s * 1000));
}
function stamp() {
  return new Date().toISOString().slice(11, 19);
}