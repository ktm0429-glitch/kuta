// ブラウザ内蔵の音声認識(Web Speech API)のラッパー。
// iOS Safari は非対応(2026年時点)。その場合 isSupported() が false を返す。

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: unknown) => void) | null
  onend: (() => void) | null
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null
}

export class SpeechToText {
  private recognition: SpeechRecognitionLike | null = null
  private finalText = ''
  private interimText = ''
  private restarting = false
  private stopped = false

  start(onUpdate?: (fullText: string, interim: string) => void) {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    this.stopped = false
    this.finalText = ''
    this.interimText = ''
    const recognition = new Ctor()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (ev) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]
        if (res.isFinal) {
          this.finalText += res[0].transcript
        } else {
          interim += res[0].transcript
        }
      }
      this.interimText = interim
      onUpdate?.(this.finalText, this.interimText)
    }
    // 発話の間が空くと自動的に end してしまうことがあるため、
    // 録画中はこちらから止めるまで自動で再開させる。
    recognition.onend = () => {
      if (!this.stopped) {
        this.restarting = true
        try {
          recognition.start()
        } catch {
          // 既に開始中などのエラーは無視する
        }
        this.restarting = false
      }
    }
    recognition.onerror = () => {
      // no-speech 等のエラーは無視して継続する(onend で再開される)
    }
    this.recognition = recognition
    try {
      recognition.start()
    } catch {
      // 起動できない場合は何もしない(未対応ブラウザ等)
    }
  }

  async stop(): Promise<string> {
    this.stopped = true
    const recognition = this.recognition
    if (this.recognition && !this.restarting) {
      try {
        this.recognition.stop()
      } catch {
        // ignore
      }
    }
    if (recognition) await new Promise<void>(resolve=>{const old=recognition.onend;recognition.onend=()=>{old?.();resolve()};setTimeout(resolve,1200)})
    return (this.finalText + this.interimText).trim()
  }

  getText(): string {
    return (this.finalText + this.interimText).trim()
  }
}
