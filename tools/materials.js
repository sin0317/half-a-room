// 仓库素材工具：只用 ASCII 路径片段定位目录，避免命令行里的中文被改写
const fs = require('fs');
const path = require('path');

const root = process.cwd();

/** 找到根目录下含有 reconstruct 子目录的那个目录（素材/） */
function findMaterialsDir() {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const rc = path.join(root, e.name, 'reconstruct');
    if (fs.existsSync(rc)) return { dir: path.join(root, e.name), reconstruct: rc };
  }
  throw new Error('找不到素材目录');
}

/** 在目录树里按文件名递归查找 */
function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return null;
}

/**
 * 按关键字定位某个版本目录。
 *
 * ⚠️ 必须用 readdir 返回的原始名字去拼路径，不能自己写字符串再 path.join：
 * 本机 bash/Node 对含中文的路径字面量有概率被改写，导致 existsSync 返回 false、
 * readdir 却能列出同一个目录。全部从 fs.readdirSync 的结果取名字就不会踩。
 */
function findVersionDir(reconstruct, keyword) {
  for (const e of fs.readdirSync(reconstruct, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.includes(keyword)) {
      return path.join(reconstruct, e.name);
    }
  }
  return null;
}

function human(p) {
  return (fs.statSync(p).size / 1048576).toFixed(1) + 'MB';
}

module.exports = { root, findMaterialsDir, findFile, human };

if (require.main === module) {
  const cmd = process.argv[2];
  const { reconstruct } = findMaterialsDir();

  if (cmd === 'list') {
    console.log('reconstruct 下的版本:');
    for (const e of fs.readdirSync(reconstruct, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const spz = findFile(path.join(reconstruct, e.name), 'scene.spz');
      const ply = findFile(path.join(reconstruct, e.name), 'point_cloud.ply');
      const sj = findFile(path.join(reconstruct, e.name), 'scale.json');
      console.log(
        '  ' + e.name.padEnd(18),
        'spz=' + (spz ? human(spz) : '-').padEnd(10),
        'ply=' + (ply ? human(ply) : '-').padEnd(10),
        'scale=' + (sj ? '有' : '无'),
      );
    }
  }

  if (cmd === 'copy') {
    const [version, destRel] = process.argv.slice(3);
    const vdir = findVersionDir(reconstruct, version);
    const src = vdir ? findFile(vdir, 'scene.spz') : null;
    if (!src) throw new Error('找不到 ' + version + ' 的 scene.spz');
    const dst = path.join(root, destRel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('已复制', version, '→', destRel, human(dst));
  }

  if (cmd === 'rm') {
    const rel = process.argv[3];
    const p = path.join(root, rel);
    if (fs.existsSync(p)) {
      console.log('删除', rel, human(p));
      fs.unlinkSync(p);
    } else {
      console.log('不存在，跳过:', rel);
    }
  }
}
