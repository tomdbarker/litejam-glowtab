import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';

const PRESET = { onset: 0.5, frame: 0.3, minFrames: 5 };
let backendPromise;
let basicPitchPromise;

export async function initializeTranscriber({ wasmPath = '/vendor/audio-to-midi/tfjs-wasm/', model } = {}) {
  if (!backendPromise) {
    backendPromise = (async () => {
      setWasmPaths(wasmPath);
      for (const backend of ['wasm', 'webgl', 'cpu']) {
        try {
          if (!(await tf.setBackend(backend))) continue;
          await tf.ready();
          if (backend === 'webgl' && !tf.env().getBool('WEBGL_RENDER_FLOAT32_CAPABLE')) continue;
          if (backend === 'wasm') {
            const fill = tf.getKernel('Fill', 'wasm');
            if (fill) {
              tf.unregisterKernel('Fill', 'wasm');
              tf.registerKernel({
                ...fill,
                kernelFunc: (args) => fill.kernelFunc({
                  ...args,
                  attrs: { ...args.attrs, dtype: args.attrs.dtype ?? 'float32' },
                }),
              });
            }
          }
          return backend;
        } catch {
          // Try the next available TensorFlow.js backend.
        }
      }
      throw new Error('No supported TensorFlow.js backend is available.');
    })();
  }
  const backend = await backendPromise;
  if (!basicPitchPromise) {
    const modelPromise = model
      ? typeof model.execute === 'function' ? Promise.resolve(model) : tf.loadGraphModel(model)
      : tf.loadGraphModel('/vendor/audio-to-midi/model/model.json');
    basicPitchPromise = Promise.resolve(modelPromise).then((loadedModel) => new BasicPitch(Promise.resolve(loadedModel)));
  }
  await basicPitchPromise;
  return backend;
}

export async function transcribeMono(audio, onProgress = () => {}) {
  if (!basicPitchPromise) await initializeTranscriber();
  const basicPitch = await basicPitchPromise;
  const frames = [];
  const onsets = [];
  const contours = [];
  await basicPitch.evaluateModel(
    audio,
    (frame, onset, contour) => {
      frames.push(...frame);
      onsets.push(...onset);
      contours.push(...contour);
    },
    onProgress,
  );
  const detected = outputToNotesPoly(frames, onsets, PRESET.onset, PRESET.frame, PRESET.minFrames);
  const bent = addPitchBendsToNoteEvents(contours, detected);
  const notes = noteFramesToTime(bent).map((note) => ({
    startSec: note.startTimeSeconds,
    durationSec: note.durationSeconds,
    midi: note.pitchMidi,
    amplitude: note.amplitude,
  }));
  return { notes, backend: await backendPromise };
}
