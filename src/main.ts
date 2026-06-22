import { startSttStream, type SttSnapshot } from './asr/stt'
import {
  endSession,
  getActiveSession,
  getSession,
  listSessions,
  loadProtocol,
  recordStepEvent,
  saveObservation,
  startSession,
} from './lib/api'
import { describeCommand, parseVoiceCommand } from './lib/commands'
import { formatProviderLabel, STT_PROVIDER } from './lib/config'
import { GlassesDisplay, isDoubleTap, isSystemExit } from './lib/glasses'
import type { AppState, ObservationRecord, ProtocolStep, SessionRecord, StatusKind, VoiceCommand } from './lib/types'
import { mountUi, renderUi, setTranscript } from './ui'

const API_KEY = (import.meta.env.VITE_STT_API_KEY as string | undefined) ?? ''
const ACTIVE_SESSION_KEY = 'protoscribe.activeSessionId'

const state: AppState = {
  protocol: null,
  currentSession: null,
  recentSessions: [],
  selectedSession: null,
  selectedSessionId: null,
  confirmationRequired: false,
  lastTranscript: '',
  lastCommand: 'awaiting command',
  statusKind: 'connecting',
  statusText: 'Preparing Even Hub bridge and microphone…',
  providerLabel: formatProviderLabel(STT_PROVIDER),
}

let display: GlassesDisplay | null = null
let stt: ReturnType<typeof startSttStream> | null = null
let cleanedUp = false
let notePreviewTimer: number | null = null
let showingLastNote = false

function currentStep() {
  if (!state.protocol) {
    return null
  }

  const stepIndex = state.currentSession?.current_step_index ?? 1
  return state.protocol.steps.find(step => step.index === stepIndex) ?? state.protocol.steps[0]
}

function getLatestObservation() {
  const notes = state.currentSession?.observations ?? []
  return notes[notes.length - 1] ?? null
}

function updateStatus(kind: StatusKind, text: string) {
  state.statusKind = kind
  state.statusText = text
  render()
}

function syncSession(session: SessionRecord | null) {
  state.currentSession = session
  if (session) {
    state.confirmationRequired = session.confirmation_required
    state.selectedSession = session
    state.selectedSessionId = session.session_id
    void persistLocalState(session.session_id)
  } else {
    void persistLocalState('')
  }
}

function render() {
  renderUi(state)

  if (!display || !state.protocol) {
    return
  }

  if (showingLastNote) {
    display.render({
      mode: 'note',
      protocol: state.protocol,
      session: state.currentSession,
      statusText: state.statusText,
      providerLabel: state.providerLabel,
      lastCommand: state.lastCommand,
      notePreview: getLatestObservation(),
    })
    return
  }

  display.render({
    mode: state.currentSession?.status === 'ended' ? 'ended' : state.currentSession ? 'step' : 'startup',
    protocol: state.protocol,
    session: state.currentSession,
    statusText: state.statusText,
    providerLabel: state.providerLabel,
    lastCommand: state.lastCommand,
  })
}

async function persistLocalState(sessionId: string) {
  try {
    const bridge = display?.getBridge()
    if (bridge) {
      await bridge.setLocalStorage(ACTIVE_SESSION_KEY, sessionId)
      return
    }
  } catch (error) {
    console.warn('Bridge local storage unavailable:', error)
  }

  window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId)
}

async function getStoredSessionId() {
  try {
    const bridge = display?.getBridge()
    if (bridge) {
      return await bridge.getLocalStorage(ACTIVE_SESSION_KEY)
    }
  } catch (error) {
    console.warn('Bridge local storage read failed:', error)
  }

  return window.localStorage.getItem(ACTIVE_SESSION_KEY) ?? ''
}

async function refreshSessions() {
  const sessions = await listSessions()
  state.recentSessions = sessions

  if (state.selectedSessionId) {
    try {
      state.selectedSession = await getSession(state.selectedSessionId)
    } catch {
      state.selectedSession = sessions[0] ?? null
      state.selectedSessionId = state.selectedSession?.session_id ?? null
    }
  } else {
    state.selectedSession = sessions[0] ?? null
    state.selectedSessionId = state.selectedSession?.session_id ?? null
  }

  render()
}

async function navigateToStep(step: ProtocolStep, eventType: 'entered' | 'repeated', detail?: string) {
  if (!state.currentSession) {
    updateStatus('warning', 'No active session. Say "start session" first.')
    return
  }

  state.currentSession = await recordStepEvent(state.currentSession.session_id, {
    step_index: step.index,
    step_title: step.title,
    event_type: eventType,
    detail,
  })
  state.lastCommand = `${eventType === 'entered' ? 'step' : 'repeat'} ${step.index}`
  await refreshSessions()
  updateStatus('listening', `Showing step ${step.index} · ${step.title}`)
}

function isCurrentStepConfirmed(session: SessionRecord) {
  return session.step_events.some(
    event => event.step_index === session.current_step_index && event.event_type === 'completed',
  )
}

async function advanceStep(direction: 1 | -1, detail: string) {
  if (!state.currentSession || !state.protocol) {
    updateStatus('warning', 'No active session. Say "start session" first.')
    return
  }

  const current = currentStep()
  if (!current) {
    return
  }

  if (direction === 1 && state.currentSession.confirmation_required && !isCurrentStepConfirmed(state.currentSession)) {
    updateStatus('warning', 'Confirmation mode is on. Say "done" before moving to the next step.')
    return
  }

  const nextIndex = Math.min(
    state.protocol.steps.length,
    Math.max(1, state.currentSession.current_step_index + direction),
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

  await navigateToStep(nextStep, 'entered', detail)
}

async function confirmCurrentStep() {
  const session = state.currentSession
  const step = currentStep()
  if (!session || !step) {
    updateStatus('warning', 'There is no active step to confirm.')
    return
  }

  state.currentSession = await recordStepEvent(session.session_id, {
    step_index: step.index,
    step_title: step.title,
    event_type: 'completed',
    detail: 'spoken confirmation',
  })
  state.lastCommand = `confirmed step ${step.index}`
  await refreshSessions()
  updateStatus('listening', `Step ${step.index} marked complete.`)
}

async function flagCurrentStep(flagText: string) {
  const session = state.currentSession
  const step = currentStep()
  if (!session || !step) {
    updateStatus('warning', 'There is no active step to flag.')
    return
  }

  state.currentSession = await recordStepEvent(session.session_id, {
    step_index: step.index,
    step_title: step.title,
    event_type: 'flagged',
    detail: flagText,
  })
  state.lastCommand = `flagged step ${step.index}`
  await refreshSessions()
  updateStatus('warning', `Step ${step.index} flagged: ${flagText}`)
}

async function saveNote(noteText: string) {
  const session = state.currentSession
  const step = currentStep()
  if (!session || !step) {
    updateStatus('warning', 'Start a session before recording observations.')
    return
  }

  state.currentSession = await saveObservation(session.session_id, {
    step_index: step.index,
    step_title: step.title,
    transcript: noteText,
  })
  state.lastCommand = `note saved on step ${step.index}`
  await refreshSessions()
  display?.flashNoteSaved(step.index)
  updateStatus('listening', `Observation saved for step ${step.index}.`)
}

function showLastNote(_note: ObservationRecord | null) {
  showingLastNote = true
  render()
  if (notePreviewTimer !== null) {
    window.clearTimeout(notePreviewTimer)
  }
  notePreviewTimer = window.setTimeout(() => {
    showingLastNote = false
    render()
  }, 2200)
}

async function handleCommand(command: VoiceCommand) {
  state.lastCommand = describeCommand(command)
  render()

  switch (command.kind) {
    case 'start_session': {
      if (state.currentSession?.status === 'active') {
        updateStatus('warning', 'A session is already active.')
        return
      }
      const session = await startSession(state.confirmationRequired)
      syncSession(session)
      await refreshSessions()
      updateStatus('listening', 'Session started. Step 1 is live on the glasses.')
      return
    }
    case 'end_session': {
      if (!state.currentSession?.session_id) {
        updateStatus('warning', 'There is no active session to end.')
        return
      }
      const session = await endSession(state.currentSession.session_id)
      syncSession(session)
      await refreshSessions()
      updateStatus('idle', 'Session ended. Review and export are ready.')
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
      await navigateToStep(step, 'repeated', 'voice repeat')
      return
    }
    case 'goto': {
      if (!state.protocol) {
        return
      }
      const step = state.protocol.steps.find(item => item.index === command.stepNumber)
      if (!step) {
        updateStatus('warning', `Step ${command.stepNumber ?? '?'} is not in this protocol.`)
        return
      }
      await navigateToStep(step, 'entered', 'voice go to')
      return
    }
    case 'note':
      await saveNote(command.noteText ?? '')
      return
    case 'read_last_note':
      showLastNote(getLatestObservation())
      updateStatus('listening', 'Showing the latest saved note on the glasses.')
      return
    case 'confirm':
      await confirmCurrentStep()
      return
    case 'flag':
      await flagCurrentStep(command.flagText ?? 'flagged')
      return
    default:
      updateStatus('warning', `Ignored: "${command.rawText}"`)
  }
}

async function restoreSessionState() {
  const active = await getActiveSession()
  if (active) {
    syncSession(active)
    state.selectedSession = active
    state.selectedSessionId = active.session_id
    updateStatus('listening', 'Recovered active session from background state.')
    return
  }

  const storedSessionId = await getStoredSessionId()
  if (storedSessionId) {
    try {
      const session = await getSession(storedSessionId)
      state.selectedSession = session
      state.selectedSessionId = session.session_id
    } catch {
      state.selectedSession = null
      state.selectedSessionId = null
    }
  }
}

async function bootstrap() {
  mountUi({
    onStartSession: () => void handleCommand({ kind: 'start_session', rawText: 'start session' }),
    onEndSession: () => void handleCommand({ kind: 'end_session', rawText: 'end session' }),
    onRefreshSessions: () => void refreshSessions(),
    onSelectSession: sessionId => {
      state.selectedSessionId = sessionId
      void refreshSessions()
    },
    onToggleConfirmation: enabled => {
      state.confirmationRequired = enabled
      render()
    },
    onRepeatCurrentStep: () => void handleCommand({ kind: 'repeat', rawText: 'repeat' }),
  })

  render()

  try {
    state.protocol = await loadProtocol()
    display = await GlassesDisplay.create()
    await restoreSessionState()
    await refreshSessions()

    stt = startSttStream(
      API_KEY,
      async (snapshot: SttSnapshot) => {
        setTranscript(snapshot.finalText, snapshot.interimText)
        if (snapshot.finalText) {
          state.lastTranscript = snapshot.finalText
        }
        render()

        if (snapshot.finished && snapshot.finalText.trim()) {
          const command = parseVoiceCommand(snapshot.finalText)
          await handleCommand(command)
        }
      },
      error => {
        console.error('STT error:', error)
        updateStatus('error', `STT error: ${(error as Error)?.message ?? error}`)
      },
    )

    await display.setMicrophoneEnabled(true)
    updateStatus('listening', 'Microphone live. Voice is primary; double-tap is fallback.')

    display.subscribeEvents(event => {
      const pcm = event.audioEvent?.audioPcm
      if (pcm) {
        stt?.sendPcm(pcm)
      }

      const sysType = event.sysEvent?.eventType ?? null
      const textType = event.textEvent?.eventType ?? null

      if (isDoubleTap(sysType) || isDoubleTap(textType)) {
        void advanceStep(1, 'temple double-tap')
        return
      }

      if (isSystemExit(sysType)) {
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
  stt?.close()
  await display?.shutdown()
}

window.addEventListener('beforeunload', () => {
  void cleanup()
})

void bootstrap()
