import audioContract from '../../shared/audio-contract.json' with { type: 'json' }

const effectNames = new Set(audioContract.effects)
export const alarmTones = audioContract.alarmTones
export const allowedAudioExtensions = audioContract.allowedExtensions
export const maxCustomToneBytes = audioContract.maxCustomToneBytes
export const audioMimeTypes = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}
let effectsEnabled = false
let effectVolume = 0.25
let lastClickAt = 0
let activeAlarmAudio
let activePreviewAudio
const activeEffects = new Map()

export function configureSoundEffects(enabled, volume) {
  effectsEnabled = enabled === true
  effectVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.25
}

export function playSoundEffect(name) {
  if (!effectsEnabled || !effectNames.has(name) || typeof Audio === 'undefined') return
  const now = Date.now()
  if (name === 'ui-click') {
    if (now - lastClickAt < 90) return
    lastClickAt = now
  }

  try {
    activeEffects.get(name)?.pause()
    const audio = new Audio(`/sounds/${name}.wav`)
    activeEffects.set(name, audio)
    audio.volume = effectVolume
    audio.addEventListener('ended', () => {
      if (activeEffects.get(name) === audio) activeEffects.delete(name)
    }, { once: true })
    audio.addEventListener('error', () => {
      if (activeEffects.get(name) === audio) activeEffects.delete(name)
    }, { once: true })
    const playback = audio.play()
    if (playback && typeof playback.catch === 'function') playback.catch(() => {})
  } catch {
    // Audio is an enhancement; unavailable or blocked playback should not affect the action.
  }
}

export function playAlarmTone(source, volume = 0.7, loop = false, onEnded) {
  if (!source || typeof Audio === 'undefined') return
  stopAlarmTone()
  try {
    activeAlarmAudio = new Audio(source)
    activeAlarmAudio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.7
    activeAlarmAudio.loop = loop
    const audio = activeAlarmAudio
    if (onEnded) audio.addEventListener('ended', onEnded, { once: true })
    const playback = audio.play()
    if (playback && typeof playback.catch === 'function') {
      playback.catch(() => {
        if (activeAlarmAudio === audio) {
          activeAlarmAudio = undefined
          onEnded?.()
        }
      })
    }
  } catch {
    activeAlarmAudio = undefined
  }
}

export function stopAlarmTone() {
  if (!activeAlarmAudio) return
  activeAlarmAudio.pause()
  activeAlarmAudio.currentTime = 0
  activeAlarmAudio = undefined
}

export function playTonePreview(source, volume, onEnded) {
  stopTonePreview()
  if (!source || typeof Audio === 'undefined') {
    onEnded?.()
    return
  }
  try {
    const audio = new Audio(source)
    activePreviewAudio = audio
    audio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.7
    const finish = () => {
      if (activePreviewAudio !== audio) return
      activePreviewAudio = undefined
      onEnded?.()
    }
    audio.addEventListener('ended', finish, { once: true })
    audio.addEventListener('error', finish, { once: true })
    const playback = audio.play()
    if (playback && typeof playback.catch === 'function') playback.catch(finish)
  } catch {
    activePreviewAudio = undefined
    onEnded?.()
  }
}

export function stopTonePreview() {
  if (!activePreviewAudio) return
  const audio = activePreviewAudio
  activePreviewAudio = undefined
  audio.pause()
  audio.currentTime = 0
}

export function isValidAudioBytes(extension, bytes) {
  if (!audioContract.allowedExtensions.includes(extension) || !(bytes instanceof Uint8Array)) return false
  if (!bytes.length || bytes.length > audioContract.maxCustomToneBytes) return false
  if (extension === '.wav') return bytes.length > 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE'
  if (extension === '.ogg') return String.fromCharCode(...bytes.slice(0, 4)) === 'OggS'
  if (extension === '.mp3') {
    return String.fromCharCode(...bytes.slice(0, 3)) === 'ID3'
      || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  }
  return bytes.length > 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
}
