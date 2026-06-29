export interface ProtocolStep {
  index: number
  title: string
  action: string
}

export interface ProtocolDefinition {
  name: string
  steps: ProtocolStep[]
}

export interface ObservationRecord {
  timestamp: string
  stepIndex: number
  stepTitle: string
  transcript: string
}

export interface SessionRecord {
  active: boolean
  currentStepIndex: number
  observations: ObservationRecord[]
  startedAt: string | null
  endedAt: string | null
}

export type StatusKind = 'connecting' | 'listening' | 'warning' | 'error' | 'idle'

export interface VoiceCommand {
  kind:
    | 'start_session'
    | 'end_session'
    | 'next'
    | 'previous'
    | 'repeat'
    | 'goto'
    | 'note'
    | 'read_last_note'
    | 'unknown'
  stepNumber?: number
  noteText?: string
  rawText: string
}

export interface AppState {
  protocol: ProtocolDefinition
  currentSession: SessionRecord
  lastTranscript: string
  lastCommand: string
  statusKind: StatusKind
  statusText: string
  providerLabel: string
}
