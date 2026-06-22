import { getBackendBaseUrl } from './lib/api'
import { APP_NAME } from './lib/config'
import type { AppState, SessionRecord, StatusKind } from './lib/types'

type UiActions = {
  onStartSession(): void
  onEndSession(): void
  onRefreshSessions(): void
  onSelectSession(sessionId: string): void
  onToggleConfirmation(enabled: boolean): void
  onRepeatCurrentStep(): void
}

let appRoot: HTMLDivElement
let actions: UiActions
let lastTranscript = ''
let lastInterim = ''

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'Not finished'
  }

  return new Date(value).toLocaleString()
}

function summarizeCurrentStep(state: AppState) {
  if (!state.protocol) {
    return null
  }

  const stepIndex = state.currentSession?.current_step_index ?? 1
  return state.protocol.steps.find(step => step.index === stepIndex) ?? state.protocol.steps[0]
}

function groupTimeline(session: SessionRecord) {
  return session.step_events.map(event => {
    const notes = session.observations.filter(note => note.step_index === event.step_index)
    return { event, notes }
  })
}

function renderStatusChip(kind: StatusKind, text: string) {
  return `<div class="status status-${kind}">${escapeHtml(text)}</div>`
}

function renderCurrentSession(state: AppState) {
  const step = summarizeCurrentStep(state)
  const session = state.currentSession
  const noteCount = session?.observations.length ?? 0

  if (!state.protocol || !step) {
    return `
      <section class="card card-live">
        <div class="card-label">Live Session</div>
        <h2>Loading protocol</h2>
        <p class="muted">ProtoScribe is preparing the Even Hub bridge, protocol file, and speech pipeline.</p>
      </section>
    `
  }

  return `
    <section class="card card-live">
      <div class="card-label">Live Session</div>
      <div class="card-headline">
        <h2>${escapeHtml(step.title)}</h2>
        <span class="step-pill">Step ${step.index}/${state.protocol.steps.length}</span>
      </div>
      <p class="step-action">${escapeHtml(step.action)}</p>
      <div class="metrics">
        <div class="metric"><span>Protocol</span><strong>${escapeHtml(state.protocol.name)}</strong></div>
        <div class="metric"><span>Status</span><strong>${session ? session.status : 'idle'}</strong></div>
        <div class="metric"><span>Notes</span><strong>${noteCount}</strong></div>
      </div>
      <div class="button-row">
        <button data-action="start-session" ${session?.status === 'active' ? 'disabled' : ''}>Start Session</button>
        <button data-action="end-session" class="ghost" ${session?.status === 'active' ? '' : 'disabled'}>End Session</button>
        <button data-action="repeat-step" class="ghost" ${session?.status === 'active' ? '' : 'disabled'}>Repeat Step</button>
      </div>
      <label class="toggle">
        <input type="checkbox" data-action="toggle-confirmation" ${state.confirmationRequired ? 'checked' : ''} />
        <span>Require spoken confirmation before advancing</span>
      </label>
      <div class="command-grid">
        <span>start session</span>
        <span>end session</span>
        <span>next / back</span>
        <span>repeat</span>
        <span>go to step N</span>
        <span>note &lt;text&gt;</span>
        <span>read last note</span>
        <span>done / flag</span>
      </div>
    </section>
  `
}

function renderTranscriptPane() {
  return `
    <section class="card">
      <div class="card-label">Speech Feed</div>
      <h3>Latest utterance</h3>
      <p class="transcript-block">${escapeHtml(lastTranscript || 'No final transcript yet.')}</p>
      <h3>Interim capture</h3>
      <p class="transcript-block transcript-interim">${escapeHtml(lastInterim || 'Waiting for speech...')}</p>
    </section>
  `
}

function renderSessionsList(state: AppState) {
  if (!state.recentSessions.length) {
    return '<p class="muted">No sessions recorded yet.</p>'
  }

  return state.recentSessions
    .map(session => {
      const isSelected = session.session_id === state.selectedSessionId
      return `
        <button class="session-item ${isSelected ? 'selected' : ''}" data-action="select-session" data-session-id="${escapeHtml(session.session_id)}">
          <strong>${escapeHtml(session.protocol_name)}</strong>
          <span>${escapeHtml(session.session_id)}</span>
          <span>${escapeHtml(formatTimestamp(session.started_at))}</span>
        </button>
      `
    })
    .join('')
}

function renderSelectedSession(state: AppState) {
  const session = state.selectedSession
  if (!session) {
    return '<p class="muted">Select a session to inspect its timeline and exports.</p>'
  }

  const exportBase = getBackendBaseUrl()
  const timeline = groupTimeline(session)
    .map(({ event, notes }) => {
      const notesMarkup = notes.length
        ? notes
            .map(
              note => `
                <div class="note-entry">
                  <span>${escapeHtml(formatTimestamp(note.timestamp))}</span>
                  <p>${escapeHtml(note.transcript)}</p>
                </div>
              `,
            )
            .join('')
        : '<p class="muted compact">No notes on this step event.</p>'

      return `
        <article class="timeline-entry">
          <div class="timeline-head">
            <strong>Step ${event.step_index} · ${escapeHtml(event.step_title)}</strong>
            <span>${escapeHtml(event.event_type)}</span>
          </div>
          <div class="timeline-meta">${escapeHtml(formatTimestamp(event.timestamp))}${event.detail ? ` · ${escapeHtml(event.detail)}` : ''}</div>
          ${notesMarkup}
        </article>
      `
    })
    .join('')

  return `
    <div class="session-detail">
      <div class="detail-toolbar">
        <div>
          <h3>${escapeHtml(session.protocol_name)}</h3>
          <p class="muted">${escapeHtml(session.session_id)}</p>
        </div>
        <div class="button-row">
          <a class="export-link" href="${exportBase}/api/session/${encodeURIComponent(session.session_id)}/export/json" target="_blank" rel="noreferrer">Export JSON</a>
          <a class="export-link" href="${exportBase}/api/session/${encodeURIComponent(session.session_id)}/export/pdf" target="_blank" rel="noreferrer">Export PDF</a>
        </div>
      </div>
      <div class="detail-summary">
        <span>Started: ${escapeHtml(formatTimestamp(session.started_at))}</span>
        <span>Ended: ${escapeHtml(formatTimestamp(session.ended_at))}</span>
        <span>Notes: ${session.observations.length}</span>
      </div>
      <div class="timeline">
        ${timeline || '<p class="muted">No timeline entries yet.</p>'}
      </div>
    </div>
  `
}

export function mountUi(uiActions: UiActions) {
  actions = uiActions
  appRoot = document.querySelector<HTMLDivElement>('#app')!
  injectStyles()

  appRoot.addEventListener('click', event => {
    const target = event.target as HTMLElement | null
    const actionTarget = target?.closest<HTMLElement>('[data-action]')
    if (!actionTarget) {
      return
    }

    const action = actionTarget.dataset.action
    if (action === 'start-session') actions.onStartSession()
    if (action === 'end-session') actions.onEndSession()
    if (action === 'refresh-sessions') actions.onRefreshSessions()
    if (action === 'repeat-step') actions.onRepeatCurrentStep()
    if (action === 'select-session' && actionTarget.dataset.sessionId) {
      actions.onSelectSession(actionTarget.dataset.sessionId)
    }
  })

  appRoot.addEventListener('change', event => {
    const target = event.target as HTMLInputElement | null
    if (target?.dataset.action === 'toggle-confirmation') {
      actions.onToggleConfirmation(target.checked)
    }
  })
}

export function renderUi(state: AppState) {
  appRoot.innerHTML = `
    <main class="shell">
      <section class="hero">
        <div>
          <p class="eyebrow">Even Realities G2 · BSL-3 workflow</p>
          <h1>${APP_NAME}</h1>
          <p class="hero-copy">Hands-free protocol guidance and a voice lab notebook for researchers who cannot carry paper or handheld devices into containment.</p>
        </div>
        <div class="hero-status">
          ${renderStatusChip(state.statusKind, state.statusText)}
          <div class="provider-chip">STT: ${escapeHtml(state.providerLabel)}</div>
        </div>
      </section>
      <section class="layout">
        <div class="column">
          ${renderCurrentSession(state)}
          ${renderTranscriptPane()}
        </div>
        <div class="column">
          <section class="card">
            <div class="card-headline">
              <div>
                <div class="card-label">Review & Export</div>
                <h2>Session archive</h2>
              </div>
              <button data-action="refresh-sessions" class="ghost">Refresh</button>
            </div>
            <div class="session-list">${renderSessionsList(state)}</div>
          </section>
          <section class="card card-review">
            <div class="card-label">Audit View</div>
            ${renderSelectedSession(state)}
          </section>
        </div>
      </section>
      <footer class="footer">
        Double-tap the temple advances to the next step if voice capture fails. All protocol state lives on the phone/server, not on the glasses.
      </footer>
    </main>
  `
}

export function setStatus() {}

export function setTranscript(finalText: string, interimText: string) {
  if (finalText) {
    lastTranscript = finalText
  }
  lastInterim = interimText
}

function injectStyles() {
  const style = document.createElement('style')
  style.textContent = `
    :root {
      color-scheme: dark;
      --bg: #050607;
      --panel: #101315;
      --panel-2: #161b1e;
      --line: rgba(255,255,255,0.08);
      --text: #f6f3e8;
      --muted: #9ea6a8;
      --accent: #d4ff6a;
      --danger: #ff715b;
      --warn: #ffcf5d;
      --mono: "IBM Plex Mono", "SFMono-Regular", ui-monospace, monospace;
      --sans: "Avenir Next", "Segoe UI", sans-serif;
    }
    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top right, rgba(212,255,106,0.10), transparent 30%),
        linear-gradient(180deg, #090b0c 0%, #050607 100%);
      color: var(--text);
      font-family: var(--sans);
      touch-action: manipulation;
      -webkit-text-size-adjust: 100%;
      overscroll-behavior: none;
    }
    body { padding: 24px; box-sizing: border-box; }
    #app { min-height: calc(100vh - 48px); }
    button, a { font: inherit; }
    .shell { max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    .hero, .card, .footer {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(18,22,24,0.95), rgba(10,12,13,0.96));
      box-shadow: 0 24px 80px rgba(0,0,0,0.28);
      backdrop-filter: blur(18px);
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 24px;
      border-radius: 24px;
    }
    .hero h1, .card h2, .card h3 { margin: 0; font-family: var(--mono); letter-spacing: 0.01em; }
    .hero h1 { font-size: 44px; margin-top: 6px; }
    .hero-copy { max-width: 760px; color: var(--muted); line-height: 1.6; margin: 10px 0 0; }
    .eyebrow, .card-label, .timeline-meta, .muted, .provider-chip, .step-pill, .status {
      font-family: var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 11px;
    }
    .eyebrow, .card-label { color: var(--accent); margin: 0 0 8px; }
    .hero-status { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
    .provider-chip, .step-pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      color: var(--text);
    }
    .status {
      border: 1px solid currentColor;
      border-radius: 999px;
      padding: 8px 12px;
      width: fit-content;
    }
    .status-connecting, .status-idle { color: var(--muted); }
    .status-listening { color: var(--accent); }
    .status-warning { color: var(--warn); }
    .status-error { color: var(--danger); }
    .layout { display: grid; grid-template-columns: 1.02fr 1fr; gap: 20px; }
    .column { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
    .card {
      border-radius: 24px;
      padding: 22px;
      min-width: 0;
    }
    .card-live {
      background:
        linear-gradient(180deg, rgba(212,255,106,0.10), transparent 22%),
        linear-gradient(180deg, rgba(18,22,24,0.97), rgba(10,12,13,0.96));
    }
    .card-headline {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .step-action, .transcript-block, .timeline-entry p {
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      white-space: pre-wrap;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,0.02);
    }
    .metric span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .button-row { display: flex; gap: 12px; flex-wrap: wrap; }
    button, .export-link {
      border: 1px solid rgba(212,255,106,0.36);
      border-radius: 999px;
      padding: 10px 14px;
      background: rgba(212,255,106,0.08);
      color: var(--text);
      cursor: pointer;
      text-decoration: none;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
    }
    button:hover, .export-link:hover { transform: translateY(-1px); background: rgba(212,255,106,0.14); }
    button:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .ghost { background: transparent; border-color: var(--line); }
    .toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      margin-top: 16px;
    }
    .toggle input { accent-color: var(--accent); }
    .command-grid {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .command-grid span, .transcript-block, .session-item, .timeline-entry, .note-entry {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.02);
      border-radius: 16px;
    }
    .command-grid span { padding: 12px; color: var(--muted); }
    .transcript-block { padding: 16px; margin-top: 8px; min-height: 56px; }
    .transcript-interim { color: var(--muted); }
    .session-list, .timeline { display: flex; flex-direction: column; gap: 12px; }
    .session-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 14px;
      text-align: left;
      width: 100%;
      border-radius: 18px;
    }
    .session-item.selected { border-color: rgba(212,255,106,0.52); background: rgba(212,255,106,0.08); }
    .session-detail { display: flex; flex-direction: column; gap: 16px; }
    .detail-toolbar {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }
    .detail-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--muted);
    }
    .timeline-entry, .note-entry { padding: 14px; }
    .timeline-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .timeline-meta, .muted { color: var(--muted); }
    .muted.compact { margin-top: 10px; }
    .note-entry { margin-top: 10px; }
    .note-entry span { display: block; color: var(--muted); margin-bottom: 8px; }
    .footer { border-radius: 20px; padding: 16px 20px; color: var(--muted); line-height: 1.5; }
    @media (max-width: 980px) {
      body { padding: 16px; }
      .hero, .detail-toolbar, .card-headline { flex-direction: column; align-items: flex-start; }
      .hero h1 { font-size: 32px; }
      .hero-status { align-items: flex-start; }
      .layout { grid-template-columns: 1fr; }
      .metrics, .command-grid { grid-template-columns: 1fr; }
      .button-row, .detail-summary { width: 100%; }
    }
  `
  document.head.appendChild(style)
}
