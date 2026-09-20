/**
 * 接客力向上トレーニング用バックエンド(Google Apps Script)
 *
 * ■ 使い方
 * 1. このファイルの中身をすべてコピーする
 * 2. スプレッドシートを開き、上部メニューの「拡張機能」→「Apps Script」を選ぶ
 * 3. エディタに最初から入っているコードを全部消して、コピーした内容を貼り付ける
 * 4. すぐ下にある ADMIN_KEY を、好きな文字列(合言葉)に変更する
 *    (これが管理画面に入るためのパスワードになります)
 * 5. 画面右上の「デプロイ」→「新しいデプロイ」を選ぶ
 *    - 種類の選択(歯車アイコン)で「ウェブアプリ」を選ぶ
 *    - 「実行するユーザー」は「自分」のまま
 *    - 「アクセスできるユーザー」は「全員」にする
 *    - 「デプロイ」ボタンを押す
 * 6. 発行された「ウェブアプリのURL」をコピーし、
 *    app/src/config.ts の中の文字列に貼り付ける
 *
 * データはこのスプレッドシート自身に保存されます。実行すると
 * 「スタッフ」「完了記録」「ポイント調整履歴」という3つのシートが
 * 自動的に作られます(手動で列を用意する必要はありません)。
 */

// ここを好きな文字列に変更してください(第三者に推測されにくいものを推奨します)
var ADMIN_KEY = 'CHANGE_ME_TO_YOUR_OWN_SECRET';

var SHEET_STAFF = 'スタッフ';
var SHEET_COMPLETIONS = '完了記録';
var SHEET_REDEMPTIONS = 'ポイント調整履歴';

var STAFF_HEADERS = ['店舗ID', '店舗名', '氏名', '表示名', 'ポイント', '更新日時'];
var COMPLETION_HEADERS = ['店舗ID', '氏名', 'モジュールID', '正解数', '問題数', '完了日時'];
var REDEMPTION_HEADERS = ['店舗ID', '氏名', '消費ポイント', 'メモ', '日時'];

// ---- 問題の正解データ ----
// app/src/data/questionBank.ts と同じ内容に保つこと。
// 新しい問題を追加したら、ここにも { id, ageBand, correctChoiceId } を1行追加する。
var ANSWER_KEY_ENTRIES = [
  { id: 'young-01', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-02', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-03', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-04', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-05', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-06', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'middle-01', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-02', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-03', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-04', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-05', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-06', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-07', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'senior-01', ageBand: 'senior', correctChoiceId: 'b' },
  { id: 'senior-02', ageBand: 'senior', correctChoiceId: 'b' },
  { id: 'senior-03', ageBand: 'senior', correctChoiceId: 'b' },
  { id: 'senior-04', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-05', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-06', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-07', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-08', ageBand: 'senior', correctChoiceId: 'a' }
];

// モジュールID(app/src/data/trainingContent.ts と一致させること)と年代の対応。
var MODULE_AGE_BAND = {
  'young-customer-basics': 'young',
  'middle-customer-conversation': 'middle',
  'senior-customer-conversation': 'senior'
};

function getAnswerKey_(moduleId) {
  var ageBand = MODULE_AGE_BAND[moduleId];
  if (!ageBand) return null;
  var quizzes = ANSWER_KEY_ENTRIES.filter(function (q) {
    return q.ageBand === ageBand;
  }).map(function (q) {
    return { quizId: q.id, correctChoiceId: q.correctChoiceId };
  });
  return { moduleId: moduleId, quizzes: quizzes };
}

// ---- シート初期化 ----
function ensureSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheets_() {
  return {
    staff: ensureSheet_(SHEET_STAFF, STAFF_HEADERS),
    completions: ensureSheet_(SHEET_COMPLETIONS, COMPLETION_HEADERS),
    redemptions: ensureSheet_(SHEET_REDEMPTIONS, REDEMPTION_HEADERS)
  };
}

// ---- 汎用ヘルパー ----
function findRowIndex_(sheet, storeIdColIdx, staffIdColIdx, storeId, staffId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][storeIdColIdx] === storeId && data[i][staffIdColIdx] === staffId) {
      return i + 1; // シート上の行番号(1始まり)
    }
  }
  return -1;
}

function sanitizeText_(value, maxLen) {
  if (typeof value !== 'string') return '';
  var trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, maxLen || 100);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ---- 入り口 ----
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = {};
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResponse_({ error: 'invalid request body' });
    }

    switch (body.action) {
      case 'register':
        return jsonResponse_(handleRegister_(body));
      case 'complete':
        return jsonResponse_(handleComplete_(body));
      case 'status':
        return jsonResponse_(handleStatus_(body));
      case 'adminList':
        return jsonResponse_(handleAdminList_(body));
      case 'adminRedeem':
        return jsonResponse_(handleAdminRedeem_(body));
      default:
        return jsonResponse_({ error: 'unknown action' });
    }
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return jsonResponse_({ ok: true, message: 'このURLはアプリからのPOST通信専用です。' });
}

// ---- 各アクション ----
function handleRegister_(body) {
  var storeId = sanitizeText_(body.storeId, 50);
  var storeName = sanitizeText_(body.storeName, 100);
  var staffId = sanitizeText_(body.staffId, 100);
  var displayName = sanitizeText_(body.displayName, 100);

  if (!storeId || !staffId) {
    return { error: 'storeId, staffId は必須です' };
  }

  var sheet = sheets_().staff;
  var rowIndex = findRowIndex_(sheet, 0, 2, storeId, staffId);
  var now = new Date();

  if (rowIndex === -1) {
    sheet.appendRow([storeId, storeName || storeId, staffId, displayName, 0, now]);
    return { points: 0 };
  }
  sheet.getRange(rowIndex, 2).setValue(storeName || storeId);
  sheet.getRange(rowIndex, 4).setValue(displayName);
  sheet.getRange(rowIndex, 6).setValue(now);
  var points = Number(sheet.getRange(rowIndex, 5).getValue()) || 0;
  return { points: points };
}

function handleComplete_(body) {
  var storeId = sanitizeText_(body.storeId, 50);
  var storeName = sanitizeText_(body.storeName, 100);
  var staffId = sanitizeText_(body.staffId, 100);
  var displayName = sanitizeText_(body.displayName, 100);
  var moduleId = sanitizeText_(body.moduleId, 100);
  var answers = Array.isArray(body.answers) ? body.answers : [];

  var answerKey = getAnswerKey_(moduleId);
  if (!answerKey) {
    return { error: '存在しない研修モジュールです' };
  }

  var correctCount = 0;
  answerKey.quizzes.forEach(function (quiz) {
    var submitted = answers.filter(function (a) {
      return a.quizId === quiz.quizId;
    })[0];
    if (submitted && submitted.choiceId === quiz.correctChoiceId) {
      correctCount++;
    }
  });
  var total = answerKey.quizzes.length;
  var passed = total === 0 || correctCount === total;

  if (!passed) {
    return {
      success: false,
      alreadyCompleted: false,
      pointsAwarded: 0,
      correctCount: correctCount,
      total: total
    };
  }

  var sheetSet = sheets_();

  // 完了記録の重複チェック(同じ研修で二重にポイントが付かないようにする)
  var compData = sheetSet.completions.getDataRange().getValues();
  var alreadyCompleted = false;
  for (var r = 1; r < compData.length; r++) {
    if (compData[r][0] === storeId && compData[r][1] === staffId && compData[r][2] === moduleId) {
      alreadyCompleted = true;
      break;
    }
  }

  var now = new Date();

  if (!alreadyCompleted) {
    sheetSet.completions.appendRow([storeId, staffId, moduleId, correctCount, total, now]);

    var staffRowIndex = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
    if (staffRowIndex === -1) {
      sheetSet.staff.appendRow([storeId, storeName || storeId, staffId, displayName, 1, now]);
    } else {
      var currentPoints = Number(sheetSet.staff.getRange(staffRowIndex, 5).getValue()) || 0;
      sheetSet.staff.getRange(staffRowIndex, 5).setValue(currentPoints + 1);
      sheetSet.staff.getRange(staffRowIndex, 6).setValue(now);
      if (storeName) sheetSet.staff.getRange(staffRowIndex, 2).setValue(storeName);
      if (displayName) sheetSet.staff.getRange(staffRowIndex, 4).setValue(displayName);
    }
  }

  var totalPoints = 0;
  var finalRowIndex = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
  if (finalRowIndex !== -1) {
    totalPoints = Number(sheetSet.staff.getRange(finalRowIndex, 5).getValue()) || 0;
  }

  return {
    success: true,
    alreadyCompleted: alreadyCompleted,
    pointsAwarded: alreadyCompleted ? 0 : 1,
    correctCount: correctCount,
    total: total,
    totalPoints: totalPoints
  };
}

function handleStatus_(body) {
  var storeId = sanitizeText_(body.storeId, 50);
  var staffId = sanitizeText_(body.staffId, 100);

  var sheetSet = sheets_();
  var staffRowIndex = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
  var points = 0;
  if (staffRowIndex !== -1) {
    points = Number(sheetSet.staff.getRange(staffRowIndex, 5).getValue()) || 0;
  }

  var compData = sheetSet.completions.getDataRange().getValues();
  var completedModuleIds = [];
  for (var r = 1; r < compData.length; r++) {
    if (compData[r][0] === storeId && compData[r][1] === staffId) {
      completedModuleIds.push(compData[r][2]);
    }
  }

  return { points: points, completedModuleIds: completedModuleIds };
}

function checkAdminKey_(body) {
  return typeof body.adminKey === 'string' && body.adminKey === ADMIN_KEY;
}

function handleAdminList_(body) {
  if (!checkAdminKey_(body)) {
    return { error: 'unauthorized' };
  }
  var sheet = sheets_().staff;
  var data = sheet.getDataRange().getValues();
  var staff = [];
  for (var i = 1; i < data.length; i++) {
    staff.push({
      storeId: data[i][0],
      storeName: data[i][1],
      staffId: data[i][2],
      displayName: data[i][3],
      points: Number(data[i][4]) || 0
    });
  }
  staff.sort(function (a, b) {
    return b.points - a.points;
  });
  return { staff: staff };
}

function handleAdminRedeem_(body) {
  if (!checkAdminKey_(body)) {
    return { error: 'unauthorized' };
  }
  var storeId = sanitizeText_(body.storeId, 50);
  var staffId = sanitizeText_(body.staffId, 100);
  var amount = Number(body.amount);
  var note = sanitizeText_(body.note, 200);

  if (!storeId || !staffId || !Number.isInteger(amount) || amount <= 0) {
    return { error: 'invalid request' };
  }

  var sheetSet = sheets_();
  var rowIndex = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
  if (rowIndex === -1) {
    return { error: 'スタッフが見つかりません' };
  }
  var currentPoints = Number(sheetSet.staff.getRange(rowIndex, 5).getValue()) || 0;
  if (currentPoints < amount) {
    return { error: 'ポイントが不足しています' };
  }
  var newPoints = currentPoints - amount;
  sheetSet.staff.getRange(rowIndex, 5).setValue(newPoints);
  sheetSet.staff.getRange(rowIndex, 6).setValue(new Date());
  sheetSet.redemptions.appendRow([storeId, staffId, amount, note, new Date()]);

  return { success: true, totalPoints: newPoints };
}
