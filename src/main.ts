import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

import { startSttStream, type SttClient } from './asr/stt'
import { describeCommand, parseVoiceCommand } from './lib/commands'
import type { AppState, ObservationRecord, ProtocolStep, SessionRecord, StatusKind, VoiceCommand } from './lib/types'
import protocol from './protocol.json'
import { mountUi, renderUi, setTranscript } from './ui'

const ACTIVE_SESSION_KEY = 'protoscribe.session'
const GLASSES_CONTAINER_ID = 1
const GLASSES_CONTAINER_NAME = 'main'

function createDefaultSession(): SessionRecord {
  return {
    active: false,
    currentStepIndex: 1,
    observations: [],
    startedAt: null,
    endedAt: null,
  }
}

const state: AppState = {
  protocol,
  currentSession: createDefaultSession(),
  lastTranscript: '',
  lastCommand: 'awaiting command',
  statusKind: 'connecting',
  statusText: 'Preparing Even Hub bridge and microphone…',
  providerLabel: 'Deepgram · G2 mic',
}

let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null
let sttClient: SttClient | null = null
let cleanedUp = false
let notePreviewTimer: number | null = null
let renderTimer: number | null = null
let pendingGlassesContent = ''
let lastGlassesContent = ''
let overlayMode: 'none' | 'last-note' | 'summary' = 'none'

function currentStep() {
  const stepIndex = state.currentSession.currentStepIndex
  return state.protocol.steps.find(step => step.index === stepIndex) ?? state.protocol.steps[0]
}

function getLatestObservation() {
  const notes = state.currentSession?.observations ?? []
  return notes[notes.length - 1] ?? null
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`
}

function wrapLine(text: string, width = 30) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > width && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

function glassesText() {
  const step = currentStep()
  const totalSteps = state.protocol.steps.length

  if (!step) {
    return [
      'PROTOSCRIBE  BSL-3',
      'Ready',
      '',
      'Loading protocol...',
      '',
      'Say: start session',
    ].join('\n')
  }

  const lines = [
    'PROTOSCRIBE  BSL-3',
    `Step ${step.index}/${totalSteps}`,
    truncateText(step.title.toUpperCase(), 30),
    '',
    ...wrapLine(step.action, 30).slice(0, 5),
    '',
    'Say: next / back / note',
  ]

  return truncateText(lines.join('\n'), 480)
}

async function renderGlassesNow(content: string) {
  if (!bridge) {
    return
  }

  if (!content || content === lastGlassesContent) {
    return
  }

  lastGlassesContent = content
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: GLASSES_CONTAINER_ID,
      containerName: GLASSES_CONTAINER_NAME,
      content,
    }),
  )
}

function renderGlasses() {
  pendingGlassesContent = glassesText()
  if (renderTimer !== null) {
    return
  }

  renderTimer = window.setTimeout(() => {
    renderTimer = null
    void renderGlassesNow(pendingGlassesContent)
  }, 120)
}

function renderLastNotePreview() {
  const note = getLatestObservation()
  if (!note) {
    return [
      'LAST NOTE',
      '',
      'No saved note yet.',
      '',
      'Say: note <speech>',
    ].join('\n')
  }

  return truncateText(
    [
      'LAST NOTE',
      `Step ${note.stepIndex}`,
      '',
      ...wrapLine(note.transcript, 30).slice(0, 5),
    ].join('\n'),
    480,
  )
}

function renderSummaryText() {
  return truncateText(
    [
      'SESSION COMPLETE',
      `Steps reached ${state.currentSession.currentStepIndex}/${state.protocol.steps.length}`,
      `Notes saved ${state.currentSession.observations.length}`,
      '',
      state.currentSession.startedAt ? `Started ${new Date(state.currentSession.startedAt).toLocaleTimeString()}` : '',
      state.currentSession.endedAt ? `Ended ${new Date(state.currentSession.endedAt).toLocaleTimeString()}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    480,
  )
}

function flashSavedNote(transcript: string, stepIndex: number) {
  const lines = [
    'NOTE SAVED',
    `Step ${stepIndex}`,
    '',
    ...wrapLine(transcript, 30).slice(0, 5),
  ]
  void renderGlassesNow(truncateText(lines.join('\n'), 480))

  if (notePreviewTimer !== null) {
    window.clearTimeout(notePreviewTimer)
  }

  notePreviewTimer = window.setTimeout(() => {
    notePreviewTimer = null
    overlayMode = 'none'
    render()
  }, 2000)
}

function updateStatus(kind: StatusKind, text: string) {
  state.statusKind = kind
  state.statusText = text
  render()
}

async function persistSessionState() {
  const serialized = JSON.stringify(state.currentSession)

  try {
    if (bridge) {
      await bridge.setLocalStorage(ACTIVE_SESSION_KEY, serialized)
      return
    }
  } catch (error) {
    console.warn('Bridge local storage unavailable:', error)
  }

  window.localStorage.setItem(ACTIVE_SESSION_KEY, serialized)
}

function render() {
  renderUi(state)

  if (!bridge) {
    return
  }

  if (overlayMode === 'last-note') {
    pendingGlassesContent = renderLastNotePreview()
    void renderGlassesNow(pendingGlassesContent)
    return
  }

  if (overlayMode === 'summary') {
    pendingGlassesContent = renderSummaryText()
    void renderGlassesNow(pendingGlassesContent)
    return
  }

  renderGlasses()
}

async function readStoredSession() {
  try {
    if (bridge) {
      return await bridge.getLocalStorage(ACTIVE_SESSION_KEY)
    }
  } catch (error) {
    console.warn('Bridge local storage read failed:', error)
  }

  return window.localStorage.getItem(ACTIVE_SESSION_KEY) ?? ''
}

async function saveAndRender() {
  await persistSessionState()
  render()
}

async function restoreSessionState() {
  const stored = await readStoredSession()
  if (!stored) {
    return
  }

  try {
    const parsed = JSON.parse(stored) as Partial<SessionRecord>
    state.currentSession = {
      active: parsed.active ?? false,
      currentStepIndex: parsed.currentStepIndex ?? 1,
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      startedAt: parsed.startedAt ?? null,
      endedAt: parsed.endedAt ?? null,
    }
    overlayMode = state.currentSession.active ? 'none' : state.currentSession.endedAt ? 'summary' : 'none'
  } catch (error) {
    console.warn('Failed to restore local session state:', error)
    state.currentSession = createDefaultSession()
  }
}

async function navigateToStep(step: ProtocolStep) {
  if (!state.currentSession.active) {
    updateStatus('warning', 'No active session. Say "start session" first.')
    return
  }

  state.currentSession.currentStepIndex = step.index
  overlayMode = 'none'
  state.lastCommand = `step ${step.index}`
  await saveAndRender()
  updateStatus('listening', `Showing step ${step.index} · ${step.title}`)
}

async function advanceStep(direction: 1 | -1, detail: string) {
  if (!state.currentSession.active) {
    updateStatus('warning', 'No active session. Say "start session" first.')
    return
  }

  const current = currentStep()
  if (!current) {
    return
  }

  const nextIndex = Math.min(
    state.protocol.steps.length,
    Math.max(1, state.currentSession.currentStepIndex + direction),
  )
  const nextStep = state.protocol.steps.find(step => step.index === nextIndex)
  if (!nextStep) {
    return
  }

  if (nextStep.index === current.index && direction === -1) {
    updateStatus('warning', 'Already at the first step.')
    return
  }

  if (nextStep.index === current.index && direction === 1) {
    updateStatus('warning', 'Already at the final step.')
    return
  }

  await navigateToStep(nextStep)
  state.lastCommand = detail
}

async function saveNote(noteText: string) {
  const step = currentStep()
  if (!state.currentSession.active || !step) {
    updateStatus('warning', 'Start a session before recording observations.')
    return
  }

  const note: ObservationRecord = {
    timestamp: new Date().toISOString(),
    stepIndex: step.index,
    stepTitle: step.title,
    transcript: noteText,
  }

  state.currentSession.observations.push(note)
  state.lastCommand = `note saved on step ${step.index}`
  overlayMode = 'none'
  await persistSessionState()
  flashSavedNote(noteText, step.index)
  updateStatus('listening', `Observation saved for step ${step.index}.`)
}

function showLastNote() {
  overlayMode = 'last-note'
  render()
}

async function handleCommand(command: VoiceCommand) {
  state.lastCommand = describeCommand(command)
  render()

  switch (command.kind) {
    case 'start_session': {
      if (state.currentSession.active) {
        updateStatus('warning', 'A session is already active.')
        return
      }
      state.currentSession = {
        active: true,
        currentStepIndex: 1,
        observations: [],
        startedAt: new Date().toISOString(),
        endedAt: null,
      }
      overlayMode = 'none'
      await saveAndRender()
      updateStatus('listening', 'Session started. Step 1 is live on the glasses.')
      return
    }
    case 'end_session': {
      if (!state.currentSession.active) {
        updateStatus('warning', 'There is no active session to end.')
        return
      }
      state.currentSession.active = false
      state.currentSession.endedAt = new Date().toISOString()
      overlayMode = 'summary'
      await saveAndRender()
      updateStatus('idle', 'Session ended. Summary is shown on the glasses.')
      return
    }
    case 'next':
      await advanceStep(1, 'voice next')
      return
    case 'previous':
      await advanceStep(-1, 'voice back')
      return
    case 'repeat': {
      const step = currentStep()
      if (!step) {
        return
      }
      overlayMode = 'none'
      state.lastCommand = 'repeat step'
      await saveAndRender()
      updateStatus('listening', `Repeated step ${step.index}.`)
      return
    }
    case 'goto': {
      const step = state.protocol.steps.find(item => item.index === command.stepNumber)
      if (!step) {
        updateStatus('warning', `Step ${command.stepNumber ?? '?'} is not in this protocol.`)
        return
      }
      await navigateToStep(step)
      state.lastCommand = `go to step ${step.index}`
      return
    }
    case 'note':
      await saveNote(command.noteText ?? '')
      return
    case 'read_last_note':
      showLastNote()
      updateStatus('listening', 'Showing the latest saved note on the glasses.')
      return
    default:
      updateStatus('warning', `Ignored: "${command.rawText}"`)
  }
}

// ── Voice: stream the G2 mic to the offline Vosk recognizer, route FINAL
// transcripts to commands. No API key — runs on-device.
function startVoice(): SttClient {
  return startSttStream(
    snap => {
      const interim = snap.interimText.trim()
      const final = snap.finalText.trim()

      if (interim) {
        // Mirror the unstable tail to the phone UI only; don't act on it.
        setTranscript(interim, 'Listening…')
        return
      }

      if (final) {
        const transcript = final.toLowerCase().trim()
        state.lastTranscript = transcript
        setTranscript(transcript, 'Recognizer active')
        const command = parseVoiceCommand(transcript)
        void handleCommand(command)
      }

      if (snap.finished) {
        setTranscript('', 'Recognizer stopped')
      }
    },
    err => {
      updateStatus('error', `Speech recognition error: ${(err as Error)?.message ?? String(err)}`)
    },
  )
}

async function bootstrap() {
  mountUi({
    onStartSession: () => void handleCommand({ kind: 'start_session', rawText: 'start session' }),
    onEndSession: () => void handleCommand({ kind: 'end_session', rawText: 'end session' }),
    onRepeatCurrentStep: () => void handleCommand({ kind: 'repeat', rawText: 'repeat' }),
  })

  render()

  try {
    bridge = await waitForEvenAppBridge()

    const mainText = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 4,
      containerID: GLASSES_CONTAINER_ID,
      containerName: GLASSES_CONTAINER_NAME,
      content: glassesText(),
      isEventCapture: 1,
    })

    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [mainText],
      }),
    )

    if (result !== 0) {
      console.error('startup page failed:', result)
    }

    await restoreSessionState()

    // Start the recognizer, THEN turn the glasses mic on so PCM has somewhere
    // to go. If the STT socket fails (e.g. bad/missing key), surface it but
    // keep the app usable via temple-tap.
    try {
      sttClient = startVoice()
      await bridge.audioControl(true)
      setTranscript('', 'Recognizer active')
      updateStatus('listening', 'Mic live on glasses. Say "next" / "back" / "note".')
    } catch (voiceError) {
      console.error('Voice startup failed:', voiceError)
      updateStatus('error', (voiceError as Error)?.message ?? 'Voice startup failed. Temple-tap still advances steps.')
    }

    bridge.onEvenHubEvent(event => {
      // 1) Audio frames from the glasses mic → STT. PCM s16le 16kHz mono.
      const pcm = event.audioEvent?.audioPcm
      if (pcm) {
        sttClient?.sendPcm(pcm)
      }

      // 2) Temple input on the protocol container.
      const textEvent = event.textEvent
      if (textEvent?.containerID === GLASSES_CONTAINER_ID) {
        switch (textEvent.eventType) {
          case OsEventTypeList.CLICK_EVENT:
          case undefined:
            void advanceStep(1, 'temple click')
            break
          case OsEventTypeList.DOUBLE_CLICK_EVENT:
            void bridge?.shutDownPageContainer(GLASSES_CONTAINER_ID)
            break
          default:
            break
        }
      }

      // 3) Lifecycle.
      const sysType = event.sysEvent?.eventType
      if (
        sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
        sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
      ) {
        void cleanup()
      }
    })

    render()
  } catch (error) {
    console.error('Bootstrap failed:', error)
    updateStatus('error', (error as Error)?.message ?? 'Startup failed.')
  }
}

async function cleanup() {
  if (cleanedUp) {
    return
  }

  cleanedUp = true
  sttClient?.close()
  if (bridge) {
    await bridge.audioControl(false)
  }
}

window.addEventListener('beforeunload', () => {
  void cleanup()
})

void bootstrap()
