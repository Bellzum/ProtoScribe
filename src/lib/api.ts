import { API_BASE_URL } from './config'
import type {
  ObservationPayload,
  ProtocolDefinition,
  SessionRecord,
  StepEventPayload,
} from './types'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function loadProtocol() {
  const response = await fetch('/protocol.json')
  if (!response.ok) {
    throw new Error('Failed to load protocol.json')
  }
  return response.json() as Promise<ProtocolDefinition>
}

export function getExportUrl(sessionId: string, format: 'json' | 'pdf') {
  return `${API_BASE_URL}/api/session/${sessionId}/export/${format}`
}

export function getBackendBaseUrl() {
  return API_BASE_URL
}

export function listSessions() {
  return fetchJson<SessionRecord[]>('/api/sessions')
}

export function getActiveSession() {
  return fetchJson<SessionRecord | null>('/api/session/active')
}

export function getSession(sessionId: string) {
  return fetchJson<SessionRecord>(`/api/session/${sessionId}`)
}

export function startSession(confirmationRequired: boolean) {
  return fetchJson<SessionRecord>('/api/session/start', {
    method: 'POST',
    body: JSON.stringify({ confirmation_required: confirmationRequired }),
  })
}

export function recordStepEvent(sessionId: string, payload: StepEventPayload) {
  return fetchJson<SessionRecord>(`/api/session/${sessionId}/step`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function saveObservation(sessionId: string, payload: ObservationPayload) {
  return fetchJson<SessionRecord>(`/api/session/${sessionId}/observation`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function endSession(sessionId: string) {
  return fetchJson<SessionRecord>(`/api/session/${sessionId}/end`, {
    method: 'POST',
  })
}
