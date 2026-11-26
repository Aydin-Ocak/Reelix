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
const newStory = () => ({input: '', story: '', length: 'medium', count: 'auto', opt: {...TALE_DEF}, polish: true, hist: [], style: '', styleAuto: true, refs: [], title: '', characters: [], scenes: []});
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
/* ---------- Hikâye tarzı: anlatım ağırlığı, tür, ton, tempo, açılış, son, dil, karakter sayısı ---------- */
const TALE_DEF = {voice: 'balanced', genre: 'auto', tone: 'auto', pace: 'balanced', opening: 'hook', ending: 'auto', lang: 'daily', cast: 'auto', notes: ''};
// her seçenek: [değer, görünen ad, yazara verilen yönerge]
const TALE_OPTS = {
  voice: ['Anlatım', [
    ['narrator', 'Anlatıcı ağırlıklı', `ANLATIM — anlatıcı ağırlıklı: satırların yaklaşık %75'i "Anlatıcı"ya ait olsun; karakter diyalogları az, kısa ve yalnızca en etkili anlarda. Sesli kitap anlatıcısı gibi zengin, betimleyici ve duygulu anlat.`],
    ['balanced', 'Dengeli', `ANLATIM — dengeli: anlatıcı ve karakterler dönüşümlü konuşsun (yaklaşık yarı yarıya). Anlatıcı bağlamı ve duyguyu, karakterler çatışmayı ve kişiliği taşısın.`],
    ['dialogue', 'Karakter ağırlıklı', `ANLATIM — karakter ağırlıklı: satırların yaklaşık %70'i karakter diyalogu olsun; hikâyeyi ve çatışmayı karakterlerin konuşması ilerletsin. "Anlatıcı" yalnızca kısa (en çok 1 cümle) köprü, mekân veya zaman geçişi için konuşsun. Her karakterin kendine özgü bir konuşma biçimi olsun.`],
    ['first', 'Birinci şahıs', `ANLATIM — birinci şahıs: başkarakter hikâyeyi kendi ağzından, "ben" diliyle anlatır; bu anlatım satırlarının speaker alanına başkarakterin ADINI yaz ve "Anlatıcı" kullanma (narrator_voice başkarakterin sesi olsun). Diğer karakterler kısa diyalogla girebilir.`],
  ]],
  genre: ['Tür', [
    ['auto', 'Hikâyeye göre', ''],
    ['thriller', 'Gerilim / korku', `TÜR — gerilim/korku: gerilimi yavaş yavaş artır, belirsizlik ve ima kullan; ucuz şok yerine atmosfer kur.`],
    ['mystery', 'Gizem', `TÜR — gizem: ipuçları serpiştir, merak edilen soruların cevabını geciktir, son ipucu her şeyi yerine oturtsun.`],
    ['drama', 'Dram', `TÜR — dram: karakterin iç çatışmasına ve duygusal dönüşümüne odaklan.`],
    ['comedy', 'Komedi', `TÜR — komedi: durum ve diyalog komikliği, iyi zamanlanmış espriler; aşırıya kaçma, son güçlü bir gülüş bıraksın.`],
    ['adventure', 'Macera', `TÜR — macera: yolculuk, engeller ve keşif; sahneler enerjik ve görsel olsun.`],
    ['romance', 'Romantik', `TÜR — romantik: iki karakter arasındaki gerilim, küçük jestler ve söylenmeyenler.`],
    ['tale', 'Masal / çocuk', `TÜR — masal: sade ve sıcak bir dil, tekrar eden motifler, küçük bir değer; korkutucu öğe yok.`],
    ['scifi', 'Bilim kurgu', `TÜR — bilim kurgu: tek güçlü bir fikir ve onun insani sonucu; teknik jargonu sade tut.`],
    ['life', 'Gündelik hayat', `TÜR — gündelik hayat: sıradan bir anın içindeki küçük ama gerçek duygu; abartısız ve samimi.`],
    ['motivation', 'Motive edici', `TÜR — motive edici: zorlanan bir karakter ve umut veren bir dönüm noktası; vaaz verme, yaşatarak göster.`],
  ]],
  tone: ['Ton', [
    ['auto', 'Hikâyeye göre', ''],
    ['serious', 'Ciddi', `TON — ciddi ve ağırbaşlı.`],
    ['warm', 'Samimi, sıcak', `TON — samimi ve sıcak.`],
    ['witty', 'Esprili', `TON — esprili, hafif alaycı ve eğlenceli.`],
    ['sad', 'Hüzünlü', `TON — hüzünlü ve buruk.`],
    ['excited', 'Heyecanlı', `TON — heyecanlı ve enerjik.`],
    ['mysterious', 'Gizemli', `TON — gizemli ve gergin.`],
    ['poetic', 'Şiirsel', `TON — şiirsel, imgelerle dolu.`],
  ]],
  pace: ['Tempo', [
    ['slow', 'Yavaş, atmosferik', `TEMPO — yavaş ve atmosferik: betimlemeye, sessiz anlara ve duygu birikimine yer ver.`],
    ['balanced', 'Dengeli', ''],
    ['fast', 'Hızlı, vurucu', `TEMPO — hızlı ve vurucu: kısa cümleler, çabuk kesmeler, her sahnede yeni bir gelişme.`],
  ]],
  opening: ['Açılış', [
    ['hook', 'Kanca', `AÇILIŞ — ilk cümle merak uyandıran bir soru veya çarpıcı bir detay olsun.`],
    ['inmedia', 'Olayın ortasından', `AÇILIŞ — olayın tam ortasından başla; gereken bilgiyi sonra, kısa geri dönüşlerle ver.`],
    ['calm', 'Sakin giriş', `AÇILIŞ — mekân ve ruh haliyle sakin, atmosferik başla; ilk gerilimi ikinci sahneye sakla.`],
  ]],
  ending: ['Son', [
    ['auto', 'Hikâyeye göre', ''],
    ['emotional', 'Duygusal', `SON — duygusal ve dokunaklı; okuyucunun boğazını düğümleyen küçük bir an.`],
    ['twist', 'Ters köşe', `SON — beklenmedik ama kendini doğrulayan bir ters köşe; ipucu baştan serpiştirilmiş olsun.`],
    ['open', 'Açık uçlu', `SON — açık uçlu ve düşündüren; cevabı izleyiciye bırak.`],
    ['message', 'Mesajlı', `SON — anlamlı bir mesaj; vaaz verme, görüntü ve eylemle ima et.`],
    ['happy', 'Mutlu son', `SON — mutlu ve tatmin edici.`],
  ]],
  lang: ['Dil', [
    ['daily', 'Günlük', `DİL — günlük konuşma Türkçesi; doğal, kısa cümleler.`],
    ['literary', 'Edebi', `DİL — edebi, zengin ve akıcı Türkçe; betimleyici ama süssüz.`],
    ['simple', 'Sade', `DİL — çok sade ve anlaşılır Türkçe; yalın kelimeler, kısa cümleler.`],
  ]],
  cast: ['Karakter sayısı', [
    ['auto', 'Otomatik', ''],
    ['1', 'Tek karakter', `KARAKTER — yalnızca 1 ana karakter (artı anlatıcı); başka konuşan karakter ekleme. (Her karakter ayrı görsel ve ses demektir.)`],
    ['2', 'En çok 2', `KARAKTER — en çok 2 konuşan karakter.`],
    ['4', 'En çok 4', `KARAKTER — en çok 4 konuşan karakter.`],
  ]],
};
const TALE_PRESETS = [
  ['Sesli kitap', {voice: 'narrator', pace: 'slow', lang: 'literary', opening: 'calm', ending: 'emotional'}],
  ['Dizi tadında', {voice: 'dialogue', pace: 'balanced', lang: 'daily', opening: 'inmedia'}],
  ['Korku anlatısı', {genre: 'thriller', voice: 'narrator', tone: 'mysterious', pace: 'slow', lang: 'literary', ending: 'twist'}],
  ['Çocuk masalı', {genre: 'tale', voice: 'narrator', tone: 'warm', lang: 'simple', ending: 'happy'}],
  ['Sosyal medya vurucu', {voice: 'balanced', pace: 'fast', opening: 'hook', ending: 'twist', lang: 'daily'}],
  ['İçten monolog', {voice: 'first', tone: 'warm', pace: 'slow', ending: 'emotional', cast: '1'}],
];
// görsel stil: otomatik (hikâyeye göre) veya hazır / özel
const STYLE_TAIL = ' No text, no subtitles, no logos, no watermark.';
const STYLE_PRESETS = [
  ['Çizgi roman', 'Hand-painted graphic novel illustration, bold ink linework, textured shading, cinematic framing.'],
  ['Suluboya masal', 'Soft watercolor storybook illustration, gentle washes of color, visible paper texture, whimsical details.'],
  ['Anime', 'Cinematic anime style, clean line art, expressive eyes, detailed painterly backgrounds, soft cel shading.'],
  ['3D stilize animasyon', 'Stylized 3D animated film look, soft global illumination, expressive characters, rich textures, shallow depth of field.'],
  ['Sinematik gerçekçi', 'Cinematic photorealistic film still, natural lighting, 35mm lens, shallow depth of field, subtle film grain.'],
  ['Kağıt kesme', 'Layered paper-cut diorama art, depth between the layers, soft shadows, handcrafted texture.'],
  ['Retro vektör', 'Flat retro vector illustration, limited color palette, geometric shapes, mid-century poster feel.'],
  ['Pastel, yumuşak', 'Soft pastel illustration, warm gentle lighting, rounded shapes, cozy atmosphere.'],
  ['Karanlık noir', 'Moody noir illustration, high-contrast low-key lighting, deep shadows, muted desaturated palette.'],
];
const taleOpt = () => ({...TALE_DEF, ...(STORY.opt || {})});
const taleDir = k => (TALE_OPTS[k][1].find(v => v[0] === String(taleOpt()[k])) || [])[2] || '';
function taleDirectives(){
  const out = Object.keys(TALE_OPTS).map(taleDir).filter(Boolean).map(d => '- ' + d);
  const n = taleOpt().notes.trim();
  if (n) out.push(`- ÖZEL İSTEKLER (kullanıcıdan; mutlaka uy): ${n}`);
  return out.length ? `TARZ (kullanıcının seçimleri; hepsine uy):\n${out.join('\n')}` : '';
}
const craftRules = () => `ZANAAT KURALLARI:
- "Bir gün…", "Zamanın birinde…" gibi düz girişler yok; ilk cümle ilgi çeksin.
- Göster, anlatma: duyguyu duyular ve küçük somut ayrıntılarla ver (sıcak ekmeğin kokusu, titreyen eller, yarım kalan bir cümle); "çok üzgündü" gibi etiketler yerine davranış göster.
- Karaktere net bir arzu, bir engel ve hikâyenin sonunda küçük bir değişim ver.
- Her bölüm/sahne bir şeyi ilerletsin (olay, bilgi veya duygu); yerinde sayan ya da tekrar eden bölüm bırakma.
- Cümle uzunluğunu değiştir; "adeta", "sanki" gibi dolgu sözleri ve klişeleri ("kalbi yerinden çıkacak gibi") kullanma.
- Diyaloglar doğal, karaktere özgü ve alt metinli olsun (insanlar duygularını açıkça söylemez); açıklayıcı diyalog yok.
- Tutarlı ol: isimler, mekân, saat ve hava durumu hikâye boyunca çelişmesin.`;
const lenTxt = L => L.sec < 60 ? L.sec + ' sn' : (L.sec / 60).toLocaleString('tr') + ' dk';

/* ---------- 1) Hikâye: taslak → editör gözden geçirmesi; iyileştirme; eski sürüme dönme; 3 yaklaşım ---------- */
function storyDraftPrompt(){
  const parts = +STORY.parts || 1, L = lenOf(), words = Math.round(L.sec * WPS);
  return `Sen sosyal medyada milyonlarca izlenen kısa animasyon hikâyeleri yazan ödüllü bir hikâye anlatıcısısın.
Aşağıdaki fikri/taslağı TÜRKÇE, sesli okunmaya uygun, akıcı bir düzyazı hikâyeye dönüştür.
FİKRE SADAKAT: fikirdeki karakter adlarını, rollerini ve ana olayı (kim ne yapıyor) aynen koru; başkarakter fikirdeki kişidir. Yaratıcılığını bunun etrafında kullan (neden, engel, duygu, sürpriz), fikri başka bir hikâyeye çevirme.
${parts > 1 ? `Hikâye ${parts} parttan oluşacak; her partı "Part 1", "Part 2" … başlığıyla ayır. Her part yaklaşık ${words} kelime (sesli okununca ~${L.sec} sn) olsun, kendi içinde izlenebilsin ve merak uyandıran bir anla bitsin; sonraki part kaldığı yerden devam etsin.`
  : `Hikâye yaklaşık ${words} kelime olsun (sesli okununca ~${L.sec} sn).`}
${taleDirectives()}

${craftRules()}

ÇIKTI: ilk satır "Başlık: …", altında hikâye metni. Başka açıklama, madde işareti veya not ekleme.

Fikir / taslak:
${STORY.input}`;
}
function storyPolishPrompt(draft){
  const parts = +STORY.parts || 1, words = Math.round(lenOf().sec * WPS);
  return `Sen titiz bir hikâye editörüsün. Aşağıdaki taslağı gözden geçir ve daha iyi hâlini yaz.
KONTROL LİSTESİ (her maddeyi değerlendir, eksik olanı düzelt):
1) İlk cümle ilgi çekiyor mu? 2) Duyguyu gösteriyor mu, yoksa söylüyor mu? 3) Klişe, dolgu, tekrar var mı? 4) Diyaloglar doğal ve karaktere özgü mü? 5) Tempo ve ritim uygun mu, her bölüm hikâyeyi ilerletiyor mu? 6) Son etkili ve hazırlanmış mı? 7) Aşağıdaki tarza uyuyor mu? 8) Uzunluk hedefe (~${words} kelime${parts > 1 ? ', part başına' : ''}) yakın mı?
Olay örgüsünü, karakterleri ve rollerini (kim ne yapıyor) koru; anlatımı, ritmi ve ayrıntıları iyileştir. Gerekirse cümleleri baştan yaz. ${parts > 1 ? '"Part N" başlıklarını koru. ' : ''}
${taleDirectives()}

${craftRules()}

ÇIKTI: aynı biçimde — ilk satır "Başlık: …", altında iyileştirilmiş hikâye. Kontrol listesini veya açıklama yazma.

Taslak:
${draft}`;
}
function pushHist(){
  if (!(STORY.story || '').trim()) return;
  STORY.hist = STORY.hist || [];
  if (STORY.hist.length && STORY.hist[STORY.hist.length - 1].story === STORY.story) return;
  STORY.hist.push({story: STORY.story, title: STORY.title}); if (STORY.hist.length > 8) STORY.hist.shift();
}
function setStoryText(t){
  t = t.trim();
  const m = t.match(/^\s*(?:\*\*)?Başlık:\s*(.+?)(?:\*\*)?\s*$/m);
  if (m){ STORY.title = m[1].replace(/\*/g, '').trim(); t = t.replace(m[0], '').trim(); }
  STORY.story = t;
}
function undoStory(){
  const h = (STORY.hist || []).pop(); if (!h) return;
  STORY.story = h.story; STORY.title = h.title; dirty = true; renderStory();
}
async function writeStory(){
  if (!STORY.input.trim()){ toast('Önce hikâye fikrini veya taslağını yaz'); return; }
  try {
    let t = await askGemini(storyDraftPrompt(), 'Hikâye yazılıyor');
    if (STORY.polish !== false){
      try { t = await askGemini(storyPolishPrompt(t), 'Editör gözden geçiriyor'); }   // olmazsa taslak kalır
      catch (e){ toast('Gözden geçirme olmadı, taslak kullanıldı'); }
    }
    pushHist(); setStoryText(t); dirty = true; renderStory();
    toast('Hikâye hazır. Düzenleyebilir, "İyileştir" ile yönlendirebilir veya "Sahnelere böl" diyebilirsin.');
  } catch (e){ toast('Hikâye yazılamadı: ' + e.message, 'err'); }
  storyBusy(null);
}
const STORY_REFINES = [
  ['Daha duygusal', 'Duygusal etkiyi artır: karakterin iç dünyasını ve küçük dokunaklı ayrıntıları güçlendir, duyguyu söylemeden hissettir.'],
  ['Daha gerilimli', 'Gerilimi artır: belirsizlik, ima, zamana karşı baskı ve gelecek tehlikenin sezdirilmesi; sakin anları kısalt.'],
  ['Daha mizahi', 'Hafif mizah ekle: durum komikliği ve karakterlerin zekice sözleri; hikâyenin duygusunu bozma.'],
  ['Daha kısa', 'Hikâyeyi yaklaşık %30 kısalt: gereksiz betimleme ve tekrarları çıkar; olayı ve duyguyu koru.'],
  ['Daha uzun', 'Hikâyeyi yaklaşık %30 uzat: önemli anları derinleştir, mekân ve karakter ayrıntıları ekle; yeni olay ekleme.'],
  ['Daha çok diyalog', 'Anlatımın bir kısmını karakter diyaloğuna çevir; diyaloglar doğal ve alt metinli olsun.'],
  ['Daha çok betimleme', 'Mekân, ışık, ses ve kokulara dair somut betimlemeleri artır; atmosferi güçlendir.'],
  ['Daha güçlü açılış', 'Yalnızca ilk paragrafı (ilk 2–3 cümle) çok daha ilgi çekici yaz: merak, çarpıcı detay veya beklenmedik an.'],
  ['Daha güçlü son', 'Yalnızca finali güçlendir: sona hazırlayan ipuçlarını baştan sez ve sonu daha akılda kalıcı kıl.'],
  ['Daha sade dil', 'Dili sadeleştir: kısa cümleler, günlük kelimeler, süssüz anlatım.'],
];
function refineStoryPrompt(instr){
  const src = (STORY.story || '').trim(), words = src.split(/\s+/).filter(Boolean).length;
  return `Sen deneyimli bir hikâye editörüsün. Aşağıdaki hikâyeyi kullanıcının isteğine göre değiştir.
İstenmeyen yerleri koru: olay örgüsü, karakter adları ve anlatım biçimi aynı kalsın; yalnızca istenen yönde, hissedilir şekilde iyileştir. İstek uzunlukla ilgili değilse uzunluğu koru (şu an ~${words} kelime).
${(+STORY.parts || 1) > 1 ? '"Part N" başlıklarını koru.\n' : ''}${taleDirectives()}

${craftRules()}

KULLANICI İSTEĞİ: ${instr.trim()}

ÇIKTI: ilk satır "Başlık: …", altında hikâyenin tamamı. Açıklama ekleme.

Hikâye:
${(STORY.title ? 'Başlık: ' + STORY.title + '\n' : '') + src}`;
}
async function refineStory(instr){
  const src = (STORY.story || '').trim();
  if (!src){ toast('Önce bir hikâye yaz'); return; }
  if (!instr.trim()){ toast('Ne değişsin? Bir not yaz veya bir öneriye tıkla'); return; }
  const words = src.split(/\s+/).filter(Boolean).length;
  const prompt = refineStoryPrompt(instr);
  try {
    const t = await askGemini(prompt, 'Hikâye iyileştiriliyor');
    pushHist(); setStoryText(t); dirty = true; renderStory();
    toast('Hikâye güncellendi. Beğenmediysen "↶ Önceki sürüm" ile geri dön.');
  } catch (e){ toast('İyileştirilemedi: ' + e.message, 'err'); }
  storyBusy(null);
}
// fikir için 3 farklı yaklaşım: kullanıcı yönü seçer, hikâye ona göre yazılır
async function suggestPitches(){
  if (!STORY.input.trim()){ toast('Önce bir fikir yaz'); return; }
  const prompt = `Sen yaratıcı bir hikâye geliştiricisisin. Aşağıdaki fikir için 3 FARKLI yaklaşım öner; her biri farklı bir açıdan, duygudan veya ters köşeden gitsin (birbirine benzemesin).
${taleDirectives()}
Her yaklaşım için: title (kısa, akılda kalıcı), logline (1–2 cümle, olay + engel), hook (ilk görüntü/cümle), twist (dönüm noktası veya duygusal vuruş). Hepsi Türkçe.
Yalnızca şu JSON'u döndür: {"pitches": [{"title": "...", "logline": "...", "hook": "...", "twist": "..."}]}

Fikir:
${STORY.input}`;
  try {
    const j = parseJson(await askGemini(prompt, 'Yaklaşımlar düşünülüyor'));
    STORY.pitches = (j.pitches || []).slice(0, 3); dirty = true; renderStory();
    if (!STORY.pitches.length) toast('Öneri gelmedi, tekrar dene');
  } catch (e){ toast('Öneriler alınamadı: ' + e.message, 'err'); }
  storyBusy(null);
}

/* ---------- 2) Senaryo: hikâyeyi sahnelere böl; iyileştir; tek sahneyi yeniden yaz ---------- */
// sahne başına söz bütçesi: seçilen süre ve sahne sayısından (sesli okuma ~2.4 kelime/sn; hikâye yazımıyla aynı)
const WPS = 2.4;
function sceneBudget(per){
  const L = lenOf(), total = Math.round(L.sec * WPS), w = Math.max(6, Math.round(total / Math.max(1, per)));
  const lines = w <= 14 ? '1 satır' : w <= 26 ? '1–2 satır' : w <= 45 ? '2–3 satır' : '2–4 satır';
  const maxLine = Math.max(8, Math.min(22, Math.round(w / (w <= 14 ? 1 : w <= 26 ? 1.5 : w <= 45 ? 2.5 : 3)) + 4));
  return {total, w, sec: Math.round(w / WPS), lines, maxLine, partSec: L.sec};
}
function scriptRules(per = sceneCount()){
  const B = sceneBudget(per);
  return `YAZIM KURALLARI (Türkçe metinler için):
- Her sahne bir öncekinden bir adım ileri gitsin (olay, duygu veya bilgi değişsin). Son sahne seçilen SON tarzına uygun kapansın; part sonuysa merakta bıraksın.
- Anlatıcı/karakter dengesi ve dil için yukarıdaki TARZ yönergelerine uy. Diyaloglar doğal, karaktere özgü ve alt metinli olsun.
- SÜRE BÜTÇESİ: part başına toplam ~${B.total} kelime (~${B.partSec} sn). Sahne başına ortalama ~${B.w} kelime (~${B.sec} sn): ${B.lines}, her satır en çok ${B.maxLine} kelime. Bütçeyi aşma; önemli sahneye biraz fazla, geçiş sahnesine az verebilirsin.
- Sahneler arasında boşluk kalmasın: anlatım bir sahneden diğerine akmalı.
- duration: o sahnedeki tüm satırların sesli okunma süresi (saniye, kelime sayısı / ${WPS}) + 0.5; 3 ile 10 arasında.
Konuşanlar: "Anlatıcı" (ANLATIM ayarı izin veriyorsa) veya karakter adları. image_prompt ve video_prompt İNGİLİZCE olsun.
image_prompt: kareyi ayrıntılı anlat (kompozisyon, ışık, karakterin ne yaptığı, mekân). Çekim boyutunu değiştir (wide establishing / medium / close-up / over-the-shoulder / low angle); art arda iki sahne aynı çekimde olmasın. Mekânı her sahnede aynı İngilizce adla an; saat, hava ve ışık sürekliliğini koru. Yazı/altyazı isteme.
video_prompt: kareden başlayan hareketi ve kamerayı anlat (ör. slow push-in, karakter döner); diyalog yok, yalnızca ortam sesi.
ambience: sahnenin arka plan ortam sesi (İngilizce, müzik değil; mekâna ve ana uygun, ör. "quiet night street, distant traffic, light wind, footsteps on wet pavement").
characters: hikâyede görünen her karakter için tutarlı görsel tarif (look, İngilizce: yaş, saç, kıyafet, belirgin özellikler) ve seslendirme için ses tarifi (voice, İngilizce: gender, age, tone; ör. "male, 30s, calm, slightly husky").
narrator_voice: anlatıcı için hikâyenin havasına uygun ses tarifi (İngilizce).
${tagsOk(M.tts()) ? `Seslendirme satırlarında, yalnızca gerçekten gerekli yerlerde, köşeli parantez içinde İngilizce duygu/ses etiketleri kullan: [whispers], [laughs], [sighs], [gasps], [nervously], [softly], [shouting], [pause] gibi. Etiket satırın içinde, ilgili sözün hemen önünde olsun.` : 'Seslendirme satırlarında köşeli parantezli etiket KULLANMA.'}
${STORY.styleAuto !== false ? `style: hikâyenin türüne, dönemine ve havasına uygun TEK bir görsel stil belirle (İngilizce, tek paragraf): çizim/render tekniği, 3–4 renkli palet, ışık, kamera/kompozisyon dili, doku ve hikâyeye özgü 1–2 görsel motif.
Hikâye neşeli/gündelikse sıcak ve aydınlık, çocuk hikâyesiyse masalsı, gerilimse karanlık stil seç; karanlık stili yalnızca hikâye gerçekten gerektiriyorsa kullan.
Stilin sonuna "No text, no subtitles, no logos, no watermark." ekle. image_prompt'larda bu stile uy.` : `Görsel stil (her sahnede aynı; promptlara uygula): ${STORY.style}`}`;
}
const scriptSchema = () => `Yalnızca şu JSON'u döndür:
{"title": "...", ${STORY.styleAuto !== false ? '"style": "...", ' : ''}"narrator_voice": "...", "characters": [{"name": "...", "look": "...", "voice": "..."}],
 "scenes": [{"part": 1, "summary": "Türkçe kısa özet", "lines": [{"speaker": "Anlatıcı", "text": "..."}], "image_prompt": "...", "video_prompt": "...", "ambience": "...", "duration": 8}]}`;
function scriptPrompt(){
  const approved = !!(STORY.story || '').trim(), parts = +STORY.parts || 1, n = `tam ${sceneCount()}`;
  const partTxt = parts > 1 ? `Hikâyeyi TAM ${parts} parta (bölüme) böl; her partta ${n} sahne olsun. Her part kendi içinde izlenebilsin, part sonları merak uyandırsın (cliffhanger), sonraki part kaldığı yerden devam etsin. Her sahnede "part" alanına 1'den ${parts}'e kadar part numarasını yaz.`
    : `Tek part; ${n} sahne. Her sahnede "part": 1 yaz.`;
  return `Sen sosyal medyada milyonlarca izlenen kısa dikey (${STSET.ratio}) animasyon hikâyeleri için ödüllü bir senarist ve görüntü yönetmenisin.
${partTxt}

${approved ? `GÖREV: Aşağıdaki hikâye kullanıcının ONAYLADIĞI son metindir. Olay örgüsünü, sırasını, karakterleri ve sonu DEĞİŞTİRME; yeni olay ekleme.
Hikâyeyi sahnelere böl; seslendirme satırlarını bu metinden uyarla (gerekirse seslendirmeye uygun kısalt). ANLATIM tarzına uymak için anlatım cümlelerini karakter diyaloğuna (veya tersine) çevirebilirsin; olay örgüsü değişmesin. Toplam süre part başına ~${lenOf().sec} sn olsun.`
  : `GÖREV: Aşağıdaki metin yalnızca bir fikir veya taslaktır; onu izleyeni ilk saniyede yakalayan, duygusu ve merakı olan, akıcı bir hikâyeye DÖNÜŞTÜR.
Metin çok kısaysa yaratıcı ol: karaktere bir arzu, bir engel ve beklenmedik bir an ekle. Toplam süre part başına ~${lenOf().sec} sn olsun.`}

${taleDirectives()}

${scriptRules()}

${scriptSchema()}

${approved ? 'Hikâye' : 'Metin'}:
${storySource()}`;
}
// senaryo JSON'unu uygula; merge: değişmeyen sahnelerin sesini/görselini/videosunu koru
function applyScriptJson(j, parts, merge){
  const keep = new Map(STORY.characters.map(c => [c.name, c.voice])), keepRef = new Map(STORY.characters.map(c => [c.name, c.ref])), old = STORY.scenes;
  STORY.title = STORY.title || j.title || '';
  if (STORY.styleAuto !== false && j.style) STORY.style = j.style;
  STORY.characters = (j.characters || []).map(c => ({name: c.name, look: c.look || '', voiceDesc: c.voice || '', voice: keep.get(c.name) || '', ...(keepRef.get(c.name) ? {ref: keepRef.get(c.name)} : {})}));
  STORY.narratorDesc = j.narrator_voice || STORY.narratorDesc || '';
  const lk = ls => ls.map(l => l.speaker + '|' + l.text).join('\n');
  STORY.scenes = (j.scenes || []).map((s, i) => {
    const n = {id: uid(), part: clamp(Math.round(+s.part || 1), 1, parts), summary: s.summary || '', image_prompt: s.image_prompt || '', video_prompt: s.video_prompt || '', ambience: s.ambience || '',
      duration: clamp(Math.round(+s.duration || 8), 3, 10), lines: (s.lines || []).map(l => ({speaker: l.speaker || 'Anlatıcı', text: l.text || ''})), st: {}};
    const o = merge && old[i];
    if (o){
      if (o.image && o.image_prompt === n.image_prompt) n.image = o.image;
      if (o.video && o.video_prompt === n.video_prompt) n.video = o.video;
      if (o.amb && o.ambience === n.ambience) n.amb = o.amb;
      if (lk(o.lines) === lk(n.lines)) n.lines = o.lines;   // satırlar aynıysa üretilmiş sesler korunur
    }
    return n;
  });
  STORY.scenes.sort((a, b) => a.part - b.part);
  STORY.reviewed = false;
}
// anlatıcı oranı (kelime sayısına göre, %); seçilen anlatım tarzının hedef aralığı ve düzeltme notu
function narrShare(){
  const wc = t => stripTags(t).split(/\s+/).filter(Boolean).length, all = STORY.scenes.flatMap(s => s.lines);
  const tw = all.reduce((a, l) => a + wc(l.text), 0) || 1;
  return Math.round(all.filter(l => l.speaker === 'Anlatıcı').reduce((a, l) => a + wc(l.text), 0) / tw * 100);
}
const VOICE_TARGET = {
  narrator: [65, 100, 'Karakter diyaloglarının çoğunu anlatıcının anlatımına çevir; yalnızca en etkili 1–2 kısa replik karakterde kalsın.'],
  balanced: [30, 70, 'Anlatıcı ile karakter diyaloglarını yaklaşık yarı yarıya dengele.'],
  dialogue: [0, 40, 'Anlatıcı satırlarının çoğunu karakter diyaloğuna veya karakterin kendi sesine çevir; anlatıcı yalnızca en fazla 1 cümlelik kısa köprüler kursun, bazı sahnelerde hiç konuşmasın.'],
  first: [0, 15, 'Anlatıcı satırlarını başkarakterin birinci şahıs ("ben") anlatımına çevir ve speaker alanına başkarakterin adını yaz; "Anlatıcı" kullanma.'],
};
function pushScriptHist(){
  STORY.scriptHist = STORY.scriptHist || [];
  STORY.scriptHist.push(JSON.stringify(STORY.scenes)); if (STORY.scriptHist.length > 5) STORY.scriptHist.shift();
}
function undoScript(){
  const h = (STORY.scriptHist || []).pop(); if (!h) return;
  STORY.scenes = JSON.parse(h); dirty = true; renderStory();
}
async function writeScript(){
  if (!storySource()){ toast('Önce hikâyeyi yaz veya bir metin gir'); return; }
  const parts = +STORY.parts || 1;
  try {
    const j = parseJson(await askGemini(scriptPrompt(), 'Senaryo yazılıyor'));
    if (STORY.scenes.length) pushScriptHist();
    applyScriptJson(j, parts, false);
    // seçilen anlatım tarzı tutmadıysa bir kez otomatik düzelt (ör. karakter ağırlıklıda anlatıcı çok fazlaysa)
    const tg = VOICE_TARGET[taleOpt().voice], sh = narrShare();
    if (tg && (sh < tg[0] || sh > tg[1])) await rewriteScript(`Anlatıcı oranı şu an %${sh}; seçilen ANLATIM tarzı için hedef %${tg[0]}–${tg[1]}. ${tg[2]} Olay örgüsünü, sahne sayısını ve görsel alanları koru.`, true);
    dirty = true; storyShow('script'); toast(`${parts > 1 ? parts + ' part, ' : ''}${STORY.scenes.length} sahnelik senaryo hazır. Önizlemeyi inceleyip onayla.`);
    setTimeout(() => { const pv = $('stPreview'); if (pv) pv.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 50);
    await suggestVoices().catch(e => toast('Sesler önerilemedi: ' + e.message, 'err'));
  } catch (e){ toast('Senaryo yazılamadı: ' + e.message, 'err'); }
  storyBusy(null);
}
const sceneJson = s => ({part: s.part || 1, summary: s.summary, lines: s.lines.map(l => ({speaker: l.speaker, text: l.text})), image_prompt: s.image_prompt, video_prompt: s.video_prompt, ambience: s.ambience, duration: s.duration});
const SCRIPT_REFINES = [
  ['Anlatıcıyı azalt', 'Anlatıcı satırlarını azalt; bilgiyi karakter diyaloğu ve görüntüyle ver.'],
  ['Diyalogu artır', 'Karakter diyaloglarını artır ve daha doğal yap; anlatıcı yalnızca köprü kursun.'],
  ['Satırları kısalt', 'Her satırı daha kısa ve vurucu yap; gereksiz kelimeleri at.'],
  ['Daha vurucu geçişler', 'Sahne sonlarını ve açılışlarını güçlendir; her sahne bir sonrakini merak ettirsin.'],
  ['Görsel çeşitlilik', 'image_prompt çekim boyutlarını ve açılarını çeşitlendir (geniş, orta, yakın plan, farklı açılar); kompozisyonları daha sinematik yap.'],
];
// tüm senaryoyu bir notla yeniden düzenle (değişmeyen sahnelerin ses/görsel/videosu korunur)
function rewriteScriptPrompt(instr){
  const parts = +STORY.parts || 1;
  return `Sen ödüllü bir senarist ve görüntü yönetmenisin. Aşağıda mevcut bir senaryo (JSON) ve kullanıcının notu var.
Notu uygula; notla ilgisi olmayan sahneleri, karakterleri ve alanları AYNEN koru. Sahne sayısını ve part dağılımını (${parts} part) koruyun, aksi istenmedikçe.
${taleDirectives()}

${scriptRules(Math.max(1, Math.round(STORY.scenes.length / parts)))}

KULLANICI NOTU: ${instr.trim()}

Hikâye (referans, olay örgüsü değişmesin):
${storySource()}

Mevcut senaryo:
${JSON.stringify({title: STORY.title, narrator_voice: STORY.narratorDesc, characters: STORY.characters.map(c => ({name: c.name, look: c.look, voice: c.voiceDesc})), scenes: STORY.scenes.map(sceneJson)})}

${scriptSchema()}`;
}
async function rewriteScript(instr, auto){
  if (!STORY.scenes.length) return;
  if (!instr.trim()){ toast('Ne değişsin? Bir not yaz veya bir öneriye tıkla'); return; }
  const parts = +STORY.parts || 1;
  const prompt = rewriteScriptPrompt(instr);
  try {
    const j = parseJson(await askGemini(prompt, auto ? 'Anlatım dengesi ayarlanıyor' : 'Senaryo düzenleniyor'));
    if (!auto) pushScriptHist();
    applyScriptJson(j, parts, true); dirty = true;
    if (!auto){ renderStory(); toast('Senaryo güncellendi. Beğenmediysen "↶ Önceki senaryo" ile geri dön.'); }
  } catch (e){ if (!auto) toast('Senaryo düzenlenemedi: ' + e.message, 'err'); }
  storyBusy(null);
}
// tek sahneyi yeniden yaz (komşu sahneleri ve hikâyeyi bağlam olarak görür)
function rewriteScenePrompt(i, note){
  const s = STORY.scenes[i], prev = STORY.scenes[i - 1], next = STORY.scenes[i + 1];
  return `Sen ödüllü bir senarist ve görüntü yönetmenisin. Aşağıdaki hikâyenin ${i + 1}. sahnesini yeniden yaz.
${note.trim() ? `KULLANICI NOTU: ${note.trim()}` : 'Not yok: sahneyi daha etkileyici, akıcı ve görsel hâle getir.'}
Sahnenin hikâyedeki işlevini (olay örgüsü) ve komşu sahnelerle sürekliliği koru; önceki sahneden doğal devam et ve sonrakine hazırla. Karakter adları ve görünümleri aynı kalsın.
${taleDirectives()}

${scriptRules(Math.max(1, Math.round(STORY.scenes.length / (+STORY.parts || 1))))}

Karakterler: ${STORY.characters.map(c => `${c.name} (${c.look})`).join('; ') || '-'}
${prev ? `Önceki sahne: ${JSON.stringify(sceneJson(prev))}\n` : ''}Bu sahne (mevcut): ${JSON.stringify(sceneJson(s))}
${next ? `Sonraki sahne: ${JSON.stringify(sceneJson(next))}\n` : ''}
Yalnızca şu JSON'u döndür (tek sahne): {"summary": "...", "lines": [{"speaker": "...", "text": "..."}], "image_prompt": "...", "video_prompt": "...", "ambience": "...", "duration": 8}`;
}
async function rewriteScene(i, note){
  const s = STORY.scenes[i]; if (!s) return;
  const prev = STORY.scenes[i - 1], next = STORY.scenes[i + 1];
  const prompt = rewriteScenePrompt(i, note);
  try {
    const j = parseJson(await askGemini(prompt, `Sahne ${i + 1} yeniden yazılıyor`));
    pushScriptHist();
    Object.assign(s, {summary: j.summary || s.summary, image_prompt: j.image_prompt || s.image_prompt, video_prompt: j.video_prompt || s.video_prompt,
      ambience: j.ambience || s.ambience, duration: clamp(Math.round(+j.duration || s.duration), 3, 10),
      lines: (j.lines || []).map(l => ({speaker: l.speaker || 'Anlatıcı', text: l.text || ''}))});
    STORY.reviewed = false; dirty = true; openEdit.delete(s.id); renderStory();
    toast(`Sahne ${i + 1} güncellendi. Görseli/videoyu yeniden üretmen gerekebilir.`);
  } catch (e){ toast('Sahne yazılamadı: ' + e.message, 'err'); }
  storyBusy(null);
}
const openEdit = new Set();   // önizlemede düzenleme satırı açık sahneler
/* ---------- Üretim dosyası içe aktarma (PDF / Word / metin) ---------- */
// "Tam üretim dosyası" yapısını çözer: XX_REF karakter kartları, SAHNE N bölümleri (karakter referansları, VISUAL / VIDEO PROMPT,
// SES KAYITLARI), DESIGN LANGUAGE, ekran yazıları. Promptlar birebir korunur. Yapı tanınmazsa null döner (Gemini'ye düşülür).
const TR_UP = /[İŞĞÇÖÜ]/;
// BÜYÜK HARF → Baş Harfi Büyük. Türkçe kural (I→ı) metnin tamamında Türkçeye özgü harf varsa uygulanır; "SELIN" gibi adlar "Selin" olur
const niceName = w => { const loc = TR_UP.test(w) ? 'tr' : 'en';
  return w.split(/(\s+)/).map(p => { if (!p.trim()) return p; const lo = p.toLocaleLowerCase(loc); return lo.charAt(0).toLocaleUpperCase(loc) + lo.slice(1); }).join(''); };
const VOICE_MODS = {'FISILTI': '[whispers]', 'FISILDAYARAK': '[whispers]', 'BAĞIRARAK': '[shouting]', 'GÜLEREK': '[laughs]', 'AĞLAYARAK': '[crying]', 'İÇ SES': '[softly]'};
function parseProduction(text){
  const raw = text.replace(/\r/g, '').split('\n').map(l => l.trim());
  const lines = raw.filter(l => l && !/^[^•]{2,60}•[^•]{2,80}\s\d{1,3}$/.test(l));   // sayfa üst bilgileri ("MARKA • ESER 4")
  const out = {title: '', style: '', voiceTarget: null, total: null, characters: [], scenes: []};
  const stop = lines.findIndex(l => /ÜRETİM DOSYASI|^Bu PDF/i.test(l));
  if (stop > 0) out.title = lines.slice(lines.length > 1 && stop > 1 ? 1 : 0, stop).join(' ').replace(/\s+/g, ' ').trim();
  const head = lines.slice(0, 40).join(' ');
  const vt = head.match(/%\s*(\d+)\s*anlatıcı/i); if (vt) out.voiceTarget = +vt[1];
  const tt = head.match(/Yaklaşık\s+(\d+)\s*saniye/i); if (tt) out.total = +tt[1];
  let ch = null, sc = null, field = null, styleBuf = null;
  const flush = () => {
    if (styleBuf != null){ if (!out.style) out.style = styleBuf.trim(); styleBuf = null; }
  };
  const add = (obj, key, l) => { obj[key] = obj[key] ? obj[key] + (/[-–—]$/.test(obj[key]) ? '' : ' ') + l : l; };
  for (const l of lines){
    let m;
    if ((m = l.match(/^([A-ZÇĞİÖŞÜ0-9]+)_REF\s+[—–-]\s+(.+)$/))){ flush(); field = 'sheet'; sc = null; ch = {key: m[1], name: niceName(m[1]), sheet: '', note: m[2]}; out.characters.push(ch); continue; }
    if ((m = l.match(/^SAHNE\s+(\d+)\s*[—–-]\s*(.+)$/i))){ flush(); ch = null; field = null; sc = {n: +m[1], title: m[2].trim(), refs: '', image_prompt: '', video_prompt: '', lines: [], screen: [], duration: null}; out.scenes.push(sc); continue; }
    if (/^BÖLÜM\s+[A-ZÇ]\b/.test(l)){ flush(); ch = null; if (/KURGU|DEVAMLILIK|KONTROL/i.test(l)) sc = null; field = null; continue; }
    if (/^DESIGN LANGUAGE:/i.test(l)){ flush(); styleBuf = l.replace(/^DESIGN LANGUAGE:\s*/i, ''); field = 'style'; continue; }
    if (sc && (m = l.match(/Tahmini süre:\s*(\d+)/i))){ sc.duration = +m[1]; continue; }
    if (sc && /^KARAKTER REFERANSLARI/i.test(l)){ flush(); field = 'refs'; continue; }
    if (sc && /^VISUAL PROMPT/i.test(l)){ flush(); field = 'image_prompt'; continue; }
    if (sc && /^VIDEO PROMPT/i.test(l)){ flush(); field = 'video_prompt'; continue; }
    if (sc && /^SES KAYITLARI/i.test(l)){ flush(); field = 'voice'; continue; }
    if (field === 'style'){ styleBuf += ' ' + l; continue; }
    if (ch && field === 'sheet'){ add(ch, 'sheet', l); continue; }
    if (sc && field === 'voice'){
      if ((m = l.match(/^([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ .'’]*?)(?:\s+[—–-]\s+([^:]+?))?\s*:\s*(.+)$/))){
        const who = m[1].trim(), mod = (m[2] || '').trim().toLocaleUpperCase('tr'), txt = m[3].trim();
        if (/^EKRAN YAZISI/.test(who)){ sc.screen.push({after: sc.lines.length, text: txt}); continue; }
        const speaker = /^ANLATICI$/.test(who) ? 'Anlatıcı' : niceName(who);
        const tag = Object.entries(VOICE_MODS).find(([k]) => mod.includes(k));
        sc.lines.push({speaker, text: (tag ? tag[1] + ' ' : '') + txt});
      } else if (sc.lines.length || sc.screen.length){   // satır devamı
        const last = sc.screen.length && sc.screen[sc.screen.length - 1].after === sc.lines.length ? sc.screen[sc.screen.length - 1] : sc.lines[sc.lines.length - 1];
        if (last) last.text += ' ' + l;
      }
      continue;
    }
    if (sc && field && field !== 'voice') add(sc, field, l);
  }
  flush();
  if (!out.scenes.length) return null;
  // sahnelerde adı geçen karakter referansları ve ortam sesi (video promptundaki AUDIO: bölümü)
  const byKey = new Map(out.characters.map(c => [c.key, c.name]));
  for (const s of out.scenes){
    s.chars = [...new Set([...(s.refs + ' ' + s.image_prompt).matchAll(/([A-ZÇĞİÖŞÜ0-9]+)_REF/g)].map(x => byKey.get(x[1])).filter(Boolean))];
    const au = s.video_prompt.match(/AUDIO:\s*([\s\S]*?)(?:\.\s*No (?:dialogue|spoken|people)[\s\S]*)?$/i);
    s.ambience = au ? au[1].replace(/\.$/, '').trim() : '';
  }
  for (const c of out.characters){
    const age = (c.sheet.match(/(\d+)-year-old/) || c.note.match(/(\d+)/) || [])[1];
    const g = /\b(woman|female|girl)\b/i.test(c.sheet) ? 'female' : /\b(man|male|boy)\b/i.test(c.sheet) ? 'male' : '';
    c.voice = [g, age ? age + ' years old' : '', (c.sheet.match(/expression is ([^.]+)/i) || c.sheet.match(/(calm|warm|confident|tired|controlled|composed|precise)[^.,]*/i) || [])[1] || ''].filter(Boolean).join(', ');
  }
  return out;
}

// yapı tanınmazsa: belge metnini Gemini ile aynı biçime dönüştür (promptlar birebir kopyalanır)
async function parseProductionAI(text){
  const prompt = `Aşağıda bir animasyon bölümünün üretim dosyası var. Onu şu JSON'a dönüştür. Promptları ve seslendirme metinlerini KISALTMADAN, AYNEN kopyala; uydurma ekleme.
- characters: dosyadaki her karakter; sheet = o karakterin görsel referans (character sheet) promptu, voice = cinsiyet, yaş, ton (İngilizce).
- scenes: sırayla; title = sahne adı, duration = saniye, refs = sahnenin karakter referans notu, chars = sahnede görünen karakter adları,
  image_prompt = görsel promptu, video_prompt = video promptu, ambience = video promptundaki ortam sesi kısmı (İngilizce),
  lines = seslendirme satırları ({speaker: "Anlatıcı" veya karakter adı, text}), screen = ekrana/kurguya yazılacak metinler ({after: kaçıncı satırdan sonra (0 = en başta), text}).
- style = ortak tasarım dili / görsel stil metni (varsa), voiceTarget = anlatıcı yüzdesi hedefi (varsa, sayı), total = toplam süre (sn, varsa).
Yalnızca JSON: {"title": "", "style": "", "voiceTarget": null, "total": null, "characters": [{"name": "", "sheet": "", "voice": ""}],
 "scenes": [{"title": "", "duration": 10, "refs": "", "chars": [], "image_prompt": "", "video_prompt": "", "ambience": "", "lines": [{"speaker": "", "text": ""}], "screen": [{"after": 0, "text": ""}]}]}

Dosya:
${text.slice(0, 60000)}`;
  const j = parseJson(await askGemini(prompt, 'Üretim dosyası çözümleniyor'));
  return j && (j.scenes || []).length ? j : null;
}
async function importProduction(){
  const [file] = await api.openFiles('doc', false); if (!file) return;
  if (STORY.scenes.length && !confirm('Mevcut hikâye, karakterler ve sahneler bu dosyadakilerle değiştirilecek. Devam edilsin mi?')) return;
  storyBusy('Dosya okunuyor…');
  try {
    const text = await api.docText(file);
    if (!text || text.trim().length < 50) throw new Error('Dosyadan metin okunamadı (taranmış/görsel PDF olabilir)');
    let r = parseProduction(text), how = 'doğrudan';
    if (!r){ r = await parseProductionAI(text); how = 'Gemini ile'; }
    if (!r) throw new Error('Dosyada sahne bulunamadı');
    applyProduction(r, file);
    toast(`${basename(file)} ${how} içe aktarıldı: ${STORY.characters.filter(c => !c.voiceOnly).length} karakter, ${STORY.scenes.length} sahne, ${STORY.scenes.reduce((a, x) => a + x.lines.length, 0)} seslendirme satırı.`);
    await suggestVoices().catch(e => toast('Sesler önerilemedi: ' + e.message, 'err'));
  } catch (e){ console.error(e); toast('İçe aktarılamadı: ' + e.message, 'err'); }
  storyBusy(null);
}
function applyProduction(r, file){
  const keepVoice = new Map(STORY.characters.map(c => [c.name, c.voice])), keepRef = new Map(STORY.characters.map(c => [c.name, c.ref]));
  pushHist(); if (STORY.scenes.length) pushScriptHist();
  STORY.title = r.title ? niceName(r.title) : stem(file);
  STORY.style = r.style || STORY.style; STORY.styleAuto = !r.style && STORY.styleAuto !== false;
  STORY.characters = (r.characters || []).map(c => ({name: c.name, look: c.sheet || c.look || '', sheet: true, voiceDesc: c.voice || '',
    voice: keepVoice.get(c.name) || '', ...(keepRef.get(c.name) ? {ref: keepRef.get(c.name)} : {})}));
  STORY.scenes = (r.scenes || []).map((x, i) => ({id: uid(), part: 1, summary: niceName(x.title || `Sahne ${i + 1}`), verbatim: true,
    refsNote: x.refs || '', chars: x.chars || [],
    image_prompt: [x.refs, x.image_prompt].filter(Boolean).join('\n\n'), video_prompt: [x.refs, x.video_prompt].filter(Boolean).join('\n\n'),
    ambience: x.ambience || '', duration: clamp(Math.round(+x.duration || 8), 3, 15),
    lines: (x.lines || []).map(l => ({speaker: l.speaker === 'ANLATICI' ? 'Anlatıcı' : l.speaker, text: l.text})), screen: x.screen || [], st: {}}));
  // seslendirmede konuşan ama karakter kartı olmayan roller (ör. Anons): yalnızca ses
  const known = new Set(['Anlatıcı', ...STORY.characters.map(c => c.name)]);
  for (const sp of new Set(STORY.scenes.flatMap(x => x.lines.map(l => l.speaker)))) if (!known.has(sp)){
    STORY.characters.push({name: sp, look: '', voiceOnly: true, voiceDesc: /anons/i.test(sp) ? 'neutral synthetic public-address announcement voice, calm, cold' : '', voice: keepVoice.get(sp) || ''});
    known.add(sp);
  }
  STORY.narratorDesc = STORY.narratorDesc || 'deep, calm, cinematic storyteller voice';
  const tv = +r.voiceTarget;
  if (tv) STORY.opt = {...taleOpt(), voice: tv >= 60 ? 'narrator' : tv <= 40 ? 'dialogue' : 'balanced'};
  if (r.total){ const L = [...LENGTHS].sort((a, b) => Math.abs(a.sec - r.total) - Math.abs(b.sec - r.total))[0]; STORY.length = L.id; }
  STORY.parts = 1; STORY.count = String(STORY.scenes.length);
  STORY.input = `${STORY.title} — ${basename(file)} dosyasından içe aktarıldı.`;
  STORY.story = STORY.scenes.map((x, i) => `${i + 1}. ${x.summary}\n` + x.lines.map(l => `${l.speaker}: ${l.text}`).join('\n')).join('\n\n');
  STORY.reviewed = false; dirty = true; storyShow('script');
}
// "Promptu göster": Gemini'ye gidecek metnin tamamı (gönderilmez)
function showPrompt(title, text){
  $('pmTitle').textContent = title; $('pmText').value = text;
  const w = text.split(/\s+/).filter(Boolean).length;
  $('pmInfo').textContent = `${text.length.toLocaleString('tr')} karakter · ${w.toLocaleString('tr')} kelime · yalnızca gösterim, gönderilmedi`;
  $('promptModal').hidden = false; $('pmText').scrollTop = 0;
}
$('pmClose').onclick = () => { $('promptModal').hidden = true; };
$('pmCopy').onclick = async () => { await api.clipboardWrite($('pmText').value); toast('Prompt panoya kopyalandı'); };
$('promptModal').addEventListener('keydown', e => { if (e.key === 'Escape'){ e.stopPropagation(); $('promptModal').hidden = true; } });
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
// içe aktarılan üretim dosyasındaki sahneler (verbatim) senin promptlarınla birebir gider; yalnızca ortak tasarım dili eklenir
const imagePromptFull = s => s.verbatim ? `${s.image_prompt}${STORY.style ? `\n\nDESIGN LANGUAGE: ${STORY.style}` : ''}`
  : `${s.image_prompt}\n\nCharacters: ${charsText()}\nStyle: ${STORY.style}\nVertical ${STSET.ratio} composition.`;
const videoPromptFull = s => s.verbatim ? `${s.video_prompt}${STORY.style ? `\n\nDESIGN LANGUAGE: ${STORY.style}` : ''}`
  : `${s.video_prompt}\nKeep the exact art style and characters of the starting image. ${STORY.style}\nNo dialogue, no speech; ambient sound only. No text, no subtitles.`;
// sahne görseli için referanslar: karakter görselleri önce (en çok 4), sonra elle eklenen referanslar
// sahneye karakter listesi atanmışsa (üretim dosyası) yalnızca o karakterlerin görselleri referans gider
const storyRefs = s => [...STORY.characters.filter(c => !s || !s.chars || s.chars.includes(c.name)).map(c => c.ref).filter(Boolean).slice(0, 4), ...STORY.refs].slice(0, 6);
const charPromptFull = c => c.sheet ? `${c.look}${STORY.style ? `\n\nDESIGN LANGUAGE: ${STORY.style}` : ''}` : `Character reference sheet of ${c.name}: ${c.look}.
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
  for (const p of storyRefs(s)) input.push({type: 'image', mime_type: mimeOf(p), data: await api.readBase64(p)});
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
    response_format: {type: 'video', aspect_ratio: STSET.ratio === '16:9' ? '16:9' : '9:16', resolution: M.resolution(), duration: `${clamp(Math.ceil(Math.max(s.lines.some(l => l.audio) ? voiceLen(s) : 0, s.duration)), 3, 15)}s`, delivery: 'uri'}}, 'Video');
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
      const scr = [], putScreen = k => { for (const x of (s.screen || []).filter(x => x.after === k)) scr.push({t, text: x.text}); };
      for (const [li, l] of s.lines.entries()){
        putScreen(li);
        if (!l.audio || !(await api.exists(l.audio))) continue;
        const it = await libItem(l.audio, 'audio', false); if (!it) continue;
        sc.audios.push({id: uid(), cat: 'voice', path: it.path, name: `${l.speaker}: ${stripTags(l.text).slice(0, 24)}`, dur: it.dur, len: it.dur, start: t, vol: 1, muted: false,
          env: DEF_ENV(), trimIn: 0, fadeIn: 0, fadeOut: 0, loop: false, hasAudio: true, track: 0});
        if (stripTags(l.text)) subs.push({start: t, end: t + it.dur, text: stripTags(l.text)});   // altyazıda etiket görünmez
        t += it.dur + 0.18;
      }
      putScreen(s.lines.length);
      // ekran yazıları (kurguda eklenecek metinler): o anda belirir, okunacak kadar kalır
      const tpl = TEXT_TEMPLATES.find(x => x.name === 'Sinematik') || TEXT_TEMPLATES[0];
      for (const x of scr){
        const d = clamp(x.text.split(/\s+/).length / 2.2 + 0.8, 2, 6);
        sc.cues.push({id: uid(), kind: 'text', start: x.t, end: x.t + d, text: x.text, words: wordsFromText(x.text, x.t, x.t + d), st: {...S, ...tpl.st, posY: 44, maxW: 86, hl: false}});
      }
      const screenEnd = scr.length ? Math.max(...sc.cues.map(c => c.end)) + 0.2 : 0;
      // sahne süresi seslendirmeye göre (sessiz bekleme olmasın); satırı olmayan sahne kendi süresinde kalır
      const voiceEnd = Math.max(subs.length ? t + 0.25 : (scr.length ? 0 : Math.max(2.5, s.duration)), screenEnd);
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
        if (it && len > 0.2) sc.audios.push({id: uid(), cat: 'amb', path: it.path, name: `Ortam: ${(s.ambience || '').slice(0, 24)}`, dur: it.dur, len, start: 0,
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
  // anlatıcı / karakter dengesi (kelime sayısına göre) ve istenen sahne sayısı kontrolü
  const wc = t => stripTags(t).split(/\s+/).filter(Boolean).length;
  const all = STORY.scenes.flatMap(s => s.lines), tw = all.reduce((a, l) => a + wc(l.text), 0) || 1;
  const narr = Math.round(all.filter(l => l.speaker === 'Anlatıcı').reduce((a, l) => a + wc(l.text), 0) / tw * 100);
  const want = (+STORY.parts || 1) * sceneCount(), hist = (STORY.scriptHist || []).length;
  return `<div class="stpreview" id="stPreview">
    <div class="stprevhead"><h3>Senaryo önizlemesi</h3><span class="note">${parts.length > 1 ? parts.length + ' part · ' : ''}${STORY.scenes.length} sahne · yaklaşık ${fmt(tot, 0)}</span>
      <span class="sp"></span><button class="sec sm" id="stScriptUndo" ${hist ? '' : 'disabled'} title="Son düzenlemeden önceki senaryoya dön">↶ Önceki senaryo</button><button class="sec sm" id="stRewrite">Baştan oluştur</button><button class="primary sm" id="stApprove">${STORY.reviewed ? 'Üretime geç' : 'Onayla ve üretime geç'}</button></div>
    <div class="stbal"><span title="Satırlardaki kelime sayısına göre">Anlatıcı %${narr} · Karakterler %${100 - narr}</span>${(() => { const t = VOICE_TARGET[taleOpt().voice]; return t && (narr < t[0] || narr > t[1]) ? `<span class="stwarn">Seçilen anlatım için hedef anlatıcı %${t[0]}–${t[1]}</span>` : ''; })()}${STORY.scenes.length !== want ? `<span class="stwarn">İstenen ${want} sahne, gelen ${STORY.scenes.length}</span>` : ''}</div>
    <div class="strefine">
      <div class="stchips">${SCRIPT_REFINES.map((r, i) => `<button class="stchip" data-sref="${i}" title="${esc(r[1])}">${r[0]}</button>`).join('')}</div>
      <div class="row"><input type="text" id="stScriptIn" placeholder="Senaryoya not (ör. 3. sahnede Kerem daha sinirli olsun, anlatıcıyı azalt)"><button class="sec sm" id="stScriptGo">Uygula</button><button class="sec sm" id="stShowNotePrompt" title="Bu notla gidecek senaryo düzenleme promptunu gösterir">Prompt</button></div>
      <p class="note">Değişmeyen sahnelerin üretilmiş sesi, görseli ve videosu korunur. Tek bir sahneyi değiştirmek için sahnedeki ✎'e bas.</p>
    </div>
    ${STORY.title ? `<div class="sttitle">${esc(STORY.title)}</div>` : ''}
    ${STORY.style ? `<p class="note"><b>Görsel stil:</b> ${esc(STORY.style)}</p>` : ''}
    ${STORY.characters.length ? `<p class="note"><b>Karakterler:</b> ${STORY.characters.map(c => esc(c.name)).join(', ')}</p>` : ''}
    ${parts.map(p => { const ps = STORY.scenes.filter(s => (s.part || 1) === p);
      return `${parts.length > 1 ? `<div class="stpart">Part ${p} <span class="note">${ps.length} sahne · yaklaşık ${fmt(ps.reduce((a, s) => a + estDur(s), 0), 0)}</span></div>` : ''}
      ${ps.map(s => { n++; return `<div class="stprev"><div class="stprevs"><b>Sahne ${n}</b> <span class="note">~${Math.round(estDur(s))} sn</span> — ${esc(s.summary)}<button class="ic stedit" data-sedit="${s.id}" title="Bu sahneyi yeniden yaz">✎</button></div>
        ${openEdit.has(s.id) ? `<div class="row stsedit"><input type="text" data-snote="${s.id}" placeholder="Ne değişsin? (boş bırakırsan daha etkileyici yazılır)"><button class="sec sm" data-sgo="${s.id}">Yeniden yaz</button><button class="sec sm" data-sprompt="${s.id}">Prompt</button></div>` : ''}
        ${[...s.lines.map((l, li) => [...(s.screen || []).filter(x => x.after === li).map(x => `<div class="stprevl stscr">🖥 ${esc(x.text)}</div>`), `<div class="stprevl"><span class="stspk">${esc(l.speaker)}:</span> ${line(l.text)}</div>`].join('')),
          ...(s.screen || []).filter(x => x.after >= s.lines.length).map(x => `<div class="stprevl stscr">🖥 ${esc(x.text)}</div>`)].join('')}
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
// görsel stil seçimi (Hikâye ve Senaryo sekmesinde ortak)
const styleSel = () => {
  if (STORY.styleAuto !== false) return 'auto';
  const i = STYLE_PRESETS.findIndex(p => p[1] + STYLE_TAIL === STORY.style);
  return i >= 0 ? String(i) : 'custom';
};
const styleSelectHtml = id => `<select id="${id}"><option value="auto" ${styleSel() === 'auto' ? 'selected' : ''}>Otomatik (hikâyeye göre)</option>${STYLE_PRESETS.map((p, i) => `<option value="${i}" ${styleSel() === String(i) ? 'selected' : ''}>${p[0]}</option>`).join('')}<option value="custom" ${styleSel() === 'custom' ? 'selected' : ''}>Özel (kendi tarifim)</option></select>`;
function onStyleSelect(v){
  if (v === 'auto') STORY.styleAuto = true;
  else { STORY.styleAuto = false; if (v !== 'custom') STORY.style = STYLE_PRESETS[+v][1] + STYLE_TAIL; }
  dirty = true; keepScroll();
}
function keepScroll(){ const b = $('storyBody'), y = b.scrollTop; renderStory(); b.scrollTop = y; }
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
    const L = lenOf(), per = sceneCount(), words = (STORY.story || '').split(/\s+/).filter(Boolean).length, o = taleOpt(), hist = STORY.hist || [];
    box.innerHTML = `
      <div class="stcols stcols-story"><div>
      <h3>Fikir</h3>
      <textarea id="stInput" rows="5" placeholder="Hikâyenin fikrini, kısa özetini veya taslağını yaz… (ör. Alp iki ekmek alıp eve gidiyor)">${esc(STORY.input)}</textarea>
      <div class="row"><button class="sec sm" id="stPitch" title="Fikrin için birbirinden farklı 3 yön önerir; birini seçip hikâyeyi ona göre yazdırırsın">3 farklı yaklaşım öner</button><button class="sec sm" id="stImport" title="Hazır bir üretim dosyasını (PDF, Word, metin) içe aktarır: karakterler, sahneler, görsel/video promptları, seslendirme ve ekran yazıları doğrudan eklenir">Üretim dosyası içe aktar (PDF)</button></div>
      ${(STORY.pitches || []).length ? `<div class="stpitches">${STORY.pitches.map((p, i) => `<div class="stpitch"><b>${esc(p.title || 'Yaklaşım ' + (i + 1))}</b><p>${esc(p.logline || '')}</p>
        ${p.hook ? `<p class="note"><b>Açılış:</b> ${esc(p.hook)}</p>` : ''}${p.twist ? `<p class="note"><b>Dönüm noktası:</b> ${esc(p.twist)}</p>` : ''}
        <button class="sec sm" data-pitch="${i}">Bunu kullan</button></div>`).join('')}</div>` : ''}
      <h3>Uzunluk</h3>
      <div class="stlens">${LENGTHS.map(l => `<button class="stlen ${l.id === L.id ? 'on' : ''}" data-len="${l.id}"><b>${l.name}</b><span>~${lenTxt(l)}</span><small>${l.scenes} sahne</small></button>`).join('')}</div>
      <label>Kaç part?<select id="stParts">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === (+STORY.parts || 1) ? 'selected' : ''}>${n === 1 ? 'Tek part' : n + ' part'}</option>`).join('')}</select></label>
      <label>${(+STORY.parts || 1) > 1 ? 'Her partta kaç sahne?' : 'Kaç sahne?'}<select id="stCount">${['auto', 3, 4, 5, 6, 8, 10, 12, 15, 18, 24].map(n => `<option value="${n}" ${String(n) === String(STORY.count || 'auto') ? 'selected' : ''}>${n === 'auto' ? `Uzunluğa göre (${L.scenes})` : n}</option>`).join('')}</select></label>
      <p class="note">${(+STORY.parts || 1) > 1 ? `${STORY.parts} part × ${per} sahne · part başına` : `${per} sahne ·`} yaklaşık ${lenTxt(L)}, sahne başına ~${Math.round(L.sec / per)} sn.</p>
      <h3>Hikâye tarzı</h3>
      <div class="stchips">${TALE_PRESETS.map((p, i) => `<button class="stchip ${Object.entries(p[1]).every(([k, v]) => String(o[k]) === v) ? 'on' : ''}" data-tpreset="${i}" title="Hazır tarz: birkaç ayarı birden seçer">${p[0]}</button>`).join('')}</div>
      ${Object.entries(TALE_OPTS).map(([k, [label, vals]]) => `<label>${label}<select data-tale="${k}">${vals.map(v => `<option value="${v[0]}" ${String(o[k]) === v[0] ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></label>`).join('')}
      <p class="note">${esc(taleDir('voice').replace(/^ANLATIM — /, ''))}</p>
      <textarea id="stNotes" rows="2" placeholder="Özel istekler (ör. mekân İstanbul olsun, sonda kimse ölmesin, köpek de olsun)">${esc(o.notes)}</textarea>
      <label>Görsel stil${styleSelectHtml('stStyleSel')}</label>
      <label>Editör gözden geçirsin<input type="checkbox" id="stPolish" ${STORY.polish !== false ? 'checked' : ''}></label>
      <p class="note">Açıkken hikâye önce taslak olarak yazılır, sonra bir editör gibi kontrol listesiyle gözden geçirilip iyileştirilir (daha iyi sonuç, yaklaşık iki kat süre).</p>
      <div class="row stwrite"><button class="primary" id="stStoryWrite">${STORY.story ? 'Hikâyeyi yeniden yaz' : 'Hikâyeyi yaz'}</button><button class="sec sm" id="stShowStoryPrompt" title="Gemini'ye gidecek hikâye promptunun tamamını gösterir">Promptu göster</button></div>
      </div><div>
      <h3>Hikâye ${STORY.title ? `· ${esc(STORY.title)}` : ''}</h3>
      <textarea id="stStory" class="ststory" placeholder="Hikâye burada çıkar; istediğin gibi düzenle. Kendi hikâyeni de doğrudan buraya yapıştırabilirsin.">${esc(STORY.story || '')}</textarea>
      <div class="strefine">
        <div class="stchips">${STORY_REFINES.map((r, i) => `<button class="stchip" data-refine="${i}" title="${esc(r[1])}" ${STORY.story ? '' : 'disabled'}>${r[0]}</button>`).join('')}</div>
        <div class="row"><input type="text" id="stRefineIn" placeholder="Ne değişsin? (ör. 2. bölüm daha gergin olsun, sonu yumuşat)"><button class="sec sm" id="stRefineGo" ${STORY.story ? '' : 'disabled'}>İyileştir</button><button class="sec sm" id="stShowRefinePrompt" ${STORY.story ? '' : 'disabled'} title="Bu notla gidecek iyileştirme promptunu gösterir">Prompt</button><button class="sec sm" id="stUndo" ${hist.length ? '' : 'disabled'} title="Yazdırmadan veya iyileştirmeden önceki hâline dön">↶ Önceki sürüm${hist.length ? ` (${hist.length})` : ''}</button></div>
      </div>
      <div class="row stfoot"><span class="note">${words ? `${words} kelime · sesli okununca ~${Math.round(words / 2.4)} sn` : ''}</span><span class="sp"></span>
        <button class="sec sm" id="stShowScriptPrompt" ${storySource() ? '' : 'disabled'} title="Sahnelere bölerken gidecek senaryo promptunun tamamını gösterir">Senaryo promptunu göster</button>
        <button class="primary" id="stToScenes" ${storySource() ? '' : 'disabled'}>${STORY.scenes.length ? 'Sahneleri yeniden oluştur →' : 'Sahnelere böl →'}</button></div>
      </div></div>`;
    $('stInput').oninput = e => { STORY.input = e.target.value; dirty = true; };
    $('stStory').oninput = e => { STORY.story = e.target.value; dirty = true; $('stToScenes').disabled = !storySource(); };
    $('stCount').onchange = e => { STORY.count = e.target.value; dirty = true; renderStory(); };
    $('stParts').onchange = e => { STORY.parts = +e.target.value; dirty = true; renderStory(); };
    box.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { STORY.length = b.dataset.len; dirty = true; renderStory(); });
    box.querySelectorAll('[data-tale]').forEach(sl => sl.onchange = () => { STORY.opt = {...taleOpt(), [sl.dataset.tale]: sl.value}; dirty = true; keepScroll(); });
    box.querySelectorAll('[data-tpreset]').forEach(b => b.onclick = () => { STORY.opt = {...TALE_DEF, notes: taleOpt().notes, ...TALE_PRESETS[+b.dataset.tpreset][1]}; dirty = true; keepScroll(); });
    $('stNotes').oninput = e => { STORY.opt = {...taleOpt(), notes: e.target.value}; dirty = true; };
    $('stStyleSel').onchange = e => onStyleSelect(e.target.value);
    $('stPolish').onchange = e => { STORY.polish = e.target.checked; dirty = true; };
    $('stPitch').onclick = suggestPitches;
    $('stImport').onclick = importProduction;
    box.querySelectorAll('[data-pitch]').forEach(b => b.onclick = () => {
      const p = STORY.pitches[+b.dataset.pitch];
      STORY.input = [p.title && `${p.title}.`, p.logline, p.hook && `Açılış: ${p.hook}`, p.twist && `Dönüm noktası: ${p.twist}`].filter(Boolean).join(' ');
      STORY.pitches = []; dirty = true; renderStory(); toast('Yaklaşım fikre yazıldı; şimdi "Hikâyeyi yaz".');
    });
    box.querySelectorAll('[data-refine]').forEach(b => b.onclick = () => refineStory(STORY_REFINES[+b.dataset.refine][1]));
    $('stRefineGo').onclick = () => refineStory($('stRefineIn').value);
    $('stRefineIn').onkeydown = e => { if (e.key === 'Enter') refineStory(e.target.value); };
    $('stUndo').onclick = undoStory;
    $('stShowStoryPrompt').onclick = () => showPrompt('Hikâye promptu', STORY.polish !== false
      ? `1) TASLAK PROMPTU\n\n${storyDraftPrompt()}\n\n────────────────────────\n2) EDİTÖR PROMPTU (taslak yazılınca bu promptla gözden geçirilir)\n\n${storyPolishPrompt('<1. adımda yazılan taslak buraya gelir>')}`
      : storyDraftPrompt());
    $('stShowRefinePrompt').onclick = () => showPrompt('İyileştirme promptu', refineStoryPrompt($('stRefineIn').value.trim() || '<yazdığın not veya tıkladığın öneri buraya gelir>'));
    $('stShowScriptPrompt').onclick = () => showPrompt('Senaryo promptu (Sahnelere böl)', scriptPrompt());
    $('stStoryWrite').onclick = () => { if (STORY.story && !confirm('Mevcut hikâye yenisiyle değiştirilecek ("↶ Önceki sürüm" ile geri dönebilirsin). Devam edilsin mi?')) return; writeStory(); };
    $('stToScenes').onclick = () => { if (STORY.scenes.length && !confirm('Mevcut sahneler yenileriyle değiştirilecek. Devam edilsin mi?')) return; writeScript(); };
    return;
  }
  if (storyTab === 'script'){
    box.innerHTML = `
      <div class="stcols"><div>
      ${STORY.scenes.length ? '' : `<p class="note">Henüz sahne yok. Hikâye sekmesinde hikâyeyi yazıp "Sahnelere böl"e bas.</p>`}
      <button class="sec" id="stBack">← Hikâyeye dön</button>
      <h3>Görsel stil</h3>
      <label>Stil${styleSelectHtml('stStyleSel2')}</label>
      <textarea id="stStyle" rows="5" placeholder="${STORY.styleAuto !== false ? 'Senaryo yazılınca hikâyeye uygun stil burada çıkar' : 'Görsel stili tarif et (İngilizce önerilir)'}">${esc(STORY.style)}</textarea>
      <p class="note">${STORY.styleAuto !== false ? 'Otomatik: stil her senaryoda hikâyenin türüne ve havasına göre belirlenir (teknik, renk paleti, ışık, kamera dili). Hazır bir stil seçebilir veya kutuya kendi tarifini yazabilirsin.' : 'Bu stil tüm görsel, karakter ve video promptlarına eklenir.'}</p>
      </div><div>
      <h3>Ek referanslar</h3>
      <p class="note">Karakter görsellerine ek olarak eklemek istediğin referanslar (mekân, nesne). API ile sahne görseli üretirken karakter görselleriyle birlikte kullanılır; Flow'da referansları kendin eklersin.</p>
      <div class="strefs">${STORY.refs.map((p, i) => `<div class="stref"><img src="${fileUrl(p)}"><button class="ic" data-rdel="${i}" title="Kaldır">${ICON.close}</button></div>`).join('')}
        ${STORY.refs.length < 4 ? '<button class="sec sm" id="stRefAdd">Görsel ekle</button>' : ''}</div>
      <h3>Sesler</h3>
      <div class="stchar"><b>Anlatıcı</b>${STORY.narratorDesc ? `<p class="note">${esc(STORY.narratorDesc)}</p>` : ''}${roleHtml('nar')}</div>
      ${STORY.characters.map((c, i) => `<div class="stchar"><b>${esc(c.name)}</b>${c.voiceDesc ? `<p class="note">${esc(c.voiceDesc)}</p>` : ''}
        ${c.voiceOnly ? '<p class="note">Yalnızca ses (görseli yok).</p>' : `<div class="stcharimg">${c.ref ? `<img src="${fileUrl(c.ref)}">` : '<div class="stthumb empty">Görsel yok</div>'}
          <div><div class="stlabel">Karakter görseli ${c.st === 'busy' ? '<span class="stb busy">Üretiliyor…</span>' : c.st === 'wait' ? '<span class="stb wait">Flow\'dan bekleniyor</span>' : c.st === 'err' ? `<span class="stb err" title="${esc(c.err || '')}">Hata</span>` : ''}</div>
            <div class="row">${freeImg() ? `<button class="sec sm" data-capi="${i}">Ücretsiz oluştur</button>` : `<button class="sec sm" data-capi="${i}" ${paidOn() ? '' : 'disabled title="Ücretli API kapalı (Ayarlar → Maliyet)"'}>Nano Banana API (ücretli)</button>`}<button class="sec sm" data-cflow="${i}">Flow için kopyala</button></div>
            <div class="row"><button class="sec sm" data-cfile="${i}">Dosya</button>${c.ref ? `<button class="sec sm" data-cdel="${i}">Kaldır</button><button class="ic" data-cexp="${i}" title="Dışa aktar">⤓</button>` : ''}</div></div></div>
        <textarea data-clook="${i}" rows="${c.sheet ? 4 : 2}">${esc(c.look)}</textarea>`}
        ${roleHtml(i)}</div>`).join('')}
      ${STORY.characters.length && (freeImg() || paidOn()) ? `<button class="sec sm" id="stCharsAll" title="Görseli olmayan karakterleri oluşturur">Tüm karakter görsellerini oluştur${freeImg() ? ' (ücretsiz)' : ' (ücretli)'}</button> ` : ''}${STORY.scenes.length ? '<button class="sec sm" id="stSuggest" title="Senaryodaki ses tariflerine göre ElevenLabs seslerinden uygun olanları seçer">Sesleri senaryoya göre öner</button>' : '<p class="note">Senaryo yazılınca karakterler burada çıkar ve her birine uygun ses otomatik önerilir.</p>'}
      </div></div>
      ${scriptPreview()}`;
    $('stBack').onclick = () => storyShow('story');
    $('stStyle').oninput = e => { STORY.style = e.target.value; dirty = true; STORY.styleAuto = false; $('stStyleSel2').value = styleSel(); };
    $('stStyleSel2').onchange = e => onStyleSelect(e.target.value);
    // senaryo düzenleme: not / öneri ile tümü, tek sahne, önceki senaryo
    if ($('stScriptGo')) $('stScriptGo').onclick = () => rewriteScript($('stScriptIn').value);
    if ($('stScriptIn')) $('stScriptIn').onkeydown = e => { if (e.key === 'Enter') rewriteScript(e.target.value); };
    box.querySelectorAll('[data-sref]').forEach(b => b.onclick = () => rewriteScript(SCRIPT_REFINES[+b.dataset.sref][1]));
    if ($('stScriptUndo')) $('stScriptUndo').onclick = undoScript;
    if ($('stShowNotePrompt')) $('stShowNotePrompt').onclick = () => showPrompt('Senaryo düzenleme promptu', rewriteScriptPrompt($('stScriptIn').value.trim() || '<yazdığın not veya tıkladığın öneri buraya gelir>'));
    box.querySelectorAll('[data-sprompt]').forEach(b => b.onclick = () => { const id = b.dataset.sprompt, inp = box.querySelector(`[data-snote="${id}"]`), i = STORY.scenes.findIndex(x => x.id === id);
      showPrompt(`Sahne ${i + 1} promptu`, rewriteScenePrompt(i, inp ? inp.value : '')); });
    box.querySelectorAll('[data-sedit]').forEach(b => b.onclick = () => { const id = b.dataset.sedit; openEdit.has(id) ? openEdit.delete(id) : openEdit.add(id); keepScroll(); });
    box.querySelectorAll('[data-sgo]').forEach(b => b.onclick = () => { const id = b.dataset.sgo, inp = box.querySelector(`[data-snote="${id}"]`); rewriteScene(STORY.scenes.findIndex(x => x.id === id), inp ? inp.value : ''); });
    box.querySelectorAll('[data-snote]').forEach(inp => inp.onkeydown = e => { if (e.key === 'Enter') rewriteScene(STORY.scenes.findIndex(x => x.id === inp.dataset.snote), inp.value); });
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
    if ($('stCharsAll')) $('stCharsAll').onclick = async () => { if (!freeImg() && !needPaid()) return; for (const c of STORY.characters) if (!c.ref && !c.voiceOnly) await runChar(c); };
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
