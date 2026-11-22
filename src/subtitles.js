/* Altyazı motoru: ayrıştırma, çizim, kelime vurgusu, Whisper */

const SUB_IDS = ['posX','posY','maxW','font','size','bold','upper','color','strokeC','stroke','shadow','lineH',
  'bgC','bgA','bgPad','anim','animD','animOut','hl','hlStyle','hlC','hlBg','hlScale','reveal','dimPast','hlOff'];
const S = {};

/* ---------- Ayrıştırma ---------- */
function parseTime(s){
  const m = s.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return NaN;
  return (+(m[1]||0))*3600 + (+m[2])*60 + parseFloat(m[3]);
}
function wordsFromText(text, start, end){
  const ws = text.split(' ').filter(Boolean);
  const weights = ws.map(w => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu,'').length) + (/[.,!?;:…]$/.test(w) ? 2 : 0));
  const total = weights.reduce((a,b)=>a+b,0) || 1;
  let t = start; const dur = end - start;
  return ws.map((w,k) => { const d = dur*weights[k]/total; const o = {t:w, s:t, e:t+d}; t += d; return o; });
}
function parseSubs(text){
  text = text.replace(/^﻿/, '').replace(/\r/g, '');
  const out = [];
  for (const block of text.split(/\n{2,}/)){
    const lines = block.split('\n').filter(l => l.trim() !== '');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTime(a), end = parseTime(b.trim().split(/\s+/)[0]);
    if (isNaN(start) || isNaN(end)) continue;
    const t = lines.slice(i+1).join(' ')
      .replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/&nbsp;/g,' ')
      .replace(/\s+/g, ' ').trim();
    if (t) out.push({start, end, text: t});
  }
  out.sort((x,y) => x.start - y.start);
  for (const c of out) c.words = wordsFromText(c.text, c.start, c.end);
  return out;
}
function srtTime(t){
  const ms = Math.max(0, Math.round(t*1000)), h = Math.floor(ms/3600000), m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
}
function toSrt(cues){
  return cues.filter(c => !isTextCue(c)).map((c, i) => `${i+1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}
function findCue(cues, now){
  // ikili arama
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi){
    const mid = (lo + hi) >> 1, c = cues[mid];
    if (now < c.start) hi = mid - 1;
    else if (now >= c.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/* ---------- Çizim ---------- */
const ease = {
  out: t => 1 - Math.pow(1-t, 3),
  back: t => { const c1 = 1.70158, c3 = c1+1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); }
};
function fontStr(px){ return `${S.bold?'700':'400'} ${px}px "${S.font}", sans-serif`; }
function hexA(h, a){ const n = parseInt(h.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
function roundRect(c, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w/2, h/2)); c.beginPath();
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath();
}

function cueState(cue, now, H){
  const px = S.size/100 * H;
  const D = S.animD, tIn = now - cue.start, tOut = cue.end - now;
  let alpha = 1, dy = 0, sc = 1, visibleChars = Infinity;
  const pin = Math.min(1, tIn / D), pout = S.animOut ? Math.min(1, tOut / D) : 1;
  switch (S.anim){
    case 'fade':  alpha = pin * pout; break;
    case 'slide': alpha = pin * pout; dy = (1-ease.out(pin))*px*1.2 + (1-ease.out(pout))*px*0.6; break;
    case 'pop':   sc = 0.6 + 0.4*ease.back(pin); alpha = Math.min(1, pin*2) * pout; if (pout<1) sc *= 0.6+0.4*pout; break;
    case 'zoom':  sc = 1.4 - 0.4*ease.out(pin); alpha = pin * pout; break;
    case 'typewriter': {
      const total = cue.text.length, span = Math.max(0.1, Math.min(cue.end-cue.start-0.2, Math.max(0.4, total*0.04)));
      visibleChars = Math.ceil(total * Math.min(1, tIn/span)); alpha = pout; break; }
  }
  return {px, alpha, dy, sc, visibleChars, pin, pout};
}

function drawText(ctx, t, x, y, fill, px){
  ctx.font = fontStr(px);
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  const sw = S.stroke/100 * px;
  if (S.shadow > 0){ ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = S.shadow*px/40; ctx.shadowOffsetY = S.shadow*px/80; }
  if (sw > 0){ ctx.lineWidth = sw; ctx.strokeStyle = S.strokeC; ctx.strokeText(t, x, y); }
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = fill; ctx.fillText(t, x, y);
}

function drawCue(ctx, cue, now, W, H){
  const {px, alpha, dy, sc, visibleChars} = cueState(cue, now, H);
  if (alpha <= 0) return;
  const k = H / 1080;                       // piksel değerlerini çözünürlükten bağımsız yap
  const pad = S.bgPad * k;

  ctx.save();
  ctx.font = fontStr(px);
  ctx.textBaseline = 'alphabetic';
  const maxW = S.maxW/100 * W - pad*2;
  const spaceW = ctx.measureText(' ').width;
  const words = cue.words.map(w => {
    const t = S.upper ? w.t.toLocaleUpperCase('tr') : w.t;
    return {...w, t, w: ctx.measureText(t).width};
  });
  const lines = []; let cur = [], curW = 0;
  for (const w of words){
    const add = (cur.length ? spaceW : 0) + w.w * S.hlScale;
    if (cur.length && curW + add > maxW){ lines.push({ws:cur, w:curW}); cur=[]; curW=0; }
    curW += (cur.length ? spaceW : 0) + w.w; cur.push(w);
  }
  if (cur.length) lines.push({ws:cur, w:curW});
  if (!lines.length){ ctx.restore(); return; }

  const lh = px * S.lineH, blockH = lines.length * lh;
  const blockW = Math.max(...lines.map(l => l.w));
  const cx = S.posX/100 * W;
  const bottom = S.posY/100 * H;
  const top = bottom - blockH;
  const cy = top + blockH/2 + dy;

  ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
  ctx.globalAlpha = alpha;

  if (S.bgA > 0){
    ctx.fillStyle = hexA(S.bgC, S.bgA/100);
    roundRect(ctx, cx - blockW/2 - pad, top + dy - pad*0.5 + (lh-px)*0.2, blockW + pad*2, blockH + pad, Math.min(24*k, pad));
    ctx.fill();
  }

  let charIdx = 0;
  lines.forEach((line, li) => {
    let x = cx - line.w/2;
    const base = top + dy + li*lh + px*0.95 + (lh-px)/2 - (lh-px)*0.2;
    for (const w of line.ws){
      const wStart = w.s + S.hlOff, wEnd = w.e + S.hlOff;
      const active = S.hl && now >= wStart && now < wEnd;
      const past = now >= wEnd, future = now < wStart;
      let a = 1;
      if (S.reveal && S.hl && future) a = 0;
      if (S.dimPast && S.hl && past) a = 0.55;
      let text = w.t;
      if (charIdx + text.length > visibleChars) text = text.slice(0, Math.max(0, visibleChars - charIdx));
      charIdx += w.t.length + 1;
      if (text && a > 0){
        const s = (active && S.hlStyle === 'scale') ? S.hlScale : 1;
        const wc = x + w.w/2;
        ctx.save();
        ctx.globalAlpha = alpha * a;
        if (s !== 1){ ctx.translate(wc, base - px*0.35); ctx.scale(s, s); ctx.translate(-wc, -(base - px*0.35)); }
        if (active && S.hlStyle === 'pill'){
          ctx.fillStyle = S.hlBg;
          roundRect(ctx, x - px*0.18, base - px*0.92, w.w + px*0.36, px*1.18, px*0.25); ctx.fill();
        }
        const fill = active ? (S.hlStyle === 'pill' ? '#ffffff' : S.hlC) : S.color;
        drawText(ctx, text, x, base, fill, px);
        if (active && S.hlStyle === 'underline'){
          ctx.fillStyle = S.hlC; ctx.fillRect(x, base + px*0.12, w.w, Math.max(3*k, px*0.08));
        }
        ctx.restore();
      }
      x += w.w + spaceW;
    }
  });
  ctx.restore();
}

// satıra özel stil (cue.st) varsa çizim süresince genel stilin üstüne yaz
function withCueStyle(cue, fn){
  if (!cue.st) return fn();
  const saved = {};
  for (const k in cue.st){ saved[k] = S[k]; S[k] = cue.st[k]; }
  try { return fn(); } finally { Object.assign(S, saved); }
}
// metin öğeleri (kind: 'text') altyazılarla aynı listede durur ama üst üste binebilir; altyazı en üstte çizilir
const isTextCue = c => !!c && c.kind === 'text';
function activeCues(cues, now){
  const out = [];
  cues.forEach((c, i) => { if (now >= c.start && now < c.end) out.push(i); });
  return out.sort((a, b) => isTextCue(cues[b]) - isTextCue(cues[a]));
}
function drawSubsAt(ctx, cues, now, W, H){
  for (const i of activeCues(cues, now)) withCueStyle(cues[i], () => drawCue(ctx, cues[i], now, W, H));
}

// Dışa aktarmada aynı görünen kareleri tek kareye indirmek için durum anahtarı
function subKey(cues, now, frameNo, H){
  const keys = activeCues(cues, now).map(ci => withCueStyle(cues[ci], () => cueKey(cues[ci], ci, now, frameNo, H))).filter(k => k !== 'none');
  return keys.length ? keys.join('/') : 'none';
}
function cueKey(cue, ci, now, frameNo, H){
  const st = cueState(cue, now, H);
  if (st.alpha <= 0) return 'none';
  const animating = S.anim === 'none' ? false : (S.anim === 'typewriter' ? st.pout < 1 : (st.pin < 1 || st.pout < 1));
  if (animating) return `${ci}|f${frameNo}`;
  let act = -1, past = 0;
  if (S.hl) cue.words.forEach((w, k) => { const s = w.s + S.hlOff, e = w.e + S.hlOff; if (now >= s && now < e) act = k; if (now >= e) past++; });
  return `${ci}|${act}|${past}|${st.visibleChars}`;
}

/* ---------- Whisper ---------- */
// Motor ayrı bir Worker'da çalışır; killAsr() onu tamamen kapatıp belleği boşaltır
let asrWorker = null, asrModel = '', asrSeq = 0, asrLastMsg = 0;
const asrReqs = new Map();
const asrPending = () => asrReqs.size > 0;
function ensureAsrWorker(){
  if (asrWorker) return;
  asrWorker = new Worker('asr-worker.js');
  asrWorker.onmessage = e => {
    asrLastMsg = performance.now();
    const r = asrReqs.get(e.data.id); if (!r) return;
    if (e.data.type === 'progress'){ r.onProgress && r.onProgress(e.data.p); return; }
    asrReqs.delete(e.data.id);
    if (e.data.type === 'error') r.rej(new Error(e.data.message)); else r.res(e.data.result);
  };
  asrWorker.onerror = e => killAsr(new Error('Altyazı motoru çöktü' + (e.message ? ': ' + e.message : '')));
}
function asrCall(msg, transfer, onProgress){
  return new Promise((res, rej) => {
    const id = ++asrSeq; asrReqs.set(id, {res, rej, onProgress});
    asrLastMsg = performance.now();
    asrWorker.postMessage({...msg, id}, transfer || []);
  });
}
function killAsr(err){
  if (asrWorker){ asrWorker.terminate(); asrWorker = null; asrModel = ''; }
  for (const r of asrReqs.values()) r.rej(err);
  asrReqs.clear();
}
async function getAsr(model, onStatus){
  ensureAsrWorker();
  if (asrModel !== model){
    onStatus('Model yükleniyor…');
    await asrCall({type: 'load', model}, null, p => { if (p.status === 'progress') onStatus(`Model indiriliyor… %${Math.round(p.progress)} (${(p.file || '').split('/').pop()})`); });
    asrModel = model;
  }
  // ses parçası her çağrıda yeni bir kopya olduğu için Worker'a aktarılır (kopyalanmaz)
  return (audio, opts) => asrCall({type: 'run', audio, opts}, [audio.buffer]);
}

const norm = s => s.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
function lev(a, b){
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({length: n+1}, (_, j) => j);
  for (let i = 1; i <= m; i++){
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function sim(a, b){ if (!a || !b) return 0; return 1 - lev(a, b) / Math.max(a.length, b.length); }

function alignCue(cue, asr){
  const A = cue.words.map(w => norm(w.t)), B = asr.map(w => norm(w.text));
  const n = A.length, m = B.length, GAP = -0.45;
  const sc = Array.from({length: n+1}, () => new Float32Array(m+1));
  const bt = Array.from({length: n+1}, () => new Uint8Array(m+1));
  for (let i = 1; i <= n; i++){ sc[i][0] = i*GAP; bt[i][0] = 1; }
  for (let j = 1; j <= m; j++){ sc[0][j] = j*GAP; bt[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++){
    const s = sim(A[i-1], B[j-1]), d = sc[i-1][j-1] + (s >= 0.5 ? s : -0.6 + s*0.4);
    const u = sc[i-1][j] + GAP, l = sc[i][j-1] + GAP;
    if (d >= u && d >= l){ sc[i][j] = d; bt[i][j] = 0; }
    else if (u >= l){ sc[i][j] = u; bt[i][j] = 1; } else { sc[i][j] = l; bt[i][j] = 2; }
  }
  const map = new Array(n).fill(null);
  let i = n, j = m;
  while (i > 0 || j > 0){
    const t = (i > 0 && j > 0) ? bt[i][j] : (i > 0 ? 1 : 2);
    if (t === 0){ if (sim(A[i-1], B[j-1]) >= 0.5) map[i-1] = asr[j-1]; i--; j--; }
    else if (t === 1) i--; else j--;
  }
  return map;
}
function applyCue(c, cand){
  const n = c.words.length;
  if (!cand.length) return 0;
  const map = alignCue(c, cand);
  const s = new Array(n).fill(null), e = new Array(n).fill(null);
  let matched = 0;
  map.forEach((w, k) => { if (w){ s[k] = w.s; e[k] = w.e; matched++; } });
  if (!matched) return 0;
  let k = 0;
  while (k < n){
    if (s[k] !== null){ k++; continue; }
    const a = k; while (k < n && s[k] === null) k++;
    const t0 = a > 0 ? e[a-1] : c.start;
    const t1 = k < n ? s[k] : c.end;
    const cnt = k - a, step = Math.max(0, t1 - t0) / cnt;
    for (let q = 0; q < cnt; q++){ s[a+q] = t0 + q*step; e[a+q] = t0 + (q+1)*step; }
  }
  for (let q = 0; q < n; q++){
    if (q > 0 && s[q] < s[q-1]) s[q] = s[q-1];
    if (e[q] < s[q]) e[q] = s[q] + 0.05;
  }
  for (let q = 0; q < n; q++){
    c.words[q].s = s[q];
    c.words[q].e = q < n-1 ? Math.max(s[q+1], s[q] + 0.05) : Math.max(e[q], s[q] + 0.1);
  }
  c.words[0].s = Math.min(c.words[0].s, c.start + 0.05);
  return matched;
}

// Sesi ~25 sn'lik pencerelere böl; kesimi en sessiz anda yap
function splitAtSilence(audio, perSec, maxLen = 25, search = 6){
  const total = audio.length / perSec, wins = [];
  const frame = Math.floor(perSec * 0.05);
  let start = 0;
  while (total - start > maxLen + search){
    const a = start + maxLen - search, b = start + maxLen;
    let best = b, bestE = Infinity;
    for (let t = a; t < b; t += 0.05){
      const i0 = Math.floor(t*perSec); let e = 0;
      for (let k = 0; k < frame; k += 4) e += Math.abs(audio[i0+k] || 0);
      if (e < bestE){ bestE = e; best = t; }
    }
    wins.push([start, best]); start = best;
  }
  wins.push([start, total]);
  return wins;
}

function buildCuesFromWords(words, maxWords){
  const maxChars = 44, GAP = 0.6;
  const out = []; let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({start: cur[0].s, end: cur[cur.length-1].e, text: cur.map(w => w.t).join(' '), words: cur});
    cur = [];
  };
  for (const w of words){
    if (cur.length){
      const gap = w.s - cur[cur.length-1].e;
      const chars = cur.map(x => x.t).join(' ').length + 1 + w.t.length;
      if (gap > GAP || cur.length >= maxWords || chars > maxChars) flush();
    }
    cur.push(w);
    if (/[.?!…]$/.test(w.t) && cur.length >= 2) flush();
  }
  flush();
  out.forEach((c, i) => { const next = out[i+1] ? out[i+1].start : Infinity; c.end = Math.min(c.end + 0.25, next); c.words[c.words.length-1].e = c.end; });
  return out;
}

const PER_SEC = 16000;
async function transcribeToCues(audio, opts, onStatus){
  const pipe = await getAsr(opts.model, onStatus);
  const wins = splitAtSilence(audio, PER_SEC);
  const words = [];
  for (let i = 0; i < wins.length; i++){
    onStatus(`Konuşma yazıya çevriliyor… ${i+1}/${wins.length}`);
    await new Promise(r => setTimeout(r, 0));
    const [t0, t1] = wins[i];
    const clip = audio.slice(Math.floor(t0*PER_SEC), Math.ceil(t1*PER_SEC));
    if (clip.length < 4800) continue;
    const out = await pipe(clip, {return_timestamps: 'word', language: opts.lang, task: 'transcribe'});
    for (const w of (out.chunks || [])){
      const txt = (w.text || '').trim();
      if (!txt || !w.timestamp || w.timestamp[0] == null) continue;
      const s = t0 + w.timestamp[0], e = t0 + (w.timestamp[1] ?? w.timestamp[0] + 0.3);
      words.push({t: txt, s, e: Math.max(e, s + 0.05)});
    }
  }
  if (!words.length) throw new Error('Konuşma bulunamadı');
  words.sort((a, b) => a.s - b.s);
  for (let i = 0; i < words.length - 1; i++) if (words[i].e > words[i+1].s) words[i].e = words[i+1].s;
  return buildCuesFromWords(words, opts.maxWords);
}

async function resyncCues(cues, audio, opts, onStatus){
  const pipe = await getAsr(opts.model, onStatus);
  const dur = audio.length / PER_SEC, PAD = 0.4;
  let matched = 0, total = 0;
  for (let i = 0; i < cues.length; i++){
    const c = cues[i]; total += c.words.length;
    onStatus(`Kelime zamanları hesaplanıyor… ${i+1}/${cues.length}`);
    await new Promise(r => setTimeout(r, 0));
    const t0 = Math.max(0, c.start - PAD), t1 = Math.min(dur, c.end + PAD);
    const clip = audio.slice(Math.floor(t0*PER_SEC), Math.ceil(t1*PER_SEC));
    if (clip.length < 4800) continue;
    const out = await pipe(clip, {return_timestamps: 'word', language: opts.lang, task: 'transcribe'});
    const cand = (out.chunks || []).filter(w => w.timestamp && w.timestamp[0] != null)
      .map(w => ({text: w.text, s: t0 + w.timestamp[0], e: t0 + (w.timestamp[1] ?? w.timestamp[0] + 0.3)}));
    matched += applyCue(c, cand);
  }
  return {matched, total};
}
