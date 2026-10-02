/* 3D 地球视图(three.js):与 2D 地图共享同一份格点数据与图层状态。
 *  - 地球纹理(2048×1024 等经纬):本地陆地多边形 + 海岸线 + 经纬网
 *  - 标量纹理(768×384):当前图层数值填色,图层/时帧变化时重绘
 *  - 粒子纹理(1024×512):风/海浪拖尾粒子,等经纬空间逐帧推进
 *  - 交互:拖拽旋转 / 滚轮缩放 / 点击查该点预报;空闲 4s 后自转
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { t } from './i18n.js';
import { WIND, WAVES } from './colormaps.js';

const D2R = Math.PI / 180;
const TEX_W = 2048, TEX_H = 1024;
const SCALAR_W = 768, SCALAR_H = 384;
const PART_W = 1024, PART_H = 512;
const N_PARTICLES = 2600;

const xOf = (lon) => (lon + 180) / 360 * TEX_W;
const yOf = (lat) => (90 - lat) / 180 * TEX_H;

export class GlobeView {
  constructor({ getState, toast, openPoint }) {
    this.getState = getState;
    this.toast = toast || (() => {});
    this.openPoint = openPoint || (() => {});
    this.active = false;
    this.inited = false;
    this._raf = 0;
    this._lastT = 0;
    this._idleAt = 0;
    this.cam = { lat: 24, lon: 105, dist: 2.6 };
    this._drag = null;
    this._scalarKey = '';
    this._legendKey = '';
    this._frameBucket = -1;
  }

  toggle() { this.active ? this.hide() : this.show(); }

  show() {
    this.active = true;
    if (!this.wrap) this._buildDom();
    this.wrap.style.display = 'block';
    if (!this.inited) {
      this.inited = true;
      this._initThree();
      this._loadGeo().then(() => this._bakeEarth()).catch((e) => this.toast(t('globe.err', { msg: e.message })));
    }
    this._resize();
    this._loop();
  }

  hide() {
    this.active = false;
    if (this.wrap) this.wrap.style.display = 'none';
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /* ---------- DOM ---------- */
  _buildDom() {
    const wrap = document.createElement('div');
    wrap.id = 'globe-wrap';
    wrap.innerHTML = `
      <div id="globe-legend"><b id="globe-legend-title"></b><i id="globe-legend-bar"></i><span id="globe-legend-labels"></span></div>
      <button id="globe-exit" title="${t('globe.backTitle')}">${t('globe.back')}</button>
      <div id="globe-hint">${t('globe.hint')}</div>`;
    document.body.appendChild(wrap);
    this.wrap = wrap;
    wrap.querySelector('#globe-exit').addEventListener('click', () => this.hide());
  }

  /* ---------- three 场景 ---------- */
  _initThree() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.id = 'globe-canvas';
    this.wrap.insertBefore(renderer.domElement, this.wrap.firstChild);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05090f);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this._placeCamera();

    /* 地球本体 */
    this.earthTex = new THREE.CanvasTexture(this._mkCanvas(TEX_W, TEX_H));
    this.earthTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshBasicMaterial({ map: this.earthTex })
    );
    this.scene.add(earth);
    this.earthMesh = earth;

    /* 标量填色层(略高于球面,透明) */
    this.scalarCanvas = this._mkCanvas(SCALAR_W, SCALAR_H);
    this.scalarTex = new THREE.CanvasTexture(this.scalarCanvas);
    const scalar = new THREE.Mesh(
      new THREE.SphereGeometry(1.001, 96, 64),
      new THREE.MeshBasicMaterial({ map: this.scalarTex, transparent: true, depthWrite: false })
    );
    this.scene.add(scalar);

    /* 粒子层 */
    this.partCanvas = this._mkCanvas(PART_W, PART_H);
    this.partCtx = this.partCanvas.getContext('2d');
    this.partTex = new THREE.CanvasTexture(this.partCanvas);
    const part = new THREE.Mesh(
      new THREE.SphereGeometry(1.002, 96, 64),
      new THREE.MeshBasicMaterial({ map: this.partTex, transparent: true, depthWrite: false })
    );
    this.scene.add(part);

    /* 大气辉光(背面球壳) */
    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.16, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x14456e, side: THREE.BackSide, transparent: true, opacity: 0.28 })
    ));

    this._initParticles();
    this._bindEvents();
  }

  _mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  async _loadGeo() {
    if (this.geo) return this.geo;
    const [land, coast] = await Promise.all([
      fetch(new URL('../geo/land-50m.json', import.meta.url)).then((r) => r.json()),
      fetch(new URL('../geo/ne_50m_coastline.geojson', import.meta.url)).then((r) => r.json()),
    ]);
    this.geo = { land, coast };
    return this.geo;
  }

  /* 烘焙地球底图纹理:海洋 + 陆地填充(跨日面线拆分)+ 海岸线 + 经纬网 */
  _bakeEarth() {
    const ctx = this.earthTex.image.getContext('2d');
    ctx.fillStyle = '#0b1c2e';
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    /* 陆地 */
    ctx.fillStyle = '#1b3148';
    ctx.strokeStyle = 'rgba(90, 130, 170, 0.5)';
    ctx.lineWidth = 1;
    for (const ring of this.geo.land.rings || []) {
      const r = ring.r;
      ctx.beginPath();
      let drawing = false, prevLon = null;
      for (let i = 0; i < r.length; i += 2) {
        const lon = r[i], lat = r[i + 1];
        if (prevLon != null && Math.abs(lon - prevLon) > 180) { // 跨日面线:封口重开
          ctx.stroke(); ctx.closePath();
          ctx.beginPath();
          drawing = false;
        }
        const x = xOf(lon), y = yOf(lat);
        if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
        prevLon = lon;
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    /* 海岸线 */
    ctx.strokeStyle = 'rgba(196, 220, 244, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    for (const f of this.geo.coast.features) {
      const g = f.geometry;
      if (!g) continue;
      const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const part of parts) {
        ctx.beginPath();
        let drawing = false, prevLon = null;
        for (const [lon, lat] of part) {
          if (prevLon != null && Math.abs(lon - prevLon) > 180) { ctx.stroke(); ctx.beginPath(); drawing = false; }
          const x = xOf(lon), y = yOf(lat);
          if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
          prevLon = lon;
        }
        if (drawing) ctx.stroke();
      }
    }

    /* 经纬网(30°) */
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath(); ctx.moveTo(xOf(lon), 0); ctx.lineTo(xOf(lon), TEX_H); ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath(); ctx.moveTo(0, yOf(lat)); ctx.lineTo(TEX_W, yOf(lat)); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(TEX_W, yOf(0)); ctx.stroke();

    this.earthTex.needsUpdate = true;
  }

  /* ---------- 标量填色 ---------- */
  _redrawScalar() {
    const ctx = this.scalarCanvas.getContext('2d');
    ctx.clearRect(0, 0, SCALAR_W, SCALAR_H);
    const s = this.getState();
    const def = s.def;
    if (!s.grid || !def || def.special || !def.cmap || !def.variable) { this.scalarTex.needsUpdate = true; return; }
    const img = ctx.createImageData(SCALAR_W, SCALAR_H);
    const px = img.data;
    const alphaK = Math.max(0.35, Math.min(1, s.opacity));
    let o = 0;
    for (let row = 0; row < SCALAR_H; row++) {
      const lat = 90 - (row + 0.5) / SCALAR_H * 180;
      for (let col = 0; col < SCALAR_W; col++, o += 4) {
        const lon = -180 + (col + 0.5) / SCALAR_W * 360;
        const v = s.grid.sample(def.variable, lon, lat, s.fr);
        if (Number.isNaN(v)) continue;
        const c = def.cmap.color(v);
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
        px[o + 3] = Math.round(c[3] * alphaK);
      }
    }
    ctx.putImageData(img, 0, 0);
    this.scalarTex.needsUpdate = true;
  }

  /* ---------- 粒子(等经纬空间) ---------- */
  _initParticles() {
    this.particles = [];
    for (let i = 0; i < N_PARTICLES; i++) this.particles.push(this._spawn({}));
  }

  _spawn(p = {}) {
    p.lon = -180 + Math.random() * 360;
    p.lat = -85 + Math.random() * 170;
    p.age = 0;
    p.ttl = 40 + Math.random() * 110;
    return p;
  }

  _stepParticles() {
    const ctx = this.partCtx;
    const s = this.getState();
    /* 拖尾衰减 */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.94)';
    ctx.fillRect(0, 0, PART_W, PART_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';

    if (!s.grid || !s.fr) return;
    const def = s.def;
    const isWave = !!def && (def.id === 'wvh' || def.id === 'wvp');
    const colorVar = isWave ? 'wvh' : null;
    const cmap = isWave ? WAVES : WIND;
    const PX = (lon) => (lon + 180) / 360 * PART_W;
    const PY = (lat) => (90 - lat) / 180 * PART_H;

    for (const p of this.particles) {
      p.age++;
      if (p.age > p.ttl) this._spawn(p);
      const uv = s.grid.sampleUV(p.lon, p.lat, s.fr);
      if (!uv) { p.age = p.ttl + 1; continue; }
      const [u, v] = uv;
      /* 度/帧:随纬度做 cos 修正,保证视觉速度均匀 */
      const k = 0.16;
      let dLon = (u * k) / Math.max(Math.cos(p.lat * D2R), 0.15);
      const dLat = -v * k;
      const mag = Math.hypot(dLon, dLat);
      if (mag < 0.02) { p.age = p.ttl + 1; continue; }
      if (mag > 1.2) { dLon *= 1.2 / mag; }
      const spd = colorVar ? s.grid.sample(colorVar, p.lon, p.lat, s.fr) : Math.hypot(u, v);
      const c = cmap.color(spd);
      ctx.strokeStyle = `rgba(${Math.min(255, c[0] + 45)},${Math.min(255, c[1] + 45)},${Math.min(255, c[2] + 45)},0.88)`;
      ctx.beginPath();
      const x0 = PX(p.lon), y0 = PY(p.lat);
      p.lon += dLon; p.lat = Math.max(-88, Math.min(88, p.lat + dLat));
      if (p.lon > 180) p.lon -= 360;
      if (p.lon < -180) p.lon += 360;
      const x1 = PX(p.lon), y1 = PY(p.lat);
      if (Math.abs(x1 - x0) > PART_W / 2) { // 日面线跨界:直接重生,避免横穿线
        this._spawn(p);
        continue;
      }
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    this.partTex.needsUpdate = true;
  }

  /* ---------- 交互 ---------- */
  _bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, y: e.clientY, t: Date.now(), moved: 0 };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      this._drag.moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.32 * (this.cam.dist / 2.6);
      this.cam.lon -= dx * k;
      this.cam.lat = Math.max(-85, Math.min(85, this.cam.lat + dy * k));
      this._idleAt = Date.now();
      this._placeCamera();
    });
    el.addEventListener('pointerup', (e) => {
      const d = this._drag;
      this._drag = null;
      if (d && d.moved < 6 && Date.now() - d.t < 400) this._pick(e);
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(1.35, Math.min(4.5, this.cam.dist * (e.deltaY > 0 ? 1.09 : 0.92)));
      this._idleAt = Date.now();
      this._placeCamera();
    }, { passive: false });
    window.addEventListener('resize', () => this.active && this._resize());
  }

  _placeCamera() {
    const { lat, lon, dist } = this.cam;
    const phi = (lon + 180) * D2R;
    const theta = (90 - lat) * D2R;
    this.camera.position.set(
      -dist * Math.cos(phi) * Math.sin(theta),
      dist * Math.cos(theta),
      dist * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(0, 0, 0);
  }

  /* 点击取点 → 换算经纬度 → 打开点位预报 */
  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hit = rc.intersectObject(this.earthMesh, false)[0];
    if (!hit) return;
    const p = hit.point;
    const lat = Math.asin(Math.max(-1, Math.min(1, p.y / p.length()))) / D2R;
    let lon = Math.atan2(p.z, -p.x) / D2R - 180;
    lon = ((lon + 540) % 360) - 180;
    this.openPoint(+lat.toFixed(3), +lon.toFixed(3));
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------- 主循环 ---------- */
  _loop() {
    if (!this.active) return;
    this._raf = requestAnimationFrame(() => this._loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this._lastT || now)) / 1000);
    this._lastT = now;

    const s = this.getState();
    /* 空闲自转 */
    if (!this._drag && now - this._lastT > 0 && Date.now() - (this._idleAt || 0) > 4000) {
      this.cam.lon += 1.4 * dt;
      this._placeCamera();
    }

    /* 标量层按需重绘:图层/模式/不透明度变化,或时帧跨过 1/4 步 */
    const bucket = s.fr ? Math.floor(s.fr.f * 4) : -1;
    const key = `${s.model}|${s.layer}|${s.opacity}|${s.grid && s.grid.times ? s.grid.times.length : 0}|${bucket}`;
    if (key !== this._scalarKey) {
      this._scalarKey = key;
      this._redrawScalar();
    }
    /* 图例 */
    const lkey = s.layer;
    if (lkey !== this._legendKey) {
      this._legendKey = lkey;
      this._updateLegend(s);
    }

    this._stepParticles();
    this.renderer.render(this.scene, this.camera);
  }

  _updateLegend(s) {
    const def = s.def;
    const title = this.wrap.querySelector('#globe-legend-title');
    const bar = this.wrap.querySelector('#globe-legend-bar');
    const labels = this.wrap.querySelector('#globe-legend-labels');
    if (!def || def.special || !def.cmap) {
      this.wrap.querySelector('#globe-legend').style.display = 'none';
      return;
    }
    this.wrap.querySelector('#globe-legend').style.display = 'flex';
    title.textContent = `${def.label} · ${def.unit}`;
    bar.style.background = def.cmap.gradientCss();
    const stops = def.cmap.stops;
    labels.innerHTML = [0, 0.5, 1].map((f) => {
      const v = stops[Math.round(f * (stops.length - 1))][0];
      return `<span>${def.fmt(v)}</span>`;
    }).join('');
  }
}
