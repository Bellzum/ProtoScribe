import { describe, expect, it } from 'vitest'

import { parseVoiceCommand } from '../src/lib/commands'

describe('parseVoiceCommand', () => {
  it('parses navigation commands', () => {
    expect(parseVoiceCommand('next step').kind).toBe('next')
    expect(parseVoiceCommand('previous').kind).toBe('previous')
    expect(parseVoiceCommand('repeat').kind).toBe('repeat')
  })

  it('parses go-to step with digits and number words', () => {
    expect(parseVoiceCommand('go to step 4')).toMatchObject({ kind: 'goto', stepNumber: 4 })
    expect(parseVoiceCommand('go to step three')).toMatchObject({ kind: 'goto', stepNumber: 3 })
  })

  it('parses note commands', () => {
    expect(parseVoiceCommand('note media looked cloudy')).toMatchObject({
      kind: 'note',
      noteText: 'media looked cloudy',
    })
    expect(parseVoiceCommand('record culture was bright')).toMatchObject({
      kind: 'note',
      noteText: 'culture was bright',
    })
  })

  it('parses step confirmation and warnings', () => {
    expect(parseVoiceCommand('read last note').kind).toBe('read_last_note')
    expect(parseVoiceCommand('start session').kind).toBe('start_session')
    expect(parseVoiceCommand('end session').kind).toBe('end_session')
  })
})
