import type { VoiceCommand } from './types'

const NUMBER_WORDS = new Map<string, number>([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
])

const FLAG_WORDS = ['contaminated', 'spill', 'spilled', 'broken', 'wrong']

function normalize(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
}

function parseStepNumber(rawValue: string) {
  const numeric = Number.parseInt(rawValue, 10)
  if (Number.isFinite(numeric)) {
    return numeric
  }

  return NUMBER_WORDS.get(rawValue.trim().toLowerCase())
}

export function parseVoiceCommand(input: string): VoiceCommand {
  const rawText = input.trim()
  const normalized = normalize(input)

  if (!normalized) {
    return { kind: 'unknown', rawText }
  }

  const noteMatch = normalized.match(/^(?:note|record)\b[:\s-]*(.+)$/)
  if (noteMatch?.[1]) {
    return {
      kind: 'note',
      noteText: noteMatch[1].trim(),
      rawText,
    }
  }

  if (/^start(?: the)? session$/.test(normalized)) {
    return { kind: 'start_session', rawText }
  }

  if (/^end(?: the)? session$/.test(normalized)) {
    return { kind: 'end_session', rawText }
  }

  if (/^(?:next|next step)$/.test(normalized)) {
    return { kind: 'next', rawText }
  }

  if (/^(?:back|previous|previous step)$/.test(normalized)) {
    return { kind: 'previous', rawText }
  }

  if (/^(?:repeat|repeat step)$/.test(normalized)) {
    return { kind: 'repeat', rawText }
  }

  const gotoMatch = normalized.match(/^go to step (\w+)$/)
  if (gotoMatch?.[1]) {
    const stepNumber = parseStepNumber(gotoMatch[1])
    if (stepNumber) {
      return { kind: 'goto', stepNumber, rawText }
    }
  }

  if (normalized === 'read last note') {
    return { kind: 'read_last_note', rawText }
  }

  if (normalized === 'done' || normalized === 'confirm') {
    return { kind: 'confirm', rawText }
  }

  const flagMatch = normalized.match(/^flag\b[:\s-]*(.*)$/)
  if (flagMatch) {
    const detail = flagMatch[1].trim()
    const flagText = detail || 'flagged'
    return { kind: 'flag', rawText, flagText }
  }

  const detectedWord = FLAG_WORDS.find(word => normalized === word || normalized.startsWith(`${word} `))
  if (detectedWord) {
    return { kind: 'flag', rawText, flagText: detectedWord }
  }

  return { kind: 'unknown', rawText }
}

export function describeCommand(command: VoiceCommand) {
  switch (command.kind) {
    case 'start_session':
      return 'start session'
    case 'end_session':
      return 'end session'
    case 'next':
      return 'next step'
    case 'previous':
      return 'previous step'
    case 'repeat':
      return 'repeat step'
    case 'goto':
      return `go to step ${command.stepNumber ?? '?'}`
    case 'note':
      return `note saved: ${command.noteText ?? ''}`.trim()
    case 'read_last_note':
      return 'read last note'
    case 'confirm':
      return 'confirm step'
    case 'flag':
      return `flag step: ${command.flagText ?? 'flagged'}`
    default:
      return `unrecognized: ${command.rawText}`
  }
}

export function isWarningWord(text: string) {
  const normalized = normalize(text)
  return FLAG_WORDS.some(word => normalized === word || normalized.startsWith(`${word} `))
}
