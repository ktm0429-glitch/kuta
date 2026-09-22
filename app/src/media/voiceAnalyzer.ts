import type { VoiceStats } from '../scoring'

// マイクの音声から「声量」と「抑揚(ピッチのばらつき)」を簡易解析する。
// 音声データそのものは保存せず、解析した数値だけをメモリ上に保持する。

function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

// 自己相関法による簡易ピッチ検出(教育目的の簡易実装。医療/音楽用途の精度はない)
function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  const SIZE = buf.length
  let rmsVal = rms(buf)
  if (rmsVal < 0.01) return null // 無音に近い

  let r1 = 0
  let r2 = SIZE - 1
  const threshold = 0.2
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < threshold) {
      r1 = i
      break
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < threshold) {
      r2 = SIZE - i
      break
    }
  }
  const trimmed = buf.slice(r1, r2)
  const n = trimmed.length
  const c = new Array(n).fill(0)
  for (let lag = 0; lag < n; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag]
    c[lag] = sum
  }
  let d = 0
  while (d < n - 1 && c[d] > c[d + 1]) d++
  let maxVal = -1
  let maxPos = -1
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i]
      maxPos = i
    }
  }
  if (maxPos <= 0) return null
  const freq = sampleRate / maxPos
  if (freq < 70 || freq > 400) return null // 人の声として妥当な範囲外は除外
  return freq
}

export class VoiceAnalyzer {
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private intervalId: number | null = null
  private volumes: number[] = []
  private pitches: number[] = []

  start(stream: MediaStream) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.audioCtx = new AudioCtx()
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 2048
    this.source = this.audioCtx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)

    const buf = new Float32Array(this.analyser.fftSize)
    this.intervalId = window.setInterval(() => {
      if (!this.analyser) return
      this.analyser.getFloatTimeDomainData(buf)
      this.volumes.push(rms(buf))
      const pitch = detectPitch(buf, this.audioCtx!.sampleRate)
      if (pitch !== null) this.pitches.push(pitch)
    }, 200)
  }

  stop(): VoiceStats {
    if (this.intervalId !== null) window.clearInterval(this.intervalId)
    this.source?.disconnect()
    this.audioCtx?.close().catch(() => {})

    const avgVolume =
      this.volumes.length > 0 ? this.volumes.reduce((a, b) => a + b, 0) / this.volumes.length : 0

    let pitchStdDev = 0
    if (this.pitches.length >= 2) {
      const mean = this.pitches.reduce((a, b) => a + b, 0) / this.pitches.length
      const variance =
        this.pitches.reduce((sum, p) => sum + (p - mean) ** 2, 0) / this.pitches.length
      pitchStdDev = Math.sqrt(variance)
    }

    this.volumes = []
    this.pitches = []
    return { avgVolume, pitchStdDev }
  }
}
