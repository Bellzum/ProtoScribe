import { APP_NAME } from './lib/config'
import type { AppState, ObservationRecord, StatusKind } from './lib/types'

type UiActions = {
  onStartSession(): void
  onEndSession(): void
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
  const stepIndex = state.currentSession.currentStepIndex
  return state.protocol.steps.find(step => step.index === stepIndex) ?? state.protocol.steps[0]
}

function renderObservation(note: ObservationRecord) {
  return `
    <article class="timeline-entry">
      <div class="timeline-head">
        <strong>Step ${note.stepIndex} · ${escapeHtml(note.stepTitle)}</strong>
        <span>Observation</span>
      </div>
      <div class="timeline-meta">${escapeHtml(formatTimestamp(note.timestamp))}</div>
      <p>${escapeHtml(note.transcript)}</p>
    </article>
  `
}

function renderStatusChip(kind: StatusKind, text: string) {
  return `<div class="status status-${kind}">${escapeHtml(text)}</div>`
}

function renderCurrentSession(state: AppState) {
  const step = summarizeCurrentStep(state)
  const session = state.currentSession
  const noteCount = session.observations.length

  if (!step) {
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
        <div class="metric"><span>Status</span><strong>${session.active ? 'active' : 'idle'}</strong></div>
        <div class="metric"><span>Notes</span><strong>${noteCount}</strong></div>
      </div>
      <div class="button-row">
        <button data-action="start-session" ${session.active ? 'disabled' : ''}>Start Session</button>
        <button data-action="end-session" class="ghost" ${session.active ? '' : 'disabled'}>End Session</button>
        <button data-action="repeat-step" class="ghost" ${session.active ? '' : 'disabled'}>Repeat Step</button>
      </div>
      <div class="command-grid">
        <span>start session</span>
        <span>end session</span>
        <span>next / back</span>
        <span>repeat</span>
        <span>go to step N</span>
        <span>note &lt;text&gt;</span>
        <span>read last note</span>
        <span>Temple tap = next</span>
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
      <h3>Recognizer state</h3>
      <p class="transcript-block transcript-interim">${escapeHtml(lastInterim || 'Web Speech API standby.')}</p>
    </section>
  `
}

function renderSessionSummary(state: AppState) {
  const session = state.currentSession
  const notes = [...session.observations].reverse()
  const notesMarkup = notes.length
    ? notes.map(note => renderObservation(note)).join('')
    : '<p class="muted">No notes captured yet.</p>'

  return `
    <div class="session-detail">
      <div class="detail-toolbar">
        <div>
          <h3>${escapeHtml(state.protocol.name)}</h3>
          <p class="muted">Session state lives on the phone and Even local storage.</p>
        </div>
      </div>
      <div class="detail-summary">
        <span>Started: ${escapeHtml(formatTimestamp(session.startedAt))}</span>
        <span>Ended: ${escapeHtml(formatTimestamp(session.endedAt))}</span>
        <span>Current step: ${session.currentStepIndex}/${state.protocol.steps.length}</span>
        <span>Notes: ${session.observations.length}</span>
      </div>
      <div class="timeline">
        ${notesMarkup}
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
    if (action === 'repeat-step') actions.onRepeatCurrentStep()
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
          <div class="provider-chip">Voice: ${escapeHtml(state.providerLabel)}</div>
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
                <div class="card-label">Local Session</div>
                <h2>Notes and summary</h2>
              </div>
            </div>
            ${renderSessionSummary(state)}
          </section>
        </div>
      </section>
      <footer class="footer">
        Double-tap the temple advances to the next step if voice capture fails. All protocol state stays on the phone and Even local storage, with no laptop backend required.
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
    button {
      border: 1px solid rgba(212,255,106,0.36);
      border-radius: 999px;
      padding: 10px 14px;
      background: rgba(212,255,106,0.08);
      color: var(--text);
      cursor: pointer;
      text-decoration: none;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
    }
    button:hover { transform: translateY(-1px); background: rgba(212,255,106,0.14); }
    button:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .ghost { background: transparent; border-color: var(--line); }
    .command-grid {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .command-grid span, .transcript-block, .timeline-entry {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.02);
      border-radius: 16px;
    }
    .command-grid span { padding: 12px; color: var(--muted); }
    .transcript-block { padding: 16px; margin-top: 8px; min-height: 56px; }
    .transcript-interim { color: var(--muted); }
    .timeline { display: flex; flex-direction: column; gap: 12px; }
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
    .timeline-entry { padding: 14px; }
    .timeline-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .timeline-meta, .muted { color: var(--muted); }
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
