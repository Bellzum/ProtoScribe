import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

import { APP_NAME } from './config'
import type { ObservationRecord, ProtocolDefinition, SessionRecord } from './types'

const DISPLAY_WIDTH = 576
const DISPLAY_HEIGHT = 288
const CONTAINER_ID = 1
const CONTAINER_NAME = 'protoscribe-display'
const CHARS_PER_LINE = 29
const MAX_LINES = 10

type GlassesView = {
  mode: 'startup' | 'step' | 'note' | 'ended'
  protocol: ProtocolDefinition
  session: SessionRecord | null
  statusText: string
  providerLabel: string
  lastCommand: string
  notePreview?: ObservationRecord | null
}

function wrapText(text: string, width: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > width && current) {
      lines.push(current)
      current = word
      continue
    }
    current = candidate
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

function padLines(lines: string[]) {
  const output = [...lines.slice(0, MAX_LINES)]
  while (output.length < MAX_LINES) {
    output.push('')
  }
  return output.join('\n')
}

function getCurrentStep(view: GlassesView) {
  const currentStepIndex = view.session?.current_step_index ?? 1
  return view.protocol.steps.find(step => step.index === currentStepIndex) ?? view.protocol.steps[0]
}

function formatHeader(protocolName: string, stepIndex: number, totalSteps: number) {
  const suffix = ` · ${stepIndex}/${totalSteps}`
  const maxProtocolLength = Math.max(8, CHARS_PER_LINE - APP_NAME.length - suffix.length - 3)
  return `${APP_NAME} · ${truncate(protocolName, maxProtocolLength)}${suffix}`
}

function buildStartupScreen(view: GlassesView) {
  const lines = [
    formatHeader(view.protocol.name, 1, view.protocol.steps.length),
    'Ready for BSL-3 run',
    'Say "start session"',
    '',
    'Voice: next | back',
    'repeat | go to step N',
    'note ... | read last note',
    '',
    `Provider: ${truncate(view.providerLabel, 18)}`,
    'Double-tap temple = next',
  ]
  return padLines(lines)
}

function buildEndedScreen(view: GlassesView) {
  const session = view.session
  const noteCount = session?.observations.length ?? 0
  const lines = [
    formatHeader(view.protocol.name, session?.current_step_index ?? 1, view.protocol.steps.length),
    'Session ended',
    session?.ended_at ? truncate(session.ended_at, CHARS_PER_LINE) : '',
    '',
    `Notes saved: ${noteCount}`,
    `Last cmd: ${truncate(view.lastCommand || 'none', 18)}`,
    '',
    'Review export on phone',
    'or laptop browser.',
    truncate(view.statusText, CHARS_PER_LINE),
  ]
  return padLines(lines)
}

function buildNoteScreen(view: GlassesView) {
  const note = view.notePreview
  const step = getCurrentStep(view)
  const lines = [
    formatHeader(view.protocol.name, step.index, view.protocol.steps.length),
    note ? 'Latest note' : 'No note saved',
    ...(note
      ? wrapText(`${note.step_index}. ${note.step_title}`, CHARS_PER_LINE)
      : ['Say "note ..." to save']),
    '',
    ...(note ? wrapText(note.transcript, CHARS_PER_LINE) : []),
    '',
    note ? truncate(note.timestamp, CHARS_PER_LINE) : '',
    'Say "repeat" to resume',
  ]
  return padLines(lines)
}

function buildStepScreen(view: GlassesView) {
  const session = view.session
  const step = getCurrentStep(view)
  const noteCount = session?.observations.filter(note => note.step_index === step.index).length ?? 0
  const lines = [
    formatHeader(view.protocol.name, step.index, view.protocol.steps.length),
    ...wrapText(`${step.index}. ${step.title}`, CHARS_PER_LINE).slice(0, 2),
    ...wrapText(step.action, CHARS_PER_LINE).slice(0, 4),
    '',
    `Notes: ${noteCount}  Progress: ${step.index}/${view.protocol.steps.length}`,
    truncate(`Last: ${view.lastCommand || 'awaiting command'}`, CHARS_PER_LINE),
    truncate(view.statusText, CHARS_PER_LINE),
  ]
  return padLines(lines)
}

function buildScreen(view: GlassesView) {
  switch (view.mode) {
    case 'startup':
      return buildStartupScreen(view)
    case 'note':
      return buildNoteScreen(view)
    case 'ended':
      return buildEndedScreen(view)
    default:
      return buildStepScreen(view)
  }
}

export class GlassesDisplay {
  private bridge!: Awaited<ReturnType<typeof waitForEvenAppBridge>>
  private isContainerReady = false
  private lastContent = ''
  private queuedContent = ''
  private renderTimer: number | null = null
  private flashTimer: number | null = null
  private unsubscribers: Array<() => void> = []

  static async create() {
    const display = new GlassesDisplay()
    await display.init()
    return display
  }

  private async init() {
    this.bridge = await waitForEvenAppBridge()

    const container = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 8,
      containerID: CONTAINER_ID,
      containerName: CONTAINER_NAME,
      content: 'Preparing ProtoScribe…',
      isEventCapture: 1,
    })

    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [container],
      }),
    )

    if (result !== 0) {
      console.warn(`ProtoScribe preview mode: createStartUpPageContainer failed with code ${result}`)
      this.isContainerReady = false
      return
    }

    this.isContainerReady = true
  }

  getBridge() {
    return this.bridge
  }

  subscribeEvents(callback: Parameters<typeof this.bridge.onEvenHubEvent>[0]) {
    const unsubscribe = this.bridge.onEvenHubEvent(callback)
    this.unsubscribers.push(unsubscribe)
    return unsubscribe
  }

  async setMicrophoneEnabled(isEnabled: boolean) {
    if (!this.isContainerReady) {
      return
    }
    await this.bridge.audioControl(isEnabled)
  }

  render(view: GlassesView) {
    this.queueRender(buildScreen(view))
  }

  flashNoteSaved(stepIndex: number) {
    const lines = [
      `${APP_NAME} · note saved`,
      '',
      `Step ${stepIndex}`,
      '',
      'Observation captured.',
      '',
      'Continue speaking',
      'or say "read last note".',
    ]
    this.flash(padLines(lines), 1800)
  }

  flash(content: string, durationMs: number) {
    if (this.flashTimer !== null) {
      window.clearTimeout(this.flashTimer)
    }
    this.queueRender(content, true)
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null
      this.lastContent = ''
    }, durationMs)
  }

  private queueRender(content: string, immediate = false) {
    this.queuedContent = content

    if (immediate) {
      void this.commitRender()
      return
    }

    if (this.renderTimer !== null) {
      return
    }

    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null
      void this.commitRender()
    }, 120)
  }

  private async commitRender() {
    if (!this.isContainerReady) {
      return
    }

    if (!this.queuedContent || this.queuedContent === this.lastContent) {
      return
    }

    this.lastContent = this.queuedContent
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_ID,
        containerName: CONTAINER_NAME,
        content: this.queuedContent,
      }),
    )
  }

  async shutdown() {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }
    this.unsubscribers = []
    if (this.isContainerReady) {
      await this.bridge.audioControl(false)
    }
  }
}

export function isDoubleTap(eventType: OsEventTypeList | null) {
  return eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
}

export function isSystemExit(eventType: OsEventTypeList | null) {
  return (
    eventType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    eventType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  )
}
