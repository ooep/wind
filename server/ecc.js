/*
 * ecc.py 桥:把单条 GRIB2 消息交给 python3+eccodes 解码(JS 解码器不认识的
 * 数据表示模板,如 ECMWF 新输出的 5.42 CCSDS 压缩,兜底用)。
 * 返回与 grib2.js decodeMessage 同构的 { grid, values },调用方零改动。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PY = process.env.ECC_PY || 'python3';

function eccDecode(msg) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `ecc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.grib`);
    fs.writeFileSync(tmp, msg);
    execFile(PY, [path.join(__dirname, 'ecc.py'), tmp], { maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      fs.unlink(tmp, () => {});
      if (err) {
        reject(new Error(`ecc 解码失败: ${(stderr || err.message).toString().slice(0, 200)}`));
        return;
      }
      try {
        const nl = stdout.indexOf('\n');
        const meta = JSON.parse(stdout.subarray ? stdout.subarray(0, nl).toString('utf8') : stdout.slice(0, nl).toString('utf8'));
        const body = stdout.subarray ? stdout.subarray(nl + 1) : stdout.slice(nl + 1);
        const f32 = new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength / 4 * 4), 0, body.byteLength >> 2);
        if (f32.length !== meta.ni * meta.nj) throw new Error(`ecc 数值数 ${f32.length} ≠ ${meta.ni}×${meta.nj}`);
        resolve({
          grid: {
            ni: meta.ni, nj: meta.nj, nPoints: meta.ni * meta.nj,
            la1: meta.la1, lo1: meta.lo1, la2: meta.la2, lo2: meta.lo2,
            dlon: meta.dlon, dlat: meta.dlat, scan: meta.scan,
          },
          values: f32,
        });
      } catch (e) {
        reject(new Error(`ecc 输出解析失败: ${e.message}`));
      }
    });
  });
}

module.exports = { eccDecode };
