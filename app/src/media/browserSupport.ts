// このアプリは音声認識(Web Speech API)を使うため、Google Chromeでの利用を前提にしている。
// 未対応ブラウザでは、あいまいな挙動にせず、はっきりと利用できない旨を伝える。

function isIOS(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS はデスクトップ版Safariと同じUAを返すことがあるため、タッチ対応のMacとして判定する
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isChrome(): boolean {
  const ua = navigator.userAgent
  // Edge・Opera・Samsung Internet 等のChromiumベースブラウザはChromeを名乗らないUAを含むため除外。
  // iOS上の「Chrome」はWebKitベースでWeb Speech APIが使えないため、Chromeとして扱わない。
  if (isIOS()) return false
  return /Chrome\//.test(ua) && !/Edg\/|OPR\/|SamsungBrowser\//.test(ua)
}

export function getUnsupportedReason(): string | null {
  if (isIOS()) {
    return (
      'iPhone/iPadでは、この研修アプリが必要とする音声認識機能に対応したブラウザがありません' +
      '(Chromeアプリを含め、iOS上のブラウザは音声認識に対応していません)。' +
      'お手数ですが、Androidスマホまたはパソコンで、Google Chromeを使って開き直してください。'
    )
  }
  if (!isChrome()) {
    return 'この研修アプリはGoogle Chromeでのご利用が必要です。Chromeで開き直してください。'
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'カメラ・マイクの機能が利用できないようです。最新版のGoogle Chromeで開き直してください。'
  }
  return null
}
