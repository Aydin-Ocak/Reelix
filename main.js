const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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
  audio: [{ name: 'Ses', extensions: [...AUDIO_EXT, ...VIDEO_EXT] }],
  subs: [{ name: 'Altyazı', extensions: ['srt', 'vtt', 'txt'] }],
  project: [{ name: 'Reelix projesi', extensions: ['reelix', 'kurgu', 'json'] }],
  mp4: [{ name: 'MP4 video', extensions: ['mp4'] }],
  srt: [{ name: 'SRT', extensions: ['srt'] }],
};
ipcMain.handle('open-files', async (_, kind, multi) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters: FILTERS[kind] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('save-file', async (_, kind, defaultName) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: FILTERS[kind] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
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
