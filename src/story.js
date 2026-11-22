/* Reelix — Hikaye atölyesi: senaryo (Gemini) → seslendirme (ElevenLabs) → görsel (Nano Banana) → video (Omni)
   → Reelix'te sahneler, sesler ve altyazılar otomatik kurulur.
   Görsel/video iki yolla: API ile otomatik (Gemini API, kullanım başına ücretli) veya Flow'da elle (prompt kopyalanır,
   İndirilenler'e inen dosya sıradaki sahneye otomatik yerleşir). Hikaye projeyle kaydedilir (STORY). */

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const ELEVEN = 'https://api.elevenlabs.io';
const FLOW_URL = 'https://labs.google/fx/tools/flow';
const STORY_DEFAULTS = {
  textModel: 'gemini-3.5-flash-lite', textFallback: 'gemini-3.1-flash-lite',   // lite hızlı ve genelde boşta; 3.8 sık yoğun (yeni hesaplarda yalnızca Interactions API) imageModel: 'gemini-nano-banana-2.1', videoModel: 'gemini-omni-1.2-flash', ttsModel: 'eleven_v4',
  ratio: '9:16', resolution: '720p', videoVol: 25, ambVol: 30, sfxModel: 'eleven_text_to_sound_v2', narrator: '',
  style: '',
};
const SET_KEY = 'reelix-story-settings';
let STSET = (() => { try { return {...STORY_DEFAULTS, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}')}; } catch (e){ return {...STORY_DEFAULTS}; } })();
// eski kayıtlı ayar: yoğunlukta dakikalarca takılan 3.8'i asıl modelden yedeğe al (bir kez)
if (!STSET.v2){ if (STSET.textModel === 'gemini-3.8-flash'){ STSET.textModel = 'gemini-3.5-flash-lite'; STSET.textFallback = 'gemini-3.8-flash'; } STSET.v2 = true; }
if (!STSET.v3){ if (STSET.textFallback === 'gemini-3.8-flash') STSET.textFallback = 'gemini-3.1-flash-lite'; STSET.v3 = true; }
// kullanılacak modeller: "En ucuz" açıkken her adımda en düşük maliyetli seçenek, kapalıyken Ayarlar'daki seçim
const M = {
  tts: () => STSET.cheap ? 'eleven_flash_v2_5' : STSET.ttsModel,                         // Flash: karakter başına en düşük kredi
  sfx: () => STSET.cheap ? 'eleven_text_to_sound_v2' : STSET.sfxModel,
  image: () => STSET.cheap ? (GEM_IMAGE.find(m => /lite/i.test(m)) || 'gemini-3.1-flash-lite-image') : STSET.imageModel,   // Nano Banana 2 Lite
  imageSize: () => STSET.cheap ? '1K' : '2K',
  video: () => STSET.videoModel,                                                           // tek video modeli (Omni); maliyeti çözünürlük ve süre belirler
  resolution: () => STSET.cheap ? '360p' : STSET.resolution,
};
const freeImg = () => (STSET.imgProvider || 'cloudflare') === 'cloudflare';   // görsel: Cloudflare Workers AI (ücretsiz günlük kota) veya Gemini (ücretli)
const paidOn = () => STSET.paidApi === true;   // görsel/video Gemini API'si ücretli: kullanıcı açıkça açmadıkça kapalı
function needPaid(){ if (paidOn()) return true; toast('Görsel ve video API\'si ücretli ve kapalı. Ücretsiz yol: "Flow için kopyala". Açmak için: Hikaye → Ayarlar → Maliyet.'); return false; }
const saveSet = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(STSET)); } catch (e){} };
let STORY = null;                 // projeye ait hikaye
let VOICES = [];                  // ElevenLabs sesleri [{voice_id, name}]
let storyTab = 'script';
const newStory = () => ({input: '', story: '', length: 'medium', count: 'auto', style: '', styleAuto: true, refs: [], title: '', characters: [], scenes: []});
const sceneLabel = (s, i) => `${i + 1}. ${s.summary || 'Sahne'}`;

/* ---------- API yardımcıları ---------- */
async function key(name){
  const k = await api.secretGet(name);
  if (!k){ storyShow('settings'); throw new Error(`${name === 'gemini' ? 'Gemini' : 'ElevenLabs'} API anahtarı girilmemiş (Ayarlar)`); }
  return k;
}
const apiErr = r => { const d = r.data, m = d && (d.error && (d.error.message || d.error) || d.detail && (d.detail.message || JSON.stringify(d.detail))); return new Error(`${r.status}: ${typeof m === 'string' ? m : JSON.stringify(d).slice(0, 300)}`); };
// geçici hatalar (yoğunluk 503, istek sınırı 429, sunucu 5xx): artan beklemeyle yeniden dene
const RETRY = [429, 500, 502, 503, 504], WAITS = [4, 10, 20];
// Google/ElevenLabs hata gövdesinden okunur mesaj
function errText(r){
  let d = r.data ?? r.error;
  if (typeof d === 'string'){ try { d = JSON.parse(d); } catch (e){ return d; } }
  if (Array.isArray(d)) d = d[0];   // bazı hatalar dizi içinde gelir
  const e = d && (d.error || d.detail);
  return (e && (e.message || (typeof e === 'string' ? e : ''))) || JSON.stringify(d || '').slice(0, 200);
}
// anahtarın erişebildiği metin modelleri (Google'dan; önbellekli)
let GEM_MODELS = (() => { try { return JSON.parse(localStorage.getItem('reelix-gem-models') || '[]'); } catch (e){ return []; } })();
let GEM_IMAGE = (() => { try { return JSON.parse(localStorage.getItem('reelix-gem-image') || '[]'); } catch (e){ return []; } })();
let GEM_VIDEO = (() => { try { return JSON.parse(localStorage.getItem('reelix-gem-video') || '[]'); } catch (e){ return []; } })();
async function fetchGeminiModels(){
  const r = await api.httpJson(`${GEMINI}/models?pageSize=1000`, {headers: {'x-goog-api-key': await key('gemini')}});
  if (!r.ok) throw new Error(`${r.status}: ${errText(r)}`);
  const all = (r.data.models || []).map(m => m.name.replace(/^models\//, ''));
  GEM_MODELS = all.filter(n => /^gemini/i.test(n) && !/image|omni|tts|embed|live|audio|veo|imagen|banana|robotic|computer|native|transcribe/i.test(n));
  GEM_IMAGE = all.filter(n => /image|banana/i.test(n) && !/imagen/i.test(n));
  GEM_VIDEO = all.filter(n => /omni|veo/i.test(n));
  try { localStorage.setItem('reelix-gem-models', JSON.stringify(GEM_MODELS)); localStorage.setItem('reelix-gem-image', JSON.stringify(GEM_IMAGE)); localStorage.setItem('reelix-gem-video', JSON.stringify(GEM_VIDEO)); } catch (e){}
  return GEM_MODELS;
}
let EL_MODELS = (() => { try { return JSON.parse(localStorage.getItem('reelix-el-models') || '[]'); } catch (e){ return []; } })();
async function fetchElevenModels(){
  const r = await api.httpJson(`${ELEVEN}/v1/models`, {headers: {'xi-api-key': await key('elevenlabs')}});
  if (!r.ok) throw apiErr(r);
  EL_MODELS = (Array.isArray(r.data) ? r.data : r.data.models || []).filter(m => m.can_do_text_to_speech !== false)
    .map(m => ({id: m.model_id, name: m.name || m.model_id, tr: (m.languages || []).some(l => /^tr/i.test(l.language_id || ''))}));
  try { localStorage.setItem('reelix-el-models', JSON.stringify(EL_MODELS)); } catch (e){}
}
const sleep = sec => new Promise(r => setTimeout(r, sec * 1000));
async function withRetry(label, call){
  for (let i = 0; ; i++){
    const r = await call();
    if (r.ok || !RETRY.includes(r.status) || i >= WAITS.length) return r;
    storyBusy(`${label}: ${r.status} ${errText(r).slice(0, 90)} · ${WAITS[i]} sn sonra tekrar (${i + 2}/${WAITS.length + 1})…`);
    await sleep(WAITS[i]);
  }
}
async function gemini(path, body, label = 'Gemini'){
  const k = await key('gemini');
  const r = await withRetry(label, () => api.httpJson(`${GEMINI}/${path}`, {method: 'POST', headers: {'x-goog-api-key': k, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}));
  storyBusy(null);
  if (!r.ok) throw apiErr(r);
  return r.data;
}
// Interactions yanıtında belirli türdeki ilk çıktı (görsel/video): {data?, uri?, mime_type}
function interactionOutput(d, type){
  const direct = d && d['output_' + type]; if (direct && (direct.data || direct.uri)) return direct;
  for (const st of (d && d.steps) || []) for (const c of st.content || []) if (c.type === type && (c.data || c.uri)) return c;
  return null;
}
// Interactions yanıtındaki model metni
function interactionText(d){
  if (!d) return '';
  if (typeof d.output_text === 'string') return d.output_text;
  let t = '';
  for (const st of d.steps || []) if (st.type === 'model_output') for (const c of st.content || []) if (c.type === 'text' && c.text) t += c.text;
  return t;
}
// ses etiketleri ([laughs], [whispers]…): yalnızca v3/v4 modelleri anlar; diğerlerinde ve altyazıda temizlenir
const tagsOk = m => /eleven_v[34]/.test(m || '');
const stripTags = t => String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const mediaPath = async name => api.joinPath(await api.mediaDir(), name);
const mimeOf = p => /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg';

/* ---------- 1) Senaryo ---------- */
// ortalama uzunluk (part başına): hikâyenin uzunluğu ve önerilen sahne sayısı buna göre
const LENGTHS = [
  {id: 'short', name: 'Kısa', sec: 30, scenes: 5},
  {id: 'medium', name: 'Orta', sec: 60, scenes: 8},
  {id: 'long', name: 'Uzun', sec: 90, scenes: 12},
  {id: 'xlong', name: 'Çok uzun', sec: 150, scenes: 18},
];
const lenOf = () => LENGTHS.find(l => l.id === (STORY.length || 'medium')) || LENGTHS[1];
const sceneCount = () => STORY.count === 'auto' || !STORY.count ? lenOf().scenes : +STORY.count;
const storySource = () => (STORY.story || '').trim() || STORY.input.trim();
// 1) hikâye: fikirden düzyazı hikâye (kullanıcı düzenler, senaryo buna sadık kalır)
async function writeStory(){
  if (!STORY.input.trim()){ toast('Önce hikâye fikrini veya taslağını yaz'); return; }
  const parts = +STORY.parts || 1, L = lenOf(), words = Math.round(L.sec * 2.4);
  const prompt = `Sen sosyal medyada milyonlarca izlenen kısa animasyon hikâyeleri yazan ödüllü bir hikâye anlatıcısısın.
Aşağıdaki fikri/taslağı TÜRKÇE, sesli anlatıma uygun, akıcı bir düzyazı hikâyeye dönüştür.
${parts > 1 ? `Hikâye ${parts} parttan oluşacak; her partı "Part 1", "Part 2" … başlığıyla ayır. Her part yaklaşık ${words} kelime (sesli okununca ~${L.sec} sn) olsun, kendi içinde izlenebilsin ve merak uyandıran bir anla bitsin; sonraki part kaldığı yerden devam etsin.`
  : `Hikâye yaklaşık ${words} kelime olsun (sesli okununca ~${L.sec} sn).`}
- İlk cümle izleyeni hemen yakalasın (merak, çarpıcı detay veya beklenmedik an); "Bir gün…" gibi düz girişler yok.
- Karakterlere bir arzu, bir engel ve bir duygu dönüşümü ver; göster, anlatma (duyular, küçük ayrıntılar).
- Diyalogları tırnak içinde yaz; doğal günlük Türkçe kullan. Kısa ve uzun cümleleri karıştır, klişeden kaçın.
- Sonu bir duygu, ders veya sürprizle bağlasın.
Yalnızca hikâye metnini yaz (başlık ilk satırda "Başlık: …" olarak), açıklama ekleme.

Fikir / taslak:
${STORY.input}`;
  try {
    let t = (await askGemini(prompt, 'Hikâye yazılıyor')).trim();
    const m = t.match(/^\s*(?:\*\*)?Başlık:\s*(.+?)(?:\*\*)?\s*$/m);
    if (m){ STORY.title = m[1].replace(/\*/g, '').trim(); t = t.replace(m[0], '').trim(); }
    STORY.story = t; dirty = true; renderStory();
    toast('Hikâye hazır. Düzenleyip "Sahnelere böl" de.');
  } catch (e){ toast('Hikâye yazılamadı: ' + e.message, 'err'); }
  storyBusy(null);
}
async function writeScript(){
  if (!storySource()){ toast('Önce hikâyeyi yaz veya bir metin gir'); return; }
  const approved = !!(STORY.story || '').trim();
  const parts = +STORY.parts || 1, per = sceneCount();
  const n = `tam ${per}`;
  const partTxt = parts > 1 ? `Hikâyeyi TAM ${parts} parta (bölüme) böl; her partta ${n} sahne olsun. Her part kendi içinde izlenebilsin, part sonları merak uyandırsın (cliffhanger), sonraki part kaldığı yerden devam etsin. Her sahnede "part" alanına 1'den ${parts}'e kadar part numarasını yaz.`
    : `Tek part; ${n} sahne. Her sahnede "part": 1 yaz.`;
  const prompt = `Sen sosyal medyada milyonlarca izlenen kısa dikey (${STSET.ratio}) animasyon hikâyeleri yazan ödüllü bir senarist ve görüntü yönetmenisin.
${partTxt}

${approved ? `GÖREV: Aşağıdaki hikâye kullanıcının ONAYLADIĞI son metindir. Olay örgüsünü, sırasını, karakterleri ve sonu DEĞİŞTİRME; yeni olay ekleme.
Hikâyeyi sahnelere böl; seslendirme satırlarını bu metinden uyarla (anlatımı ve diyalogları koru, gerekirse seslendirmeye uygun kısalt). Toplam süre part başına ~${lenOf().sec} sn olsun.`
  : `GÖREV: Aşağıdaki metin yalnızca bir fikir veya taslaktır; onu izleyeni ilk saniyede yakalayan, duygusu ve merakı olan, akıcı bir hikâyeye DÖNÜŞTÜR.
Metin çok kısaysa (ör. tek cümle) yaratıcı ol: karaktere bir arzu, bir engel, küçük bir sır veya beklenmedik bir an ekle; sıradan olayı anlamlı kıl. Toplam süre part başına ~${lenOf().sec} sn olsun.`}

YAZIM KURALLARI (Türkçe metinler için):
- İlk sahnenin ilk cümlesi bir KANCA olsun: merak uyandıran bir soru, çarpıcı bir detay veya beklenmedik bir an. "Bir gün…", "…gidiyordu" gibi düz girişler YASAK.
- Göster, anlatma: duyguyu duyular ve küçük ayrıntılarla ver (sıcak ekmeğin kokusu, titreyen eller, yarım kalan bir cümle).
- Cümle uzunluklarını değiştir; kısa vurucu cümlelerle akıcı uzun cümleleri karıştır. Klişe ve tekrar yok.
- Anlatıcı ile karakter diyaloğunu dengele; diyaloglar doğal, günlük Türkçe olsun, karakterin kişiliğini yansıtsın.
- Her sahne bir öncekinden bir adım ileri gitsin (olay, duygu veya bilgi değişsin). Son sahne bir duygu, ders veya çarpıcı bir sonla kapansın; part sonuysa merakta bıraksın.
- Her sahnede 2–4 satır olsun; her satır 8–22 kelime. Sahneler arasında boşluk/sessizlik kalmasın: anlatım bir sahneden diğerine akmalı.
- duration: o sahnedeki tüm satırların sesli okunma süresi (saniye, yaklaşık kelime sayısı / 2.6) + 0.5; 3 ile 10 arasında.
Konuşanlar: "Anlatıcı" veya karakter adları. image_prompt ve video_prompt İNGİLİZCE olsun.
image_prompt: kareyi ayrıntılı anlat (kompozisyon, ışık, karakterin ne yaptığı, mekân); karakterleri adlarıyla an. Yazı/altyazı isteme.
video_prompt: kareden başlayan hareketi ve kamerayı anlat (ör. slow push-in, karakter döner); diyalog yok, yalnızca ortam sesi.
ambience: sahnenin arka plan ortam sesi (İngilizce, müzik değil; mekâna ve ana uygun, ör. "quiet night street, distant traffic, light wind, footsteps on wet pavement").
characters: hikâyede görünen her karakter için tutarlı görsel tarif (look, İngilizce: yaş, saç, kıyafet, belirgin özellikler)
ve seslendirme için ses tarifi (voice, İngilizce: gender, age, tone; ör. "male, 30s, calm, slightly husky").
narrator_voice: anlatıcı için hikâyenin havasına uygun ses tarifi (İngilizce).
${tagsOk(M.tts()) ? `Seslendirme satırlarında, yalnızca gerçekten gerekli yerlerde, köşeli parantez içinde İngilizce duygu/ses etiketleri kullan:
[whispers], [laughs], [sighs], [gasps], [nervously], [softly], [shouting], [pause] gibi. Etiket satırın içinde, ilgili sözün hemen önünde olsun.` : 'Seslendirme satırlarında köşeli parantezli etiket KULLANMA.'}
${STORY.styleAuto !== false ? `style: hikâyenin türüne, dönemine ve havasına uygun TEK bir görsel stil belirle (İngilizce, tek paragraf: çizim/render tekniği, renk paleti, ışık, doku, kompozisyon).
Hikâye neşeli/gündelikse sıcak ve aydınlık, çocuk hikâyesiyse masalsı, gerilimse karanlık stil seç; karanlık stili yalnızca hikâye gerçekten gerektiriyorsa kullan.
Stilin sonuna "No text, no subtitles, no logos, no watermark." ekle. image_prompt'larda bu stile uy.` : `Görsel stil (her sahnede aynı): ${STORY.style}`}

Yalnızca şu JSON'u döndür:
{"title": "...", ${STORY.styleAuto !== false ? '"style": "...", ' : ''}"narrator_voice": "...", "characters": [{"name": "...", "look": "...", "voice": "..."}],
 "scenes": [{"part": 1, "summary": "Türkçe kısa özet", "lines": [{"speaker": "Anlatıcı", "text": "..."}], "image_prompt": "...", "video_prompt": "...", "ambience": "...", "duration": 8}]}

${approved ? 'Hikâye' : 'Metin'}:
${storySource()}`;
  try {
    const txt = await askGemini(prompt, 'Senaryo yazılıyor');
    const j = parseJson(txt);
    const keep = new Map(STORY.characters.map(c => [c.name, c.voice])), keepRef = new Map(STORY.characters.map(c => [c.name, c.ref]));
    STORY.title = j.title || STORY.title;
    if (STORY.styleAuto !== false && j.style) STORY.style = j.style;
    STORY.characters = (j.characters || []).map(c => ({name: c.name, look: c.look || '', voiceDesc: c.voice || '', voice: keep.get(c.name) || '', ...(keepRef.get(c.name) ? {ref: keepRef.get(c.name)} : {})}));
    STORY.narratorDesc = j.narrator_voice || STORY.narratorDesc || '';
    STORY.scenes = (j.scenes || []).map(s => ({id: uid(), part: clamp(Math.round(+s.part || 1), 1, parts), summary: s.summary || '', image_prompt: s.image_prompt || '', video_prompt: s.video_prompt || '', ambience: s.ambience || '',
      duration: clamp(Math.round(+s.duration || 8), 4, 10), lines: (s.lines || []).map(l => ({speaker: l.speaker || 'Anlatıcı', text: l.text || ''})), st: {}}));
    STORY.scenes.sort((a, b) => a.part - b.part);   // partlar sırayla
    STORY.reviewed = false;
    dirty = true; storyShow('script'); toast(`${parts > 1 ? parts + ' part, ' : ''}${STORY.scenes.length} sahnelik senaryo hazır. Önizlemeyi inceleyip onayla.`);
    setTimeout(() => { const pv = $('stPreview'); if (pv) pv.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 50);
    await suggestVoices().catch(e => toast('Sesler önerilemedi: ' + e.message, 'err'));
  } catch (e){ toast('Senaryo yazılamadı: ' + e.message, 'err'); }
  storyBusy(null);
}
// Gemini'ye metin sor (Interactions API; yeni hesaplarda generateContent kapalı). Model zinciri: asıl → yedek → erişilebilir diğer flash
// modelleri; 45 sn yanıt vermeyen veya yoğun olan modelden hemen sonrakine geçer. Süre sayacı ve iptal var.
async function askGemini(prompt, label){
  const id = uid(), t0 = performance.now();
  let buf = '', txt = '', cur = '', cancelled = false;
  const show = () => storyBusy(`${label} (${cur})… ${Math.round((performance.now() - t0) / 1000)} sn`, () => api.httpAbort(id));
  let tick = setInterval(show, 1000);
  streamSinks.set(id, chunk => { buf += chunk; });
  try {
    const k = await key('gemini');
    if (!GEM_MODELS.length){ try { await fetchGeminiModels(); } catch (e){} }
    // yedekler: flash modelleri; 2.x (yeni hesaplarda kapalı) hariç; önce "lite" (en az yoğun), sonra yüksek sürüm
    const ver = m => parseFloat((m.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const extra = GEM_MODELS.filter(m => /flash/i.test(m) && !/gemini-2\./i.test(m))
      .sort((a, b) => (/lite/.test(b) - /lite/.test(a)) || (/latest/.test(a) - /latest/.test(b)) || ver(b) - ver(a));
    // en ucuz modda önce lite (ücretsiz katmanda en erişilebilir ve en ucuz) modeller
    const models = [...new Set([...(STSET.cheap ? extra.filter(m => /lite/.test(m)) : []), STSET.textModel, STSET.textFallback, ...extra].filter(Boolean))].slice(0, 6);
    let r = null, fails = [];
    outer: for (let round = 0; round < 2; round++){
      if (round){ clearInterval(tick); storyBusy('Tüm modeller yoğun, 10 sn sonra bir tur daha deneniyor…', () => { cancelled = true; }); await sleep(10); if (cancelled) throw new Error('İptal edildi'); tick = setInterval(show, 1000); fails = []; }
      for (const [mi, model] of models.entries()){
        cur = model; buf = ''; show();
        r = await api.httpStream(id, `${GEMINI}/interactions`, {method: 'POST', idle: 45000,   // 45 sn yanıt yoksa sıradaki model
          headers: {'x-goog-api-key': k, 'Content-Type': 'application/json'}, body: JSON.stringify({model, input: prompt})});
        if (r.ok){
          let d = null; try { d = JSON.parse(buf); } catch (e){}
          txt = interactionText(d);
          if (txt.trim()) break outer;
          r = {ok: false, status: 0, error: d && d.error ? errText({data: d}) : 'boş yanıt'};
        }
        if (r.error === 'İptal edildi') throw new Error('İptal edildi');
        fails.push(`${model}: ${r.status || ''} ${errText(r).slice(0, 80)}`);
        if (models[mi + 1]){ clearInterval(tick); storyBusy(`${model} yanıt vermedi, ${models[mi + 1]} deneniyor…`); tick = setInterval(show, 1000); }
      }
    }
    if (!r.ok) throw new Error('Hiçbir model yanıt vermedi.\n' + fails.join('\n'));
    if (cur !== models[0]) toast(`${models[0]} yanıt vermedi; ${cur} kullanıldı`);
    return txt;
  } finally { clearInterval(tick); streamSinks.delete(id); storyBusy(null); }
}
const parseJson = t => JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));   // kod bloğu veya açıklama varsa ayıkla
const streamSinks = new Map();
api.onHttpChunk((id, t) => { const f = streamSinks.get(id); if (f) f(t); });

/* ---------- 2) Seslendirme (ElevenLabs) ---------- */
async function loadVoices(){
  const k = await key('elevenlabs'), all = [];
  let tok = '';
  for (let pg = 0; pg < 6; pg++){   // varsayılan + kendi sesler, sayfa sayfa (en çok 600)
    const r = await api.httpJson(`${ELEVEN}/v2/voices?page_size=100&sort=name${tok ? '&next_page_token=' + encodeURIComponent(tok) : ''}`, {headers: {'xi-api-key': k}});
    if (!r.ok) throw apiErr(r);
    all.push(...(r.data.voices || []));
    if (!r.data.has_more || !r.data.next_page_token) break;
    tok = r.data.next_page_token;
  }
  VOICES = all.map(v => ({voice_id: v.voice_id, name: v.name, labels: v.labels || {}, desc: v.description || '', preview: v.preview_url || '',
    langs: (v.verified_languages || []).map(x => x.language).filter(Boolean), full: true}));
  try { localStorage.setItem('reelix-voices', JSON.stringify(VOICES)); } catch (e){}
}
// önbellekteki sesler (eski sürüm kayıtlarında dil/özellik alanları yoktur: tamamla, eksikse yeniden çekilecek)
const normVoice = v => ({voice_id: v.voice_id, name: v.name || '', labels: v.labels || {}, desc: v.desc || '', preview: v.preview || '', langs: v.langs || [], full: !!v.langs});
try { VOICES = JSON.parse(localStorage.getItem('reelix-voices') || '[]').map(normVoice); } catch (e){ VOICES = []; }
// roller: 'nar' (anlatıcı) veya karakter sırası; her rolün sesi ve ses ayarı (hız, tutarlılık, duygu)
const roleOf = k => k === 'nar' ? {name: 'Anlatıcı', desc: STORY.narratorDesc || 'storyteller narrator', voice: STORY.narrator, vs: STORY.narVs}
  : {name: STORY.characters[k].name, desc: STORY.characters[k].voiceDesc || STORY.characters[k].look, voice: STORY.characters[k].voice, vs: STORY.characters[k].vs};
function setRole(k, patch){
  if (k === 'nar'){ if ('voice' in patch) STORY.narrator = patch.voice; if ('vs' in patch) STORY.narVs = patch.vs; if ('designs' in patch) STORY.narDesigns = patch.designs; }
  else Object.assign(STORY.characters[k], patch);
  dirty = true;
}
const roleKeyOf = speaker => { const i = STORY.characters.findIndex(c => c.name === speaker); return i >= 0 && STORY.characters[i].voice ? i : 'nar'; };
const DEF_VS = {speed: 1, stab: 40, style: 25};   // anlatımcı: biraz daha canlı ve duygulu
const vsFor = speaker => ({...DEF_VS, ...(roleOf(roleKeyOf(speaker)).vs || {})});
const voiceSettings = vs => ({stability: vs.stab / 100, similarity_boost: 0.75, style: vs.style / 100, speed: vs.speed, use_speaker_boost: true});
const voiceFor = speaker => (STORY.characters.find(c => c.name === speaker) || {}).voice || STORY.narrator || STSET.narrator;
// senaryodaki ses tariflerine göre anlatıcı ve karakterlere uygun sesi öner (force değilse yalnızca boş olanlara).
// Önce Gemini eşleştirir; başarısız olursa veya boş kalan rol olursa cinsiyet/yaş/Türkçe desteğine göre kural tabanlı seçilir.
const voiceTxt = v => `${v.name} ${Object.values(v.labels || {}).join(' ')} ${v.desc || ''} ${(v.langs || []).join(' ')}`.toLowerCase();
function scoreVoice(v, desc){
  const d = (desc || '').toLowerCase(), t = voiceTxt(v), lab = v.labels || {};
  const g = (lab.gender || '').toLowerCase();
  let sc = 0;
  if (/\b(female|woman|girl|kadın|kız)\b/.test(d)) sc += g === 'female' ? 6 : g ? -6 : 0;
  else if (/\b(male|man|boy|erkek|adam)\b/.test(d)) sc += g === 'male' ? 6 : g ? -6 : 0;
  const ag = (lab.age || '').toLowerCase(), n = +(d.match(/(\d)0s/) || [])[1];
  const want = /child|kid|çocuk/.test(d) ? 'young' : /old|elderly|yaşlı|aged/.test(d) || n >= 6 ? 'old' : n >= 4 || /middle/.test(d) ? 'middle' : n ? 'young' : '';
  if (want && ag) sc += ag.includes(want) ? 3 : -1;
  if ((v.langs || []).some(l => /^tr/i.test(l)) || /turkish|türk/.test(t)) sc += 4;
  for (const w of d.split(/[^a-zçğıöşü]+/).filter(w => w.length > 3)) if (t.includes(w)) sc += 1;   // deep, calm, mysterious…
  if (/narrat|storytell|audiobook/.test(t)) sc += 0.5;
  return sc;
}
async function suggestVoices(force){
  if (!(await api.secretGet('elevenlabs'))){ toast('Ses önerisi için Ayarlar\'a ElevenLabs API anahtarını gir', 'err'); return; }
  if (!VOICES.length || VOICES.some(v => !v.full)) await loadVoices();   // eski önbellekte özellik bilgisi yok
  if (!VOICES.length){ toast('ElevenLabs hesabında ses bulunamadı. ElevenLabs\'te Voice Library\'den birkaç ses ekleyip tekrar dene.', 'err'); return; }
  const roles = [{key: 'nar', desc: STORY.narratorDesc || 'narrator, calm, deep', cur: STORY.narrator},
    ...STORY.characters.map((c, i) => ({key: i, desc: c.voiceDesc || c.look, cur: c.voice}))].filter(r => force || !r.cur);
  if (!roles.length) return;
  const byKey = new Map();
  // 1) Gemini
  try {
    const list = VOICES.slice(0, 150).map(v => `${v.voice_id} | ${v.name} | ${Object.values(v.labels || {}).join(', ')}${(v.langs || []).length ? ' | langs: ' + v.langs.join(',') : ''}`).join('\n');
    const prompt = `Bir Türkçe hikâye videosu seslendirilecek. Her role aşağıdaki listeden en uygun sesi seç. Türkçe destekleyen sesleri tercih et, farklı rollere farklı sesler ver.
Hikâye: ${STORY.title} — ${storySource().slice(0, 300)}
Roller:
${roles.map(r => `- ${r.key === 'nar' ? 'Anlatıcı' : STORY.characters[r.key].name}: ${r.desc}`).join('\n')}
Sesler (voice_id | ad | özellikler):
${list}
Yalnızca JSON döndür, değerler voice_id olsun: {"Anlatıcı": "voice_id", "Karakter adı": "voice_id"}`;
    const j = parseJson(await askGemini(prompt, 'Sesler seçiliyor'));
    const find = x => x && VOICES.find(v => v.voice_id === x || v.name.toLowerCase() === String(x).toLowerCase());
    for (const r of roles){ const v = find(j[r.key === 'nar' ? 'Anlatıcı' : STORY.characters[r.key].name] || (r.key === 'nar' ? j.narrator : null)); if (v) byKey.set(r.key, v.voice_id); }
  } catch (e){ console.warn('Gemini ses önerisi olmadı, kural tabanlı seçiliyor', e); }
  // 2) boş kalanlara kural tabanlı en iyi ses (mümkünse kullanılmamış)
  const used = new Set(byKey.values());
  for (const r of roles){
    if (byKey.has(r.key)) continue;
    const best = [...VOICES].sort((a, b) => (scoreVoice(b, r.desc) - (used.has(b.voice_id) ? 3 : 0)) - (scoreVoice(a, r.desc) - (used.has(a.voice_id) ? 3 : 0)))[0];
    if (best){ byKey.set(r.key, best.voice_id); used.add(best.voice_id); }
  }
  for (const [k, id] of byKey){ if (k === 'nar') STORY.narrator = id; else STORY.characters[k].voice = id; }
  dirty = true; renderStory();
  const nm = id => (VOICES.find(v => v.voice_id === id) || {}).name || '-';
  toast(`Sesler seçildi: Anlatıcı → ${nm(STORY.narrator)}${STORY.characters.map(c => `, ${c.name} → ${nm(c.voice)}`).join('')}`);
}
async function makeLineAudio(s, li){
  const l = s.lines[li], voice = voiceFor(l.speaker);
  if (!voice){ storyShow('settings'); throw new Error(`"${l.speaker}" için ses seçilmemiş (Ayarlar → varsayılan anlatıcı veya Senaryo → karakter sesi)`); }
  const out = await mediaPath(`story_${s.id}_${li}_${hash(l.text + voice + M.tts() + JSON.stringify(vsFor(l.speaker)))}.mp3`);
  if (!(await api.exists(out))){
    const say = t => tagsOk(M.tts()) ? t : stripTags(t);
    if (!stripTags(l.text)) throw new Error('Satırda yalnızca etiket var, okunacak söz yok');
    const body = {text: say(l.text), model_id: M.tts(), voice_settings: voiceSettings(vsFor(l.speaker)), previous_text: say((s.lines[li - 1] || {}).text) || undefined, next_text: say((s.lines[li + 1] || {}).text) || undefined};
    if (M.tts() !== 'eleven_multilingual_v2') body.language_code = 'tr';
    const k = await key('elevenlabs');
    const raw = out.replace(/\.mp3$/, '_raw.mp3');
    const r = await withRetry('Seslendirme', () => api.httpFile(`${ELEVEN}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      {method: 'POST', headers: {'xi-api-key': k, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}, raw));
    storyBusy(null);
    if (!r.ok) throw new Error(`${r.status}: ${r.error}`);
    await trimSilence(raw, out);
  }
  l.audio = out; l.dur = (await api.probe(out)).duration || 0; l.key = hash(l.text + voice + M.tts() + JSON.stringify(vsFor(l.speaker)));
}
// rolün sesini kendi ayarlarıyla, kendi ilk satırıyla dinle (az miktarda kredi harcar)
async function testRole(k){
  const r = roleOf(k), voice = r.voice || (k === 'nar' ? STSET.narrator : STORY.narrator || STSET.narrator);
  if (!voice){ toast('Önce bir ses seç'); return; }
  const line = STORY.scenes.flatMap(s => s.lines).find(l => (k === 'nar' ? roleKeyOf(l.speaker) === 'nar' : l.speaker === r.name) && stripTags(l.text));
  const text = line ? line.text : 'Merhaba, hikâyemizi birlikte dinleyeceğiz.';
  const vs = {...DEF_VS, ...(r.vs || {})}, out = await mediaPath(`story_test_${hash(text + voice + M.tts() + JSON.stringify(vs))}.mp3`);
  if (!(await api.exists(out))){
    storyBusy('Örnek seslendiriliyor…');
    const body = {text: tagsOk(M.tts()) ? text : stripTags(text), model_id: M.tts(), voice_settings: voiceSettings(vs)};
    if (M.tts() !== 'eleven_multilingual_v2') body.language_code = 'tr';
    const res = await api.httpFile(`${ELEVEN}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {method: 'POST', headers: {'xi-api-key': await key('elevenlabs'), 'Content-Type': 'application/json'}, body: JSON.stringify(body)}, out);
    storyBusy(null);
    if (!res.ok){ toast(`Örnek üretilemedi: ${res.status} ${errText({error: res.error})}`, 'err'); return; }
  }
  stAudio.src = fileUrl(out); stAudio.play();
}
// karaktere özel ses tasarla (ElevenLabs Voice Design): tariften 3 aday üretir, seçilen hesaba kalıcı ses olarak eklenir
async function designVoice(k){
  const r = roleOf(k);
  const own = STORY.scenes.flatMap(s => s.lines).filter(l => k === 'nar' ? roleKeyOf(l.speaker) === 'nar' : l.speaker === r.name).map(l => stripTags(l.text)).join(' ');
  let text = own;
  const fill = ' Bu hikâyede neler olacağını birlikte göreceğiz. Bazen sessizlik, bazen de tek bir cümle her şeyi anlatır; şimdi dikkatle dinle.';
  while (text.length < 110) text += fill;
  storyBusy(`${r.name} için ses tasarlanıyor…`);
  try {
    const res = await api.httpJson(`${ELEVEN}/v1/text-to-voice/design?output_format=mp3_44100_128`, {method: 'POST', headers: {'xi-api-key': await key('elevenlabs'), 'Content-Type': 'application/json'},
      body: JSON.stringify({voice_description: `${r.desc}. Native Turkish speaker with a natural Istanbul Turkish accent.`, model_id: 'eleven_multilingual_ttv_v2', text: text.slice(0, 1000)})});
    if (!res.ok) throw apiErr(res);
    const designs = [];
    for (const [i, pv] of (res.data.previews || []).entries()){
      const out = await mediaPath(`story_design_${hash(pv.generated_voice_id)}.mp3`);
      await api.writeBase64(out, pv.audio_base_64); designs.push({gid: pv.generated_voice_id, path: out, n: i + 1});
    }
    if (!designs.length) throw new Error('Aday ses gelmedi');
    setRole(k, {designs}); renderStory();
    toast(`${designs.length} aday ses hazır. ▶ ile dinle, beğendiğine "Kullan" de.`);
  } catch (e){ toast('Ses tasarlanamadı: ' + e.message, 'err'); }
  storyBusy(null);
}
async function useDesign(k, i){
  const r = roleOf(k), d = (k === 'nar' ? STORY.narDesigns : STORY.characters[k].designs || [])[i]; if (!d) return;
  storyBusy('Ses hesabına ekleniyor…');
  try {
    const res = await api.httpJson(`${ELEVEN}/v1/text-to-voice`, {method: 'POST', headers: {'xi-api-key': await key('elevenlabs'), 'Content-Type': 'application/json'},
      body: JSON.stringify({voice_name: `${STORY.title || 'Reelix'} - ${r.name}`.slice(0, 60), voice_description: r.desc.slice(0, 500), generated_voice_id: d.gid})});
    if (!res.ok) throw apiErr(res);
    const id = res.data.voice_id;
    VOICES.unshift({voice_id: id, name: `${STORY.title || 'Reelix'} - ${r.name}`, labels: {}, desc: r.desc, preview: fileUrl(d.path), langs: ['tr'], full: true});
    try { localStorage.setItem('reelix-voices', JSON.stringify(VOICES)); } catch (e){}
    setRole(k, {voice: id, designs: []}); renderStory(); toast(`${r.name} artık kendi sesini kullanıyor`);
  } catch (e){ toast('Ses eklenemedi: ' + e.message, 'err'); }
  storyBusy(null);
}
// sesin başındaki ve sonundaki sessizliği kırp (satırlar arasında boşluk birikmesin)
async function trimSilence(src, out){
  const edge = 'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-45dB';
  try { await runFfmpeg(['-i', src, '-af', `${edge},areverse,${edge},areverse`, '-c:a', 'libmp3lame', '-b:a', '160k', out], 0); }
  catch (e){ await runFfmpeg(['-i', src, '-c', 'copy', out], 0); }   // kırpılamazsa olduğu gibi
}
async function makeSceneAudio(s){
  for (let i = 0; i < s.lines.length; i++) if (stripTags(s.lines[i].text)) await makeLineAudio(s, i);
}

/* ---------- 2b) Ortam sesi (ElevenLabs ses efekti, döngüye uygun) ---------- */
const voiceLen = s => s.lines.reduce((a, l) => a + (l.audio ? (l.dur || 0) + 0.25 : 0), 0.5);
async function makeAmbience(s){
  const text = (s.ambience || '').trim(); if (!text) throw new Error('Ortam sesi tarifi boş');
  const dur = clamp(Math.ceil(Math.max(s.duration, voiceLen(s))), 1, 30);
  const out = await mediaPath(`story_${s.id}_amb_${hash(text + dur + M.sfx())}.mp3`);
  if (!(await api.exists(out))){
    const k = await key('elevenlabs');
    const r = await withRetry('Ortam sesi', () => api.httpFile(`${ELEVEN}/v1/sound-generation?output_format=mp3_44100_128`,
      {method: 'POST', headers: {'xi-api-key': k, 'Content-Type': 'application/json'},
       body: JSON.stringify({text, duration_seconds: dur, loop: true, prompt_influence: 0.5, model_id: M.sfx()})}, out));
    storyBusy(null);
    if (!r.ok) throw new Error(`${r.status}: ${r.error}`);
  }
  s.amb = out;
}

/* ---------- 3) Görsel ---------- */
const charsText = () => STORY.characters.filter(c => c.look).map(c => `${c.name}: ${c.look}`).join('; ');
const imagePromptFull = s => `${s.image_prompt}\n\nCharacters: ${charsText()}\nStyle: ${STORY.style}\nVertical ${STSET.ratio} composition.`;
const videoPromptFull = s => `${s.video_prompt}\nKeep the exact art style and characters of the starting image. ${STORY.style}\nNo dialogue, no speech; ambient sound only. No text, no subtitles.`;
// sahne görseli için referanslar: karakter görselleri önce (en çok 4), sonra elle eklenen referanslar
const storyRefs = () => [...STORY.characters.map(c => c.ref).filter(Boolean).slice(0, 4), ...STORY.refs].slice(0, 6);
const charPromptFull = c => `Character reference sheet of ${c.name}: ${c.look}.
Full body front view and a close-up of the face side by side, neutral standing pose, plain dark grey background, clear consistent design for reuse in later scenes.
Style: ${STORY.style}`;
/* ---------- Ücretsiz görsel: Cloudflare Workers AI (günde 10.000 neuron; kota bitince ücret değil hata) ---------- */
const CF_MODELS = [
  {id: '@cf/black-forest-labs/flux-1-schnell', name: 'FLUX-1 Schnell · en kaliteli, kare üretir (dikey için kırpılır) · ~230/gün'},
  {id: '@cf/bytedance/stable-diffusion-xl-lightning', name: 'SDXL Lightning · doğrudan dikey/yatay boyut'},
];
const cfSize = ratio => ({'9:16': [768, 1344], '16:9': [1344, 768], '4:3': [1152, 864], '1:1': [1024, 1024]})[ratio] || [1024, 1024];
async function cfImage(prompt, ratio, out){
  const [acc, tok] = await Promise.all([api.secretGet('cf-account'), api.secretGet('cf-token')]);
  if (!acc || !tok){ storyShow('settings'); throw new Error('Cloudflare hesap kimliği ve API anahtarı girilmemiş (Ayarlar → Ücretsiz görsel)'); }
  const model = STSET.cfModel || CF_MODELS[0].id, url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${model}`;
  const headers = {'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json'};
  const tmp = out.replace(/\.\w+$/, '_raw.png');
  if (/flux-1-schnell/.test(model)){
    const r = await withRetry('Görsel', () => api.httpJson(url, {method: 'POST', headers, body: JSON.stringify({prompt: prompt.slice(0, 2048), steps: 6})}));
    storyBusy(null);
    if (!r.ok) throw new Error(`${r.status}: ${cfErr(r.data)}`);
    const b64 = (r.data.result || r.data).image; if (!b64) throw new Error('Yanıtta görsel yok');
    await api.writeBase64(tmp, b64);
  } else {
    const [w, h] = cfSize(ratio);
    const r = await withRetry('Görsel', () => api.httpFile(url, {method: 'POST', headers, body: JSON.stringify({prompt: prompt.slice(0, 2048), width: w, height: h, num_steps: 8})}, tmp));
    storyBusy(null);
    if (!r.ok){ let d = r.error; try { d = JSON.parse(r.error); } catch (e){} throw new Error(`${r.status}: ${cfErr(d)}`); }
  }
  // istenen orana ortadan kırp (FLUX kare üretir); diğerleri zaten doğru boyutta
  const crop = {'9:16': 'crop=min(iw\\,ih*9/16):ih', '16:9': 'crop=iw:min(ih\\,iw*9/16)', '4:3': 'crop=iw:min(ih\\,iw*3/4)'}[ratio];
  await runFfmpeg(['-i', tmp, ...(crop ? ['-vf', crop] : []), '-frames:v', '1', '-q:v', '2', out], 0);
}
const cfErr = d => (d && d.errors && d.errors[0] && d.errors[0].message) || (typeof d === 'string' ? d.slice(0, 200) : JSON.stringify(d || '').slice(0, 200));
async function makeCharApi(c){
  if (freeImg()){ const out = await mediaPath(`story_char_${hash(c.name + Date.now())}.jpg`); await cfImage(charPromptFull(c), '4:3', out); c.ref = out; return; }
  const d = await gemini('interactions', {model: M.image(), input: [{type: 'text', text: charPromptFull(c)}],
    response_format: {type: 'image', aspect_ratio: '4:3', image_size: M.imageSize()}}, 'Karakter');
  const o = interactionOutput(d, 'image'); if (!o || !o.data) throw new Error('Yanıtta görsel yok');
  const out = await mediaPath(`story_char_${hash(c.name + Date.now())}.${(o.mime_type || '').includes('png') ? 'png' : 'jpg'}`);
  await api.writeBase64(out, o.data); c.ref = out;
}
async function runChar(c){
  if (!freeImg() && !needPaid()) return;
  c.st = 'busy'; renderStory();
  try { await makeCharApi(c); c.st = ''; dirty = true; }
  catch (e){
    c.st = 'err'; c.err = e.message;
    toast(/limit: 0|Free Tier/i.test(e.message) ? 'Gemini API ücretsiz katmanında görsel üretimi kapalı. Karakter için "Flow için kopyala"yı kullan.' : `${c.name}: ${e.message}`, 'err');
  }
  renderStory();
}
async function makeImageApi(s){
  if (freeImg()){ const out = await mediaPath(`story_${s.id}_img_${Date.now()}.jpg`); await cfImage(imagePromptFull(s), STSET.ratio, out); s.image = out; return; }
  const input = [{type: 'text', text: imagePromptFull(s)}];
  for (const p of storyRefs()) input.push({type: 'image', mime_type: mimeOf(p), data: await api.readBase64(p)});
  const d = await gemini('interactions', {model: M.image(), input, response_format: {type: 'image', aspect_ratio: STSET.ratio, image_size: M.imageSize()}}, 'Görsel');
  const o = interactionOutput(d, 'image'); if (!o || !o.data) throw new Error('Yanıtta görsel yok');
  const out = await mediaPath(`story_${s.id}_img_${Date.now()}.${(o.mime_type || '').includes('png') ? 'png' : 'jpg'}`);
  await api.writeBase64(out, o.data); s.image = out;
}

/* ---------- 4) Video (Omni) ---------- */
async function makeVideoApi(s){
  if (!s.image) throw new Error('Önce bu sahnenin görselini üret veya seç');
  const k = await key('gemini');
  const d = await gemini('interactions', {model: M.video(),
    input: [{type: 'image', mime_type: mimeOf(s.image), data: await api.readBase64(s.image)}, {type: 'text', text: videoPromptFull(s)}],
    response_format: {type: 'video', aspect_ratio: STSET.ratio === '16:9' ? '16:9' : '9:16', resolution: M.resolution(), duration: `${clamp(Math.ceil(Math.max(s.lines.some(l => l.audio) ? voiceLen(s) : 0, s.duration)), 3, 10)}s`, delivery: 'uri'}}, 'Video');
  const o = interactionOutput(d, 'video'); if (!o) throw new Error('Yanıtta video yok');
  const out = await mediaPath(`story_${s.id}_vid_${Date.now()}.mp4`);
  if (o.data){ await api.writeBase64(out, o.data); s.video = out; return; }
  // dosya hazır olana kadar bekle, sonra indir
  const id = String(o.uri).match(/files\/([^/:?]+)/)?.[1]; if (!id) throw new Error('Video adresi okunamadı');
  for (let i = 0; ; i++){
    const r = await api.httpJson(`${GEMINI}/files/${id}`, {headers: {'x-goog-api-key': k}});
    const st = r.data && r.data.state;
    if (st === 'ACTIVE') break;
    if (st === 'FAILED' || i > 180) throw new Error('Video üretilemedi');
    await new Promise(res => setTimeout(res, 5000));
  }
  const r = await api.httpFile(`${GEMINI}/files/${id}:download?alt=media`, {headers: {'x-goog-api-key': k}}, out);
  if (!r.ok) throw new Error(`İndirilemedi (${r.status})`);
  s.video = out;
}

/* ---------- Flow'da elle: prompt kopyala, inen dosyayı sıradaki sahneye yerleştir ---------- */
const waiting = [];   // [{sid, kind: 'image'|'video'} | {cname, kind: 'char'}]
async function flowCopyChar(c){
  await api.clipboardWrite(charPromptFull(c));
  if (!waiting.some(w => w.cname === c.name)) waiting.push({cname: c.name, kind: 'char'});
  c.st = 'wait'; await api.downloadsWatch(true); renderStory();
  toast(`${c.name} için karakter promptu kopyalandı. Flow'da Nano Banana ile üretip indir; görsel karaktere otomatik yerleşir.`);
}
async function flowCopy(s, kind){
  await api.clipboardWrite(kind === 'image' ? imagePromptFull(s) : videoPromptFull(s));
  if (!waiting.some(w => w.sid === s.id && w.kind === kind)) waiting.push({sid: s.id, kind});
  s.st[kind] = 'wait'; await api.downloadsWatch(true);
  renderStory();
  toast(`${kind === 'image' ? 'Görsel' : 'Video'} promptu kopyalandı. Flow'da üretip indir; dosya bu sahneye otomatik yerleşir.`);
}
api.onDownload(async p => {
  if (!STORY) return;
  const kind = /\.(png|jpe?g|webp)$/i.test(p) ? 'image' : 'video';
  const wi = waiting.findIndex(w => kind === 'video' ? w.kind === 'video' : w.kind !== 'video'); if (wi < 0) return;   // görseller sırayla (karakter veya sahne)
  const [w] = waiting.splice(wi, 1);
  const copy = await api.importMedia(p); if (!copy) return;
  if (w.kind === 'char'){
    const c = STORY.characters.find(x => x.name === w.cname); if (!c) return;
    c.ref = copy; c.st = ''; dirty = true;
    if (!waiting.length) api.downloadsWatch(false);
    renderStory(); toast(`${c.name}: karakter görseli alındı`); return;
  }
  const s = STORY.scenes.find(x => x.id === w.sid); if (!s) return;
  s[kind] = copy; s.st[kind] = ''; dirty = true;
  if (!waiting.length) api.downloadsWatch(false);
  renderStory(); toast(`${sceneLabel(s, STORY.scenes.indexOf(s))}: ${kind === 'image' ? 'görsel' : 'video'} alındı`);
});
async function pickFile(s, kind){
  const [src] = await api.openFiles(kind === 'image' ? 'image' : 'video', false); if (!src) return;
  const p = await api.importMedia(src); if (!p) return;
  s[kind] = p; s.st[kind] = ''; dirty = true; renderStory();
}

/* ---------- Çalıştırıcı: tek iş veya sıralı toplu iş ---------- */
let storyRunning = false;
async function runJob(s, kind, fn){
  s.st[kind] = 'busy'; s.err = s.err || {}; delete s.err[kind]; renderStory();
  try { await fn(s); s.st[kind] = ''; dirty = true; }
  catch (e){
    s.st[kind] = 'err'; s.err[kind] = e.message;
    if (/limit: 0|Free Tier/i.test(e.message) && kind !== 'audio'){ storyRunning = false;   // ücretsiz katmanda görsel/video kotası yok: tekrar denemenin anlamı yok
      toast('Gemini API ücretsiz katmanında görsel ve video üretimi kapalı. Bu sahneler için "Flow için kopyala"yı kullan veya ai.dev/rate-limit üzerinden ödemeyi aç.', 'err'); }
    else toast(`${sceneLabel(s, STORY.scenes.indexOf(s))}: ${e.message}`, 'err');
  }
  renderStory();
}
async function runAll(kind){
  if (storyRunning) return;
  if ((kind === 'video' || (kind === 'image' && !freeImg())) && !needPaid()) return;
  const fn = {audio: makeSceneAudio, amb: makeAmbience, image: makeImageApi, video: makeVideoApi}[kind];
  const todo = STORY.scenes.filter(s => kind === 'amb' ? !s.amb && (s.ambience || '').trim() : kind === 'audio' ? s.lines.some(l => l.text.trim() && (!l.audio || l.key !== hash(l.text + voiceFor(l.speaker) + M.tts() + JSON.stringify(vsFor(l.speaker))))) : !s[kind]);
  if (!todo.length){ toast('Eksik olan yok; yeniden üretmek için sahnedeki düğmeyi kullan'); return; }
  if (kind === 'video'){
    const sec = todo.reduce((a, s) => a + s.duration, 0);
    if (!confirm(`${todo.length} video (${sec} sn) Gemini API ile üretilecek. Google kullanım ücreti alır (saniye başına yaklaşık 0,10 $). Devam edilsin mi?`)) return;
  }
  storyRunning = true; renderStory();
  for (const s of todo){ if (!storyRunning) break; await runJob(s, kind, fn); }
  storyRunning = false; renderStory();
}

/* ---------- Dışa aktarma: dosyalar <Proje başlığı>_sahne-N adıyla; toplu aktarmada Görsel / Ses / Video klasörleri ---------- */
const safeName = t => String(t || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
const exportBase = () => safeName(projPath ? stem(projPath) : STORY.title || 'Reelix') || 'Reelix';
const extOf = p => (p.match(/\.[a-z0-9]+$/i) || ['.bin'])[0].toLowerCase();
const sceneNo = s => STORY.scenes.indexOf(s) + 1;
// sahnenin seslendirme satırlarını tek dosyada birleştir (kurulumdaki gibi satırlar arasında kısa boşluk)
async function combineVoice(s, out){
  const files = s.lines.map(l => l.audio).filter(Boolean);
  if (!files.length) return false;
  for (const f of files) if (!(await api.exists(f))) throw new Error('Ses dosyası bulunamadı; sesi yeniden üret');
  const args = [], f = [];
  files.forEach((p, i) => { args.push('-i', p); f.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`); });
  const seq = files.map((_, i) => i ? `[g${i}][a${i}]` : `[a${i}]`).join('');
  files.forEach((_, i) => { if (i) f.push(`aevalsrc=0:c=stereo:s=44100:d=0.18[g${i}]`); });
  f.push(`${seq}concat=n=${files.length * 2 - 1}:v=0:a=1[out]`);
  await runFfmpeg([...args, '-filter_complex', f.join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', out], 0);
  return true;
}
// tek dosya: dışa aktarma klasörüne (Dışa aktar penceresinde seçilen, hatırlanan klasör)
async function exportOne(kind, s, c){
  await showExportDir();
  const base = exportBase();
  let out;
  try {
    if (kind === 'char'){ out = await api.joinPath(exportDir, `${base}_karakter-${safeName(c.name)}${extOf(c.ref)}`); await api.copyFile(c.ref, out); }
    else if (kind === 'audio'){ out = await api.joinPath(exportDir, `${base}_sahne-${sceneNo(s)}.mp3`); if (!(await combineVoice(s, out))) throw new Error('Bu sahnenin sesi yok'); }
    else { const src = s[kind]; out = await api.joinPath(exportDir, `${base}_sahne-${sceneNo(s)}${extOf(src)}`); await api.copyFile(src, out); }
    toast(`Dışa aktarıldı: ${basename(out)}`); lastStoryExport = out;
  } catch (e){ toast('Dışa aktarılamadı: ' + e.message, 'err'); }
}
let lastStoryExport = null;
// hepsi: <klasör>/<Proje başlığı>/Görsel, Ses, Video
async function exportAll(){
  await showExportDir();
  const base = exportBase(), root = await api.joinPath(exportDir, base);
  const dirs = {img: await api.joinPath(root, 'Görsel'), aud: await api.joinPath(root, 'Ses'), vid: await api.joinPath(root, 'Video')};
  for (const d of Object.values(dirs)) await api.mkdirp(d);
  let n = {img: 0, aud: 0, vid: 0}; const errs = [];
  for (const [i, s] of STORY.scenes.entries()){
    storyBusy(`Dışa aktarılıyor… sahne ${i + 1}/${STORY.scenes.length}`);
    const name = `${base}_sahne-${i + 1}`;
    try {
      if (s.image && await api.exists(s.image)){ await api.copyFile(s.image, await api.joinPath(dirs.img, name + extOf(s.image))); n.img++; }
      if (s.video && await api.exists(s.video)){ await api.copyFile(s.video, await api.joinPath(dirs.vid, name + extOf(s.video))); n.vid++; }
      if (await combineVoice(s, await api.joinPath(dirs.aud, name + '.mp3'))) n.aud++;
      if (s.amb && await api.exists(s.amb)){ await api.copyFile(s.amb, await api.joinPath(dirs.aud, `${name}_ortam${extOf(s.amb)}`)); n.aud++; }
    } catch (e){ errs.push(`Sahne ${i + 1}: ${e.message}`); }
  }
  for (const c of STORY.characters) if (c.ref && await api.exists(c.ref)){ await api.copyFile(c.ref, await api.joinPath(dirs.img, `${base}_karakter-${safeName(c.name)}${extOf(c.ref)}`)); n.img++; }
  storyBusy(null);
  lastStoryExport = root; api.reveal(dirs.img);
  toast(`${base} klasörüne aktarıldı: ${n.img} görsel, ${n.aud} ses, ${n.vid} video${errs.length ? ` · ${errs.length} hata: ${errs[0]}` : ''}`, errs.length ? 'err' : undefined);
}

/* ---------- 5) Reelix'te kur ---------- */
// sesler satır satır, aralarında kısa boşlukla; video sesten kısaysa son kare dondurularak uzatılır
async function stillClip(src, fromVideo, seconds, name){
  const out = await mediaPath(`story_still_${hash(src + seconds.toFixed(2))}.mp4`);
  if (await api.exists(out)) return out;
  const tmp = await api.makeTemp(), png = tmp + '/k.png';
  try {
    await runFfmpeg(fromVideo ? ['-sseof', '-0.1', '-i', src, '-frames:v', '1', '-update', '1', png] : ['-i', src, '-frames:v', '1', png], 0);
    await runFfmpeg(['-loop', '1', '-framerate', '30', '-t', seconds.toFixed(2), '-i', png, '-f', 'lavfi', '-t', seconds.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-c:a', 'aac', '-shortest', out], seconds);
  } finally { api.removeDir(tmp); }
  return out;
}
// dosyayı kitaplık öğesine çevir (kopyalama bildirimi olmadan); voice: kitaplığa ekleme
async function libItem(p, kind, add = true){
  let it = LIB.find(x => x.path === p); if (it) return it;
  const info = await api.probe(p); if (!(info.duration > 0)) return null;
  it = {id: uid(), path: p, name: basename(p), kind, dur: info.duration, w: info.width, h: info.height, fps: info.fps, hasAudio: info.hasAudio};
  if (add){ LIB.push(it); ensureVisuals(it, kind === 'video'); }
  return it;
}
const clipFrom = (it, vol) => ({id: uid(), path: it.path, name: it.name, dur: it.dur, w: it.w, h: it.h, fps: it.fps, hasAudio: it.hasAudio,
  in: 0, out: it.dur, vol, muted: false, env: DEF_ENV(), fadeIn: 0, fadeOut: 0, tr: null, gap: 0});
async function buildInReelix(){
  const bp = STORY.buildPart && STORY.buildPart !== 'all' ? +STORY.buildPart : null;
  const pool = STORY.scenes.filter(s => !bp || (s.part || 1) === bp);
  const ready = pool.filter(s => s.video || s.image);
  if (!ready.length){ toast('Kurmak için en az bir sahnenin videosu veya görseli olmalı'); return; }
  if (ready.length < pool.length && !confirm(`${pool.length - ready.length} sahnenin videosu/görseli yok; onlar atlanacak. Devam edilsin mi?`)) return;
  storyBusy('Reelix\'te kuruluyor…');
  try {
    storeView();
    // boş varsayılan sahne varsa onun yerine kur
    if (SCENES.length === 1 && !SCENES[0].clips.length && !SCENES[0].audios.length){ PROJ.clips = PROJ.clips.filter(b => b.scene !== SCENES[0].id); SCENES = []; }
    const made = [];
    const multi = new Set(STORY.scenes.map(x => x.part || 1)).size > 1;
    for (const [i, s] of STORY.scenes.entries()){
      if (!s.video && !s.image) continue;
      if (bp && (s.part || 1) !== bp) continue;
      const sc = newScene(((multi ? `P${s.part || 1} · ` : '') + sceneLabel(s, i)).slice(0, 44));
      // seslendirme
      let t = 0.15;
      const subs = [];
      for (const l of s.lines){
        if (!l.audio || !(await api.exists(l.audio))) continue;
        const it = await libItem(l.audio, 'audio', false); if (!it) continue;
        sc.audios.push({id: uid(), path: it.path, name: `${l.speaker}: ${stripTags(l.text).slice(0, 24)}`, dur: it.dur, len: it.dur, start: t, vol: 1, muted: false,
          env: DEF_ENV(), trimIn: 0, fadeIn: 0, fadeOut: 0, loop: false, hasAudio: true, track: 0});
        if (stripTags(l.text)) subs.push({start: t, end: t + it.dur, text: stripTags(l.text)});   // altyazıda etiket görünmez
        t += it.dur + 0.18;
      }
      // sahne süresi seslendirmeye göre (sessiz bekleme olmasın); satırı olmayan sahne kendi süresinde kalır
      const voiceEnd = subs.length ? t + 0.25 : Math.max(2.5, s.duration);
      // görüntü
      if (s.video){
        const it = await libItem(s.video, 'video');
        if (it){ const c = clipFrom(it, STSET.videoVol / 100); if (subs.length && it.dur > voiceEnd + 0.3) c.out = voiceEnd; sc.clips.push(c); }   // video sesten uzunsa sese göre kısalt
        if (it && voiceEnd > it.dur + 0.1){ const st = await libItem(await stillClip(s.video, true, voiceEnd - it.dur, s.id), 'video', false); if (st) sc.clips.push(clipFrom(st, 0)); }
      } else {
        const st = await libItem(await stillClip(s.image, false, voiceEnd, s.id), 'video');
        if (st){ const c = clipFrom(st, 0); c.fx = {motion: {id: ['zoomin', 'left', 'zoomout', 'right', 'up'][i % 5], k: 0.4}}; sc.clips.push(c); }
      }
      // ortam sesi: sahne boyunca alttaki ses izinde, döngülü ve yumuşak giriş/çıkışlı
      if (s.amb && await api.exists(s.amb)){
        const it = await libItem(s.amb, 'audio', false), len = sc.clips.reduce((a, c) => a + (c.out - c.in), 0);
        if (it && len > 0.2) sc.audios.push({id: uid(), path: it.path, name: `Ortam: ${(s.ambience || '').slice(0, 24)}`, dur: it.dur, len, start: 0,
          vol: STSET.ambVol / 100, muted: false, env: DEF_ENV(), trimIn: 0, fadeIn: Math.min(0.6, len / 4), fadeOut: Math.min(1, len / 4), loop: true, hasAudio: true, track: 1});
      }
      sc.clips.forEach(c => ensureVisuals(c, true)); sc.audios.forEach(a => ensureVisuals(a, false));
      SCENES.push(sc); PROJ.clips.push(sceneBlock(sc));
      made.push({sc, subs});
    }
    // altyazılar: her satır projede kendi zamanında, uzun satırlar parçalanır
    sceneCache.clear();
    const pl = layoutClips(PROJ.clips, false, false, 1);
    for (const {sc, subs} of made){
      const o = pl.find(x => x.c.scene === sc.id); if (!o) continue;
      for (const sb of subs){
        const words = sb.text.split(/\s+/).filter(Boolean), chunks = [];
        for (let i = 0; i < words.length; i += 7) chunks.push(words.slice(i, i + 7).join(' '));
        const total = chunks.reduce((a, c) => a + c.length, 0) || 1;
        let c0 = o.t0 + sb.start;
        for (const ch of chunks){
          const d = (sb.end - sb.start) * ch.length / total;
          PROJ.cues.push({id: uid(), start: c0, end: c0 + d, text: ch, words: wordsFromText(ch, c0, c0 + d)});
          c0 += d;
        }
      }
    }
    PROJ.cues.sort((a, b) => a.start - b.start);
    dirty = true; $('storyModal').hidden = true;
    loadView('project'); renderLibrary();
    toast(`${made.length} sahne, seslendirme ve altyazılar projeye eklendi`);
  } catch (e){ console.error(e); toast('Kurulamadı: ' + e.message, 'err'); }
  storyBusy(null);
}

/* ---------- Arayüz ---------- */
function storyBusy(msg, cancel){
  $('stBusy').textContent = msg || ''; $('stBusy').hidden = !msg;
  $('stCancel').hidden = !(msg && cancel); $('stCancel').onclick = cancel || null;
}
function storyShow(tab){ storyTab = tab; renderStory(); }
const stState = (s, k) => s.st[k] === 'busy' ? '<span class="stb busy">Üretiliyor…</span>' : s.st[k] === 'wait' ? '<span class="stb wait">Flow\'dan bekleniyor</span>'
  : s.st[k] === 'err' ? `<span class="stb err" title="${esc((s.err || {})[k] || '')}">Hata</span>` : '';
// model açılır listesi; kayıtlı model listede yoksa da (ör. liste henüz gelmediyse) seçili olarak görünür
function modelOpts(list, cur){
  const items = list.map(m => typeof m === 'string' ? {v: m, t: m} : m);
  if (cur && !items.some(x => x.v === cur)) items.unshift({v: cur, t: cur});
  return items.map(x => `<option value="${esc(x.v)}" ${x.v === cur ? 'selected' : ''}>${esc(x.t)}</option>`).join('');
}
let modelsTried = false;
async function refreshModelLists(loud){
  modelsTried = true;
  const [g, e] = await Promise.all([api.secretGet('gemini'), api.secretGet('elevenlabs')]);
  const jobs = [];
  if (g) jobs.push(fetchGeminiModels().catch(x => loud && toast('Gemini modelleri alınamadı: ' + x.message, 'err')));
  if (e) jobs.push(fetchElevenModels().catch(x => loud && toast('ElevenLabs modelleri alınamadı: ' + x.message, 'err')), (VOICES.length ? null : loadVoices().catch(() => {})));
  await Promise.all(jobs);
  if (loud) toast(`Modeller: ${GEM_MODELS.length} metin, ${GEM_IMAGE.length} görsel, ${GEM_VIDEO.length} video, ${EL_MODELS.length} ses`);
  if (storyTab === 'settings') renderStory();
}
// senaryo önizlemesi: partlar, sahneler, satırlar (etiketler soluk), ortam sesi ve tahmini süre
const estDur = s => Math.max(s.duration || 0, s.lines.reduce((a, l) => a + (l.dur || stripTags(l.text).length / 14 + 0.25), 0.5));
function scriptPreview(){
  if (!STORY.scenes.length) return '';
  const parts = [...new Set(STORY.scenes.map(s => s.part || 1))].sort((a, b) => a - b);
  const tot = STORY.scenes.reduce((a, s) => a + estDur(s), 0);
  const line = t => esc(t).replace(/\[[^\]]*\]/g, m => `<span class="sttag">${m}</span>`);
  let n = 0;
  return `<div class="stpreview" id="stPreview">
    <div class="stprevhead"><h3>Senaryo önizlemesi</h3><span class="note">${parts.length > 1 ? parts.length + ' part · ' : ''}${STORY.scenes.length} sahne · yaklaşık ${fmt(tot, 0)}</span>
      <span class="sp"></span><button class="sec sm" id="stRewrite">Yeniden yaz</button><button class="primary sm" id="stApprove">${STORY.reviewed ? 'Üretime geç' : 'Onayla ve üretime geç'}</button></div>
    ${STORY.title ? `<div class="sttitle">${esc(STORY.title)}</div>` : ''}
    ${STORY.style ? `<p class="note"><b>Görsel stil:</b> ${esc(STORY.style)}</p>` : ''}
    ${STORY.characters.length ? `<p class="note"><b>Karakterler:</b> ${STORY.characters.map(c => esc(c.name)).join(', ')}</p>` : ''}
    ${parts.map(p => { const ps = STORY.scenes.filter(s => (s.part || 1) === p);
      return `${parts.length > 1 ? `<div class="stpart">Part ${p} <span class="note">${ps.length} sahne · yaklaşık ${fmt(ps.reduce((a, s) => a + estDur(s), 0), 0)}</span></div>` : ''}
      ${ps.map(s => { n++; return `<div class="stprev"><div class="stprevs"><b>Sahne ${n}</b> <span class="note">~${Math.round(estDur(s))} sn</span> — ${esc(s.summary)}</div>
        ${s.lines.map(l => `<div class="stprevl"><span class="stspk">${esc(l.speaker)}:</span> ${line(l.text)}</div>`).join('')}
        ${s.ambience ? `<div class="stprevl note">🔊 ${esc(s.ambience)}</div>` : ''}</div>`; }).join('')}`; }).join('')}
  </div>`;
}
// rolün ses seçimi, ayarları, dinleme ve özel ses tasarımı
function roleHtml(k){
  const r = roleOf(k), vs = {...DEF_VS, ...(r.vs || {})}, designs = (k === 'nar' ? STORY.narDesigns : STORY.characters[k].designs) || [];
  return `<label>Ses<select data-rvoice="${k}">${voiceOpts(r.voice).replace('Varsayılan anlatıcı', k === 'nar' ? 'Ayarlardaki varsayılan' : 'Anlatıcının sesi')}</select><button class="ic" data-vplay="${k}" title="ElevenLabs örneğini dinle">${ICON.play}</button></label>
    <label>Hız<input type="range" min="0.7" max="1.2" step="0.05" value="${vs.speed}" data-rvs="${k}|speed"><span class="v">${vs.speed.toFixed(2)}x</span></label>
    <label>Tutarlılık<input type="range" min="0" max="100" step="1" value="${vs.stab}" data-rvs="${k}|stab"><span class="v">${vs.stab}</span></label>
    <label>Duygu<input type="range" min="0" max="100" step="1" value="${vs.style}" data-rvs="${k}|style"><span class="v">${vs.style}</span></label>
    <div class="row"><button class="sec sm" data-rtest="${k}" title="Bu ses ve ayarlarla rolün ilk satırını seslendirip çalar">Satırıyla dinle</button><button class="sec sm" data-rdesign="${k}" title="Tariften bu role özel yeni bir ses üretir (ElevenLabs Voice Design)">Özel ses tasarla</button></div>
    ${designs.length ? `<div class="stdesigns">${designs.map((d, i) => `<span><button class="ic" data-dplay="${esc(d.path)}" title="Aday ${d.n}">${ICON.play}</button>Aday ${d.n}<button class="sec sm" data-duse="${k}|${i}">Kullan</button></span>`).join('')}</div>` : ''}`;
}
function voiceOpts(cur){ return `<option value="">Varsayılan anlatıcı</option>${VOICES.map(v => { const l = v.labels || {}, info = [l.gender, l.age, l.accent].filter(Boolean).join(', ');
  return `<option value="${v.voice_id}" ${v.voice_id === cur ? 'selected' : ''}>${esc(v.name)}${info ? ' · ' + esc(info) : ''}</option>`; }).join('')}`; }
function renderStory(){
  if (!STORY || $('storyModal').hidden) return;
  document.querySelectorAll('#storyTabs [data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === storyTab));
  const box = $('storyBody');
  if (storyTab === 'settings'){
    if (!modelsTried) refreshModelLists(false);   // ilk açılışta listeleri kendiliğinden getir
    box.innerHTML = `
      <div class="stcols"><div>
      <h3>API anahtarları</h3>
      <label>Gemini API<span class="inrow"><input type="password" id="kGem" placeholder="Kayıtlı değil"><button class="sec sm" id="kGemSave">Kaydet</button></span></label>
      <p class="note">aistudio.google.com → Get API key. Senaryo, görsel ve video için. Anahtarlar bilgisayarında şifreli saklanır.</p>
      <label>ElevenLabs API<span class="inrow"><input type="password" id="kEl" placeholder="Kayıtlı değil"><button class="sec sm" id="kElSave">Kaydet</button></span></label>
      <h3>Görsel sağlayıcı</h3>
      <label>Sağlayıcı<select id="sImgProv"><option value="cloudflare" ${freeImg() ? 'selected' : ''}>Cloudflare Workers AI (ücretsiz)</option><option value="gemini" ${freeImg() ? '' : 'selected'}>Gemini Nano Banana (ücretli)</option></select></label>
      ${freeImg() ? `<label>Hesap kimliği (Account ID)<span class="inrow"><input type="password" id="kCfAcc" placeholder="Kayıtlı değil"><button class="sec sm" id="kCfAccSave">Kaydet</button></span></label>
      <label>API anahtarı (token)<span class="inrow"><input type="password" id="kCfTok" placeholder="Kayıtlı değil"><button class="sec sm" id="kCfTokSave">Kaydet</button></span></label>
      <label>Model<select id="mCf">${modelOpts(CF_MODELS.map(m => ({v: m.id, t: m.name})), STSET.cfModel || CF_MODELS[0].id)}</select></label>
      <p class="note">Ücretsiz Cloudflare hesabı yeter: dash.cloudflare.com → AI → Workers AI → "Use REST API": Account ID'yi kopyala, "Create a Workers AI API Token" ile anahtar oluştur. Günde 10.000 neuron ücretsiz; kota bitince ücret alınmaz, ertesi gün (03:00) yenilenir. Bu modeller referans görsel almaz; karakter tutarlılığı tariflerle sağlanır.</p>` : ''}
      <p class="note">Video için ücretsiz API yok: videosu olmayan sahne "Reelix'te kur"da görselinden hareketli (yakınlaşan/kayan) klibe dönüştürülür. Video istersen "Flow için kopyala" (aboneliğinle) kullan.</p>
      <h3>Maliyet</h3>
      <label>Ücretli görsel/video API'sini kullan<input type="checkbox" id="sPaid" ${paidOn() ? 'checked' : ''}></label>
      <p class="note">${paidOn() ? 'Açık: Nano Banana ve Omni API düğmeleri çalışır; Google her görsel ve video için ücret alır (ücretsiz katmanda kotası yoktur).'
        : 'Kapalı (önerilen): görsel ve video yalnızca "Flow için kopyala" ile, Flow aboneliğinle üretilir; API hiç çağrılmaz, ücret çıkmaz. Senaryo ücretsiz katmanla çalışmaya devam eder.'}</p>
      <label>En ucuz mod<input type="checkbox" id="sCheap" ${STSET.cheap ? 'checked' : ''}></label>
      <p class="note">${STSET.cheap ? `Açık: senaryo ücretsiz lite modelle, ses ${M.tts()} (en az kredi; [laughs] gibi etiketler okunmaz), ortam sesi ${M.sfx()}, görsel ${M.image()} 1K, video ${M.resolution()}. Aşağıdaki model seçimlerin saklanır; kapatınca geri gelir.`
        : 'Açınca her adımda en düşük maliyetli model ve ayar kullanılır (lite metin modeli, Flash ses, Nano Banana 2 Lite 1K görsel, 360p video). Seçimlerin silinmez.'}</p>
      <h3>Ses</h3>
      <div class="row"><button class="sec sm" id="vLoad">ElevenLabs seslerini yükle</button></div>
      <label>Varsayılan anlatıcı<select id="vNar">${voiceOpts(STSET.narrator).replace('Varsayılan anlatıcı', 'Seç')}</select></label>
      <label>Ses modeli<select id="mTts">${modelOpts((EL_MODELS.length ? EL_MODELS : ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'].map(id => ({id, name: id, tr: true})))
        .map(m => ({v: m.id, t: `${m.name}${m.tr ? '' : ' (Türkçe yok)'}${tagsOk(m.id) ? ' · etiket destekli' : ''}`})), STSET.ttsModel)}</select></label>
      <p class="note">[laughs], [whispers] gibi ses etiketlerini yalnızca v3/v4 modelleri okur; diğerlerinde etiketler sese gönderilmeden temizlenir. Altyazıda hiçbir zaman görünmez.</p>
      </div><div>
      <h3>Görüntü</h3>
      <label>Oran<select id="sRatio">${['9:16', '16:9'].map(r => `<option ${r === STSET.ratio ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Video çözünürlüğü<select id="sRes">${['720p', '1080p', '360p'].map(r => `<option ${r === STSET.resolution ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Kurulumda video sesi (%)<input type="number" id="sVol" min="0" max="100" value="${STSET.videoVol}"></label>
      <label>Kurulumda ortam sesi (%)<input type="number" id="sAmb" min="0" max="100" value="${STSET.ambVol}"></label>
      <label>Ortam sesi modeli<select id="mSfx">${modelOpts(['eleven_text_to_sound_v2', 'eleven_text_to_sound_v3'], STSET.sfxModel)}</select></label>
      <h3>Modeller</h3>
      <label>Senaryo<select id="mText">${modelOpts(GEM_MODELS, STSET.textModel)}</select></label>
      <label>Senaryo (yedek)<select id="mTextFb">${modelOpts(GEM_MODELS, STSET.textFallback)}</select></label>
      <label>Görsel<select id="mImg">${modelOpts(GEM_IMAGE, STSET.imageModel)}</select></label>
      <label>Video<select id="mVid">${modelOpts(GEM_VIDEO, STSET.videoModel)}</select></label>
      <div class="row"><button class="sec sm" id="mList">Model listelerini yenile</button></div>
      <p class="note">Listeler anahtarının gerçekten erişebildiği modellerden gelir. Asıl senaryo modeli yoğunsa veya yanıt vermezse otomatik olarak yedek ve diğer modeller denenir.</p>
      </div></div>`;
    Promise.all([api.secretGet('gemini'), api.secretGet('elevenlabs')]).then(([g, e]) => { $('kGem').placeholder = g ? 'Kayıtlı ✓ (değiştirmek için yaz)' : 'Kayıtlı değil'; $('kEl').placeholder = e ? 'Kayıtlı ✓ (değiştirmek için yaz)' : 'Kayıtlı değil'; });
    const saveKey = (id, name) => async () => { await api.secretSet(name, $(id).value.trim()); $(id).value = ''; toast('Anahtar kaydedildi'); refreshModelLists(false); };
    $('kGemSave').onclick = saveKey('kGem', 'gemini'); $('kElSave').onclick = saveKey('kEl', 'elevenlabs');
    $('vLoad').onclick = async () => { try { await loadVoices(); toast(`${VOICES.length} ses yüklendi`); renderStory(); } catch (e){ toast('Sesler alınamadı: ' + e.message, 'err'); } };
    const bind = (id, k, num) => $(id).onchange = e => { STSET[k] = num ? +e.target.value : e.target.value.trim(); saveSet(); };
    $('sImgProv').onchange = e => { STSET.imgProvider = e.target.value; saveSet(); renderStory(); };
    if (freeImg()){
      $('kCfAccSave').onclick = saveKey('kCfAcc', 'cf-account'); $('kCfTokSave').onclick = saveKey('kCfTok', 'cf-token');
      Promise.all([api.secretGet('cf-account'), api.secretGet('cf-token')]).then(([a, t]) => { $('kCfAcc').placeholder = a ? 'Kayıtlı ✓' : 'Kayıtlı değil'; $('kCfTok').placeholder = t ? 'Kayıtlı ✓' : 'Kayıtlı değil'; });
      $('mCf').onchange = e => { STSET.cfModel = e.target.value; saveSet(); };
    }
    $('sPaid').onchange = e => {
      if (e.target.checked && !confirm('Gemini API ile görsel ve video üretimi ücretlidir; Google her üretim için hesabından ücret alır. Açılsın mı?')){ e.target.checked = false; return; }
      STSET.paidApi = e.target.checked; saveSet(); renderStory();
    };
    $('sCheap').onchange = e => { STSET.cheap = e.target.checked; saveSet(); renderStory(); toast(STSET.cheap ? 'En ucuz mod açık' : 'En ucuz mod kapalı'); };
    if (STSET.cheap) ['mTts', 'mSfx', 'mImg', 'sRes'].forEach(id => { $(id).disabled = true; $(id).title = 'En ucuz mod açıkken kullanılmaz'; });
    bind('vNar', 'narrator'); bind('mTts', 'ttsModel'); bind('sRatio', 'ratio'); bind('sRes', 'resolution'); bind('sVol', 'videoVol', true); bind('sAmb', 'ambVol', true); bind('mSfx', 'sfxModel');
    $('mList').onclick = () => refreshModelLists(true);
    bind('mText', 'textModel'); bind('mTextFb', 'textFallback'); bind('mImg', 'imageModel'); bind('mVid', 'videoModel');
    return;
  }
  if (storyTab === 'story'){
    const L = lenOf(), per = sceneCount(), words = (STORY.story || '').split(/\s+/).filter(Boolean).length;
    box.innerHTML = `
      <div class="stcols stcols-story"><div>
      <h3>Fikir</h3>
      <textarea id="stInput" rows="6" placeholder="Hikâyenin fikrini, kısa özetini veya taslağını yaz… (ör. Alp iki ekmek alıp eve gidiyor)">${esc(STORY.input)}</textarea>
      <h3>Uzunluk</h3>
      <div class="stlens">${LENGTHS.map(l => `<button class="stlen ${l.id === L.id ? 'on' : ''}" data-len="${l.id}"><b>${l.name}</b><span>~${l.sec < 60 ? l.sec + ' sn' : (l.sec / 60).toLocaleString('tr') + ' dk'}</span><small>${l.scenes} sahne</small></button>`).join('')}</div>
      <label>Kaç part?<select id="stParts">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === (+STORY.parts || 1) ? 'selected' : ''}>${n === 1 ? 'Tek part' : n + ' part'}</option>`).join('')}</select></label>
      <label>${(+STORY.parts || 1) > 1 ? 'Her partta kaç sahne?' : 'Kaç sahne?'}<select id="stCount">${['auto', 3, 4, 5, 6, 8, 10, 12, 15, 18, 24].map(n => `<option value="${n}" ${String(n) === String(STORY.count || 'auto') ? 'selected' : ''}>${n === 'auto' ? `Uzunluğa göre (${L.scenes})` : n}</option>`).join('')}</select></label>
      <p class="note">${(+STORY.parts || 1) > 1 ? `${STORY.parts} part × ${per} sahne · part başına` : `${per} sahne ·`} yaklaşık ${L.sec < 60 ? L.sec + ' sn' : (L.sec / 60).toLocaleString('tr') + ' dk'}, sahne başına ~${Math.round(L.sec / per)} sn.</p>
      <button class="primary" id="stStoryWrite">${STORY.story ? 'Hikâyeyi yeniden yaz' : 'Hikâyeyi yaz'}</button>
      </div><div>
      <h3>Hikâye ${STORY.title ? `· ${esc(STORY.title)}` : ''}</h3>
      <textarea id="stStory" class="ststory" placeholder="Hikâye burada çıkar; istediğin gibi düzenle. Kendi hikâyeni de doğrudan buraya yapıştırabilirsin.">${esc(STORY.story || '')}</textarea>
      <div class="row stfoot"><span class="note">${words ? `${words} kelime · sesli okununca ~${Math.round(words / 2.4)} sn` : ''}</span><span class="sp"></span>
        <button class="primary" id="stToScenes" ${storySource() ? '' : 'disabled'}>${STORY.scenes.length ? 'Sahneleri yeniden oluştur →' : 'Sahnelere böl →'}</button></div>
      </div></div>`;
    $('stInput').oninput = e => { STORY.input = e.target.value; dirty = true; };
    $('stStory').oninput = e => { STORY.story = e.target.value; dirty = true; $('stToScenes').disabled = !storySource(); };
    $('stCount').onchange = e => { STORY.count = e.target.value; dirty = true; renderStory(); };
    $('stParts').onchange = e => { STORY.parts = +e.target.value; dirty = true; renderStory(); };
    box.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { STORY.length = b.dataset.len; dirty = true; renderStory(); });
    $('stStoryWrite').onclick = () => { if (STORY.story && !confirm('Mevcut hikâye (düzenlemelerin dahil) yenisiyle değiştirilecek. Devam edilsin mi?')) return; writeStory(); };
    $('stToScenes').onclick = () => { if (STORY.scenes.length && !confirm('Mevcut sahneler yenileriyle değiştirilecek. Devam edilsin mi?')) return; writeScript(); };
    return;
  }
  if (storyTab === 'script'){
    box.innerHTML = `
      <div class="stcols"><div>
      ${STORY.scenes.length ? '' : `<p class="note">Henüz sahne yok. Hikâye sekmesinde hikâyeyi yazıp "Sahnelere böl"e bas.</p>`}
      <button class="sec" id="stBack">← Hikâyeye dön</button>
      <h3>Görsel stil</h3>
      <label>Senaryoya göre otomatik belirle<input type="checkbox" id="stStyleAuto" ${STORY.styleAuto !== false ? 'checked' : ''}></label>
      <textarea id="stStyle" rows="5" placeholder="${STORY.styleAuto !== false ? 'Senaryo yazılınca hikâyeye uygun stil burada çıkar' : 'Görsel stili tarif et (İngilizce önerilir)'}">${esc(STORY.style)}</textarea>
      <p class="note">${STORY.styleAuto !== false ? 'Açıkken stil her senaryoda hikâyenin havasına göre yeniden belirlenir. Kutuya yazarsan otomatik kapanır ve senin stilin kullanılır.' : 'Senin stilin tüm görsel, karakter ve video promptlarına eklenir.'}</p>
      </div><div>
      <h3>Ek referanslar</h3>
      <p class="note">Karakter görsellerine ek olarak eklemek istediğin referanslar (mekân, nesne). API ile sahne görseli üretirken karakter görselleriyle birlikte kullanılır; Flow'da referansları kendin eklersin.</p>
      <div class="strefs">${STORY.refs.map((p, i) => `<div class="stref"><img src="${fileUrl(p)}"><button class="ic" data-rdel="${i}" title="Kaldır">${ICON.close}</button></div>`).join('')}
        ${STORY.refs.length < 4 ? '<button class="sec sm" id="stRefAdd">Görsel ekle</button>' : ''}</div>
      <h3>Sesler</h3>
      <div class="stchar"><b>Anlatıcı</b>${STORY.narratorDesc ? `<p class="note">${esc(STORY.narratorDesc)}</p>` : ''}${roleHtml('nar')}</div>
      ${STORY.characters.map((c, i) => `<div class="stchar"><b>${esc(c.name)}</b>${c.voiceDesc ? `<p class="note">${esc(c.voiceDesc)}</p>` : ''}
        <div class="stcharimg">${c.ref ? `<img src="${fileUrl(c.ref)}">` : '<div class="stthumb empty">Görsel yok</div>'}
          <div><div class="stlabel">Karakter görseli ${c.st === 'busy' ? '<span class="stb busy">Üretiliyor…</span>' : c.st === 'wait' ? '<span class="stb wait">Flow\'dan bekleniyor</span>' : c.st === 'err' ? `<span class="stb err" title="${esc(c.err || '')}">Hata</span>` : ''}</div>
            <div class="row">${freeImg() ? `<button class="sec sm" data-capi="${i}">Ücretsiz oluştur</button>` : `<button class="sec sm" data-capi="${i}" ${paidOn() ? '' : 'disabled title="Ücretli API kapalı (Ayarlar → Maliyet)"'}>Nano Banana API (ücretli)</button>`}<button class="sec sm" data-cflow="${i}">Flow için kopyala</button></div>
            <div class="row"><button class="sec sm" data-cfile="${i}">Dosya</button>${c.ref ? `<button class="sec sm" data-cdel="${i}">Kaldır</button><button class="ic" data-cexp="${i}" title="Dışa aktar">⤓</button>` : ''}</div></div></div>
        <textarea data-clook="${i}" rows="2">${esc(c.look)}</textarea>
        ${roleHtml(i)}</div>`).join('')}
      ${STORY.characters.length && (freeImg() || paidOn()) ? `<button class="sec sm" id="stCharsAll" title="Görseli olmayan karakterleri oluşturur">Tüm karakter görsellerini oluştur${freeImg() ? ' (ücretsiz)' : ' (ücretli)'}</button> ` : ''}${STORY.scenes.length ? '<button class="sec sm" id="stSuggest" title="Senaryodaki ses tariflerine göre ElevenLabs seslerinden uygun olanları seçer">Sesleri senaryoya göre öner</button>' : '<p class="note">Senaryo yazılınca karakterler burada çıkar ve her birine uygun ses otomatik önerilir.</p>'}
      </div></div>
      ${scriptPreview()}`;
    $('stBack').onclick = () => storyShow('story');
    $('stStyle').oninput = e => { STORY.style = e.target.value; dirty = true; if (STORY.styleAuto !== false){ STORY.styleAuto = false; $('stStyleAuto').checked = false; } };
    $('stStyleAuto').onchange = e => { STORY.styleAuto = e.target.checked; dirty = true; renderStory(); };
    if ($('stRewrite')) $('stRewrite').onclick = () => { if (confirm('Sahneler hikâyeden yeniden oluşturulacak. Devam edilsin mi?')) writeScript(); };
    if ($('stApprove')) $('stApprove').onclick = () => { STORY.reviewed = true; dirty = true; storyShow('make'); };
    if ($('stRefAdd')) $('stRefAdd').onclick = async () => { const [src] = await api.openFiles('image', false); if (!src) return; const p = await api.importMedia(src); if (p){ STORY.refs.push(p); dirty = true; renderStory(); } };
    box.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => { STORY.refs.splice(+b.dataset.rdel, 1); dirty = true; renderStory(); });
    box.querySelectorAll('[data-clook]').forEach(t => t.oninput = () => { STORY.characters[+t.dataset.clook].look = t.value; dirty = true; });
    const rk = v => v === 'nar' ? 'nar' : +v;
    box.querySelectorAll('[data-rvoice]').forEach(sl => sl.onchange = () => setRole(rk(sl.dataset.rvoice), {voice: sl.value}));
    box.querySelectorAll('[data-rvs]').forEach(el => el.oninput = () => {
      const [k, f] = el.dataset.rvs.split('|'), cur = {...DEF_VS, ...(roleOf(rk(k)).vs || {})};
      cur[f] = +el.value; setRole(rk(k), {vs: cur});
      const o = el.parentElement.querySelector('.v'); if (o) o.textContent = f === 'speed' ? (+el.value).toFixed(2) + 'x' : el.value;
    });
    box.querySelectorAll('[data-rtest]').forEach(b => b.onclick = () => testRole(rk(b.dataset.rtest)));
    box.querySelectorAll('[data-rdesign]').forEach(b => b.onclick = () => designVoice(rk(b.dataset.rdesign)));
    box.querySelectorAll('[data-dplay]').forEach(b => b.onclick = () => { stAudio.src = fileUrl(b.dataset.dplay); stAudio.play(); });
    box.querySelectorAll('[data-duse]').forEach(b => b.onclick = () => { const [k, i] = b.dataset.duse.split('|'); useDesign(rk(k), +i); });
    box.querySelectorAll('[data-capi]').forEach(b => b.onclick = () => runChar(STORY.characters[+b.dataset.capi]));
    box.querySelectorAll('[data-cflow]').forEach(b => b.onclick = () => flowCopyChar(STORY.characters[+b.dataset.cflow]));
    box.querySelectorAll('[data-cfile]').forEach(b => b.onclick = async () => { const [src] = await api.openFiles('image', false); if (!src) return; const p = await api.importMedia(src); if (p){ STORY.characters[+b.dataset.cfile].ref = p; dirty = true; renderStory(); } });
    box.querySelectorAll('[data-cexp]').forEach(b => b.onclick = () => exportOne('char', null, STORY.characters[+b.dataset.cexp]));
    box.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => { delete STORY.characters[+b.dataset.cdel].ref; dirty = true; renderStory(); });
    if ($('stCharsAll')) $('stCharsAll').onclick = async () => { if (!freeImg() && !needPaid()) return; for (const c of STORY.characters) if (!c.ref) await runChar(c); };
    if ($('stSuggest')) $('stSuggest').onclick = () => suggestVoices(true).catch(e => toast('Sesler önerilemedi: ' + e.message, 'err'));
    // sesin örneğini dinle (ElevenLabs önizleme kaydı)
    box.querySelectorAll('[data-vplay]').forEach(b => b.onclick = () => {
      const id = roleOf(rk(b.dataset.vplay)).voice || STORY.narrator || STSET.narrator;
      const v = VOICES.find(x => x.voice_id === id);
      if (!v || !v.preview){ toast('Bu ses için örnek yok; önce Ayarlar\'dan sesleri yükle'); return; }
      stAudio.src = v.preview; stAudio.play().catch(() => toast('Örnek çalınamadı', 'err'));
    });
    return;
  }
  // üretim
  const speakers = ['Anlatıcı', ...STORY.characters.map(c => c.name).filter(n => n !== 'Anlatıcı')];
  box.innerHTML = !STORY.scenes.length ? '<p class="emptyi">Önce Senaryo sekmesinden senaryo yaz.</p>' : `
    <div class="sttools">
      <button class="sec sm" data-all="audio" ${storyRunning ? 'disabled' : ''}>Tüm sesleri üret</button>
      <button class="sec sm" data-all="amb" ${storyRunning ? 'disabled' : ''}>Tüm ortam seslerini üret</button>
      ${freeImg() ? `<button class="sec sm" data-all="image" ${storyRunning ? 'disabled' : ''}>Tüm görselleri üret (ücretsiz)</button>` : paidOn() ? `<button class="sec sm" data-all="image" ${storyRunning ? 'disabled' : ''}>Tüm görselleri üret (API, ücretli)</button>` : ''}
      ${paidOn() ? `<button class="sec sm" data-all="video" ${storyRunning ? 'disabled' : ''}>Tüm videoları üret (API, ücretli)</button>` : ''}
      ${storyRunning ? '<button class="sec sm" id="stStop">Durdur</button>' : ''}
      <button class="sec sm" id="stFlow" title="Flow'u tarayıcıda aç">Flow'u aç ↗</button>
      <span class="sp"></span>
      ${[...new Set(STORY.scenes.map(s => s.part || 1))].length > 1 ? `<select id="stBuildPart" title="Hangi part kurulsun">${['all', ...new Set(STORY.scenes.map(s => s.part || 1))].map(p => `<option value="${p}" ${String(p) === String(STORY.buildPart || 'all') ? 'selected' : ''}>${p === 'all' ? 'Tüm partlar' : 'Part ' + p}</option>`).join('')}</select>` : ''}
      <button class="sec sm" id="stExportAll" title="Görsel, Ses ve Video klasörlerine <Proje başlığı>_sahne-N adlarıyla aktarır">Tümünü dışa aktar</button>
      <button class="primary sm" id="stBuild">Reelix'te kur</button>
    </div>
    ${STORY.scenes.map((s, i) => `
    ${[...new Set(STORY.scenes.map(x => x.part || 1))].length > 1 && (i === 0 || (STORY.scenes[i - 1].part || 1) !== (s.part || 1)) ? `<div class="stpart">Part ${s.part || 1}</div>` : ''}
    <div class="stscene" data-sid="${s.id}">
      <div class="sthead"><b>${i + 1}</b><input type="text" data-f="summary" value="${esc(s.summary)}">
        <button class="ic" data-act="up" title="Yukarı">▲</button><button class="ic" data-act="down" title="Aşağı">▼</button><button class="ic" data-act="del" title="Sahneyi sil">${ICON.close}</button></div>
      <div class="stgrid">
        <div class="stcol">
          <div class="stlabel">Seslendirme ${stState(s, 'audio')}</div>
          ${s.lines.map((l, li) => `<div class="stline"><select data-lsp="${li}">${[...new Set([...speakers, l.speaker])].map(n => `<option ${n === l.speaker ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
            <textarea data-ltx="${li}" rows="2">${esc(l.text)}</textarea>
            <button class="ic" data-lplay="${li}" title="Dinle" ${l.audio ? '' : 'disabled'}>${ICON.play}</button><button class="ic" data-ldel="${li}" title="Satırı sil">${ICON.close}</button></div>`).join('')}
          <div class="row"><button class="sec sm" data-act="line">Satır ekle</button><button class="sec sm" data-act="audio">${s.lines.some(l => l.audio) ? 'Sesi yeniden üret' : 'Sesi üret'}</button><button class="ic" data-act="audexp" title="Dışa aktar" ${s.lines.some(l => l.audio) ? '' : 'disabled'}>⤓</button></div>
          <div class="stlabel">Ortam sesi ${stState(s, 'amb')}</div>
          <textarea data-f="ambience" rows="2" placeholder="ör. quiet night street, distant traffic, light wind">${esc(s.ambience || '')}</textarea>
          <div class="row"><button class="sec sm" data-act="amb">${s.amb ? 'Yeniden üret' : 'Ortam sesini üret'}</button><button class="ic" data-act="ambplay" title="Dinle" ${s.amb ? '' : 'disabled'}>${ICON.play}</button></div>
        </div>
        <div class="stcol">
          <div class="stlabel">Görsel ${stState(s, 'image')}</div>
          ${s.image ? `<img class="stthumb" src="${fileUrl(s.image)}">` : '<div class="stthumb empty">Görsel yok</div>'}
          <textarea data-f="image_prompt" rows="4">${esc(s.image_prompt)}</textarea>
          <div class="row">${freeImg() ? '<button class="sec sm" data-act="imgapi" title="Cloudflare Workers AI, günlük ücretsiz kota">Ücretsiz üret</button>' : `<button class="sec sm" data-act="imgapi" ${paidOn() ? '' : 'disabled title="Ücretli API kapalı (Ayarlar → Maliyet)"'}>API (ücretli)</button>`}<button class="sec sm" data-act="imgflow">Flow için kopyala</button><button class="sec sm" data-act="imgfile">Dosya</button><button class="ic" data-act="imgexp" title="Dışa aktar" ${s.image ? '' : 'disabled'}>⤓</button></div>
        </div>
        <div class="stcol">
          <div class="stlabel">Video ${stState(s, 'video')}</div>
          ${s.video ? `<video class="stthumb" src="${fileUrl(s.video)}" muted loop onmouseenter="this.play()" onmouseleave="this.pause()"></video>` : '<div class="stthumb empty">Video yok</div>'}
          <textarea data-f="video_prompt" rows="3">${esc(s.video_prompt)}</textarea>
          <label>Süre<select data-f="duration">${[4, 6, 8, 10].map(d => `<option ${d === s.duration ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <div class="row"><button class="sec sm" data-act="vidapi" ${paidOn() ? '' : 'disabled title="Ücretli API kapalı (Ayarlar → Maliyet)"'}>API (ücretli)</button><button class="sec sm" data-act="vidflow">Flow için kopyala</button><button class="sec sm" data-act="vidfile">Dosya</button><button class="ic" data-act="videxp" title="Dışa aktar" ${s.video ? '' : 'disabled'}>⤓</button></div>
        </div>
      </div>
    </div>`).join('')}
    <button class="sec sm" id="stAddScene" style="margin-top:8px">Sahne ekle</button>`;
  if (!STORY.scenes.length) return;
  box.querySelectorAll('[data-all]').forEach(b => b.onclick = () => runAll(b.dataset.all));
  if ($('stStop')) $('stStop').onclick = () => { storyRunning = false; toast('Sıradaki iş bitince durur'); };
  $('stFlow').onclick = () => api.openExternal(FLOW_URL);
  $('stBuild').onclick = buildInReelix;
  $('stExportAll').onclick = exportAll;
  if ($('stBuildPart')) $('stBuildPart').onchange = e => { STORY.buildPart = e.target.value; dirty = true; };
  $('stAddScene').onclick = () => { STORY.scenes.push({id: uid(), summary: 'Yeni sahne', image_prompt: '', video_prompt: '', duration: 8, lines: [{speaker: 'Anlatıcı', text: ''}], st: {}}); dirty = true; renderStory(); };
}
// üretim sekmesi olayları (tek dinleyici)
$('storyBody').addEventListener('input', e => {
  const card = e.target.closest('[data-sid]'); if (!card) return;
  const s = STORY.scenes.find(x => x.id === card.dataset.sid); if (!s) return;
  const f = e.target.dataset.f, li = e.target.dataset.ltx;
  if (f) s[f] = f === 'duration' ? +e.target.value : e.target.value;
  if (li != null) s.lines[+li].text = e.target.value;
  if (e.target.dataset.lsp != null) s.lines[+e.target.dataset.lsp].speaker = e.target.value;
  dirty = true;
});
let stAudio = new Audio();
$('storyBody').addEventListener('click', e => {
  const card = e.target.closest('[data-sid]'); if (!card || storyTab !== 'make') return;
  const i = STORY.scenes.findIndex(x => x.id === card.dataset.sid), s = STORY.scenes[i]; if (!s) return;
  const lp = e.target.closest('[data-lplay]'); if (lp){ const l = s.lines[+lp.dataset.lplay]; if (l.audio){ stAudio.src = fileUrl(l.audio); stAudio.play(); } return; }
  const ld = e.target.closest('[data-ldel]'); if (ld){ s.lines.splice(+ld.dataset.ldel, 1); dirty = true; renderStory(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  switch (b.dataset.act){
    case 'up': if (i > 0){ STORY.scenes.splice(i - 1, 0, ...STORY.scenes.splice(i, 1)); dirty = true; renderStory(); } break;
    case 'down': if (i < STORY.scenes.length - 1){ STORY.scenes.splice(i + 1, 0, ...STORY.scenes.splice(i, 1)); dirty = true; renderStory(); } break;
    case 'del': if (confirm('Sahne silinsin mi?')){ STORY.scenes.splice(i, 1); dirty = true; renderStory(); } break;
    case 'line': s.lines.push({speaker: 'Anlatıcı', text: ''}); dirty = true; renderStory(); break;
    case 'audio': runJob(s, 'audio', async x => { x.lines.forEach(l => delete l.audio); await makeSceneAudio(x); }); break;
    case 'amb': runJob(s, 'amb', async x => { delete x.amb; await makeAmbience(x); }); break;
    case 'ambplay': if (s.amb){ stAudio.src = fileUrl(s.amb); stAudio.play(); } break;
    case 'imgapi': if (freeImg() || needPaid()) runJob(s, 'image', makeImageApi); break;
    case 'vidapi': if (needPaid() && confirm(`Bu sahnenin videosu (${s.duration} sn) Gemini API ile üretilecek; Google kullanım ücreti alır. Devam edilsin mi?`)) runJob(s, 'video', makeVideoApi); break;
    case 'imgflow': flowCopy(s, 'image'); break;
    case 'vidflow': flowCopy(s, 'video'); break;
    case 'imgfile': pickFile(s, 'image'); break;
    case 'vidfile': pickFile(s, 'video'); break;
    case 'imgexp': exportOne('image', s); break;
    case 'videxp': exportOne('video', s); break;
    case 'audexp': exportOne('audio', s); break;
  }
});
$('storyTabs').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (b) storyShow(b.dataset.st); });
$('openStory').onclick = () => {
  if (!STORY) STORY = newStory();
  STORY.scenes.forEach(s => { s.st = s.st || {}; for (const k in s.st) if (s.st[k] === 'busy') s.st[k] = ''; });
  $('storyModal').hidden = false;
  api.secretGet('gemini').then(k => storyShow(!k ? 'settings' : STORY.scenes.length ? 'make' : STORY.story ? 'story' : 'story'));
};
$('storyClose').onclick = () => { $('storyModal').hidden = true; };
