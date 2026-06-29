import { createModel, type KaldiRecognizer, type Model } from 'vosk-browser'

export interface SttSnapshot {
  finalText: string
  interimText: string
  finished: boolean
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void
  close(): void
}

const MODEL_URL = '/models/vosk-model-small-en-us-0.15.tar.gz'
const SAMPLE_RATE = 16000
const MAX_BUFFERED_SAMPLES = SAMPLE_RATE * 10

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleCount = bytes.byteLength >> 1
  const out = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768
  }
  return out
}

export function startSttStream(
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
): SttClient {
  let model: Model | null = null
  let recognizer: KaldiRecognizer | null = null
  let ready = false
  let closed = false
  let pending: Float32Array[] = []
  let pendingSamples = 0

  function flushPending() {
    if (!recognizer) return
    for (const chunk of pending) {
      recognizer.acceptWaveformFloat(chunk, SAMPLE_RATE)
    }
    pending = []
    pendingSamples = 0
  }

  void (async () => {
    try {
      model = await createModel(MODEL_URL)
      if (closed) { model.terminate(); return }
      recognizer = new model.KaldiRecognizer(SAMPLE_RATE)
      recognizer.setWords(true)
      recognizer.on('result', (msg: unknown) => {
        const text = ((msg as { result?: { text?: string } }).result?.text ?? '').trim()
        if (text) onSnapshot({ finalText: text, interimText: '', finished: false })
      })
      recognizer.on('partialresult', (msg: unknown) => {
        const partial = ((msg as { result?: { partial?: string } }).result?.partial ?? '').trim()
        if (partial) onSnapshot({ finalText: '', interimText: partial, finished: false })
      })
      recognizer.on('error', (msg: unknown) => {
        onError?.((msg as { error?: string }).error ?? 'recognizer error')
      })
      ready = true
      flushPending()
    } catch (err) {
      onError?.(err)
    }
  })()

  return {
    sendPcm(chunk) {
      if (closed) return
      const float = pcm16ToFloat32(chunk)
      if (ready && recognizer) {
        recognizer.acceptWaveformFloat(float, SAMPLE_RATE)
        return
      }
      pending.push(float)
      pendingSamples += float.length
      while (pendingSamples > MAX_BUFFERED_SAMPLES && pending.length > 1) {
        const dropped = pending.shift()
        pendingSamples -= dropped ? dropped.length : 0
      }
    },
    close() {
      closed = true
      try { recognizer?.remove() } catch { /* ignore */ }
      try { model?.terminate() } catch { /* ignore */ }
      onSnapshot({ finalText: '', interimText: '', finished: true })
    },
  }
}
