const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let ffmpegPath = require('ffmpeg-static');
if (app.isPackaged) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

// Uygulama adı değişti: eski ayar ve önbellek klasörünü (Kurgu Studio) bir kez yeni klasöre taşı
try {
  const oldData = path.join(app.getPath('appData'), 'Kurgu Studio');
  if (fs.existsSync(oldData) && !fs.existsSync(app.getPath('userData'))) fs.cpSync(oldData, app.getPath('userData'), { recursive: true });
} catch (e) { /* taşıma başarısız olursa sıfırdan başlar */ }

let win;
function createWindow(){
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0d0e11', title: 'Reelix',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

/* ---------- Dialoglar ---------- */
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'];
const FILTERS = {
  video: [{ name: 'Video', extensions: VIDEO_EXT }],
  media: [{ name: 'Video ve görsel', extensions: [...VIDEO_EXT, 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'gif'] }],
  audio: [{ name: 'Ses', extensions: [...AUDIO_EXT, ...VIDEO_EXT] }],
  subs: [{ name: 'Altyazı', extensions: ['srt', 'vtt', 'txt'] }],
  project: [{ name: 'Reelix projesi', extensions: ['reelix', 'kurgu', 'json'] }],
  mp4: [{ name: 'MP4 video', extensions: ['mp4'] }],
  srt: [{ name: 'SRT', extensions: ['srt'] }],
  image: [{ name: 'Görsel', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }],
  png: [{ name: 'PNG görsel', extensions: ['png'] }],
  jpg: [{ name: 'JPG görsel', extensions: ['jpg', 'jpeg'] }],
};
ipcMain.handle('open-files', async (_, kind, multi) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters: FILTERS[kind] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('save-file', async (_, kind, defaultName) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: FILTERS[kind] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('pick-folder', async (_, defaultPath) => {
  const r = await dialog.showOpenDialog(win, { defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('videos-dir', () => app.getPath('videos'));
ipcMain.handle('reveal', (_, p) => shell.showItemInFolder(p));

/* ---------- Dosya işlemleri ---------- */
ipcMain.handle('read-file', (_, p) => fs.promises.readFile(p));
ipcMain.handle('read-text', (_, p) => fs.promises.readFile(p, 'utf8'));
ipcMain.handle('write-file', (_, p, data) => fs.promises.writeFile(p, Buffer.from(data)));
ipcMain.handle('write-text', (_, p, text) => fs.promises.writeFile(p, text, 'utf8'));
ipcMain.handle('make-temp', () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'reelix-')));
ipcMain.handle('remove-dir', (_, p) => {
  if (p && p.startsWith(path.join(os.tmpdir(), 'reelix-'))) return fs.promises.rm(p, { recursive: true, force: true });
});
ipcMain.handle('join-path', (_, ...parts) => path.join(...parts));
ipcMain.handle('exists', (_, p) => fs.existsSync(p));
// medya dosyaları uygulamanın kendi klasörüne kopyalanır; kaynak silinse de proje çalışır
const mediaDir = async () => { const d = path.join(app.getPath('userData'), 'Medya'); await fs.promises.mkdir(d, { recursive: true }); return d; };
const copying = new Map();   // aynı dosya aynı anda iki kez kopyalanmasın
ipcMain.handle('import-media', async (_, src) => {
  const dir = await mediaDir();
  if (!src || path.dirname(path.resolve(src)) === dir) return src;
  let st; try { st = await fs.promises.stat(src); } catch (e) { return null; }   // kaynak yok
  if (copying.has(src)) return copying.get(src);
  const job = (async () => {
    const ext = path.extname(src), base = path.basename(src, ext);
    for (let n = 1; ; n++) {
      const dest = path.join(dir, n === 1 ? base + ext : `${base} (${n})${ext}`);
      let ds = null; try { ds = await fs.promises.stat(dest); } catch (e) {}
      if (ds && ds.size === st.size) return dest;          // daha önce kopyalanmış
      if (ds) continue;
      const tmp = dest + '.part';
      await fs.promises.copyFile(src, tmp, fs.constants.COPYFILE_FICLONE);   // APFS'te anında klon, yoksa normal kopya
      await fs.promises.rename(tmp, dest);
      return dest;
    }
  })();
  copying.set(src, job);
  try { return await job; } finally { copying.delete(src); }
});
ipcMain.handle('media-dir', () => mediaDir());
// proje dosyasını aynı klasörde yeniden adlandır
ipcMain.handle('rename-project', async (_, src, name) => {
  const dest = path.join(path.dirname(src), name + path.extname(src));
  if (dest === src) return src;
  if (fs.existsSync(dest)) throw new Error('Bu adda bir proje zaten var');
  await fs.promises.rename(src, dest);
  return dest;
});
// projelerin varsayılan kayıt yeri: uygulamanın kendi veri klasörü
ipcMain.handle('projects-dir', async () => {
  const d = path.join(app.getPath('userData'), 'Projeler');
  await fs.promises.mkdir(d, { recursive: true });
  return d;
});
// altyazı motoru bekçisi için: pencere sürecinin bellek kullanımı (MB)
ipcMain.handle('mem-info', () => {
  const pid = win && win.webContents.getOSProcessId();
  const m = app.getAppMetrics().find(x => x.pid === pid);
  return {procMB: m ? m.memory.workingSetSize / 1024 : 0, totalMB: os.totalmem() / 1048576};
});
ipcMain.handle('cache-dir', async () => {
  const d = path.join(app.getPath('userData'), 'cache');
  await fs.promises.mkdir(d, { recursive: true });
  return d;
});

/* ---------- ffmpeg ---------- */
function parseProbe(stderr){
  const info = { duration: 0, width: 0, height: 0, fps: 30, hasVideo: false, hasAudio: false, rotation: 0 };
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (d) info.duration = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]);
  const v = stderr.match(/Stream #[^\n]*Video:[^\n]*/);
  if (v){
    info.hasVideo = true;
    const s = v[0].match(/,\s*(\d{2,5})x(\d{2,5})/); if (s){ info.width = +s[1]; info.height = +s[2]; }
    const f = v[0].match(/([\d.]+)\s*fps/); if (f) info.fps = parseFloat(f[1]);
  }
  const rot = stderr.match(/rotate\s*:\s*(-?\d+)/) || stderr.match(/rotation of (-?[\d.]+) degrees/);
  if (rot) info.rotation = Math.abs(Math.round(parseFloat(rot[1]))) % 360;
  if (info.rotation === 90 || info.rotation === 270) [info.width, info.height] = [info.height, info.width];
  info.hasAudio = /Stream #[^\n]*Audio:/.test(stderr);
  return info;
}
ipcMain.handle('probe', (_, file) => new Promise((resolve) => {
  const p = spawn(ffmpegPath, ['-hide_banner', '-i', file]);
  let err = '';
  p.stderr.on('data', d => err += d);
  p.on('close', () => resolve(parseProbe(err)));
}));

const jobs = new Map();
ipcMain.handle('ffmpeg', (_, jobId, args, totalDuration) => new Promise((resolve, reject) => {
  const p = spawn(ffmpegPath, ['-hide_banner', '-y', ...args]);
  jobs.set(jobId, p);
  let tail = '';
  p.stderr.on('data', d => {
    const s = d.toString();
    tail = (tail + s).slice(-6000);
    const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g);
    if (m && totalDuration > 0){
      const last = m[m.length - 1].match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const t = (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]);
      win && win.webContents.send('ffmpeg-progress', jobId, Math.min(1, t / totalDuration));
    }
  });
  p.on('error', e => { jobs.delete(jobId); reject(e); });
  p.on('close', (code, signal) => {
    jobs.delete(jobId);
    if (code === 0) resolve(true);
    else if (signal === 'SIGTERM' || signal === 'SIGKILL') reject(new Error('İptal edildi'));
    else reject(new Error(tail.split('\n').filter(Boolean).slice(-6).join('\n')));
  });
}));
ipcMain.handle('ffmpeg-cancel', (_, jobId) => { const p = jobs.get(jobId); if (p) p.kill('SIGTERM'); });


/* ---------- Hikaye otomasyonu: API anahtarları, HTTP, İndirilenler izleme ---------- */
// anahtarlar macOS anahtar zinciriyle şifrelenip uygulama klasöründe saklanır
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
const readSecrets = () => { try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch (e) { return {}; } };
ipcMain.handle('secret-get', (_, name) => {
  const v = readSecrets()[name]; if (!v) return '';
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : ''; } catch (e) { return ''; }
});
ipcMain.handle('secret-set', (_, name, value) => {
  const all = readSecrets();
  if (!value) delete all[name];
  else if (safeStorage.isEncryptionAvailable()) all[name] = safeStorage.encryptString(value).toString('base64');
  else throw new Error('Bu sistemde güvenli saklama kullanılamıyor');
  fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
  return true;
});
// JSON yanıtlı istek (Gemini, ElevenLabs ses listesi)
ipcMain.handle('http-json', async (_, url, opts = {}) => {
  const r = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch (e) { data = text; }
  return { ok: r.ok, status: r.status, data };
});
// ikili yanıtı doğrudan dosyaya yaz (ElevenLabs sesi, Gemini video indirme)
ipcMain.handle('http-file', async (_, url, opts = {}, out) => {
  const r = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body, redirect: 'follow' });
  if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 2000) };
  await fs.promises.writeFile(out, Buffer.from(await r.arrayBuffer()));
  return { ok: true, status: r.status };
});
// akışlı istek (SSE): gelen parçalar 'http-chunk' ile bildirilir; veri gelmeden 90 sn geçerse veya iptal edilirse durur
const streams = new Map();
ipcMain.handle('http-stream', async (_, id, url, opts = {}) => {
  const ac = new AbortController(); streams.set(id, ac);
  let idle = null;
  const lim = opts.idle || 90000;   // bu kadar süre hiç veri gelmezse dur
  const kick = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort('timeout'), lim); };
  try {
    kick();
    const r = await fetch(url, { method: opts.method || 'POST', headers: opts.headers || {}, body: opts.body, signal: ac.signal });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 2000) };
    const reader = r.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      kick();
      win && win.webContents.send('http-chunk', id, dec.decode(value, { stream: true }));
    }
    return { ok: true, status: r.status };
  } catch (e) {
    const why = ac.signal.reason;
    return { ok: false, status: 0, error: why === 'timeout' ? `${Math.round(lim / 1000)} saniyedir yanıt gelmiyor (zaman aşımı)` : why === 'cancel' ? 'İptal edildi' : String(e.message || e) };
  } finally { clearTimeout(idle); streams.delete(id); }
});
ipcMain.handle('http-abort', (_, id) => { const ac = streams.get(id); if (ac) ac.abort('cancel'); });
// macOS: tarayıcının açamadığı görselleri (HEIC/HEIF/TIFF) JPEG'e çevir
ipcMain.handle('image-to-jpeg', (_, src, out) => new Promise((resolve, reject) => {
  const p = spawn('sips', ['-s', 'format', 'jpeg', src, '--out', out]);
  let err = ''; p.stderr.on('data', d => err += d);
  p.on('error', reject);
  p.on('close', code => code === 0 && fs.existsSync(out) ? resolve(out) : reject(new Error(err.trim() || 'Görsel çevrilemedi')));
}));
ipcMain.handle('mkdirp', (_, p) => fs.promises.mkdir(p, { recursive: true }));
ipcMain.handle('copy-file', (_, src, dest) => fs.promises.copyFile(src, dest));
ipcMain.handle('write-base64', (_, p, b64) => fs.promises.writeFile(p, Buffer.from(b64, 'base64')));
ipcMain.handle('read-base64', async (_, p) => (await fs.promises.readFile(p)).toString('base64'));
ipcMain.handle('open-external', (_, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('clipboard-write', (_, text) => clipboard.writeText(String(text)));
// İndirilenler: yeni inen görsel/video dosyasını bildir (indirme bitince, boyut sabitlenince)
let dlWatcher = null;
const DL_EXT = /\.(png|jpe?g|webp|mp4|mov|m4v|webm)$/i;
ipcMain.handle('downloads-watch', (_, on) => {
  if (!on){ if (dlWatcher){ dlWatcher.close(); dlWatcher = null; } return; }
  if (dlWatcher) return;
  const dir = app.getPath('downloads'), seen = new Set(fs.readdirSync(dir));
  dlWatcher = fs.watch(dir, (ev, name) => {
    if (!name || seen.has(name) || !DL_EXT.test(name)) return;
    const p = path.join(dir, name);
    let last = -1, tries = 0;
    const check = () => {
      fs.stat(p, (err, st) => {
        if (err){ if (++tries < 20) setTimeout(check, 500); return; }
        if (st.size > 0 && st.size === last){ seen.add(name); win && win.webContents.send('download-added', p); return; }
        last = st.size; if (++tries < 240) setTimeout(check, 700);
      });
    };
    setTimeout(check, 400);
  });
});
