/*
 * GRIB2 解码器(纯 JS,零依赖)
 * 支持:GDT 3.0(规则经纬度网格)、PDT 4.0/4.8、DRT 5.0(简单打包)/
 * 5.2(复杂打包)/ 5.3(复杂打包+空间差分)、位图段。
 *
 * 兼容 NCEP(GFS)的两个实现偏差(经真实数据校准):
 *  1. 组长度参考为 4 字节(规范为 6 字节)→ 解析时两种布局自动探测(判据:组长度总和 == 数据点数)
 *  2. 数值公式为 (R + X×2^E)×10^-D(规范为 R + X×2^E×10^-D)
 */
'use strict';

const EARTH_R = 6371.229; // GFS 使用的地球半径(km),仅元数据用

function u1(buf, o) { return buf[o]; }
function u2(buf, o) { return (buf[o] << 8) | buf[o + 1]; }
function u4(buf, o) { return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0; }

/* GRIB2 约定:1/2/4 字节有符号整数 = 符号位 + 幅值(非补码) */
function int1(buf, o) { const v = buf[o]; return (v & 0x80) ? -(v & 0x7f) : v; }
function int2(buf, o) { const v = u2(buf, o); return (v & 0x8000) ? -(v & 0x7fff) : v; }
function int4(buf, o) { const v = u4(buf, o); return (v & 0x80000000) ? -(v & 0x7fffffff) : v; }

/* MSB 在前的位流读取器 */
class BitReader {
  constructor(buf, byteOffset) {
    this.buf = buf; this.o = byteOffset; this.bit = 0;
  }
  read(nbits) {
    let v = 0;
    for (let i = 0; i < nbits; i++) {
      v = (v << 1) | ((this.buf[this.o + (this.bit >> 3)] >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return v;
  }
  /* 对齐到字节边界(GRIB2 复杂打包的各子流之间按字节对齐) */
  align() {
    if (this.bit & 7) this.bit += 8 - (this.bit & 7);
  }
}

/* 定位一个 buffer 内所有 GRIB2 消息 */
function findMessages(buf) {
  const msgs = [];
  let i = 0;
  while (i < buf.length - 15) {
    if (buf[i] === 0x47 && buf[i + 1] === 0x52 && buf[i + 2] === 0x49 && buf[i + 3] === 0x42) {
      const total = Number(buf.readBigUInt64BE(i + 8));
      if (total > 0 && i + total <= buf.length) {
        msgs.push(buf.subarray(i, i + total));
        i += total;
        continue;
      }
    }
    i++;
  }
  return msgs;
}

/* 解析一个 GRIB2 消息 */
function decodeMessage(msg) {
  let o = 16;
  let gdt = null, pdt = null, drt = null, bitmap = null, data = null;
  while (o < msg.length - 4) {
    const secLen = u4(msg, o);
    const secNum = msg[o + 4];
    if (secLen < 5) break;
    if (secNum === 3) gdt = parseGDS(msg, o);
    else if (secNum === 4) pdt = parsePDS(msg, o);
    else if (secNum === 5) drt = parseDRS(msg, o);
    else if (secNum === 6) bitmap = parseBitmap(msg, o, secLen);
    else if (secNum === 7) data = msg.subarray(o + 5, o + secLen);
    else if (secNum === 8) break;
    o += secLen;
  }
  if (!gdt || !drt || !data) throw new Error('GRIB2 消息不完整');
  const values = unpackValues(drt, data, bitmap, gdt.nPoints);
  return { grid: gdt, meta: pdt, values };
}

/* 第 3 段:网格定义(模板 3.0 规则经纬度) */
function parseGDS(buf, o) {
  const template = u2(buf, o + 12);
  if (template !== 0) throw new Error(`不支持的网格模板 3.${template}(仅支持经纬度网格)`);
  const ni = u4(buf, o + 30);
  const nj = u4(buf, o + 34);
  const basicAngle = u4(buf, o + 38);
  const subdivisions = u4(buf, o + 42);
  const unit = basicAngle === 0 ? 1e-6 : basicAngle / (subdivisions || 1);
  return {
    template, ni, nj, nPoints: ni * nj,
    la1: int4(buf, o + 46) * unit,
    lo1: int4(buf, o + 50) * unit,
    la2: int4(buf, o + 55) * unit,
    lo2: int4(buf, o + 59) * unit,
    dlon: int4(buf, o + 63) * unit, // Di(oct64-67)
    dlat: int4(buf, o + 67) * unit, // Dj(oct68-71)
    scan: u1(buf, o + 71),          // oct72
  };
}

/* 第 4 段:产品定义(变量标识) */
function parsePDS(buf, o) {
  const template = u2(buf, o + 7);
  return {
    template,
    category: buf[o + 9],
    number: buf[o + 10],
    surfaceType: buf[o + 22],
  };
}

/* 第 5 段:数据表示模板 */
function parseDRS(buf, o) {
  const nValues = u4(buf, o + 5);
  const template = u2(buf, o + 9);
  const drt = {
    nValues, template,
    refValue: buf.readFloatBE(o + 11),
    binaryScale: int2(buf, o + 15),
    decimalScale: int2(buf, o + 17),
    bitsPerValue: buf[o + 19],
  };
  if (template === 2 || template === 3) {
    drt.complex = {
      missingValueMgmt: buf[o + 21],
      nGroups: u4(buf, o + 31),
      groupWidthRef: buf[o + 35],
      groupWidthBits: buf[o + 36],
    };
    /* 尾部布局(NCEP 4 字节组长度参考 vs 规范 6 字节)两种候选,
       解包时按「组长度总和 == 数据点数」自动选择 */
    drt.complex.tails = [];
    if (template === 3) {
      drt.complex.tails.push({ // NCEP
        lenRef: u4(buf, o + 37), inc: buf[o + 41],
        lastLen: u4(buf, o + 42), lenBits: buf[o + 46],
        order: buf[o + 47], extraOctets: buf[o + 48], ncep: true,
      });
      drt.complex.tails.push({ // 规范
        lenRef: readUint48(buf, o + 37), inc: buf[o + 43],
        lastLen: u4(buf, o + 44), lenBits: buf[o + 48],
        order: buf[o + 49], extraOctets: buf[o + 50], ncep: false,
      });
    } else {
      drt.complex.tails.push({ lenRef: u4(buf, o + 37), inc: buf[o + 41], lastLen: u4(buf, o + 42), lenBits: buf[o + 46] });
      drt.complex.tails.push({ lenRef: readUint48(buf, o + 37), inc: buf[o + 43], lastLen: u4(buf, o + 44), lenBits: buf[o + 48] });
    }
  }
  return drt;
}

function readUint48(buf, o) {
  let v = 0;
  for (let i = 0; i < 6; i++) v = v * 256 + buf[o + i];
  return v;
}

function parseBitmap(buf, o, secLen) {
  const indicator = buf[o + 5];
  if (indicator === 255) return null;
  if (indicator === 0) return { bits: buf.subarray(o + 6, o + secLen) };
  throw new Error(`不支持的位图指示 ${indicator}`);
}

/* 按模板解包数值 */
function unpackValues(drt, data, bitmap, nPoints) {
  const { template, refValue, binaryScale, decimalScale, bitsPerValue } = drt;
  let raw; // 重建后的整型域值(未应用位图)

  if (template === 0) {
    // NCEP 变体公式与 5.3 一致:(R + X×2^E)×10^-D
    const scale = Math.pow(2, binaryScale);
    const dscale = Math.pow(10, -decimalScale);
    const out = new Float32Array(nPoints);
    if (bitsPerValue === 0) {
      out.fill((refValue) * dscale);
    } else {
      const br = new BitReader(data, 0);
      for (let i = 0; i < nPoints; i++) out[i] = (refValue + br.read(bitsPerValue) * scale) * dscale;
    }
    return applyBitmap(out, bitmap, nPoints);
  }
  if (template === 2 || template === 3) {
    raw = unpackComplex(drt, data);
  } else {
    throw new Error(`不支持的数据表示模板 5.${template}`);
  }

  // NCEP 变体数值公式:(R + X×2^E)×10^-D
  const scale = Math.pow(2, binaryScale);
  const dscale = Math.pow(10, -decimalScale);
  const out = new Float32Array(nPoints);
  if (bitmap) {
    let vi = 0;
    for (let p = 0; p < nPoints; p++) {
      const valid = (bitmap.bits[p >> 3] >> (7 - (p & 7))) & 1;
      if (valid) out[p] = (refValue + raw[vi++] * scale) * dscale;
      else out[p] = NaN;
    }
  } else {
    for (let p = 0; p < nPoints; p++) out[p] = (refValue + raw[p] * scale) * dscale;
  }
  return out;
}

function applyBitmap(values, bitmap, nPoints) {
  if (!bitmap) return values;
  const out = new Float32Array(nPoints);
  let vi = 0;
  for (let p = 0; p < nPoints; p++) {
    const valid = (bitmap.bits[p >> 3] >> (7 - (p & 7))) & 1;
    out[p] = valid ? values[vi++] : NaN;
  }
  return out;
}

/* 复杂打包(5.2)/ 复杂打包+空间差分(5.3)
 * 数值公式(NCEP 变体):(R + X×2^E)×10^-D,在 unpackValues 中应用。
 */
function unpackComplex(drt, data) {
  const c = drt.complex;
  const NV = drt.nValues;
  if (drt.bitsPerValue === 0 || c.nGroups === 0) {
    return new Float64Array(NV).fill(0);
  }
  const NG = c.nGroups;

  function tryTail(tail) {
    const { lenRef, inc, lastLen, lenBits: lenBitsN, order, extraOctets } = tail;
    if (!(inc > 0) || lenBitsN > 24 || lenBitsN === 0) return null;
    if (drt.template === 3 && order !== 1 && order !== 2) return null;
    if (extraOctets > 8) return null;

    const br = new BitReader(data, 0);
    // 空间差分附加描述符
    let ival1 = 0, ival2 = 0, minsd = 0;
    if (drt.template === 3) {
      const vals = [];
      for (let i = 0; i < order + 1; i++) {
        const off = br.o + i * extraOctets;
        let v = 0;
        const neg = (data[off] & 0x80) !== 0;
        for (let k = 0; k < extraOctets; k++) v = v * 256 + (k === 0 ? data[off + k] & 0x7f : data[off + k]);
        vals.push(neg ? -v : v);
      }
      ival1 = vals[0];
      if (order === 2) ival2 = vals[1];
      minsd = vals[vals.length - 1];
      br.o += (order + 1) * extraOctets;
    }

    // 组参考值(读毕按字节对齐)
    const gRef = new Int32Array(NG);
    for (let g = 0; g < NG; g++) gRef[g] = br.read(drt.bitsPerValue);
    br.align();
    // 组宽度
    const gW = new Int32Array(NG);
    if (c.groupWidthBits > 0) {
      for (let g = 0; g < NG; g++) gW[g] = br.read(c.groupWidthBits) + c.groupWidthRef;
    } else {
      gW.fill(c.groupWidthRef);
    }
    br.align();
    // 组长度
    const gL = new Int32Array(NG);
    for (let g = 0; g < NG; g++) gL[g] = br.read(lenBitsN) * inc + lenRef;
    gL[NG - 1] = lastLen;
    br.align();

    let sum = 0;
    for (let g = 0; g < NG; g++) { sum += gL[g]; if (gL[g] < 0) return null; }
    if (sum !== NV) return null; // 布局判据

    // 解包数据
    const packed = new Float64Array(NV);
    let p = 0;
    for (let g = 0; g < NG && p < NV; g++) {
      const w = gW[g], ref = gRef[g];
      if (w === 0) {
        for (let k = 0; k < gL[g] && p < NV; k++) packed[p++] = ref;
      } else {
        for (let k = 0; k < gL[g] && p < NV; k++) packed[p++] = ref + br.read(w);
      }
    }
    if (p !== NV) return null;

    // 空间差分还原(与 NCEP g2clib comunpack 一致:加回 overall min 后递推)
    const out = new Float64Array(NV);
    if (drt.template === 3) {
      if (order === 1) {
        out[0] = ival1;
        for (let i = 1; i < NV; i++) out[i] = out[i - 1] + (packed[i] + minsd);
      } else {
        out[0] = ival1;
        if (NV > 1) out[1] = ival2;
        for (let i = 2; i < NV; i++) out[i] = (packed[i] + minsd) + 2 * out[i - 1] - out[i - 2];
      }
    } else {
      for (let i = 0; i < NV; i++) out[i] = packed[i];
    }
    return out;
  }

  for (const tail of c.tails) {
    const out = tryTail(tail);
    if (out) return out;
  }
  return null;
}

module.exports = { findMessages, decodeMessage };
