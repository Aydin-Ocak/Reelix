/* Reelix — uygulama mantığı (CapCut tarzı düzen: kitaplık · oynatıcı · denetçi · zaman çizelgesi) */
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');

const DEF_ENV = () => [{t: 0, v: 1}, {t: 1, v: 1}];
const P = { clips: [], audios: [], overlays: [], effects: [], cues: [], fadeStart: false, fadeEnd: false, edgeD: 1, defTr: {type: 'fadeblack', d: 1} };
let LIB = [];                     // içe aktarılan dosyalar (proje genelinde ortak)
// Proje = sahneler + proje düzeyindeki altyazılar, kitaplık ve çıktı ayarı.
// Editör her an tek bir görünümü düzenler (bir sahne veya proje): görünümün verisi P'ye yüklenir (loadView), geri saklanır (storeView).
let SCENES = [], curScene = null;
let VIEW = 'scene';                // 'scene': bir sahne düzenleniyor · 'project': sahneleri birleştiren proje zaman çizelgesi
let PROJ = null;                   // proje zaman çizelgesi: {clips: sahne blokları, audios, overlays, …}
let libSel = new Set(), libFocus = false;   // kitaplıkta seçili dosyalar; libFocus: son tıklanan yer kitaplık mı
const media = new Map();          // id -> <video>/<audio>
let L = [], TOTAL = 0, VEND = 0;  // klip yerleşimi; VEND = videonun bittiği an, TOTAL = proje süresi (ses daha uzunsa uzar)
let sel = null, selAud = null, selCue = -1, selTr = 0, inspMode = 'project', inspTab = 'video';
let multi = new Set();            // çoklu seçim: 'c:<id>' (klip) / 'a:<id>' (ses) / 'o:<id>' (video katmanı)
let selOv = null;                 // seçili video katmanı
let selEfx = null;                // seçili efekt katmanı ('e:<id>'): {id, eff: {id, k}, start, len}
let tool = 'select';              // 'select' | 'blade'
// Zaman çizelgesi ayarları (CapCut: ana iz mıknatısı, otomatik yakalama, bağlantı, önizleme ekseni)
const OPT = Object.assign({magnet: true, snap: true, link: true, linkAudio: true, linkSubs: true, linkOver: true, axis: true, axisAudio: false},
  (() => { try { return JSON.parse(localStorage.getItem('reelix-tl-opts') || '{}'); } catch (e){ return {}; } })());
const saveOpt = () => { try { localStorage.setItem('reelix-tl-opts', JSON.stringify(OPT)); } catch (e){} };
let hoverT = null;                // önizleme ekseni: farenin üzerinde olduğu an
const viewT = () => (hoverT != null && !playing ? hoverT : T);
let T = 0, playing = false, lastExport = null, curPps = 1, projPath = null;
let subBusy = false, exportJob = null, exportCancelled = false;
let splitSrc = null, splitJob = null, splitCancelled = false, splitOutDir = null;
let cacheDir = null;

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const basename = p => p.split(/[\\/]/).pop();
const stem = p => { const b = basename(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };
const extname = p => { const b = basename(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const fileUrl = p => 'file://' + p.split('/').map(encodeURIComponent).join('/');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
function fmt(t, dec = 1){
  t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(dec).padStart(dec ? dec + 3 : 2, '0')}`;
}
function tc(t, fps = 30){
  t = Math.max(0, t || 0);
  const f = Math.floor((t % 1) * fps + 1e-6), s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  return [h, m, s, f].map(x => String(x).padStart(2, '0')).join(':');
}
let toastTimer;
function toast(msg, kind){
  const el = $('toast'); el.textContent = msg; el.style.display = 'block';
  el.style.borderColor = kind === 'err' ? 'var(--err)' : 'transparent';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.display = 'none', 4000);
}
function setStatus(id, msg, kind = ''){ const el = $(id); el.textContent = msg; el.className = 'status ' + kind; }

const ICON = {
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/></svg>',
  bowtie: '<svg viewBox="0 0 24 24"><path d="M3.5 6.5 12 12l-8.5 5.5zM20.5 6.5 12 12l8.5 5.5z"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z" class="f"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M8 19h8"/></svg>',
  trans: '<svg viewBox="0 0 24 24"><path d="M4 6h7v12H4zM13 6h7v12h-7z"/><path d="M11 12h2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" class="f"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" class="f"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  scene: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5l-2 4M14 5l-2 4M20 5l-2 4"/></svg>',
  scenes: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  moveTo: '<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM9 13h6M12.5 10.5 15 13l-2.5 2.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" class="f"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  volOff: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" class="f"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
};

const progressCbs = new Map();
api.onProgress((id, p) => { const cb = progressCbs.get(id); if (cb) cb(p); });
async function runFfmpeg(args, dur, onP){
  const id = uid(); progressCbs.set(id, onP || (() => {}));
  try { return await api.ffmpeg(id, args, dur); } finally { progressCbs.delete(id); }
}

/* ================= Sekmeler ================= */
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(name){
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + name));
  if (name === 'fx') renderFxTab();
}

/* ================= Geçiş efektleri ================= */
const TRANSITIONS = [
  {id: 'fade',       name: 'Çapraz geçiş'},
  {id: 'fadeblack',  name: 'Kararma'},
  {id: 'fadewhite',  name: 'Beyaz flaş'},
  {id: 'wipeleft',   name: 'Silme sola'},
  {id: 'wiperight',  name: 'Silme sağa'},
  {id: 'slideleft',  name: 'Kaydırma sola'},
  {id: 'slideup',    name: 'Kaydırma yukarı'},
  {id: 'circleopen', name: 'Daire'},
  {id: 'radial',     name: 'Saat yönü'},
  {id: 'zoomin',     name: 'Yakınlaşma'},
  {id: 'pixelize',   name: 'Pikselleşme'},
  {id: 'dissolve',   name: 'Çözülme'},
];
const trName = id => (TRANSITIONS.find(t => t.id === id) || {name: id}).name;
const pixCanvas = document.createElement('canvas'), pixCtx = pixCanvas.getContext('2d');
let noiseCanvas = null;
function getNoise(){
  if (noiseCanvas) return noiseCanvas;
  noiseCanvas = document.createElement('canvas'); noiseCanvas.width = 160; noiseCanvas.height = 90;
  const g = noiseCanvas.getContext('2d'), d = g.createImageData(160, 90);
  for (let i = 0; i < d.data.length; i += 4){ const v = Math.random() * 255; d.data[i] = d.data[i+1] = d.data[i+2] = v; d.data[i+3] = 255; }
  g.putImageData(d, 0, 0); return noiseCanvas;
}
// drawA / drawB: verilen bağlama kareyi siyah zeminle çizer. p: 0 → 1
function drawTransition(g, type, drawA, drawB, p, W, H){
  const e = p * p * (3 - 2 * p);
  g.save();
  switch (type){
    case 'fadeblack': case 'fadewhite': {
      const col = type === 'fadeblack' ? '0,0,0' : '255,255,255';
      if (p < 0.5){ drawA(g); g.fillStyle = `rgba(${col},${p * 2})`; }
      else { drawB(g); g.fillStyle = `rgba(${col},${(1 - p) * 2})`; }
      g.fillRect(0, 0, W, H); break; }
    case 'wipeleft':  drawA(g); g.beginPath(); g.rect((1 - e) * W, 0, W, H); g.clip(); drawB(g); break;
    case 'wiperight': drawA(g); g.beginPath(); g.rect(0, 0, e * W, H); g.clip(); drawB(g); break;
    case 'slideleft':
      g.save(); g.translate(-e * W, 0); drawA(g); g.restore();
      g.translate((1 - e) * W, 0); drawB(g); break;
    case 'slideup':
      g.save(); g.translate(0, -e * H); drawA(g); g.restore();
      g.translate(0, (1 - e) * H); drawB(g); break;
    case 'circleopen':
      drawA(g); g.beginPath(); g.arc(W / 2, H / 2, e * Math.hypot(W, H) / 2, 0, Math.PI * 2); g.clip(); drawB(g); break;
    case 'radial':
      drawA(g); g.beginPath(); g.moveTo(W / 2, H / 2);
      g.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + e * Math.PI * 2); g.closePath(); g.clip(); drawB(g); break;
    case 'zoomin':
      g.save(); g.translate(W / 2, H / 2); g.scale(1 + e * 0.6, 1 + e * 0.6); g.translate(-W / 2, -H / 2); drawA(g); g.restore();
      g.globalAlpha = e; drawB(g); break;
    case 'pixelize': {
      const amt = 1 - Math.abs(2 * p - 1), s = Math.max(1 / 60, 1 - amt * 0.985);
      const w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
      pixCanvas.width = W; pixCanvas.height = H;
      (p < 0.5 ? drawA : drawB)(pixCtx);
      g.imageSmoothingEnabled = false;
      g.drawImage(pixCanvas, 0, 0, W, H, 0, 0, w, h);
      g.drawImage(g.canvas, 0, 0, w, h, 0, 0, W, H);
      g.imageSmoothingEnabled = true; break; }
    case 'dissolve': {
      drawA(g);
      pixCanvas.width = W; pixCanvas.height = H; drawB(pixCtx);
      pixCtx.globalCompositeOperation = 'destination-in';
      pixCtx.imageSmoothingEnabled = false;
      pixCtx.filter = `contrast(2000%) brightness(${(e * 2 - 0.5) * 100 + 50}%)`;
      pixCtx.drawImage(getNoise(), 0, 0, W, H);
      pixCtx.filter = 'none'; pixCtx.globalCompositeOperation = 'source-over';
      g.drawImage(pixCanvas, 0, 0); break; }
    default: drawA(g); g.globalAlpha = e; drawB(g);
  }
  g.restore();
}

/* ================= Zaman çizelgesi modeli ================= */
// hız: 1 = normal; zaman çizelgesindeki uzunluk = kaynak süresi / hız
const spd = x => x.speed || 1;
// proje görünümünde ana izdeki öğeler sahne bloklarıdır ({scene: id}); uzunlukları sahnenin süresidir
const clipLen = c => c.scene ? Math.max(0.1, sceneInfo(c.scene).dur) : Math.max(0.1, (c.out - c.in) / spd(c));
// ffmpeg atempo tek seferde 0.5–100 arası kabul eder; daha yavaşı zincirle
function atempo(sp){
  if (Math.abs(sp - 1) < 1e-3) return '';
  const f = []; let r = sp;
  while (r < 0.5){ f.push('atempo=0.5'); r /= 0.5; }
  f.push(`atempo=${r.toFixed(4)}`);
  return ',' + f.join(',');
}
// clips listesindeki i. ile i+1. öğe arasındaki geçerli geçiş
function trOfIn(clips, i){
  const a = clips[i], b = clips[i + 1];
  if (!a || !b || !a.tr || a.tr.type === 'none' || (b.gap || 0) > 0.001) return null;
  let d = Math.min(a.tr.d, clipLen(a) / 2, clipLen(b) / 2);
  if (a.scene){   // sahneler arası: yalnızca A'nın videosu sonuna kadar sürüyorsa ve B videoyla başlıyorsa
    const A = sceneInfo(a.scene), B = sceneInfo(b.scene);
    if (!A.fills || !B.startsVideo) return null;
    d = Math.min(d, A.lastLen / 2, B.firstLen / 2);
  }
  return d >= 0.05 ? {type: a.tr.type, d} : null;
}
const trOf = i => trOfIn(P.clips, i);
// klipleri zamana yerleştir: t0, uzunluk, giriş/çıkış geçişi, boşluk, başta/sonda kararma (fi/fo)
function layoutClips(clips, fadeStart, fadeEnd, edgeD){
  let t = 0;
  const out = clips.map((c, i) => {
    const gap = c.gap || 0; t += gap;   // mıknatıs kapalıyken klibin önündeki boşluk
    const o = {c, i, t0: t, len: clipLen(c), gap, trIn: i ? trOfIn(clips, i - 1) : null, trOut: trOfIn(clips, i), fi: 0, fo: 0};
    t += o.len - (o.trOut ? o.trOut.d : 0);
    return o;
  });
  if (out.length){ if (fadeStart) out[0].fi = edgeD; if (fadeEnd) out[out.length - 1].fo = edgeD; }
  return out;
}
// sahne özeti (süre, video sonu, sahneler arası geçiş için uç bilgileri)
const sceneCache = new Map();
function sceneInfo(id){
  if (sceneCache.has(id)) return sceneCache.get(id);
  const sc = sceneById(id), r = {dur: 0.1, vend: 0, fills: false, startsVideo: false, firstLen: 0, lastLen: 0};
  if (sc){
    const sl = layoutClips(sc.clips, false, false, 1);
    r.vend = sl.length ? sl[sl.length - 1].t0 + sl[sl.length - 1].len : 0;
    r.dur = Math.max(0.1, r.vend, ...sc.audios.map(a => a.start + audioLen(a)), ...sc.overlays.map(o => o.start + clipLen(o)));
    r.fills = sl.length > 0 && r.vend >= r.dur - 0.01;
    r.startsVideo = sl.length > 0 && sl[0].t0 < 0.001;
    r.firstLen = sl.length ? sl[0].len : 0; r.lastLen = sl.length ? sl[sl.length - 1].len : 0;
  }
  sceneCache.set(id, r);
  return r;
}
// Oynatma ve dışa aktarma motorunun gördüğü zaman çizelgesi.
// Sahnede: sahnenin kendisi. Projede: sahneler tek zaman çizelgesine düzleştirilir + proje katmanları.
let ENG = {L: [], audios: [], overlays: [], effects: [], cues: [], VEND: 0};
function flattenProject(){
  const EL = [], EA = [], EO = [], EE = [], EC = [];
  for (const o of L){
    const sc = sceneById(o.c.scene); if (!sc) continue;
    const sl = layoutClips(sc.clips, sc.fadeStart, sc.fadeEnd, sc.edgeD), mute = !!o.c.muted;
    sl.forEach((se, j) => {
      const e = {...se, t0: o.t0 + se.t0, mute, sc: sc.id};
      if (j === 0) e.trIn = o.trIn || null;
      if (j === sl.length - 1) e.trOut = o.trOut || null;
      EL.push(e);
    });
    sc.audios.forEach(a => EA.push({...a, start: a.start + o.t0, muted: a.muted || mute, sc: sc.id}));
    sc.overlays.forEach(v => EO.push({...v, start: v.start + o.t0, muted: v.muted || mute, sc: sc.id, z: (v.track ?? 0) - 1000}));
    (sc.effects || []).forEach(x => EE.push({...x, start: x.start + o.t0}));
    const end = o.t0 + o.len;   // sahne metni sahnenin dışına taşmaz
    (sc.cues || []).forEach(c => { if (c.start < o.len) EC.push({...c, start: c.start + o.t0, end: Math.min(end, c.end + o.t0), words: c.words.map(w => ({...w, s: w.s + o.t0, e: w.e + o.t0}))}); });
  }
  EL.forEach((e, i) => { e.i = i; e.gap = e.trIn ? 0 : e.t0 - (i ? EL[i - 1].t0 + EL[i - 1].len : 0); });
  if (EL.length){ if (P.fadeStart) EL[0].fi = Math.max(EL[0].fi, P.edgeD); if (P.fadeEnd) EL[EL.length - 1].fo = Math.max(EL[EL.length - 1].fo, P.edgeD); }
  ENG = {L: EL, audios: [...EA, ...P.audios], overlays: [...EO, ...P.overlays], effects: [...EE, ...P.effects], cues: [...EC, ...P.cues], VEND: EL.length ? EL[EL.length - 1].t0 + EL[EL.length - 1].len : 0};
}
function relayout(){
  L = VIEW === 'project' ? layoutClips(P.clips, false, false, 1) : layoutClips(P.clips, P.fadeStart, P.fadeEnd, P.edgeD);
  VEND = L.length ? L[L.length - 1].t0 + L[L.length - 1].len : 0;
  TOTAL = Math.max(VEND, ...P.audios.map(a => a.start + audioLen(a)), ...P.overlays.map(o => o.start + clipLen(o)), 0);
  if (VIEW === 'project') flattenProject();
  else ENG = {L, audios: P.audios, overlays: P.overlays, effects: P.effects, cues: P.cues, VEND};
  if (T > TOTAL) T = TOTAL;
  if (selTr > P.clips.length - 2) selTr = Math.max(0, P.clips.length - 2);
}
function activeAt(t){
  const EL = ENG.L, r = EL.filter(o => t >= o.t0 && t < o.t0 + o.len);
  if (!r.length && EL.length && Math.abs(t - ENG.VEND) < 1e-3) return [EL[EL.length - 1]];
  return r;
}
function envAt(env, f){
  if (!env || !env.length) return 1;
  if (f <= env[0].t) return env[0].v;
  for (let i = 1; i < env.length; i++){
    const a = env[i - 1], b = env[i];
    if (f <= b.t) return b.t - a.t < 1e-6 ? b.v : a.v + (b.v - a.v) * (f - a.t) / (b.t - a.t);
  }
  return env[env.length - 1].v;
}
const isFlat = env => !env || env.every(p => Math.abs(p.v - 1) < 1e-3);
// motor yerleşimindeki bir klibin o anki ses kazancı
function gainAt(o, local){
  const c = o.c, len = o.len;
  let g = c.muted || o.mute ? 0 : c.vol * envAt(c.env, local / len);
  if (c.fadeIn > 0 && local < c.fadeIn) g *= local / c.fadeIn;
  if (c.fadeOut > 0 && local > len - c.fadeOut) g *= Math.max(0, (len - local) / c.fadeOut);
  if (o.fi > 0) g *= clamp(local / o.fi, 0, 1);
  if (o.fo > 0) g *= clamp((len - local) / o.fo, 0, 1);
  if (o.trIn && local < o.trIn.d) g *= local / o.trIn.d;
  if (o.trOut && local > len - o.trOut.d) g *= (len - local) / o.trOut.d;
  return g;
}
function edgeDark(t){
  let a = 0;
  for (const o of ENG.L){
    if (o.fi > 0 && t < o.t0 + o.fi && t >= o.t0 - o.gap) a = Math.max(a, 1 - Math.max(0, t - o.t0) / o.fi);
    if (o.fo > 0 && t > o.t0 + o.len - o.fo && t < o.t0 + o.len) a = Math.max(a, 1 - (o.t0 + o.len - t) / o.fo);
  }
  return clamp(a, 0, 1);
}
// ses katmanının zaman çizelgesindeki uzunluğu: kullanıcı ayarlar; döngü kapalıyken dosyanın kalan süresini geçemez
const audioMax = a => a.loop ? 36000 : Math.max(0.1, (a.dur - a.trimIn) / spd(a));
function audioLen(a){
  return clamp(a.len ?? (a.dur - a.trimIn) / spd(a), 0.1, audioMax(a));
}
function audioGain(a, local, len){
  let g = a.muted ? 0 : a.vol * envAt(a.env, len > 0 ? local / len : 0);
  if (a.fadeIn > 0 && local < a.fadeIn) g *= local / a.fadeIn;
  if (a.fadeOut > 0 && local > len - a.fadeOut) g *= Math.max(0, (len - local) / a.fadeOut);
  return g;
}
// çıktı boyutu ve kare hızı projede tek ayar: "Orijinal" seçiliyse projedeki ilk videoya göre
function firstVideo(){
  for (const sc of SCENES){ const cl = VIEW === 'scene' && sc.id === curScene ? P.clips : sc.clips; if (cl.length) return cl[0]; }
  return null;
}
function outRes(){
  const v = $('outRes').value; let W, H;
  if (v === 'auto'){ const c = firstVideo(); W = c && c.w ? c.w : 1920; H = c && c.h ? c.h : 1080; }
  else [W, H] = v.split('x').map(Number);
  return {W: Math.max(2, W & ~1), H: Math.max(2, H & ~1)};
}
function outFps(){
  const v = $('outFps').value; if (v !== 'auto') return +v;
  const f = (firstVideo() || {}).fps || 30;
  return f > 45 ? 60 : f > 27 ? 30 : f > 24.5 ? 25 : f > 20 ? 24 : 30;
}

/* ================= Medya ================= */
function makeMedia(item, tag){
  const el = document.createElement(tag);
  el.preload = 'auto'; el.src = fileUrl(item.path); el.dataset.path = item.path;
  el.addEventListener('seeked', () => { if (!playing) draw(); });
  el.addEventListener('loadeddata', () => { if (!playing) draw(); });
  el.addEventListener('error', () => mediaFailed(item, el));
  media.set(item.id, el);
  return el;
}
// medya açılamadı: kapatılmış öğeyse yok say; dosya yerinde değilse "bulunamadı" de ve öğeyi işaretle
const missingNames = new Set(); let missingTimer = null;
async function mediaFailed(item, el){
  if (el.dataset.dropped || media.get(item.id) !== el) return;
  if (await api.exists(item.path)){ toast(`${item.name} önizlemede oynatılamıyor. Dışa aktarma yine çalışır.`, 'err'); return; }
  for (const it of allItems()) if (it.path === item.path) it.missing = true;
  missingNames.add(item.name);
  clearTimeout(missingTimer);
  missingTimer = setTimeout(() => {
    const n = [...missingNames]; missingNames.clear();
    toast(n.length === 1 ? `Dosya bulunamadı: ${n[0]}. Taşındıysa veya silindiyse projeye yeniden ekle.` : `${n.length} dosya bulunamadı (${n.slice(0, 3).join(', ')}${n.length > 3 ? '…' : ''}). Taşındıysa veya silindiyse projeye yeniden ekle.`, 'err');
    renderTimeline();
  }, 300);
}
function dropMedia(id){
  const el = media.get(id); if (!el) return;
  el.dataset.dropped = '1'; el.pause(); el.removeAttribute('src'); el.load(); media.delete(id);
}
// projedeki tüm öğeler (tüm sahneler + proje katmanları + düzenlenen görünüm)
function allItems(){
  const out = [...P.clips, ...P.audios, ...P.overlays];
  for (const v of [...SCENES, PROJ]) if (v) out.push(...v.clips, ...v.audios, ...v.overlays);
  return [...new Set(out)];
}
// Küçük resim şeridi ve dalga formu (dosya başına bir kez, diskte önbellekli)
const visualJobs = new Map(), visCache = new Map();
const visKey = it => it.path + '|' + it.dur;
function applyVisuals(key){
  const v = visCache.get(key); if (!v) return;
  for (const it of [...LIB, ...allItems()]) if (visKey(it) === key) Object.assign(it, v);
}
function ensureVisuals(item, isVideo){
  const key = visKey(item);
  if (!visualJobs.has(key)) visualJobs.set(key, (async () => {
    cacheDir = cacheDir || await api.cacheDir();
    const h = hash(key), out = {};
    if (isVideo){
      const N = clamp(Math.round(item.dur / 1.2), 6, 90), tp = `${cacheDir}/${h}_t${N}.jpg`;
      try {
        const fast = item.dur > 180 ? ['-skip_frame', 'nokey'] : [];
        if (!(await api.exists(tp))) await runFfmpeg([...fast, '-i', item.path, '-an', '-sn',
          '-vf', `scale=-2:84,tpad=stop_mode=clone:stop_duration=${(item.dur + 2).toFixed(1)},fps=${N}/${item.dur.toFixed(3)},tile=${N}x1`,
          '-frames:v', '1', '-q:v', '5', tp], 0);
        if (await api.exists(tp)){ out.thumb = tp; out.thumbN = N; }
      } catch (e){ console.warn('kare üretilemedi', e); }
    }
    if (item.hasAudio !== false){
      const wp = `${cacheDir}/${h}_w.png`;
      try {
        if (!(await api.exists(wp))) await runFfmpeg(['-i', item.path, '-vn', '-sn', '-filter_complex',
          'aformat=channel_layouts=mono,showwavespic=s=3000x160:colors=#ffffff:scale=sqrt:draw=full', '-frames:v', '1', wp], 0);
        if (await api.exists(wp)) out.wave = wp;
      } catch (e){ console.warn('dalga formu üretilemedi', e); }
    }
    visCache.set(key, out);
    return out;
  })());
  visualJobs.get(key).then(() => { applyVisuals(key); renderTimeline(); renderLibrary(); });
}

/* ================= Kitaplık ================= */
const VIDEO_EXT = ['mp4','mov','m4v','mkv','webm','avi','mts'];
const AUDIO_EXT = ['mp3','wav','m4a','aac','ogg','flac','opus'];
// resim: zaman çizelgesinde video gibi davransın diye uzun, sessiz ve hareketsiz bir klibe çevrilir (bir kez, Medya klasörüne)
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'bmp', 'gif'];
const IMAGE_SEC = 60, IMAGE_DEF = 5;   // klip en çok 1 dk uzatılabilir; zaman çizelgesine 5 sn gelir
async function imageToClip(src){
  const out = await api.joinPath(await api.mediaDir(), `${stem(src)}__gorsel_${hash(src)}.mp4`);
  if (!(await api.exists(out)))
    await runFfmpeg(['-loop', '1', '-framerate', '30', '-t', String(IMAGE_SEC), '-i', src, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '14', '-an', out], IMAGE_SEC);
  return out;
}
async function importFiles(paths){
  const added = [];
  if (paths.length) toast(paths.length > 1 ? `${paths.length} dosya kitaplığa kopyalanıyor…` : 'Dosya kitaplığa kopyalanıyor…');
  for (const src of paths){
    // kaynak (ör. İndirilenler) silinse de kaybolmasın diye uygulama klasörüne kopyala
    let p; try { p = await api.importMedia(src); } catch (e){ toast(`${basename(src)} kopyalanamadı: ${e.message}`, 'err'); continue; }
    if (!p){ toast(`${basename(src)} bulunamadı`, 'err'); continue; }
    if (IMAGE_EXT.includes(extname(p))){
      let clip; try { clip = await imageToClip(p); } catch (e){ toast(`${basename(src)} açılamadı`, 'err'); continue; }
      const ex = LIB.find(x => x.path === clip); if (ex){ added.push(ex); continue; }
      const info = await api.probe(clip);
      const it = {id: uid(), path: clip, name: basename(src), kind: 'video', image: true, src: p, dur: info.duration, w: info.width, h: info.height, fps: info.fps, hasAudio: false};
      LIB.push(it); ensureVisuals(it, true); added.push(it); continue;
    }
    const ex = LIB.find(x => x.path === p); if (ex){ added.push(ex); continue; }
    const info = await api.probe(p);
    const kind = info.hasVideo && !AUDIO_EXT.includes(extname(p)) && info.duration > 0 ? 'video' : (info.hasAudio && info.duration > 0 ? 'audio' : null);
    if (!kind){ toast(`${basename(p)} açılamadı. Desteklenen bir video veya ses dosyası seç.`, 'err'); continue; }
    const it = {id: uid(), path: p, name: basename(p), kind, dur: info.duration, w: info.width, h: info.height, fps: info.fps, hasAudio: info.hasAudio};
    LIB.push(it); ensureVisuals(it, kind === 'video'); added.push(it);
  }
  renderLibrary();
  return added;
}
function insertClip(it, index){
  if (VIEW === 'project') return newOverlay(it, T);
  const c = {id: uid(), path: it.path, name: it.name, dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio,
             in: 0, out: it.image ? Math.min(IMAGE_DEF, it.dur) : it.dur, vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0, tr: null};
  Object.assign(c, visCache.get(visKey(it)) || {});
  if (index == null || index >= P.clips.length){
    if (P.clips.length) P.clips[P.clips.length - 1].tr = P.clips[P.clips.length - 1].tr || (P.defTr ? {...P.defTr} : null);
    P.clips.push(c);
  } else P.clips.splice(Math.max(0, index), 0, c);
  makeMedia(c, 'video');
  sel = c.id; inspMode = 'clip';
  return c;
}
function addLayer(it, start){
  const a = {id: uid(), path: it.path, name: it.name, dur: it.dur, len: it.dur, start: Math.max(0, start || 0), vol: 0.6, muted: false, env: DEF_ENV(),
             trimIn: 0, fadeIn: 0, fadeOut: 0, loop: false, hasAudio: true};
  Object.assign(a, visCache.get(visKey(it)) || {});
  a.track = freeTrack(a); P.audios.push(a); makeMedia(a, 'audio');
  selAud = a.id; inspMode = 'audio';
  return a;
}
// Dosyaları kitaplığa al ve zaman çizelgesine ekle (sürükle-bırak ve testler için)
async function addVideos(paths){
  if (!paths.length) return;
  pause();
  for (const it of await importFiles(paths)){ if (it.kind === 'video') insertClip(it); else addLayer(it, T); }
  refresh(); seek(T);
}
async function addAudios(paths){
  for (const it of await importFiles(paths)) addLayer(it, 0);
  refresh();
}
$('addVideo').onclick = async () => { await importFiles(await api.openFiles('media', true)); };
$('addAudio').onclick = async () => { await importFiles(await api.openFiles('audio', true)); showTab('audio'); };

function tileHtml(it){
  const used = allItems().filter(c => c.path === it.path).length;
  let th = '';
  if (it.kind === 'video' && it.thumb){
    const N = it.thumbN, idx = Math.floor(N / 2);
    th = `style="background-image:url('${fileUrl(it.thumb)}');background-size:${N * 100}% 100%;background-position:${(idx / Math.max(1, N - 1) * 100).toFixed(2)}% 0"`;
  }
  return `<div class="tile ${libSel.has(it.id) ? 'sel' : ''}" draggable="true" data-lib="${it.id}" title="${esc(it.path)}" aria-selected="${libSel.has(it.id)}">
    <div class="th ${it.kind === 'audio' ? 'audio' : ''}" ${th}>${it.kind === 'audio' ? ICON.audio : ''}
      <span class="dur">${it.image ? 'Görsel' : fmt(it.dur, 0)}</span>${used ? `<span class="used">Kullanıldı${used > 1 ? ' ×' + used : ''}</span>` : ''}
      <span class="add" data-add="${it.id}" title="Zaman çizelgesine ekle">+</span>${it.kind === 'video' ? `<span class="add ovadd" data-addov="${it.id}" title="Oynatma kafasına video katmanı olarak ekle">${ICON.layers}</span>` : ''}</div>
    <div class="nm">${esc(it.name)}</div></div>`;
}
/* ---- Ses efektleri: hazır (sentezlenen) sesler + kullanıcının eklediği sesler ---- */
const SFX_KEY = 'reelix-sfx';
const userSfx = () => { try { return JSON.parse(localStorage.getItem(SFX_KEY) || '[]'); } catch (e){ return []; } };
const sfxPreview = new Audio(); let sfxPlaying = null;
sfxPreview.onended = () => { sfxPlaying = null; renderSfx(); };
function renderSfx(){
  const row = (key, name, dur, del) => `<div class="sfx" data-sfx="${key}"><button class="ic ${sfxPlaying === key ? 'on' : ''}" data-sfxplay title="${sfxPlaying === key ? 'Durdur' : 'Dinle'}">${sfxPlaying === key ? ICON.pause : ICON.play}</button><span class="sn">${esc(name)}</span>${dur ? `<span class="sd">${fmt(dur)}</span>` : ''}${del ? `<button class="ic" data-sfxdel title="Listeden kaldır">${ICON.close}</button>` : ''}<button class="ic" data-sfxadd title="Oynatma kafasına ekle">${ICON.plus}</button></div>`;
  $('sfxList').innerHTML = SFX.map(x => row(x.id, x.name, x.d)).join('') + userSfx().map((x, i) => row('u' + i, x.name, x.dur, true)).join('');
}
// hazır sesi gerekirse üret; {path, name, dur}
async function sfxItem(key){
  if (key[0] === 'u'){ const x = userSfx()[+key.slice(1)]; return x && (await api.exists(x.path)) ? x : null; }
  const s = SFX.find(x => x.id === key); if (!s) return null;
  const out = await api.joinPath(await api.mediaDir(), `sfx_${s.id}_v${SFX_VER}.m4a`);
  if (!(await api.exists(out))) await runFfmpeg(sfxArgs(s, out), s.d);
  return {path: out, name: s.name, dur: (await api.probe(out)).duration || s.d};
}
$('sfxList').addEventListener('click', async e => {
  const r = e.target.closest('[data-sfx]'); if (!r) return;
  const key = r.dataset.sfx;
  if (e.target.closest('[data-sfxdel]')){ const l = userSfx(); l.splice(+key.slice(1), 1); localStorage.setItem(SFX_KEY, JSON.stringify(l)); renderSfx(); return; }
  if (e.target.closest('[data-sfxplay]')){
    if (sfxPlaying === key){ sfxPreview.pause(); sfxPlaying = null; renderSfx(); return; }
    const it = await sfxItem(key); if (!it){ toast('Ses dosyası bulunamadı', 'err'); return; }
    sfxPreview.src = fileUrl(it.path); sfxPreview.play().catch(() => {}); sfxPlaying = key; renderSfx(); return;
  }
  if (e.target.closest('[data-sfxadd]')){
    const it = await sfxItem(key); if (!it){ toast('Ses dosyası bulunamadı', 'err'); return; }
    pause();
    const a = addLayer({...it, kind: 'audio', hasAudio: true}, T);
    a.vol = 1; ensureVisuals(a, false);
    multi = new Set(['a:' + a.id]); setPrimary('a:' + a.id);
    refresh(); toast(`${it.name} oynatma kafasına eklendi`);
  }
});
$('addSfx').onclick = async () => {
  const paths = await api.openFiles('audio', true); if (!paths.length) return;
  const l = userSfx();
  for (const src of paths){
    const p = await api.importMedia(src); if (!p) continue;
    const info = await api.probe(p);
    if (!(info.duration > 0)){ toast(`${basename(src)} açılamadı`, 'err'); continue; }
    if (!l.some(x => x.path === p)) l.push({path: p, name: stem(src), dur: info.duration});
  }
  localStorage.setItem(SFX_KEY, JSON.stringify(l)); renderSfx();
};
renderSfx();
function renderLibrary(){
  const vids = LIB.filter(x => x.kind === 'video'), auds = LIB.filter(x => x.kind === 'audio');
  $('mediaGrid').innerHTML = vids.length ? vids.map(tileHtml).join('')
    : '<div class="empty">Video eklemek için <b>İçe aktar</b>\'a tıkla<br>veya dosyaları pencereye sürükle</div>';
  $('audioGrid').innerHTML = auds.length ? auds.map(tileHtml).join('')
    : '<div class="empty">Müzik veya ses eklemek için <b>Ses içe aktar</b>\'a tıkla</div>';
  const nv = vids.filter(x => libSel.has(x.id)).length, na = auds.filter(x => libSel.has(x.id)).length;
  $('delMedia').disabled = !nv; $('delAudio').disabled = !na;
}
// açık kitaplık sekmesindeki dosyalar
const libTabKind = () => $('tab-audio').classList.contains('on') ? 'audio' : 'video';
function selectAllLib(){
  libSel = new Set(LIB.filter(x => x.kind === libTabKind()).map(x => x.id));
  renderLibrary();
}
// seçili dosyaları kitaplıktan kaldır (zaman çizelgesindeki klipler yerinde kalır)
function deleteLibSelected(kind){
  const del = LIB.filter(x => libSel.has(x.id) && (!kind || x.kind === kind));
  if (!del.length) return;
  const all = allItems(), used = del.filter(it => all.some(c => c.path === it.path)).length;
  if (used && !confirm(`${used} dosya zaman çizelgesinde kullanılıyor. Kitaplıktan kaldırılsın mı? Zaman çizelgesindeki klipler yerinde kalır.`)) return;
  const ids = new Set(del.map(x => x.id));
  LIB = LIB.filter(x => !ids.has(x.id));
  ids.forEach(id => libSel.delete(id));
  renderLibrary();
  toast(`${del.length} dosya kitaplıktan kaldırıldı`);
}
$('delMedia').onclick = () => deleteLibSelected('video');
$('delAudio').onclick = () => deleteLibSelected('audio');
function addFromLib(id){
  const it = LIB.find(x => x.id === id); if (!it) return;
  pause();
  if (it.kind === 'video') insertClip(it); else addLayer(it, T);
  refresh(); seek(T);
}
['mediaGrid', 'audioGrid'].forEach(g => {
  $(g).addEventListener('click', e => {
    const ov = e.target.closest('[data-addov]');
    if (ov){ const it = LIB.find(x => x.id === ov.dataset.addov); if (it){ pause(); newOverlay(it, T); refresh(); seek(T); } return; }
    const a = e.target.closest('[data-add]'); if (a){ addFromLib(a.dataset.add); return; }
    // tıkla = seç; ⇧/⌘ + tıkla = seçime ekle/çıkar; boş yere tıkla = seçimi kaldır
    const t = e.target.closest('[data-lib]'), id = t && t.dataset.lib;
    if (!id){ libSel.clear(); }
    else if (e.shiftKey || e.metaKey || e.ctrlKey){ libSel.has(id) ? libSel.delete(id) : libSel.add(id); }
    else libSel = new Set([id]);
    renderLibrary();
  });
  $(g).addEventListener('dblclick', e => { const t = e.target.closest('[data-lib]'); if (t) addFromLib(t.dataset.lib); });
  $(g).addEventListener('dragstart', e => {
    const t = e.target.closest('[data-lib]'); if (!t) return;
    e.dataTransfer.setData('application/x-reelix', t.dataset.lib); e.dataTransfer.effectAllowed = 'copy';
  });
});

// Dışarıdan dosya sürükle-bırak
let dragDepth = 0;
const isFileDrag = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; $('dropOverlay').style.display = 'flex'; });
window.addEventListener('dragleave', e => { if (!isFileDrag(e)) return; if (--dragDepth <= 0){ dragDepth = 0; $('dropOverlay').style.display = 'none'; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('dropOverlay').style.display = 'none';
  if (!isFileDrag(e)) return;
  const paths = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean);
  const media_ = paths.filter(p => VIDEO_EXT.includes(extname(p)) || AUDIO_EXT.includes(extname(p)) || IMAGE_EXT.includes(extname(p)));
  const subs = paths.filter(p => ['srt','vtt'].includes(extname(p)));
  if ($('tab-split').classList.contains('on') && media_.some(p => VIDEO_EXT.includes(extname(p)))){ setSplitSrc(media_.find(p => VIDEO_EXT.includes(extname(p)))); return; }
  await addVideos(media_);
  if (subs.length) loadSubsFrom(subs[0]);
});

/* ================= Oynatma ================= */
function setPlayIcon(){ $('play').innerHTML = playing ? ICON.pause : ICON.play; }
function play(){
  if (TOTAL <= 0) return;
  if (T >= TOTAL - 0.05) T = 0;
  playing = true; lastNow = performance.now(); setPlayIcon();
}
function pause(){
  playing = false;
  for (const el of media.values()) el.pause();
  setPlayIcon();
}
function seek(t){
  T = clamp(t, 0, TOTAL);
  syncVideos(true); syncOverlays(true); syncAudio(true); draw(); updateTime(); updatePlayhead();
}
function syncVideos(force, at = viewT()){
  const act = activeAt(at), ids = new Set(act.map(o => o.c.id));
  for (const o of ENG.L){
    const v = media.get(o.c.id); if (!v) continue;
    const local = at - o.t0;
    if (ids.has(o.c.id)){
      const target = o.c.in + clamp(local, 0, o.len - 0.01) * spd(o.c);
      if (v.playbackRate !== spd(o.c)) v.playbackRate = spd(o.c);
      if (playing){
        if (v.paused){ if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
      } else if (force && !v.seeking && Math.abs(v.currentTime - target) > 0.01) v.currentTime = target;
      v.volume = clamp(gainAt(o, local), 0, 1);
    } else {
      if (!v.paused) v.pause();
      if (local < 0 && local > -1.5 && !v.seeking && Math.abs(v.currentTime - o.c.in) > 0.05) v.currentTime = o.c.in;
    }
  }
}
/* ================= Video katmanları (overlay) ================= */
// çizim sırası: projede sahnelerin katmanları altta (z), proje katmanları üstte
const ovZ = o => o.z ?? (o.track ?? 0);
const ovActive = (t, list = ENG.overlays) => list.filter(o => t >= o.start && t < o.start + clipLen(o)).sort((a, b) => ovZ(a) - ovZ(b));
// katmanın önizlemedeki dikdörtgeni (kare içine sığdırılıp ölçeklenir)
function ovRect(o, W, H){
  const vw = o.w || 16, vh = o.h || 9, fit = Math.min(W / vw, H / vh) * (o.scale ?? 1);
  const w = vw * fit, h = vh * fit;
  return {x: (o.x ?? 0.5) * W - w / 2, y: (o.y ?? 0.5) * H - h / 2, w, h};
}
// efekt katmanı: o ana kadar çizilen görüntünün tamamına uygulanır
const fxBuf = document.createElement('canvas');
function drawEffectLayer(g, x, t, W, H){
  if (fxBuf.width !== W || fxBuf.height !== H){ fxBuf.width = W; fxBuf.height = H; }
  const b = fxBuf.getContext('2d'); b.clearRect(0, 0, W, H); b.drawImage(g.canvas, 0, 0);
  g.save(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  drawWithFx(g, {eff: x.eff}, t - x.start, x.len, W, H, gg => gg.drawImage(fxBuf, 0, 0), outFps());
  g.restore();
}
// ui: false = yalnızca katmanlar, 'sel' = yalnızca seçili katmanın çerçevesi
function drawOverlays(g, t, W, H, ui){
  if (ui !== 'sel') for (const o of ovActive(t)){
    const v = media.get(o.id); if (!v || v.readyState < 2) continue;
    const r = ovRect(o, W, H), lt = t - o.start;
    g.save(); g.globalAlpha = (o.opacity ?? 1) * fxFadeAt(o.fx, lt, clipLen(o));
    if (o.fx) g.filter = canvasFilter(fxParams(o.fx, false), W, H);
    g.drawImage(v, r.x, r.y, r.w, r.h); g.restore();
  }
  // seçili katman: sürüklenebilir çerçeve ve köşe tutamaçları
  const so = ui && inspMode === 'overlay' && P.overlays.find(o => o.id === selOv);
  if (so && t >= so.start && t < so.start + clipLen(so)){
    const r = ovRect(so, W, H), k = W / 640;
    g.save(); g.strokeStyle = '#00c8d2'; g.lineWidth = 2 * k; g.strokeRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#fff';
    for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]){ g.beginPath(); g.arc(cx, cy, 5 * k, 0, 7); g.fill(); }
    g.restore();
  }
}
function syncOverlays(force, at = viewT()){
  for (const o of ENG.overlays){
    const v = media.get(o.id); if (!v) continue;
    const len = clipLen(o), local = at - o.start;
    if (local >= 0 && local < len){
      const target = o.in + clamp(local, 0, len - 0.01) * spd(o);
      if (v.playbackRate !== spd(o)) v.playbackRate = spd(o);
      if (playing){
        if (v.paused){ if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
      } else if (force && !v.seeking && Math.abs(v.currentTime - target) > 0.01) v.currentTime = target;
      v.volume = clamp(ovGain(o, local), 0, 1);
    } else {
      if (!v.paused) v.pause();
      if (local < 0 && local > -1.5 && !v.seeking && Math.abs(v.currentTime - o.in) > 0.05) v.currentTime = o.in;
    }
  }
}
function ovGain(o, local){
  const len = clipLen(o);
  let g = o.muted || !o.hasAudio ? 0 : o.vol * envAt(o.env, local / len);
  if (o.fadeIn > 0 && local < o.fadeIn) g *= local / o.fadeIn;
  if (o.fadeOut > 0 && local > len - o.fadeOut) g *= Math.max(0, (len - local) / o.fadeOut);
  return g;
}
const OV_KEEP = ['id', 'path', 'name', 'dur', 'w', 'h', 'fps', 'hasAudio', 'in', 'out', 'speed', 'vol', 'muted', 'env', 'fadeIn', 'fadeOut', 'gid', 'thumb', 'thumbN', 'wave', 'fx', 'rev'];
const ovOverlaps = (o, list = P.overlays) => list.some(x => x !== o && (x.track ?? 0) === (o.track ?? 0) && x.start < o.start + clipLen(o) - 0.01 && x.start + clipLen(x) > o.start + 0.01);
function newOverlay(it, start, track){
  const o = {id: uid(), path: it.path, name: it.name, dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio,
             in: 0, out: it.image ? Math.min(IMAGE_DEF, it.dur) : it.dur, start: Math.max(0, start), track: track ?? 0, vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0,
             x: 0.5, y: 0.5, scale: 1, opacity: 1};
  Object.assign(o, visCache.get(visKey(it)) || {});
  P.overlays.push(o); makeMedia(o, 'video');
  if (track == null || ovOverlaps(o)) o.track = freeTrackIn(P.overlays, o, clipLen);
  multi = new Set(['o:' + o.id]); setPrimary('o:' + o.id);
  return o;
}
// ana izdeki klibi katmana taşı (aynı medya öğesi kullanılır)
function clipToOverlay(c, start, track){
  const o = {x: 0.5, y: 0.5, scale: 1, opacity: 1, start: Math.max(0, start), track};
  OV_KEEP.forEach(k => { if (c[k] !== undefined) o[k] = c[k]; });
  removeClip(c.id);
  P.overlays.push(o);
  if (ovOverlaps(o)) o.track = freeTrackIn(P.overlays, o, clipLen);
  multi = new Set(['o:' + o.id]); setPrimary('o:' + o.id);
}
// katmandaki videoyu ana ize taşı
function overlayToClip(o, index){
  const c = {tr: null, gap: 0};
  OV_KEEP.forEach(k => { if (o[k] !== undefined) c[k] = o[k]; });
  P.overlays = P.overlays.filter(x => x !== o);
  P.clips.splice(clamp(index, 0, P.clips.length), 0, c);
  multi = new Set(['c:' + c.id]); setPrimary('c:' + c.id);
}
// listede çakışmayan en alttaki iz
function freeTrackIn(list, item, lenOf){
  const s0 = item.start, e0 = item.start + lenOf(item);
  for (let t = 0; ; t++){
    if (!list.some(x => x !== item && (x.track ?? 0) === t && x.start < e0 - 0.01 && x.start + lenOf(x) > s0 + 0.01)) return t;
  }
}
function syncAudio(force){
  for (const a of ENG.audios){
    const el = media.get(a.id); if (!el) continue;
    const len = audioLen(a), local = T - a.start;
    if (playing && local >= 0 && local < len){
      const avail = Math.max(0.01, a.dur - a.trimIn), src = local * spd(a);
      const pos = src < avail ? a.trimIn + src : (src - avail) % Math.max(0.01, a.dur);
      if (el.playbackRate !== spd(a)) el.playbackRate = spd(a);
      if (el.paused){ el.currentTime = pos; el.play().catch(() => {}); }
      else if (force || Math.abs(el.currentTime - pos) > 0.3) el.currentTime = pos;
      el.volume = clamp(audioGain(a, local, len), 0, 1);
    } else if (!el.paused) el.pause();
  }
}
let lastNow = performance.now();
function tick(now){
  const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
  if (playing){
    T += dt;
    if (T >= TOTAL){ T = TOTAL; pause(); }
    syncVideos(false);
  }
  syncOverlays(false);
  syncAudio(false);
  draw(); updateTime(); updatePlayhead();
  requestAnimationFrame(tick);
}
function drawFit(g, v, W, H){
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (v && v.readyState >= 2 && v.videoWidth){
    const k = Math.min(W / v.videoWidth, H / v.videoHeight), dw = v.videoWidth * k, dh = v.videoHeight * k;
    g.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
}
// ana izdeki klibi (motor yerleşimindeki o) efektleriyle çiz
const drawClipAt = (g, o, t, W, H) => drawWithFx(g, o.c.fx, t - o.t0, o.len, W, H, gg => drawFit(gg, media.get(o.c.id), W, H), outFps());
function draw(){
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const t = viewT(), act = activeAt(t);
  if (act.length === 1) drawClipAt(ctx, act[0], t, W, H);
  else if (act.length >= 2){
    const A = act[0], B = act[1], tr = A.trOut;
    const p = tr ? clamp((t - B.t0) / tr.d, 0, 1) : 1;
    drawTransition(ctx, tr ? tr.type : 'fade', g => drawClipAt(g, A, t, W, H), g => drawClipAt(g, B, t, W, H), p, W, H);
  }
  const dk = edgeDark(t);
  if (dk > 0){ ctx.fillStyle = `rgba(0,0,0,${dk})`; ctx.fillRect(0, 0, W, H); }
  drawOverlays(ctx, t, W, H, false);
  for (const x of ENG.effects) if (t >= x.start && t < x.start + x.len) drawEffectLayer(ctx, x, t, W, H);
  drawOverlays(ctx, t, W, H, 'sel');
  if (ENG.cues.length) drawSubsAt(ctx, ENG.cues, t, W, H);   // projede sahne metinleri de dahil
}
function sizeCanvas(){
  const {W, H} = outRes(), k = Math.min(1, 1280 / Math.max(W, H));
  const w = Math.round(W * k), h = Math.round(H * k);
  if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
}
function updateTime(){
  const f = outFps();
  $('time').innerHTML = `<span class="cur">${tc(T, f)}</span> <span class="tot">${tc(TOTAL, f)}</span>`;
}

$('play').onclick = () => playing ? pause() : play();
$('toStart').onclick = () => seek(0);
$('toEnd').onclick = () => seek(TOTAL);
$('back1').onclick = () => seek(T - 1);
$('fwd1').onclick = () => seek(T + 1);
$('outRes').addEventListener('change', () => refresh());
document.addEventListener('pointerdown', e => { libFocus = !!e.target.closest('#tab-media, #tab-audio'); }, true);
function selectAllTimeline(){
  const keys = [...P.clips.map(c => 'c:' + c.id), ...P.overlays.map(o => 'o:' + o.id), ...P.audios.map(a => 'a:' + a.id), ...P.effects.map(x => 'e:' + x.id), ...P.cues.map(c => 's:' + c.id)];
  if (!keys.length) return;
  multi = new Set(keys); setPrimary(keys[0]); refresh();
}
window.addEventListener('keydown', e => {
  if (!$('posterModal').hidden || !$('storyModal').hidden) return;   // poster/hikaye penceresi açıkken kısayollar zaman çizelgesine gitmez
  const typing = e.target.isContentEditable || (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'a'){ e.preventDefault(); libFocus ? selectAllLib() : selectAllTimeline(); return; }
  if (libFocus && (e.key === 'Backspace' || e.key === 'Delete')){ e.preventDefault(); deleteLibSelected(libTabKind()); return; }
  if (e.code === 'Space'){ e.preventDefault(); playing ? pause() : play(); }
  else if (e.code === 'ArrowLeft'){ e.preventDefault(); seek(T - (e.shiftKey ? 1 : 1 / outFps())); }
  else if (e.code === 'ArrowRight'){ e.preventDefault(); seek(T + (e.shiftKey ? 1 : 1 / outFps())); }
  else if (mod && e.key.toLowerCase() === 'b'){ e.preventDefault(); cutAtPlayhead(); }
  else if (mod && e.key.toLowerCase() === 'g'){ e.preventDefault(); e.shiftKey ? ungroupSelected() : groupSelected(); }
  else if (!mod && e.key.toLowerCase() === 'c'){ setTool(tool === 'blade' ? 'select' : 'blade'); }
  else if (!mod && e.key.toLowerCase() === 'v'){ setTool('select'); }
  else if (e.key === 'Escape'){ setTool('select'); if (inspMode === 'clip' || inspMode === 'audio'){ inspMode = 'project'; refresh(); } }
  else if (e.key === 'Backspace' || e.key === 'Delete'){ e.preventDefault(); deleteSelected(); }
  else if (mod && (e.key === '=' || e.key === '+')){ e.preventDefault(); setZoom(+$('zoom').value * 1.25); }
  else if (mod && e.key === '-'){ e.preventDefault(); setZoom(+$('zoom').value / 1.25); }
});

// Altyazıyı oynatıcıda sürükleyerek taşı
let subDrag = false;
function setPosFromEvent(e){
  const r = cv.getBoundingClientRect();
  $('posX').value = clamp((e.clientX - r.left) / r.width * 100, 0, 100);
  $('posY').value = clamp((e.clientY - r.top) / r.height * 100 + subEffective().size * 0.5, 0, 100);
  onSubInput('posX'); onSubInput('posY');
}
// video katmanını oynatıcıda sürükleyerek taşı, köşesinden ölçekle
let ovDrag = null;
function canvasPt(e){ const r = cv.getBoundingClientRect(); return {x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height}; }
cv.addEventListener('pointerdown', e => {
  const t = viewT(), W = cv.width, H = cv.height, p = canvasPt(e);
  const hitOv = o => { const r = ovRect(o, W, H); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; };
  let o = inspMode === 'overlay' && P.overlays.find(x => x.id === selOv && t >= x.start && t < x.start + clipLen(x));
  let corner = false;
  if (o){ const r = ovRect(o, W, H), tol = 14 * W / 640; corner = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].some(([cx, cy]) => Math.hypot(p.x - cx, p.y - cy) < tol); }
  if (!o || (!corner && !hitOv(o))){ o = ovActive(t, P.overlays).reverse().find(hitOv); corner = false; }
  if (!o) return;
  e.stopImmediatePropagation(); pause();
  if (!(inspMode === 'overlay' && selOv === o.id)){ multi = new Set(groupKeys('o:' + o.id)); setPrimary('o:' + o.id); refresh(); }
  const r = ovRect(o, W, H), c0 = {x: r.x + r.w / 2, y: r.y + r.h / 2}, d0 = Math.hypot(p.x - c0.x, p.y - c0.y) || 1;
  ovDrag = {o, corner, p0: p, x0: o.x ?? 0.5, y0: o.y ?? 0.5, s0: o.scale ?? 1, c0, d0};
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!ovDrag) return;
  if (e.buttons === 0){ ovDrag = null; refresh(); return; }
  const p = canvasPt(e), d = ovDrag;
  if (d.corner) d.o.scale = clamp(d.s0 * Math.hypot(p.x - d.c0.x, p.y - d.c0.y) / d.d0, 0.05, 4);
  else { d.o.x = clamp(d.x0 + (p.x - d.p0.x) / cv.width, -0.5, 1.5); d.o.y = clamp(d.y0 + (p.y - d.p0.y) / cv.height, -0.5, 1.5); }
  draw();
});
const endOvDrag = () => { if (ovDrag){ ovDrag = null; refresh(); } };
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => cv.addEventListener(t, endOvDrag));
cv.addEventListener('pointerdown', e => {
  if (!P.cues.length || (VIEW !== 'project' && !isTextCue(P.cues[selCue]))) return;
  subDrag = true; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; setPosFromEvent(e);
  if (inspMode !== 'text'){ inspMode = 'text'; multi = new Set([...multi].filter(k => k[0] === 's')); renderInspector(); }
});
const endSubDrag = () => { subDrag = false; cv.style.cursor = 'grab'; };
cv.addEventListener('pointermove', e => { if (!subDrag) return; if (e.buttons === 0){ endSubDrag(); return; } setPosFromEvent(e); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => cv.addEventListener(t, endSubDrag));

/* ================= Araç çubuğu eylemleri ================= */
/* ---- Seçim ve gruplar ---- */
function itemByKey(k){
  const id = k.slice(2);
  return k[0] === 'c' ? P.clips.find(c => c.id === id) : k[0] === 'o' ? P.overlays.find(o => o.id === id)
    : k[0] === 's' ? P.cues.find(c => c.id === id) : k[0] === 'e' ? P.effects.find(x => x.id === id) : P.audios.find(a => a.id === id);
}
const keyOfEl = b => b.dataset.clip ? 'c:' + b.dataset.clip : b.dataset.ov ? 'o:' + b.dataset.ov : b.dataset.cid ? 's:' + b.dataset.cid : b.dataset.efx ? 'e:' + b.dataset.efx : 'a:' + b.dataset.aud;
const BLK_SEL = '[data-clip],[data-aud],[data-ov],[data-cid],[data-efx]';
const isMediaKey = k => k[0] === 'c' || k[0] === 'a' || k[0] === 'o';   // video/ses öğesi (altyazı ve efekt değil)
function setPrimary(k){
  const id = k.slice(2);
  if (k[0] === 'c'){ sel = id; inspMode = 'clip'; } else if (k[0] === 'o'){ selOv = id; inspMode = 'overlay'; }
  else if (k[0] === 's'){ selCue = P.cues.findIndex(c => c.id === id); inspMode = 'text'; }
  else if (k[0] === 'e'){ selEfx = id; inspMode = 'effect'; } else { selAud = id; inspMode = 'audio'; }
}
const isItemMode = () => inspMode === 'clip' || inspMode === 'audio' || inspMode === 'overlay' || inspMode === 'text' || inspMode === 'effect';
function groupKeys(k){
  const it = itemByKey(k); if (!it) return [];
  if (!it.gid) return [k];
  return [...P.clips.filter(c => c.gid === it.gid).map(c => 'c:' + c.id), ...P.audios.filter(a => a.gid === it.gid).map(a => 'a:' + a.id),
          ...P.overlays.filter(o => o.gid === it.gid).map(o => 'o:' + o.id)];
}
function selectItem(kind, id, additive){
  const k = kind + ':' + id;
  if (additive){
    if (multi.has(k)){ groupKeys(k).forEach(x => multi.delete(x)); }
    else groupKeys(k).forEach(x => multi.add(x));
  } else multi = new Set(groupKeys(k));
  setPrimary(k);
  if (!multi.has(k)){
    const rest = [...multi];
    if (!rest.length){ inspMode = 'project'; return; }
    setPrimary(rest[rest.length - 1]);
  }
}
// seçimi denetçi kipiyle tutarlı tut
function normalizeSelection(){
  multi = new Set([...multi].filter(k => itemByKey(k)));
  if (inspMode === 'clip' && sel && !multi.has('c:' + sel)) multi = new Set(groupKeys('c:' + sel));
  else if (inspMode === 'audio' && selAud && !multi.has('a:' + selAud)) multi = new Set(groupKeys('a:' + selAud));
  else if (inspMode === 'overlay' && selOv && !multi.has('o:' + selOv)) multi = new Set(groupKeys('o:' + selOv));
  else if (inspMode === 'text'){
    const c = P.cues[selCue];
    if (c && !multi.has('s:' + c.id)) multi = new Set(['s:' + c.id]);
    else if (!c) multi = new Set([...multi].filter(k => k[0] === 's'));
  }
  else if (inspMode === 'effect' && selEfx && !multi.has('e:' + selEfx)) multi = new Set(['e:' + selEfx]);
  else if (!isItemMode()) multi.clear();
}
function groupSelected(){
  const keys = [...multi].filter(isMediaKey);
  if (keys.length < 2){ toast('Gruplamak için en az iki video veya ses seç (⇧ veya ⌘ ile tıkla)'); return; }
  const gid = uid();
  keys.forEach(k => { const it = itemByKey(k); if (it) it.gid = gid; });
  refresh(); toast(`${keys.length} öğe gruplandı. Birini kestiğinde diğerleri de aynı yerden kesilir.`);
}
function ungroupSelected(){
  let n = 0;
  multi.forEach(k => { const it = itemByKey(k); if (it && it.gid){ delete it.gid; n++; } });
  if (!n){ toast('Seçili öğeler bir grupta değil'); return; }
  refresh(); toast('Grup çözüldü');
}
// ses katmanı için çakışmayan en üstteki iz
function freeTrack(a, ignore){
  const s0 = a.start, e0 = a.start + audioLen(a);
  for (let t = 0; ; t++){
    const busy = P.audios.some(x => x !== a && x !== ignore && (x.track ?? 0) === t && x.start < e0 - 0.01 && x.start + audioLen(x) > s0 + 0.01);
    if (!busy) return t;
  }
}
function splitEnv(env, f){
  const v = envAt(env, f);
  return [[...env.filter(p => p.t < f).map(p => ({t: p.t / f, v: p.v})), {t: 1, v}],
          [{t: 0, v}, ...env.filter(p => p.t > f).map(p => ({t: (p.t - f) / (1 - f), v: p.v}))]];
}
// kesilen öğede giriş animasyonu soldaki, çıkış animasyonu sağdaki parçada kalır
function splitFxAnims(left, right){
  if (!left.fx) return;
  setFx(right, {animIn: null}); setFx(left, {animOut: null});
}
function cutClip(c, local, gid){
  const len = clipLen(c); if (local < 0.05 || local > len - 0.05) return null;
  const [envA, envB] = splitEnv(c.env || DEF_ENV(), local / len);
  const c2 = {...c, id: uid(), in: c.in + local * spd(c), env: envB, tr: c.tr, fadeIn: 0};
  if (gid) c2.gid = gid; else delete c2.gid;
  splitFxAnims(c, c2);
  c.out = c.in + local * spd(c); c.tr = null; c.env = envA; c.fadeOut = 0;
  P.clips.splice(P.clips.indexOf(c) + 1, 0, c2); makeMedia(c2, 'video');
  return c2;
}
function cutOverlay(o, local, gid){
  const len = clipLen(o); if (local < 0.05 || local > len - 0.05) return null;
  const [envA, envB] = splitEnv(o.env || DEF_ENV(), local / len);
  const o2 = {...o, id: uid(), start: o.start + local, in: o.in + local * spd(o), env: envB, fadeIn: 0};
  if (gid) o2.gid = gid; else delete o2.gid;
  splitFxAnims(o, o2);
  o.out = o.in + local * spd(o); o.env = envA; o.fadeOut = 0;
  P.overlays.splice(P.overlays.indexOf(o) + 1, 0, o2); makeMedia(o2, 'video');
  return o2;
}
function cutAudio(a, local, gid){
  const len = audioLen(a); if (local < 0.05 || local > len - 0.05) return null;
  const avail = Math.max(0.01, a.dur - a.trimIn);
  const [envA, envB] = splitEnv(a.env || DEF_ENV(), local / len);
  const sl = local * spd(a);
  const a2 = {...a, id: uid(), start: a.start + local, trimIn: sl < avail ? a.trimIn + sl : (sl - avail) % a.dur,
              len: len - local, fadeIn: 0, env: envB};
  if (gid) a2.gid = gid; else delete a2.gid;
  a.len = local; a.fadeOut = 0; a.env = envA;
  P.audios.splice(P.audios.indexOf(a) + 1, 0, a2); makeMedia(a2, 'audio');
  return a2;
}
// verilen öğeleri (gruplarıyla) zaman çizelgesindeki t anından kes
function cutItems(keys, t){
  pause();
  const all = new Set(); keys.forEach(k => groupKeys(k).forEach(x => all.add(x)));
  const newGid = {}, right = [];
  // konumları kesmeden önce hesapla (kesme yerleşimi değiştirmez)
  const jobs = [...all].map(k => {
    const it = itemByKey(k); if (!it || !isMediaKey(k) || it.scene) return null;
    if (k[0] === 'c'){ const o = L.find(x => x.c === it); return o && {k, it, local: t - o.t0}; }
    if (k[0] === 'o') return {k, it, local: t - it.start};
    return {k, it, local: t - it.start};
  }).filter(Boolean);
  for (const j of jobs){
    const g = j.it.gid ? (newGid[j.it.gid] = newGid[j.it.gid] || uid()) : null;
    const r = j.k[0] === 'c' ? cutClip(j.it, j.local, g) : j.k[0] === 'o' ? cutOverlay(j.it, j.local, g) : cutAudio(j.it, j.local, g);
    if (r) right.push(j.k[0] + ':' + r.id);
  }
  if (!right.length){ toast('Bu noktada kesilecek bir şey yok'); return; }
  // tek üyeli kalan grupları kaldır
  for (const g of new Set([...P.clips, ...P.audios, ...P.overlays].map(x => x.gid).filter(Boolean))){
    const mem = [...P.clips, ...P.audios, ...P.overlays].filter(x => x.gid === g);
    if (mem.length < 2) mem.forEach(x => delete x.gid);
  }
  multi = new Set(right);
  setPrimary(right[0]);
  refresh(); seek(T);
}
function cutAtPlayhead(){
  let keys = [...multi].filter(isMediaKey);
  if (!keys.length){
    if (VIEW === 'project'){ toast('Sahneler projede kesilmez. Kesmek için sahneye gir (çift tıkla).'); return; }
    const act = activeAt(T); if (!act.length) return; keys = ['c:' + act[act.length - 1].c.id];
  }
  if (keys.every(k => (itemByKey(k) || {}).scene)){ toast('Sahneler projede kesilmez. Kesmek için sahneye gir (çift tıkla).'); return; }
  cutItems(keys, T);
}
function setTool(t){
  tool = t;
  $('toolSel').classList.toggle('on', t === 'select'); $('toolBlade').classList.toggle('on', t === 'blade');
  $('tlScroll').classList.toggle('blade', t === 'blade');
  const bl = $('bladeLine'); if (bl && t !== 'blade') bl.style.display = 'none';
}
$('toolSel').onclick = () => setTool('select');
$('toolBlade').onclick = () => setTool(tool === 'blade' ? 'select' : 'blade');
$('groupBtn').onclick = groupSelected;
function renderOpts(){
  $('optMagnet').classList.toggle('on', OPT.magnet);
  $('optSnap').classList.toggle('on', OPT.snap);
  $('optLink').classList.toggle('on', OPT.link);
  $('optAxis').classList.toggle('on', OPT.axis);
  $('optLinkOver').checked = OPT.linkOver; $('optLinkAudio').checked = OPT.linkAudio; $('optLinkSubs').checked = OPT.linkSubs; $('optAxisAudio').checked = OPT.axisAudio;
}
$('optMagnet').onclick = () => {
  OPT.magnet = !OPT.magnet; saveOpt(); renderOpts();
  if (OPT.magnet && P.clips.some(c => (c.gap || 0) > 0.001)){ P.clips.forEach(c => c.gap = 0); refresh(); seek(T); toast('Ana iz mıknatısı açık: klipler arasındaki boşluklar kapatıldı'); }
  else toast(OPT.magnet ? 'Ana iz mıknatısı açık: klipler arasında boşluk kalmaz' : 'Ana iz mıknatısı kapalı: klipleri serbestçe kaydırabilirsin');
};
$('optSnap').onclick = () => { OPT.snap = !OPT.snap; saveOpt(); renderOpts(); toast(OPT.snap ? 'Otomatik yakalama açık' : 'Otomatik yakalama kapalı'); };
$('optLink').onclick = () => { OPT.link = !OPT.link; saveOpt(); renderOpts(); toast(OPT.link ? 'Bağlantı açık: sesler ve altyazılar video klipleriyle birlikte kayar' : 'Bağlantı kapalı'); };
$('optAxis').onclick = () => { OPT.axis = !OPT.axis; saveOpt(); renderOpts(); endHover(); toast(OPT.axis ? 'Önizleme ekseni açık: fareyi gezdirerek önizle' : 'Önizleme ekseni kapalı'); };
$('optLinkAudio').onchange = e => { OPT.linkAudio = e.target.checked; saveOpt(); };
$('optLinkSubs').onchange = e => { OPT.linkSubs = e.target.checked; saveOpt(); };
$('optLinkOver').onchange = e => { OPT.linkOver = e.target.checked; saveOpt(); };
$('optAxisAudio').onchange = e => { OPT.axisAudio = e.target.checked; saveOpt(); };
document.querySelectorAll('[data-pop]').forEach(b => b.onclick = e => {
  e.stopPropagation();
  const pop = $(b.dataset.pop), open = pop.hidden;
  document.querySelectorAll('.pop').forEach(p => p.hidden = true);
  if (open){ const r = b.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(window.innerWidth - 250, r.left - 180)) + 'px'; pop.hidden = false; }
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('.pop,[data-pop]')) document.querySelectorAll('.pop').forEach(p => p.hidden = true); });
renderOpts();
$('ungroupBtn').onclick = ungroupSelected;
function removeClip(id){
  const i = P.clips.findIndex(c => c.id === id); if (i < 0) return null;
  const o = L.find(x => x.c.id === id), [c] = P.clips.splice(i, 1);
  if (!OPT.magnet && P.clips[i] && o) P.clips[i].gap = (P.clips[i].gap || 0) + (c.gap || 0) + o.len;   // boşluk bırak
  return c;
}
function deleteSelected(){
  pause();
  if (multi.size && isItemMode()){
    multi.forEach(k => {
      const id = k.slice(2);
      if (k[0] === 's'){ P.cues = P.cues.filter(c => c.id !== id); return; }
      if (k[0] === 'e'){ P.effects = P.effects.filter(x => x.id !== id); return; }
      if (k[0] === 'c') removeClip(id); else if (k[0] === 'o') P.overlays = P.overlays.filter(o => o.id !== id); else P.audios = P.audios.filter(a => a.id !== id);
      dropMedia(id);
    });
    multi.clear(); sel = null; selAud = null; selOv = null; selCue = -1; selEfx = null; inspMode = 'project';
  } else if (inspMode === 'clip' && sel){
    const i = P.clips.findIndex(c => c.id === sel); if (i < 0) return;
    const c = removeClip(sel); dropMedia(c.id);
    sel = (P.clips[i] || P.clips[i - 1] || {}).id || null; if (!sel) inspMode = 'project';
  } else if (inspMode === 'audio' && selAud){
    P.audios = P.audios.filter(a => a.id !== selAud); dropMedia(selAud); selAud = null; inspMode = 'project';
  } else if (inspMode === 'text' && selCue >= 0 && P.cues[selCue]){
    P.cues.splice(selCue, 1); selCue = -1;
  } else if (inspMode === 'trans' && P.clips[selTr]){
    P.clips[selTr].tr = null; inspMode = 'project';
  } else return;
  refresh(); seek(T);
}
// Sesi ayır: videonun sesi aynı yerde, aynı kırpma/hız/seviye ile ayrı bir ses katmanına taşınır,
// videonun kendi sesi kapatılır; ses kitaplığın Ses sekmesine de eklenir (başka sahnelerde kullanmak için)
function detachAudio(it){
  if (!it || it.scene) return;
  if (it.hasAudio === false){ toast('Bu videoda ses yok'); return; }
  pause();
  const isOv = P.overlays.includes(it), start = isOv ? it.start : (L.find(o => o.c === it) || {t0: 0}).t0;
  const a = {id: uid(), path: it.path, name: `${stem(it.name)} (ses)`, dur: it.dur, len: clipLen(it), start,
             vol: it.vol ?? 1, muted: false, env: JSON.parse(JSON.stringify(it.env || DEF_ENV())), trimIn: it.in,
             fadeIn: it.fadeIn || 0, fadeOut: it.fadeOut || 0, loop: false, hasAudio: true};
  if (spd(it) !== 1) a.speed = spd(it);
  const vis = visCache.get(visKey(it)); if (vis && vis.wave) a.wave = vis.wave;
  a.track = freeTrack(a); P.audios.push(a); makeMedia(a, 'audio');
  it.muted = true;
  if (!LIB.some(x => x.kind === 'audio' && x.path === it.path))
    LIB.push({id: uid(), path: it.path, name: a.name, kind: 'audio', dur: it.dur, hasAudio: true, ...(vis && vis.wave ? {wave: vis.wave} : {})});
  multi = new Set(['a:' + a.id]); setPrimary('a:' + a.id);
  refresh(); syncVideos(true); syncAudio(true);
  toast('Ses ayrıldı: ses izine eklendi ve videonun kendi sesi kapatıldı. Kitaplığın Ses sekmesinden başka sahnelerde de kullanabilirsin.');
}
function toggleMuteSelected(){
  const items = [...multi].filter(isMediaKey).map(itemByKey).filter(Boolean);
  if (!items.length) return;
  const m = !items.every(it => it.muted);
  items.forEach(it => it.muted = m); refresh(); syncAudio(true);
}
$('cutBtn').onclick = cutAtPlayhead;
$('delBtn').onclick = deleteSelected;
$('muteBtn').onclick = toggleMuteSelected;
$('undoBtn').onclick = () => undo();
$('redoBtn').onclick = () => redo();

/* ================= Geri al / yinele ================= */
const undoStack = [], redoStack = [];
let lastSnap = null, restoring = false;
function snapshot(){
  const strip = ({thumb, thumbN, wave, missing, ...r}) => r;
  // her görünümün kendi geçmişi var; altyazılar projeye ait olduğu için yalnızca proje geçmişinde
  return JSON.stringify({clips: P.clips.map(strip), audios: P.audios.map(strip), overlays: P.overlays.map(strip), effects: P.effects, cues: P.cues,
    fadeStart: P.fadeStart, fadeEnd: P.fadeEnd, edgeD: P.edgeD});
}
let dirty = false;   // son kaydetmeden beri değişiklik var mı
function trackHistory(){
  if (restoring) return;
  const s = snapshot();
  if (lastSnap !== null && s !== lastSnap){ undoStack.push(lastSnap); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; dirty = true; }
  lastSnap = s;
}
function restore(s){
  restoring = true; pause();
  const d = JSON.parse(s);
  d.overlays = d.overlays || [];
  if (VIEW === 'project') d.clips = d.clips.filter(c => sceneById(c.scene));   // silinmiş sahnelerin blokları geri gelmesin
  const want = new Set([...d.clips.map(c => c.id), ...d.audios.map(a => a.id), ...d.overlays.map(o => o.id)]);
  if (VIEW === 'project') SCENES.forEach(sc => [...sc.clips, ...sc.audios, ...sc.overlays].forEach(x => want.add(x.id)));
  for (const id of [...media.keys()]) if (!want.has(id)) dropMedia(id);
  P.clips = d.clips; P.audios = d.audios; P.overlays = d.overlays; P.effects = d.effects || []; P.cues = d.cues || [];
  P.fadeStart = d.fadeStart; P.fadeEnd = d.fadeEnd; P.edgeD = d.edgeD;
  const fresh = (it, tag) => { const el = media.get(it.id); if (el && el.dataset.path === it.path) return; dropMedia(it.id); makeMedia(it, tag); };
  P.clips.forEach(c => { if (!c.scene) fresh(c, 'video'); });
  P.audios.forEach(a => fresh(a, 'audio'));
  P.overlays.forEach(o => fresh(o, 'video'));
  for (const it of [...P.clips, ...P.audios, ...P.overlays]) Object.assign(it, visCache.get(visKey(it)) || {});
  if (!P.overlays.find(o => o.id === selOv)){ selOv = null; if (inspMode === 'overlay') inspMode = 'project'; }
  if (!P.effects.find(x => x.id === selEfx)){ selEfx = null; if (inspMode === 'effect') inspMode = 'project'; }
  $('fadeStart').checked = P.fadeStart; $('fadeEnd').checked = P.fadeEnd; $('edgeD').value = P.edgeD;
  if (!P.clips.find(c => c.id === sel)) sel = null;
  if (!P.audios.find(a => a.id === selAud)) selAud = null;
  if (selCue >= P.cues.length) selCue = -1;
  if ((inspMode === 'clip' && !sel) || (inspMode === 'audio' && !selAud)) inspMode = 'project';
  lastSnap = s; linkFreeze = true;
  refresh(); seek(T);
  restoring = false;
}
function undo(){ if (!undoStack.length) return; redoStack.push(lastSnap); restore(undoStack.pop()); }
function redo(){ if (!redoStack.length) return; undoStack.push(lastSnap); restore(redoStack.pop()); }

/* ================= Denetçi ================= */
function rangeRow(id, label, min, max, step, val, show){
  return `<label>${label}<span class="pair"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="v" id="${id}V" contenteditable="plaintext-only" spellcheck="false" data-scale="${show === pct ? 100 : 1}" title="Tıkla ve değer yaz">${show(val)}</span></span></label>`;
}
// Kaydırıcı değeri: tıklayıp yazınca kaydırıcıya uygulanır (Enter onaylar, Esc vazgeçer)
const isRangeVal = el => el && el.matches && el.matches('span.v[contenteditable]');
function commitRangeText(sp){
  const el = sp.parentElement.querySelector('input[type=range]'); if (!el) return;
  const n = parseFloat(sp.textContent.replace(',', '.').replace(/[^\d.\-]/g, ''));
  if (!isNaN(n)) el.value = n / (+sp.dataset.scale || 1);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  if (!isNaN(n)) el.dispatchEvent(new Event('change', {bubbles: true}));
}
document.addEventListener('focusin', e => {
  if (!isRangeVal(e.target)) return;
  e.target.dataset.orig = e.target.textContent;
  requestAnimationFrame(() => { const r = document.createRange(); r.selectNodeContents(e.target); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
});
// etiket tıklaması odağı kaydırıcıya taşımasın
document.addEventListener('click', e => { if (isRangeVal(e.target)) e.preventDefault(); }, true);
document.addEventListener('focusout', e => { if (isRangeVal(e.target) && e.target.textContent !== e.target.dataset.orig) commitRangeText(e.target); });
document.addEventListener('keydown', e => {
  if (!isRangeVal(e.target)) return;
  if (e.key === 'Enter'){ e.preventDefault(); e.target.blur(); }
  else if (e.key === 'Escape'){ e.target.textContent = e.target.dataset.orig; e.target.blur(); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
    // ↑/↓ bir adım, ⇧ ile on adım; geçmiş ve yenileme odaktan çıkınca (focusout) yapılır
    e.preventDefault(); e.stopPropagation();
    const el = e.target.parentElement.querySelector('input[type=range]'); if (!el) return;
    for (let i = e.shiftKey ? 10 : 1; i > 0; i--) e.key === 'ArrowUp' ? el.stepUp() : el.stepDown();
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }
}, true);
// sayfadaki sabit kaydırıcıların değerleri de yazılabilir olsun
document.querySelectorAll('label span.v').forEach(sp => {
  if (!sp.parentElement.querySelector('input[type=range]')) return;
  Object.assign(sp, {contentEditable: 'plaintext-only', spellcheck: false, title: 'Tıkla ve değer yaz'});
});
function bindRangeLive(id, show, onInput){
  const el = $(id); if (!el) return;
  el.addEventListener('input', () => { $(id + 'V').textContent = show(+el.value); onInput(+el.value); renderTimeline(); syncVideos(false); syncAudio(false); });
  el.addEventListener('change', () => refresh());
}
const pct = v => Math.round(v * 100) + '%', secs = v => (+v).toFixed(1) + ' sn';
// Hız: %10–%400; %100 altı yavaşlatır, üstü hızlandırır
function speedHtml(it, len){
  return `${rangeRow('spV', 'Hız', 10, 400, 1, Math.round(spd(it) * 100), v => v + '%')}
    <div class="row" style="margin-top:6px">${[50, 100, 150, 200].map(p => `<button class="sec sm" data-sp="${p}">${p}%</button>`).join('')}</div>
    <div class="kv" style="margin-top:10px"><span>Süre</span><span id="spLen">${fmt(len)}</span></div>
    <p class="note">Ses de aynı hızda çalar, tonu korunur.</p>`;
}
function bindSpeed(it, isAudio){
  const set = v => {
    const sp = clamp(v / 100, 0.1, 4);
    if (isAudio){ const src = audioLen(it) * spd(it); it.speed = sp; it.len = src / sp; it.len = audioLen(it); }
    else it.speed = sp;
    relayout();
    $('spLen').textContent = fmt(isAudio ? audioLen(it) : clipLen(it));
  };
  bindRangeLive('spV', v => v + '%', set);
  document.querySelectorAll('#inspDyn [data-sp]').forEach(b => b.onclick = () => { pause(); set(+b.dataset.sp); refresh(); seek(T); });
}
function renderInspector(){
  const head = $('inspHead'), dyn = $('inspDyn');
  $('inspText').style.display = inspMode === 'text' ? '' : 'none';
  const c = P.clips.find(x => x.id === sel), a = P.audios.find(x => x.id === selAud);
  if (inspMode === 'clip' && !c) inspMode = 'project';
  if (inspMode === 'audio' && !a) inspMode = 'project';
  const ov = P.overlays.find(x => x.id === selOv);
  if (inspMode === 'overlay' && !ov) inspMode = 'project';
  if (inspMode === 'trans' && P.clips.length < 2) inspMode = 'project';

  if (inspMode === 'clip' && c.scene && multi.size <= 1){
    const sc = sceneById(c.scene), info = sceneInfo(c.scene);
    head.textContent = 'Sahne';
    dyn.innerHTML = `
      <label>Ad<input type="text" id="scName" value="${esc(sc.name)}"></label>
      <div class="kv"><span>Süre</span><span>${fmt(info.dur)}</span><span>Video klip</span><span>${sc.clips.length}</span>
        <span>Ses</span><span>${sc.audios.length}</span><span>Video katmanı</span><span>${sc.overlays.length}</span></div>
      <label>Sesi kapat<input type="checkbox" id="scMute" ${c.muted ? 'checked' : ''}></label>
      <button class="primary" id="scEdit" style="margin-top:8px">Sahneyi düzenle</button>
      <div class="row" style="margin-top:6px"><button class="sec sm" id="scDup">Çoğalt</button><button class="sec sm" id="scOut">Projeden çıkar</button><button class="sec sm" id="scDel">Sil</button></div>
      <p class="note">Sahneler projede kırpılmaz ve kesilmez; içeriğini değiştirmek için sahneye gir. Sırasını değiştirmek için bloğu sürükle.</p>`;
    $('scName').onchange = e => renameScene(sc.id, e.target.value);
    $('scMute').onchange = e => { c.muted = e.target.checked; refresh(); };
    $('scEdit').onclick = () => openView(sc.id);
    $('scDup').onclick = () => duplicateScene(sc.id);
    $('scOut').onclick = deleteSelected;
    $('scDel').onclick = () => deleteScene(sc.id);
    return;
  }
  if (isItemMode() && multi.size > 1){
    $('inspText').style.display = [...multi].every(k => k[0] === 's') ? '' : 'none'; $('cueEdit').innerHTML = ''; showSubAll(!isTextCue(P.cues[selCue])); syncSubControls();
    const items = [...multi].filter(isMediaKey).map(itemByKey).filter(Boolean);
    const gids = new Set(items.map(it => it.gid || '-'));
    const grouped = gids.size === 1 && !gids.has('-');
    head.textContent = `${multi.size} öğe seçili`;
    dyn.innerHTML = `
      <div class="kv"><span>${VIEW === 'project' ? 'Sahne' : 'Video klip'}</span><span>${[...multi].filter(k => k[0] === 'c').length}</span><span>Video katmanı</span><span>${[...multi].filter(k => k[0] === 'o').length}</span><span>Ses</span><span>${[...multi].filter(k => k[0] === 'a').length}</span>
        <span>Altyazı</span><span>${[...multi].filter(k => k[0] === 's').length}</span>
        <span>Durum</span><span>${grouped ? 'Gruplu' : 'Grupsuz'}</span></div>
      <p class="note">${grouped ? 'Bu öğelerden birini kestiğinde diğerleri de aynı yerden kesilir.' : 'Gruplayınca birini kestiğinde diğerleri de aynı yerden kesilir.'}</p>
      <div class="row"><button class="primary sm" id="mGroup" ${grouped || items.length < 2 ? 'disabled' : ''}>Grupla ⌘G</button><button class="sec sm" id="mUngroup" ${items.some(it => it.gid) ? '' : 'disabled'}>Grubu çöz ⇧⌘G</button></div>
      <div class="row" style="margin-top:6px"><button class="sec sm" id="mCut">Oynatma kafasından kes</button><button class="sec sm" id="mDel">Sil</button></div>`;
    $('mGroup').onclick = groupSelected; $('mUngroup').onclick = ungroupSelected;
    $('mCut').onclick = cutAtPlayhead; $('mDel').onclick = deleteSelected;
    return;
  }
  const ex = P.effects.find(x => x.id === selEfx);
  if (inspMode === 'effect' && !ex) inspMode = 'project';
  if (inspMode === 'effect' && multi.size <= 1){
    head.textContent = 'Efekt';
    dyn.innerHTML = `
      <div class="kv"><span>Çizelgede</span><span>${fmt(ex.start)} – ${fmt(ex.start + ex.len)}</span></div>
      <label>Efekt<select id="elType">${FX_EFFECTS.map(f => `<option value="${f.id}" ${f.id === ex.eff.id ? 'selected' : ''}>${f.name}</option>`).join('')}</select></label>
      ${rangeRow('elK', 'Yoğunluk', 0, 100, 1, Math.round(ex.eff.k * 100), v => v + '%')}
      <label>Başlangıç<span class="inrow"><input type="number" step="0.1" min="0" id="elStart" value="${ex.start.toFixed(2)}"><button class="sec" id="elNow" title="Oynatma kafasından başlat">${ICON.target}</button></span></label>
      <label>Süre (sn)<input type="number" step="0.1" min="0.2" id="elLen" value="${ex.len.toFixed(2)}"></label>
      <p class="note">Efekt, altındaki tüm görüntüye (videolar ve katmanlar) uygulanır. Zaman çizelgesinde sürükleyerek taşıyabilir, kenarlarından başlangıcını ve bitişini ayarlayabilirsin.</p>
      <button class="sec" id="elDel" style="margin-top:10px">Efekti sil</button>`;
    $('elType').onchange = e => { ex.eff = {id: e.target.value, k: ex.eff.k}; refresh(); };
    bindRangeLive('elK', v => v + '%', v => { ex.eff = {...ex.eff, k: v / 100}; draw(); });
    $('elStart').onchange = e => { ex.start = Math.max(0, +e.target.value || 0); refresh(); seek(T); };
    $('elNow').onclick = () => { ex.start = T; refresh(); seek(T); };
    $('elLen').onchange = e => { ex.len = Math.max(0.2, +e.target.value || 0.2); refresh(); seek(T); };
    $('elDel').onclick = deleteSelected;
    return;
  }
  if (inspMode === 'overlay'){
    head.innerHTML = `<div class="itabs"><button data-it="video" class="${inspTab === 'video' ? 'on' : ''}">Katman</button><button data-it="audio" class="${inspTab === 'audio' ? 'on' : ''}">Ses</button><button data-it="speed" class="${inspTab === 'speed' ? 'on' : ''}">Hız</button><button data-it="fx" class="${inspTab === 'fx' ? 'on' : ''}">Efekt</button><button data-it="anim" class="${inspTab === 'anim' ? 'on' : ''}">Animasyon</button></div>`;
    head.querySelectorAll('[data-it]').forEach(b => b.onclick = () => { inspTab = b.dataset.it; renderInspector(); });
    const len = clipLen(ov);
    if (inspTab === 'video'){
      dyn.innerHTML = `
        <div class="kv"><span>Dosya</span><span title="${esc(ov.path)}">${esc(ov.name)}</span><span>Katman</span><span>${(ov.track ?? 0) + 1}</span>
          <span>Çizelgede</span><span>${fmt(ov.start)} – ${fmt(ov.start + len)}</span></div>
        <h3>Görüntü</h3>
        ${rangeRow('opX', 'Yatay konum', -50, 150, 1, Math.round((ov.x ?? 0.5) * 100), v => v + '%')}
        ${rangeRow('opY', 'Dikey konum', -50, 150, 1, Math.round((ov.y ?? 0.5) * 100), v => v + '%')}
        ${rangeRow('opS', 'Ölçek', 5, 200, 1, Math.round((ov.scale ?? 1) * 100), v => v + '%')}
        ${rangeRow('opA', 'Opaklık', 0, 100, 1, Math.round((ov.opacity ?? 1) * 100), v => v + '%')}
        <div class="row" style="margin-top:6px"><button class="sec sm" id="opFull">Tam ekran</button><button class="sec sm" id="opPip">Köşe (PiP)</button></div>
        <p class="note">Oynatıcıda katmanı sürükleyerek taşıyabilir, köşesinden sürükleyerek büyütüp küçültebilirsin.</p>
        <h3>Zaman</h3>
        <label>Başlangıç<span class="inrow"><input type="number" step="0.1" min="0" id="opStart" value="${ov.start.toFixed(2)}"><button class="sec" id="opNow" title="Oynatma kafasından başlat">${ICON.target}</button></span></label>
        <label>Kaynaktan başla (sn)<input type="number" step="0.1" min="0" id="opIn" value="${ov.in.toFixed(2)}"></label>
        <label>Kaynakta bitir (sn)<input type="number" step="0.1" min="0" id="opOut" value="${ov.out.toFixed(2)}"></label>
        <div class="row" style="margin-top:10px">${VIEW === 'project' ? '' : '<button class="sec sm" id="opMain">Ana ize taşı</button>'}<button class="sec sm" id="opDel">Sil</button></div>`;
      const live = (id, f) => bindRangeLive(id, v => v + '%', v => { f(v); draw(); });
      live('opX', v => ov.x = v / 100); live('opY', v => ov.y = v / 100); live('opS', v => ov.scale = v / 100); live('opA', v => ov.opacity = v / 100);
      $('opFull').onclick = () => { Object.assign(ov, {x: 0.5, y: 0.5, scale: 1}); refresh(); };
      $('opPip').onclick = () => { Object.assign(ov, {x: 0.78, y: 0.24, scale: 0.35}); refresh(); };
      $('opStart').onchange = e => { ov.start = Math.max(0, +e.target.value || 0); refresh(); seek(T); };
      $('opNow').onclick = () => { ov.start = T; refresh(); seek(T); };
      $('opIn').onchange = e => { ov.in = clamp(+e.target.value || 0, 0, ov.out - 0.1); refresh(); seek(T); };
      $('opOut').onchange = e => { ov.out = clamp(+e.target.value || 0, ov.in + 0.1, ov.dur); refresh(); seek(T); };
      if ($('opMain')) $('opMain').onclick = () => { pause(); const i = L.findIndex(o2 => ov.start < o2.t0 + o2.len / 2); overlayToClip(ov, i < 0 ? P.clips.length : i); refresh(); seek(T); };
      $('opDel').onclick = deleteSelected;
    } else if (inspTab === 'speed'){
      dyn.innerHTML = speedHtml(ov, len); bindSpeed(ov, false);
    } else if (inspTab === 'fx'){ renderFxInsp(ov, false);
    } else if (inspTab === 'anim'){ renderAnimInsp(ov, false, len);
    } else {
      if (!ov.hasAudio){ dyn.innerHTML = '<p class="emptyi">Bu katmanda ses yok.</p>'; return; }
      const maxF = Math.min(10, len).toFixed(1);
      dyn.innerHTML = `
        <label>Sesi kapat<input type="checkbox" id="opMute" ${ov.muted ? 'checked' : ''}></label>
        ${rangeRow('opVol', 'Ses seviyesi', 0, 2, 0.01, ov.vol, pct)}
        ${rangeRow('opFi', 'Yavaşça aç', 0, maxF, 0.1, ov.fadeIn || 0, secs)}
        ${rangeRow('opFo', 'Yavaşça kapat', 0, maxF, 0.1, ov.fadeOut || 0, secs)}
        <button class="sec" id="opDetach" style="margin-top:8px" title="Videonun sesini ayrı bir ses katmanı yap">Sesi ayır</button>`;
      $('opDetach').onclick = () => detachAudio(ov);
      $('opMute').onchange = e => { ov.muted = e.target.checked; refresh(); };
      bindRangeLive('opVol', pct, v => ov.vol = v);
      bindRangeLive('opFi', secs, v => ov.fadeIn = Math.min(v, len - (ov.fadeOut || 0)));
      bindRangeLive('opFo', secs, v => ov.fadeOut = Math.min(v, len - (ov.fadeIn || 0)));
    }
    return;
  }
  if (inspMode === 'clip'){
    head.innerHTML = `<div class="itabs"><button data-it="video" class="${inspTab === 'video' ? 'on' : ''}">Video</button><button data-it="audio" class="${inspTab === 'audio' ? 'on' : ''}">Ses</button><button data-it="speed" class="${inspTab === 'speed' ? 'on' : ''}">Hız</button><button data-it="fx" class="${inspTab === 'fx' ? 'on' : ''}">Efekt</button><button data-it="anim" class="${inspTab === 'anim' ? 'on' : ''}">Animasyon</button></div>`;
    head.querySelectorAll('[data-it]').forEach(b => b.onclick = () => { inspTab = b.dataset.it; renderInspector(); });
    const i = P.clips.indexOf(c), len = clipLen(c);
    if (inspTab === 'video'){
      dyn.innerHTML = `
        <div class="kv"><span>Dosya</span><span title="${esc(c.path)}">${esc(c.name)}</span><span>Çözünürlük</span><span>${c.w}×${c.h}</span>
          <span>Kaynak süresi</span><span>${fmt(c.dur)}</span><span>Kullanılan</span><span>${fmt(len)}</span></div>
        <h3>Kırpma</h3>
        <label>Başlangıç<span class="inrow"><input type="number" step="0.1" min="0" id="cpIn" value="${c.in.toFixed(2)}"><button class="sec" id="cpInNow" title="Oynatma kafasının konumunu kullan">${ICON.target}</button></span></label>
        <label>Bitiş<span class="inrow"><input type="number" step="0.1" min="0" id="cpOut" value="${c.out.toFixed(2)}"><button class="sec" id="cpOutNow" title="Oynatma kafasının konumunu kullan">${ICON.target}</button></span></label>
        <h3>Sıra</h3>
        <div class="row"><button class="sec sm" id="cpLeft" ${i === 0 ? 'disabled' : ''}>Sola taşı</button><button class="sec sm" id="cpRight" ${i === P.clips.length - 1 ? 'disabled' : ''}>Sağa taşı</button></div>
        <h3>Araçlar</h3>
        <div class="row"><button class="sec sm" id="cpFreeze" title="Oynatma kafasındaki kareyi 3 saniyelik bir klip olarak araya ekler">Kareyi dondur</button><button class="sec sm" id="cpRev">${c.rev ? 'Ters çevirmeyi kaldır' : 'Ters çevir'}</button></div>
        <button class="sec" id="cpDel" style="margin-top:14px">Klibi sil</button>`;
      $('cpFreeze').onclick = () => freezeFrame(c);
      $('cpRev').onclick = () => reverseClip(c);
      const setIn = v => { c.in = clamp(v, 0, c.out - 0.1); pause(); refresh(); seek(T); };
      const setOut = v => { c.out = clamp(v, c.in + 0.1, c.dur); pause(); refresh(); seek(T); };
      const srcNow = () => { const o = L.find(x => x.c.id === c.id); if (!o || T < o.t0 || T > o.t0 + o.len){ toast('Önce oynatma kafasını bu klibin üstüne getir'); return null; } return c.in + (T - o.t0) * spd(c); };
      $('cpIn').onchange = e => setIn(+e.target.value);
      $('cpOut').onchange = e => setOut(+e.target.value);
      $('cpInNow').onclick = () => { const s = srcNow(); if (s != null) setIn(s); };
      $('cpOutNow').onclick = () => { const s = srcNow(); if (s != null) setOut(s); };
      $('cpLeft').onclick = () => { pause(); [P.clips[i - 1], P.clips[i]] = [P.clips[i], P.clips[i - 1]]; refresh(); seek(T); };
      $('cpRight').onclick = () => { pause(); [P.clips[i + 1], P.clips[i]] = [P.clips[i], P.clips[i + 1]]; refresh(); seek(T); };
      $('cpDel').onclick = deleteSelected;
    } else if (inspTab === 'speed'){
      dyn.innerHTML = speedHtml(c, len); bindSpeed(c, false);
    } else if (inspTab === 'fx'){ renderFxInsp(c, true);
    } else if (inspTab === 'anim'){ renderAnimInsp(c, true, len);
    } else {
      if (!c.hasAudio){ dyn.innerHTML = '<p class="emptyi">Bu klipte ses yok.</p>'; return; }
      const maxF = Math.min(10, len).toFixed(1);
      dyn.innerHTML = `
        <label>Sesi kapat<input type="checkbox" id="cpMute" ${c.muted ? 'checked' : ''}></label>
        ${rangeRow('cpVol', 'Ses seviyesi', 0, 2, 0.01, c.vol, pct)}
        ${rangeRow('cpFi', 'Yavaşça aç', 0, maxF, 0.1, c.fadeIn || 0, secs)}
        ${rangeRow('cpFo', 'Yavaşça kapat', 0, maxF, 0.1, c.fadeOut || 0, secs)}
        <p class="note">Zaman çizelgesinde ses bandının köşelerindeki yuvarlakları sürükleyerek de ayarlayabilirsin.</p>
        <div class="row" style="margin-top:8px"><button class="sec sm" id="cpDetach" title="Videonun sesini ayrı bir ses katmanı yap">Sesi ayır</button><button class="sec sm" id="cpReset">Sesi sıfırla</button></div>`;
      $('cpDetach').onclick = () => detachAudio(c);
      $('cpMute').onchange = e => { c.muted = e.target.checked; refresh(); };
      bindRangeLive('cpVol', pct, v => c.vol = v);
      bindRangeLive('cpFi', secs, v => c.fadeIn = Math.min(v, len - (c.fadeOut || 0)));
      bindRangeLive('cpFo', secs, v => c.fadeOut = Math.min(v, len - (c.fadeIn || 0)));
      $('cpReset').onclick = () => { c.env = DEF_ENV(); c.vol = 1; c.fadeIn = 0; c.fadeOut = 0; c.muted = false; refresh(); };
    }
  } else if (inspMode === 'audio'){
    head.textContent = 'Ses';
    const len = audioLen(a), maxF = Math.min(10, Math.max(0.1, len)).toFixed(1);
    dyn.innerHTML = `
      <div class="kv"><span>Dosya</span><span title="${esc(a.path)}">${esc(a.name)}</span><span>Dosya süresi</span><span>${fmt(a.dur)}</span>
        <span>Çizelgede</span><span>${fmt(a.start)} – ${fmt(a.start + len)}</span></div>
      <label>Başlangıç<span class="inrow"><input type="number" step="0.1" min="0" id="apStart" value="${a.start.toFixed(2)}"><button class="sec" id="apNow" title="Oynatma kafasından başlat">${ICON.target}</button></span></label>
      <label>Sesi kapat<input type="checkbox" id="apMute" ${a.muted ? 'checked' : ''}></label>
      ${rangeRow('apVol', 'Ses seviyesi', 0, 2, 0.01, a.vol, pct)}
      ${rangeRow('apFi', 'Yavaşça aç', 0, maxF, 0.1, a.fadeIn || 0, secs)}
      ${rangeRow('apFo', 'Yavaşça kapat', 0, maxF, 0.1, a.fadeOut || 0, secs)}
      <label>Ses efekti<select id="apFx"><option value="">Yok</option>${AUDIO_FX.map(x => `<option value="${x.id}" ${a.afx === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
      <p class="note">Efekt sesin kopyasına işlenir; Yok seçince özgün ses geri gelir. Videonun sesine uygulamak için önce Sesi ayır.</p>
      <h3>Hız</h3>
      ${speedHtml(a, len)}
      <h3>Uzunluk</h3>
      <label>Süre (sn)<span class="inrow"><input type="number" step="0.1" min="0.1" id="apLen" value="${len.toFixed(2)}"><button class="sec" id="apFit" title="Videonun sonuna kadar uzat">⇥</button></span></label>
      <label>Baştan atla (sn)<input type="number" step="0.1" min="0" id="apTrim" value="${a.trimIn.toFixed(2)}"></label>
      <label>Döngü (dosya bitince baştan)<input type="checkbox" id="apLoop" ${a.loop ? 'checked' : ''}></label>
      <p class="note">Zaman çizelgesinde sesin sol veya sağ kenarını sürükleyerek de kısaltıp uzatabilirsin. Döngü açıkken dosyanın süresinden uzun yapılabilir.</p>
      <p class="note">%100 üstü seviye önizlemede %100 duyulur, dışa aktarmada uygulanır.</p>
      <button class="sec" id="apDel" style="margin-top:10px">Sesi sil</button>`;
    $('apStart').onchange = e => { a.start = Math.max(0, +e.target.value || 0); refresh(); syncAudio(true); };
    $('apNow').onclick = () => { a.start = T; refresh(); syncAudio(true); };
    $('apMute').onchange = e => { a.muted = e.target.checked; refresh(); };
    $('apFx').onchange = e => applyAudioFx(a, e.target.value);
    bindRangeLive('apVol', pct, v => a.vol = v);
    bindRangeLive('apFi', secs, v => a.fadeIn = v);
    bindRangeLive('apFo', secs, v => a.fadeOut = v);
    $('apLen').onchange = e => { a.len = clamp(+e.target.value || 0.1, 0.1, audioMax(a)); refresh(); syncAudio(true); };
    $('apFit').onclick = () => { if (VEND > a.start){ a.len = clamp(VEND - a.start, 0.1, audioMax(a)); if (!a.loop && VEND - a.start > audioMax(a)) toast('Dosya video kadar uzun değil. Daha uzun yapmak için Döngü\'yü aç.'); refresh(); } };
    $('apTrim').onchange = e => { a.trimIn = clamp(+e.target.value || 0, 0, Math.max(0, a.dur - 0.1)); a.len = audioLen(a); refresh(); };
    $('apLoop').onchange = e => { a.loop = e.target.checked; a.len = audioLen(a); refresh(); };
    $('apDel').onclick = deleteSelected;
    bindSpeed(a, true);
  } else if (inspMode === 'trans'){
    head.textContent = 'Geçiş';
    const tr = trOf(selTr), raw = P.clips[selTr].tr;
    dyn.innerHTML = `
      <div class="kv"><span>Konum</span><span>${selTr + 1}. ve ${selTr + 2}. klip arası</span><span>Efekt</span><span>${raw ? trName(raw.type) : 'Yok (kesme)'}</span></div>
      ${raw ? rangeRow('tpDur', 'Süre', 0.2, 3, 0.1, raw.d, secs) : ''}
      ${raw && tr && tr.d < raw.d - 0.01 ? `<p class="note">Klipler kısa olduğu için ${tr.d.toFixed(1)} sn uygulanıyor.</p>` : ''}
      <p class="note">Efekti değiştirmek için soldaki Geçiş sekmesinden bir efekte tıkla.</p>
      <div class="row" style="margin-top:10px"><button class="sec sm" id="tpAll" ${raw ? '' : 'disabled'}>Tümüne uygula</button><button class="sec sm" id="tpDel" ${raw ? '' : 'disabled'}>Kaldır</button></div>`;
    if (raw) bindRangeLive('tpDur', secs, v => { raw.d = v; P.defTr.d = v; relayout(); });
    $('tpAll').onclick = () => { P.clips.slice(0, -1).forEach(x => x.tr = {...raw}); refresh(); toast(`Tüm geçişler: ${trName(raw.type)}`); };
    $('tpDel').onclick = () => { P.clips[selTr].tr = null; refresh(); };
  } else if (inspMode === 'text'){
    head.textContent = 'Metin';
    dyn.innerHTML = '';
    const cue = P.cues[selCue], txt = isTextCue(cue);
    $('cueEdit').innerHTML = cue ? `
      <h3>${txt ? 'Seçili metin' : 'Seçili satır'}</h3>
      <div class="kv"><span>Zaman</span><span>${fmt(cue.start)} – ${fmt(cue.end)}</span></div>
      <textarea id="cueText" rows="3">${esc(cue.text)}</textarea>
      <label>Süre (sn)<input type="number" id="cueDur" min="0.2" step="0.1" value="${+(cue.end - cue.start).toFixed(2)}"></label>
      <div class="row" style="margin-top:6px"><button class="sec sm" id="cueDel">${txt ? 'Metni sil' : 'Satırı sil'}</button></div>` : '<p class="note">Metni düzenlemek veya tek satırın stilini değiştirmek için altyazı izinde bir satıra tıkla.</p>';
    showSubAll(!txt);
    syncSubControls();
    if (cue){
      $('cueText').onchange = e => {
        const t = e.target.value.replace(/\s+/g, ' ').trim();
        if (!t){ P.cues.splice(selCue, 1); selCue = -1; }
        else { cue.text = t; cue.words = wordsFromText(t, cue.start, cue.end); }
        refresh();
      };
      $('cueDur').onchange = e => {
        const nxt = txt ? null : P.cues.find(c => c !== cue && !isTextCue(c) && c.start >= cue.start);
        const end = Math.min(cue.start + Math.max(0.2, +e.target.value || 0), nxt ? nxt.start : Infinity);
        if (end - cue.start < 0.05) return refresh();
        const f = (end - cue.start) / (cue.end - cue.start);   // kelime zamanlarını orantılı ölçekle
        cue.words.forEach(w => { w.s = cue.start + (w.s - cue.start) * f; w.e = cue.start + (w.e - cue.start) * f; });
        cue.end = end; refresh();
      };
      $('cueDel').onclick = deleteSelected;
    }
  } else {
    const {W, H} = outRes();
    if (VIEW === 'project'){
      head.textContent = 'Proje';
      const out = SCENES.filter(sc => !inProject(sc.id));
      dyn.innerHTML = `
        <div class="kv"><span>Süre</span><span>${fmt(TOTAL)}</span><span>Projedeki sahneler</span><span>${L.length} / ${SCENES.length}</span>
          <span>Ses katmanları</span><span>${P.audios.length}</span><span>Altyazı satırı</span><span>${subsOnly().length}</span><span>Metin</span><span>${textsOnly().length}</span>
          <span>Çıktı</span><span>${W}×${H}, ${outFps()} fps</span></div>
        <p class="note">Sahneleri sürükleyerek sırala, aralarına geçiş ekle. Müzik, dış ses, video katmanı ve altyazı burada tüm projeye eklenir. Bir sahneyi düzenlemek için çift tıkla.</p>
        ${out.length ? `<h3>Projede olmayan sahneler</h3>${out.map(sc => `<div class="row" style="margin:4px 0"><span style="flex:1">${esc(sc.name)}</span><button class="sec sm" data-addsc="${sc.id}" style="flex:none">Projeye ekle</button></div>`).join('')}` : ''}`;
      dyn.querySelectorAll('[data-addsc]').forEach(b => b.onclick = () => addSceneToProject(b.dataset.addsc));
      return;
    }
    const sc = sceneById(curScene);
    head.textContent = 'Sahne';
    dyn.innerHTML = `
      <label>Ad<input type="text" id="scName" value="${esc(sc.name)}"></label>
      <div class="kv"><span>Süre</span><span>${fmt(TOTAL)}</span><span>Klipler</span><span>${L.length}</span>
        <span>Ses katmanları</span><span>${P.audios.length}</span><span>Projede</span><span>${inProject(sc.id) ? 'Var' : 'Yok'}</span>
        <span>Çıktı</span><span>${W}×${H}, ${outFps()} fps</span></div>
      ${L.length ? '<p class="note">Ayarlarını görmek için zaman çizelgesinde bir klibe, sese veya geçişe tıkla.</p>' : '<p class="emptyi">Sahne boş.<br>Kitaplıktan bir videoyu zaman çizelgesine sürükleyerek başla.</p>'}
      <div class="row" style="margin-top:6px">${inProject(sc.id) ? '' : '<button class="primary sm" id="scAdd">Projeye ekle</button>'}<button class="sec sm" id="scDup">Çoğalt</button><button class="sec sm" id="scDel">Sil</button></div>
      <button class="sec" id="scExit" style="margin-top:8px">Sahneden çık</button>`;
    $('scName').onchange = e => renameScene(sc.id, e.target.value);
    if ($('scAdd')) $('scAdd').onclick = () => addSceneToProject(sc.id);
    $('scDup').onclick = () => duplicateScene(sc.id);
    $('scDel').onclick = () => deleteScene(sc.id);
    $('scExit').onclick = () => openView('project');
  }
}

/* ================= Geçiş sekmesi ================= */
const miniA = document.createElement('canvas'), miniB = document.createElement('canvas');
(function makeMiniSources(){
  for (const [c, c1, c2, txt] of [[miniA, '#2b5c8a', '#14273d', 'A'], [miniB, '#0f8a8f', '#0b3b40', 'B']]){
    c.width = 160; c.height = 90; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 160, 90); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, 160, 90);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 36px -apple-system,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 80, 47);
  }
})();
$('trGrid').innerHTML = TRANSITIONS.map(t => `<div class="trcard" data-tr="${t.id}"><canvas width="160" height="90"></canvas><div>${t.name}</div></div>`).join('');
let hoverTr = null;
$('trGrid').addEventListener('mouseover', e => { const c = e.target.closest('[data-tr]'); hoverTr = c ? c.dataset.tr : null; });
$('trGrid').addEventListener('mouseleave', () => hoverTr = null);
function animateMinis(now){
  if ($('tab-trans').classList.contains('on')){
    const q = clamp(((now / 1500) % 1.5 - 0.25), 0, 1);
    document.querySelectorAll('.trcard canvas').forEach(c => {
      const type = c.parentElement.dataset.tr, p = hoverTr === type ? q : (type === 'fadeblack' || type === 'fadewhite' ? 0.3 : 0.5);
      drawTransition(c.getContext('2d'), type, gg => gg.drawImage(miniA, 0, 0), gg => gg.drawImage(miniB, 0, 0), p, 160, 90);
    });
  }
  requestAnimationFrame(animateMinis);
}
requestAnimationFrame(animateMinis);
/* ================= Efektler (filtre, ayarla, video efekti, hareket, animasyon) ================= */
const optHtml = (list, cur) => `<option value="">Yok</option>${list.map(x => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}`;
const ival = v => String(Math.round(v));
// efektin uygulanacağı öğeler: seçili klipler/katmanlar; seçim yoksa sahnede oynatma kafasındaki klip
function fxTargets(){
  const keys = [...multi].filter(k => (k[0] === 'c' || k[0] === 'o') && itemByKey(k) && !itemByKey(k).scene);
  if (keys.length) return keys;
  if (VIEW === 'scene'){ const act = activeAt(T); if (act.length) return ['c:' + act[act.length - 1].c.id]; }
  return [];
}
function renderFxTab(){
  if (!$('tab-fx').classList.contains('on')) return;
  const keys = fxTargets(), first = keys.length ? itemByKey(keys[0]) : null, fx = (first && first.fx) || {};
  $('fxTarget').textContent = (keys.length ? `Filtre ${keys.length} öğeye uygulanır${[...multi].length ? '' : ' (oynatma kafasındaki klip)'}.`
    : VIEW === 'project' ? 'Projede filtreler video katmanlarına uygulanır; sahne kliplerine eklemek için sahneyi aç.' : 'Filtre için zaman çizelgesinde bir klip seç.')
    + ' Video efektine tıklayınca oynatma kafasına efekt katmanı eklenir.';
  const src = first && media.get(first.id);
  const card = (kind, id, name, on, pfx) => `<div class="trcard ${on ? 'on' : ''}" data-${kind}="${id}"><canvas width="160" height="90" data-pfx='${JSON.stringify(pfx)}'></canvas><div>${name}</div></div>`;
  $('fxFilterGrid').innerHTML = card('fxf', '', 'Yok', !fx.filter, null) + FX_FILTERS.map(f => card('fxf', f.id, f.name, fx.filter && fx.filter.id === f.id, {filter: {id: f.id, k: 1}})).join('');
  const selX = inspMode === 'effect' && P.effects.find(x => x.id === selEfx);
  $('fxEffectGrid').innerHTML = FX_EFFECTS.map(f => card('fxe', f.id, f.name, selX && selX.eff.id === f.id, {eff: {id: f.id, k: 0.7}})).join('');
  document.querySelectorAll('#tab-fx canvas').forEach(cn => {
    const g = cn.getContext('2d'), pfx = JSON.parse(cn.dataset.pfx);
    const base = gg => { if (src && src.readyState >= 2) drawFit(gg, src, 160, 90); else { const gr = gg.createLinearGradient(0, 0, 160, 90); gr.addColorStop(0, '#5a6b7c'); gr.addColorStop(1, '#c9a27a'); gg.fillStyle = gr; gg.fillRect(0, 0, 160, 90); } };
    drawWithFx(g, pfx, 0.15, 3, 160, 90, base);
  });
}
function applyFxCard(kind, id){
  const keys = fxTargets();
  if (!keys.length){ toast(VIEW === 'project' ? 'Projede efektler video katmanlarına uygulanır. Sahne kliplerine eklemek için sahneyi aç.' : 'Önce zaman çizelgesinde bir klip seç'); return; }
  for (const k of keys){
    const it = itemByKey(k), fx = it.fx || {};
    setFx(it, {filter: id ? {id, k: fx.filter ? fx.filter.k : 1} : null});
  }
  if (![...multi].length){ multi = new Set(keys); setPrimary(keys[0]); }
  if (isItemMode()) inspTab = 'fx';
  refresh();
}
$('fxFilterGrid').addEventListener('click', e => { const c = e.target.closest('[data-fxf]'); if (c) applyFxCard('filter', c.dataset.fxf); });
$('fxEffectGrid').addEventListener('click', e => { const c = e.target.closest('[data-fxe]'); if (c) addEffectLayer(c.dataset.fxe); });
// efekt kartı: oynatma kafasına 3 sn'lik efekt katmanı ekler (seçili efekt katmanı varsa onun türünü değiştirir)
function addEffectLayer(id){
  const cur = inspMode === 'effect' && P.effects.find(x => x.id === selEfx);
  if (cur){ cur.eff = {id, k: cur.eff.k}; refresh(); return; }
  const x = {id: uid(), eff: {id, k: 0.7}, start: T, len: 3};
  P.effects.push(x); multi = new Set(['e:' + x.id]); setPrimary('e:' + x.id);
  refresh(); seek(T);
}
// denetçi: Efekt sekmesi (video = ana izdeki klip; değilse katman: yalnızca filtre ve renk)
function renderFxInsp(it, video){
  const fx = it.fx || {}, a = fx.adj || {}, dyn = $('inspDyn');
  const adj = FX_ADJ.filter(([k]) => video || FX_COLOR_ADJ.includes(k));
  dyn.innerHTML = `
    <h3>Filtre</h3>
    <label>Filtre<select id="fxF">${optHtml(FX_FILTERS, fx.filter && fx.filter.id)}</select></label>
    ${fx.filter ? rangeRow('fxFk', 'Yoğunluk', 0, 100, 1, Math.round(fx.filter.k * 100), v => v + '%') : ''}
    <h3>Ayarla</h3>
    ${adj.map(([k, name, mn, mx]) => rangeRow('fxA_' + k, name, mn, mx, 1, a[k] || 0, ival)).join('')}
    ${fx.eff ? `<div class="kv" style="margin-top:10px"><span>Klip efekti</span><span>${fxName(FX_EFFECTS, fx.eff.id)}</span></div><button class="sec sm" id="fxEOld">Klip efektini kaldır</button>` : ''}
    <p class="note">Video efektleri (titreme, glitch, flaş…) Efekt sekmesinden zaman çizelgesine katman olarak eklenir.</p>
    <div class="row" style="margin-top:12px"><button class="sec sm" id="fxReset">Sıfırla</button>${video ? '<button class="sec sm" id="fxAll" title="Bu klibin filtresini ve ayarlarını tüm sahnelerdeki kliplere kopyalar">Tüm kliplere uygula</button>' : ''}</div>`;
  const live = (id, f) => bindRangeLive(id, id.startsWith('fxA_') ? ival : v => v + '%', v => { f(v); draw(); });
  $('fxF').onchange = e => { setFx(it, {filter: e.target.value ? {id: e.target.value, k: fx.filter ? fx.filter.k : 1} : null}); refresh(); };
  if (fx.filter) live('fxFk', v => setFx(it, {filter: {...it.fx.filter, k: v / 100}}));
  adj.forEach(([k]) => live('fxA_' + k, v => setFx(it, {adj: {...((it.fx || {}).adj || {}), [k]: v}})));
  if (video){
    if (fx.eff) $('fxEOld').onclick = () => { setFx(it, {eff: null}); refresh(); };
    $('fxAll').onclick = () => {
      const clips = new Set([...(VIEW === 'scene' ? P.clips : []), ...SCENES.flatMap(sc => sc.clips)].filter(c => !c.scene));
      clips.forEach(c => setFx(c, {filter: fx.filter || null, adj: fx.adj || null}));
      refresh(); toast(`Filtre ve ayarlar ${clips.size} klibe uygulandı`);
    };
  }
  $('fxReset').onclick = () => { setFx(it, {filter: null, adj: null, eff: null}); refresh(); };
}
// denetçi: Animasyon sekmesi (hareket yalnızca ana izde; katmanda giriş/çıkış sönmesi)
function renderAnimInsp(it, video, len){
  const fx = it.fx || {}, dyn = $('inspDyn'), maxD = Math.max(0.1, Math.min(3, len / 2)).toFixed(1);
  const anims = video ? FX_ANIMS : FX_ANIMS.filter(x => x.id === 'fade');
  const animRows = (key, title) => `<h3>${title}</h3>
    <label>Animasyon<select id="fx_${key}">${optHtml(anims, fx[key] && fx[key].id)}</select></label>
    ${fx[key] ? rangeRow('fx_' + key + 'D', 'Süre', 0.1, maxD, 0.1, Math.min(fx[key].d, +maxD), secs) : ''}`;
  dyn.innerHTML = `
    ${video ? `<h3>Hareket</h3>
    <label>Hareket<select id="fxM">${optHtml(FX_MOTIONS, fx.motion && fx.motion.id)}</select></label>
    ${fx.motion ? rangeRow('fxMk', 'Miktar', 0, 100, 1, Math.round(fx.motion.k * 100), v => v + '%') : ''}
    <p class="note">Klip boyunca yavaşça yakınlaşır veya kayar (Ken Burns). Durağan görüntülere hareket katar.</p>` : ''}
    ${animRows('animIn', 'Giriş')}
    ${animRows('animOut', 'Çıkış')}`;
  if (video){
    $('fxM').onchange = e => { setFx(it, {motion: e.target.value ? {id: e.target.value, k: fx.motion ? fx.motion.k : 0.4} : null}); refresh(); };
    if (fx.motion) bindRangeLive('fxMk', v => v + '%', v => { setFx(it, {motion: {...it.fx.motion, k: v / 100}}); draw(); });
  }
  for (const key of ['animIn', 'animOut']){
    $('fx_' + key).onchange = e => { setFx(it, {[key]: e.target.value ? {id: e.target.value, d: fx[key] ? fx[key].d : 0.5} : null}); refresh(); seek(T); };
    if (fx[key]) bindRangeLive('fx_' + key + 'D', secs, v => { setFx(it, {[key]: {...it.fx[key], d: v}}); draw(); });
  }
}
/* ---- Dosya işleyen araçlar: kareyi dondur, ters çevir, ses efekti (sonuç uygulamanın Medya klasörüne yazılır) ---- */
let fxBusy = false;
async function mediaJob(msg, fn){
  if (fxBusy){ toast('Önceki işlem sürüyor, biraz bekle'); return; }
  fxBusy = true; pause(); toast(msg);
  try { await fn(); } catch (e){ console.error(e); toast('İşlem yapılamadı: ' + e.message.split('\n').pop(), 'err'); }
  finally { fxBusy = false; }
}
function swapSource(it, path, tag){
  it.path = path; dropMedia(it.id); makeMedia(it, tag);
  const v = visCache.get(visKey(it));
  if (v) Object.assign(it, v); else ensureVisuals(it, tag === 'video');
}
function reverseClip(c){
  if (c.rev){
    const r = c.rev; delete c.rev;
    Object.assign(c, {dur: r.dur, in: r.in, out: r.out}); swapSource(c, r.path, 'video'); refresh(); seek(T); return;
  }
  const d = c.out - c.in;
  if (d > 120 && !confirm('Uzun klipleri ters çevirmek uzun sürer ve çok bellek kullanır. Devam edilsin mi?')) return;
  mediaJob('Klip ters çevriliyor…', async () => {
    const out = await api.joinPath(await api.mediaDir(), `${stem(c.path)}__ters_${hash(c.path + c.in + c.out)}.mp4`);
    if (!(await api.exists(out))) await runFfmpeg(['-ss', c.in.toFixed(3), '-t', d.toFixed(3), '-i', c.path, '-vf', 'reverse',
      ...(c.hasAudio ? ['-af', 'areverse', '-c:a', 'aac', '-b:a', '192k'] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', out], d);
    const info = await api.probe(out);
    c.rev = {path: c.path, dur: c.dur, in: c.in, out: c.out};
    Object.assign(c, {dur: info.duration, in: 0, out: info.duration}); swapSource(c, out, 'video');
    refresh(); seek(T); toast('Klip ters çevrildi');
  });
}
function freezeFrame(c){
  const o = L.find(x => x.c === c);
  if (!o || T < o.t0 || T > o.t0 + o.len){ toast('Önce oynatma kafasını bu klibin üstüne getir'); return; }
  const local = T - o.t0, src = c.in + clamp(local, 0, o.len - 0.04) * spd(c);
  mediaJob('Kare donduruluyor…', async () => {
    const out = await api.joinPath(await api.mediaDir(), `${stem(c.path)}__kare_${hash(c.path + src.toFixed(3))}.mp4`);
    if (!(await api.exists(out))){
      const tmp = await api.makeTemp(), png = tmp + '/kare.png';
      try {
        await runFfmpeg(['-ss', src.toFixed(3), '-i', c.path, '-frames:v', '1', png], 0);
        await runFfmpeg(['-loop', '1', '-framerate', String(outFps()), '-t', '3', '-i', png, '-f', 'lavfi', '-t', '3', '-i', 'anullsrc=r=48000:cl=stereo',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-c:a', 'aac', '-shortest', out], 3);
      } finally { api.removeDir(tmp); }
    }
    let idx = P.clips.indexOf(c) + 1;
    if (local < 0.05) idx--; else if (local < o.len - 0.05) cutClip(c, local, null);
    const [it] = await importFiles([out]); if (!it) return;
    const nc = insertClip(it, idx);
    if (c.fx) setFx(nc, {filter: c.fx.filter || null, adj: c.fx.adj || null});
    multi = new Set(['c:' + nc.id]); setPrimary('c:' + nc.id);
    refresh(); seek(T); toast('Donmuş kare eklendi (3 sn). Kenarından sürükleyerek süresini değiştirebilirsin.');
  });
}
function applyAudioFx(a, id){
  const src = a.srcPath || a.path;
  if (!id){
    if (a.srcPath){ delete a.srcPath; delete a.afx; swapSource(a, src, 'audio'); refresh(); syncAudio(true); }
    return;
  }
  const fx = AUDIO_FX.find(x => x.id === id); if (!fx) return;
  mediaJob(`${fx.name} uygulanıyor…`, async () => {
    const out = await api.joinPath(await api.mediaDir(), `${stem(src)}__${id}.m4a`);
    if (!(await api.exists(out))) await runFfmpeg(['-i', src, '-vn', '-af', fx.af, '-c:a', 'aac', '-b:a', '192k', out], a.dur);
    a.srcPath = src; a.afx = id; swapSource(a, out, 'audio');
    refresh(); syncAudio(true); toast(`${fx.name} uygulandı`);
  });
}
function renderTransTab(){
  const n = P.clips.length;
  $('trBounds').innerHTML = n < 2 ? '<p class="note">Geçiş eklemek için zaman çizelgesinde en az iki klip olmalı. Seçtiğin efekt yeni kliplerde kullanılır.</p>'
    : P.clips.slice(0, -1).map((c, i) => { const tr = trOf(i);
        return `<button data-b="${i}" class="${i === selTr ? 'on' : ''}">${i + 1} → ${i + 2}<small>${tr ? trName(tr.type) : 'kesme'}</small></button>`; }).join('');
  const cur = n >= 2 ? (P.clips[selTr] && P.clips[selTr].tr) : P.defTr;
  document.querySelectorAll('.trcard').forEach(el => el.classList.toggle('on', !!cur && cur.type === el.dataset.tr));
}
function focusTransition(i){
  selTr = i; inspMode = 'trans'; showTab('trans'); refresh();
  const o = L[selTr + 1]; if (o) seek(Math.max(0, o.t0 - 0.5));
}
$('trBounds').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) focusTransition(+b.dataset.b); });
let previewStop = null;
$('trGrid').addEventListener('click', e => {
  const card = e.target.closest('[data-tr]'); if (!card) return;
  const cur = P.clips[selTr] && P.clips[selTr].tr, d = cur ? cur.d : P.defTr.d;
  P.defTr = {type: card.dataset.tr, d};
  if (P.clips.length >= 2){
    pause(); P.clips[selTr].tr = {type: card.dataset.tr, d}; inspMode = 'trans';
    refresh();
    if (P.clips[selTr].scene && !trOf(selTr)) toast('Bu iki sahne arasında geçiş yapılamıyor: ilk sahnenin videosu sahnenin sonuna kadar sürmeli, ikinci sahne videoyla başlamalı.', 'err');
    const o = L[selTr + 1], tr = trOf(selTr);
    if (o){
      seek(Math.max(0, o.t0 - 0.6)); play();
      clearTimeout(previewStop);
      previewStop = setTimeout(() => { if (playing) pause(); }, ((tr ? tr.d : 0) + 1.2) * 1000);
    }
  } else renderTransTab();
});
function bindRange(id, fn){
  const el = $(id);
  el.addEventListener('input', () => { const v = el.parentElement.querySelector('.v'); if (v) v.textContent = el.value; fn(el); });
}
bindRange('edgeD', el => { P.edgeD = +el.value; refresh(); });
$('fadeStart').onchange = e => { P.fadeStart = e.target.checked; refresh(); };
$('fadeEnd').onchange = e => { P.fadeEnd = e.target.checked; refresh(); };

/* ================= Zaman çizelgesi ================= */
const LABEL = 76;
function basePps(){ return Math.max(1, ($('tlScroll').clientWidth - LABEL - 30) / Math.max(TOTAL, 10)); }
function setZoom(z, anchorClientX){
  const sc = $('tlScroll'), r = sc.getBoundingClientRect();
  const ax = anchorClientX != null ? anchorClientX - r.left : sc.clientWidth / 2;
  const tAt = (sc.scrollLeft + ax - LABEL) / curPps;
  $('zoom').value = clamp(z, 1, 80);
  renderTimeline();
  sc.scrollLeft = Math.max(0, tAt * curPps + LABEL - ax);
}
// Ses bandı: y ekseninde %0–%200, %100 yukarıdan %22'de
const ENV_TOP = 0.22;
function envY(v, h){ return v <= 1 ? h * (ENV_TOP + (1 - ENV_TOP) * (1 - v)) : h * ENV_TOP * (2 - v); }
function envV(y, h){ const f = y / h; return f >= ENV_TOP ? clamp(1 - (f - ENV_TOP) / (1 - ENV_TOP), 0, 1) : clamp(2 - f / ENV_TOP, 1, 2); }
// CapCut tarzı: sol/sağ üst köşede yuvarlak; içeri kaydırınca ses dipten başlayıp yuvarlakta normale döner
function fadeSvg(item, len, w, h, attr, off = 0, k = w / Math.max(0.01, len)){
  const y = envY(item.muted ? 0 : item.vol, h);
  const x0 = -off * k, xe = (len - off) * k;
  const x1 = ((item.fadeIn || 0) - off) * k, x2 = (len - (item.fadeOut || 0) - off) * k;
  const pts = `${x0.toFixed(1)},${item.fadeIn > 0 ? h : y} ${x1.toFixed(1)},${y.toFixed(1)} ${x2.toFixed(1)},${y.toFixed(1)} ${xe.toFixed(1)},${item.fadeOut > 0 ? h : y}`;
  const R = 6, cy = Math.max(R + 1, y).toFixed(1);
  return `<svg ${attr} data-off="${off}" data-k="${k}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon class="env-fill" points="${x0.toFixed(1)},0 ${pts} ${xe.toFixed(1)},0"/>
    <polyline class="env-line" points="${pts}"/>
    <line class="env-hit" x1="${clamp(x1, 0, w)}" y1="${y}" x2="${clamp(x2, 0, w)}" y2="${y}"/>
    <circle class="fade-h" data-h="in" cx="${clamp(x1, R + 1, w - R - 1).toFixed(1)}" cy="${cy}"><title>Yavaşça aç</title></circle>
    <circle class="fade-h" data-h="out" cx="${clamp(x2, R + 1, w - R - 1).toFixed(1)}" cy="${cy}"><title>Yavaşça kapat</title></circle>
  </svg>`;
}
function thumbsHtml(c, w, k, off = 0){
  if (!c.thumb || !c.w || !c.h) return '';
  const th = 58, tw = Math.max(24, th * c.w / c.h), n = Math.ceil(w / tw), N = c.thumbN, url = fileUrl(c.thumb);
  let h = '';
  for (let i = 0; i < n && i < 400; i++){
    const src = c.in + (off + ((i + 0.5) * tw) / k) * spd(c), idx = clamp(Math.floor(src / c.dur * N), 0, N - 1);
    h += `<div style="width:${tw.toFixed(1)}px;background-image:url('${url}');background-size:${(N * tw).toFixed(1)}px ${th}px;background-position:${(-idx * tw).toFixed(1)}px 0"></div>`;
  }
  return h;
}
function waveDiv(it, k, offset){
  if (!it.wave) return '';
  const u = fileUrl(it.wave);
  return `<div class="wv" style="-webkit-mask-image:url('${u}');-webkit-mask-size:${(it.dur * k).toFixed(1)}px 100%;-webkit-mask-position:${(-offset * k).toFixed(1)}px 0${it.loop ? ';-webkit-mask-repeat:repeat-x' : ''}"></div>`;
}
// iz başlığındaki sesi kapat düğmesi: izdeki tüm öğeler sessizse açık görünür
function trackItems(key){
  const [kind, n] = key.split(':');
  if (kind === 'v') return P.clips.filter(c => c.hasAudio !== false);
  if (kind === 'o') return P.overlays.filter(o => (o.track ?? 0) === +n && o.hasAudio !== false);
  return P.audios.filter(a => (a.track ?? 0) === +n);
}
function muteBtnHtml(key){
  const items = trackItems(key), on = items.length > 0 && items.every(it => it.muted);
  return `<button class="ic tmute ${on ? 'on' : ''}" data-tmute="${key}" ${items.length ? '' : 'disabled'} title="${on ? 'İzin sesini aç' : 'İzin sesini kapat'}" aria-pressed="${on}">${on ? ICON.volOff : ICON.vol}</button>`;
}
function toggleTrackMute(key){
  const items = trackItems(key); if (!items.length) return;
  const m = !items.every(it => it.muted);
  items.forEach(it => it.muted = m);
  refresh(); syncVideos(false); syncOverlays(false); syncAudio(true);
}
// projede ana izdeki sahne bloğu: sahnenin kliplerinin küçük resimleri yan yana; kenar tutamacı yok (sahne projede kırpılmaz)
function sceneBlockHtml(o, ti, to, k, fps){
  const c = o.c, sc = sceneById(c.scene), off = ti ? ti.d / 2 : 0, vis = o.len - off - (to ? to.d / 2 : 0), w = Math.max(4, vis * k - 1);
  let th = '';
  if (sc) for (const se of layoutClips(sc.clips, false, false, 1)){
    const x = (se.t0 - off) * k, sw = se.len * k;
    if (x + sw < 0 || x > w) continue;
    th += `<div class="sseg" style="left:${x.toFixed(1)}px;width:${sw.toFixed(1)}px">${thumbsHtml(se.c, sw, k)}</div>`;
  }
  return `<div class="blk v scn ${multi.has('c:' + c.id) ? 'sel' : ''}" data-clip="${c.id}" data-off="${off}" style="left:${LABEL + (o.t0 + off) * k}px;width:${w}px;z-index:${o.i + 1}" title="Çift tıkla: sahneyi düzenle">
    <div class="bh"><span class="chip scn">${ICON.scenes}${esc(sc ? sc.name : 'Sahne')}</span><span class="chip tc">${tc(o.len, fps)}</span>${c.muted ? '<span class="chip muted">Sessiz</span>' : ''}</div>
    <div class="thumbs">${th}</div>
    <div class="aud" style="${c.muted ? 'opacity:.4' : ''}"></div>
  </div>`;
}
const CUE_EDGES = '<div class="eh l" data-edge="l" title="Sürükle: başlangıcı değiştir"></div><div class="eh r" data-edge="r" title="Sürükle: uzat / kısalt"></div>';
function renderTimeline(){
  const k = curPps = ppsLock || basePps() * +$('zoom').value, span = Math.max(TOTAL, 10), inner = $('tlInner'), fps = outFps();
  inner.style.width = (LABEL + span * k + 80) + 'px';
  const step = [1 / fps, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s * k >= 80) || 600;
  let h = '<div class="ruler" data-scrub="1"><div class="tlabel"></div>';
  for (let i = 0, t = 0; t <= span + 1e-6; i++, t = i * step){
    h += `<div class="tick" style="left:${LABEL + t * k}px"><span>${step < 1 ? tc(t, fps).slice(3) : fmt(t, 0)}</span></div>`;
    for (let j = 1; j < 4; j++) h += `<div class="tick minor" style="left:${LABEL + (t + step * j / 4) * k}px"></div>`;
  }
  h += '</div>';
  {
    // efekt katmanları: çakışanlar ayrı satırlara dizilir
    const lanes = [];
    [...P.effects].sort((a, b) => a.start - b.start).forEach(x => {
      let ln = lanes.findIndex(l => l.end <= x.start + 1e-6);
      if (ln < 0){ ln = lanes.length; lanes.push({end: 0, items: []}); }
      lanes[ln].end = x.start + x.len; lanes[ln].items.push(x);
    });
    for (let ln = lanes.length - 1; ln >= 0; ln--){
      h += `<div class="track etrack" data-scrub="1"><div class="tlabel" title="Efekt">${ICON.sparkle}</div>`;
      lanes[ln].items.forEach(x => {
        h += `<div class="blk e ${multi.has('e:' + x.id) ? 'sel' : ''}" data-efx="${x.id}" style="left:${LABEL + x.start * k}px;width:${Math.max(4, x.len * k - 1)}px" title="${esc(fxName(FX_EFFECTS, x.eff.id))}"><span class="chip">${esc(fxName(FX_EFFECTS, x.eff.id))}</span>${CUE_EDGES}</div>`;
      });
      h += '</div>';
    }
  }
  {
    // metin öğeleri üst üste binebilir: çakışanlar ayrı satırlara dizilir
    const lanes = [];
    P.cues.forEach((c, i) => {
      if (!isTextCue(c)) return;
      let ln = lanes.findIndex(l => l.end <= c.start + 1e-6);
      if (ln < 0){ ln = lanes.length; lanes.push({end: 0, items: []}); }
      lanes[ln].end = c.end; lanes[ln].items.push([c, i]);
    });
    for (let ln = lanes.length - 1; ln >= 0; ln--){
      h += `<div class="track strack" data-scrub="1"><div class="tlabel" title="Metin">${ICON.text}</div>`;
      lanes[ln].items.forEach(([c, i]) => {
        h += `<div class="blk s ${multi.has('s:' + c.id) ? 'sel' : ''}" data-cue="${i}" data-cid="${c.id}" style="left:${LABEL + c.start * k}px;width:${Math.max(2, (c.end - c.start) * k - 1)}px" title="${esc(c.text)}">${esc(c.text)}${CUE_EDGES}</div>`;
      });
      h += '</div>';
    }
  }
  const nOv = P.overlays.length ? Math.max(...P.overlays.map(o => (o.track ?? 0) + 1)) : 0;
  if (!nOv) h += `<div class="track otrack empty" data-scrub="1" data-otr="0"><div class="tlabel" title="Video katmanı">${ICON.layers}</div><span class="ohint">Video katmanı eklemek için videoyu buraya sürükle</span></div>`;
  for (let tr = nOv - 1; tr >= 0; tr--){
    h += `<div class="track otrack" data-scrub="1" data-otr="${tr}"><div class="tlabel" title="Video katmanı ${tr + 1}">${ICON.layers}${muteBtnHtml('o:' + tr)}</div>`;
    P.overlays.filter(o => (o.track ?? 0) === tr).forEach(o => {
      const len = clipLen(o), w = Math.max(6, len * k);
      h += `<div class="blk o ${multi.has('o:' + o.id) ? 'sel' : ''}${o.gid ? ' grp' : ''}" data-ov="${o.id}" style="left:${LABEL + o.start * k}px;width:${w}px">
        <div class="bh">${o.gid ? `<span class="chip lk" title="Grupta">${ICON.link}</span>` : ''}${o.missing ? '<span class="chip muted">Dosya yok</span>' : ''}<span class="chip">${esc(o.name)}</span><span class="chip tc">${tc(len, fps)}</span>${spd(o) !== 1 ? `<span class="chip tc">${+spd(o).toFixed(2)}x</span>` : ''}${o.muted ? '<span class="chip muted">Sessiz</span>' : ''}</div>
        <div class="eh l" data-edge="l" title="Sürükle: baştan kırp"></div><div class="eh r" data-edge="r" title="Sürükle: sondan kırp"></div>
        <div class="thumbs">${thumbsHtml(o, w, k, 0)}</div>
        <div class="aud" style="${o.muted ? 'opacity:.4' : ''}">${waveDiv(o, k / spd(o), o.in)}<div class="svgw"></div></div>
      </div>`;
    });
    h += '</div>';
  }
  h += `<div class="track vtrack" data-scrub="1" id="vtrack"><div class="tlabel" title="${VIEW === 'project' ? 'Sahneler' : 'Ana video'}">${VIEW === 'project' ? ICON.scenes : ICON.video}${muteBtnHtml('v')}</div>`;
  if (VIEW === 'project' && !L.length) h += '<span class="ohint">Projede sahne yok. Üstteki sahne sekmelerinden birini aç veya + ile yeni sahne ekle.</span>';
  for (const o of L){
    const c = o.c, ti = trOf(o.i - 1), to = trOf(o.i);
    if (c.scene){ h += sceneBlockHtml(o, ti, to, k, fps); continue; }
    const off = ti ? ti.d / 2 : 0, vis = o.len - off - (to ? to.d / 2 : 0), w = Math.max(4, vis * k - 1);
    h += `<div class="blk v ${multi.has('c:' + c.id) ? 'sel' : ''}${c.gid ? ' grp' : ''}" data-clip="${c.id}" data-off="${off}" style="left:${LABEL + (o.t0 + off) * k}px;width:${w}px;z-index:${o.i + 1}">
      <div class="bh">${c.gid ? `<span class="chip lk" title="Grupta">${ICON.link}</span>` : ''}${c.missing ? '<span class="chip muted">Dosya yok</span>' : ''}<span class="chip">${esc(c.name)}</span><span class="chip tc">${tc(o.len, fps)}</span>${spd(c) !== 1 ? `<span class="chip tc">${+spd(c).toFixed(2)}x</span>` : ''}${c.muted ? '<span class="chip muted">Sessiz</span>' : ''}</div>
      <div class="eh l" data-edge="l" title="Sürükle: baştan kırp"></div><div class="eh r" data-edge="r" title="Sürükle: sondan kırp"></div>
      <div class="thumbs">${thumbsHtml(c, w, k, off)}</div>
      <div class="aud" style="${c.muted ? 'opacity:.4' : ''}">${waveDiv(c, k / spd(c), c.in + off * spd(c))}<div class="svgw"></div></div>
    </div>`;
  }
  for (let i = 0; i < L.length - 1; i++){
    const tr = trOf(i), B = L[i + 1];
    if ((B.c.gap || 0) > 0.001) continue;   // boşluklu kliplerde geçiş olmaz
    if (B.c.scene && !(sceneInfo(L[i].c.scene).fills && sceneInfo(B.c.scene).startsVideo)) continue;   // bu sahneler arasında geçiş yapılamaz
    if (tr){
      // CapCut gibi: geçiş süresi kadar genişlikte yarı saydam kutu, ortada papyon simgesi
      const w = Math.max(20, tr.d * k), left = LABEL + (B.t0 + tr.d / 2) * k - w / 2;
      h += `<div class="trov ${inspMode === 'trans' && selTr === i ? 'sel' : ''}" data-trov="${i}" style="left:${left}px;width:${w}px" title="${trName(tr.type)}, ${tr.d.toFixed(1)} sn">
        <span class="trh l" data-trh="l" title="Sürükle: süreyi değiştir"></span>${ICON.bowtie}<span class="trh r" data-trh="r" title="Sürükle: süreyi değiştir"></span></div>`;
    } else {
      h += `<div class="trbadge add" data-trb="${i}" style="left:${LABEL + B.t0 * k}px" title="Geçiş ekle">${ICON.plus}</div>`;
    }
  }
  h += '<div class="droppos" id="dropPos"></div></div>';
  const nTracks = Math.max(1, ...P.audios.map(a => (a.track ?? 0) + 1));
  for (let tr = 0; tr < nTracks; tr++){
    h += `<div class="track atrack" data-scrub="1" data-tr="${tr}"><div class="tlabel" title="Ses ${tr + 1}">${ICON.audio}${muteBtnHtml('a:' + tr)}</div>`;
    P.audios.filter(a => (a.track ?? 0) === tr).forEach(a => {
      const len = audioLen(a), w = Math.max(6, len * k);
      h += `<div class="blk a ${multi.has('a:' + a.id) ? 'sel' : ''}${a.gid ? ' grp' : ''}" data-aud="${a.id}" style="left:${LABEL + a.start * k}px;width:${w}px">
        <div class="bh" data-amove="${a.id}" title="Sürükle: başlangıcı değiştir">${a.gid ? `<span class="chip lk" title="Grupta">${ICON.link}</span>` : ''}${a.missing ? '<span class="chip muted">Dosya yok</span>' : ''}<span class="chip">${esc(a.name)}</span><span class="chip tc">${tc(len, fps)}</span>${spd(a) !== 1 ? `<span class="chip tc">${+spd(a).toFixed(2)}x</span>` : ''}${a.muted ? '<span class="chip muted">Sessiz</span>' : ''}</div>
        <div class="aud" style="${a.muted ? 'opacity:.4' : ''}">${waveDiv(a, k / spd(a), a.trimIn)}<div class="svgw"></div></div>
        <div class="eh l" data-edge="l" title="Sürükle: baştan kırp"></div><div class="eh r" data-edge="r" title="Sürükle: uzat / kısalt"></div>
      </div>`;
    });
    h += '</div>';
  }
  if (VIEW === 'project'){
    h += `<div class="track strack" data-scrub="1"><div class="tlabel" title="Altyazı">${ICON.text}</div>`;
    P.cues.forEach((c, i) => {
      if (isTextCue(c)) return;
      h += `<div class="blk s ${multi.has('s:' + c.id) ? 'sel' : ''}" data-cue="${i}" data-cid="${c.id}" style="left:${LABEL + c.start * k}px;width:${Math.max(2, (c.end - c.start) * k - 1)}px" title="${esc(c.text)}">${esc(c.text)}${CUE_EDGES}</div>`;
    });
    h += '</div>';
  }
  h += '<div id="playhead"></div><div id="bladeLine"></div><div id="snapLine"></div><div id="hoverLine"></div>';
  inner.innerHTML = h;
  inner.querySelectorAll('.blk.v').forEach(b => {
    const c = P.clips.find(x => x.id === b.dataset.clip), aud = b.querySelector('.aud');
    if (c && c.hasAudio) aud.querySelector('.svgw').outerHTML = fadeSvg(c, clipLen(c), b.clientWidth, aud.clientHeight, `data-envc="${c.id}"`, +b.dataset.off, k);
  });
  inner.querySelectorAll('.blk.o').forEach(b => {
    const o = P.overlays.find(x => x.id === b.dataset.ov), aud = b.querySelector('.aud');
    if (o && o.hasAudio) aud.querySelector('.svgw').outerHTML = fadeSvg(o, clipLen(o), b.clientWidth, aud.clientHeight, `data-envo="${o.id}"`, 0, k);
  });
  inner.querySelectorAll('.blk.a').forEach(b => {
    const a = P.audios.find(x => x.id === b.dataset.aud), aud = b.querySelector('.aud');
    if (a) aud.querySelector('.svgw').outerHTML = fadeSvg(a, audioLen(a), b.clientWidth, aud.clientHeight, `data-enva="${a.id}"`, 0, k);
  });
  updatePlayhead();
}
function updatePlayhead(){
  const ph = $('playhead'); if (!ph) return;
  const x = LABEL + T * curPps; ph.style.left = x + 'px';
  if (playing){
    const sc = $('tlScroll');
    if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft + LABEL) sc.scrollLeft = x - LABEL - 20;
  }
}
function timeFromX(clientX){
  const r = $('tlInner').getBoundingClientRect();
  return clamp((clientX - r.left - LABEL) / curPps, 0, TOTAL);
}
let ppsLock = null;   // sürükleme boyunca ölçek sabit kalsın (proje süresi değişse de)
function dragPointer(el, e, move, up){
  el.setPointerCapture(e.pointerId);
  ppsLock = curPps;
  // bırakma olayı kaçarsa (iptal, yakalama kaybı, düğme bırakılmış) sürükleme açık kalmasın
  let done = false;
  const end = ev => {
    if (done) return; done = true;
    el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end); el.removeEventListener('lostpointercapture', end);
    if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    ppsLock = null; up && up(ev);
  };
  const mv = ev => { if (ev.buttons === 0){ end(ev); return; } move(ev); };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
}
function envOwner(svg){
  if (svg.dataset.envc){ const c = P.clips.find(x => x.id === svg.dataset.envc); return c && {item: c, isClip: true}; }
  if (svg.dataset.enva){ const a = P.audios.find(x => x.id === svg.dataset.enva); return a && {item: a, isClip: false}; }
  if (svg.dataset.envo){ const o = P.overlays.find(x => x.id === svg.dataset.envo); return o && {item: o, isClip: true, isOv: true}; }
}
function showTip(x, y, txt){ const t = $('envTip'); t.style.display = 'block'; t.style.left = (x + 12) + 'px'; t.style.top = (y - 26) + 'px'; t.textContent = txt; }
function hideTip(){ $('envTip').style.display = 'none'; }
$('tlInner').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const tm = e.target.closest('[data-tmute]');
  if (tm){ e.stopPropagation(); if (!tm.disabled) toggleTrackMute(tm.dataset.tmute); return; }
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  // kesme aracı: tıklanan klibi / sesi (ve grubunu) o noktadan kes
  if (tool === 'blade'){
    const b = e.target.closest('[data-clip],[data-aud],[data-ov]');
    if (b){ cutItems([keyOfEl(b)], bladeTime(e.clientX)); }
    else if (e.target.closest('[data-scrub]')) seek(timeFromX(e.clientX));
    return;
  }
  // ⇧/⌘ ile tıklama her yerde çoklu seçime ekler/çıkarır (tutamaçlar dahil)
  if (additive){
    const b = e.target.closest(BLK_SEL);
    if (b){ const k = keyOfEl(b); selectItem(k[0], k.slice(2), true); refresh(); return; }
  }
  // kenar tutamacı: klibi / sesi baştan veya sondan kırp, uzat
  const edge = e.target.closest('[data-edge]');
  if (edge){
    e.stopPropagation(); pause();
    const blk = edge.parentElement, side = edge.dataset.edge, x0 = e.clientX, inner = $('tlInner');
    if (blk.dataset.efx){
      const x = P.effects.find(q => q.id === blk.dataset.efx); if (!x) return;
      const s0 = x.start, e0 = x.start + x.len, pts = snapPoints(new Set(['e:' + x.id]));
      multi = new Set(['e:' + x.id]); setPrimary('e:' + x.id);
      dragPointer(inner, e, ev => {
        let d = (ev.clientX - x0) / curPps;
        const sn = snapDelta([side === 'l' ? s0 + d : e0 + d], pts); d += sn.d;
        if (side === 'l'){ x.start = clamp(s0 + d, 0, e0 - 0.2); x.len = e0 - x.start; } else x.len = Math.max(0.2, e0 + d - s0);
        relayout(); renderTimeline(); showSnap(sn.at); showTip(ev.clientX, ev.clientY, fmt(x.len));
      }, () => { hideTip(); showSnap(null); refresh(); });
      return;
    }
    if (blk.dataset.cid){
      // altyazı satırı komşusuna taşamaz; metin öğeleri serbest
      const c = P.cues.find(x => x.id === blk.dataset.cid); if (!c) return;
      const s0 = c.start, e0 = c.end, w0 = c.words.map(w => [w.s, w.e]), pts = snapPoints(new Set(['s:' + c.id]));
      const subs = isTextCue(c) ? [] : subsOnly().filter(x => x !== c);
      const lo = Math.max(0, ...subs.filter(x => x.end <= s0 + 1e-6).map(x => x.end));
      const hi = Math.min(Infinity, ...subs.filter(x => x.start >= e0 - 1e-6).map(x => x.start));
      multi = new Set(['s:' + c.id]); setPrimary('s:' + c.id);
      dragPointer(inner, e, ev => {
        let d = (ev.clientX - x0) / curPps;
        const sn = snapDelta([side === 'l' ? s0 + d : e0 + d], pts); d += sn.d;
        if (side === 'l') c.start = clamp(s0 + d, lo, e0 - 0.2); else c.end = clamp(e0 + d, s0 + 0.2, hi);
        const f = (c.end - c.start) / (e0 - s0);   // kelime zamanlarını yeni süreye orantılı yay
        c.words.forEach((w, j) => { w.s = c.start + (w0[j][0] - s0) * f; w.e = c.start + (w0[j][1] - s0) * f; });
        relayout(); renderTimeline(); showSnap(sn.at);
        showTip(ev.clientX, ev.clientY, fmt(c.end - c.start));
      }, () => { hideTip(); showSnap(null); P.cues.sort((x, y) => x.start - y.start); selCue = P.cues.indexOf(c); refresh(); });
      return;
    }
    if (blk.dataset.ov){
      const o = P.overlays.find(x => x.id === blk.dataset.ov); if (!o) return;
      const s0 = o.start, i0 = o.in, o0 = o.out, pts = snapPoints(new Set(['o:' + o.id]));
      selOv = o.id; inspMode = 'overlay';
      dragPointer(inner, e, ev => {
        let d = (ev.clientX - x0) / curPps;
        const sn = snapDelta([side === 'l' ? s0 + d : s0 + (o0 - i0) / spd(o) + d], pts); d += sn.d;
        const sp = spd(o);
        if (side === 'l'){ d = clamp(d, -Math.min(i0 / sp, s0), (o0 - i0) / sp - 0.1); o.start = s0 + d; o.in = i0 + d * sp; }
        else o.out = clamp(o0 + d * sp, i0 + 0.1, o.dur);
        relayout(); renderTimeline(); showSnap(sn.at);
        showTip(ev.clientX, ev.clientY, fmt(clipLen(o)));
      }, () => { hideTip(); showSnap(null); refresh(); seek(T); });
      return;
    }
    if (blk.dataset.aud){
      const a = P.audios.find(x => x.id === blk.dataset.aud); if (!a) return;
      const s0 = a.start, t0 = a.trimIn, l0 = audioLen(a), pts = snapPoints(new Set(['a:' + a.id]));
      selAud = a.id; inspMode = 'audio';
      dragPointer(inner, e, ev => {
        let d = (ev.clientX - x0) / curPps;
        const sn = snapDelta([side === 'l' ? s0 + d : s0 + l0 + d], pts); d += sn.d;
        if (side === 'l'){ d = clamp(d, -Math.min(t0 / spd(a), s0), l0 - 0.1); a.start = s0 + d; a.trimIn = t0 + d * spd(a); a.len = l0 - d; }
        else a.len = clamp(l0 + d, 0.1, audioMax(a));
        relayout(); renderTimeline(); showSnap(sn.at);
        showTip(ev.clientX, ev.clientY, `${fmt(audioLen(a))}${!a.loop && side === 'r' && a.len >= audioMax(a) - 0.01 ? ' (dosya sonu)' : ''}`);
      }, () => { hideTip(); showSnap(null); refresh(); syncAudio(true); });
    } else if (blk.dataset.clip){
      const c = P.clips.find(x => x.id === blk.dataset.clip); if (!c) return;
      const i0 = c.in, o0 = c.out, g0 = c.gap || 0, ci = P.clips.indexOf(c), nx = P.clips[ci + 1], ng0 = nx ? (nx.gap || 0) : 0;
      const o = L.find(x => x.c === c), st0 = o.t0;
      // mıknatıs açıkken sonraki klipler kırpmayla birlikte kayar: eski konumlarına yapışılmasın
      const pts = snapPoints(new Set(P.clips.filter((x, j) => x === c || (OPT.magnet && j > ci)).map(x => 'c:' + x.id)));
      const to0 = trOf(ci), e0 = st0 + o.len - (to0 ? to0.d / 2 : 0);   // klibin görünen bitişi
      sel = c.id; inspMode = 'clip';
      dragPointer(inner, e, ev => {
        let d = (ev.clientX - x0) / curPps;
        let sn = {d: 0, at: null};
        if (side === 'l'){
          const sp = spd(c);
          if (!OPT.magnet){ sn = snapDelta([st0 + d], pts); d += sn.d; d = clamp(d, -Math.min(g0, i0 / sp), (o0 - i0) / sp - 0.1); c.in = i0 + d * sp; c.gap = g0 + d; }
          else { sn = snapDelta([e0 - d], pts); d -= sn.d; c.in = clamp(i0 + d * sp, 0, c.out - 0.1); }   // başlangıç sabit, bitiş kayar
        } else {
          sn = snapDelta([e0 + d], pts); d += sn.d;
          c.out = clamp(o0 + d * spd(c), c.in + 0.1, c.dur);
          if (!OPT.magnet && nx) nx.gap = Math.max(0, ng0 - (c.out - o0) / spd(c));   // sonrakiler mümkünse yerinde kalsın
        }
        relayout(); renderTimeline(); showSnap(sn.at);
        showTip(ev.clientX, ev.clientY, fmt(clipLen(c)));
      }, () => { hideTip(); showSnap(null); refresh(); seek(T); });
    }
    return;
  }
  // fade tutamacı (köşe yuvarlakları) veya ses seviyesi çizgisi
  const fh = e.target.closest('.fade-h'), line = e.target.closest('.env-hit');
  if (fh || line){
    e.stopPropagation();
    const svg = (fh || line).ownerSVGElement, own = envOwner(svg); if (!own) return;
    const it = own.item, aud = svg.parentElement, r = aud.getBoundingClientRect();
    const len = own.isClip ? clipLen(it) : audioLen(it), k = +svg.dataset.k || curPps, off = +svg.dataset.off || 0;
    const attr = own.isOv ? `data-envo="${it.id}"` : own.isClip ? `data-envc="${it.id}"` : `data-enva="${it.id}"`;
    const which = fh && fh.dataset.h;
    if (own.isOv){ selOv = it.id; inspMode = 'overlay'; inspTab = 'audio'; } else if (own.isClip){ sel = it.id; inspMode = 'clip'; inspTab = 'audio'; } else { selAud = it.id; inspMode = 'audio'; }
    dragPointer(aud, e, ev => {
      const t = clamp(ev.clientX - r.left, 0, r.width) / k + off;
      if (which === 'in'){ it.fadeIn = Math.round(clamp(t, 0, len - (it.fadeOut || 0)) * 20) / 20; showTip(ev.clientX, ev.clientY, `Aç: ${it.fadeIn.toFixed(2)} sn`); }
      else if (which === 'out'){ it.fadeOut = Math.round(clamp(len - t, 0, len - (it.fadeIn || 0)) * 20) / 20; showTip(ev.clientX, ev.clientY, `Kapat: ${it.fadeOut.toFixed(2)} sn`); }
      else { it.vol = Math.round(envV(clamp(ev.clientY - r.top, 0, r.height), r.height) * 100) / 100; showTip(ev.clientX, ev.clientY, `%${Math.round(it.vol * 100)}`); }
      aud.querySelector('svg').outerHTML = fadeSvg(it, len, r.width, r.height, attr, off, k);
      syncVideos(false); syncAudio(false);
    }, () => { hideTip(); refresh(); });
    return;
  }
  const badge = e.target.closest('[data-trb]');
  if (badge){ focusTransition(+badge.dataset.trb); return; }
  // geçiş kutusu: tıkla = seç; kenarını sürükle = süreyi değiştir
  const trov = e.target.closest('[data-trov]');
  if (trov){
    const i = +trov.dataset.trov, hnd = e.target.closest('[data-trh]'), raw = P.clips[i] && P.clips[i].tr;
    if (hnd && raw){
      pause(); selTr = i; inspMode = 'trans';
      const x0 = e.clientX, d0 = trOf(i) ? trOf(i).d : raw.d, side = hnd.dataset.trh;
      const maxD = Math.min(3, clipLen(P.clips[i]) / 2 + clipLen(P.clips[i + 1]) / 2);
      trov.classList.add('sel');
      dragPointer($('tlInner'), e, ev => {
        const dx = (ev.clientX - x0) / curPps;
        raw.d = clamp(Math.round((d0 + (side === 'r' ? 2 : -2) * dx) * 20) / 20, 0.1, maxD); P.defTr.d = raw.d;
        relayout(); renderTimeline();
        showTip(ev.clientX, ev.clientY, `${trName(raw.type)}: ${(trOf(i) ? trOf(i).d : raw.d).toFixed(2)} sn`);
      }, () => { hideTip(); refresh(); });
      return;
    }
    focusTransition(i); return;
  }
  // çoklu seçim: seçili öğelerden birini sürükleyince hepsi birlikte taşınır
  const anyBlk = e.target.closest(BLK_SEL);
  if (anyBlk && multi.size > 1){
    const key = keyOfEl(anyBlk);
    if (multi.has(key)){ startMultiDrag(e, key); return; }
  }
  // video katmanı: yatayda zaman, dikeyde katman; ana ize bırakınca ana ize geçer
  const eblk = e.target.closest('.blk.e');
  if (eblk){
    const x = P.effects.find(q => q.id === eblk.dataset.efx); if (!x) return;
    const x0 = e.clientX, s0 = x.start, pts = snapPoints(new Set(['e:' + x.id]));
    multi = new Set(['e:' + x.id]); setPrimary('e:' + x.id);
    let moved = false;
    dragPointer($('tlInner'), e, ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return;
      if (!moved){ moved = true; pause(); }
      let d = (ev.clientX - x0) / curPps;
      const sn = snapDelta([s0 + d, s0 + d + x.len], pts); d += sn.d;
      x.start = Math.max(0, s0 + d);
      relayout(); renderTimeline(); showSnap(sn.at); showTip(ev.clientX, ev.clientY, fmt(x.start));
    }, () => { hideTip(); showSnap(null); refresh(); if (!moved) seek(T); });
    return;
  }
  const oblk = e.target.closest('.blk.o');
  if (oblk){
    const o = P.overlays.find(x => x.id === oblk.dataset.ov); if (!o) return;
    const x0 = e.clientX, y0 = e.clientY, s0 = o.start, pts = snapPoints(new Set(['o:' + o.id]));
    const others = P.overlays.filter(x => x !== o), maxOther = others.length ? Math.max(...others.map(x => x.track ?? 0)) : -1;
    let moved = false, toMain = false;
    dragPointer($('tlInner'), e, ev => {
      if (Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > 6) moved = true;
      if (!moved) return;
      if (playing) pause();
      let d = (ev.clientX - x0) / curPps;
      const sn = snapDelta([s0 + d, s0 + clipLen(o) + d], pts); d = Math.max(-s0, d + sn.d);
      const vt = $('vtrack').getBoundingClientRect();
      toMain = VIEW !== 'project' && ev.clientY >= vt.top && ev.clientY < vt.bottom;
      o.start = s0 + d;
      if (!toMain) o.track = clamp(ovTrackAtY(ev.clientY), 0, maxOther + 1);
      relayout(); renderTimeline(); showSnap(sn.at);
      if (toMain){ const dp = $('dropPos'), i = dropIndexAt(ev.clientX); if (dp){ dp.style.left = (LABEL + (i < L.length ? L[i].t0 : VEND) * curPps) + 'px'; dp.style.display = 'block'; } }
      showTip(ev.clientX, ev.clientY, toMain ? 'Ana ize taşı' : `${tc(o.start, outFps())} · ${(o.track ?? 0) + 1}. katman`);
    }, ev => {
      hideTip(); showSnap(null);
      if (moved && toMain){ overlayToClip(o, dropIndexAt(ev.clientX)); refresh(); seek(T); return; }
      if (!moved){ selectItem('o', o.id, additive); refresh(); if (!additive) seek(timeFromX(ev.clientX)); return; }
      if (ovOverlaps(o)) o.track = freeTrackIn(P.overlays, o, clipLen);
      multi = new Set(groupKeys('o:' + o.id)); setPrimary('o:' + o.id);
      refresh(); seek(T);
    });
    return;
  }
  // ses: başlığından veya gövdesinden sürükle → yatayda zaman, dikeyde iz (katman) değiştir
  const ablk = e.target.closest('.blk.a');
  if (ablk){
    const a = P.audios.find(x => x.id === ablk.dataset.aud); if (!a) return;
    const x0 = e.clientX, y0 = e.clientY;
    const movers = (a.gid ? P.audios.filter(x => x.gid === a.gid) : [a]).map(x => ({x, s0: x.start, tr0: x.track ?? 0}));
    const minS = Math.min(...movers.map(m => m.s0)), pts = snapPoints(new Set(movers.map(m => 'a:' + m.x.id)));
    const edgesT = movers.flatMap(m => [m.s0, m.s0 + audioLen(m.x)]);
    const tr = trackLimits(movers.map(m => m.x), a.track ?? 0);
    let moved = false;
    dragPointer($('tlInner'), e, ev => {
      if (Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > 6) moved = true;
      if (!moved) return;
      if (playing) pause();
      let d = (ev.clientX - x0) / curPps;
      const sn = snapDelta(edgesT.map(t => t + d), pts); d = Math.max(-minS, d + sn.d);
      const dt = clamp(trackAtY(ev.clientY) - tr.base, tr.min, tr.max);
      movers.forEach(m => { m.x.start = m.s0 + d; m.x.track = m.tr0 + dt; });
      relayout(); renderTimeline(); showSnap(sn.at);
      showTip(ev.clientX, ev.clientY, `${tc(a.start, outFps())} · ${a.track + 1}. ses izi`);
    }, () => {
      hideTip(); showSnap(null);
      if (moved) settleTracks(movers.map(m => m.x));
      if (!moved || !multi.has('a:' + a.id)) selectItem('a', a.id, !moved && additive);
      refresh(); syncAudio(true);
    });
    return;
  }
  const clip = e.target.closest('[data-clip]');
  if (clip){
    // tıkla = seç; sürükle = sırasını değiştir
    const id = clip.dataset.clip, x0 = e.clientX, left0 = clip.offsetLeft, dp = $('dropPos');
    const cc = P.clips.find(c => c.id === id), ci = P.clips.indexOf(cc), nx = P.clips[ci + 1];
    const g0 = cc.gap || 0, ng0 = nx ? (nx.gap || 0) : 0, oc = L.find(o => o.c === cc), pts = snapPoints(new Set(['c:' + id]));
    let moving = false;
    const y0 = e.clientY;
    let toOv = false;
    const grabT = timeFromX(x0) - oc.t0;   // klibin neresinden tutuldu
    // sürüklenen klibin ortası, diğer kliplerin (sıkıştırılmış dizilişteki) ortalarıyla karşılaştırılır
    const liveIndex = cx => {
      const center = timeFromX(cx) - grabT + oc.len / 2;
      let t = 0, idx = 0;
      for (const o of L){ if (o.c === cc) continue; if (t + o.len / 2 < center) idx++; t += o.len; }
      return idx;
    };
    const follow = cx => { const el = $('tlInner').querySelector(`[data-clip="${id}"]`); if (el){ el.style.left = (LABEL + (timeFromX(cx) - grabT) * curPps) + 'px'; el.classList.add('dragging'); } };
    dragPointer($('tlInner'), e, ev => {
      if (!moving && Math.abs(ev.clientX - x0) < 5 && Math.abs(ev.clientY - y0) < 8) return;
      if (!moving){ moving = true; pause(); clip.classList.add('dragging'); }
      toOv = !cc.scene && ev.clientY < $('vtrack').getBoundingClientRect().top;
      if (toOv){
        const el = $('tlInner').querySelector(`[data-clip="${id}"]`) || clip;   // canlı sıralama sonrası öğe yeniden çizilmiş olabilir
        el.style.left = (LABEL + (timeFromX(ev.clientX) - grabT) * curPps) + 'px'; el.style.transform = `translateY(${ev.clientY - y0}px)`; el.classList.add('dragging');
        const dp = $('dropPos'); if (dp) dp.style.display = 'none';
        showTip(ev.clientX, ev.clientY, `Katmana taşı · ${tc(Math.max(0, oc.t0 + (ev.clientX - x0) / curPps), outFps())}`);
        return;
      }
      { const el = $('tlInner').querySelector(`[data-clip="${id}"]`); if (el) el.style.transform = ''; }
      if (!OPT.magnet){
        // serbest konum: önündeki boşluğu değiştir, sonraki klip yerinde kalsın
        let d = (ev.clientX - x0) / curPps;
        const sn = snapDelta([oc.t0 + d, oc.t0 + oc.len + d], pts); d += sn.d;
        // sola: kendi boşluğu kadar; sağa: önce sonraki klibin önündeki boşluğu kullanır, bitince sonrakileri iter
        d = Math.max(d, -g0);
        cc.gap = g0 + d; if (nx) nx.gap = Math.max(0, ng0 - d);
        relayout(); renderTimeline(); showSnap(sn.at);
        showTip(ev.clientX, ev.clientY, tc(oc.t0 + d, outFps()));
        return;
      }
      // canlı: hedef değiştikçe sıra hemen değişir, diğer klipler kayıp yer açar; tutulan klip imleci izler
      const want = liveIndex(ev.clientX), from = P.clips.indexOf(cc);
      if (want !== from){ P.clips.splice(from, 1); P.clips.splice(want, 0, cc); relayout(); renderTimeline(); }
      follow(ev.clientX);
      showTip(ev.clientX, ev.clientY, `${P.clips.indexOf(cc) + 1}. sıra`);
    }, ev => {
      hideTip(); showSnap(null);
      if (!moving){ selectItem('c', id, additive); refresh(); if (!additive) seek(timeFromX(ev.clientX)); return; }
      if (toOv){
        const st = Math.max(0, oc.t0 + (ev.clientX - x0) / curPps), nOv = P.overlays.length ? Math.max(...P.overlays.map(o => o.track ?? 0)) + 1 : 0;
        clipToOverlay(cc, st, clamp(ovTrackAtY(ev.clientY), 0, nOv)); refresh(); seek(T); return;
      }
      selectItem('c', id, false);
      refresh(); if (OPT.magnet) seek(L.find(o => o.c.id === id)?.t0 ?? T);
    });
    return;
  }
  const cue = e.target.closest('[data-cue]');
  if (cue){
    const c = P.cues.find(x => x.id === cue.dataset.cid); if (!c) return;
    const x0 = e.clientX, s0 = c.start, e0 = c.end, w0 = c.words.map(w => [w.s, w.e]), pts = snapPoints(new Set(['s:' + c.id]));
    const subs = isTextCue(c) ? [] : subsOnly().filter(x => x !== c);
    let moved = false;
    multi = new Set(['s:' + c.id]); setPrimary('s:' + c.id);
    dragPointer($('tlInner'), e, ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return;
      if (!moved){ moved = true; pause(); }
      let d = (ev.clientX - x0) / curPps;
      const sn = snapDelta([s0 + d, e0 + d], pts); d += sn.d;
      d = Math.max(d, -s0);
      // altyazı: önündeki ve arkasındaki satırın arasında kalır
      const prev = subs.filter(x => x.end <= s0 + 1e-6).reduce((m, x) => Math.max(m, x.end), 0);
      const next = subs.filter(x => x.start >= e0 - 1e-6).reduce((m, x) => Math.min(m, x.start), Infinity);
      if (subs.length) d = clamp(d, prev - s0, next - e0);
      c.start = s0 + d; c.end = e0 + d; c.words.forEach((w, j) => { w.s = w0[j][0] + d; w.e = w0[j][1] + d; });
      relayout(); renderTimeline(); showSnap(sn.at); showTip(ev.clientX, ev.clientY, tc(c.start, outFps()));
    }, () => {
      hideTip(); showSnap(null);
      P.cues.sort((x, y) => x.start - y.start); selCue = P.cues.indexOf(c);
      refresh();   // seçmek oynatma kafasını taşımaz
    });
    return;
  }
  if (e.target.closest('.tlabel')) return;
  const inner = $('tlInner');
  const scrubTo = cx => { const t = timeFromX(cx), pts = snapPoints().slice(2), sn = snapDelta([t], pts); seek(t + sn.d); showSnap(sn.at); };
  // cetvel: oynatma kafasını sürükle
  if (e.target.closest('.ruler')){
    hoverT = null; scrubTo(e.clientX);
    dragPointer(inner, e, ev => scrubTo(ev.clientX), () => showSnap(null));
    return;
  }
  // boş alan: basıp sürükleyince seçim kutusu (masaüstündeki gibi); sadece tıklayınca seçimi kaldır + oynatma kafasını taşı
  const ir = inner.getBoundingClientRect(), sx = e.clientX - ir.left, sy = e.clientY - ir.top;
  const base = additive ? new Set(multi) : new Set();
  let box = null, moved = false, hits = new Set(base);
  dragPointer(inner, e, ev => {
    const r = inner.getBoundingClientRect(), cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    if (!moved && Math.hypot(cx - sx, cy - sy) < 4) return;
    if (!moved){ moved = true; pause(); box = document.createElement('div'); box.id = 'marquee'; inner.appendChild(box); }
    Object.assign(box.style, {left: Math.min(sx, cx) + 'px', top: Math.min(sy, cy) + 'px', width: Math.abs(cx - sx) + 'px', height: Math.abs(cy - sy) + 'px'});
    const br = box.getBoundingClientRect();
    hits = new Set(base);
    const blocks = inner.querySelectorAll('.blk.v, .blk.a, .blk.o, .blk.s, .blk.e');
    blocks.forEach(b => {
      const q = b.getBoundingClientRect(), key = keyOfEl(b);
      if (q.left < br.right && q.right > br.left && q.top < br.bottom && q.bottom > br.top) groupKeys(key).forEach(x => hits.add(x));
    });
    blocks.forEach(b => b.classList.toggle('sel', hits.has(keyOfEl(b))));
  }, ev => {
    if (box) box.remove();
    if (!moved){
      if (!additive && inspMode !== 'project'){ multi.clear(); inspMode = 'project'; refresh(); }
      hoverT = null; scrubTo(ev.clientX); showSnap(null); return;
    }
    multi = hits;
    const keys = [...hits], kc = keys.find(k => k[0] === 'c') || keys[0];
    if (!kc) inspMode = 'project'; else setPrimary(kc);
    refresh();
  });
});
$('tlInner').addEventListener('dblclick', e => {
  const sb = e.target.closest('.blk.scn');
  if (sb){ const b = P.clips.find(x => x.id === sb.dataset.clip); if (b) openView(b.scene); return; }
  const fh = e.target.closest('.fade-h'), line = e.target.closest('.env-hit');
  if (!fh && !line) return;
  const own = envOwner((fh || line).ownerSVGElement); if (!own) return;
  if (fh) own.item[fh.dataset.h === 'in' ? 'fadeIn' : 'fadeOut'] = 0; else own.item.vol = 1;
  refresh();
});
// Otomatik yakalama: klip/ses/altyazı kenarları ve oynatma kafası
function snapPoints(exclude = new Set()){
  const pts = [0, T];
  for (const o of L){ if (exclude.has('c:' + o.c.id)) continue; const ti = trOf(o.i - 1), to = trOf(o.i);
    pts.push(o.t0 + (ti ? ti.d / 2 : 0), o.t0 + o.len - (to ? to.d / 2 : 0)); }
  for (const a of P.audios){ if (exclude.has('a:' + a.id)) continue; pts.push(a.start, a.start + audioLen(a)); }
  for (const o of P.overlays){ if (exclude.has('o:' + o.id)) continue; pts.push(o.start, o.start + clipLen(o)); }
  for (const c of P.cues){ if (exclude.has('s:' + c.id)) continue; pts.push(c.start, c.end); }
  for (const x of P.effects){ if (!exclude.has('e:' + x.id)) pts.push(x.start, x.start + x.len); }
  return pts;
}
// t değerlerinden herhangi biri bir noktaya yakınsa gereken kaydırmayı döndürür
function snapDelta(ts, pts){
  if (!OPT.snap) return {d: 0, at: null};
  const tol = 9 / curPps; let best = null;
  for (const t of ts) for (const p of pts){ const d = p - t; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = {d, at: p}; }
  return best || {d: 0, at: null};
}
function showSnap(at){ const el = $('snapLine'); if (!el) return; if (at == null){ el.style.display = 'none'; return; } el.style.left = (LABEL + at * curPps) + 'px'; el.style.display = 'block'; }
function bladeTime(clientX){
  const t = timeFromX(clientX);
  if (!OPT.snap) return Math.abs(t - T) * curPps < 8 ? T : t;
  const s = snapDelta([t], snapPoints()); return t + s.d;
}
$('tlInner').addEventListener('pointermove', e => {
  const bl = $('bladeLine'); if (!bl) return;
  if (tool !== 'blade' || !e.target.closest('[data-clip],[data-aud]')){ bl.style.display = 'none'; return; }
  bl.style.left = (LABEL + bladeTime(e.clientX) * curPps) + 'px'; bl.style.display = 'block';
});
$('tlInner').addEventListener('pointerleave', () => { const bl = $('bladeLine'); if (bl) bl.style.display = 'none'; endHover(); });
// Önizleme ekseni: fareyi gezdirince oynatıcı o kareyi gösterir (oynatma kafası yerinde kalır)
let lastScrub = 0;
$('tlInner').addEventListener('pointermove', e => {
  const hl = $('hoverLine');
  if (!OPT.axis || playing || e.buttons || tool === 'blade' || !L.length || e.target.closest('.tlabel')){ if (hoverT != null) endHover(); return; }
  const t = Math.round(timeFromX(e.clientX) * outFps()) / outFps();
  if (t === hoverT) return;
  hoverT = t;
  if (hl){ hl.style.left = (LABEL + t * curPps) + 'px'; hl.style.display = 'block'; }
  syncVideos(true, t);
  if (OPT.axisAudio && performance.now() - lastScrub > 120){
    lastScrub = performance.now();
    for (const o of activeAt(t)){ const v = media.get(o.c.id); if (!v) continue; v.volume = clamp(gainAt(o, t - o.t0), 0, 1); v.play().catch(() => {}); setTimeout(() => { if (!playing) v.pause(); }, 110); }
  }
});
function endHover(){
  if (hoverT == null) return;
  hoverT = null; const hl = $('hoverLine'); if (hl) hl.style.display = 'none';
  if (!playing){ for (const el of media.values()) el.pause(); syncVideos(true); draw(); }
}
/* ---- Seçili öğeleri birlikte taşıma ---- */
function beginMultiMove(withClips){
  const selC = new Set(withClips ? P.clips.filter(c => multi.has('c:' + c.id)) : []);
  const selA = [...P.audios.filter(a => multi.has('a:' + a.id)), ...P.overlays.filter(o => multi.has('o:' + o.id))];
  const t0 = L.map(o => o.t0), e = L.map((o, i) => { const tr = trOf(i); return o.t0 + o.len - (tr ? tr.d : 0); });
  let dMin = -Infinity;
  // sola en fazla: seçili bloğun önündeki boşluk kadar; seslerde 0'a kadar
  P.clips.forEach((c, i) => { if (selC.has(c) && (i === 0 || !selC.has(P.clips[i - 1]))) dMin = Math.max(dMin, -(c.gap || 0)); });
  selA.forEach(a => dMin = Math.max(dMin, -a.start));
  return {selC, selA, t0, e, dMin, a: selA.map(a => a.start), origT0: new Map(L.map(o => [o.c.id, o.t0]))};
}
// mıknatıs kapalı: seçili klipler d kadar kayar, önlerindekiler gerekirse itilir, aralar boşluk (gap) olur
function applyMultiMove(m, d){
  d = Math.max(d, m.dMin);
  let prevE = 0;
  P.clips.forEach((c, i) => {
    const len = clipLen(c), trd = m.t0[i] + len - m.e[i];
    const t0 = m.selC.has(c) ? Math.max(prevE, m.t0[i] + d) : Math.max(m.t0[i], prevE);
    c.gap = Math.max(0, t0 - prevE);
    prevE = t0 + len - trd;
  });
  m.selA.forEach((a, j) => a.start = Math.max(0, m.a[j] + d));
  return d;
}
function reorderBlockTarget(clientX, selC){
  const t = timeFromX(clientX), others = L.filter(o => !selC.has(o.c));
  let idx = others.findIndex(o => t < o.t0 + o.len / 2);
  if (idx < 0) idx = others.length;
  const x = LABEL + (idx < others.length ? others[idx].t0 : (others.length ? others[others.length - 1].t0 + others[others.length - 1].len : 0)) * curPps;
  return {idx, x};
}
function startMultiDrag(e, primary){
  const inner = $('tlInner'), x0 = e.clientX;
  const blockMode = OPT.magnet && primary[0] === 'c';            // mıknatıs açık + klip sürükleniyor → sırayı değiştir
  const m = beginMultiMove(!OPT.magnet || primary[0] === 'c');   // mıknatıs açıkken ses sürüklenirse yalnızca sesler kayar
  const pts = snapPoints(new Set(multi));
  const edges = [...L.filter(o => m.selC.has(o.c)).flatMap(o => { const ti = trOf(o.i - 1), to = trOf(o.i); return [o.t0 + (ti ? ti.d / 2 : 0), o.t0 + o.len - (to ? to.d / 2 : 0)]; }),
                 ...m.selA.flatMap(a => [a.start, a.start + (P.overlays.includes(a) ? clipLen(a) : audioLen(a))])];
  const selS = P.cues.filter(c => multi.has('s:' + c.id)).map(c => ({c, s: c.start, e: c.end, w: c.words.map(w => [w.s, w.e])}));
  selS.forEach(x => { m.dMin = Math.max(m.dMin, -x.s); edges.push(x.s, x.e); });
  const selE = P.effects.filter(x => multi.has('e:' + x.id)).map(x => ({x, s: x.start}));
  selE.forEach(q => { m.dMin = Math.max(m.dMin, -q.s); edges.push(q.s, q.s + q.x.len); });
  const moveCues = d => { selS.forEach(x => { x.c.start = x.s + d; x.c.end = x.e + d; x.c.words.forEach((w, j) => { w.s = x.w[j][0] + d; w.e = x.w[j][1] + d; }); });
    selE.forEach(q => q.x.start = Math.max(0, q.s + d)); };
  const els = [...inner.querySelectorAll('.blk.v, .blk.a, .blk.o, .blk.s, .blk.e')].filter(b => multi.has(keyOfEl(b))).map(b => ({b, l: b.offsetLeft}));
  const dragged = itemByKey(primary), y0 = e.clientY;
  const selAud_ = m.selA.filter(a => P.audios.includes(a)), trs0 = selAud_.map(a => a.track ?? 0);
  const tl = trackLimits(selAud_.length ? selAud_ : [{track: 0}], primary[0] === 'a' ? (dragged.track ?? 0) : 0);
  let moved = false;
  dragPointer(inner, e, ev => {
    if (!moved && Math.abs(ev.clientX - x0) < 5 && Math.abs(ev.clientY - y0) < 6) return;
    if (!moved){ moved = true; pause(); }
    if (blockMode){
      els.forEach(({b, l}) => { b.style.left = (l + ev.clientX - x0) + 'px'; b.classList.add('dragging'); });
      const {x} = reorderBlockTarget(ev.clientX, m.selC), dp = $('dropPos');
      if (dp){ dp.style.left = x + 'px'; dp.style.display = 'block'; }
      showTip(ev.clientX, ev.clientY, `${m.selC.size} klip${m.selA.length ? ` + ${m.selA.length} ses` : ''}`);
      return;
    }
    let d = (ev.clientX - x0) / curPps;
    const sn = snapDelta(edges.map(t => t + d), pts); d += sn.d;
    if (m.selC.size) d = applyMultiMove(m, d);
    else { d = Math.max(d, m.dMin); m.selA.forEach((a, j) => a.start = m.a[j] + d); }
    moveCues(d);
    if (primary[0] === 'a' && selAud_.length){   // sesi tutup sürüklerken dikeyde iz değiştir
      const dt = clamp(trackAtY(ev.clientY) - tl.base, tl.min, tl.max);
      selAud_.forEach((a, j) => a.track = trs0[j] + dt);
    }
    relayout(); renderTimeline(); showSnap(sn.at);
    showTip(ev.clientX, ev.clientY, `${d >= 0 ? '+' : ''}${d.toFixed(2)} sn`);
  }, ev => {
    hideTip(); showSnap(null);
    if (!moved){ selectItem(primary[0], primary.slice(2), false); refresh(); return; }
    if (blockMode){
      const {idx} = reorderBlockTarget(ev.clientX, m.selC);
      const moving = P.clips.filter(c => m.selC.has(c)), rest = P.clips.filter(c => !m.selC.has(c));
      rest.splice(idx, 0, ...moving); P.clips = rest;
      relayout();
      const dd = L.find(o => o.c === dragged).t0 - m.origT0.get(dragged.id);
      m.selA.forEach((a, j) => a.start = Math.max(0, m.a[j] + dd));
      moveCues(Math.max(dd, m.dMin));
    }
    if (selS.length){ const cur = P.cues[selCue]; P.cues.sort((x, y) => x.start - y.start); selCue = P.cues.indexOf(cur); }
    settleTracks(selAud_);   // başka bir sesle çakışan boş ize geçer
    m.selA.filter(o => P.overlays.includes(o)).forEach(o => { if (ovOverlaps(o)) o.track = freeTrackIn(P.overlays, o, clipLen); });
    m.selA.forEach(a => anchors.delete(a));   // bağlantı bunları ikinci kez kaydırmasın
    selS.forEach(x => anchors.delete(x.c));
    refresh(); seek(T);
  });
}
/* ---- Ses izleri (katmanlar) ---- */
// imlecin altındaki ses izi; en alttakinin altı = yeni iz
function trackAtY(clientY){
  const rows = [...document.querySelectorAll('.track.atrack')];
  if (!rows.length) return 0;
  for (const r of rows){ const q = r.getBoundingClientRect(); if (clientY >= q.top && clientY < q.bottom) return +r.dataset.tr; }
  if (clientY < rows[0].getBoundingClientRect().top) return 0;
  return +rows[rows.length - 1].dataset.tr + 1;
}
// taşınan seslerin iz kaydırma sınırları: en üst iz 0, en fazla bir yeni iz
function trackLimits(moving, base){
  const others = P.audios.filter(a => !moving.includes(a));
  const maxOther = others.length ? Math.max(...others.map(a => a.track ?? 0)) : -1;
  const lo = Math.min(...moving.map(a => a.track ?? 0));
  return {base, min: -lo, max: Math.max(maxOther + 1 - lo, 0)};
}
// bırakınca: başka bir sesle çakışan, boş bir ize geçer
function settleTracks(moving){
  moving.forEach(a => {
    const clash = P.audios.some(o => o !== a && (o.track ?? 0) === (a.track ?? 0) && o.start < a.start + audioLen(a) - 0.01 && o.start + audioLen(o) > a.start + 0.01);
    if (clash) a.track = freeTrack(a);
  });
}
// boş kalan izleri kapat
function compactTracks(){
  for (const list of [P.audios, P.overlays]){
    const used = [...new Set(list.map(a => a.track ?? 0))].sort((x, y) => x - y);
    const map = new Map(used.map((t, i) => [t, i]));
    list.forEach(a => a.track = map.get(a.track ?? 0));
  }
}
// imlecin altındaki video katmanı izi; en üsttekinin üstü = yeni katman
function ovTrackAtY(clientY){
  const rows = [...document.querySelectorAll('.track.otrack')];
  if (!rows.length) return 0;
  for (const r of rows){ const q = r.getBoundingClientRect(); if (clientY >= q.top && clientY < q.bottom) return +r.dataset.otr; }
  if (clientY < rows[0].getBoundingClientRect().top) return +rows[0].dataset.otr + (rows[0].classList.contains('empty') ? 0 : 1);
  return 0;
}
// Sürüklenen klibin bırakılacağı sıra (sürüklenen klip hariç diğer kliplere göre)
function reorderTarget(clientX, id){
  const t = timeFromX(clientX), others = L.filter(o => o.c.id !== id);
  let idx = others.findIndex(o => t < o.t0 + o.len / 2);
  if (idx < 0) idx = others.length;
  const x = LABEL + (idx < others.length ? others[idx].t0 : (others.length ? others[others.length - 1].t0 + others[others.length - 1].len : 0)) * curPps;
  return {idx, x};
}
// Kitaplıktan zaman çizelgesine sürükle-bırak
function dropIndexAt(clientX){
  const t = timeFromX(clientX);
  const i = L.findIndex(o => t < o.t0 + o.len / 2);
  return i < 0 ? L.length : i;
}
$('tlScroll').addEventListener('dragover', e => {
  if (![...e.dataTransfer.types].includes('application/x-reelix')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  const dp = $('dropPos'); if (!dp) return;
  const i = dropIndexAt(e.clientX);
  dp.style.left = (LABEL + (i < L.length ? L[i].t0 : TOTAL) * curPps) + 'px'; dp.style.display = 'block';
});
$('tlScroll').addEventListener('dragleave', e => { if (!$('tlScroll').contains(e.relatedTarget)){ const dp = $('dropPos'); if (dp) dp.style.display = 'none'; } });
$('tlScroll').addEventListener('drop', e => {
  const id = e.dataTransfer.getData('application/x-reelix'); if (!id) return;
  e.preventDefault(); e.stopPropagation();
  const it = LIB.find(x => x.id === id); if (!it) return;
  pause();
  const vt = $('vtrack').getBoundingClientRect();
  if (it.kind === 'video' && e.clientY < vt.top){ const nOv = P.overlays.length ? Math.max(...P.overlays.map(o => o.track ?? 0)) + 1 : 0; newOverlay(it, timeFromX(e.clientX), clamp(ovTrackAtY(e.clientY), 0, nOv)); }
  else if (it.kind === 'video'){ if (VIEW === 'project') newOverlay(it, timeFromX(e.clientX)); else insertClip(it, dropIndexAt(e.clientX)); }
  else addLayer(it, timeFromX(e.clientX));
  refresh(); seek(T);
});
$('tlScroll').addEventListener('wheel', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  setZoom(+$('zoom').value * Math.exp(-e.deltaY * 0.012), e.clientX);
}, {passive: false});
$('zoom').addEventListener('input', () => setZoom(+$('zoom').value));
$('zoomIn').onclick = () => setZoom(+$('zoom').value * 1.4);
$('zoomOut').onclick = () => setZoom(+$('zoom').value / 1.4);
$('zoomFit').onclick = () => setZoom(1);
window.addEventListener('resize', renderTimeline);
$('resizer').addEventListener('pointerdown', e => {
  const y0 = e.clientY, h0 = $('tl').getBoundingClientRect().height;
  dragPointer($('resizer'), e, ev => { $('work').style.setProperty('--tlh', clamp(h0 - (ev.clientY - y0), 180, window.innerHeight - 300) + 'px'); },
    () => renderTimeline());
});

/* ================= Altyazı ================= */
function readSubSettings(){
  for (const id of SUB_IDS){
    const el = $(id);
    S[id] = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? +el.value : el.value);
    const v = el.parentElement.querySelector('.v'); if (v) v.textContent = el.value;
  }
  try { localStorage.setItem('reelix-sub-style', JSON.stringify(S)); } catch (e){}
  if (!playing) draw();
}
function applySubStyle(obj){
  if (!obj) return;
  for (const id of SUB_IDS){
    if (obj[id] === undefined) continue;
    const el = $(id); if (el.type === 'checkbox') el.checked = obj[id]; else el.value = obj[id];
  }
  readSubSettings();
}
try { applySubStyle(JSON.parse(localStorage.getItem('reelix-sub-style') || 'null')); } catch (e){}
// stil denetimleri: Tümüne uygula açıkken genel stil, kapalıyken seçili satırların kendi stili
const ctrlVal = el => el.type === 'checkbox' ? el.checked : (el.type === 'range' ? +el.value : el.value);
function subTargets(){
  const cs = [...multi].filter(k => k[0] === 's').map(itemByKey).filter(Boolean);
  if (!cs.length && P.cues[selCue]) cs.push(P.cues[selCue]);
  if (isTextCue(P.cues[selCue])) return cs.filter(isTextCue);
  if ($('subAll').checked) return null;
  return cs.length ? cs : null;
}
// "Tümüne uygula" yalnızca altyazılar için; metin seçiliyken gizli
function showSubAll(on){
  const l = $('subAll').parentElement;
  l.style.display = l.nextElementSibling.style.display = on ? '' : 'none';
}
const subsOnly = () => P.cues.filter(c => !isTextCue(c));
const textsOnly = () => P.cues.filter(isTextCue);
// oynatma kafasına el ile altyazı satırı veya serbest metin ekle
function addCue(kind, tpl){
  if (kind !== 'text' && VIEW !== 'project') return;
  let start = T, c;
  if (kind === 'text'){
    c = {kind: 'text', start, end: start + 3, text: tpl ? tpl.text : 'Metin', st: {...S, posY: 50, hl: false, ...(tpl ? tpl.st : {})}};
  } else {
    const subs = subsOnly(), inside = subs.find(x => start >= x.start && start < x.end);
    if (inside) start = inside.end;
    const nxt = subs.find(x => x.start >= start - 1e-6);
    const end = Math.min(start + 2, nxt ? nxt.start : Infinity);
    if (end - start < 0.2){ toast('Oynatma kafasında yeni altyazı için boşluk yok'); return; }
    c = {start, end, text: 'Yeni altyazı'};
  }
  c.id = uid(); c.words = wordsFromText(c.text, c.start, c.end);
  P.cues.push(c); P.cues.sort((x, y) => x.start - y.start);
  multi = new Set(['s:' + c.id]); setPrimary('s:' + c.id);
  refresh();
  const ta = $('cueText'); if (ta){ ta.focus(); ta.select(); }
}
$('addText').onclick = () => addCue('text');
// metin şablonları: Metin sekmesinde yeni metin ekler; altyazı şablonu tüm altyazılara, denetçideki şablon seçili satırlara/metne uygulanır
const tplHtml = title => TEXT_TEMPLATES.map((t, i) => `<button data-tpl="${i}" title="${title}" style="font-family:'${t.st.font}';font-weight:${t.st.bold ? 700 : 400};color:${t.st.color}">${esc(t.name)}</button>`).join('');
$('tplGrid').innerHTML = tplHtml('Bu şablonla metin ekle');
$('subTplAll').innerHTML = tplHtml('Tüm altyazılara uygula');
$('subTplGrid').innerHTML = tplHtml('Seçili öğeye uygula');
const onTpl = fn => e => { const b = e.target.closest('[data-tpl]'); if (b) fn(TEXT_TEMPLATES[+b.dataset.tpl]); };
$('tplGrid').addEventListener('click', onTpl(t => addCue('text', t)));
$('subTplAll').addEventListener('click', onTpl(t => applyTemplateStyle(t, true)));
$('subTplGrid').addEventListener('click', onTpl(t => applyTemplateStyle(t, false)));
// şablonun yazı stilini uygula; konum korunur. all: tüm altyazılar (genel stil)
function applyTemplateStyle(tpl, all){
  const st = {...tpl.st}; delete st.posX; delete st.posY;
  const targets = all ? null : subTargets();
  if (!targets){
    Object.assign(S, st);
    P.cues.forEach(c => { if (c.st && !isTextCue(c)){ Object.keys(st).forEach(k => delete c.st[k]); if (!Object.keys(c.st).length) delete c.st; } });
    try { localStorage.setItem('reelix-sub-style', JSON.stringify(S)); } catch (e){}
    if (all) toast(`${tpl.name} şablonu tüm altyazılara uygulandı`);
  } else targets.forEach(c => { c.st = {...(c.st || {}), ...st}; });
  syncSubControls(); refresh();
}
$('addSub').onclick = () => addCue('sub');
const subEffective = () => ({...S, ...((P.cues[selCue] || {}).st || {})});
function onSubInput(id){
  const el = $(id), v = ctrlVal(el), out = el.parentElement.querySelector('.v');
  if (out) out.textContent = el.value;
  const targets = subTargets();
  if (!targets){
    S[id] = v;
    P.cues.forEach(c => { if (c.st && !isTextCue(c)){ delete c.st[id]; if (!Object.keys(c.st).length) delete c.st; } });
    try { localStorage.setItem('reelix-sub-style', JSON.stringify(S)); } catch (e){}
  } else targets.forEach(c => { c.st = {...(c.st || {}), [id]: v}; });
  if (!playing) draw();
}
// denetimleri seçili satırın geçerli stiliyle doldur
function syncSubControls(){
  const st = subEffective();
  for (const id of SUB_IDS){
    const el = $(id); if (el.type === 'checkbox') el.checked = st[id]; else el.value = st[id];
    const out = el.parentElement.querySelector('.v'); if (out) out.textContent = el.value;
  }
}
SUB_IDS.forEach(id => { $(id).addEventListener('input', () => onSubInput(id)); $(id).addEventListener('change', () => { trackHistory(); updateButtons(); }); });
readSubSettings();
bindRange('autoWords', () => {});

function renderSubInfo(){
  const subs = subsOnly();
  $('subInfo').textContent = subs.length
    ? `${subs.length} satır, ${fmt(subs[0].start)} ile ${fmt(subs[subs.length - 1].end)} arası`
    : 'Henüz altyazı yok. Otomatik oluştur veya SRT yükle.';
}
async function loadSubsFrom(path){
  const cues = parseSubs(await api.readText(path));
  if (!cues.length){ setStatus('subStatus', 'Dosya okunamadı. SRT veya VTT formatında bir altyazı seç.', 'err'); return; }
  P.cues = [...textsOnly(), ...cues].sort((x, y) => x.start - y.start); selCue = -1; refresh();
  setStatus('subStatus', `${basename(path)} yüklendi (${cues.length} satır). Kelime zamanları tahmini; sesten düzeltmek için yukarıdaki düğmeyi kullan.`, 'ok');
}
$('loadSrt').onclick = async () => { const [p] = await api.openFiles('subs', false); if (p) loadSubsFrom(p); };
$('saveSrt').onclick = async () => {
  const p = await api.saveFile('srt', 'altyazi.srt'); if (!p) return;
  await api.writeText(p, toSrt(P.cues));   // toSrt metin öğelerini atlar toast('SRT kaydedildi');
};
$('clearSubs').onclick = () => { if (confirm('Tüm altyazılar silinsin mi?')){ P.cues = textsOnly(); selCue = -1; refresh(); } };

/* ---- Klipleri zaman çizelgesindeki gibi zincirle (kesme → concat, geçiş → xfade / acrossfade) ---- */
function chainClips(EL, f, vLabels, aLabels, gaps = []){
  let v = null, a = null;
  for (let i = 0; i < EL.length; i++){
    // klipten önce boşluk varsa siyah + sessiz parça ekle
    if (gaps[i]){
      if (a == null){ v = gaps[i].v; a = gaps[i].a; }
      else {
        if (vLabels){ f.push(`${v}${gaps[i].v}concat=n=2:v=1:a=0[vg${i}]`); v = `[vg${i}]`; }
        f.push(`${a}${gaps[i].a}concat=n=2:v=0:a=1[ag${i}]`); a = `[ag${i}]`;
      }
    }
    if (a == null){ v = vLabels && vLabels[i]; a = aLabels[i]; continue; }
    const tr = EL[i].trIn;
    if (vLabels){
      f.push(tr ? `${v}${vLabels[i]}xfade=transition=${tr.type}:duration=${tr.d.toFixed(3)}:offset=${EL[i].t0.toFixed(3)}[vx${i}]`
                : `${v}${vLabels[i]}concat=n=2:v=1:a=0[vx${i}]`);
      v = `[vx${i}]`;
    }
    f.push(tr ? `${a}${aLabels[i]}acrossfade=d=${tr.d.toFixed(3)}:c1=tri:c2=tri[ax${i}]`
              : `${a}${aLabels[i]}concat=n=2:v=0:a=1[ax${i}]`);
    a = `[ax${i}]`;
  }
  return {v, a};
}
function envExpr(env, len){
  const pts = env.map(p => ({t: p.t * len, v: p.v}));
  let e = pts[pts.length - 1].v.toFixed(4);
  for (let i = pts.length - 2; i >= 0; i--){
    const a = pts[i], b = pts[i + 1], dt = b.t - a.t;
    const seg = dt > 1e-4 ? `${a.v.toFixed(4)}+(${(b.v - a.v).toFixed(4)})*(t-${a.t.toFixed(4)})/${dt.toFixed(4)}` : b.v.toFixed(4);
    e = `if(lt(t,${b.t.toFixed(4)}),${seg},${e})`;
  }
  return `volume='${e}':eval=frame`;
}

// Altyazı kaynağı: zaman çizelgesinde seçili video klip, sahne, video katmanı veya ses;
// seçim yoksa duyulan tüm sesler (videoların sesi + ses katmanları + katman videoların sesi; sesi kapalı olanlar hariç)
function subSourceItems(){
  return [...multi].filter(isMediaKey).map(k => ({k, it: itemByKey(k)}))
    .filter(({k, it}) => it && (k[0] === 'a' || it.hasAudio !== false));
}
function subSourceLabel(){
  const src = subSourceItems();
  if (!src.length) return audibleSources().length ? 'Kaynak: duyulan tüm sesler (sesi kapalı izler hariç)' : 'Kaynak: zaman çizelgesinde ses yok';
  return 'Kaynak: ' + (src.length === 1 ? itemName(src[0].it) : `${src.length} seçili öğe`);
}
const itemName = it => it.scene ? (sceneById(it.scene) || {}).name || 'Sahne' : it.name;
// seçili öğeleri ffmpeg ses kaynaklarına çevir; sahne bloğu seçiliyse o sahnedeki tüm video/ses/katmanlar
const clipSrc = e => ({path: e.c.path, ss: e.c.in, t: e.c.out - e.c.in, start: e.t0, len: e.len, sp: spd(e.c)});
const ovSrc = o => ({path: o.path, ss: o.in, t: o.out - o.in, start: o.start, len: clipLen(o), sp: spd(o)});
const auSrc = a => ({path: a.path, ss: a.trimIn, loop: a.loop, start: a.start, len: audioLen(a), sp: spd(a)});
function audibleSources(){
  const out = [];
  ENG.L.forEach(e => { if (e.c.hasAudio !== false && !e.c.muted && !e.mute) out.push(clipSrc(e)); });
  ENG.audios.forEach(a => { if (!a.muted) out.push(auSrc(a)); });
  ENG.overlays.forEach(o => { if (o.hasAudio !== false && !o.muted) out.push(ovSrc(o)); });
  return out;
}
function audioSources(src){
  const out = [];
  for (const {k, it} of src){
    if (k[0] === 'c' && it.scene){
      ENG.L.filter(e => e.sc === it.scene && e.c.hasAudio !== false).forEach(e => out.push(clipSrc(e)));
      ENG.audios.filter(a => a.sc === it.scene).forEach(a => out.push(auSrc(a)));
      ENG.overlays.filter(o => o.sc === it.scene && o.hasAudio !== false).forEach(o => out.push(ovSrc(o)));
    } else if (k[0] === 'c'){ const e = ENG.L.find(x => x.c === it); if (e) out.push(clipSrc(e)); }
    else if (k[0] === 'o') out.push(ovSrc(it));
    else out.push(auSrc(it));
  }
  return out;
}
// ses kaynaklarını zaman çizelgesindeki konumlarıyla tek bir 16 kHz mono akışa karıştır
async function extractSourcesAudio(src, onStatus){
  onStatus('Ses çıkarılıyor…');
  const tmp = await api.makeTemp(), outp = tmp + '/audio.f32';
  try {
    const args = [], f = [];
    let end = 0;
    if (!src.length) throw new Error('Kaynakta ses yok');
    src.forEach(({path, ss, t, loop, start, len, sp}, i) => {
      if (loop) args.push('-stream_loop', '-1');
      if (ss > 0) args.push('-ss', ss.toFixed(3));
      if (t) args.push('-t', t.toFixed(3));
      args.push('-i', path);
      end = Math.max(end, start + len);
      f.push(`[${i}:a]aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono,asetpts=PTS-STARTPTS${atempo(sp)},atrim=duration=${len.toFixed(3)}`
        + (start > 0 ? `,adelay=${Math.round(start * 1000)}:all=1` : '') + `[s${i}]`);
    });
    f.push(src.length > 1 ? `${src.map((_, i) => `[s${i}]`).join('')}amix=inputs=${src.length}:duration=longest:dropout_transition=0:normalize=0[sx]` : '[s0]anull[sx]');
    args.push('-filter_complex', f.join(';'), '-map', '[sx]', '-f', 'f32le', '-ac', '1', '-ar', '16000', outp);
    await runFfmpeg(args, end, p => onStatus(`Ses çıkarılıyor… %${Math.round(p * 100)}`));
    const u8 = new Uint8Array(await api.readFile(outp));
    return new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + (u8.byteLength & ~3)));
  } finally { api.removeDir(tmp); }
}
function extractSubAudio(onStatus){
  const sel = subSourceItems();
  return extractSourcesAudio(sel.length ? audioSources(sel) : audibleSources(), onStatus);
}
// Altyazı motoru bekçisi: bellek aşırı yükselirse, arayüz donmaya başlarsa veya motor uzun süre
// yanıt vermezse motoru kapatır (Worker sonlandırılır, bellek boşalır)
function startAsrWatchdog(){
  let last = performance.now(), lagHits = 0, stopped = false, memBusy = false;
  const trip = why => { if (stopped) return; stopped = true; clearInterval(iv); const err = new Error(why); err.overload = true; killAsr(err); };
  const iv = setInterval(async () => {
    const now = performance.now(), lag = now - last - 1000; last = now;
    if (document.hidden || !asrPending()){ lagHits = 0; return; }   // yalnızca motor çalışırken; arka plandaki pencerede zamanlayıcılar yavaşlar
    lagHits = lag > 3000 ? lagHits + 1 : 0;
    if (lag > 8000 || lagHits >= 2) return trip('arayüz donmaya başladı');
    if (asrPending() && now - asrLastMsg > 240000) return trip('motor 4 dakikadır yanıt vermiyor');
    if (memBusy) return; memBusy = true;
    try {
      const m = await api.memInfo(), limit = clamp(m.totalMB * 0.45, 2500, 8000);
      if (m.procMB > limit) trip(`bellek kullanımı çok yükseldi (${(m.procMB / 1024).toFixed(1)} GB)`);
    } catch (e){} finally { memBusy = false; }
  }, 1000);
  return () => { stopped = true; clearInterval(iv); };
}
function asrFailed(err, what){
  console.error(err);
  if (err.overload){
    setStatus('subStatus', `Altyazı aşırı yüklendi: ${err.message}. Altyazı motoru kapatıldı ve bellek boşaltıldı. Diğer uygulamaları kapatıp veya daha hafif bir model (Hızlı) seçip tekrar deneyebilirsin.`, 'err');
    toast('Altyazı aşırı yüklendi, altyazı motoru kapatıldı', 'err');
  } else setStatus('subStatus', `${what}: ${err.message}`, 'err');
}
const asrOpts = () => ({model: $('wModel').value, lang: $('wLang').value, maxWords: +$('autoWords').value});
$('autoSubs').onclick = async () => {
  if (subBusy || (!subSourceItems().length && !audibleSources().length)) return;
  if (subsOnly().length && !confirm('Mevcut altyazılar yenileriyle değiştirilecek. Devam edilsin mi?')) return;
  subBusy = true; pause(); updateButtons();
  const st = m => setStatus('subStatus', m);
  const stopWatch = startAsrWatchdog();
  try {
    const audio = await extractSubAudio(st);
    const made = await transcribeToCues(audio, asrOpts(), st); selCue = -1;
    P.cues = [...textsOnly(), ...made].sort((x, y) => x.start - y.start);
    const nw = made.reduce((a, c) => a + c.words.length, 0);
    setStatus('subStatus', `${nw} kelime, ${made.length} satır oluşturuldu. Yanlış kelimeleri altyazı izinde satıra tıklayıp düzeltebilirsin.`, 'ok');
  } catch (err){ asrFailed(err, 'Altyazı oluşturulamadı'); }
  finally { stopWatch(); }
  subBusy = false; refresh();
};
$('resync').onclick = async () => {
  if (subBusy || (!subSourceItems().length && !audibleSources().length) || !subsOnly().length) return;
  subBusy = true; pause(); updateButtons();
  const st = m => setStatus('subStatus', m);
  const stopWatch = startAsrWatchdog();
  try {
    const audio = await extractSubAudio(st);
    const r = await resyncCues(subsOnly(), audio, asrOpts(), st);
    setStatus('subStatus', `${r.matched}/${r.total} kelime sesle eşleşti, kalanı aradaki zamanlara dağıtıldı.`, 'ok');
  } catch (err){ asrFailed(err, 'Zamanlar düzeltilemedi'); }
  finally { stopWatch(); }
  subBusy = false; refresh();
};

/* ================= Dışa aktarma ================= */
async function savePng(canvas, path){
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  await api.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}
async function renderSubFrames(dir, W, H, fps, total, cues, onP){
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const N = Math.ceil(total * fps), step = 1 / fps, entries = [];
  await savePng(c, dir + '/blank.png');
  let last = null, n = 0;
  for (let f = 0; f < N; f++){
    if (exportCancelled) throw new Error('İptal edildi');
    const t = f * step, key = subKey(cues, t, f, H);
    if (key === last){ entries[entries.length - 1].d += step; continue; }
    last = key;
    let file = 'blank.png';
    if (key !== 'none'){
      g.clearRect(0, 0, W, H); drawSubsAt(g, cues, t, W, H);
      file = `s${String(n++).padStart(6, '0')}.png`;
      await savePng(c, dir + '/' + file);
    }
    entries.push({file, d: step});
    if (f % 15 === 0){ onP(f / N); await new Promise(r => setTimeout(r, 0)); }
  }
  let txt = 'ffconcat version 1.0\n';
  for (const e of entries) txt += `file '${e.file}'\nduration ${e.d.toFixed(6)}\n`;
  txt += `file '${entries[entries.length - 1].file}'\n`;
  await api.writeText(dir + '/subs.ffconcat', txt);
  return n;
}
// efektlerin bindirme görselleri (kenar karartması, ışık sızıntısı, tarama çizgisi) önizlemeyle aynı çizimden PNG
async function prepareFxAssets(dir, W, H){
  const assets = new Map();
  const list = [...ENG.L.map(o => ffClipFx(o.c.fx, o.len, W, H).ovl), ...ENG.effects.map(x => ffClipFx({eff: x.eff}, x.len, W, H).ovl)].flat();
  for (const a of list){
    if (assets.has(a.key)) continue;
    const c = document.createElement('canvas'); c.width = W * a.w; c.height = H;
    a.draw(c.getContext('2d'), W, H);
    const p = `${dir}/fx_${assets.size}.png`; await savePng(c, p); assets.set(a.key, p);
  }
  return assets;
}
function buildExportArgs(out, W, H, fps, subList, assets = new Map()){
  const args = [], f = [], EL = ENG.L;
  let idx = 0;
  EL.forEach(o => { args.push('-ss', o.c.in.toFixed(3), '-t', (o.c.out - o.c.in).toFixed(3), '-i', o.c.path); idx++; });
  const layers = [];
  for (const a of ENG.audios){
    const len = audioLen(a); if (len < 0.05 || a.muted) continue;
    if (a.loop) args.push('-stream_loop', '-1');
    if (a.trimIn > 0) args.push('-ss', a.trimIn.toFixed(3));
    args.push('-i', a.path); layers.push({a, len, idx: idx++, sp: spd(a)});
  }
  const ovs = [...ENG.overlays].sort((a, b) => ovZ(a) - ovZ(b)).map(o => {
    args.push('-ss', o.in.toFixed(3), '-t', (o.out - o.in).toFixed(3), '-i', o.path); return {o, idx: idx++};
  });
  let subIdx = -1;
  if (subList){ args.push('-f', 'concat', '-safe', '0', '-i', subList); subIdx = idx++; }

  EL.forEach((o, i) => {
    const len = o.len.toFixed(3), c = o.c;
    const fi = o.fi > 0 ? Math.min(o.fi, o.len / 2) : 0;
    const fo = o.fo > 0 ? Math.min(o.fo, o.len / 2) : 0;
    let v = `[${i}:v]setpts=(PTS-STARTPTS)/${spd(c).toFixed(4)},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=2,trim=duration=${len},setpts=PTS-STARTPTS`;
    if (c.fx){   // efektler: kamera, renk, keskinlik, bulanıklık, gren, flaş → PNG bindirmeler → bantlar, animasyon
      const e = ffClipFx(c.fx, o.len, W, H);
      v += e.pre;
      e.ovl.forEach((a, j) => {
        args.push('-loop', '1', '-i', assets.get(a.key)); const ai = idx++;
        f.push(v + `[fx${i}_${j}]`);
        v = `[fx${i}_${j}][${ai}:v]overlay=x='${a.x}':y=0:shortest=1:format=auto`;
      });
      v += e.post + ',format=yuv420p,setsar=1';
    }
    if (fi > 0) v += `,fade=t=in:st=0:d=${fi.toFixed(3)}`;
    if (fo > 0) v += `,fade=t=out:st=${(o.len - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
    f.push(v + `[v${i}]`);
    let a = c.hasAudio && !c.muted && !o.mute
      ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS${atempo(spd(c))},apad,atrim=duration=${len}`
        + (isFlat(c.env) ? '' : ',' + envExpr(c.env, o.len)) + (c.vol !== 1 ? `,volume=${c.vol}` : '')
        + (c.fadeIn > 0 ? `,afade=t=in:st=0:d=${Math.min(c.fadeIn, o.len).toFixed(3)}` : '')
        + (c.fadeOut > 0 ? `,afade=t=out:st=${Math.max(0, o.len - c.fadeOut).toFixed(3)}:d=${Math.min(c.fadeOut, o.len).toFixed(3)}` : '')
      : `anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${len}`;
    if (fi > 0) a += `,afade=t=in:st=0:d=${fi.toFixed(3)}`;
    if (fo > 0) a += `,afade=t=out:st=${(o.len - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
    f.push(a + `[a${i}]`);
  });
  const gaps = EL.map((o, i) => {
    const g = o.gap || 0; if (g <= 0.001) return null;
    f.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${g.toFixed(3)},format=yuv420p,setsar=1[gv${i}]`);
    f.push(`anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${g.toFixed(3)}[ga${i}]`);
    return {v: `[gv${i}]`, a: `[ga${i}]`};
  });
  const ch = chainClips(EL, f, EL.map((_, i) => `[v${i}]`), EL.map((_, i) => `[a${i}]`), gaps);
  let vOut = ch.v, aOut = ch.a;
  if (TOTAL > ENG.VEND + 0.01){
    f.push(`${vOut}tpad=stop_mode=add:stop_duration=${(TOTAL - ENG.VEND).toFixed(3)}:color=black[vpx]`); vOut = '[vpx]';
    f.push(`${aOut}apad=whole_dur=${TOTAL.toFixed(3)}[apx]`); aOut = '[apx]';
  }
  // video katmanları: boyutlandır, opaklık, zamanda kaydır ve üstüne bindir
  ovs.forEach(({o, idx}, n) => {
    const r = ovRect(o, W, H), len = clipLen(o), ow = Math.max(2, Math.round(r.w / 2) * 2), oh = Math.max(2, Math.round(r.h / 2) * 2);
    let v = `[${idx}:v]setpts=(PTS-STARTPTS)/${spd(o).toFixed(4)},fps=${fps},scale=${ow}:${oh},setsar=1,format=yuva420p,trim=duration=${len.toFixed(3)}` + ffOverlayFx(o.fx, len, H);
    if ((o.opacity ?? 1) < 0.999) v += `,colorchannelmixer=aa=${(o.opacity ?? 1).toFixed(3)}`;
    v += `,setpts=PTS+${o.start.toFixed(3)}/TB`;
    f.push(v + `[ov${n}]`);
    f.push(`${vOut}[ov${n}]overlay=x=${Math.round(r.x)}:y=${Math.round(r.y)}:eof_action=pass:format=auto,format=yuv420p[vov${n}]`);
    vOut = `[vov${n}]`;
  });
  // efekt katmanları: görüntünün o aralığı ayrılıp efektlenir ve yerine bindirilir
  [...ENG.effects].sort((a, b) => a.start - b.start).forEach((x, n) => {
    const e = ffClipFx({eff: x.eff}, x.len, W, H);
    f.push(`${vOut}split[em${n}][es${n}]`);
    let v = `[es${n}]trim=start=${x.start.toFixed(3)}:end=${(x.start + x.len).toFixed(3)},setpts=PTS-STARTPTS` + e.pre;
    e.ovl.forEach((a, j) => {
      args.push('-loop', '1', '-i', assets.get(a.key)); const ai = idx++;
      f.push(v + `[ef${n}_${j}]`);
      v = `[ef${n}_${j}][${ai}:v]overlay=x='${a.x}':y=0:shortest=1:format=auto`;
    });
    f.push(v + e.post + `,format=yuv420p,setsar=1,setpts=PTS+${x.start.toFixed(3)}/TB[eo${n}]`);
    f.push(`[em${n}][eo${n}]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[ve${n}]`);
    vOut = `[ve${n}]`;
  });
  if (subIdx >= 0){
    f.push(`[${subIdx}:v]format=rgba[sb]`);
    f.push(`${vOut}[sb]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[vo]`);
    vOut = '[vo]';
  }
  // video katmanlarının sesi de karışıma girer
  ovs.filter(({o}) => o.hasAudio && !o.muted).forEach(({o, idx}) => {
    layers.push({a: {vol: o.vol, env: o.env, fadeIn: o.fadeIn, fadeOut: o.fadeOut, start: o.start}, len: clipLen(o), idx, sp: spd(o)});
  });
  if (layers.length){
    layers.forEach(({a, len, idx, sp}, k) => {
      let s = `[${idx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS${atempo(sp)},atrim=duration=${len.toFixed(3)}`;
      if (!isFlat(a.env)) s += ',' + envExpr(a.env, len);
      s += `,volume=${a.vol}`;
      if (a.fadeIn > 0) s += `,afade=t=in:st=0:d=${Math.min(a.fadeIn, len).toFixed(3)}`;
      if (a.fadeOut > 0) s += `,afade=t=out:st=${Math.max(0, len - a.fadeOut).toFixed(3)}:d=${Math.min(a.fadeOut, len).toFixed(3)}`;
      if (a.start > 0) s += `,adelay=${Math.round(a.start * 1000)}:all=1`;
      f.push(s + `[m${k}]`);
    });
    f.push(`${aOut}${layers.map((_, k) => `[m${k}]`).join('')}amix=inputs=${layers.length + 1}:duration=first:dropout_transition=0:normalize=0[ao]`);
    aOut = '[ao]';
  }
  args.push('-filter_complex', f.join(';'), '-map', vOut, '-map', aOut,
    '-c:v', 'libx264', '-preset', $('outPreset').value, '-crf', $('outCrf').value, '-pix_fmt', 'yuv420p', '-g', String(fps * 2),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', TOTAL.toFixed(3), out);
  return args;
}
// dışa aktarma klasörü: en son seçilen tüm projelerde geçerli (varsayılan: Filmler)
const EXPORT_DIR_KEY = 'reelix-export-dir';
let exportDir = localStorage.getItem(EXPORT_DIR_KEY);
async function showExportDir(){
  if (!exportDir || !(await api.exists(exportDir))) exportDir = await api.videosDir();
  $('outDirName').textContent = '\u200E' + exportDir + '\u200E';   // sağdan kısaltırken baştaki / sona kaymasın $('outDirName').title = exportDir;
}
$('outDirPick').onclick = async () => {
  const d = await api.pickFolder(exportDir); if (!d) return;
  exportDir = d; try { localStorage.setItem(EXPORT_DIR_KEY, d); } catch (e){}
  showExportDir();
};
const exportBaseName = () => ((projPath ? stem(projPath) : 'reelix') + (VIEW === 'scene' ? '_' + (sceneById(curScene) || {}).name : '')).replace(/[\\/:*?"<>|]/g, '-');
function openExport(){
  if (!ENG.L.length){ toast(VIEW === 'project' ? 'Dışa aktarmak için projede videolu en az bir sahne olmalı' : 'Dışa aktarmak için önce zaman çizelgesine bir video ekle'); return; }
  pause(); updateOutInfo();
  $('exportWhat').textContent = VIEW === 'project' ? 'Tüm proje' : (sceneById(curScene) || {}).name;
  $('burnSubs').closest('label').hidden = VIEW !== 'project';
  const tc_ = $('exportThumb'), g = tc_.getContext('2d');
  const k = Math.min(tc_.width / cv.width, tc_.height / cv.height);
  g.fillStyle = '#000'; g.fillRect(0, 0, tc_.width, tc_.height);
  g.drawImage(cv, (tc_.width - cv.width * k) / 2, (tc_.height - cv.height * k) / 2, cv.width * k, cv.height * k);
  $('outName').value = exportBaseName(); showExportDir();
  $('exportModal').hidden = false;
}
$('topExport').onclick = openExport;
$('exportClose').onclick = () => { if (!exportJob) $('exportModal').hidden = true; };
$('exportModal').addEventListener('pointerdown', e => { if (e.target === $('exportModal') && !exportJob) $('exportModal').hidden = true; });
$('exportBtn').onclick = async () => {
  if (!ENG.L.length || exportJob) return;
  await showExportDir();
  // seçili klasöre yaz; aynı adda dosya varsa üzerine yazmak yerine numara ekle
  const name = ($('outName').value.replace(/[\\/:*?"<>|]/g, '-').replace(/\.mp4$/i, '').trim() || exportBaseName());
  let out;
  for (let n = 1; ; n++){ out = await api.joinPath(exportDir, (n === 1 ? name : `${name} (${n})`) + '.mp4'); if (!(await api.exists(out))) break; }
  pause();
  const {W, H} = outRes(), fps = outFps();
  const burnCues = ENG.cues.filter(c => isTextCue(c) || (VIEW === 'project' && $('burnSubs').checked));   // metinler her zaman, altyazılar seçeneğe göre
  const burn = burnCues.length > 0;
  exportJob = uid(); exportCancelled = false; updateButtons();
  const bar = p => $('exportBar').style.width = (p * 100).toFixed(1) + '%';
  bar(0);
  const tmp = await api.makeTemp();
  const t0 = performance.now();
  try {
    let subList = null;
    if (burn){
      await renderSubFrames(tmp, W, H, fps, TOTAL, burnCues, p => { setStatus('exportStatus', `Altyazı hazırlanıyor… %${Math.round(p * 100)}`); bar(p * 0.25); });
      subList = tmp + '/subs.ffconcat';
    }
    const base = burn ? 0.25 : 0;
    const args = buildExportArgs(out, W, H, fps, subList, await prepareFxAssets(tmp, W, H));
    const id = uid(); exportJob = id;
    progressCbs.set(id, p => { bar(base + p * (1 - base)); setStatus('exportStatus', `Video oluşturuluyor… %${Math.round(p * 100)}`); });
    try { await api.ffmpeg(id, args, TOTAL); } finally { progressCbs.delete(id); }
    bar(1); lastExport = out;
    setStatus('exportStatus', `Dışa aktarıldı (${((performance.now() - t0) / 1000).toFixed(0)} sn): ${basename(out)}`, 'ok');
  } catch (err){
    console.error(err);
    setStatus('exportStatus', err.message === 'İptal edildi' ? 'Dışa aktarma iptal edildi.' : 'Dışa aktarılamadı:\n' + err.message, 'err');
  } finally {
    api.removeDir(tmp);
    exportJob = null; updateButtons();
  }
};
$('exportCancel').onclick = () => { exportCancelled = true; if (exportJob) api.ffmpegCancel(exportJob); };
$('exportReveal').onclick = () => lastExport && api.reveal(lastExport);
$('exportToSplit').onclick = () => { if (lastExport){ $('exportModal').hidden = true; setSplitSrc(lastExport); showTab('split'); } };
['outFps', 'outCrf', 'outPreset', 'burnSubs'].forEach(id => $(id).addEventListener('change', () => { updateOutInfo(); renderInspector(); }));
function updateOutInfo(){
  const {W, H} = outRes();
  $('outInfo').innerHTML = ENG.L.length ? `${W}×${H} · ${fmt(TOTAL)}<br><span style="color:var(--mut)">Oranı oynatıcının altındaki menüden değiştirebilirsin.</span>` : '';
}

/* ================= Bölme ================= */
async function setSplitSrc(p){
  const info = await api.probe(p);
  if (!(info.duration > 0)){ toast(`${basename(p)} okunamadı`, 'err'); return; }
  splitSrc = {path: p, name: basename(p), dur: info.duration};
  $('splitInfo').innerHTML = `<b>${esc(splitSrc.name)}</b><br><span style="color:var(--mut)">${fmt(info.duration)}, ${info.width}×${info.height}</span>`;
  updateSplitPreview(); updateButtons();
}
$('splitPick').onclick = async () => { const [p] = await api.openFiles('video', false); if (p) setSplitSrc(p); };
$('splitUseExport').onclick = () => lastExport && setSplitSrc(lastExport);
$('splitMode').onchange = () => {
  const m = $('splitMode').value;
  $('splitCountRow').style.display = m === 'count' ? '' : 'none';
  $('splitEveryRow').style.display = m === 'every' ? '' : 'none';
  $('splitTimesRow').style.display = m === 'times' ? '' : 'none';
  updateSplitPreview();
};
['splitCount', 'splitEvery', 'splitTimes'].forEach(id => $(id).addEventListener('input', updateSplitPreview));
$('splitAddPlayhead').onclick = () => {
  const ta = $('splitTimes'); ta.value = (ta.value.trim() ? ta.value.trim() + ', ' : '') + fmt(T, 2); updateSplitPreview();
};
function splitParts(){
  if (!splitSrc) return [];
  const D = splitSrc.dur, m = $('splitMode').value; let cuts = [];
  if (m === 'count'){ const n = clamp(Math.round(+$('splitCount').value || 2), 2, 500); for (let i = 1; i < n; i++) cuts.push(D * i / n); }
  if (m === 'every'){ const x = Math.max(1, +$('splitEvery').value || 60); for (let t = x; t < D - 0.5; t += x) cuts.push(t); }
  if (m === 'times'){
    cuts = $('splitTimes').value.split(/[\s,;]+/).filter(Boolean)
      .map(s => s.includes(':') ? parseTime(s) : parseFloat(s)).filter(t => t > 0.2 && t < D - 0.2);
    cuts = [...new Set(cuts.map(t => +t.toFixed(3)))].sort((a, b) => a - b);
  }
  const pts = [0, ...cuts, D];
  return pts.slice(0, -1).map((s, i) => ({s, e: pts[i + 1]}));
}
function updateSplitPreview(){
  const parts = splitParts();
  $('splitPreview').innerHTML = parts.length
    ? parts.slice(0, 40).map((p, i) => `${i + 1}. ${fmt(p.s)} – ${fmt(p.e)} (${(p.e - p.s).toFixed(1)} sn)`).join('<br>') + (parts.length > 40 ? `<br>Toplam ${parts.length} parça` : '')
    : '—';
}
$('splitRun').onclick = async () => {
  if (!splitSrc || splitJob) return;
  const parts = splitParts(); if (parts.length < 2){ toast('En az 2 parça olmalı'); return; }
  const dir = await api.pickFolder(); if (!dir) return;
  const precise = $('splitPrecise').checked, ext = precise ? 'mp4' : (extname(splitSrc.path) || 'mp4');
  splitCancelled = false; splitOutDir = dir; updateButtons();
  const bar = p => $('splitBar').style.width = (p * 100).toFixed(1) + '%';
  try {
    for (let i = 0; i < parts.length; i++){
      if (splitCancelled) throw new Error('İptal edildi');
      const {s, e} = parts[i], len = e - s;
      const out = `${dir}/${stem(splitSrc.path)}_part${String(i + 1).padStart(2, '0')}.${ext}`;
      const args = ['-ss', s.toFixed(3), '-i', splitSrc.path, '-t', len.toFixed(3),
        ...(precise
          ? ['-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
          : ['-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero']),
        out];
      const id = uid(); splitJob = id;
      setStatus('splitStatus', `Parça ${i + 1}/${parts.length} hazırlanıyor…`);
      progressCbs.set(id, p => bar((i + p) / parts.length));
      try { await api.ffmpeg(id, args, len); } finally { progressCbs.delete(id); }
      bar((i + 1) / parts.length);
    }
    setStatus('splitStatus', `${parts.length} parça kaydedildi.`, 'ok');
  } catch (err){
    console.error(err);
    setStatus('splitStatus', err.message === 'İptal edildi' ? 'Bölme iptal edildi.' : 'Bölünemedi:\n' + err.message, 'err');
  } finally { splitJob = null; updateButtons(); }
};
$('splitCancel').onclick = () => { splitCancelled = true; if (splitJob) api.ffmpegCancel(splitJob); };
$('splitReveal').onclick = () => splitOutDir && api.reveal(splitOutDir);

/* ================= Sahneler ve proje görünümü ================= */
const SCENE_KEYS = ['clips', 'audios', 'overlays', 'effects', 'cues', 'fadeStart', 'fadeEnd', 'edgeD', 'defTr'];
function newScene(name){
  return {id: uid(), name: name || nextSceneName(), clips: [], audios: [], overlays: [], effects: [], cues: [],
          fadeStart: false, fadeEnd: false, edgeD: 1, defTr: {type: 'fadeblack', d: 1}, undo: [], redo: []};
}
function nextSceneName(){
  let n = SCENES.length + 1;
  while (SCENES.some(sc => sc.name === `Sahne ${n}`)) n++;
  return `Sahne ${n}`;
}
// proje zaman çizelgesi: ana izde sahne blokları, üstünde proje düzeyindeki ses/katmanlar (altyazılar P.cues'ta)
const newProjectTimeline = () => ({clips: [], audios: [], overlays: [], effects: [], cues: [], fadeStart: false, fadeEnd: false, edgeD: 1, defTr: {type: 'fadeblack', d: 1}, undo: [], redo: []});
const sceneBlock = sc => ({id: uid(), scene: sc.id, tr: null, gap: 0, muted: false});
const normAudios = list => (list || []).map(a0 => ({muted: false, env: DEF_ENV(), ...a0, len: a0.len ?? Math.max(0.1, a0.dur - (a0.trimIn || 0))}));
const normOverlays = list => (list || []).map(o => ({x: 0.5, y: 0.5, scale: 1, opacity: 1, vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0, track: 0, ...o}));
// dosyadan gelen sahneyi eksik alanlarıyla tamamla (eski sürüm dosyalar dahil)
function normalizeScene(d){
  return {...newScene(d.name || 'Sahne 1'), id: d.id || uid(),
    clips: (d.clips || []).map(c => ({vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0, ...c,
      tr: c.tr !== undefined ? c.tr : (c.trans ? {type: 'fadeblack', d: d.transD || 1} : null)})),
    audios: normAudios(d.audios), overlays: normOverlays(d.overlays), effects: d.effects || [], cues: (d.cues || []).filter(isTextCue),
    fadeStart: !!d.fadeStart, fadeEnd: !!d.fadeEnd, edgeD: d.edgeD ?? 1, defTr: d.defTr || {type: 'fadeblack', d: 1}};
}
function normalizeProjectTimeline(d){
  return {...newProjectTimeline(),
    clips: (d.clips || []).filter(b => sceneById(b.scene)).map(b => ({id: uid(), tr: null, gap: 0, muted: false, ...b})),
    audios: normAudios(d.audios), overlays: normOverlays(d.overlays), effects: d.effects || [],
    fadeStart: !!d.fadeStart, fadeEnd: !!d.fadeEnd, edgeD: d.edgeD ?? 1, defTr: d.defTr || {type: 'fadeblack', d: 1}};
}
const sceneById = id => SCENES.find(x => x.id === id);
const viewObj = () => VIEW === 'project' ? PROJ : sceneById(curScene);
// projedeki sahne blokları (proje düzenlenirken güncel liste P.clips'tedir)
const projBlocks = () => VIEW === 'project' ? P.clips : PROJ.clips;
const inProject = id => projBlocks().some(b => b.scene === id);
// düzenlenen görünümün güncel halini (ve geri al geçmişini) kendi nesnesine yaz
function storeView(){
  const v = viewObj(); if (!v) return;
  SCENE_KEYS.forEach(k => v[k] = P[k]);
  v.undo = [...undoStack]; v.redo = [...redoStack];
}
// görünümü editöre yükle: 'project' veya bir sahnenin id'si
function loadView(id){
  pause(); endHover();
  for (const mid of [...media.keys()]) dropMedia(mid);
  VIEW = id === 'project' ? 'project' : 'scene';
  if (VIEW === 'scene') curScene = id;
  sceneCache.clear();
  const v = viewObj();
  P.clips = v.clips; P.overlays = v.overlays; P.effects = v.effects = v.effects || []; P.cues = v.cues = v.cues || []; P.fadeStart = v.fadeStart; P.fadeEnd = v.fadeEnd; P.edgeD = v.edgeD; P.defTr = v.defTr;
  P.audios = [];
  for (const a of v.audios){ if (a.track == null) a.track = freeTrack(a); P.audios.push(a); }
  v.audios = P.audios;
  // medya: düzenlenen öğeler; projede ayrıca tüm sahnelerin öğeleri (düzleştirilmiş oynatma için)
  const vids = [...P.clips.filter(c => !c.scene), ...P.overlays], auds = [...P.audios];
  if (VIEW === 'project') SCENES.forEach(sc => { vids.push(...sc.clips, ...sc.overlays); auds.push(...sc.audios); });
  for (const it of [...vids, ...auds]) Object.assign(it, visCache.get(visKey(it)) || {});
  vids.forEach(it => { makeMedia(it, 'video'); ensureVisuals(it, true); });
  auds.forEach(it => makeMedia(it, 'audio'));
  $('edgeD').value = P.edgeD; $('fadeStart').checked = P.fadeStart; $('fadeEnd').checked = P.fadeEnd;
  $('edgeD').parentElement.querySelector('.v').textContent = $('edgeD').value;
  sel = null; selAud = null; selOv = null; selCue = -1; selTr = 0; multi.clear(); inspMode = 'project'; T = 0;
  undoStack.length = 0; undoStack.push(...(v.undo || [])); redoStack.length = 0; redoStack.push(...(v.redo || []));
  lastSnap = null; linkFreeze = true;
  refresh(); seek(0); renderSceneBar();
}
function openView(id){
  if ((id === 'project' && VIEW === 'project') || (VIEW === 'scene' && id === curScene)) return;
  storeView(); loadView(id);
}
function addScene(){
  storeView();
  const sc = newScene(); SCENES.push(sc); PROJ.clips.push(sceneBlock(sc));
  dirty = true; loadView(sc.id);
  toast(`${sc.name} oluşturuldu ve projenin sonuna eklendi`);
}
function duplicateScene(id){
  storeView();
  const sc = sceneById(id); if (!sc) return;
  const gm = {}, copy = list => list.map(x => {
    const {thumb, thumbN, wave, missing, ...r} = x, y = {...JSON.parse(JSON.stringify(r)), id: uid()};
    if (y.gid) y.gid = gm[y.gid] = gm[y.gid] || uid();
    return y;
  });
  const cp = {...newScene(`${sc.name} kopya`), cues: copy(sc.cues || []), clips: copy(sc.clips), audios: copy(sc.audios), overlays: copy(sc.overlays), effects: copy(sc.effects || []),
              fadeStart: sc.fadeStart, fadeEnd: sc.fadeEnd, edgeD: sc.edgeD, defTr: {...sc.defTr}};
  SCENES.splice(SCENES.indexOf(sc) + 1, 0, cp);
  const bi = PROJ.clips.findIndex(b => b.scene === id);
  PROJ.clips.splice(bi < 0 ? PROJ.clips.length : bi + 1, 0, sceneBlock(cp));
  dirty = true; loadView(cp.id);
  toast(`${cp.name} oluşturuldu`);
}
function deleteScene(id){
  const sc = sceneById(id); if (!sc) return;
  if (SCENES.length < 2){ toast('Projede en az bir sahne olmalı'); return; }
  if (!confirm(`"${sc.name}" sahnesi silinsin mi? İçindeki klipler, sesler ve katmanlar da silinir.`)) return;
  storeView();
  SCENES = SCENES.filter(x => x !== sc);
  PROJ.clips = PROJ.clips.filter(b => b.scene !== id);
  dirty = true;
  loadView(VIEW === 'scene' && curScene !== id ? curScene : 'project');
  toast(`${sc.name} silindi`);
}
function addSceneToProject(id){
  const sc = sceneById(id); if (!sc || inProject(id)) return;
  projBlocks().push(sceneBlock(sc)); dirty = true;
  if (VIEW === 'project') refresh(); else { renderSceneBar(); renderInspector(); }
  toast(`${sc.name} projenin sonuna eklendi`);
}
function renameScene(id, name){
  const sc = sceneById(id); name = (name || '').replace(/\s+/g, ' ').trim();
  if (!sc || !name || name === sc.name) return;
  sc.name = name; dirty = true;
  renderSceneBar(); renderTimeline(); renderInspector(); updateTitle();
}
// üstteki sahne sekmeleri
// sekme sırası = projedeki sıra (projede olmayan sahneler sonda)
const sceneOrder = () => [...projBlocks().map(b => sceneById(b.scene)).filter(Boolean), ...SCENES.filter(sc => !inProject(sc.id))];
function renderSceneBar(){
  $('sceneTabs').innerHTML = [...new Set(sceneOrder())].map(sc => {
    const on = VIEW === 'scene' && curScene === sc.id, out = !inProject(sc.id);
    return `<button class="stab ${on ? 'on' : ''} ${out ? 'out' : ''}" data-scene="${sc.id}" draggable="true" title="${out ? 'Projede kullanılmıyor · ' : ''}Sürükle: sırasını değiştir · Çift tıkla: yeniden adlandır">${ICON.scene}<span class="snm">${esc(sc.name)}</span></button>`
      + (on ? `<button class="ic sren" data-sren="${sc.id}" title="Sahneyi yeniden adlandır">${ICON.edit}</button><button class="ic sren" data-sdel="${sc.id}" title="Sahneyi sil">${ICON.close}</button>` : '');
  }).join('');
  $('projTab').classList.toggle('on', VIEW === 'project');
  $('exitScene').hidden = VIEW !== 'scene';
  $('subsSceneNote').hidden = VIEW !== 'scene'; $('subsBody').hidden = VIEW === 'scene';
}
$('projTab').onclick = () => openView('project');
$('exitScene').onclick = () => openView('project');
$('addScene').onclick = addScene;
/* ---- Başka projeden sahne ekle: proje seç → sahne seç → kopyası bu projenin sonuna eklenir ---- */
$('addSceneMore').onclick = e => { e.stopPropagation(); const pop = $('popScene'); if (!pop.hidden){ pop.hidden = true; return; } showProjectPicker(); };
function placeScenePop(){
  const pop = $('popScene'), r = $('addSceneMore').getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(window.innerWidth - 290, r.left - 120)) + 'px'; pop.hidden = false;
}
async function showProjectPicker(){
  const pop = $('popScene');
  const list = (await Promise.all(getRecent().filter(x => x.path !== projPath).map(async x => (await api.exists(x.path)) ? x : null))).filter(Boolean);
  pop.innerHTML = '<div class="ptitle2">Başka projeden sahne ekle</div>'
    + (list.length ? list.map(x => `<button class="mi" data-pp="${esc(x.path)}">${esc(x.name)}</button>`).join('') : '<p class="note">Listede başka proje yok.</p>')
    + '<button class="mi" data-pfile>Dosyadan seç…</button>';
  pop.querySelectorAll('[data-pp]').forEach(b => b.onclick = () => showScenePicker(b.dataset.pp));
  pop.querySelector('[data-pfile]').onclick = async () => { pop.hidden = true; const [p] = await api.openFiles('project', false); if (p) showScenePicker(p); };
  placeScenePop();
}
async function showScenePicker(path){
  const pop = $('popScene');
  let d; try { d = JSON.parse(await api.readText(path)); } catch (e){ pop.hidden = true; toast('Proje dosyası okunamadı', 'err'); return; }
  await adoptProjectMedia(path, d);   // o projenin medyası da uygulama klasörüne kopyalanmış olsun
  const scenes = d.scenes && d.scenes.length ? d.scenes : [{name: 'Sahne 1', ...d, cues: []}];
  pop.innerHTML = `<div class="ptitle2">${esc(stem(path))}</div>`
    + scenes.map((sc, i) => `<button class="mi" data-ps="${i}">${esc(sc.name || 'Sahne ' + (i + 1))}<small> · ${(sc.clips || []).length} klip</small></button>`).join('')
    + '<button class="mi" data-pback>← Projeler</button>';
  pop.querySelectorAll('[data-ps]').forEach(b => b.onclick = () => { pop.hidden = true; importScene(scenes[+b.dataset.ps], d.lib || []); });
  pop.querySelector('[data-pback]').onclick = () => showProjectPicker();
  placeScenePop();
}
function importScene(src, lib){
  storeView();
  // yeni kimlikler: aynı sahne birden çok kez eklenebilsin
  const gm = {}, copy = list => (list || []).map(x => { const {thumb, thumbN, wave, missing, ...r} = x, y = {...JSON.parse(JSON.stringify(r)), id: uid()};
    if (y.gid) y.gid = gm[y.gid] = gm[y.gid] || uid(); return y; });
  let name = src.name || 'Sahne', n = 2;
  while (SCENES.some(sc => sc.name === name)) name = `${src.name} (${n++})`;
  const sc = normalizeScene({...src, name, id: uid(), clips: copy(src.clips).filter(c => !c.scene), audios: copy(src.audios), overlays: copy(src.overlays),
    effects: copy(src.effects), cues: copy(src.cues)});
  // kullanılan dosyalar kitaplığa
  for (const it of [...sc.clips, ...sc.overlays, ...sc.audios]) if (!LIB.find(x => x.path === it.path)){
    const li = lib.find(x => x.path === it.path);
    LIB.push(li ? {...li, id: uid()} : {id: uid(), path: it.path, name: it.name, kind: sc.audios.includes(it) ? 'audio' : 'video', dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio !== false});
    ensureVisuals(LIB[LIB.length - 1], LIB[LIB.length - 1].kind === 'video');
  }
  SCENES.push(sc); PROJ.clips.push(sceneBlock(sc));
  dirty = true; renderLibrary(); loadView(sc.id);
  toast(`${name} bu projeye eklendi`);
}
$('subsToProject').onclick = () => openView('project');
$('sceneTabs').addEventListener('click', e => {
  const ren = e.target.closest('[data-sren]'); if (ren){ startSceneRename(ren.dataset.sren); return; }
  const del = e.target.closest('[data-sdel]'); if (del){ deleteScene(del.dataset.sdel); return; }
  const b = e.target.closest('[data-scene]'); if (b && !e.target.isContentEditable) openView(b.dataset.scene);
});
// sekmeyi sürükleyip bırakarak sahnenin projedeki sırasını değiştir
let sceneDrag = null;
$('sceneTabs').addEventListener('dragstart', e => { const b = e.target.closest('[data-scene]'); if (!b) return; sceneDrag = b.dataset.scene; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/reelix-scene', sceneDrag); });
const sceneDropSide = (b, e) => { const r = b.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 ? 'l' : 'r'; };
$('sceneTabs').addEventListener('dragover', e => {
  const b = e.target.closest('[data-scene]'); if (!sceneDrag || !b) return;
  e.preventDefault();
  $('sceneTabs').querySelectorAll('.dl,.dr').forEach(x => x.classList.remove('dl', 'dr'));
  if (b.dataset.scene !== sceneDrag) b.classList.add(sceneDropSide(b, e) === 'l' ? 'dl' : 'dr');
});
$('sceneTabs').addEventListener('dragleave', e => { if (!$('sceneTabs').contains(e.relatedTarget)) $('sceneTabs').querySelectorAll('.dl,.dr').forEach(x => x.classList.remove('dl', 'dr')); });
$('sceneTabs').addEventListener('dragend', () => { sceneDrag = null; $('sceneTabs').querySelectorAll('.dl,.dr').forEach(x => x.classList.remove('dl', 'dr')); });
$('sceneTabs').addEventListener('drop', e => {
  const b = e.target.closest('[data-scene]'), id = sceneDrag; sceneDrag = null;
  if (!b || !id || b.dataset.scene === id) return;
  e.preventDefault();
  const order = sceneOrder().filter(sc => sc.id !== id), moving = sceneById(id);
  order.splice(order.findIndex(sc => sc.id === b.dataset.scene) + (sceneDropSide(b, e) === 'r' ? 1 : 0), 0, moving);
  moveScenes(order);
});
// sahneleri verilen sıraya koy: sahne listesi ve projedeki bloklar birlikte
function moveScenes(order){
  pause();
  SCENES = order.filter((sc, i) => order.indexOf(sc) === i);
  const blocks = projBlocks(), idx = id => SCENES.findIndex(sc => sc.id === id);
  blocks.splice(0, blocks.length, ...[...blocks].sort((a, b) => idx(a.scene) - idx(b.scene)));
  dirty = true; sceneCache.clear(); refresh(); renderSceneBar();
}
// çift tıklama: ilk tıklama sekmeyi yeniden çizdiği için düğmeye göre değil, sahneye göre adlandır
$('sceneTabs').addEventListener('dblclick', e => { const b = e.target.closest('[data-scene]'); if (b) startSceneRename(b.dataset.scene); });
function startSceneRename(id){
  const b = $('sceneTabs').querySelector(`[data-scene="${id}"]`); if (!b) return;
  const nm = b.querySelector('.snm'), orig = nm.textContent;
  if (nm.isContentEditable) return;
  nm.contentEditable = 'plaintext-only'; nm.focus();
  const r = document.createRange(); r.selectNodeContents(nm); getSelection().removeAllRanges(); getSelection().addRange(r);
  const done = ok => { nm.removeEventListener('keydown', kd); nm.removeEventListener('blur', bl); nm.contentEditable = 'false'; if (ok) renameScene(id, nm.textContent); else nm.textContent = orig; };
  const kd = ev => { if (ev.key === 'Enter'){ ev.preventDefault(); done(true); } else if (ev.key === 'Escape'){ ev.preventDefault(); done(false); } };
  const bl = () => done(true);
  nm.addEventListener('keydown', kd); nm.addEventListener('blur', bl);
}
SCENES = [newScene('Sahne 1')]; curScene = SCENES[0].id;
PROJ = newProjectTimeline(); PROJ.clips.push(sceneBlock(SCENES[0]));
SCENE_KEYS.forEach(k => P[k] = SCENES[0][k]);

/* ================= Proje kaydet / aç ================= */
const stripVis = ({thumb, thumbN, wave, missing, ...rest}) => rest;
const viewData = v => ({clips: v.clips.map(stripVis), audios: v.audios.map(stripVis), overlays: v.overlays.map(stripVis), effects: v.effects || [], ...(v === PROJ ? {} : {cues: v.cues || []}),
  fadeStart: v.fadeStart, fadeEnd: v.fadeEnd, edgeD: v.edgeD, defTr: v.defTr});
// yeni projeler uygulamanın kendi Projeler klasörüne "Adsız proje N.reelix" adıyla kaydedilir
async function newProjectPath(){
  const dir = await api.projectsDir();
  for (let n = 1; ; n++){
    const p = await api.joinPath(dir, (n === 1 ? 'Adsız proje' : `Adsız proje ${n}`) + '.reelix');
    if (!(await api.exists(p))) return p;
  }
}
async function saveProject(as = false){
  const p = as ? await api.saveFile('project', (projPath ? stem(projPath) : 'Adsız proje') + '.reelix') : (projPath || await newProjectPath());
  if (!p) return false;
  const folder = projPath ? (getRecent().find(x => x.path === projPath) || {}).folder : newProjFolder;
  storeView();
  const data = {app: 'reelix', version: 6, lib: LIB.map(stripVis),
    scenes: SCENES.map(sc => ({id: sc.id, name: sc.name, ...viewData(sc)})),
    project: viewData(PROJ), view: VIEW === 'project' ? 'project' : curScene,
    cues: PROJ.cues, style: {...S}, poster: POSTER, story: STORY,
    output: {res: $('outRes').value, fps: $('outFps').value, crf: $('outCrf').value, preset: $('outPreset').value, burn: $('burnSubs').checked}};
  await api.writeText(p, JSON.stringify(data, null, 1));
  projPath = p; dirty = false; updateTitle(); toast('Proje kaydedildi'); addRecent(p, folder);
  return true;
}
$('saveProject').onclick = () => saveProject();
$('saveProjectAs').onclick = () => { $('popSave').hidden = true; saveProject(true); };
// kaydedilmemiş değişiklik varsa sor
const okToLeave = () => !dirty || confirm('Kaydedilmemiş değişiklikler var. Devam edersen kaybolacak. Devam edilsin mi?');
const pickProject = async () => { const [p] = await api.openFiles('project', false); if (p) openProjectPath(p); };
$('openProject').onclick = () => { if (okToLeave()) pickProject(); };
$('openProjectFile').onclick = pickProject;
// boş proje durumunu kur ve verilen görünümü aç
function startProject(scenes, proj, cues, view){
  SCENES = scenes; PROJ = proj; proj.cues = cues;
  libSel.clear(); missingNames.clear();
  loadView(view);
  dirty = false;
  renderLibrary(); showHome(false);
}
// proje dosyasındaki tüm medya yollarını uygulama klasöründeki kopyalara çevir; değiştiyse dosyayı güncelle
async function adoptProjectMedia(p, d){
  const objs = [];
  const walk = o => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object'){
      if (typeof o.path === 'string' && (VIDEO_EXT.includes(extname(o.path)) || AUDIO_EXT.includes(extname(o.path)))) objs.push(o);
      for (const k in o) if (k !== 'words' && o[k] && typeof o[k] === 'object') walk(o[k]);
    }
  };
  walk(d);
  const map = new Map();
  for (const src of new Set(objs.map(o => o.path))){ try { const q = await api.importMedia(src); if (q && q !== src) map.set(src, q); } catch (e){} }
  if (!map.size) return false;
  objs.forEach(o => { if (map.has(o.path)) o.path = map.get(o.path); });
  try { await api.writeText(p, JSON.stringify(d, null, 1)); } catch (e){}
  return true;
}
// mevcut projelerin medyasını açılışta bir kez arka planda kopyala (çağrı, proje listesi tanımlandıktan sonra)
let mediaMigration = Promise.resolve();
const migrateAllMedia = async () => {
  let n = 0;
  for (const x of getRecent()){
    try {
      if (!(await api.exists(x.path))) continue;
      if (await adoptProjectMedia(x.path, JSON.parse(await api.readText(x.path)))) n++;
    } catch (e){}
  }
  if (n) toast(`${n} projenin medya dosyaları uygulama klasörüne kopyalandı`);
};
async function openProjectPath(p){
  await mediaMigration;
  let d; try { d = JSON.parse(await api.readText(p)); } catch (e){ toast('Proje dosyası okunamadı', 'err'); return; }
  await adoptProjectMedia(p, d);
  // sürüm 6: sahneler + proje zaman çizelgesi; sürüm 5: yalnızca sahneler; daha eskisi: tek sahne
  const scenes = (d.scenes && d.scenes.length ? d.scenes : [{name: 'Sahne 1', ...d, cues: []}]).map(normalizeScene);
  SCENES = scenes;
  const proj = d.project ? normalizeProjectTimeline(d.project) : {...newProjectTimeline(), clips: scenes.map(sceneBlock)};
  // kitaplık: kayıtlı değilse kullanılan dosyalardan oluştur
  LIB = d.lib || [];
  for (const v of [...scenes, proj]) for (const it of [...v.clips.filter(c => !c.scene), ...v.overlays, ...v.audios]) if (!LIB.find(x => x.path === it.path))
    LIB.push({id: uid(), path: it.path, name: it.name, kind: v.audios.includes(it) ? 'audio' : 'video', dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio !== false});
  LIB.forEach(it => ensureVisuals(it, it.kind === 'video'));
  applySubStyle(d.style);
  POSTER = d.poster || null; posterImg = null; posterImgPath = null; STORY = d.story || null;
  if (d.output){ $('outRes').value = d.output.res; $('outFps').value = d.output.fps; $('outCrf').value = d.output.crf; $('outPreset').value = d.output.preset; $('burnSubs').checked = d.output.burn; }
  projPath = p;
  // eski dosyalardaki altyazılar artık projede: altyazı varsa proje görünümünde aç
  const view = d.view === 'project' || sceneById(d.view) ? d.view : (sceneById(d.cur) && !(d.cues || []).length ? d.cur : ((d.cues || []).length ? 'project' : scenes[0].id));
  startProject(scenes, proj, d.cues || [], view);
  toast('Proje açıldı'); addRecent(p);
}
let newProjFolder = null;   // giriş sayfasında açık klasörde başlatılan proje ilk kayıtta o klasöre girer
function newProject(){
  projPath = null; LIB = []; newProjFolder = homeFolder; POSTER = null; STORY = null;
  const sc = {...newScene('Sahne 1')};
  SCENES = [sc];
  const proj = newProjectTimeline(); proj.clips.push(sceneBlock(sc));
  startProject([sc], proj, [], sc.id);
  toast('Yeni proje oluşturuldu. İlk sahne açık: video, ses ve katman ekleyebilirsin.');
}
/* ---- Giriş sayfası ---- */
function showHome(on){
  if (on) pause();
  document.body.classList.toggle('home', on);
  if (on) renderProjects(); else { renderTimeline(); sizeCanvas(); draw(); }
}
$('newProject').onclick = () => { if (!document.body.classList.contains('home') && !okToLeave()) return; newProject(); };
$('goHome').onclick = () => { if (okToLeave()){ dirty = false; showHome(true); } };

/* ================= Projeler (son kaydedilen / açılanlar) ================= */
const RECENT_KEY = 'reelix-projects';
function getRecent(){ try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e){ return []; } }
function setRecent(list){ try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 200))); } catch (e){} }
// projenin toplam süresi (hangi görünüm açık olursa olsun)
function projectDuration(){
  if (VIEW === 'project') return TOTAL;
  storeView(); sceneCache.clear();
  const pl = layoutClips(PROJ.clips, false, false, 1), end = pl.length ? pl[pl.length - 1].t0 + pl[pl.length - 1].len : 0;
  const r = Math.max(end, ...PROJ.audios.map(a => a.start + audioLen(a)), ...PROJ.overlays.map(o => o.start + clipLen(o)), ...PROJ.cues.map(c => c.end), 0);
  sceneCache.clear();
  return r;
}
function addRecent(p, folder){
  const old = getRecent().find(x => x.path === p);
  if (folder === undefined) folder = old ? old.folder : null;
  setRecent([{path: p, name: stem(p), t: Date.now(), dur: projectDuration(), scenes: SCENES.length, folder: folder || null}, ...getRecent().filter(x => x.path !== p)]);
  renderProjects();
}
/* ---- Proje klasörleri (yalnızca listede gruplama; dosyalar yerinde kalır) ---- */
const FOLDER_KEY = 'reelix-folders';
let homeFolder = null, renamingFolder = null, renamingProj = null;
function getFolders(){ try { return JSON.parse(localStorage.getItem(FOLDER_KEY) || '[]'); } catch (e){ return []; } }
function setFolders(list){ try { localStorage.setItem(FOLDER_KEY, JSON.stringify(list)); } catch (e){} }
const folderOf = x => x.folder && getFolders().some(f => f.id === x.folder) ? x.folder : null;
function moveProject(i, folder){
  const list = getRecent(); if (!list[i]) return;
  list[i].folder = folder || null; setRecent(list); renderProjects();
}
async function renderProjects(){
  const list = getRecent(), folders = getFolders();
  if (homeFolder && !folders.some(f => f.id === homeFolder)) homeFolder = null;
  const cur = folders.find(f => f.id === homeFolder);
  $('projCrumb').innerHTML = cur ? `<span class="crumb" data-fdrop="">Projeler</span> › ${esc(cur.name)}` : 'Projeler';
  const shown = list.map((x, i) => [x, i]).filter(([x]) => folderOf(x) === homeFolder);
  const ok = await Promise.all(shown.map(([x]) => api.exists(x.path)));
  const date = t => new Date(t).toLocaleString('tr-TR', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  const fRows = cur ? '' : folders.map(f => {
    const n = list.filter(x => folderOf(x) === f.id).length;
    return `
    <div class="prow pfolder" data-fid="${f.id}" data-fdrop="${f.id}">
      <div class="pic">${ICON.folder}</div>
      <div class="pmeta">${renamingFolder === f.id ? `<input class="fname" value="${esc(f.name)}">` : `<div class="pn">${esc(f.name)}</div>`}
        <div class="ps">${n ? `${n} proje` : 'Boş klasör'}</div></div>
      <button class="ic" data-fren="${f.id}" title="Yeniden adlandır">${ICON.edit}</button>
      <button class="ic" data-fdel="${f.id}" title="Klasörü sil">${ICON.close}</button>
    </div>`; }).join('');
  const pRows = shown.map(([x, i], j) => `
    <div class="prow ${ok[j] ? '' : 'missing'} ${x.path === projPath ? 'cur' : ''}" data-pi="${i}" draggable="${renamingProj !== x.path}" title="${esc(x.path)}">
      <div class="pic">${ICON.scenes}</div>
      <div class="pmeta">${renamingProj === x.path ? `<input class="fname" value="${esc(x.name)}">` : `<div class="pn">${esc(x.name)}</div>`}
        <div class="ps">${ok[j] ? `${date(x.t)} · ${fmt(x.dur || 0, 0)}${x.scenes ? ` · ${x.scenes} sahne` : ''}` : 'Dosya bulunamadı'}</div></div>
      ${ok[j] ? `<button class="ic" data-pren="${i}" title="Yeniden adlandır">${ICON.edit}</button>` : ''}
      ${folders.length ? `<button class="ic" data-pmove="${i}" title="Klasöre taşı">${ICON.moveTo}</button>` : ''}
      <button class="ic" data-pdel="${i}" title="Listeden kaldır">${ICON.close}</button>
    </div>`).join('');
  const empty = cur ? '<div class="empty">Bu klasör boş.<br>Projeleri buraya taşımak için Projeler\'e dönüp klasörün üstüne sürükle.</div>'
    : '<div class="empty">Henüz proje yok.<br>Üst çubuktaki <b>Kaydet</b> ile kaydettiğin projeler burada görünür.</div>';
  $('projList').innerHTML = fRows + pRows || empty;
  const inp = $('projList').querySelector('.fname');
  if (inp){
    inp.focus(); inp.select();
    const commit = async () => {
      if (renamingProj !== null){ const old = renamingProj; renamingProj = null; await renameProject(old, inp.value); return; }
      if (renamingFolder === null) return;
      const fs = getFolders(), f = fs.find(x => x.id === renamingFolder), v = inp.value.trim();
      if (f && v) f.name = v;
      renamingFolder = null; setFolders(fs); renderProjects();
    };
    inp.onkeydown = e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape'){ renamingFolder = renamingProj = null; renderProjects(); } };
    inp.onblur = commit;
  }
}
// proje dosyasını yeniden adlandır, listeyi ve açık projeyi güncelle
async function renameProject(old, name){
  name = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  if (!name || name === stem(old)){ renderProjects(); return; }
  let p; try { p = await api.renameProject(old, name); } catch (e){ toast(`Ad değiştirilemedi: ${e.message.replace(/^.*Error: /, '')}`, 'err'); renderProjects(); return; }
  setRecent(getRecent().map(x => x.path === old ? {...x, path: p, name: stem(p)} : x));
  if (projPath === old){ projPath = p; updateTitle(); }
  renderProjects();
}
$('newFolder').onclick = () => {
  const f = {id: uid(), name: 'Yeni klasör'};
  setFolders([...getFolders(), f]); homeFolder = null; renamingProj = null; renamingFolder = f.id; renderProjects();
};
// projeyi klasöre sürükle-bırak (Projeler bağlantısına bırakınca klasörden çıkar)
$('home').addEventListener('dragstart', e => { const r = e.target.closest('[data-pi]'); if (r) e.dataTransfer.setData('text/reelix-proj', r.dataset.pi); });
$('home').addEventListener('dragover', e => {
  const t = e.target.closest('[data-fdrop]');
  if (!t || !e.dataTransfer.types.includes('text/reelix-proj')) return;
  e.preventDefault(); e.stopPropagation();
  $('home').querySelectorAll('.drop').forEach(x => x !== t && x.classList.remove('drop')); t.classList.add('drop');
});
$('home').addEventListener('dragleave', e => { const t = e.target.closest('[data-fdrop]'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop'); });
$('home').addEventListener('drop', e => {
  const t = e.target.closest('[data-fdrop]'), pi = e.dataTransfer.getData('text/reelix-proj');
  if (!t || pi === '') return;
  e.preventDefault(); e.stopPropagation(); t.classList.remove('drop');
  moveProject(+pi, t.dataset.fdrop);
});
$('projCrumb').addEventListener('click', e => { if (e.target.closest('.crumb')){ homeFolder = null; renderProjects(); } });
// taşı menüsü
function openMoveMenu(btn, i){
  const pop = $('popMove'), cur = folderOf(getRecent()[i] || {});
  pop.innerHTML = '<div class="ptitle2">Klasöre taşı</div>' +
    [{id: '', name: 'Projeler (klasörsüz)'}, ...getFolders()].map(f => `<button class="mi ${(f.id || null) === cur ? 'on' : ''}" data-mto="${f.id}">${esc(f.name)}</button>`).join('');
  pop.querySelectorAll('[data-mto]').forEach(b => b.onclick = () => { pop.hidden = true; moveProject(i, b.dataset.mto); });
  const r = btn.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(window.innerWidth - 250, r.right - 240)) + 'px';
  pop.hidden = false;
}
$('projList').addEventListener('click', e => {
  if (e.target.closest('.fname')) return;
  const mv = e.target.closest('[data-pmove]');
  if (mv){ e.stopPropagation(); openMoveMenu(mv, +mv.dataset.pmove); return; }
  const pren = e.target.closest('[data-pren]');
  if (pren){ const x = getRecent()[+pren.dataset.pren]; if (x){ renamingFolder = null; renamingProj = x.path; renderProjects(); } return; }
  const fren = e.target.closest('[data-fren]');
  if (fren){ renamingProj = null; renamingFolder = fren.dataset.fren; renderProjects(); return; }
  const fdel = e.target.closest('[data-fdel]');
  if (fdel){
    const f = getFolders().find(x => x.id === fdel.dataset.fdel); if (!f) return;
    if (!confirm(`"${f.name}" klasörü silinsin mi? İçindeki projeler Projeler listesine taşınır, dosyalar silinmez.`)) return;
    setFolders(getFolders().filter(x => x.id !== f.id));
    setRecent(getRecent().map(x => x.folder === f.id ? {...x, folder: null} : x)); renderProjects(); return;
  }
  const frow = e.target.closest('[data-fid]');
  if (frow){ homeFolder = frow.dataset.fid; renderProjects(); return; }
  if (!e.target.closest('[data-pdel]') && !document.body.classList.contains('home') && !okToLeave()) return;
  const list = getRecent(), del = e.target.closest('[data-pdel]');
  if (del){ list.splice(+del.dataset.pdel, 1); setRecent(list); renderProjects(); return; }
  const row = e.target.closest('[data-pi]'); if (!row) return;
  const x = list[+row.dataset.pi]; if (!x) return;
  if (row.classList.contains('missing')){ toast('Proje dosyası bulunamadı. Taşındıysa Dosyadan aç ile seç.', 'err'); return; }
  openProjectPath(x.path);
});
renderProjects();
mediaMigration = migrateAllMedia();
function updateTitle(){
  $('projTitle').textContent = projPath ? stem(projPath) : 'Adsız proje';
  const where = VIEW === 'project' ? 'Proje' : ((sceneById(curScene) || {}).name || '');
  $('projSub').textContent = where + (TOTAL > 0 ? ` · ${fmt(TOTAL)}` : '');
}

/* ================= Genel ================= */
function updateButtons(){
  const has = ENG.L.length > 0;
  $('hint').style.display = has || L.length ? 'none' : '';
  $('hint').innerHTML = VIEW === 'project' ? 'Projede henüz videolu sahne yok.<br>Üstteki sekmelerden bir sahne açıp video ekle' : 'Video eklemek için <b>İçe aktar</b>\'a tıkla<br>veya dosyaları buraya sürükle';
  $('exportBtn').disabled = !has || !!exportJob;
  $('topExport').disabled = !has;
  $('exportCancel').disabled = !exportJob;
  $('exportClose').disabled = !!exportJob;
  $('exportReveal').disabled = !lastExport;
  $('exportToSplit').disabled = !lastExport;
  $('splitUseExport').disabled = !lastExport;
  const subSrc = subSourceItems().length > 0 || audibleSources().length > 0;
  $('autoSubs').disabled = !subSrc || subBusy || VIEW !== 'project';
  const nSubs = subsOnly().length;
  $('resync').disabled = !subSrc || !nSubs || subBusy;
  $('subSrc').textContent = subSourceLabel();
  $('saveSrt').disabled = !nSubs;
  $('clearSubs').disabled = !nSubs;
  $('cutBtn').disabled = !has || VIEW === 'project' && ![...multi].some(k => !(itemByKey(k) || {}).scene);
  $('delBtn').disabled = inspMode === 'project';
  const media_ = [...multi].filter(isMediaKey).length;
  $('muteBtn').disabled = !media_;
  $('groupBtn').disabled = media_ < 2;
  $('ungroupBtn').disabled = ![...multi].some(k => (itemByKey(k) || {}).gid);
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
  $('splitRun').disabled = !splitSrc || !!splitJob;
  $('splitCancel').disabled = !splitJob;
  $('splitReveal').disabled = !splitOutDir;
}
// Bağlantı: sesler/altyazılar altındaki video klibe bağlıdır; klip zaman çizelgesinde kayınca onlar da kayar
let linkFreeze = false, prevT0 = new Map();
const anchors = new WeakMap();
function applyLinkage(){
  if (!linkFreeze && OPT.link){
    const now = new Map(L.map(o => [o.c.id, o.t0]));
    const shift = obj => { const a = anchors.get(obj); if (!a || !now.has(a) || !prevT0.has(a)) return 0; return now.get(a) - prevT0.get(a); };
    if (OPT.linkAudio) for (const a of P.audios){ const d = shift(a); if (Math.abs(d) > 1e-6) a.start = Math.max(0, a.start + d); }
    if (OPT.linkOver) for (const o of P.overlays){ const d = shift(o); if (Math.abs(d) > 1e-6) o.start = Math.max(0, o.start + d); }
    if (OPT.linkSubs) for (const c of P.cues){ const d = shift(c); if (Math.abs(d) > 1e-6){ c.start += d; c.end += d; c.words.forEach(w => { w.s += d; w.e += d; }); } }
    P.cues.sort((x, y) => x.start - y.start);
  }
  linkFreeze = false;
}
function rememberAnchors(){
  prevT0 = new Map(L.map(o => [o.c.id, o.t0]));
  const under = t => { const r = L.filter(o => t >= o.t0 - 1e-6 && t < o.t0 + o.len); return r.length ? r[r.length - 1].c.id : null; };
  for (const a of P.audios) anchors.set(a, under(a.start));
  for (const o of P.overlays) anchors.set(o, under(o.start));
  for (const c of P.cues) anchors.set(c, under(c.start));
}
function refresh(){
  P.cues.forEach(c => { if (!c.id) c.id = uid(); });
  normalizeSelection(); compactTracks();
  relayout(); applyLinkage(); relayout(); rememberAnchors(); sizeCanvas();
  renderTimeline(); renderInspector(); renderSubInfo(); renderTransTab(); renderFxTab(); renderLibrary(); renderSceneBar();
  trackHistory();
  updateButtons(); updateTime(); updateTitle();
  if (!playing) draw();
}

setPlayIcon();
renderLibrary();
refresh();
requestAnimationFrame(tick);
