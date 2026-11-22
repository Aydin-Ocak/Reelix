/* Reelix — poster editörü: arka plan görseli + serbest yazı katmanları.
   Ortadaki posterde yazıya tıkla-sürükle taşı, köşesinden boyutlandır; boşluğu sürükle arka planı kaydır, tekerlekle yakınlaştır.
   Ayarlar projeyle kaydedilir (POSTER); indirme aynı çizimden yapılır (seçim çerçevesi hariç). */

const POSTER_SIZES = {'9:16': [1080, 1920], '2:3': [1200, 1800], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080]};
const POSTER_FONTS = ['Big Caslon', 'Copperplate', 'Didot', 'Bodoni 72', 'Baskerville', 'Optima', 'Georgia', 'Times New Roman',
  'Avenir Next', 'Avenir Next Condensed', 'Futura', 'Helvetica Neue', 'DIN Condensed', 'Arial Narrow', 'Impact', 'Courier New'];
const POSTER_FILLS = {   // dolgu: düz renk veya yukarıdan aşağı renk geçişi
  solid: {name: 'Düz renk'},
  metal: {name: 'Metal', stops: ['#f6f6f6', '#a3a3a3', '#ececec', '#5e5e5e']},
  chrome: {name: 'Krom', stops: ['#ffffff', '#6d7a86', '#f2f6fa', '#2d343b']},
  gold:  {name: 'Altın', stops: ['#fff3c4', '#c8932b', '#f7dc8a', '#6e4a10']},
  blood: {name: 'Kan', stops: ['#ff6a5a', '#a30d0d', '#d81c1c', '#3a0000']},
  fire:  {name: 'Ateş', stops: ['#fff2a8', '#ffb02e', '#ff5a1f', '#7a1200']},
  ice:   {name: 'Buz', stops: ['#ffffff', '#9fd6ff', '#e6f6ff', '#2a6f9e']},
  navy:  {name: 'Lacivert', stops: ['#d7e1ee', '#4a5d7a', '#aab9cd', '#141c2a']},
  steel: {name: 'Çelik', stops: ['#e9f1f8', '#58708a', '#cfdbe6', '#1e2a36']},
  charcoal: {name: 'Kömür', stops: ['#9a9a9a', '#3a3a3a', '#707070', '#161616']},
  bone:  {name: 'Kemik', stops: ['#f4ecda', '#bdb39d', '#e6dcc4', '#6f6655']},
  ember: {name: 'Kor', stops: ['#ffe3ae', '#ff8a2a', '#ffc070', '#6e2400']},
  none:  {name: 'Boş (yalnız kontur)'},
};
// hazır yazı stilleri: dizinin karanlık, lacivert-kömür, el çizimi çizgi roman diline uygun görünümler
// (boyut, konum, hizalama ve metin değişmez; yalnızca görünüm)
const POSTER_LOOKS = [
  {name: 'Lacivert gerilim', o: {font: 'Big Caslon', bold: true, upper: true, fill: 'navy', stroke: 1.5, strokeC: '#0b0f18', shadow: 85, shadowB: 26, shadowX: 0, shadowY: 6, shadowC: '#000000', spacing: 2, texture: 30, opacity: 100}},
  {name: 'Kömür kazıma',     o: {font: 'Copperplate', bold: true, upper: true, fill: 'charcoal', stroke: 1, strokeC: '#cfd6df', shadow: 75, shadowB: 18, shadowX: 0, shadowY: 4, shadowC: '#000000', spacing: 6, texture: 45, opacity: 100}},
  {name: 'Soluk kemik',      o: {font: 'Baskerville', bold: false, upper: true, fill: 'bone', stroke: 0, shadow: 70, shadowB: 18, shadowX: 0, shadowY: 3, shadowC: '#000000', spacing: 3, texture: 40, opacity: 100}},
  {name: 'Kor ışığı',        o: {font: 'Big Caslon', bold: true, upper: true, fill: 'ember', stroke: 1, strokeC: '#2a0a00', shadow: 70, shadowB: 40, shadowX: 0, shadowY: 0, shadowC: '#ff6a1a', spacing: 2, texture: 20, opacity: 100}},
  {name: 'Soğuk ışık',       o: {font: 'Didot', bold: true, upper: true, fill: 'solid', color: '#e8f4ff', stroke: 0, shadow: 75, shadowB: 36, shadowX: 0, shadowY: 0, shadowC: '#5fb4ff', spacing: 8, texture: 10, opacity: 100}},
  {name: 'Çelik mavi',       o: {font: 'Optima', bold: true, upper: true, fill: 'steel', stroke: 1.5, strokeC: '#0a0f14', shadow: 80, shadowB: 22, shadowX: 0, shadowY: 5, shadowC: '#000000', spacing: 4, texture: 30, opacity: 100}},
  {name: 'Çizgi roman',      o: {font: 'Impact', bold: false, upper: true, fill: 'solid', color: '#f2f2f2', stroke: 5, strokeC: '#000000', shadow: 100, shadowB: 0, shadowX: 6, shadowY: 6, shadowC: '#000000', spacing: 1, texture: 15, opacity: 100}},
  {name: 'Daktilo dosyası',  o: {font: 'Courier New', bold: true, upper: true, fill: 'solid', color: '#e9e2d0', stroke: 0, shadow: 50, shadowB: 6, shadowX: 0, shadowY: 2, shadowC: '#000000', spacing: 4, texture: 55, opacity: 100}},
  {name: 'Boş kontur',       o: {font: 'Big Caslon', bold: true, upper: true, fill: 'none', stroke: 2, strokeC: '#e6e6e6', shadow: 60, shadowB: 14, shadowX: 0, shadowY: 0, shadowC: '#000000', spacing: 6, texture: 0, opacity: 100}},
  {name: 'Kan izi',          o: {font: 'Bodoni 72', bold: true, upper: true, fill: 'blood', stroke: 1, strokeC: '#120000', shadow: 85, shadowB: 20, shadowX: 0, shadowY: 5, shadowC: '#000000', spacing: 1, texture: 40, opacity: 100}},
  {name: 'Sis',              o: {font: 'Optima', bold: false, upper: true, fill: 'solid', color: '#cfd8e3', stroke: 0, shadow: 60, shadowB: 50, shadowX: 0, shadowY: 0, shadowC: '#9fb3c8', spacing: 12, texture: 0, opacity: 75}},
  {name: 'Metal',            o: {font: 'Big Caslon', bold: true, upper: true, fill: 'metal', stroke: 2, strokeC: '#141414', shadow: 85, shadowB: 26, shadowX: 0, shadowY: 7, shadowC: '#000000', spacing: 0, texture: 35, opacity: 100}},
];
const textLayer = o => ({id: uid(), type: 'text', text: 'Metin', x: 0.5, y: 0.5, font: 'Big Caslon', size: 60, bold: true, upper: true,
  fill: 'solid', color: '#ffffff', stroke: 0, strokeC: '#000000', shadow: 40, shadowB: 14, shadowX: 0, shadowY: 4, shadowC: '#000000', spacing: 0, lineH: 100,
  scaleX: 100, align: 'center', opacity: 100, texture: 0, lines: false, fit: true, ...o});
const POSTER_PRESETS = [
  {name: 'Başlık',     o: {text: 'Film adı', y: 0.74, size: 150, fill: 'navy', stroke: 1.5, strokeC: '#0b0f18', shadow: 85, shadowB: 26, shadowY: 6, spacing: 2, texture: 30, lineH: 98}},
  {name: 'Slogan',     o: {text: 'Her duvarın ardında bir sır vardır.', y: 0.06, size: 34, bold: false, color: '#e9dfcf', spacing: 4, shadow: 80, shadowB: 10, shadowY: 0}},
  {name: 'Alt başlık', o: {text: 'Part 2', y: 0.86, size: 54, bold: false, color: '#dcdcdc', spacing: 10, lines: true, shadow: 80, shadowB: 12, shadowY: 0}},
  {name: 'Jenerik',    o: {text: 'Yapım REELIX  Yönetmen ADINIZ  Senaryo ADINIZ\nMüzik ADINIZ  Kurgu ADINIZ  Görüntü Yönetmeni ADINIZ', y: 0.95, size: 25, bold: false, font: 'Avenir Next Condensed', color: '#cdcdcd', opacity: 72, spacing: 1.5, lineH: 135, shadow: 0}},
  {name: 'Bölüm',      o: {text: 'Bölüm 2', y: 0.12, size: 30, bold: false, font: 'Copperplate', color: '#b9c4d2', spacing: 12, lines: true, shadow: 70, shadowB: 10, shadowY: 0}},
  {name: 'Düz metin',  o: {text: 'Metin', size: 60}},
];
const defaultPoster = () => ({
  ratio: '9:16', format: 'png',
  bg: {path: null, zoom: 100, panX: 0, panY: 0, filter: 'cine', dark: 70, vig: 55, grain: 30},
  layers: ['Slogan', 'Başlık', 'Alt başlık', 'Jenerik'].map(n => textLayer({...POSTER_PRESETS.find(p => p.name === n).o,
    ...(n === 'Başlık' ? {text: projPath ? stem(projPath) : 'Film adı'} : {}), ...(n === 'Alt başlık' ? {text: 'Part 1'} : {})})),
});
// önceki sürümün posterini katmanlara çevir
function migratePoster(p){
  if (!p || p.layers) return p;
  const L = POSTER_PRESETS, f = n => L.find(x => x.name === n).o, layers = [];
  if (p.tagline) layers.push(textLayer({...f('Slogan'), text: p.tagline, font: p.font}));
  if (p.title) layers.push(textLayer({...f('Başlık'), text: p.title, font: p.font, y: (p.titleY || 74) / 100, size: 150 * (p.size || 100) / 100,
    fill: p.style === 'white' ? 'solid' : (p.style || 'metal')}));
  if (p.sub) layers.push(textLayer({...f('Alt başlık'), text: p.sub, font: p.font}));
  if (p.credOn !== false && p.credits) layers.push(textLayer({...f('Jenerik'), text: p.credits}));
  return {ratio: p.ratio || '9:16', format: p.format || 'png', layers,
    bg: {path: p.bg || null, zoom: p.zoom || 100, panX: p.panX || 0, panY: p.panY || 0, filter: p.filter ?? 'cine', dark: p.dark ?? 70, vig: p.vig ?? 55, grain: p.grain ?? 30}};
}
let POSTER = null, posterImg = null, posterImgPath = null;
let pSel = 'bg';                       // 'bg' veya katman id
let pPrev = null;                      // üzerine gelinen stil: {id, o} — tıklanana kadar yalnızca önizleme
const trUp = s => String(s || '').toLocaleUpperCase('tr');
const pSize = () => POSTER_SIZES[POSTER.ratio] || POSTER_SIZES['9:16'];
const pUnit = (W, H) => Math.min(W, H * 0.5625) / 1080;   // yazı ölçüsü: 9:16'da 1080 genişliğe göre
const pLayer = id => POSTER.layers.find(l => l.id === id);

function loadPosterImg(cb){
  const p = POSTER && POSTER.bg.path;
  if (!p){ posterImg = null; posterImgPath = null; cb && cb(); return; }
  if (posterImgPath === p && posterImg){ cb && cb(); return; }
  const im = new Image();
  im.onload = () => { posterImg = im; posterImgPath = p; bgKey = null; cb && cb(); renderTemplates(); };
  im.onerror = () => { posterImg = null; posterImgPath = null; toast('Arka plan görseli açılamadı', 'err'); cb && cb(); };
  im.src = fileUrl(p);
}

/* ---------- Çizim ---------- */
const bgCanvas = document.createElement('canvas'); let bgKey = null;
function bgImageRect(W, H, bg){
  if (!posterImg) return null;
  const k = Math.max(W / posterImg.width, H / posterImg.height) * bg.zoom / 100, w = posterImg.width * k, h = posterImg.height * k;
  return {x: (W - w) / 2 + (w - W) / 2 * bg.panX / 50, y: (H - h) / 2 + (h - H) / 2 * bg.panY / 50, w, h};
}
// arka plan (filtre, vinyet, gren, kararma) ayrı önbellekte: yazı sürüklerken yeniden işlenmez
function renderBg(W, H, bg){
  const key = JSON.stringify([W, H, bg, posterImgPath]);
  if (key === bgKey) return bgCanvas;
  bgCanvas.width = W; bgCanvas.height = H;
  const g = bgCanvas.getContext('2d');
  const base = gg => {
    gg.fillStyle = '#000'; gg.fillRect(0, 0, W, H);
    const r = bgImageRect(W, H, bg);
    if (r) gg.drawImage(posterImg, r.x, r.y, r.w, r.h);
    else { const gr = gg.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#2a3240'); gr.addColorStop(1, '#0d0f14'); gg.fillStyle = gr; gg.fillRect(0, 0, W, H); }
  };
  drawWithFx(g, {filter: bg.filter ? {id: bg.filter, k: 1} : undefined, adj: {vig: bg.vig, grain: bg.grain}}, 0, 1, W, H, base);
  const d = bg.dark / 100;
  let gr = g.createLinearGradient(0, H * 0.5, 0, H);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.92 * d})`); g.fillStyle = gr; g.fillRect(0, H * 0.5, W, H * 0.5);
  gr = g.createLinearGradient(0, 0, 0, H * 0.16);
  gr.addColorStop(0, `rgba(0,0,0,${0.7 * d})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.16);
  bgKey = key;
  return bgCanvas;
}
const layerCanvas = document.createElement('canvas');
// yazı katmanını çiz; kapladığı kutuyu (poster pikseli) döndürür
function drawTextLayer(g, L, W, H, scratch = layerCanvas){
  const u = pUnit(W, H), px = Math.max(2, L.size * u);
  const lines = (L.upper ? trUp(L.text) : String(L.text || '')).split('\n');
  if (scratch.width !== W || scratch.height !== H){ scratch.width = W; scratch.height = H; }
  const t = scratch.getContext('2d');
  t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, W, H);
  t.font = `${L.bold ? 700 : 400} ${px}px "${L.font}", serif`; t.letterSpacing = `${L.spacing * u}px`; t.textBaseline = 'alphabetic';
  const ws = lines.map(l => t.measureText(l).width), maxW = Math.max(1, ...ws);
  let sx = L.scaleX / 100;
  if (L.fit && maxW * sx > W * 0.92) sx = W * 0.92 / maxW;   // genişliğe sığdır
  const lh = px * L.lineH / 100, blockH = lh * lines.length, bw = maxW * sx;
  const cx = L.x * W, cy = L.y * H, top = cy - blockH / 2;
  const base = i => top + lh * i + lh / 2 + px * 0.35;
  const ax = L.align === 'left' ? cx - maxW / 2 : L.align === 'right' ? cx + maxW / 2 : cx;
  t.textAlign = L.align;
  t.setTransform(sx, 0, 0, 1, cx * (1 - sx), 0);   // yatay sıkıştırma kutunun ortasına göre
  t.lineJoin = 'round'; t.miterLimit = 2;
  if (L.stroke > 0){
    t.lineWidth = L.stroke * u * 2; t.strokeStyle = L.strokeC;
    lines.forEach((l, i) => t.strokeText(l, ax, base(i)));
  }
  const fl = POSTER_FILLS[L.fill];
  if (L.fill !== 'none') lines.forEach((l, i) => {
    if (fl && fl.stops){
      const gr = t.createLinearGradient(0, base(i) - px * 0.78, 0, base(i) + px * 0.05);
      fl.stops.forEach((c, k) => gr.addColorStop(k / (fl.stops.length - 1), c));
      t.fillStyle = gr;
    } else t.fillStyle = L.color;
    t.fillText(l, ax, base(i));
  });
  t.setTransform(1, 0, 0, 1, 0, 0);
  if (L.lines){   // iki yanında ince çizgiler
    t.fillStyle = fl && fl.stops ? fl.stops[0] : L.fill === 'none' ? L.strokeC : L.color;
    const len = W * 0.18, gap = 30 * u, th = Math.max(1, 2 * u);
    lines.forEach((l, i) => {
      const w = ws[i] * sx, left = L.align === 'left' ? cx - bw / 2 : L.align === 'right' ? cx + bw / 2 - w : cx - w / 2, y = base(i) - px * 0.33;
      t.fillRect(left - gap - len, y, len, th); t.fillRect(left + w + gap, y, len, th);
    });
  }
  if (L.texture > 0){   // yıpranmış doku: yalnızca harflerin üstüne
    t.globalCompositeOperation = 'source-atop'; t.globalAlpha = L.texture / 100;
    t.fillStyle = t.createPattern(getGrain(), 'repeat'); t.fillRect(0, 0, W, H);
    t.globalAlpha = 1; t.globalCompositeOperation = 'source-over';
  }
  g.save();
  g.globalAlpha = L.opacity / 100;
  if (L.shadow > 0){ g.shadowColor = hexA(L.shadowC || '#000000', L.shadow / 100); g.shadowBlur = L.shadowB * u; g.shadowOffsetX = (L.shadowX || 0) * u; g.shadowOffsetY = L.shadowY * u; }
  g.drawImage(scratch, 0, 0);
  g.restore();
  return {x: cx - bw / 2, y: top, w: bw, h: blockH};
}
let pBoxes = new Map(), pGuides = {v: false, h: false};
function renderPoster(g, W, H, ui){
  g.drawImage(renderBg(W, H, POSTER.bg), 0, 0);
  const boxes = new Map();
  for (const L of POSTER.layers) boxes.set(L.id, drawTextLayer(g, ui && pPrev && pPrev.id === L.id ? {...L, ...pPrev.o} : L, W, H));
  if (ui){
    pBoxes = boxes;
    const u = pUnit(W, H), b = boxes.get(pSel);
    g.save();
    if (pGuides.v){ g.fillStyle = 'rgba(255,216,74,.9)'; g.fillRect(W / 2 - u, 0, 2 * u, H); }
    if (pGuides.h){ g.fillStyle = 'rgba(255,216,74,.9)'; g.fillRect(0, H / 2 - u, W, 2 * u); }
    if (b){
      const pad = 12 * u;
      g.strokeStyle = '#00c8d2'; g.lineWidth = 3 * u; g.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
      g.fillStyle = '#fff'; g.strokeStyle = '#00c8d2';
      g.beginPath(); g.arc(b.x + b.w + pad, b.y + b.h + pad, 14 * u, 0, 7); g.fill(); g.stroke();
    }
    g.restore();
  }
}
let drawQueued = false;
function posterDraw(){
  if (!POSTER || drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    const real = POSTER; if (pTplPrev) POSTER = pTplPrev;   // şablon önizlemesi: gerçek poster değişmez
    try {
      const [W, H] = pSize(), c = $('posterCv');
      if (c.width !== W || c.height !== H){ c.width = W; c.height = H; }
      renderPoster(c.getContext('2d'), W, H, !pTplPrev);
    } finally { POSTER = real; }
  });
}

/* ---------- Geri al ---------- */
const pUndo = [], pRedo = []; let pLast = null;
function pCommit(){
  const s = JSON.stringify(POSTER);
  if (pLast !== null && s !== pLast){ pUndo.push(pLast); if (pUndo.length > 80) pUndo.shift(); pRedo.length = 0; dirty = true; }
  pLast = s; $('pUndo').disabled = !pUndo.length; $('pRedo').disabled = !pRedo.length;
}
function pRestore(s){ POSTER = JSON.parse(s); pLast = s; if (pSel !== 'bg' && !pLayer(pSel)) pSel = 'bg'; dirty = true; loadPosterImg(posterDraw); renderPosterUI(); }
$('pUndo').onclick = () => { if (pUndo.length){ pRedo.push(pLast); pRestore(pUndo.pop()); } };
$('pRedo').onclick = () => { if (pRedo.length){ pUndo.push(pLast); pRestore(pRedo.pop()); } };

/* ---------- Paneller ---------- */
const layerName = L => (String(L.text || '').split('\n')[0].trim() || 'Metin').slice(0, 28);
function renderLayerList(){
  const rows = [...POSTER.layers].reverse().map(L => `<div class="plrow ${pSel === L.id ? 'on' : ''}" data-pl="${L.id}">${ICON.text}<span class="pln">${esc(layerName(L))}</span>
      <button class="ic" data-plup title="Öne getir">▲</button><button class="ic" data-pldn title="Arkaya gönder">▼</button>
      <button class="ic" data-pldup title="Çoğalt">⧉</button><button class="ic" data-pldel title="Sil">${ICON.close}</button></div>`).join('');
  $('pLayers').innerHTML = rows + `<div class="plrow ${pSel === 'bg' ? 'on' : ''}" data-pl="bg">${ICON.scene}<span class="pln">Arka plan</span></div>`;
}
const pFmt = {};   // kaydırıcı değer biçimleri (ilk çizim ve canlı güncelleme aynı)
const rng = (id, label, min, max, step, val, unit = '') => { pFmt[id] = v => (+v).toFixed(step < 1 ? 1 : 0) + unit; return rangeRow(id, label, min, max, step, val, pFmt[id]); };
function renderProps(){
  const box = $('pProps');
  if (pSel === 'bg'){
    const b = POSTER.bg;
    box.innerHTML = `
      <h3>Arka plan</h3>
      <div class="info">${b.path ? esc(basename(b.path)) : 'Görsel seçilmedi'}</div>
      <div class="row"><button class="sec sm" id="pBgFile">Görsel seç</button><button class="sec sm" id="pBgFrame" title="Oynatma kafasındaki videonun karesi">Videodan kare al</button></div>
      <p class="note">Posterin boş yerini sürükleyerek kaydır, fare tekerleğiyle yakınlaştır.</p>
      ${rng('pb_zoom', 'Yakınlaştır', 100, 300, 1, b.zoom, '%')}
      ${rng('pb_panX', 'Yatay', -50, 50, 1, b.panX)}
      ${rng('pb_panY', 'Dikey', -50, 50, 1, b.panY)}
      <h3>Renk</h3>
      <label>Filtre<select id="pb_filter">${optHtml(FX_FILTERS, b.filter)}</select></label>
      ${rng('pb_dark', 'Kararma', 0, 100, 1, b.dark)}
      ${rng('pb_vig', 'Vinyet', 0, 100, 1, b.vig)}
      ${rng('pb_grain', 'Gren', 0, 100, 1, b.grain)}`;
    ['zoom', 'panX', 'panY', 'dark', 'vig', 'grain'].forEach(k => bindP('pb_' + k, v => { POSTER.bg[k] = v; }));
    $('pb_filter').onchange = e => { POSTER.bg.filter = e.target.value; pCommit(); posterDraw(); };
    $('pBgFile').onclick = pickBgFile; $('pBgFrame').onclick = pickBgFrame;
    return;
  }
  const L = pLayer(pSel); if (!L){ pSel = 'bg'; renderProps(); return; }
  const fonts = POSTER_FONTS.includes(L.font) ? POSTER_FONTS : [L.font, ...POSTER_FONTS];
  box.innerHTML = `
    <h3>Stiller</h3>
    <p class="note">Üzerine gel: önizle · tıkla: uygula</p>
    <div class="pswatch" id="pt_looks">${POSTER_LOOKS.map((k, i) => `<div class="psw" data-look="${i}" title="${k.name}"><canvas width="264" height="96"></canvas><span>${k.name}</span></div>`).join('')}</div>
    <h3>Yazı</h3>
    <textarea id="pt_text" rows="3">${esc(L.text)}</textarea>
    <label>Font<select id="pt_font">${fonts.map(f => `<option ${f === L.font ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>
    ${rng('pt_size', 'Boyut', 8, 400, 1, L.size)}
    <div class="pbtns">
      <button class="sec sm ${L.bold ? 'on' : ''}" id="pt_bold" title="Kalın"><b>K</b></button>
      <button class="sec sm ${L.upper ? 'on' : ''}" id="pt_upper" title="Büyük harf">AA</button>
      <button class="sec sm ${L.align === 'left' ? 'on' : ''}" data-align="left" title="Sola hizala">⟸</button>
      <button class="sec sm ${L.align === 'center' ? 'on' : ''}" data-align="center" title="Ortala">≡</button>
      <button class="sec sm ${L.align === 'right' ? 'on' : ''}" data-align="right" title="Sağa hizala">⟹</button>
      <button class="sec sm" id="pt_center" title="Yatayda ortaya al">Ortala</button>
    </div>
    ${rng('pt_spacing', 'Harf aralığı', -5, 40, 0.5, L.spacing)}
    ${rng('pt_lineH', 'Satır aralığı', 60, 200, 1, L.lineH, '%')}
    ${rng('pt_scaleX', 'Genişlik', 40, 160, 1, L.scaleX, '%')}
    <label>Genişliğe sığdır<input type="checkbox" id="pt_fit" ${L.fit ? 'checked' : ''}></label>
    <h3>Dolgu</h3>
    <div class="pswatch fills" id="pt_fills">${Object.entries(POSTER_FILLS).map(([k, f]) => `<div class="psw ${k === L.fill ? 'on' : ''}" data-fill="${k}" title="${f.name}"><canvas width="132" height="64"></canvas><span>${f.name}</span></div>`).join('')}</div>
    ${L.fill === 'solid' ? `<label>Renk<input type="color" id="pt_color" value="${L.color}"></label>` : ''}
    ${rng('pt_texture', 'Doku', 0, 100, 1, L.texture)}
    ${rng('pt_opacity', 'Opaklık', 0, 100, 1, L.opacity, '%')}
    <h3>Kontur</h3>
    ${rng('pt_stroke', 'Kalınlık', 0, 30, 0.5, L.stroke)}
    <label>Renk<input type="color" id="pt_strokeC" value="${L.strokeC}"></label>
    <h3>Gölge</h3>
    ${rng('pt_shadow', 'Koyuluk', 0, 100, 1, L.shadow, '%')}
    ${rng('pt_shadowB', 'Yumuşaklık', 0, 80, 1, L.shadowB)}
    ${rng('pt_shadowX', 'Yatay uzaklık', -40, 40, 1, L.shadowX || 0)}
    ${rng('pt_shadowY', 'Dikey uzaklık', -40, 40, 1, L.shadowY)}
    <label>Renk<input type="color" id="pt_shadowC" value="${L.shadowC || '#000000'}"></label>
    <p class="note">Siyah dışında bir renk seçince gölge parıltıya döner.</p>
    <h3>Süs</h3>
    <label>Yanlarda çizgi<input type="checkbox" id="pt_lines" ${L.lines ? 'checked' : ''}></label>`;
  ['size', 'spacing', 'lineH', 'scaleX', 'texture', 'opacity', 'stroke', 'shadow', 'shadowB', 'shadowX', 'shadowY'].forEach(k => bindP('pt_' + k, v => { L[k] = v; }));
  const live = (id, f, ev = 'input') => $(id).addEventListener(ev, e => { f(e.target); posterDraw(); if (ev === 'change') pCommit(); });
  live('pt_text', el => { L.text = el.value; renderLayerList(); });
  $('pt_text').addEventListener('change', pCommit);
  live('pt_font', el => { L.font = el.value; }, 'change');
  live('pt_shadowC', el => { L.shadowC = el.value; }); $('pt_shadowC').addEventListener('change', pCommit);
  bindSwatches(L, 'pt_looks', 'look', i => POSTER_LOOKS[+i].o);
  bindSwatches(L, 'pt_fills', 'fill', k => ({fill: k}));
  drawSwatches(L);
  if ($('pt_color')){ live('pt_color', el => { L.color = el.value; }); $('pt_color').addEventListener('change', pCommit); }
  live('pt_strokeC', el => { L.strokeC = el.value; }); $('pt_strokeC').addEventListener('change', pCommit);
  live('pt_fit', el => { L.fit = el.checked; }, 'change');
  live('pt_lines', el => { L.lines = el.checked; }, 'change');
  $('pt_bold').onclick = () => { L.bold = !L.bold; pCommit(); renderProps(); posterDraw(); };
  $('pt_upper').onclick = () => { L.upper = !L.upper; pCommit(); renderProps(); posterDraw(); };
  $('pt_center').onclick = () => { L.x = 0.5; pCommit(); posterDraw(); };
  box.querySelectorAll('[data-align]').forEach(b => b.onclick = () => { L.align = b.dataset.align; pCommit(); renderProps(); posterDraw(); });
}
const swCanvas = document.createElement('canvas');
// kartlarda seçili yazının ilk kelimesi o stille çizilir (koyu lacivert zemin)
function drawSwatches(L){
  const word = (L.upper ? trUp(L.text) : String(L.text)).split(/\s+/).filter(Boolean)[0] || 'Aa';
  const draw = (cn, o) => {
    const g = cn.getContext('2d'), W = cn.width, H = cn.height;
    g.fillStyle = '#10141b'; g.fillRect(0, 0, W, H);
    const u = pUnit(W, H), size = H * 0.5 / u;
    drawTextLayer(g, {...L, ...o, text: word.slice(0, 10), x: 0.5, y: 0.5, size, align: 'center', fit: true, lines: false, lineH: 100}, W, H, swCanvas);
  };
  document.querySelectorAll('#pt_looks [data-look]').forEach(el => draw(el.querySelector('canvas'), POSTER_LOOKS[+el.dataset.look].o));
  document.querySelectorAll('#pt_fills [data-fill]').forEach(el => draw(el.querySelector('canvas'), {fill: el.dataset.fill, stroke: el.dataset.fill === 'none' ? Math.max(L.stroke, 2) : L.stroke}));
}
function bindSwatches(L, gridId, key, patchOf){
  const grid = $(gridId);
  grid.addEventListener('mouseover', e => {
    const el = e.target.closest(`[data-${key}]`); if (!el) return;
    pPrev = {id: L.id, o: patchOf(el.dataset[key])}; posterDraw();
  });
  grid.addEventListener('mouseleave', () => { pPrev = null; posterDraw(); });
  grid.addEventListener('click', e => {
    const el = e.target.closest(`[data-${key}]`); if (!el) return;
    Object.assign(L, patchOf(el.dataset[key])); pPrev = null;
    if (L.fill === 'none' && !(L.stroke > 0)) L.stroke = 2;   // boş dolguda kontur görünsün
    pCommit(); renderProps(); renderLayerList(); posterDraw();
  });
}
// kaydırıcı: canlı çiz, bırakınca geri al geçmişine yaz
function bindP(id, set){
  const el = $(id); if (!el) return;
  el.addEventListener('input', () => { set(+el.value); const v = $(id + 'V'); if (v) v.textContent = (pFmt[id] || String)(el.value); posterDraw(); });
  el.addEventListener('change', pCommit);
}
function renderPosterUI(){
  $('pRatio').value = POSTER.ratio; $('pFormat').value = POSTER.format;
  $('pUndo').disabled = !pUndo.length; $('pRedo').disabled = !pRedo.length;
  renderLayerList(); renderProps(); renderTemplates(); posterDraw();
}

/* ---------- Şablonlar: düzen + yazı stilleri + renk ayarları (arka plan görseli hariç) ---------- */
const TPL_KEY = 'reelix-poster-templates';
const tplLayer = o => textLayer(o);
const BUILTIN_TPLS = [
  {id: 'b-cinema', name: 'Sinema afişi', builtin: true, ratio: '9:16', bg: {filter: 'cine', dark: 70, vig: 55, grain: 30},
   layers: ['Slogan', 'Başlık', 'Alt başlık', 'Jenerik'].map(n => tplLayer(POSTER_PRESETS.find(p => p.name === n).o))},
  {id: 'b-minimal', name: 'Minimal', builtin: true, ratio: '9:16', bg: {filter: '', dark: 40, vig: 30, grain: 10},
   layers: [tplLayer({text: 'Film adı', y: 0.5, size: 110, font: 'Didot', bold: false, fill: 'solid', color: '#ffffff', spacing: 12, shadow: 30, shadowB: 20, shadowY: 0}),
            tplLayer({text: 'Kısa bir slogan', y: 0.575, size: 28, font: 'Didot', bold: false, color: '#d8d8d8', spacing: 6, shadow: 0})]},
  {id: 'b-comic', name: 'Çizgi roman kapağı', builtin: true, ratio: '9:16', bg: {filter: 'vivid', dark: 30, vig: 20, grain: 15},
   layers: [tplLayer({text: 'Film adı', y: 0.13, size: 160, font: 'Impact', bold: false, fill: 'solid', color: '#ffd84a', stroke: 6, strokeC: '#000000', shadow: 100, shadowB: 0, shadowX: 6, shadowY: 6, lineH: 92}),
            tplLayer({text: 'Bölüm 1', y: 0.235, size: 42, font: 'Impact', bold: false, color: '#ffffff', stroke: 4, strokeC: '#000000', spacing: 6, shadow: 80, shadowB: 0, shadowX: 3, shadowY: 3}),
            tplLayer({text: 'Her şey bir sırla başladı', y: 0.9, size: 34, font: 'Futura', color: '#ffffff', stroke: 3, strokeC: '#000000', spacing: 2, shadow: 60, shadowB: 6})]},
  {id: 'b-tale', name: 'Sıcak masal', builtin: true, ratio: '9:16', bg: {filter: 'warm', dark: 55, vig: 40, grain: 20},
   layers: [tplLayer({text: 'Bir zamanlar', y: 0.07, size: 30, font: 'Baskerville', bold: false, color: '#fff3d6', spacing: 5, shadow: 70, shadowB: 10, shadowY: 0}),
            tplLayer({text: 'Film adı', y: 0.8, size: 120, font: 'Baskerville', fill: 'gold', stroke: 1, strokeC: '#3a2400', shadow: 85, shadowB: 24, shadowY: 5, texture: 20}),
            tplLayer({text: 'Part 1', y: 0.89, size: 40, font: 'Baskerville', bold: false, color: '#f3e3c0', spacing: 8, lines: true, shadow: 70, shadowB: 8, shadowY: 0})]},
];
const userTpls = () => { try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch (e){ return []; } };
const allTpls = () => [...userTpls(), ...BUILTIN_TPLS];
const clone = o => JSON.parse(JSON.stringify(o));
// şablonu postere uygula: metinler korunur (en büyük yazı en büyük yazıya), görsel ve kaydırma korunur
function applyTemplate(P0, t){
  const p = clone(P0), bySize = arr => [...arr].sort((a, b) => b.size - a.size);
  const oldTexts = bySize(p.layers).map(l => l.text);
  const layers = t.layers.map(l => ({...clone(l), id: uid()}));
  bySize(layers).forEach((l, i) => { if (oldTexts[i] != null) l.text = oldTexts[i]; });
  p.layers = layers; p.ratio = t.ratio || p.ratio;
  p.bg = {...p.bg, ...t.bg};
  return p;
}
let pTplPrev = null;   // üzerine gelinen şablonla geçici poster
function renderTemplates(){
  const box = $('pTpls'); if (!box) return;
  box.innerHTML = allTpls().map(t => `<div class="ptpl" data-tpl="${t.id}" title="${esc(t.name)}"><canvas width="108" height="${Math.round(108 * (POSTER_SIZES[t.ratio] || POSTER_SIZES['9:16'])[1] / (POSTER_SIZES[t.ratio] || POSTER_SIZES['9:16'])[0])}"></canvas>
    <span>${esc(t.name)}</span>${t.builtin ? '' : `<button class="ic" data-tpldel="${t.id}" title="Şablonu sil">${ICON.close}</button>`}</div>`).join('');
  box.querySelectorAll('[data-tpl]').forEach(el => {
    const t = allTpls().find(x => x.id === el.dataset.tpl), cn = el.querySelector('canvas'), g = cn.getContext('2d'), W = cn.width, H = cn.height;
    g.fillStyle = '#10141b'; g.fillRect(0, 0, W, H);
    const r = bgImageRect(W, H, {zoom: POSTER.bg.zoom, panX: POSTER.bg.panX, panY: POSTER.bg.panY});
    if (r) g.drawImage(posterImg, r.x, r.y, r.w, r.h);
    const d = (t.bg.dark ?? 60) / 100, gr = g.createLinearGradient(0, H * 0.5, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.92 * d})`); g.fillStyle = gr; g.fillRect(0, H * 0.5, W, H * 0.5);
    for (const L of applyTemplate(POSTER, t).layers) drawTextLayer(g, L, W, H, tplScratch);
  });
}
const tplScratch = document.createElement('canvas');
$('pTpls').addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tpl]'); if (!el || e.target.closest('[data-tpldel]')) return;
  const t = allTpls().find(x => x.id === el.dataset.tpl); if (!t) return;
  pTplPrev = applyTemplate(POSTER, t); posterDraw();
});
$('pTpls').addEventListener('mouseleave', () => { pTplPrev = null; posterDraw(); });
$('pTpls').addEventListener('click', e => {
  const del = e.target.closest('[data-tpldel]');
  if (del){ if (!confirm('Şablon silinsin mi?')) return; localStorage.setItem(TPL_KEY, JSON.stringify(userTpls().filter(t => t.id !== del.dataset.tpldel))); renderTemplates(); return; }
  const el = e.target.closest('[data-tpl]'); if (!el) return;
  const t = allTpls().find(x => x.id === el.dataset.tpl); if (!t) return;
  POSTER = applyTemplate(POSTER, t); pTplPrev = null; pSel = 'bg'; pCommit(); renderPosterUI();
  toast(`${t.name} şablonu uygulandı (yazıların korundu). Geri almak için ⌘Z.`);
});
// herhangi bir posteri şablona çevir: düzen, yazı stilleri ve renk ayarları saklanır (görsel saklanmaz)
$('pTplSave').onclick = () => {
  const name = $('pTplName').value.trim() || `Şablonum ${userTpls().length + 1}`;
  const t = {id: 'u-' + uid(), name, ratio: POSTER.ratio, bg: {filter: POSTER.bg.filter, dark: POSTER.bg.dark, vig: POSTER.bg.vig, grain: POSTER.bg.grain},
    layers: clone(POSTER.layers)};
  localStorage.setItem(TPL_KEY, JSON.stringify([t, ...userTpls()]));
  $('pTplName').value = ''; renderTemplates(); toast(`"${name}" şablonu kaydedildi; tüm projelerde kullanılabilir.`);
};
$('pAdd').innerHTML = POSTER_PRESETS.map((p, i) => `<button class="sec sm" data-preset="${i}">${p.name}</button>`).join('');
$('pAdd').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  const L = textLayer({...POSTER_PRESETS[+b.dataset.preset].o}); POSTER.layers.push(L); pSel = L.id; pCommit(); renderPosterUI();
});
$('pLayers').addEventListener('click', e => {
  const row = e.target.closest('[data-pl]'); if (!row) return;
  const id = row.dataset.pl, i = POSTER.layers.findIndex(l => l.id === id);
  if (e.target.closest('[data-pldel]')){ POSTER.layers.splice(i, 1); pSel = 'bg'; }
  else if (e.target.closest('[data-pldup]')){ const c = {...POSTER.layers[i], id: uid(), y: Math.min(0.97, POSTER.layers[i].y + 0.04)}; POSTER.layers.splice(i + 1, 0, c); pSel = c.id; }
  else if (e.target.closest('[data-plup]')){ if (i < POSTER.layers.length - 1) POSTER.layers.splice(i + 1, 0, ...POSTER.layers.splice(i, 1)); }
  else if (e.target.closest('[data-pldn]')){ if (i > 0) POSTER.layers.splice(i - 1, 0, ...POSTER.layers.splice(i, 1)); }
  else pSel = id;
  pCommit(); renderPosterUI();
});
$('pRatio').onchange = e => { POSTER.ratio = e.target.value; pCommit(); posterDraw(); };
$('pFormat').onchange = e => { POSTER.format = e.target.value; pCommit(); };

/* ---------- Poster üstünde fareyle düzenleme ---------- */
function posterPt(e){
  const c = $('posterCv'), r = c.getBoundingClientRect(), [W, H] = pSize();
  const k = Math.min(r.width / W, r.height / H), ox = r.left + (r.width - W * k) / 2, oy = r.top + (r.height - H * k) / 2;
  return {x: (e.clientX - ox) / k, y: (e.clientY - oy) / k, k};
}
$('posterCv').addEventListener('pointerdown', e => {
  if (e.button !== 0 || !POSTER) return;
  const c = $('posterCv'), p = posterPt(e), [W, H] = pSize(), u = pUnit(W, H), pad = 12 * u;
  const hit = id => { const b = pBoxes.get(id); return b && p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad; };
  const sb = pBoxes.get(pSel), onHandle = sb && Math.hypot(p.x - (sb.x + sb.w + pad), p.y - (sb.y + sb.h + pad)) < 28 * u;
  let L = pSel !== 'bg' && onHandle ? pLayer(pSel) : null, mode = L ? 'size' : null;
  if (!L){ const top = [...POSTER.layers].reverse().find(l => hit(l.id)); if (top){ L = top; mode = 'move'; } }
  if (!L) mode = 'pan';
  const newSel = L ? L.id : 'bg';
  if (newSel !== pSel){ pSel = newSel; renderLayerList(); renderProps(); }
  c.setPointerCapture(e.pointerId);
  const x0 = p.x, y0 = p.y, b = POSTER.bg, s0 = L && {x: L.x, y: L.y, size: L.size}, bg0 = {panX: b.panX, panY: b.panY};
  const box = L && pBoxes.get(L.id), cx = box ? box.x + box.w / 2 : 0, cy = box ? box.y + box.h / 2 : 0, d0 = Math.max(1, Math.hypot(x0 - cx, y0 - cy));
  let moved = false;
  const mv = ev => {
    const q = posterPt(ev); moved = true;
    if (mode === 'move'){
      let nx = s0.x + (q.x - x0) / W, ny = s0.y + (q.y - y0) / H;
      pGuides.v = Math.abs(nx - 0.5) * W < 10 * u; pGuides.h = Math.abs(ny - 0.5) * H < 10 * u;   // ortaya yapış
      if (pGuides.v) nx = 0.5; if (pGuides.h) ny = 0.5;
      L.x = nx; L.y = ny;
    } else if (mode === 'size'){
      L.size = clamp(Math.round(s0.size * Math.hypot(q.x - cx, q.y - cy) / d0), 8, 400);
      const v = $('pt_size'); if (v){ v.value = L.size; $('pt_sizeV').textContent = pFmt.pt_size(L.size); }
    } else {
      const r = bgImageRect(W, H, b); if (!r) return;
      if (r.w > W) b.panX = clamp(bg0.panX + (q.x - x0) / ((r.w - W) / 2) * 50, -50, 50);
      if (r.h > H) b.panY = clamp(bg0.panY + (q.y - y0) / ((r.h - H) / 2) * 50, -50, 50);
    }
    posterDraw();
  };
  const up = () => {
    c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
    pGuides = {v: false, h: false};
    if (moved){ pCommit(); if (pSel === 'bg') renderProps(); }
    posterDraw();
  };
  c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  posterDraw();
});
// çift tıklama: yazıyı düzenlemeye geç
$('posterCv').addEventListener('dblclick', () => { const t = $('pt_text'); if (t){ t.focus(); t.select(); } });
// tekerlek: arka planı yakınlaştır
$('posterCv').addEventListener('wheel', e => {
  if (!POSTER) return; e.preventDefault();
  POSTER.bg.zoom = clamp(Math.round(POSTER.bg.zoom * (e.deltaY < 0 ? 1.05 : 1 / 1.05)), 100, 300);
  if (pSel === 'bg' && $('pb_zoom')){ $('pb_zoom').value = POSTER.bg.zoom; $('pb_zoomV').textContent = POSTER.bg.zoom + '%'; }
  posterDraw(); clearTimeout(posterWheelT); posterWheelT = setTimeout(pCommit, 400);
}, {passive: false});
let posterWheelT = null;
// klavye: Sil, oklarla kaydır, ⌘Z / ⇧⌘Z (zaman çizelgesine gitmez)
window.addEventListener('keydown', e => {
  if ($('posterModal').hidden) return;
  const typing = /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) || e.target.isContentEditable;   // form denetimleri kendi tuşlarını kullanır
  if (e.key === 'Escape' && !typing){ $('posterModal').hidden = true; e.stopPropagation(); return; }
  if (typing) return;
  const mod = e.metaKey || e.ctrlKey, L = pSel !== 'bg' && pLayer(pSel);
  if (mod && e.key.toLowerCase() === 'z'){ (e.shiftKey ? $('pRedo') : $('pUndo')).click(); }
  else if ((e.key === 'Backspace' || e.key === 'Delete') && L){ POSTER.layers = POSTER.layers.filter(l => l !== L); pSel = 'bg'; pCommit(); renderPosterUI(); }
  else if (L && e.key.startsWith('Arrow')){
    const [W, H] = pSize(), st = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') L.x -= st / W; if (e.key === 'ArrowRight') L.x += st / W;
    if (e.key === 'ArrowUp') L.y -= st / H; if (e.key === 'ArrowDown') L.y += st / H;
    posterDraw(); clearTimeout(posterWheelT); posterWheelT = setTimeout(pCommit, 400);
  } else return;
  e.preventDefault(); e.stopPropagation();
}, true);

/* ---------- Arka plan seçimi ---------- */
async function pickBgFile(){
  const [src] = await api.openFiles('image', false); if (!src) return;
  const p = await api.importMedia(src); if (!p){ toast('Görsel kopyalanamadı', 'err'); return; }
  Object.assign(POSTER.bg, {path: p, zoom: 100, panX: 0, panY: 0}); pCommit();
  loadPosterImg(() => { renderProps(); posterDraw(); });
}
// oynatma kafasındaki videonun karesi tam çözünürlükte (altyazı ve efektler olmadan)
async function pickBgFrame(){
  const act = activeAt(T); if (!act.length){ toast('Oynatma kafasının altında video yok'); return; }
  const o = act[act.length - 1], c = o.c;
  const src = c.in + clamp(T - o.t0, 0, o.len - 0.04) * spd(c);
  const out = await api.joinPath(await api.mediaDir(), `poster_${hash(c.path + src.toFixed(3))}.png`);
  try { if (!(await api.exists(out))) await runFfmpeg(['-ss', src.toFixed(3), '-i', c.path, '-frames:v', '1', out], 0); }
  catch (e){ toast('Kare alınamadı', 'err'); return; }
  Object.assign(POSTER.bg, {path: out, zoom: 100, panX: 0, panY: 0}); pCommit();
  loadPosterImg(() => { renderProps(); posterDraw(); });
}

/* ---------- Aç / indir ---------- */
async function showPosterDir(){ await showExportDir(); $('pDirName').textContent = '‎' + exportDir + '‎'; $('pDirName').title = exportDir; }
function openPoster(){
  POSTER = migratePoster(POSTER) || defaultPoster();
  if (pSel !== 'bg' && !pLayer(pSel)) pSel = 'bg';
  pUndo.length = 0; pRedo.length = 0; pLast = JSON.stringify(POSTER);
  $('posterModal').hidden = false; showPosterDir();
  renderPosterUI(); loadPosterImg(posterDraw);
}
$('openPoster').onclick = openPoster;
$('posterClose').onclick = () => { $('posterModal').hidden = true; };
$('pDirPick').onclick = async () => {
  const d = await api.pickFolder(exportDir); if (!d) return;
  exportDir = d; try { localStorage.setItem(EXPORT_DIR_KEY, d); } catch (e){}
  showPosterDir();
};
let lastPoster = null;
$('pDownload').onclick = async () => {
  await showPosterDir();
  const [W, H] = pSize(), c = document.createElement('canvas'); c.width = W; c.height = H;
  renderPoster(c.getContext('2d'), W, H, false);
  const ext = POSTER.format === 'jpg' ? 'jpg' : 'png';
  const big = [...POSTER.layers].sort((a, b) => b.size - a.size)[0];
  const name = ((big ? trUp(big.text).replace(/\n/g, ' ') : 'poster').replace(/[\\/:*?"<>|]/g, '-').trim() || 'poster') + ' poster';
  let out;
  for (let n = 1; ; n++){ out = await api.joinPath(exportDir, (n === 1 ? name : `${name} (${n})`) + '.' + ext); if (!(await api.exists(out))) break; }
  const blob = await new Promise(r => c.toBlob(r, ext === 'jpg' ? 'image/jpeg' : 'image/png', 0.93));
  await api.writeFile(out, new Uint8Array(await blob.arrayBuffer()));
  lastPoster = out; $('pReveal').disabled = false;
  toast(`Poster kaydedildi: ${basename(out)}`);
};
$('pReveal').onclick = () => lastPoster && api.reveal(lastPoster);
