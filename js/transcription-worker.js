import { initializeTranscriber, transcribeMono } from './transcription-inference.js';

self.addEventListener('message', async (event) => {
  const { id, audio } = event.data ?? {};
  if (!id || !(audio instanceof Float32Array)) return;
  try {
    const backend = await initializeTranscriber();
    const result = await transcribeMono(audio, (progress) => {
      self.postMessage({ id, type: 'progress', progress });
    });
    self.postMessage({ id, type: 'result', backend, ...result });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error?.message ?? String(error) });
  }
});
