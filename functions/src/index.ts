import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import corsLib from 'cors'
import { getAnswerKey } from './questionBank'

initializeApp()
const db = getFirestore()
const cors = corsLib({ origin: true })

const ADMIN_KEY = defineSecret('ADMIN_KEY')

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function sanitizeId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpsError('invalid-argument', `${field} が不正です`)
  }
  return value
}

// スタッフの識別には(社員番号のような英数字IDではなく)フルネームを使う。
// Firestoreのドキュメント名として使えるよう、日本語を含む文字列を
// 最低限のルールだけで検証する。
function sanitizeStaffName(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} が不正です`)
  }
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (
    trimmed.length === 0 ||
    trimmed.length > 100 ||
    trimmed === '.' ||
    trimmed === '..' ||
    /[/\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    throw new HttpsError('invalid-argument', `${field} が不正です`)
  }
  return trimmed
}

function staffDocId(storeId: string, staffId: string): string {
  return `${storeId}__${staffId}`
}

interface AnswerInput {
  quizId: string
  choiceId: string
}

/**
 * スタッフをログイン時に登録する。識別子は社員番号のようなIDではなく
 * フルネームを使う(staffIdフィールドにフルネームを格納する)。
 * 既に登録済みの場合はポイントを変更せず、表示名・店舗名だけ更新する。
 * 研修を1つも完了していない段階でも、管理ダッシュボードに氏名・店舗・0ptが
 * 表示されるようにするための明示的な登録ステップ。
 */
export const registerStaff = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    const data = request.data ?? {}
    const storeId = sanitizeId(data.storeId, 'storeId')
    const staffId = sanitizeStaffName(data.staffId, 'staffId')
    const storeName =
      typeof data.storeName === 'string' ? data.storeName.slice(0, 100) : ''
    const displayName =
      typeof data.displayName === 'string' ? data.displayName.slice(0, 100) : ''

    const sDocId = staffDocId(storeId, staffId)
    const staffRef = db.collection('staff').doc(sDocId)
    const storeRef = db.collection('stores').doc(storeId)

    const points = await db.runTransaction(async (tx) => {
      const snap = await tx.get(staffRef)
      if (!snap.exists) {
        tx.set(staffRef, {
          storeId,
          staffId,
          displayName,
          points: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return 0
      }
      tx.set(
        staffRef,
        {
          storeId,
          staffId,
          displayName,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return snap.data()?.points ?? 0
    })

    await storeRef.set({ storeId, storeName: storeName || storeId }, { merge: true })

    return { points }
  },
)

/**
 * スタッフが研修モジュールを完了したときに呼び出す。
 * 採点はサーバー側の answerKeys を正として行い、
 * completions ドキュメントの存在チェックで二重付与を防ぐ。
 */
export const completeTraining = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    const data = request.data ?? {}
    const storeId = sanitizeId(data.storeId, 'storeId')
    const staffId = sanitizeStaffName(data.staffId, 'staffId')
    const moduleId = sanitizeId(data.moduleId, 'moduleId')
    const storeName =
      typeof data.storeName === 'string' ? data.storeName.slice(0, 100) : ''
    const displayName =
      typeof data.displayName === 'string' ? data.displayName.slice(0, 100) : ''
    const answers: AnswerInput[] = Array.isArray(data.answers)
      ? data.answers
      : []

    const answerKey = getAnswerKey(moduleId)
    if (!answerKey) {
      throw new HttpsError('invalid-argument', '存在しない研修モジュールです')
    }

    let correctCount = 0
    for (const quiz of answerKey.quizzes) {
      const submitted = answers.find((a) => a.quizId === quiz.quizId)
      if (submitted && submitted.choiceId === quiz.correctChoiceId) {
        correctCount += 1
      }
    }
    const total = answerKey.quizzes.length
    const passed = total === 0 || correctCount === total

    if (!passed) {
      return {
        success: false,
        alreadyCompleted: false,
        pointsAwarded: 0,
        correctCount,
        total,
      }
    }

    const sDocId = staffDocId(storeId, staffId)
    const completionId = `${sDocId}__${moduleId}`
    const completionRef = db.collection('completions').doc(completionId)
    const staffRef = db.collection('staff').doc(sDocId)
    const storeRef = db.collection('stores').doc(storeId)

    const result = await db.runTransaction(async (tx) => {
      const completionSnap = await tx.get(completionRef)
      if (completionSnap.exists) {
        const staffSnap = await tx.get(staffRef)
        return {
          alreadyCompleted: true,
          totalPoints: staffSnap.exists ? staffSnap.data()?.points ?? 0 : 0,
        }
      }

      tx.set(completionRef, {
        storeId,
        staffId,
        moduleId,
        correctCount,
        total,
        completedAt: FieldValue.serverTimestamp(),
      })

      tx.set(
        staffRef,
        {
          storeId,
          staffId,
          displayName,
          points: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      tx.set(
        storeRef,
        { storeId, storeName: storeName || storeId },
        { merge: true },
      )

      return { alreadyCompleted: false, totalPoints: null }
    })

    let totalPoints = result.totalPoints
    if (totalPoints === null) {
      const staffSnap = await staffRef.get()
      totalPoints = staffSnap.data()?.points ?? 1
    }

    return {
      success: true,
      alreadyCompleted: result.alreadyCompleted,
      pointsAwarded: result.alreadyCompleted ? 0 : 1,
      correctCount,
      total,
      totalPoints,
    }
  },
)

/**
 * スタッフ本人が自分のポイント・完了状況を確認するために呼び出す。
 * ログイン相当の強い認証は行わず、店舗ID・スタッフIDのみで参照する
 * (社内向け簡易ツールとしての割り切り。詳細は README を参照)。
 */
export const getMyStatus = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    const data = request.data ?? {}
    const storeId = sanitizeId(data.storeId, 'storeId')
    const staffId = sanitizeStaffName(data.staffId, 'staffId')
    const sDocId = staffDocId(storeId, staffId)

    const [staffSnap, completionsSnap] = await Promise.all([
      db.collection('staff').doc(sDocId).get(),
      db
        .collection('completions')
        .where('storeId', '==', storeId)
        .where('staffId', '==', staffId)
        .get(),
    ])

    return {
      points: staffSnap.exists ? staffSnap.data()?.points ?? 0 : 0,
      completedModuleIds: completionsSnap.docs.map((d) => d.data().moduleId as string),
    }
  },
)

function checkAdminKey(req: { headers: Record<string, unknown> }): boolean {
  const provided = req.headers['x-admin-key']
  return typeof provided === 'string' && provided === ADMIN_KEY.value()
}

/**
 * 管理者向け:全店舗のスタッフとポイントの一覧を返す。
 * x-admin-key ヘッダーで簡易認証する。
 */
export const adminListStaff = onRequest(
  { region: 'asia-northeast1', secrets: [ADMIN_KEY] },
  (req, res) => {
    cors(req, res, async () => {
      if (!checkAdminKey(req)) {
        res.status(401).json({ error: 'unauthorized' })
        return
      }
      try {
        const [staffSnap, storeSnap] = await Promise.all([
          db.collection('staff').orderBy('points', 'desc').get(),
          db.collection('stores').get(),
        ])
        const storeNames: Record<string, string> = {}
        storeSnap.forEach((doc) => {
          storeNames[doc.id] = doc.data().storeName ?? doc.id
        })
        const staff = staffSnap.docs.map((doc) => {
          const d = doc.data()
          return {
            storeId: d.storeId,
            storeName: storeNames[d.storeId] ?? d.storeId,
            staffId: d.staffId,
            displayName: d.displayName ?? '',
            points: d.points ?? 0,
          }
        })
        res.json({ staff })
      } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'internal' })
      }
    })
  },
)

/**
 * 管理者向け:ポイントを景品交換等で消費した際に呼び出す。
 */
export const adminRedeemPoints = onRequest(
  { region: 'asia-northeast1', secrets: [ADMIN_KEY] },
  (req, res) => {
    cors(req, res, async () => {
      if (!checkAdminKey(req)) {
        res.status(401).json({ error: 'unauthorized' })
        return
      }
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'method not allowed' })
        return
      }
      try {
        const storeId = sanitizeId(req.body?.storeId, 'storeId')
        const staffId = sanitizeStaffName(req.body?.staffId, 'staffId')
        const amount = Number(req.body?.amount)
        const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : ''

        if (!Number.isInteger(amount) || amount <= 0) {
          res.status(400).json({ error: 'amount must be a positive integer' })
          return
        }

        const sDocId = staffDocId(storeId, staffId)
        const staffRef = db.collection('staff').doc(sDocId)

        const newPoints = await db.runTransaction(async (tx) => {
          const snap = await tx.get(staffRef)
          if (!snap.exists) {
            throw new HttpsError('not-found', 'スタッフが見つかりません')
          }
          const current = snap.data()?.points ?? 0
          if (current < amount) {
            throw new HttpsError('failed-precondition', 'ポイントが不足しています')
          }
          tx.update(staffRef, {
            points: FieldValue.increment(-amount),
            updatedAt: FieldValue.serverTimestamp(),
          })
          tx.set(db.collection('redemptions').doc(), {
            storeId,
            staffId,
            amount,
            note,
            redeemedAt: FieldValue.serverTimestamp(),
          })
          return current - amount
        })

        res.json({ success: true, totalPoints: newPoints })
      } catch (err) {
        if (err instanceof HttpsError) {
          res.status(400).json({ error: err.message })
          return
        }
        console.error(err)
        res.status(500).json({ error: 'internal' })
      }
    })
  },
)
