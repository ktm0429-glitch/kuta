import { isSpeechRecognitionSupported } from './speechToText'

// このアプリは音声認識(Web Speech API)に対応したブラウザでは「マイクで回答する」
// (録音+自動文字起こし+声のトーン採点)を使う。対応していないブラウザ(iPhone/iPad・
// Firefoxなど)では、締め出さずにテキスト入力での代替手段を案内する
// (iPhoneならキーボード標準のマイクボタンで音声入力もできる)。

export function isIOS(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS はデスクトップ版Safariと同じUAを返すことがあるため、タッチ対応のMacとして判定する
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

// 「マイクで回答する」(録音+声のトーン採点つき)モードが使えるブラウザかどうか。
// false の場合はテキスト入力モードにフォールバックする(締め出しはしない)。
export function isVoiceModeSupported(): boolean {
  // iOS/iPadOSは window.webkitSpeechRecognition が「存在するだけで実際には
  // 結果を返さないダミー」になっている場合があり、存在チェックだけでは
  // 誤判定してしまう(録音しても毎回「聞き取れませんでした」になる不具合の原因)。
  // そのためiOSでは機能検出の結果に関わらず、常にテキスト入力モードを使う。
  if (isIOS()) return false
  return isSpeechRecognitionSupported() && !!navigator.mediaDevices?.getUserMedia
}
