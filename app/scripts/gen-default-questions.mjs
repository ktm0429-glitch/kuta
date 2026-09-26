// apps-script/Code.gs のサンプル問題(DEFAULT_QUESTIONS)から、画面に同梱する問題
// (src/defaultQuestions.ts)を作る。サンプル問題を変えたら `npm run gen:questions` を実行する。
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8')
const ctx = {}
vm.createContext(ctx)
vm.runInContext(src.slice(src.indexOf('var ASK_PHRASES'), src.indexOf('// ---- スプレッドシート ----')), ctx)
vm.runInContext(src.slice(src.indexOf('var JUDGMENT_IDS_'), src.indexOf('\n', src.indexOf('var JUDGMENT_IDS_'))), ctx)
const questions = vm.runInContext('DEFAULT_QUESTIONS', ctx).map((q) => ({
  id: q.id,
  ageBand: q.age,
  category: vm.runInContext('JUDGMENT_IDS_', ctx)[q.id] ? '判断の境界' : '遊技延長',
  situation: q.situation,
  customerLine: q.line,
  modelAnswer: q.model,
  checkpoints: q.points.filter(Boolean).map(([label, phrases]) => ({
    label,
    phrases: phrases.split(/[/／、,，\n]/).map((s) => s.trim()).filter(Boolean),
  })),
  explanation: q.explain,
  ngExample: q.ng,
}))
const out = `import type { QuizQuestion } from './types'

// 通信が遅い・つながらないときや初めて使うときでも、すぐ研修を始められるように
// 画面に同梱しておく問題。apps-script/Code.gs のサンプル問題から自動生成している
// (編集しないこと。サンプル問題を変えたら \`npm run gen:questions\` で作り直す)。
// 本社が「問題」シートで編集した内容は、通信できた時点で差し替わる。
export const defaultQuestions: QuizQuestion[] = ${JSON.stringify(questions, null, 2)}
`
fs.writeFileSync(new URL('../src/defaultQuestions.ts', import.meta.url), out)
console.log(`src/defaultQuestions.ts: ${questions.length}問`)
