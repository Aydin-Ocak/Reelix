/* Altyazı motoru (Whisper) — arayüz donmasın ve gerekirse tamamen kapatılabilsin diye ayrı iş parçacığında çalışır */
let pipe = null, model = '';
self.onmessage = async e => {
  const {id, type} = e.data;
  try {
    if (type === 'load'){
      if (!pipe || model !== e.data.model){
        const {pipeline} = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2');
        pipe = await pipeline('automatic-speech-recognition', e.data.model, {
          progress_callback: p => self.postMessage({id, type: 'progress', p: {status: p.status, progress: p.progress, file: p.file}})
        });
        model = e.data.model;
      }
      self.postMessage({id, type: 'done'});
    } else if (type === 'run'){
      const out = await pipe(e.data.audio, e.data.opts);
      self.postMessage({id, type: 'done', result: {text: out.text, chunks: out.chunks}});
    }
  } catch (err){
    self.postMessage({id, type: 'error', message: (err && err.message) || String(err)});
  }
};
