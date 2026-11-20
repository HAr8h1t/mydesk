import assert from 'node:assert/strict'
import test from 'node:test'
import { countWords, plainText } from './note-utils.js'

test('note previews remove Markdown markers while preserving readable text', () => {
  const markdown = '# **Ideas**\n\n- [x] Plan *release*\n\n> Keep this close'
  assert.equal(plainText(markdown), 'Ideas Plan release Keep this close')
})

test('word counts handle empty text and repeated whitespace', () => {
  assert.equal(countWords('   '), 0)
  assert.equal(countWords('one   two\nthree'), 3)
})
