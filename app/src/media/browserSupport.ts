import { isSpeechRecognitionSupported } from './speechToText'

// このアプリは音声認識(Web Speech API)を使う。ブラウザの「名前」ではなく、
// 実際に必要な機能(音声認識・マイク)が使えるかどうかで判定する。
// これにより、Chromeに限らずEdge・Samsung Internetなど対応ブラウザなら
// 問題なく利用できる(逆に本当に非対応のFirefox・iOS系は引き続きブロックされる)。

function isIOS(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS はデスクトップ版Safariと同じUAを返すことがあるため、タッチ対応のMacとして判定する
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function getUnsupportedReason(): string | null {
  const hasSpeech = isSpeechRecognitionSupported()
  const hasMic = !!navigator.mediaDevices?.getUserMedia

  if (hasSpeech && hasMic) return null

  if (isIOS()) {
    return (
      'iPhone/iPadでは、この研修アプリが必要とする音声認識機能に対応したブラウザがありません' +
      '(Chromeアプリを含め、iOS上のブラウザは音声認識に対応していません)。' +
      'お手数ですが、Androidスマホまたはパソコンで開き直してください。'
    )
  }
  if (!hasSpeech) {
    return (
      'このブラウザは音声認識に対応していません。Google Chrome・Microsoft Edge・' +
      'Samsung Internetなど対応ブラウザで開き直してください。'
    )
  }
  return 'カメラ・マイクの機能が利用できないようです。最新版のブラウザで開き直してください。'
}
