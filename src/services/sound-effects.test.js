import assert from 'node:assert/strict'
import test from 'node:test'
import { configureSoundEffects, isValidAudioBytes, playSoundEffect } from './sound-effects.js'

test('accepts supported audio signatures and rejects mismatched extensions', () => {
  const wav = new Uint8Array(16)
  wav.set([82, 73, 70, 70], 0)
  wav.set([87, 65, 86, 69], 8)
  assert.equal(isValidAudioBytes('.wav', wav), true)
  assert.equal(isValidAudioBytes('.ogg', new Uint8Array([79, 103, 103, 83])), true)
  assert.equal(isValidAudioBytes('.wav', new Uint8Array([79, 103, 103, 83])), false)
  assert.equal(isValidAudioBytes('.exe', wav), false)
})

test('throttles rapid clicks and respects the enabled and volume settings', () => {
  const originalAudio = globalThis.Audio
  const originalNow = Date.now
  const played = []
  class MockAudio {
    constructor(source) {
      this.source = source
    }

    addEventListener() {}
    pause() {}
    play() {
      played.push({ source: this.source, volume: this.volume })
      return Promise.resolve()
    }
  }
  globalThis.Audio = MockAudio
  let now = 1000
  Date.now = () => now
  try {
    configureSoundEffects(true, 0.4)
    playSoundEffect('ui-click')
    now += 50
    playSoundEffect('ui-click')
    now += 40
    playSoundEffect('ui-click')
    assert.equal(played.length, 2)
    assert.equal(played[0].volume, 0.4)
    assert.equal(played[0].source, '/sounds/ui-click.wav')

    configureSoundEffects(false, 0.4)
    playSoundEffect('task-complete')
    assert.equal(played.length, 2)
  } finally {
    configureSoundEffects(false, 0.25)
    Date.now = originalNow
    if (originalAudio === undefined) delete globalThis.Audio
    else globalThis.Audio = originalAudio
  }
})
