import type { ExpressionSample } from '../scoring'

// 表情解析には Google の MediaPipe Tasks Vision (FaceLandmarker) を使う。
// npm には含めず、初回録画時にCDNから動的読み込みする(通常のページ表示を軽くするため)。
// モデル読み込みに失敗した場合(オフライン・CDNブロック等)は、表情解析なしで
// 音声・内容のみの採点にフォールバックする。

const VISION_BUNDLE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs'
const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

interface Blendshape {
  categoryName: string
  score: number
}
interface FaceLandmarkerResultLike {
  faceLandmarks: unknown[][]
  faceBlendshapes?: { categories: Blendshape[] }[]
}
interface FaceLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResultLike
  close(): void
}

let cachedLandmarkerPromise: Promise<FaceLandmarkerLike | null> | null = null

async function loadFaceLandmarker(): Promise<FaceLandmarkerLike | null> {
  if (!cachedLandmarkerPromise) {
    cachedLandmarkerPromise = (async () => {
      try {
        const vision = await import(/* @vite-ignore */ VISION_BUNDLE_URL)
        const resolver = await vision.FilesetResolver.forVisionTasks(WASM_BASE_URL)
        const landmarker = await vision.FaceLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        })
        return landmarker as FaceLandmarkerLike
      } catch {
        return null
      }
    })()
  }
  return cachedLandmarkerPromise
}

export class FaceAnalyzer {
  private landmarker: FaceLandmarkerLike | null = null
  private intervalId: number | null = null
  private samples: ExpressionSample[] = []
  private videoEl: HTMLVideoElement | null = null
  supported = true

  async start(videoEl: HTMLVideoElement) {
    this.videoEl = videoEl
    this.landmarker = await loadFaceLandmarker()
    if (!this.landmarker) {
      this.supported = false
      return
    }
    this.intervalId = window.setInterval(() => {
      if (!this.landmarker || !this.videoEl) return
      try {
        const result = this.landmarker.detectForVideo(this.videoEl, performance.now())
        const hasFace = result.faceLandmarks.length > 0
        let smile = 0
        if (hasFace && result.faceBlendshapes && result.faceBlendshapes[0]) {
          const cats = result.faceBlendshapes[0].categories
          const left = cats.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0
          const right = cats.find((c) => c.categoryName === 'mouthSmileRight')?.score ?? 0
          smile = (left + right) / 2
        }
        this.samples.push({ faceDetected: hasFace, smile })
      } catch {
        // 1フレームの解析失敗は無視して続行する
      }
    }, 300)
  }

  stop(): ExpressionSample[] {
    if (this.intervalId !== null) window.clearInterval(this.intervalId)
    const samples = this.samples
    this.samples = []
    return samples
  }
}
