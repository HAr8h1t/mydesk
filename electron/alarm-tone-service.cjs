const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const extensions = new Set(['.mp3', '.wav', '.ogg', '.m4a'])
const maxToneBytes = 20 * 1024 * 1024
const mimeTypes = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

function hasValidAudioSignature(extension, bytes) {
  if (extension === '.wav') return bytes.subarray(0, 4).toString() === 'RIFF'
    && bytes.subarray(8, 12).toString() === 'WAVE'
  if (extension === '.ogg') return bytes.subarray(0, 4).toString() === 'OggS'
  if (extension === '.mp3') {
    return bytes.subarray(0, 3).toString() === 'ID3'
      || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  }
  return bytes.subarray(4, 8).toString() === 'ftyp'
}

class AlarmToneService {
  constructor(directory) {
    this.directory = directory
  }

  async store(sourcePath) {
    const extension = path.extname(sourcePath).toLowerCase()
    if (!extensions.has(extension)) throw new TypeError('Choose an MP3, WAV, OGG, or M4A audio file.')
    const bytes = await fs.readFile(sourcePath)
    if (!bytes.length || bytes.length > maxToneBytes) {
      throw new RangeError('The alarm ringtone must be smaller than 20 MB.')
    }
    if (!hasValidAudioSignature(extension, bytes)) {
      throw new TypeError('The selected file is not a valid supported audio file.')
    }

    await fs.mkdir(this.directory, { recursive: true })
    const tone = {
      type: 'custom',
      id: randomUUID(),
      name: path.basename(sourcePath).slice(0, 120),
      extension,
    }
    await fs.writeFile(this.filePath(tone.id, extension), bytes, { flag: 'wx' })
    return tone
  }

  async dataUrl(id, extension) {
    if (!this.isManagedTone({ id, extension })) throw new TypeError('The requested alarm ringtone is invalid.')
    try {
      const bytes = await fs.readFile(this.filePath(id, extension))
      if (!bytes.length || bytes.length > maxToneBytes || !hasValidAudioSignature(extension, bytes)) return null
      return `data:${mimeTypes[extension]};base64,${bytes.toString('base64')}`
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async remove(id, extension) {
    if (!this.isManagedTone({ id, extension })) return
    try {
      await fs.unlink(this.filePath(id, extension))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  isManagedTone(tone) {
    return typeof tone?.id === 'string'
      && /^[0-9a-f-]{36}$/i.test(tone.id)
      && extensions.has(tone.extension)
  }

  filePath(id, extension) {
    return path.join(this.directory, `${id}${extension}`)
  }
}

module.exports = { AlarmToneService, hasValidAudioSignature }
