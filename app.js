/* Hakadory (web) - 作業 / 休憩 / 長休憩 を区別できるラップ付きストップウォッチ。
 *
 * デスクトップ版 (別リポジトリの Hakadory.py) の計測・集計・通知の仕様をそのまま移植し、
 * ブラウザで動かせないもの（グローバルショートカット）を外し、
 * ミニ表示をドキュメントピクチャーインピクチャーに置き換えたもの。
 *
 * データはすべてこのブラウザの localStorage に置く。外部への送信は一切しない。
 */
'use strict';

const WORK = 'work';
const BREAK = 'break';
const LONG_BREAK = 'long_break';

const LAP_TYPES = [WORK, BREAK, LONG_BREAK];
const TYPE_LABEL = { work: '作業', break: '休憩', long_break: '長休憩' };
const TYPE_CLASS = { work: 'type-work', break: 'type-break', long_break: 'type-long' };
const DEFAULT_MINUTES = { work: '25', break: '5', long_break: '30' };
const DEFAULT_REPEAT_MINUTES = '5';

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']; // 月曜始まり
const DEFAULT_AUTO_START_TIME = '09:00';
const DEFAULT_AUTO_END_TIME = '18:00';
const DEFAULT_AUTO_START_DAYS = [0, 1, 2, 3, 4];

// 合計は休憩と長休憩をまとめて出す（ラップ一覧では種別のまま残る）
const SUMMARY_GROUPS = [
  { text: '作業', types: [WORK], ref: 'sumWork' },
  { text: '休憩（長休憩含む）', types: [BREAK, LONG_BREAK], ref: 'sumBreak' },
];

const THEME_NAMES = ['standard', 'dark', 'light'];
const DEFAULT_THEME = 'standard';
const SETTINGS_KEY = 'Hakadory.settings';
const SESSION_KEY = 'Hakadory.session';
const TICK_MS = 50;

// ---------------------------------------------------------------- 小さな道具

/** 秒を H:MM:SS(.cc) の文字列にする。 */
function formatTime(seconds, centis = true) {
  if (!(seconds > 0)) seconds = 0;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${hours}:${pad(minutes)}:${pad(secs)}`;
  if (!centis) return base;
  return `${base}.${pad(Math.floor((seconds - total) * 100))}`;
}

/** "9:00" のような文字列を [時, 分] にする。不正なら null。 */
function parseTimeOfDay(text) {
  const parts = String(text ?? '').trim().split(':');
  if (parts.length !== 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return [hour, minute];
}

/** 月曜を 0 とする曜日番号（Python の datetime.weekday() と同じ並び）。 */
function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function stamp(date, target) {
  return `${date.toDateString()}|${target[0]}:${target[1]}`;
}

const $ = (id) => document.getElementById(id);
const now = () => Date.now() / 1000;

/* ミニ表示は小窓（別ドキュメント）へ移すため、id では引けなくなる。
 * 更新のたびに使う部品は最初に捕まえておく。 */
const ui = {};
const UI_IDS = [
  'total', 'lap', 'lap-title', 'alert-hint', 'sum-work', 'sum-break',
  'start', 'lap-rows', 'auto-start-hint', 'auto-end-hint', 'keep-awake-hint',
  'toast', 'mini', 'mini-total', 'mini-lap', 'mini-hint', 'mini-type', 'mini-start',
];

function cacheUi() {
  for (const id of UI_IDS) {
    ui[id.replace(/-(.)/g, (_, c) => c.toUpperCase())] = $(id);
  }
}

// ---------------------------------------------------------------- 状態

const state = {
  running: false,
  totalBase: 0,   // 停止中までに積み上げた総時間
  totalMark: 0,   // 直近に走り出した時刻
  lapBase: 0,     // 現在ラップの停止中までの経過
  lapMark: 0,
  currentType: WORK,
  laps: [],                                   // 確定したラップ
  sums: { work: 0, break: 0, long_break: 0 }, // 確定ラップだけの種別合計
  nextAlert: null,                            // 次に鳴らすラップ内経過秒
  startedAt: null,                            // 計測開始（壁時計、ミリ秒）
  lapStartedAt: null,                         // 現在ラップ開始（壁時計、ミリ秒）
  autoStartDone: null,
  autoEndDone: null,
};

const settings = {
  theme: DEFAULT_THEME,
  alertEnabled: true,
  alertRepeat: false,
  alertMinutes: { ...DEFAULT_MINUTES },
  alertRepeatMinutes: DEFAULT_REPEAT_MINUTES,
  autoStartEnabled: false,
  autoStartTime: DEFAULT_AUTO_START_TIME,
  autoEndEnabled: false,
  autoEndTime: DEFAULT_AUTO_END_TIME,
  autoStartDays: [...DEFAULT_AUTO_START_DAYS],
  keepAwake: false,
};

function totalElapsed() {
  return state.running ? state.totalBase + (now() - state.totalMark) : state.totalBase;
}

function lapElapsed() {
  return state.running ? state.lapBase + (now() - state.lapMark) : state.lapBase;
}

/** 確定ラップの合計に、進行中ラップの分も足した値。 */
function liveSum(type) {
  return state.sums[type] + (type === state.currentType ? lapElapsed() : 0);
}

function groupSum(types) {
  return types.reduce((total, type) => total + liveSum(type), 0);
}

// ---------------------------------------------------------------- 計測

function start() {
  const mark = now();
  state.totalMark = mark;
  state.lapMark = mark;
  state.running = true;
  if (state.startedAt === null) state.startedAt = Date.now();
  if (state.lapStartedAt === null) state.lapStartedAt = Date.now();
}

function pause() {
  const mark = now();
  state.totalBase += mark - state.totalMark;
  state.lapBase += mark - state.lapMark;
  state.running = false;
}

function toggleRun() {
  if (state.running) pause(); else start();
  refresh();
  saveSession();
}

/** 現在のラップを確定し、指定種別で新しいラップを開始する。 */
function lap(type) {
  if (!state.running && totalElapsed() === 0) {
    // 未計測なら、押した種別でそのまま計測を開始する
    state.currentType = type;
    start();
    resetAlert();
    refresh();
    saveSession();
    return;
  }

  const duration = lapElapsed();
  if (duration > 0) {
    state.sums[state.currentType] += duration;
    state.laps.push({
      type: state.currentType,
      duration,
      total: totalElapsed(),
      startedAt: state.lapStartedAt,
      endedAt: Date.now(),
    });
    insertLapRow(state.laps.length, state.laps[state.laps.length - 1]);
  }

  state.currentType = type;
  state.lapBase = 0;
  state.lapMark = now();
  state.lapStartedAt = Date.now();
  resetAlert();
  refresh();
  saveSession();
}

function reset() {
  if ((totalElapsed() > 0 || state.laps.length) &&
      !window.confirm('計測とラップをすべて消去します。')) {
    return;
  }
  state.running = false;
  state.totalBase = 0;
  state.lapBase = 0;
  state.currentType = WORK;
  state.startedAt = null;
  state.lapStartedAt = null;
  state.laps = [];
  state.sums = { work: 0, break: 0, long_break: 0 };
  ui.lapRows.textContent = '';
  resetAlert();
  refresh();
  saveSession();
}

// ---------------------------------------------------------------- 通知音

let audioContext = null;

/** 音は最初の操作より前には出せないので、押されたときに用意する。 */
function playSound() {
  try {
    if (audioContext === null) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      audioContext = new Ctor();
    }
    if (audioContext.state === 'suspended') audioContext.resume();

    const at = audioContext.currentTime;
    for (const [offset, frequency] of [[0, 880], [0.18, 660]]) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, at + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.16);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.2);
    }
  } catch (error) {
    // 音が出せない環境でも計測は続ける
  }
}

/** 現在の種別に設定された通知間隔（秒）。無効なら null。 */
function alertSeconds() {
  if (!settings.alertEnabled) return null;
  const minutes = Number(settings.alertMinutes[state.currentType]);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes * 60;
}

/** 繰り返し通知の間隔（秒）。未指定なら最初の通知と同じ間隔。 */
function repeatSeconds() {
  const minutes = Number(settings.alertRepeatMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return alertSeconds();
  return minutes * 60;
}

/** 設定値と現在のラップ経過から、次に鳴らす時刻を決め直す。 */
function resetAlert() {
  const step = alertSeconds();
  const elapsed = lapElapsed();
  if (step === null) {
    state.nextAlert = null;
  } else if (elapsed < step) {
    state.nextAlert = step;
  } else if (settings.alertRepeat) {
    const repeat = repeatSeconds() || step;
    state.nextAlert = step + repeat * (Math.floor((elapsed - step) / repeat) + 1);
  } else {
    state.nextAlert = null; // 通知済みのラップでは鳴らさない
  }
  updateAlertHint();
}

/** 通知音を鳴らす。計測は止めず、そのまま進み続ける。 */
function fireAlert() {
  playSound();
  flash();
  resetAlert();
}

/** 通知に気づけるよう、ラップ時間の文字を数回点滅させる。 */
function flash() {
  for (const el of [ui.lap, ui.miniLap]) {
    el.classList.remove('flash');
    void el.offsetWidth; // アニメーションをやり直させる
    el.classList.add('flash');
  }
}

function updateAlertHint() {
  const text = state.nextAlert === null
    ? '通知なし'
    : `通知まで ${formatTime(Math.max(state.nextAlert - lapElapsed(), 0), false)}`;
  ui.alertHint.textContent = text;
  ui.miniHint.textContent = text;
}

// ---------------------------------------------------------------- Markdown 書き出し

/** 確定ラップに、進行中のラップを末尾に足した書き出し用の一覧。 */
function lapRows() {
  const rows = state.laps.slice();
  const current = lapElapsed();
  if (current > 0) {
    rows.push({
      type: state.currentType,
      duration: current,
      total: totalElapsed(),
      startedAt: state.lapStartedAt,
      endedAt: null, // 未確定
    });
  }
  return rows;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function clockText(value) {
  if (!value) return '-';
  const date = new Date(value);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function dateText(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 記録と集計を Markdown 文字列にする。 */
function buildMarkdown() {
  const rows = lapRows();
  const total = totalElapsed();
  const counts = { work: 0, break: 0, long_break: 0 };
  for (const row of rows) counts[row.type] += 1;

  const lines = [`# Hakadory 記録 ${dateText(Date.now())}`, ''];
  if (state.startedAt !== null) {
    lines.push(`- 計測開始: ${dateText(state.startedAt)} ${clockText(state.startedAt)}`);
  }
  lines.push(`- 書き出し: ${dateText(Date.now())} ${clockText(Date.now())}`);
  lines.push(`- 総時間: ${formatTime(total, false)}`);
  lines.push('', '## 集計', '',
    '| 種別 | 時間 | 回数 | 割合 |',
    '| --- | ---: | ---: | ---: |');
  for (const group of SUMMARY_GROUPS) {
    const seconds = groupSum(group.types);
    const share = total > 0 ? (seconds / total) * 100 : 0;
    const count = group.types.reduce((sum, type) => sum + counts[type], 0);
    lines.push(`| ${group.text} | ${formatTime(seconds, false)} | ${count} | ${share.toFixed(1)}% |`);
  }
  lines.push(`| **合計** | **${formatTime(total, false)}** | **${rows.length}** | **100.0%** |`);

  lines.push('', '## ラップ', '',
    '| # | 種別 | ラップ | 通過 | 開始 | 終了 |',
    '| ---: | --- | ---: | ---: | --- | --- |');
  if (!rows.length) lines.push('| - | - | - | - | - | - |');
  rows.forEach((row, index) => {
    const number = row.endedAt ? String(index + 1) : `${index + 1}（進行中）`;
    lines.push(`| ${number} | ${TYPE_LABEL[row.type]} | ${formatTime(row.duration, false)}`
      + ` | ${formatTime(row.total, false)} | ${clockText(row.startedAt)}`
      + ` | ${clockText(row.endedAt)} |`);
  });
  lines.push('');
  return lines.join('\n');
}

/** 記録と集計を .md ファイルとしてダウンロードする。 */
function exportMarkdown() {
  if (totalElapsed() <= 0 && !state.laps.length) {
    toast('まだ記録がありません。');
    return;
  }
  const date = new Date();
  const name = `Hakadory_${date.getFullYear()}${pad2(date.getMonth() + 1)}`
    + `${pad2(date.getDate())}_${pad2(date.getHours())}${pad2(date.getMinutes())}.md`;
  const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`${name} をダウンロードしました。`);
}

let toastTimer = null;

function toast(message) {
  const el = ui.toast;
  el.textContent = message;
  el.hidden = false;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------------------------------------------------------------- 自動開始・自動終了

/** 作業ラップにして計測を動かす（止まっていれば動かす）。 */
function startWorkSession() {
  lap(WORK);
  if (!state.running) toggleRun();
}

/** 設定を変えたら、次の予定時刻から改めて判定し直す。 */
function resetAutoSchedule() {
  state.autoStartDone = null;
  state.autoEndDone = null;
  updateAutoHints();
}

function autoDaysSelected() {
  return settings.autoStartDays.length > 0;
}

function autoStartTarget() {
  if (!settings.autoStartEnabled || !autoDaysSelected()) return null;
  return parseTimeOfDay(settings.autoStartTime);
}

function autoEndTarget() {
  if (!settings.autoEndEnabled || !autoDaysSelected()) return null;
  return parseTimeOfDay(settings.autoEndTime);
}

/** 予定した曜日・時刻に達しているか。 */
function autoDue(target, date) {
  if (target === null) return false;
  if (!settings.autoStartDays.includes(weekdayIndex(date))) return false;
  return date.getHours() === target[0] && date.getMinutes() === target[1];
}

function checkAutoStart(date) {
  const target = autoStartTarget();
  if (!autoDue(target, date)) return;
  const key = stamp(date, target);
  if (state.autoStartDone === key) return; // 同じ分のあいだに何度も開始しない
  state.autoStartDone = key;
  if (state.running) return;               // すでに計測中なら邪魔しない
  startWorkSession();
}

/** 予定した曜日・時刻になったら一時停止する（記録は消さず、ラップも確定しない）。 */
function checkAutoEnd(date) {
  const target = autoEndTarget();
  if (!autoDue(target, date)) return;
  const key = stamp(date, target);
  if (state.autoEndDone === key) return;
  state.autoEndDone = key;
  if (!state.running) return;              // 止まっているなら何もしない
  pause();
  refresh();
  saveSession();
}

function updateAutoHints() {
  const days = settings.autoStartDays.slice().sort((a, b) => a - b)
    .map((index) => WEEKDAYS[index]).join('');
  const startTarget = autoStartTarget();
  ui.autoStartHint.textContent = startTarget === null
    ? '' : `${days} ${pad2(startTarget[0])}:${pad2(startTarget[1])} に開始`;
  const endTarget = autoEndTarget();
  ui.autoEndHint.textContent = endTarget === null
    ? '' : `${pad2(endTarget[0])}:${pad2(endTarget[1])} に停止`;
}

// ---------------------------------------------------------------- 表示の更新

function setTypeClass(el, type) {
  el.classList.remove('type-work', 'type-break', 'type-long');
  el.classList.add(TYPE_CLASS[type]);
}

function insertLapRow(number, entry) {
  const row = document.createElement('tr');
  const cells = [
    ['col-no', String(number)],
    ['col-type', TYPE_LABEL[entry.type]],
    ['col-num', formatTime(entry.duration)],
    ['col-num', formatTime(entry.total, false)],
  ];
  for (const [cls, text] of cells) {
    const cell = document.createElement('td');
    cell.className = cls;
    cell.textContent = text;
    row.appendChild(cell);
  }
  setTypeClass(row, entry.type);
  const body = ui.lapRows;
  body.insertBefore(row, body.firstChild); // 新しい順
}

function rebuildLapRows() {
  ui.lapRows.textContent = '';
  state.laps.forEach((entry, index) => insertLapRow(index + 1, entry));
}

/** ラベル・操作の表示を現在の状態に合わせる。 */
function refresh() {
  const type = state.currentType;
  const label = TYPE_LABEL[type];
  const running = state.running;

  const lapTitle = ui.lapTitle;
  lapTitle.textContent = `${label} ・ ${running ? '計測中' : '停止中'}`;
  setTypeClass(lapTitle, type);
  setTypeClass(ui.lap, type);
  setTypeClass(ui.miniLap, type);
  const miniType = ui.miniType;
  miniType.textContent = label;
  setTypeClass(miniType, type);

  const text = running ? '一時停止' : (totalElapsed() > 0 ? '再開' : '開始');
  for (const button of [ui.start, ui.miniStart]) {
    button.textContent = text;
    button.classList.toggle('action-start', !running);
    button.classList.toggle('action-pause', running);
  }

  updateAutoHints();
  updateClocks();
}

function updateClocks() {
  const total = totalElapsed();
  const current = lapElapsed();
  ui.total.textContent = formatTime(total);
  ui.lap.textContent = formatTime(current);
  ui.miniTotal.textContent = formatTime(total, false);
  ui.miniLap.textContent = formatTime(current);
  for (const group of SUMMARY_GROUPS) {
    ui[group.ref].textContent = formatTime(groupSum(group.types), false);
  }
  updateAlertHint();
}

function tick() {
  const date = new Date();
  checkAutoStart(date);
  checkAutoEnd(date);
  if (state.running) {
    updateClocks();
    if (state.nextAlert !== null && lapElapsed() >= state.nextAlert) fireAlert();
  }
}

// ---------------------------------------------------------------- ミニ表示

let pipWindow = null;

function applyThemeTo(root) {
  root.dataset.theme = settings.theme;
}

/** ミニ表示を出す。対応していれば常に最前面の小窓、無理なら画面内で縮める。 */
async function openMini() {
  if (pipWindow !== null || document.body.classList.contains('inline-mini')) {
    closeMini();
    return;
  }
  const mini = ui.mini;
  mini.hidden = false;

  if (!('documentPictureInPicture' in window)) {
    document.body.classList.add('inline-mini');
    toast('このブラウザは小窓表示に対応していないため、画面内で縮小しました。'
      + '（Chrome / Edge では常に最前面の小窓になります）');
    return;
  }

  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 300, height: 132,
    });
  } catch (error) {
    mini.hidden = true;
    toast('小窓を開けませんでした。');
    return;
  }

  const link = pipWindow.document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('style.css', location.href).href;
  pipWindow.document.head.appendChild(link);
  pipWindow.document.title = 'Hakadory';
  applyThemeTo(pipWindow.document.documentElement);
  pipWindow.document.body.classList.add('pip');
  pipWindow.document.body.appendChild(mini);
  pipWindow.document.addEventListener('keydown', onKeyDown);
  pipWindow.addEventListener('pagehide', () => { restoreMini(); });
}

function restoreMini() {
  const mini = ui.mini;
  if (mini.ownerDocument !== document) document.body.appendChild(mini);
  mini.hidden = true;
  document.body.classList.remove('inline-mini');
  pipWindow = null;
}

function closeMini() {
  if (pipWindow !== null) {
    pipWindow.close(); // pagehide で restoreMini が動く
    return;
  }
  restoreMini();
}

// ---------------------------------------------------------------- 画面を消さない

let wakeLock = null;

async function applyKeepAwake() {
  const hint = ui.keepAwakeHint;
  if (!('wakeLock' in navigator)) {
    hint.textContent = settings.keepAwake ? 'このブラウザは非対応' : '';
    return;
  }
  if (settings.keepAwake && wakeLock === null) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      hint.textContent = '';
    } catch (error) {
      hint.textContent = '取得できませんでした';
    }
  } else if (!settings.keepAwake && wakeLock !== null) {
    try { await wakeLock.release(); } catch (error) { /* すでに解放済み */ }
    wakeLock = null;
    hint.textContent = '';
  }
}

// ---------------------------------------------------------------- 設定の保存

function loadSettings() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch (error) {
    return; // 壊れている場合は既定値で始める
  }
  if (!data || typeof data !== 'object') return;

  if (data.alertMinutes && typeof data.alertMinutes === 'object') {
    for (const type of LAP_TYPES) {
      if (typeof data.alertMinutes[type] === 'string') {
        settings.alertMinutes[type] = data.alertMinutes[type];
      }
    }
  }
  for (const key of ['alertEnabled', 'alertRepeat', 'autoStartEnabled',
    'autoEndEnabled', 'keepAwake']) {
    if (typeof data[key] === 'boolean') settings[key] = data[key];
  }
  if (typeof data.alertRepeatMinutes === 'string') {
    settings.alertRepeatMinutes = data.alertRepeatMinutes;
  }
  if (parseTimeOfDay(data.autoStartTime) !== null) settings.autoStartTime = data.autoStartTime;
  if (parseTimeOfDay(data.autoEndTime) !== null) settings.autoEndTime = data.autoEndTime;
  if (Array.isArray(data.autoStartDays)) {
    settings.autoStartDays = data.autoStartDays
      .filter((index) => Number.isInteger(index) && index >= 0 && index < WEEKDAYS.length);
  }
  if (THEME_NAMES.includes(data.theme)) settings.theme = data.theme;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // 保存できない設定でも動作は続ける
  }
}

/** タブを閉じても記録が消えないよう、計測状態も保存しておく。 */
function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      running: state.running,
      totalBase: state.totalBase,
      lapBase: state.lapBase,
      runningSince: state.running ? Date.now() : null,
      currentType: state.currentType,
      laps: state.laps,
      sums: state.sums,
      startedAt: state.startedAt,
      lapStartedAt: state.lapStartedAt,
    }));
  } catch (error) {
    // 保存できなくても計測は続ける
  }
}

function loadSession() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch (error) {
    return;
  }
  if (!data || data.version !== 1) return;

  state.totalBase = Number(data.totalBase) || 0;
  state.lapBase = Number(data.lapBase) || 0;
  state.currentType = LAP_TYPES.includes(data.currentType) ? data.currentType : WORK;
  state.laps = Array.isArray(data.laps)
    ? data.laps.filter((entry) => entry && LAP_TYPES.includes(entry.type))
    : [];
  state.sums = { work: 0, break: 0, long_break: 0 };
  if (data.sums && typeof data.sums === 'object') {
    for (const type of LAP_TYPES) state.sums[type] = Number(data.sums[type]) || 0;
  }
  state.startedAt = Number(data.startedAt) || null;
  state.lapStartedAt = Number(data.lapStartedAt) || null;

  // 閉じている間も動いていたものとして、経過を足してから再開する
  if (data.running && Number.isFinite(data.runningSince)) {
    const away = Math.max((Date.now() - data.runningSince) / 1000, 0);
    state.totalBase += away;
    state.lapBase += away;
    start();
  }
  rebuildLapRows();
}

// ---------------------------------------------------------------- 画面の組み立て

function setTheme(name) {
  if (!THEME_NAMES.includes(name)) return;
  settings.theme = name;
  applyThemeTo(document.documentElement);
  if (pipWindow !== null) applyThemeTo(pipWindow.document.documentElement);
  for (const button of document.querySelectorAll('button[data-theme]')) {
    button.classList.toggle('is-selected', button.dataset.theme === name);
  }
  saveSettings();
}

function setTab(name) {
  for (const button of document.querySelectorAll('button[data-tab]')) {
    button.classList.toggle('is-selected', button.dataset.tab === name);
  }
  for (const page of document.querySelectorAll('.page')) {
    page.hidden = page.id !== `page-${name}`;
  }
}

function bindToggle(id, key, onChange) {
  const button = $(id);
  const render = () => button.setAttribute('aria-pressed', String(settings[key]));
  button.addEventListener('click', () => {
    settings[key] = !settings[key];
    render();
    saveSettings();
    if (onChange) onChange();
  });
  render();
}

function bindField(id, get, set, onChange) {
  const field = $(id);
  field.value = get();
  field.addEventListener('input', () => {
    set(field.value);
    saveSettings();
    if (onChange) onChange();
  });
}

function buildDays() {
  const holder = $('days');
  WEEKDAYS.forEach((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.textContent = name;
    const render = () => {
      const on = settings.autoStartDays.includes(index);
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    };
    button.addEventListener('click', () => {
      const at = settings.autoStartDays.indexOf(index);
      if (at === -1) settings.autoStartDays.push(index);
      else settings.autoStartDays.splice(at, 1);
      render();
      saveSettings();
      resetAutoSchedule();
    });
    render();
    holder.appendChild(button);
  });
}

function onKeyDown(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;

  const actions = {
    ' ': toggleRun,
    w: () => lap(WORK),
    b: () => lap(BREAK),
    l: () => lap(LONG_BREAK),
    m: openMini,
  };
  const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  event.preventDefault();
  action();
}

function init() {
  cacheUi();
  loadSettings();
  setTheme(settings.theme);
  loadSession();

  for (const button of document.querySelectorAll('button[data-tab]')) {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  }
  for (const button of document.querySelectorAll('button[data-theme]')) {
    button.addEventListener('click', () => setTheme(button.dataset.theme));
  }
  for (const button of document.querySelectorAll('button[data-lap]')) {
    button.addEventListener('click', () => lap(button.dataset.lap));
  }
  ui.start.addEventListener('click', toggleRun);
  ui.miniStart.addEventListener('click', toggleRun);
  $('reset').addEventListener('click', reset);
  $('export').addEventListener('click', exportMarkdown);
  $('compact').addEventListener('click', openMini);
  $('mini-back').addEventListener('click', closeMini);
  $('preview').addEventListener('click', playSound);

  bindToggle('alert-enabled', 'alertEnabled', resetAlert);
  bindToggle('alert-repeat', 'alertRepeat', resetAlert);
  bindToggle('auto-start-enabled', 'autoStartEnabled', resetAutoSchedule);
  bindToggle('auto-end-enabled', 'autoEndEnabled', resetAutoSchedule);
  bindToggle('keep-awake', 'keepAwake', applyKeepAwake);

  for (const type of LAP_TYPES) {
    bindField(`min-${type}`,
      () => settings.alertMinutes[type],
      (value) => { settings.alertMinutes[type] = value; },
      resetAlert);
  }
  bindField('min-repeat',
    () => settings.alertRepeatMinutes,
    (value) => { settings.alertRepeatMinutes = value; },
    resetAlert);
  bindField('auto-start-time',
    () => settings.autoStartTime,
    (value) => { settings.autoStartTime = value; },
    resetAutoSchedule);
  bindField('auto-end-time',
    () => settings.autoEndTime,
    (value) => { settings.autoEndTime = value; },
    resetAutoSchedule);

  buildDays();
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', () => { saveSettings(); saveSession(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      applyKeepAwake(); // 画面ロックなどで外れた分を取り直す
      updateClocks();
    } else {
      saveSession();
    }
  });

  resetAlert();
  refresh();
  applyKeepAwake();
  setInterval(tick, TICK_MS);
  setInterval(saveSession, 15000); // 不意にタブが閉じても記録を残す

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 任意機能 */ });
  }
}

init();
