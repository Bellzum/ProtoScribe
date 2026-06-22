// Speech-to-text client for the G2 microphone.
//
// The G2 mic emits PCM s16le @ 16 kHz, mono via `bridge.audioControl(true)`.
// Each onEvenHubEvent callback with `audioEvent.audioPcm` delivers a chunk.
//
// ─────────────────────────────────────────────────────────────────────
// choose your own implementation here
// ─────────────────────────────────────────────────────────────────────
// Pick whichever STT provider you prefer — streaming or batch, hosted
// or self-hosted — and implement the three functions below. The rest
// of the scaffold (main.ts, ui.ts) already wires the mic into
// `sendPcm` and renders whatever `onSnapshot` emits.
//
// Treat each snapshot as a full transcript state, not a delta:
//   - finalText: text the provider is confident about
//   - interimText: unstable tail that may still change
//   - finished: true on the terminal message, after which no more
//     snapshots will be emitted
//
// Don't forget to add a `network` permission to app.json with your
// provider's hosts in the `whitelist` array once you wire this up.
// `evenhub pack` rejects an empty whitelist, which is why the default
// app.json omits the `network` entry entirely.
// ─────────────────────────────────────────────────────────────────────

import { API_BASE_URL, STT_LANGUAGE, STT_PROVIDER } from '../lib/config'

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

interface SpeechRecognitionResultItem {
  transcript: string
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionResultItem
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: Event & { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

export interface SttSnapshot {
  finalText: string
  interimText: string
  finished: boolean
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void
  close(): void
}

const SILENCE_THRESHOLD = 650
const SILENCE_MS = 900
const MIN_AUDIO_BYTES = 16_000

function mergeChunks(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

function pcmToWav(pcm: Uint8Array, sampleRate = 16_000) {
  const wav = new ArrayBuffer(44 + pcm.length)
  const view = new DataView(wav)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, pcm.length, true)
  new Uint8Array(wav, 44).set(pcm)

  return wav
}

function averageAmplitude(chunk: Uint8Array) {
  if (chunk.length < 2) {
    return 0
  }

  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  let total = 0
  let sampleCount = 0

  for (let offset = 0; offset < chunk.byteLength; offset += 2) {
    total += Math.abs(view.getInt16(offset, true))
    sampleCount += 1
  }

  return Math.round(total / Math.max(1, sampleCount))
}

function createBrowserSpeechClient(
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
): SttClient {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
  if (!Recognition) {
    throw new Error('Browser speech recognition is not available in this environment.')
  }

  const recognition = new Recognition()
  let closed = false

  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = STT_LANGUAGE
  recognition.onresult = event => {
    let interim = ''

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const transcript = result[0]?.transcript?.trim() ?? ''
      if (!transcript) {
        continue
      }

      if (result.isFinal) {
        onSnapshot({
          finalText: transcript,
          interimText: '',
          finished: true,
        })
        continue
      }

      interim += `${transcript} `
    }

    if (interim.trim()) {
      onSnapshot({
        finalText: '',
        interimText: interim.trim(),
        finished: false,
      })
    }
  }

  recognition.onerror = event => {
    onError?.(new Error(event.error ?? 'Browser speech recognition failed.'))
  }

  recognition.onend = () => {
    if (!closed) {
      recognition.start()
    }
  }

  recognition.start()

  return {
    sendPcm() {},
    close() {
      closed = true
      recognition.stop()
    },
  }
}

function createBufferedBackendClient(
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
): SttClient {
  const chunks: Uint8Array[] = []
  let capturing = false
  let closed = false
  let uploading = false
  let lastSpeechAt = 0

  const flush = async () => {
    if (uploading || !chunks.length) {
      return
    }

    const merged = mergeChunks(chunks)
    chunks.length = 0
    capturing = false

    if (merged.byteLength < MIN_AUDIO_BYTES) {
      onSnapshot({ finalText: '', interimText: '', finished: false })
      return
    }

    uploading = true
    try {
      const wav = pcmToWav(merged)
      const formData = new FormData()
      formData.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav')

      const response = await fetch(`${API_BASE_URL}/api/stt/transcribe`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const payload = (await response.json()) as { text?: string }
      const transcript = payload.text?.trim() ?? ''
      if (transcript) {
        onSnapshot({
          finalText: transcript,
          interimText: '',
          finished: true,
        })
      }
    } catch (error) {
      onError?.(error)
    } finally {
      uploading = false
    }
  }

  const timer = window.setInterval(() => {
    if (!capturing || closed) {
      return
    }

    if (Date.now() - lastSpeechAt >= SILENCE_MS) {
      void flush()
    }
  }, 250)

  return {
    sendPcm(chunk: Uint8Array) {
      if (closed) {
        return
      }

      const amplitude = averageAmplitude(chunk)
      if (!capturing && amplitude < SILENCE_THRESHOLD) {
        return
      }

      if (!capturing) {
        onSnapshot({ finalText: '', interimText: 'capturing voice…', finished: false })
      }

      capturing = true
      lastSpeechAt = amplitude >= SILENCE_THRESHOLD ? Date.now() : lastSpeechAt
      chunks.push(chunk)
    },
    close() {
      closed = true
      window.clearInterval(timer)
      void flush()
    },
  }
}

export function startSttStream(
  apiKey: string,
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
): SttClient {
  void apiKey

  if (STT_PROVIDER === 'browser') {
    return createBrowserSpeechClient(onSnapshot, onError)
  }

  return createBufferedBackendClient(onSnapshot, onError)
}
