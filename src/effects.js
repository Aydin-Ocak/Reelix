/* Reelix — görüntü efektleri: filtre, ayarla, video efekti, hareket (Ken Burns) ve giriş/çıkış animasyonu.
   Tek kaynak: her işlem ffmpeg ifadesi / renk matrisi olarak tanımlanır; önizleme (canvas) aynı değerlerden çizer,
   dışa aktarma aynı değerlerden ffmpeg filtresi üretir. Böylece önizleme ile çıktı aynı görünür.

   Öğe üzerindeki veri (değiştirilirken her zaman yeni nesne atanır, yerinde değiştirilmez):
   fx = {filter: {id, k}, adj: {bri, con, sat, temp, tint, sharp, vig, grain}, eff: {id, k},
         motion: {id, k}, animIn: {id, d}, animOut: {id, d}} */

const FX_FILTERS = [
  {id: 'cine',   name: 'Sinematik',    ops: [['con', 1.15], ['sat', 0.85], ['temp', 0.25], ['lift', 0.03]]},
  {id: 'cold',   name: 'Soğuk',        ops: [['temp', -0.6], ['sat', 0.9], ['con', 1.05]]},
  {id: 'warm',   name: 'Sıcak',        ops: [['temp', 0.6], ['sat', 1.1]]},
  {id: 'bw',     name: 'Siyah-beyaz',  ops: [['sat', 0], ['con', 1.2]]},
  {id: 'sepia',  name: 'Sepya',        ops: [['sepia', 1], ['con', 1.05]]},
  {id: 'faded',  name: 'Solgun film',  ops: [['lift', 0.12], ['sat', 0.75], ['con', 0.9]]},
  {id: 'night',  name: 'Gece',         ops: [['temp', -0.5], ['bri', -0.08], ['sat', 0.7], ['con', 1.1]]},
  {id: 'horror', name: 'Korku',        ops: [['sat', 0.35], ['temp', -0.3], ['tint', -0.3], ['con', 1.3]]},
  {id: 'vivid',  name: 'Canlı',        ops: [['sat', 1.45], ['con', 1.1]]},
  {id: 'retro',  name: 'Retro',        ops: [['sepia', 0.35], ['lift', 0.06], ['sat', 1.1], ['temp', 0.3]]},
];
const FX_EFFECTS = [
  {id: 'blur',   name: 'Bulanıklık'},
  {id: 'shake',  name: 'Titreme'},
  {id: 'glitch', name: 'Glitch'},
  {id: 'vhs',    name: 'VHS'},
  {id: 'leak',   name: 'Işık sızıntısı'},
  {id: 'flash',  name: 'Flaş'},
  {id: 'bars',   name: 'Sinema bantları'},
];
const FX_MOTIONS = [
  {id: 'zoomin', name: 'Yakınlaş'}, {id: 'zoomout', name: 'Uzaklaş'},
  {id: 'left', name: 'Sola kaydır'}, {id: 'right', name: 'Sağa kaydır'},
  {id: 'up', name: 'Yukarı kaydır'}, {id: 'down', name: 'Aşağı kaydır'},
];
const FX_ANIMS = [{id: 'fade', name: 'Belirme'}, {id: 'zoom', name: 'Yakınlaşma'}];
// [anahtar, etiket, en az, en çok]; renk ayarları katmanlarda da kullanılır
const FX_ADJ = [
  ['bri', 'Parlaklık', -100, 100], ['con', 'Kontrast', -100, 100], ['sat', 'Doygunluk', -100, 100],
  ['temp', 'Sıcaklık', -100, 100], ['tint', 'Ton', -100, 100],
  ['sharp', 'Keskinlik', 0, 100], ['vig', 'Vinyet', 0, 100], ['grain', 'Gren', 0, 100],
];
const FX_COLOR_ADJ = ['bri', 'con', 'sat', 'temp', 'tint'];
const fxName = (list, id) => (list.find(x => x.id === id) || {name: ''}).name;

// fx nesnesini güncelle: null/boş alanlar silinir, hiçbir şey kalmazsa fx kaldırılır
function setFx(item, patch){
  const fx = {...(item.fx || {}), ...patch};
  for (const k in fx) if (fx[k] == null) delete fx[k];
  if (fx.adj){ const a = {}; for (const k in fx.adj) if (fx.adj[k]) a[k] = fx.adj[k]; if (Object.keys(a).length) fx.adj = a; else delete fx.adj; }
  if (Object.keys(fx).length) item.fx = fx; else delete item.fx;
}
const hasFx = it => !!(it && it.fx);

/* ---------- Renk matrisi (3×4 afin: [rr rg rb ro, gr gg gb go, br bg bb bo], ofsetler 0–1) ---------- */
const M_I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mMul(A, B){   // önce B, sonra A
  const R = new Array(12);
  for (let i = 0; i < 3; i++){
    for (let j = 0; j < 3; j++) R[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
    R[i * 4 + 3] = A[i * 4] * B[3] + A[i * 4 + 1] * B[7] + A[i * 4 + 2] * B[11] + A[i * 4 + 3];
  }
  return R;
}
const mLerp = (M, k) => M.map((v, i) => M_I[i] + (v - M_I[i]) * k);
function mOp(op, v){
  switch (op){
    case 'bri':  return [1, 0, 0, v, 0, 1, 0, v, 0, 0, 1, v];
    case 'con':  { const o = 0.5 * (1 - v); return [v, 0, 0, o, 0, v, 0, o, 0, 0, v, o]; }
    case 'lift': return [1 - v, 0, 0, v, 0, 1 - v, 0, v, 0, 0, 1 - v, v];
    case 'sat':  { const r = 0.2126 * (1 - v), g = 0.7152 * (1 - v), b = 0.0722 * (1 - v);
                   return [r + v, g, b, 0, r, g + v, b, 0, r, g, b + v, 0]; }
    case 'temp': return [1 + 0.18 * v, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 - 0.18 * v, 0];
    case 'tint': return [1 + 0.06 * v, 0, 0, 0, 0, 1 - 0.12 * v, 0, 0, 0, 0, 1 + 0.06 * v, 0];
    case 'sepia': return mLerp([0.393, 0.769, 0.189, 0, 0.349, 0.686, 0.168, 0, 0.272, 0.534, 0.131, 0], v);
  }
  return M_I;
}
const mOps = ops => ops.reduce((M, [op, v]) => mMul(mOp(op, v), M), M_I);
function fxMatrix(fx){
  if (!fx) return null;
  let M = M_I;
  const f = fx.filter && FX_FILTERS.find(x => x.id === fx.filter.id);
  if (f) M = mLerp(mOps(f.ops), fx.filter.k ?? 1);
  const a = fx.adj || {};
  if (a.bri) M = mMul(mOp('bri', a.bri / 100 * 0.25), M);
  if (a.con) M = mMul(mOp('con', 1 + a.con / 100 * 0.6), M);
  if (a.sat) M = mMul(mOp('sat', 1 + a.sat / 100), M);
  if (a.temp) M = mMul(mOp('temp', a.temp / 100), M);
  if (a.tint) M = mMul(mOp('tint', a.tint / 100), M);
  if (fx.eff && fx.eff.id === 'vhs') M = mMul(mLerp(mOps([['sat', 0.8], ['lift', 0.04]]), fx.eff.k), M);
  return M.every((v, i) => Math.abs(v - M_I[i]) < 1e-4) ? null : M;
}

/* ---------- Efekt parametreleri (önizleme ve çıktı ortak) ---------- */
function fxParams(fx, video = true){
  const a = (fx && fx.adj) || {}, e = fx && fx.eff, k = e ? e.k : 0, id = e && video ? e.id : null;
  return {
    M: fxMatrix(video ? fx : fx && {filter: fx.filter, adj: Object.fromEntries(FX_COLOR_ADJ.map(x => [x, a[x]]))}),
    sharp: video ? (a.sharp || 0) / 100 * 0.8 : 0,                         // çekirdek ağırlığı
    rgb: id === 'glitch' ? 0.012 * k : id === 'vhs' ? 0.005 * k : 0,      // kare genişliğine oran
    blur: id === 'blur' ? 0.012 * k : 0,                                    // kare yüksekliğine oran (sigma)
    grain: video ? Math.min(100, (a.grain || 0) + (id === 'vhs' ? 30 * k : 0)) : 0,
    vig: video ? (a.vig || 0) / 100 * 0.85 : 0,
    flash: id === 'flash' ? `${(0.9 * k).toFixed(3)}*exp(-5*t)` : null,    // eklenen beyaz miktarı
    leak: id === 'leak' ? k : 0,
    scan: id === 'vhs' ? k : 0,
    bars: id === 'bars' ? 0.12 * k : 0,                                     // her bandın yüksekliği / kare yüksekliği
  };
}
const n4 = v => (+v).toFixed(4);
// kamera: yakınlaştırma (z ≥ 1) ve kaydırma (x, y: karenin oranı) ifadeleri; yoksa null
function fxCamera(fx, len){
  if (!fx) return null;
  const zs = [], xs = [], ys = [], L = n4(len);
  const m = fx.motion;
  if (m){
    const a = 0.05 + 0.25 * m.k, p = `min(1,t/${L})`, h = n4(a / 2);
    if (m.id === 'zoomin') zs.push(`1+${n4(a)}*${p}`);
    else if (m.id === 'zoomout') zs.push(`1+${n4(a)}*(1-${p})`);
    else {
      zs.push(n4(1 + a));
      if (m.id === 'left') xs.push(`${h}*(2*${p}-1)`); if (m.id === 'right') xs.push(`${h}*(1-2*${p})`);
      if (m.id === 'up') ys.push(`${h}*(2*${p}-1)`); if (m.id === 'down') ys.push(`${h}*(1-2*${p})`);
    }
  }
  const e = fx.eff;
  if (e && e.id === 'shake'){
    zs.push(n4(1 + 0.06 * e.k));
    xs.push(`${n4(0.02 * e.k)}*sin(t*29)+${n4(0.012 * e.k)}*sin(t*47)`); ys.push(`${n4(0.02 * e.k)}*cos(t*23)`);
  }
  if (e && e.id === 'glitch'){
    zs.push(n4(1 + 0.08 * e.k));
    xs.push(`if(gt(mod(abs(sin(floor(t*10)*12.9898))*43758.5453,1),0.8),${n4(0.04 * e.k)}*(mod(abs(sin(floor(t*10)*78.233))*43758.5453,1)*2-1),0)`);
  }
  if (fx.animIn && fx.animIn.id === 'zoom') zs.push(`1+0.2*pow(1-min(1,t/${n4(fx.animIn.d)}),3)`);
  if (fx.animOut && fx.animOut.id === 'zoom') zs.push(`1+0.2*pow(1-max(0,min(1,(${L}-t)/${n4(fx.animOut.d)})),3)`);
  if (!zs.length && !xs.length && !ys.length) return null;
  return {z: zs.length ? zs.map(z => `(${z})`).join('*') : '1', x: xs.join('+') || '0', y: ys.join('+') || '0'};
}
// giriş/çıkış animasyonu: siyaha (ana iz) veya saydamlığa (katman) sönme oranı
function fxFadeAt(fx, t, len){
  let a = 1;
  if (fx && fx.animIn && fx.animIn.id === 'fade') a *= clamp(t / fx.animIn.d, 0, 1);
  if (fx && fx.animOut && fx.animOut.id === 'fade') a *= clamp((len - t) / fx.animOut.d, 0, 1);
  return a;
}

/* ---------- ffmpeg ifadelerini önizlemede çalıştır ---------- */
const FX_FN = {sin: Math.sin, cos: Math.cos, exp: Math.exp, floor: Math.floor, abs: Math.abs, min: Math.min, max: Math.max,
  pow: Math.pow, mod: (a, b) => a % b, gt: (a, b) => a > b ? 1 : 0, lt: (a, b) => a < b ? 1 : 0, IF: (c, a, b) => c ? a : b};
const exprCache = new Map();
function evalExpr(s, t){
  let f = exprCache.get(s);
  if (!f){
    f = new Function(...Object.keys(FX_FN), 't', `return (${s.replace(/\bif\(/g, 'IF(')});`);
    if (exprCache.size > 500) exprCache.clear();
    exprCache.set(s, f);
  }
  return f(...Object.values(FX_FN), t);
}

/* ---------- Önizleme (canvas) ---------- */
const svgNS = 'http://www.w3.org/2000/svg';
let fxSvg = null; const svgFilters = new Map();
function svgFilterId(M, sharp, rgbPx){
  const key = [M ? M.map(v => v.toFixed(4)).join(' ') : '', sharp.toFixed(3), rgbPx.toFixed(2)].join('|');
  if (svgFilters.has(key)) return svgFilters.get(key);
  if (!fxSvg){ fxSvg = document.createElementNS(svgNS, 'svg'); fxSvg.setAttribute('width', 0); fxSvg.setAttribute('height', 0);
    fxSvg.style.position = 'absolute'; document.body.appendChild(fxSvg); }
  if (svgFilters.size > 300){ fxSvg.innerHTML = ''; svgFilters.clear(); }
  const id = 'fx' + svgFilters.size + '_' + Math.random().toString(36).slice(2, 6);
  const m = M || M_I, cm = `${m[0]} ${m[1]} ${m[2]} 0 ${m[3]} ${m[4]} ${m[5]} ${m[6]} 0 ${m[7]} ${m[8]} ${m[9]} ${m[10]} 0 ${m[11]} 0 0 0 1 0`;
  let h = `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">`;
  h += `<feColorMatrix type="matrix" values="${cm}" result="c"/>`;
  let last = 'c';
  if (sharp > 0){ const s = sharp; h += `<feConvolveMatrix in="c" order="3" kernelMatrix="0 ${-s} 0 ${-s} ${1 + 4 * s} ${-s} 0 ${-s} 0" preserveAlpha="true" edgeMode="duplicate" result="s"/>`; last = 's'; }
  if (rgbPx > 0){
    h += `<feColorMatrix in="${last}" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/><feOffset in="r" dx="${rgbPx}" result="ro"/>`;
    h += `<feColorMatrix in="${last}" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>`;
    h += `<feColorMatrix in="${last}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/><feOffset in="b" dx="${-rgbPx}" result="bo"/>`;
    h += `<feBlend in="ro" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="bo" mode="screen"/>`;
  }
  h += '</filter>';
  fxSvg.insertAdjacentHTML('beforeend', h);
  svgFilters.set(key, id);
  return id;
}
function canvasFilter(p, W, H){
  const parts = [];
  if (p.M || p.sharp > 0 || p.rgb > 0) parts.push(`url(#${svgFilterId(p.M, p.sharp, p.rgb * W)})`);
  if (p.blur > 0) parts.push(`blur(${(p.blur * H).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}
let grainTile = null;
function getGrain(){
  if (grainTile) return grainTile;
  grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 256;
  const g = grainTile.getContext('2d'), d = g.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4){ const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); return grainTile;
}
// kenar karartması, ışık sızıntısı ve tarama çizgileri: dışa aktarmada aynı fonksiyonlarla PNG üretilir
function drawVignette(g, W, H, amt){
  const r = Math.hypot(W, H) / 2, gr = g.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${amt})`);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
const LEAK_X = '0.35*sin(t*0.9)';
function drawLeak(g, cx, W, H, k){
  const r = 0.9 * W, gr = g.createRadialGradient(cx, H * 0.3, 0, cx, H * 0.3, r);
  gr.addColorStop(0, `rgba(255,160,70,${0.55 * k})`); gr.addColorStop(0.45, `rgba(255,90,40,${0.25 * k})`); gr.addColorStop(1, 'rgba(255,60,30,0)');
  g.fillStyle = gr; g.fillRect(cx - r, 0, 2 * r, H);
}
function drawScan(g, W, H, k){
  const step = Math.max(2, Math.round(H / 180)), th = Math.max(1, Math.round(step / 3));
  g.fillStyle = `rgba(0,0,0,${0.35 * k})`;
  for (let y = 0; y < H; y += step) g.fillRect(0, y, W, th);
}
// klibi efektleriyle çiz. drawBase(g): kareyi siyah zeminle çizer. t: klibin kendi zamanı
function drawWithFx(g, fx, t, len, W, H, drawBase, fps = 30){
  if (!fx){ drawBase(g); return; }
  const p = fxParams(fx), cam = fxCamera(fx, len);
  g.save();
  if (cam){
    const z = Math.max(1, evalExpr(cam.z, t)), lim = (z - 1) / 2;
    const x = clamp(evalExpr(cam.x, t), -lim, lim), y = clamp(evalExpr(cam.y, t), -lim, lim);
    g.translate(W / 2 - x * W, H / 2 - y * H); g.scale(z, z); g.translate(-W / 2, -H / 2);
  }
  g.filter = canvasFilter(p, W, H);
  drawBase(g);
  g.restore();
  g.save();
  if (p.grain > 0){   // kareye göre kayan gürültü: duraklatınca sabit kalır
    const f = Math.floor(t * fps), ox = (f * 97) % 256, oy = (f * 57) % 256;
    g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = p.grain / 100 * 0.45;
    g.translate(-ox, -oy); g.fillStyle = g.createPattern(getGrain(), 'repeat'); g.fillRect(0, 0, W + 256, H + 256);
    g.restore();
  }
  if (p.flash){ const a = clamp(evalExpr(p.flash, t), 0, 1); if (a > 0.002){ g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; } }
  if (p.vig > 0) drawVignette(g, W, H, p.vig);
  if (p.leak > 0) drawLeak(g, W / 2 + evalExpr(LEAK_X, t) * W, W, H, p.leak);
  if (p.scan > 0) drawScan(g, W, H, p.scan);
  if (p.bars > 0){ const b = Math.round(H * p.bars); g.fillStyle = '#000'; g.fillRect(0, 0, W, b); g.fillRect(0, H - b, W, b); }
  const fa = fxFadeAt(fx, t, len);
  if (fa < 1){ g.fillStyle = `rgba(0,0,0,${1 - fa})`; g.fillRect(0, 0, W, H); }
  g.restore();
}

/* ---------- Dışa aktarma (ffmpeg) ---------- */
function ffMatrix(M){
  const n = ['rr', 'rg', 'rb', 'ra', 'gr', 'gg', 'gb', 'ga', 'br', 'bg', 'bb', 'ba'];
  return 'format=rgba,colorchannelmixer=' + M.map((v, i) => `${n[i]}=${v.toFixed(5)}`).join(':');
}
// ana izdeki klip: kareye efektleri uygulayan filtre zinciri. Görsel bindirmeler (PNG) ayrı döner
function ffClipFx(fx, len, W, H){
  const out = {pre: '', ovl: [], post: ''};
  if (!fx) return out;
  const p = fxParams(fx), cam = fxCamera(fx, len);
  let s = '';
  if (cam){
    s += `,scale=w='2*ceil(${W}*(${cam.z})/2)':h='2*ceil(${H}*(${cam.z})/2)':eval=frame`;
    s += `,crop=${W}:${H}:x='(in_w-${W})/2+(${cam.x})*${W}':y='(in_h-${H})/2+(${cam.y})*${H}'`;
  }
  if (p.M) s += ',' + ffMatrix(p.M);
  const n = Math.round(p.sharp * 20);
  if (n > 0){ const m = `0 -${n} 0 -${n} ${20 + 4 * n} -${n} 0 -${n} 0`; s += `,format=gbrp,convolution=0m='${m}':1m='${m}':2m='${m}':0rdiv=0.05:1rdiv=0.05:2rdiv=0.05`; }
  if (p.rgb > 0){ const px = Math.max(1, Math.round(p.rgb * W)); s += `,rgbashift=rh=${px}:bh=-${px}`; }
  if (p.blur > 0) s += `,gblur=sigma=${(p.blur * H).toFixed(2)}`;
  if (p.grain > 0) s += `,noise=alls=${Math.round(p.grain * 0.4)}:allf=t`;
  if (p.flash) s += `,eq=brightness='${p.flash}':eval=frame`;
  out.pre = s;
  if (p.vig > 0) out.ovl.push({key: `vig_${p.vig.toFixed(3)}`, draw: (g, W, H) => drawVignette(g, W, H, p.vig), w: 1, x: '0'});
  if (p.leak > 0) out.ovl.push({key: `leak_${p.leak.toFixed(3)}`, draw: (g, W, H) => drawLeak(g, W, W, H, p.leak), w: 2, x: `main_w*(${LEAK_X})-main_w/2`});
  if (p.scan > 0) out.ovl.push({key: `scan_${p.scan.toFixed(3)}`, draw: (g, W, H) => drawScan(g, W, H, p.scan), w: 1, x: '0'});
  let q = '';
  if (p.bars > 0){ const b = Math.round(H * p.bars); q += `,drawbox=x=0:y=0:w=iw:h=${b}:color=black:t=fill,drawbox=x=0:y=ih-${b}:w=iw:h=${b}:color=black:t=fill`; }
  if (fx.animIn && fx.animIn.id === 'fade') q += `,fade=t=in:st=0:d=${n4(fx.animIn.d)}`;
  if (fx.animOut && fx.animOut.id === 'fade') q += `,fade=t=out:st=${n4(Math.max(0, len - fx.animOut.d))}:d=${n4(fx.animOut.d)}`;
  out.post = q;
  return out;
}
// video katmanı: renk ayarları + giriş/çıkış sönmesi (saydamlıkla)
function ffOverlayFx(fx, len, H){
  if (!fx) return '';
  const p = fxParams(fx, false);
  let s = '';
  if (p.M) s += ',' + ffMatrix(p.M) + ',format=yuva420p';
  if (fx.animIn && fx.animIn.id === 'fade') s += `,fade=t=in:st=0:d=${n4(fx.animIn.d)}:alpha=1`;
  if (fx.animOut && fx.animOut.id === 'fade') s += `,fade=t=out:st=${n4(Math.max(0, len - fx.animOut.d))}:d=${n4(fx.animOut.d)}:alpha=1`;
  return s;
}

/* ---------- Ses efektleri (ayrı dosya olarak işlenir; önizleme ve çıktı aynı) ---------- */
const AUDIO_FX = [
  {id: 'denoise', name: 'Gürültü azaltma', af: 'afftdn=nr=12:nf=-30,highpass=f=70'},
  {id: 'echo',    name: 'Yankı',           af: 'aecho=0.8:0.85:60|180:0.35|0.2'},
  {id: 'radio',   name: 'Radyo',           af: 'highpass=f=500,lowpass=f=3500,acompressor=threshold=0.1:ratio=6,volume=1.6'},
  {id: 'phone',   name: 'Telefon',         af: 'highpass=f=700,lowpass=f=2800,volume=1.4'},
  {id: 'deep',    name: 'Kalın ses',       af: 'aresample=48000,asetrate=40800,aresample=48000,atempo=1.17647'},
  {id: 'high',    name: 'İnce ses',        af: 'aresample=48000,asetrate=57600,aresample=48000,atempo=0.83333'},
];

/* ---------- Metin şablonları (Metin sekmesi) ---------- */
const TEXT_TEMPLATES = [
  {name: 'Başlık',    text: 'BAŞLIK',   st: {font: 'Avenir Next', size: 9, bold: true, upper: true, color: '#ffffff', stroke: 0, shadow: 8, bgA: 0, anim: 'pop', animD: 0.35}},
  {name: 'Sinematik', text: 'Bir zamanlar', st: {font: 'Georgia', size: 6, bold: false, upper: true, color: '#f3e9d2', stroke: 0, shadow: 10, bgA: 0, anim: 'fade', animD: 0.8, animOut: true}},
  {name: 'Korku',     text: 'KAÇ',      st: {font: 'Impact', size: 9, bold: false, upper: true, color: '#e01b1b', strokeC: '#000000', stroke: 8, shadow: 12, bgA: 0, anim: 'zoom', animD: 0.5}},
  {name: 'Etiket',    text: 'Bölüm 1',  st: {font: 'Helvetica', size: 4.5, bold: true, upper: false, color: '#ffffff', stroke: 0, shadow: 0, bgC: '#000000', bgA: 80, bgPad: 18, anim: 'slide', animD: 0.3, posY: 85}},
  {name: 'Daktilo',   text: 'Gece yarısı…', st: {font: 'Courier New', size: 5, bold: true, upper: false, color: '#ffffff', strokeC: '#000000', stroke: 4, shadow: 4, bgA: 0, anim: 'typewriter'}},
  {name: 'Vurgulu',   text: 'DİKKAT',   st: {font: 'Futura', size: 7, bold: true, upper: true, color: '#ffd84a', strokeC: '#000000', stroke: 10, shadow: 6, bgA: 0, anim: 'pop', animD: 0.3}},
];

/* ---------- Ses efektleri kitaplığı (ffmpeg ile sentezlenir, ilk kullanımda Medya klasörüne yazılır) ---------- */
const knockAt = a => `gte(t,${a})*exp(-38*(t-${a}))*(0.8*sin(2*PI*105*(t-${a}))+0.45*sin(2*PI*210*(t-${a}))+0.5*(random(0)*2-1)*exp(-90*(t-${a})))`;
const saw = f => `(2*mod(${f}*t,1)-1)`;
const SFX = [
  {id: 'knock',  name: 'Kapı çalma',       d: 1.4, expr: [0.05, 0.27, 0.49].map(knockAt).join('+'), af: 'lowpass=f=2200,highpass=f=60,aecho=0.8:0.6:25|45:0.3|0.2'},
  {id: 'slam',   name: 'Kapı çarpması',    d: 1.6, expr: '(random(0)*2-1)*exp(-25*t)+1.2*sin(2*PI*65*t)*exp(-9*t)+0.6*sin(2*PI*140*t)*exp(-20*t)', af: 'lowpass=f=1500,aecho=0.8:0.7:40|90:0.35|0.2'},
  {id: 'creak',  name: 'Gıcırtı',          d: 2.2, expr: 'pow(1-mod(45*t-4.7746*cos(PI*t)+10,1),10)*sin(PI*t/2.2)*(0.7+0.3*random(0))', af: 'bandpass=f=1100:width_type=q:w=2,bandpass=f=1100:width_type=q:w=2,aecho=0.8:0.5:30:0.25'},
  {id: 'steps',  name: 'Ayak sesleri',     d: 4.4, expr: '(0.8+0.2*sin(7.3*floor(t/0.55)))*(exp(-28*mod(t,0.55))*(0.6*(random(0)*2-1)+0.8*sin(2*PI*75*mod(t,0.55)))+0.5*gte(mod(t,0.55),0.07)*exp(-35*(mod(t,0.55)-0.07))*(random(0)*2-1))', af: 'lowpass=f=1400,highpass=f=50,aecho=0.8:0.4:20:0.2'},
  {id: 'horn',   name: 'Korna',            d: 0.9, expr: `(0.5*${saw(415)}+0.5*${saw(520)})*min(1,t/0.02)*max(0,min(1,(0.9-t)/0.08))`, af: 'lowpass=f=2500,highpass=f=200'},
  {id: 'heart',  name: 'Kalp atışı',       d: 4.5, expr: 'sin(2*PI*50*mod(t,0.95))*exp(-20*mod(t,0.95))+0.8*gte(mod(t,0.95),0.28)*sin(2*PI*45*(mod(t,0.95)-0.28))*exp(-22*(mod(t,0.95)-0.28))', af: 'lowpass=f=150'},
  {id: 'clock',  name: 'Saat tik-tak',     d: 4,   expr: 'exp(-350*mod(t,0.5))*sin(2*PI*(2200-600*mod(floor(t/0.5),2))*mod(t,0.5))', af: 'highpass=f=500'},
  {id: 'phone',  name: 'Telefon zili',     d: 2.2, expr: '(sin(2*PI*440*t)+sin(2*PI*480*t))*0.5*(0.5+0.5*gt(mod(t*20,1),0.5))*min(1,t/0.01)*max(0,min(1,(2.1-t)/0.02))', af: 'highpass=f=300'},
  {id: 'bell',   name: 'Çan',              d: 5,   expr: '(sin(2*PI*523*t)+0.6*sin(2*PI*1046*t)*exp(-t)+0.4*sin(2*PI*1569*t)*exp(-2*t)+0.3*sin(2*PI*1443*t)*exp(-3*t))*exp(-0.9*t)*min(1,t/0.005)', af: 'anull'},
  {id: 'wind',   name: 'Rüzgar',           d: 8,   expr: '(random(0)*2-1)*(0.55+0.45*sin(2*PI*0.13*t)*sin(2*PI*0.07*t+1))*min(1,t/1.5)*max(0,min(1,(8-t)/1.5))', af: 'lowpass=f=500,lowpass=f=500,highpass=f=80'},
  {id: 'rain',   name: 'Yağmur',           d: 8,   expr: '((random(0)*2-1)*0.5+gt(random(1),0.9985)*(random(2)*2-1)*3)*min(1,t)*max(0,min(1,8-t))', af: 'highpass=f=800,lowpass=f=7000'},
  {id: 'thunder', name: 'Gök gürültüsü',   d: 6,   expr: '(random(0)*2-1)*(exp(-0.6*t)*(1+0.6*sin(2*PI*1.3*t)*sin(2*PI*0.4*t))+1.5*exp(-12*t))*min(1,t/0.05)', af: 'lowpass=f=250,lowpass=f=400,aecho=0.8:0.7:120|300:0.4|0.25'},
  {id: 'whoosh', name: 'Hızlı geçiş (vuş)', d: 1.2, expr: '(random(0)*2-1)*pow(sin(PI*t/1.2),3)', af: 'bandpass=f=900:width_type=o:w=2,lowpass=f=4000'},
  {id: 'drone',  name: 'Gerilim',          d: 10,  expr: '(sin(2*PI*55*t)+0.7*sin(2*PI*55.8*t)+0.5*sin(2*PI*82.4*t)+0.3*sin(2*PI*116.5*t)*(0.5+0.5*sin(2*PI*0.2*t))+0.15*(random(0)*2-1))*min(1,t/2)*max(0,min(1,(10-t)/2))', af: 'lowpass=f=700'},
];
const SFX_VER = 1;   // ses tarifleri değişince artır: eski dosyalar yeniden üretilir
const sfxArgs = (s, out) => ['-f', 'lavfi', '-i', `aevalsrc=exprs='${s.expr}':s=48000:d=${s.d}`,
  '-af', `${s.af},loudnorm=I=-18:TP=-2,aresample=48000`, '-ac', '2', '-c:a', 'aac', '-b:a', '192k', out];
