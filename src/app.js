/* Reelix — uygulama mantığı (CapCut tarzı düzen: kitaplık · oynatıcı · denetçi · zaman çizelgesi) */
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');

const DEF_ENV = () => [{t: 0, v: 1}, {t: 1, v: 1}];
const P = { clips: [], audios: [], overlays: [], cues: [], fadeStart: false, fadeEnd: false, edgeD: 1, defTr: {type: 'fadeblack', d: 1} };
let LIB = [];                     // içe aktarılan dosyalar
const media = new Map();          // id -> <video>/<audio>
let L = [], TOTAL = 0, VEND = 0;  // klip yerleşimi; VEND = videonun bittiği an, TOTAL = proje süresi (ses daha uzunsa uzar)
let sel = null, selAud = null, selCue = -1, selTr = 0, inspMode = 'project', inspTab = 'video';
let multi = new Set();            // çoklu seçim: 'c:<id>' (klip) / 'a:<id>' (ses) / 'o:<id>' (video katmanı)
let selOv = null;                 // seçili video katmanı
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
const clipLen = c => Math.max(0.1, c.out - c.in);
function trOf(i){
  const a = P.clips[i], b = P.clips[i + 1];
  if (!a || !b || !a.tr || a.tr.type === 'none' || (b.gap || 0) > 0.001) return null;
  const d = Math.min(a.tr.d, clipLen(a) / 2, clipLen(b) / 2);
  return d >= 0.05 ? {type: a.tr.type, d} : null;
}
function relayout(){
  let t = 0;
  L = P.clips.map((c, i) => {
    t += c.gap || 0;   // mıknatıs kapalıyken klibin önündeki boşluk
    const o = {c, i, t0: t, len: clipLen(c)};
    const tr = trOf(i); t += o.len - (tr ? tr.d : 0);
    return o;
  });
  VEND = L.length ? L[L.length - 1].t0 + L[L.length - 1].len : 0;
  TOTAL = Math.max(VEND, ...P.audios.map(a => a.start + audioLen(a)), ...P.overlays.map(o => o.start + clipLen(o)), 0);
  if (T > TOTAL) T = TOTAL;
  if (selTr > P.clips.length - 2) selTr = Math.max(0, P.clips.length - 2);
}
function activeAt(t){
  const r = L.filter(o => t >= o.t0 && t < o.t0 + o.len);
  if (!r.length && L.length && Math.abs(t - VEND) < 1e-3) return [L[L.length - 1]];
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
function clipGainAt(i, local){
  const c = P.clips[i], len = clipLen(c);
  let g = c.muted ? 0 : c.vol * envAt(c.env, local / len);
  if (c.fadeIn > 0 && local < c.fadeIn) g *= local / c.fadeIn;
  if (c.fadeOut > 0 && local > len - c.fadeOut) g *= Math.max(0, (len - local) / c.fadeOut);
  if (i === 0 && P.fadeStart) g *= clamp(local / P.edgeD, 0, 1);
  if (i === P.clips.length - 1 && P.fadeEnd) g *= clamp((len - local) / P.edgeD, 0, 1);
  const ti = trOf(i - 1); if (ti && local < ti.d) g *= local / ti.d;
  const to = trOf(i); if (to && local > len - to.d) g *= (len - local) / to.d;
  return g;
}
function edgeDark(t){
  let a = 0;
  if (P.fadeStart && t < P.edgeD) a = Math.max(a, 1 - t / P.edgeD);
  if (P.fadeEnd && t > VEND - P.edgeD && t < VEND) a = Math.max(a, 1 - (VEND - t) / P.edgeD);
  return clamp(a, 0, 1);
}
// ses katmanının zaman çizelgesindeki uzunluğu: kullanıcı ayarlar; döngü kapalıyken dosyanın kalan süresini geçemez
const audioMax = a => a.loop ? 36000 : Math.max(0.1, a.dur - a.trimIn);
function audioLen(a){
  return clamp(a.len ?? (a.dur - a.trimIn), 0.1, audioMax(a));
}
function audioGain(a, local, len){
  let g = a.muted ? 0 : a.vol * envAt(a.env, len > 0 ? local / len : 0);
  if (a.fadeIn > 0 && local < a.fadeIn) g *= local / a.fadeIn;
  if (a.fadeOut > 0 && local > len - a.fadeOut) g *= Math.max(0, (len - local) / a.fadeOut);
  return g;
}
function outRes(){
  const v = $('outRes').value; let W, H;
  if (v === 'auto'){ const c = P.clips[0]; W = c && c.w ? c.w : 1920; H = c && c.h ? c.h : 1080; }
  else [W, H] = v.split('x').map(Number);
  return {W: Math.max(2, W & ~1), H: Math.max(2, H & ~1)};
}
function outFps(){
  const v = $('outFps').value; if (v !== 'auto') return +v;
  const f = (P.clips[0] && P.clips[0].fps) || 30;
  return f > 45 ? 60 : f > 27 ? 30 : f > 24.5 ? 25 : f > 20 ? 24 : 30;
}

/* ================= Medya ================= */
function makeMedia(item, tag){
  const el = document.createElement(tag);
  el.preload = 'auto'; el.src = fileUrl(item.path);
  el.addEventListener('seeked', () => { if (!playing) draw(); });
  el.addEventListener('loadeddata', () => { if (!playing) draw(); });
  el.addEventListener('error', () => toast(`${item.name} önizlemede oynatılamıyor. Dışa aktarma yine çalışır.`, 'err'));
  media.set(item.id, el);
  return el;
}
function dropMedia(id){
  const el = media.get(id); if (!el) return;
  el.pause(); el.removeAttribute('src'); el.load(); media.delete(id);
}
// Küçük resim şeridi ve dalga formu (dosya başına bir kez, diskte önbellekli)
const visualJobs = new Map(), visCache = new Map();
const visKey = it => it.path + '|' + it.dur;
function applyVisuals(key){
  const v = visCache.get(key); if (!v) return;
  for (const it of [...LIB, ...P.clips, ...P.audios, ...P.overlays]) if (visKey(it) === key) Object.assign(it, v);
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
async function importFiles(paths){
  const added = [];
  for (const p of paths){
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
  const c = {id: uid(), path: it.path, name: it.name, dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio,
             in: 0, out: it.dur, vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0, tr: null};
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
             trimIn: 0, fadeIn: 0, fadeOut: 1, loop: false, hasAudio: true};
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
$('addVideo').onclick = async () => { await importFiles(await api.openFiles('video', true)); };
$('addAudio').onclick = async () => { await importFiles(await api.openFiles('audio', true)); showTab('audio'); };

function tileHtml(it){
  const used = it.kind === 'video' ? [...P.clips, ...P.overlays].filter(c => c.path === it.path).length : P.audios.filter(a => a.path === it.path).length;
  let th = '';
  if (it.kind === 'video' && it.thumb){
    const N = it.thumbN, idx = Math.floor(N / 2);
    th = `style="background-image:url('${fileUrl(it.thumb)}');background-size:${N * 100}% 100%;background-position:${(idx / Math.max(1, N - 1) * 100).toFixed(2)}% 0"`;
  }
  return `<div class="tile" draggable="true" data-lib="${it.id}" title="${esc(it.path)}">
    <div class="th ${it.kind === 'audio' ? 'audio' : ''}" ${th}>${it.kind === 'audio' ? ICON.audio : ''}
      <span class="dur">${fmt(it.dur, 0)}</span>${used ? `<span class="used">Kullanıldı${used > 1 ? ' ×' + used : ''}</span>` : ''}
      <span class="add" data-add="${it.id}" title="Zaman çizelgesine ekle">+</span>${it.kind === 'video' ? `<span class="add ovadd" data-addov="${it.id}" title="Oynatma kafasına video katmanı olarak ekle">${ICON.layers}</span>` : ''}</div>
    <div class="nm">${esc(it.name)}</div></div>`;
}
function renderLibrary(){
  const vids = LIB.filter(x => x.kind === 'video'), auds = LIB.filter(x => x.kind === 'audio');
  $('mediaGrid').innerHTML = vids.length ? vids.map(tileHtml).join('')
    : '<div class="empty">Video eklemek için <b>İçe aktar</b>\'a tıkla<br>veya dosyaları pencereye sürükle</div>';
  $('audioGrid').innerHTML = auds.length ? auds.map(tileHtml).join('')
    : '<div class="empty">Müzik veya ses eklemek için <b>Ses içe aktar</b>\'a tıkla</div>';
}
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
    const a = e.target.closest('[data-add]'); if (a) addFromLib(a.dataset.add);
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
  const media_ = paths.filter(p => VIDEO_EXT.includes(extname(p)) || AUDIO_EXT.includes(extname(p)));
  const subs = paths.filter(p => ['srt','vtt'].includes(extname(p)));
  if ($('tab-split').classList.contains('on') && media_.length){ setSplitSrc(media_[0]); return; }
  await addVideos(media_);
  if (subs.length) loadSubsFrom(subs[0]);
});

/* ================= Oynatma ================= */
function setPlayIcon(){ $('play').innerHTML = playing ? ICON.pause : ICON.play; }
function play(){
  if (!L.length) return;
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
  for (const o of L){
    const v = media.get(o.c.id); if (!v) continue;
    const local = at - o.t0;
    if (ids.has(o.c.id)){
      const target = o.c.in + clamp(local, 0, o.len - 0.01);
      if (playing){
        if (v.paused){ if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
      } else if (force && !v.seeking && Math.abs(v.currentTime - target) > 0.01) v.currentTime = target;
      v.volume = clamp(clipGainAt(o.i, local), 0, 1);
    } else {
      if (!v.paused) v.pause();
      if (local < 0 && local > -1.5 && !v.seeking && Math.abs(v.currentTime - o.c.in) > 0.05) v.currentTime = o.c.in;
    }
  }
}
/* ================= Video katmanları (overlay) ================= */
const ovActive = t => P.overlays.filter(o => t >= o.start && t < o.start + clipLen(o)).sort((a, b) => (a.track ?? 0) - (b.track ?? 0));
// katmanın önizlemedeki dikdörtgeni (kare içine sığdırılıp ölçeklenir)
function ovRect(o, W, H){
  const vw = o.w || 16, vh = o.h || 9, fit = Math.min(W / vw, H / vh) * (o.scale ?? 1);
  const w = vw * fit, h = vh * fit;
  return {x: (o.x ?? 0.5) * W - w / 2, y: (o.y ?? 0.5) * H - h / 2, w, h};
}
function drawOverlays(g, t, W, H, ui){
  for (const o of ovActive(t)){
    const v = media.get(o.id); if (!v || v.readyState < 2) continue;
    const r = ovRect(o, W, H);
    g.save(); g.globalAlpha = o.opacity ?? 1; g.drawImage(v, r.x, r.y, r.w, r.h); g.restore();
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
  for (const o of P.overlays){
    const v = media.get(o.id); if (!v) continue;
    const len = clipLen(o), local = at - o.start;
    if (local >= 0 && local < len){
      const target = o.in + clamp(local, 0, len - 0.01);
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
const OV_KEEP = ['id', 'path', 'name', 'dur', 'w', 'h', 'fps', 'hasAudio', 'in', 'out', 'vol', 'muted', 'env', 'fadeIn', 'fadeOut', 'gid', 'thumb', 'thumbN', 'wave'];
const ovOverlaps = (o, list = P.overlays) => list.some(x => x !== o && (x.track ?? 0) === (o.track ?? 0) && x.start < o.start + clipLen(o) - 0.01 && x.start + clipLen(x) > o.start + 0.01);
function newOverlay(it, start, track){
  const o = {id: uid(), path: it.path, name: it.name, dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio,
             in: 0, out: it.dur, start: Math.max(0, start), track: track ?? 0, vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0,
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
  for (const a of P.audios){
    const el = media.get(a.id); if (!el) continue;
    const len = audioLen(a), local = T - a.start;
    if (playing && local >= 0 && local < len){
      const avail = Math.max(0.01, a.dur - a.trimIn);
      const pos = local < avail ? a.trimIn + local : (local - avail) % Math.max(0.01, a.dur);
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
function draw(){
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const t = viewT(), act = activeAt(t);
  if (act.length === 1) drawFit(ctx, media.get(act[0].c.id), W, H);
  else if (act.length >= 2){
    const A = act[0], B = act[1], tr = trOf(A.i);
    const p = tr ? clamp((t - B.t0) / tr.d, 0, 1) : 1;
    drawTransition(ctx, tr ? tr.type : 'fade', g => drawFit(g, media.get(A.c.id), W, H), g => drawFit(g, media.get(B.c.id), W, H), p, W, H);
  }
  const dk = edgeDark(t);
  if (dk > 0){ ctx.fillStyle = `rgba(0,0,0,${dk})`; ctx.fillRect(0, 0, W, H); }
  drawOverlays(ctx, t, W, H, true);
  if (P.cues.length) drawSubsAt(ctx, P.cues, t, W, H);
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
window.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (typing) return;
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
  $('posY').value = clamp((e.clientY - r.top) / r.height * 100 + S.size * 0.5, 0, 100);
  readSubSettings();
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
  if (!o || (!corner && !hitOv(o))){ o = ovActive(t).reverse().find(hitOv); corner = false; }
  if (!o) return;
  e.stopImmediatePropagation(); pause();
  if (!(inspMode === 'overlay' && selOv === o.id)){ multi = new Set(groupKeys('o:' + o.id)); setPrimary('o:' + o.id); refresh(); }
  const r = ovRect(o, W, H), c0 = {x: r.x + r.w / 2, y: r.y + r.h / 2}, d0 = Math.hypot(p.x - c0.x, p.y - c0.y) || 1;
  ovDrag = {o, corner, p0: p, x0: o.x ?? 0.5, y0: o.y ?? 0.5, s0: o.scale ?? 1, c0, d0};
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!ovDrag) return;
  const p = canvasPt(e), d = ovDrag;
  if (d.corner) d.o.scale = clamp(d.s0 * Math.hypot(p.x - d.c0.x, p.y - d.c0.y) / d.d0, 0.05, 4);
  else { d.o.x = clamp(d.x0 + (p.x - d.p0.x) / cv.width, -0.5, 1.5); d.o.y = clamp(d.y0 + (p.y - d.p0.y) / cv.height, -0.5, 1.5); }
  draw();
});
cv.addEventListener('pointerup', () => { if (ovDrag){ ovDrag = null; refresh(); } });
cv.addEventListener('pointerdown', e => {
  if (!P.cues.length) return;
  subDrag = true; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; setPosFromEvent(e);
  if (inspMode !== 'text'){ inspMode = 'text'; renderInspector(); }
});
cv.addEventListener('pointermove', e => subDrag && setPosFromEvent(e));
cv.addEventListener('pointerup', () => { subDrag = false; cv.style.cursor = 'grab'; });

/* ================= Araç çubuğu eylemleri ================= */
/* ---- Seçim ve gruplar ---- */
function itemByKey(k){
  const id = k.slice(2);
  return k[0] === 'c' ? P.clips.find(c => c.id === id) : k[0] === 'o' ? P.overlays.find(o => o.id === id) : P.audios.find(a => a.id === id);
}
const keyOfEl = b => b.dataset.clip ? 'c:' + b.dataset.clip : b.dataset.ov ? 'o:' + b.dataset.ov : 'a:' + b.dataset.aud;
function setPrimary(k){
  const id = k.slice(2);
  if (k[0] === 'c'){ sel = id; inspMode = 'clip'; } else if (k[0] === 'o'){ selOv = id; inspMode = 'overlay'; } else { selAud = id; inspMode = 'audio'; }
}
const isItemMode = () => inspMode === 'clip' || inspMode === 'audio' || inspMode === 'overlay';
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
  else if (!isItemMode()) multi.clear();
}
function groupSelected(){
  if (multi.size < 2){ toast('Gruplamak için en az iki öğe seç (⇧ veya ⌘ ile tıkla)'); return; }
  const gid = uid();
  multi.forEach(k => { const it = itemByKey(k); if (it) it.gid = gid; });
  refresh(); toast(`${multi.size} öğe gruplandı. Birini kestiğinde diğerleri de aynı yerden kesilir.`);
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
function cutClip(c, local, gid){
  const len = clipLen(c); if (local < 0.05 || local > len - 0.05) return null;
  const [envA, envB] = splitEnv(c.env || DEF_ENV(), local / len);
  const c2 = {...c, id: uid(), in: c.in + local, env: envB, tr: c.tr, fadeIn: 0};
  if (gid) c2.gid = gid; else delete c2.gid;
  c.out = c.in + local; c.tr = null; c.env = envA; c.fadeOut = 0;
  P.clips.splice(P.clips.indexOf(c) + 1, 0, c2); makeMedia(c2, 'video');
  return c2;
}
function cutOverlay(o, local, gid){
  const len = clipLen(o); if (local < 0.05 || local > len - 0.05) return null;
  const [envA, envB] = splitEnv(o.env || DEF_ENV(), local / len);
  const o2 = {...o, id: uid(), start: o.start + local, in: o.in + local, env: envB, fadeIn: 0};
  if (gid) o2.gid = gid; else delete o2.gid;
  o.out = o.in + local; o.env = envA; o.fadeOut = 0;
  P.overlays.splice(P.overlays.indexOf(o) + 1, 0, o2); makeMedia(o2, 'video');
  return o2;
}
function cutAudio(a, local, gid){
  const len = audioLen(a); if (local < 0.05 || local > len - 0.05) return null;
  const avail = Math.max(0.01, a.dur - a.trimIn);
  const [envA, envB] = splitEnv(a.env || DEF_ENV(), local / len);
  const a2 = {...a, id: uid(), start: a.start + local, trimIn: local < avail ? a.trimIn + local : (local - avail) % a.dur,
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
    const it = itemByKey(k); if (!it) return null;
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
  let keys = [...multi];
  if (!keys.length){ const act = activeAt(T); if (!act.length) return; keys = ['c:' + act[act.length - 1].c.id]; }
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
  if (open){ const r = b.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.min(window.innerWidth - 250, r.left - 180) + 'px'; pop.hidden = false; }
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
      if (k[0] === 'c') removeClip(id); else if (k[0] === 'o') P.overlays = P.overlays.filter(o => o.id !== id); else P.audios = P.audios.filter(a => a.id !== id);
      dropMedia(id);
    });
    multi.clear(); sel = null; selAud = null; selOv = null; inspMode = 'project';
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
function toggleMuteSelected(){
  const items = [...multi].map(itemByKey).filter(Boolean);
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
  const strip = ({thumb, thumbN, wave, ...r}) => r;
  return JSON.stringify({clips: P.clips.map(strip), audios: P.audios.map(strip), overlays: P.overlays.map(strip), cues: P.cues,
    fadeStart: P.fadeStart, fadeEnd: P.fadeEnd, edgeD: P.edgeD});
}
function trackHistory(){
  if (restoring) return;
  const s = snapshot();
  if (lastSnap !== null && s !== lastSnap){ undoStack.push(lastSnap); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; }
  lastSnap = s;
}
function restore(s){
  restoring = true; pause();
  const d = JSON.parse(s);
  d.overlays = d.overlays || [];
  const want = new Set([...d.clips.map(c => c.id), ...d.audios.map(a => a.id), ...d.overlays.map(o => o.id)]);
  for (const id of [...media.keys()]) if (!want.has(id)) dropMedia(id);
  P.clips = d.clips; P.audios = d.audios; P.overlays = d.overlays; P.cues = d.cues;
  P.fadeStart = d.fadeStart; P.fadeEnd = d.fadeEnd; P.edgeD = d.edgeD;
  P.clips.forEach(c => { if (!media.has(c.id)) makeMedia(c, 'video'); });
  P.audios.forEach(a => { if (!media.has(a.id)) makeMedia(a, 'audio'); });
  P.overlays.forEach(o => { if (!media.has(o.id)) makeMedia(o, 'video'); });
  for (const it of [...P.clips, ...P.audios, ...P.overlays]) Object.assign(it, visCache.get(visKey(it)) || {});
  if (!P.overlays.find(o => o.id === selOv)){ selOv = null; if (inspMode === 'overlay') inspMode = 'project'; }
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
  return `<label>${label}<span class="pair"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="v" id="${id}V">${show(val)}</span></span></label>`;
}
function bindRangeLive(id, show, onInput){
  const el = $(id); if (!el) return;
  el.addEventListener('input', () => { $(id + 'V').textContent = show(+el.value); onInput(+el.value); renderTimeline(); syncVideos(false); syncAudio(false); });
  el.addEventListener('change', () => refresh());
}
const pct = v => Math.round(v * 100) + '%', secs = v => (+v).toFixed(1) + ' sn';
function renderInspector(){
  const head = $('inspHead'), dyn = $('inspDyn');
  $('inspText').style.display = inspMode === 'text' ? '' : 'none';
  const c = P.clips.find(x => x.id === sel), a = P.audios.find(x => x.id === selAud);
  if (inspMode === 'clip' && !c) inspMode = 'project';
  if (inspMode === 'audio' && !a) inspMode = 'project';
  const ov = P.overlays.find(x => x.id === selOv);
  if (inspMode === 'overlay' && !ov) inspMode = 'project';
  if (inspMode === 'trans' && P.clips.length < 2) inspMode = 'project';

  if (isItemMode() && multi.size > 1){
    const items = [...multi].map(itemByKey).filter(Boolean);
    const gids = new Set(items.map(it => it.gid || '-'));
    const grouped = gids.size === 1 && !gids.has('-');
    head.textContent = `${items.length} öğe seçili`;
    dyn.innerHTML = `
      <div class="kv"><span>Video klip</span><span>${[...multi].filter(k => k[0] === 'c').length}</span><span>Video katmanı</span><span>${[...multi].filter(k => k[0] === 'o').length}</span><span>Ses</span><span>${[...multi].filter(k => k[0] === 'a').length}</span>
        <span>Durum</span><span>${grouped ? 'Gruplu' : 'Grupsuz'}</span></div>
      <p class="note">${grouped ? 'Bu öğelerden birini kestiğinde diğerleri de aynı yerden kesilir.' : 'Gruplayınca birini kestiğinde diğerleri de aynı yerden kesilir.'}</p>
      <div class="row"><button class="primary sm" id="mGroup" ${grouped ? 'disabled' : ''}>Grupla ⌘G</button><button class="sec sm" id="mUngroup" ${items.some(it => it.gid) ? '' : 'disabled'}>Grubu çöz ⇧⌘G</button></div>
      <div class="row" style="margin-top:6px"><button class="sec sm" id="mCut">Oynatma kafasından kes</button><button class="sec sm" id="mDel">Sil</button></div>`;
    $('mGroup').onclick = groupSelected; $('mUngroup').onclick = ungroupSelected;
    $('mCut').onclick = cutAtPlayhead; $('mDel').onclick = deleteSelected;
    return;
  }
  if (inspMode === 'overlay'){
    head.innerHTML = `<div class="itabs"><button data-it="video" class="${inspTab === 'video' ? 'on' : ''}">Katman</button><button data-it="audio" class="${inspTab === 'audio' ? 'on' : ''}">Ses</button></div>`;
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
        <div class="row" style="margin-top:10px"><button class="sec sm" id="opMain">Ana ize taşı</button><button class="sec sm" id="opDel">Sil</button></div>`;
      const live = (id, f) => bindRangeLive(id, v => v + '%', v => { f(v); draw(); });
      live('opX', v => ov.x = v / 100); live('opY', v => ov.y = v / 100); live('opS', v => ov.scale = v / 100); live('opA', v => ov.opacity = v / 100);
      $('opFull').onclick = () => { Object.assign(ov, {x: 0.5, y: 0.5, scale: 1}); refresh(); };
      $('opPip').onclick = () => { Object.assign(ov, {x: 0.78, y: 0.24, scale: 0.35}); refresh(); };
      $('opStart').onchange = e => { ov.start = Math.max(0, +e.target.value || 0); refresh(); seek(T); };
      $('opNow').onclick = () => { ov.start = T; refresh(); seek(T); };
      $('opIn').onchange = e => { ov.in = clamp(+e.target.value || 0, 0, ov.out - 0.1); refresh(); seek(T); };
      $('opOut').onchange = e => { ov.out = clamp(+e.target.value || 0, ov.in + 0.1, ov.dur); refresh(); seek(T); };
      $('opMain').onclick = () => { pause(); const i = L.findIndex(o2 => ov.start < o2.t0 + o2.len / 2); overlayToClip(ov, i < 0 ? P.clips.length : i); refresh(); seek(T); };
      $('opDel').onclick = deleteSelected;
    } else {
      if (!ov.hasAudio){ dyn.innerHTML = '<p class="emptyi">Bu katmanda ses yok.</p>'; return; }
      const maxF = Math.min(10, len).toFixed(1);
      dyn.innerHTML = `
        <label>Sesi kapat<input type="checkbox" id="opMute" ${ov.muted ? 'checked' : ''}></label>
        ${rangeRow('opVol', 'Ses seviyesi', 0, 2, 0.01, ov.vol, pct)}
        ${rangeRow('opFi', 'Yavaşça aç', 0, maxF, 0.1, ov.fadeIn || 0, secs)}
        ${rangeRow('opFo', 'Yavaşça kapat', 0, maxF, 0.1, ov.fadeOut || 0, secs)}`;
      $('opMute').onchange = e => { ov.muted = e.target.checked; refresh(); };
      bindRangeLive('opVol', pct, v => ov.vol = v);
      bindRangeLive('opFi', secs, v => ov.fadeIn = Math.min(v, len - (ov.fadeOut || 0)));
      bindRangeLive('opFo', secs, v => ov.fadeOut = Math.min(v, len - (ov.fadeIn || 0)));
    }
    return;
  }
  if (inspMode === 'clip'){
    head.innerHTML = `<div class="itabs"><button data-it="video" class="${inspTab === 'video' ? 'on' : ''}">Video</button><button data-it="audio" class="${inspTab === 'audio' ? 'on' : ''}">Ses</button></div>`;
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
        <button class="sec" id="cpDel" style="margin-top:14px">Klibi sil</button>`;
      const setIn = v => { c.in = clamp(v, 0, c.out - 0.1); pause(); refresh(); seek(T); };
      const setOut = v => { c.out = clamp(v, c.in + 0.1, c.dur); pause(); refresh(); seek(T); };
      const srcNow = () => { const o = L.find(x => x.c.id === c.id); if (!o || T < o.t0 || T > o.t0 + o.len){ toast('Önce oynatma kafasını bu klibin üstüne getir'); return null; } return c.in + (T - o.t0); };
      $('cpIn').onchange = e => setIn(+e.target.value);
      $('cpOut').onchange = e => setOut(+e.target.value);
      $('cpInNow').onclick = () => { const s = srcNow(); if (s != null) setIn(s); };
      $('cpOutNow').onclick = () => { const s = srcNow(); if (s != null) setOut(s); };
      $('cpLeft').onclick = () => { pause(); [P.clips[i - 1], P.clips[i]] = [P.clips[i], P.clips[i - 1]]; refresh(); seek(T); };
      $('cpRight').onclick = () => { pause(); [P.clips[i + 1], P.clips[i]] = [P.clips[i], P.clips[i + 1]]; refresh(); seek(T); };
      $('cpDel').onclick = deleteSelected;
    } else {
      if (!c.hasAudio){ dyn.innerHTML = '<p class="emptyi">Bu klipte ses yok.</p>'; return; }
      const maxF = Math.min(10, len).toFixed(1);
      dyn.innerHTML = `
        <label>Sesi kapat<input type="checkbox" id="cpMute" ${c.muted ? 'checked' : ''}></label>
        ${rangeRow('cpVol', 'Ses seviyesi', 0, 2, 0.01, c.vol, pct)}
        ${rangeRow('cpFi', 'Yavaşça aç', 0, maxF, 0.1, c.fadeIn || 0, secs)}
        ${rangeRow('cpFo', 'Yavaşça kapat', 0, maxF, 0.1, c.fadeOut || 0, secs)}
        <p class="note">Zaman çizelgesinde ses bandının köşelerindeki yuvarlakları sürükleyerek de ayarlayabilirsin.</p>
        <button class="sec" id="cpReset" style="margin-top:8px">Sesi sıfırla</button>`;
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
    bindRangeLive('apVol', pct, v => a.vol = v);
    bindRangeLive('apFi', secs, v => a.fadeIn = v);
    bindRangeLive('apFo', secs, v => a.fadeOut = v);
    $('apLen').onchange = e => { a.len = clamp(+e.target.value || 0.1, 0.1, audioMax(a)); refresh(); syncAudio(true); };
    $('apFit').onclick = () => { if (VEND > a.start){ a.len = clamp(VEND - a.start, 0.1, audioMax(a)); if (!a.loop && VEND - a.start > audioMax(a)) toast('Dosya video kadar uzun değil. Daha uzun yapmak için Döngü\'yü aç.'); refresh(); } };
    $('apTrim').onchange = e => { a.trimIn = clamp(+e.target.value || 0, 0, Math.max(0, a.dur - 0.1)); a.len = audioLen(a); refresh(); };
    $('apLoop').onchange = e => { a.loop = e.target.checked; a.len = audioLen(a); refresh(); };
    $('apDel').onclick = deleteSelected;
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
    const cue = P.cues[selCue];
    $('cueEdit').innerHTML = cue ? `
      <h3>Seçili satır</h3>
      <div class="kv"><span>Zaman</span><span>${fmt(cue.start)} – ${fmt(cue.end)}</span></div>
      <textarea id="cueText" rows="3">${esc(cue.text)}</textarea>
      <div class="row" style="margin-top:6px"><button class="sec sm" id="cueDel">Satırı sil</button></div>
      <p class="note">Aşağıdaki stil ayarları tüm altyazılara uygulanır.</p>` : '<p class="note">Stil ayarları tüm altyazılara uygulanır. Metni düzenlemek için altyazı izinde bir satıra tıkla.</p>';
    if (cue){
      $('cueText').onchange = e => {
        const t = e.target.value.replace(/\s+/g, ' ').trim();
        if (!t){ P.cues.splice(selCue, 1); selCue = -1; }
        else { cue.text = t; cue.words = wordsFromText(t, cue.start, cue.end); }
        refresh();
      };
      $('cueDel').onclick = deleteSelected;
    }
  } else {
    head.textContent = 'Ayrıntılar';
    const {W, H} = outRes();
    dyn.innerHTML = L.length ? `
      <div class="kv"><span>Süre</span><span>${fmt(TOTAL)}</span><span>Klipler</span><span>${L.length}</span>
        <span>Ses katmanları</span><span>${P.audios.length}</span><span>Altyazı satırı</span><span>${P.cues.length}</span>
        <span>Çıktı</span><span>${W}×${H}, ${outFps()} fps</span></div>
      <p class="note">Ayarlarını görmek için zaman çizelgesinde bir klibe, sese, altyazıya veya geçişe tıkla.</p>`
      : '<p class="emptyi">Henüz bir şey seçilmedi.<br>Kitaplıktan bir videoyu zaman çizelgesine sürükleyerek başla.</p>';
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
    const src = c.in + off + ((i + 0.5) * tw) / k, idx = clamp(Math.floor(src / c.dur * N), 0, N - 1);
    h += `<div style="width:${tw.toFixed(1)}px;background-image:url('${url}');background-size:${(N * tw).toFixed(1)}px ${th}px;background-position:${(-idx * tw).toFixed(1)}px 0"></div>`;
  }
  return h;
}
function waveDiv(it, k, offset){
  if (!it.wave) return '';
  const u = fileUrl(it.wave);
  return `<div class="wv" style="-webkit-mask-image:url('${u}');-webkit-mask-size:${(it.dur * k).toFixed(1)}px 100%;-webkit-mask-position:${(-offset * k).toFixed(1)}px 0${it.loop ? ';-webkit-mask-repeat:repeat-x' : ''}"></div>`;
}
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
  const nOv = P.overlays.length ? Math.max(...P.overlays.map(o => (o.track ?? 0) + 1)) : 0;
  if (!nOv) h += `<div class="track otrack empty" data-scrub="1" data-otr="0"><div class="tlabel" title="Video katmanı">${ICON.layers}</div><span class="ohint">Video katmanı eklemek için videoyu buraya sürükle</span></div>`;
  for (let tr = nOv - 1; tr >= 0; tr--){
    h += `<div class="track otrack" data-scrub="1" data-otr="${tr}"><div class="tlabel" title="Video katmanı ${tr + 1}">${ICON.layers}</div>`;
    P.overlays.filter(o => (o.track ?? 0) === tr).forEach(o => {
      const len = clipLen(o), w = Math.max(6, len * k);
      h += `<div class="blk o ${multi.has('o:' + o.id) ? 'sel' : ''}${o.gid ? ' grp' : ''}" data-ov="${o.id}" style="left:${LABEL + o.start * k}px;width:${w}px">
        <div class="bh">${o.gid ? `<span class="chip lk" title="Grupta">${ICON.link}</span>` : ''}<span class="chip">${esc(o.name)}</span><span class="chip tc">${tc(len, fps)}</span>${o.muted ? '<span class="chip muted">Sessiz</span>' : ''}</div>
        <div class="eh l" data-edge="l" title="Sürükle: baştan kırp"></div><div class="eh r" data-edge="r" title="Sürükle: sondan kırp"></div>
        <div class="thumbs">${thumbsHtml(o, w, k, 0)}</div>
        <div class="aud" style="${o.muted ? 'opacity:.4' : ''}">${waveDiv(o, k, o.in)}<div class="svgw"></div></div>
      </div>`;
    });
    h += '</div>';
  }
  h += `<div class="track vtrack" data-scrub="1" id="vtrack"><div class="tlabel" title="Ana video">${ICON.video}</div>`;
  for (const o of L){
    const c = o.c, ti = trOf(o.i - 1), to = trOf(o.i);
    const off = ti ? ti.d / 2 : 0, vis = o.len - off - (to ? to.d / 2 : 0), w = Math.max(4, vis * k - 1);
    h += `<div class="blk v ${multi.has('c:' + c.id) ? 'sel' : ''}${c.gid ? ' grp' : ''}" data-clip="${c.id}" data-off="${off}" style="left:${LABEL + (o.t0 + off) * k}px;width:${w}px;z-index:${o.i + 1}">
      <div class="bh">${c.gid ? `<span class="chip lk" title="Grupta">${ICON.link}</span>` : ''}<span class="chip">${esc(c.name)}</span><span class="chip tc">${tc(o.len, fps)}</span>${c.muted ? '<span class="chip muted">Sessiz</span>' : ''}</div>
      <div class="eh l" data-edge="l" title="Sürükle: baştan kırp"></div><div class="eh r" data-edge="r" title="Sürükle: sondan kırp"></div>
      <div class="thumbs">${thumbsHtml(c, w, k, off)}</div>
      <div class="aud" style="${c.muted ? 'opacity:.4' : ''}">${waveDiv(c, k, c.in + off)}<div class="svgw"></div></div>
    </div>`;
  }
  for (let i = 0; i < L.length - 1; i++){
    const tr = trOf(i), B = L[i + 1];
    if ((B.c.gap || 0) > 0.001) continue;   // boşluklu kliplerde geçiş olmaz
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
    h += `<div class="track atrack" data-scrub="1" data-tr="${tr}"><div class="tlabel" title="Ses ${tr + 1}">${ICON.audio}</div>`;
    P.audios.filter(a => (a.track ?? 0) === tr).forEach(a => {
      const len = audioLen(a), w = Math.max(6, len * k);
      h += `<div class="blk a ${multi.has('a:' + a.id) ? 'sel' : ''}${a.gid ? ' grp' : ''}" data-aud="${a.id}" style="left:${LABEL + a.start * k}px;width:${w}px">
        <div class="bh" data-amove="${a.id}" title="Sürükle: başlangıcı değiştir">${a.gid ? `<span class="chip lk" title="Grupta">${ICON.link}</span>` : ''}<span class="chip">${esc(a.name)}</span><span class="chip tc">${tc(len, fps)}</span>${a.muted ? '<span class="chip muted">Sessiz</span>' : ''}</div>
        <div class="aud" style="${a.muted ? 'opacity:.4' : ''}">${waveDiv(a, k, a.trimIn)}<div class="svgw"></div></div>
        <div class="eh l" data-edge="l" title="Sürükle: baştan kırp"></div><div class="eh r" data-edge="r" title="Sürükle: uzat / kısalt"></div>
      </div>`;
    });
    h += '</div>';
  }
  h += `<div class="track strack" data-scrub="1"><div class="tlabel" title="Altyazı">${ICON.text}</div>`;
  P.cues.forEach((c, i) => {
    h += `<div class="blk s ${i === selCue && inspMode === 'text' ? 'sel' : ''}" data-cue="${i}" style="left:${LABEL + c.start * k}px;width:${Math.max(2, (c.end - c.start) * k - 1)}px" title="${esc(c.text)}">${esc(c.text)}</div>`;
  });
  h += '</div><div id="playhead"></div><div id="bladeLine"></div><div id="snapLine"></div><div id="hoverLine"></div>';
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
  const mv = ev => move(ev), u = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', u); ppsLock = null; up && up(ev); };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', u);
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
    const b = e.target.closest('[data-clip],[data-aud],[data-ov]');
    if (b){ const k = keyOfEl(b); selectItem(k[0], k.slice(2), true); refresh(); return; }
  }
  // kenar tutamacı: klibi / sesi baştan veya sondan kırp, uzat
  const edge = e.target.closest('[data-edge]');
  if (edge){
    e.stopPropagation(); pause();
    const blk = edge.parentElement, side = edge.dataset.edge, x0 = e.clientX, inner = $('tlInner');
    if (blk.dataset.ov){
      const o = P.overlays.find(x => x.id === blk.dataset.ov); if (!o) return;
      const s0 = o.start, i0 = o.in, o0 = o.out, pts = snapPoints(new Set(['o:' + o.id]));
      selOv = o.id; inspMode = 'overlay';
      dragPointer(inner, e, ev => {
        let d = (ev.clientX - x0) / curPps;
        const sn = snapDelta([side === 'l' ? s0 + d : s0 + (o0 - i0) + d], pts); d += sn.d;
        if (side === 'l'){ d = clamp(d, -Math.min(i0, s0), o0 - i0 - 0.1); o.start = s0 + d; o.in = i0 + d; }
        else o.out = clamp(o0 + d, i0 + 0.1, o.dur);
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
        if (side === 'l'){ d = clamp(d, -Math.min(t0, s0), l0 - 0.1); a.start = s0 + d; a.trimIn = t0 + d; a.len = l0 - d; }
        else a.len = clamp(l0 + d, 0.1, audioMax(a));
        relayout(); renderTimeline(); showSnap(sn.at);
        showTip(ev.clientX, ev.clientY, `${fmt(audioLen(a))}${!a.loop && side === 'r' && a.len >= audioMax(a) - 0.01 ? ' (dosya sonu)' : ''}`);
      }, () => { hideTip(); showSnap(null); refresh(); syncAudio(true); });
    } else if (blk.dataset.clip){
      const c = P.clips.find(x => x.id === blk.dataset.clip); if (!c) return;
      const i0 = c.in, o0 = c.out, g0 = c.gap || 0, ci = P.clips.indexOf(c), nx = P.clips[ci + 1], ng0 = nx ? (nx.gap || 0) : 0;
      const o = L.find(x => x.c === c), st0 = o.t0, pts = snapPoints(new Set(['c:' + c.id]));
      sel = c.id; inspMode = 'clip';
      dragPointer(inner, e, ev => {
        let d = (ev.clientX - x0) / curPps;
        let sn = {d: 0, at: null};
        if (side === 'l'){
          if (!OPT.magnet){ sn = snapDelta([st0 + d], pts); d += sn.d; d = clamp(d, -Math.min(g0, i0), o0 - i0 - 0.1); c.in = i0 + d; c.gap = g0 + d; }
          else c.in = clamp(i0 + d, 0, c.out - 0.1);
        } else {
          sn = snapDelta([st0 + (o0 - i0) + d], pts); d += sn.d;
          c.out = clamp(o0 + d, c.in + 0.1, c.dur);
          if (!OPT.magnet && nx) nx.gap = Math.max(0, ng0 - (c.out - o0));   // sonrakiler mümkünse yerinde kalsın
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
  const anyBlk = e.target.closest('[data-clip],[data-aud],[data-ov]');
  if (anyBlk && multi.size > 1){
    const key = keyOfEl(anyBlk);
    if (multi.has(key)){ startMultiDrag(e, key); return; }
  }
  // video katmanı: yatayda zaman, dikeyde katman; ana ize bırakınca ana ize geçer
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
      toMain = ev.clientY >= vt.top && ev.clientY < vt.bottom;
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
    dragPointer($('tlInner'), e, ev => {
      if (!moving && Math.abs(ev.clientX - x0) < 5 && Math.abs(ev.clientY - y0) < 8) return;
      if (!moving){ moving = true; pause(); clip.classList.add('dragging'); }
      toOv = ev.clientY < $('vtrack').getBoundingClientRect().top;
      if (toOv){
        clip.style.left = (left0 + ev.clientX - x0) + 'px'; clip.style.transform = `translateY(${ev.clientY - y0}px)`;
        const dp = $('dropPos'); if (dp) dp.style.display = 'none';
        showTip(ev.clientX, ev.clientY, `Katmana taşı · ${tc(Math.max(0, oc.t0 + (ev.clientX - x0) / curPps), outFps())}`);
        return;
      }
      clip.style.transform = '';
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
      clip.style.left = (left0 + ev.clientX - x0) + 'px';
      const {x} = reorderTarget(ev.clientX, id);
      if (dp){ dp.style.left = x + 'px'; dp.style.display = 'block'; }
    }, ev => {
      hideTip(); showSnap(null);
      if (!moving){ selectItem('c', id, additive); refresh(); if (!additive) seek(timeFromX(ev.clientX)); return; }
      if (toOv){
        const st = Math.max(0, oc.t0 + (ev.clientX - x0) / curPps), nOv = P.overlays.length ? Math.max(...P.overlays.map(o => o.track ?? 0)) + 1 : 0;
        clipToOverlay(cc, st, clamp(ovTrackAtY(ev.clientY), 0, nOv)); refresh(); seek(T); return;
      }
      selectItem('c', id, false);
      if (!OPT.magnet){ refresh(); return; }
      const from = P.clips.findIndex(c => c.id === id), {idx} = reorderTarget(ev.clientX, id);
      if (from >= 0 && idx !== from){
        const [c] = P.clips.splice(from, 1); P.clips.splice(idx, 0, c);
      }
      refresh(); seek(L.find(o => o.c.id === id)?.t0 ?? T);
    });
    return;
  }
  const cue = e.target.closest('[data-cue]');
  if (cue){ selCue = +cue.dataset.cue; inspMode = 'text'; refresh(); seek(P.cues[selCue].start + 0.01); return; }
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
    const blocks = inner.querySelectorAll('.blk.v, .blk.a, .blk.o');
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
  for (const c of P.cues) pts.push(c.start, c.end);
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
    for (const o of activeAt(t)){ const v = media.get(o.c.id); if (!v) continue; v.volume = clamp(clipGainAt(o.i, t - o.t0), 0, 1); v.play().catch(() => {}); setTimeout(() => { if (!playing) v.pause(); }, 110); }
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
  const els = [...inner.querySelectorAll('.blk.v, .blk.a, .blk.o')].filter(b => multi.has(keyOfEl(b))).map(b => ({b, l: b.offsetLeft}));
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
    }
    settleTracks(selAud_);   // başka bir sesle çakışan boş ize geçer
    m.selA.filter(o => P.overlays.includes(o)).forEach(o => { if (ovOverlaps(o)) o.track = freeTrackIn(P.overlays, o, clipLen); });
    m.selA.forEach(a => anchors.delete(a));   // bağlantı bunları ikinci kez kaydırmasın
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
  else if (it.kind === 'video') insertClip(it, dropIndexAt(e.clientX)); else addLayer(it, timeFromX(e.clientX));
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
SUB_IDS.forEach(id => $(id).addEventListener('input', readSubSettings));
readSubSettings();
bindRange('autoWords', () => {});

function renderSubInfo(){
  $('subInfo').textContent = P.cues.length
    ? `${P.cues.length} satır, ${fmt(P.cues[0].start)} ile ${fmt(P.cues[P.cues.length - 1].end)} arası`
    : 'Henüz altyazı yok. Otomatik oluştur veya SRT yükle.';
}
async function loadSubsFrom(path){
  const cues = parseSubs(await api.readText(path));
  if (!cues.length){ setStatus('subStatus', 'Dosya okunamadı. SRT veya VTT formatında bir altyazı seç.', 'err'); return; }
  P.cues = cues; selCue = -1; refresh();
  setStatus('subStatus', `${basename(path)} yüklendi (${cues.length} satır). Kelime zamanları tahmini; sesten düzeltmek için yukarıdaki düğmeyi kullan.`, 'ok');
}
$('loadSrt').onclick = async () => { const [p] = await api.openFiles('subs', false); if (p) loadSubsFrom(p); };
$('saveSrt').onclick = async () => {
  const p = await api.saveFile('srt', 'altyazi.srt'); if (!p) return;
  await api.writeText(p, toSrt(P.cues)); toast('SRT kaydedildi');
};
$('clearSubs').onclick = () => { if (confirm('Tüm altyazılar silinsin mi?')){ P.cues = []; selCue = -1; refresh(); } };

/* ---- Klipleri zaman çizelgesindeki gibi zincirle (kesme → concat, geçiş → xfade / acrossfade) ---- */
function chainClips(f, vLabels, aLabels, gaps = []){
  let v = null, a = null;
  for (let i = 0; i < L.length; i++){
    // klipten önce boşluk varsa siyah + sessiz parça ekle
    if (gaps[i]){
      if (a == null){ v = gaps[i].v; a = gaps[i].a; }
      else {
        if (vLabels){ f.push(`${v}${gaps[i].v}concat=n=2:v=1:a=0[vg${i}]`); v = `[vg${i}]`; }
        f.push(`${a}${gaps[i].a}concat=n=2:v=0:a=1[ag${i}]`); a = `[ag${i}]`;
      }
    }
    if (a == null){ v = vLabels && vLabels[i]; a = aLabels[i]; continue; }
    const tr = trOf(i - 1);
    if (vLabels){
      f.push(tr ? `${v}${vLabels[i]}xfade=transition=${tr.type}:duration=${tr.d.toFixed(3)}:offset=${L[i].t0.toFixed(3)}[vx${i}]`
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

async function extractTimelineAudio(onStatus){
  onStatus('Ses çıkarılıyor…');
  const tmp = await api.makeTemp(), outp = tmp + '/audio.f32';
  try {
    const args = [], f = [];
    L.forEach(o => args.push('-ss', o.c.in.toFixed(3), '-t', o.len.toFixed(3), '-i', o.c.path));
    L.forEach((o, i) => f.push(o.c.hasAudio
      ? `[${i}:a]aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono,asetpts=PTS-STARTPTS,apad,atrim=duration=${o.len.toFixed(3)}[a${i}]`
      : `anullsrc=r=16000:cl=mono,aformat=sample_fmts=flt,atrim=duration=${o.len.toFixed(3)}[a${i}]`));
    const gaps = L.map((o, i) => (o.c.gap || 0) > 0.001 ? (f.push(`anullsrc=r=16000:cl=mono,aformat=sample_fmts=flt,atrim=duration=${o.c.gap.toFixed(3)}[ga${i}]`), {a: `[ga${i}]`}) : null);
    const {a} = chainClips(f, null, L.map((_, i) => `[a${i}]`), gaps);
    args.push('-filter_complex', f.join(';'), '-map', a, '-f', 'f32le', '-ac', '1', '-ar', '16000', outp);
    await runFfmpeg(args, TOTAL, p => onStatus(`Ses çıkarılıyor… %${Math.round(p * 100)}`));
    const u8 = new Uint8Array(await api.readFile(outp));
    return new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + (u8.byteLength & ~3)));
  } finally { api.removeDir(tmp); }
}
const asrOpts = () => ({model: $('wModel').value, lang: $('wLang').value, maxWords: +$('autoWords').value});
$('autoSubs').onclick = async () => {
  if (subBusy || !L.length) return;
  if (P.cues.length && !confirm('Mevcut altyazılar yenileriyle değiştirilecek. Devam edilsin mi?')) return;
  subBusy = true; pause(); updateButtons();
  const st = m => setStatus('subStatus', m);
  try {
    const audio = await extractTimelineAudio(st);
    P.cues = await transcribeToCues(audio, asrOpts(), st); selCue = -1;
    const nw = P.cues.reduce((a, c) => a + c.words.length, 0);
    setStatus('subStatus', `${nw} kelime, ${P.cues.length} satır oluşturuldu. Yanlış kelimeleri altyazı izinde satıra tıklayıp düzeltebilirsin.`, 'ok');
  } catch (err){ console.error(err); setStatus('subStatus', 'Altyazı oluşturulamadı: ' + err.message, 'err'); }
  subBusy = false; refresh();
};
$('resync').onclick = async () => {
  if (subBusy || !L.length || !P.cues.length) return;
  subBusy = true; pause(); updateButtons();
  const st = m => setStatus('subStatus', m);
  try {
    const audio = await extractTimelineAudio(st);
    const r = await resyncCues(P.cues, audio, asrOpts(), st);
    setStatus('subStatus', `${r.matched}/${r.total} kelime sesle eşleşti, kalanı aradaki zamanlara dağıtıldı.`, 'ok');
  } catch (err){ console.error(err); setStatus('subStatus', 'Zamanlar düzeltilemedi: ' + err.message, 'err'); }
  subBusy = false; refresh();
};

/* ================= Dışa aktarma ================= */
async function savePng(canvas, path){
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  await api.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}
async function renderSubFrames(dir, W, H, fps, total, onP){
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const N = Math.ceil(total * fps), step = 1 / fps, entries = [];
  await savePng(c, dir + '/blank.png');
  let last = null, n = 0;
  for (let f = 0; f < N; f++){
    if (exportCancelled) throw new Error('İptal edildi');
    const t = f * step, key = subKey(P.cues, t, f, H);
    if (key === last){ entries[entries.length - 1].d += step; continue; }
    last = key;
    let file = 'blank.png';
    if (key !== 'none'){
      g.clearRect(0, 0, W, H); drawSubsAt(g, P.cues, t, W, H);
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
function buildExportArgs(out, W, H, fps, subList){
  const args = [], f = [];
  let idx = 0;
  L.forEach(o => { args.push('-ss', o.c.in.toFixed(3), '-t', o.len.toFixed(3), '-i', o.c.path); idx++; });
  const layers = [];
  for (const a of P.audios){
    const len = audioLen(a); if (len < 0.05 || a.muted) continue;
    if (a.loop) args.push('-stream_loop', '-1');
    if (a.trimIn > 0) args.push('-ss', a.trimIn.toFixed(3));
    args.push('-i', a.path); layers.push({a, len, idx: idx++});
  }
  const ovs = [...P.overlays].sort((a, b) => (a.track ?? 0) - (b.track ?? 0)).map(o => {
    args.push('-ss', o.in.toFixed(3), '-t', clipLen(o).toFixed(3), '-i', o.path); return {o, idx: idx++};
  });
  let subIdx = -1;
  if (subList){ args.push('-f', 'concat', '-safe', '0', '-i', subList); subIdx = idx++; }

  const last = L.length - 1, eD = P.edgeD;
  L.forEach((o, i) => {
    const len = o.len.toFixed(3), c = o.c;
    const fi = i === 0 && P.fadeStart ? Math.min(eD, o.len / 2) : 0;
    const fo = i === last && P.fadeEnd ? Math.min(eD, o.len / 2) : 0;
    let v = `[${i}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=2,trim=duration=${len},setpts=PTS-STARTPTS`;
    if (fi > 0) v += `,fade=t=in:st=0:d=${fi.toFixed(3)}`;
    if (fo > 0) v += `,fade=t=out:st=${(o.len - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
    f.push(v + `[v${i}]`);
    let a = c.hasAudio && !c.muted
      ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=duration=${len}`
        + (isFlat(c.env) ? '' : ',' + envExpr(c.env, o.len)) + (c.vol !== 1 ? `,volume=${c.vol}` : '')
        + (c.fadeIn > 0 ? `,afade=t=in:st=0:d=${Math.min(c.fadeIn, o.len).toFixed(3)}` : '')
        + (c.fadeOut > 0 ? `,afade=t=out:st=${Math.max(0, o.len - c.fadeOut).toFixed(3)}:d=${Math.min(c.fadeOut, o.len).toFixed(3)}` : '')
      : `anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${len}`;
    if (fi > 0) a += `,afade=t=in:st=0:d=${fi.toFixed(3)}`;
    if (fo > 0) a += `,afade=t=out:st=${(o.len - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
    f.push(a + `[a${i}]`);
  });
  const gaps = L.map((o, i) => {
    const g = o.c.gap || 0; if (g <= 0.001) return null;
    f.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${g.toFixed(3)},format=yuv420p,setsar=1[gv${i}]`);
    f.push(`anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${g.toFixed(3)}[ga${i}]`);
    return {v: `[gv${i}]`, a: `[ga${i}]`};
  });
  const ch = chainClips(f, L.map((_, i) => `[v${i}]`), L.map((_, i) => `[a${i}]`), gaps);
  let vOut = ch.v, aOut = ch.a;
  if (TOTAL > VEND + 0.01){
    f.push(`${vOut}tpad=stop_mode=add:stop_duration=${(TOTAL - VEND).toFixed(3)}:color=black[vpx]`); vOut = '[vpx]';
    f.push(`${aOut}apad=whole_dur=${TOTAL.toFixed(3)}[apx]`); aOut = '[apx]';
  }
  // video katmanları: boyutlandır, opaklık, zamanda kaydır ve üstüne bindir
  ovs.forEach(({o, idx}, n) => {
    const r = ovRect(o, W, H), len = clipLen(o), ow = Math.max(2, Math.round(r.w / 2) * 2), oh = Math.max(2, Math.round(r.h / 2) * 2);
    let v = `[${idx}:v]setpts=PTS-STARTPTS,fps=${fps},scale=${ow}:${oh},setsar=1,format=yuva420p,trim=duration=${len.toFixed(3)}`;
    if ((o.opacity ?? 1) < 0.999) v += `,colorchannelmixer=aa=${(o.opacity ?? 1).toFixed(3)}`;
    v += `,setpts=PTS+${o.start.toFixed(3)}/TB`;
    f.push(v + `[ov${n}]`);
    f.push(`${vOut}[ov${n}]overlay=x=${Math.round(r.x)}:y=${Math.round(r.y)}:eof_action=pass:format=auto,format=yuv420p[vov${n}]`);
    vOut = `[vov${n}]`;
  });
  if (subIdx >= 0){
    f.push(`[${subIdx}:v]format=rgba[sb]`);
    f.push(`${vOut}[sb]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[vo]`);
    vOut = '[vo]';
  }
  // video katmanlarının sesi de karışıma girer
  ovs.filter(({o}) => o.hasAudio && !o.muted).forEach(({o, idx}) => {
    layers.push({a: {vol: o.vol, env: o.env, fadeIn: o.fadeIn, fadeOut: o.fadeOut, start: o.start}, len: clipLen(o), idx});
  });
  if (layers.length){
    layers.forEach(({a, len, idx}, k) => {
      let s = `[${idx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,atrim=duration=${len.toFixed(3)}`;
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
function openExport(){
  if (!L.length){ toast('Dışa aktarmak için önce zaman çizelgesine bir video ekle'); return; }
  pause(); updateOutInfo();
  const tc_ = $('exportThumb'), g = tc_.getContext('2d');
  const k = Math.min(tc_.width / cv.width, tc_.height / cv.height);
  g.fillStyle = '#000'; g.fillRect(0, 0, tc_.width, tc_.height);
  g.drawImage(cv, (tc_.width - cv.width * k) / 2, (tc_.height - cv.height * k) / 2, cv.width * k, cv.height * k);
  $('exportModal').hidden = false;
}
$('topExport').onclick = openExport;
$('exportClose').onclick = () => { if (!exportJob) $('exportModal').hidden = true; };
$('exportModal').addEventListener('pointerdown', e => { if (e.target === $('exportModal') && !exportJob) $('exportModal').hidden = true; });
$('exportBtn').onclick = async () => {
  if (!L.length || exportJob) return;
  const out = await api.saveFile('mp4', (projPath ? stem(projPath) : stem(P.clips[0].path) + '_reelix') + '.mp4'); if (!out) return;
  pause();
  const {W, H} = outRes(), fps = outFps();
  const burn = $('burnSubs').checked && P.cues.length > 0;
  exportJob = uid(); exportCancelled = false; updateButtons();
  const bar = p => $('exportBar').style.width = (p * 100).toFixed(1) + '%';
  bar(0);
  const tmp = await api.makeTemp();
  const t0 = performance.now();
  try {
    let subList = null;
    if (burn){
      await renderSubFrames(tmp, W, H, fps, TOTAL, p => { setStatus('exportStatus', `Altyazı hazırlanıyor… %${Math.round(p * 100)}`); bar(p * 0.25); });
      subList = tmp + '/subs.ffconcat';
    }
    const base = burn ? 0.25 : 0;
    const args = buildExportArgs(out, W, H, fps, subList);
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
  $('outInfo').innerHTML = L.length ? `${W}×${H} · ${fmt(TOTAL)}<br><span style="color:var(--mut)">Oranı oynatıcının altındaki menüden değiştirebilirsin.</span>` : '';
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

/* ================= Proje kaydet / aç ================= */
$('saveProject').onclick = async () => {
  const p = projPath || await api.saveFile('project', 'proje.reelix'); if (!p) return;
  const strip = ({thumb, thumbN, wave, ...rest}) => rest;
  const data = {app: 'reelix', version: 4, lib: LIB.map(strip), clips: P.clips.map(strip), audios: P.audios.map(strip), overlays: P.overlays.map(strip), cues: P.cues,
    fadeStart: P.fadeStart, fadeEnd: P.fadeEnd, edgeD: P.edgeD, defTr: P.defTr, style: {...S},
    output: {res: $('outRes').value, fps: $('outFps').value, crf: $('outCrf').value, preset: $('outPreset').value, burn: $('burnSubs').checked}};
  await api.writeText(p, JSON.stringify(data, null, 1));
  projPath = p; updateTitle(); toast('Proje kaydedildi');
};
$('openProject').onclick = async () => {
  const [p] = await api.openFiles('project', false); if (!p) return;
  let d; try { d = JSON.parse(await api.readText(p)); } catch (e){ toast('Proje dosyası okunamadı', 'err'); return; }
  pause();
  for (const id of [...media.keys()]) dropMedia(id);
  P.clips = (d.clips || []).map(c => ({vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0, ...c,
    tr: c.tr !== undefined ? c.tr : (c.trans ? {type: 'fadeblack', d: d.transD || 1} : null)}));
  P.audios = [];
  for (const a0 of d.audios || []){ const a = {muted: false, env: DEF_ENV(), ...a0, len: a0.len ?? Math.max(0.1, a0.dur - (a0.trimIn || 0))}; if (a.track == null) a.track = freeTrack(a); P.audios.push(a); }
  P.cues = d.cues || [];
  P.overlays = (d.overlays || []).map(o => ({x: 0.5, y: 0.5, scale: 1, opacity: 1, vol: 1, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0, track: 0, ...o}));
  P.fadeStart = !!d.fadeStart; P.fadeEnd = !!d.fadeEnd; P.edgeD = d.edgeD ?? 1; P.defTr = d.defTr || {type: 'fadeblack', d: 1};
  // kitaplık: kayıtlı değilse kullanılan dosyalardan oluştur
  LIB = d.lib || [];
  for (const it of [...P.clips, ...P.audios]) if (!LIB.find(x => x.path === it.path))
    LIB.push({id: uid(), path: it.path, name: it.name, kind: P.clips.includes(it) ? 'video' : 'audio', dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio !== false});
  LIB.forEach(it => ensureVisuals(it, it.kind === 'video'));
  P.clips.forEach(c => makeMedia(c, 'video'));
  P.overlays.forEach(o => { makeMedia(o, 'video'); ensureVisuals(o, true); });
  P.audios.forEach(a => makeMedia(a, 'audio'));
  $('edgeD').value = P.edgeD; $('fadeStart').checked = P.fadeStart; $('fadeEnd').checked = P.fadeEnd;
  $('edgeD').parentElement.querySelector('.v').textContent = $('edgeD').value;
  applySubStyle(d.style);
  if (d.output){ $('outRes').value = d.output.res; $('outFps').value = d.output.fps; $('outCrf').value = d.output.crf; $('outPreset').value = d.output.preset; $('burnSubs').checked = d.output.burn; }
  sel = null; selAud = null; selCue = -1; selTr = 0; inspMode = 'project'; T = 0; projPath = p;
  undoStack.length = 0; redoStack.length = 0; lastSnap = null; linkFreeze = true;
  renderLibrary(); refresh(); seek(0);
  toast('Proje açıldı');
};
function updateTitle(){
  $('projTitle').textContent = projPath ? stem(projPath) : 'Adsız proje';
  $('projSub').textContent = L.length ? fmt(TOTAL) : '';
}

/* ================= Genel ================= */
function updateButtons(){
  const has = L.length > 0;
  $('hint').style.display = has ? 'none' : '';
  $('exportBtn').disabled = !has || !!exportJob;
  $('topExport').disabled = !has;
  $('exportCancel').disabled = !exportJob;
  $('exportClose').disabled = !!exportJob;
  $('exportReveal').disabled = !lastExport;
  $('exportToSplit').disabled = !lastExport;
  $('splitUseExport').disabled = !lastExport;
  $('autoSubs').disabled = !has || subBusy;
  $('resync').disabled = !has || !P.cues.length || subBusy;
  $('saveSrt').disabled = !P.cues.length;
  $('clearSubs').disabled = !P.cues.length;
  $('cutBtn').disabled = !has;
  $('delBtn').disabled = inspMode === 'project';
  $('muteBtn').disabled = !multi.size;
  $('groupBtn').disabled = multi.size < 2;
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
  normalizeSelection(); compactTracks();
  relayout(); applyLinkage(); relayout(); rememberAnchors(); sizeCanvas();
  renderTimeline(); renderInspector(); renderSubInfo(); renderTransTab(); renderLibrary();
  trackHistory();
  updateButtons(); updateTime(); updateTitle();
  if (!playing) draw();
}

setPlayIcon();
renderLibrary();
refresh();
requestAnimationFrame(tick);
