const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFiles: (kind, multi) => ipcRenderer.invoke('open-files', kind, multi),
  saveFile: (kind, name) => ipcRenderer.invoke('save-file', kind, name),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  reveal: p => ipcRenderer.invoke('reveal', p),
  readFile: p => ipcRenderer.invoke('read-file', p),
  readText: p => ipcRenderer.invoke('read-text', p),
  writeFile: (p, data) => ipcRenderer.invoke('write-file', p, data),
  writeText: (p, t) => ipcRenderer.invoke('write-text', p, t),
  makeTemp: () => ipcRenderer.invoke('make-temp'),
  removeDir: p => ipcRenderer.invoke('remove-dir', p),
  joinPath: (...a) => ipcRenderer.invoke('join-path', ...a),
  probe: p => ipcRenderer.invoke('probe', p),
  exists: p => ipcRenderer.invoke('exists', p),
  cacheDir: () => ipcRenderer.invoke('cache-dir'),
  ffmpeg: (id, args, dur) => ipcRenderer.invoke('ffmpeg', id, args, dur),
  ffmpegCancel: id => ipcRenderer.invoke('ffmpeg-cancel', id),
  onProgress: cb => ipcRenderer.on('ffmpeg-progress', (_, id, p) => cb(id, p)),
  pathForFile: f => webUtils.getPathForFile(f),
});
