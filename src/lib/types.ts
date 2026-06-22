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
  step_index: number
  step_title: string
  transcript: string
}

export type StepEventType = 'entered' | 'repeated' | 'completed' | 'flagged'

export interface StepEvent {
  timestamp: string
  step_index: number
  step_title: string
  event_type: StepEventType
  detail?: string
}

export type SessionStatus = 'idle' | 'active' | 'ended'

export interface SessionRecord {
  session_id: string
  started_at: string
  ended_at: string | null
  protocol_name: string
  confirmation_required: boolean
  status: SessionStatus
  current_step_index: number
  observations: ObservationRecord[]
  step_events: StepEvent[]
}

export interface StepEventPayload {
  step_index: number
  step_title: string
  event_type: StepEventType
  detail?: string
}

export interface ObservationPayload {
  step_index: number
  step_title: string
  transcript: string
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
    | 'confirm'
    | 'flag'
    | 'unknown'
  stepNumber?: number
  noteText?: string
  flagText?: string
  rawText: string
}

export interface AppState {
  protocol: ProtocolDefinition | null
  currentSession: SessionRecord | null
  recentSessions: SessionRecord[]
  selectedSession: SessionRecord | null
  selectedSessionId: string | null
  confirmationRequired: boolean
  lastTranscript: string
  lastCommand: string
  statusKind: StatusKind
  statusText: string
  providerLabel: string
}
