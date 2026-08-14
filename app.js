/* Hakadory (web) - 種別（作業 / 休憩 / …）を区別できるラップ付きストップウォッチ。
 *
 * デスクトップ版 (別リポジトリの Hakadory.py) の計測・集計・通知の仕様をそのまま移植し、
 * ブラウザで動かせないもの（グローバルショートカット）を外し、
 * ミニ表示をドキュメントピクチャーインピクチャーに置き換えたもの。
 *
 * データはこのブラウザの localStorage に置く（読み込んだ通知音の音声ファイルだけは、
 * 大きさの都合で同じブラウザの IndexedDB）。外部への送信は一切しない。
 */
'use strict';

// 既定のボタン 3 つ。設定でボタンを増減・改名しても、この識別子は既定として残る
const WORK = 'work';
const BREAK = 'break';
const LONG_BREAK = 'long_break';

/* 集計はボタンをこの 2 つのどちらかへ寄せて出す。ボタンをいくつ足しても
 * 「作業」と「休憩」の 2 列のままにして、画面と .md の形を保つ。 */
const GROUP_WORK = 'work';
const GROUP_BREAK = 'break';
const GROUPS = [
  { name: GROUP_WORK, text: '作業', ref: 'sumWork', head: 'sumWorkHead' },
  { name: GROUP_BREAK, text: '休憩', ref: 'sumBreak', head: 'sumBreakHead' },
];
const GROUP_NAMES = GROUPS.map((group) => group.name);
const DEFAULT_GROUP = GROUP_WORK;

// ボタンの色は配色ごとに用意した見本から選ぶ（自由な色指定にすると配色が壊れる）
const PALETTE = [['blue', '青'], ['amber', '橙'], ['purple', '紫'],
  ['green', '緑'], ['pink', '桃'], ['cyan', '水']];
const PALETTE_NAMES = PALETTE.map(([name]) => name);
const DEFAULT_COLOR = 'blue';

// ボタンは 1 行 3 つ。増やせるのは、その行が 2 段に収まるところまで
const LAP_COLUMNS = 3;
const MAX_LAP_TYPES = 6;
const MIN_LAP_TYPES = 1;
const LAP_SPAN_UNITS = 6; // 1 行の幅を刻む数。1 個 / 2 個 / 3 個のどれでも割り切れる
const MAX_LABEL = 5;      // 3 つ並べても押しつぶれない表示名の長さ
const MAX_PROFILE_NAME = 8;

const DEFAULT_MINUTES = { work: '25', break: '5', long_break: '30' };
// 1 プロファイル = ボタンの並び（名前・色・集計側・通知の分数）
const DEFAULT_TYPES = [
  { id: WORK, label: '作業', color: 'blue', group: GROUP_WORK, minutes: DEFAULT_MINUTES[WORK] },
  { id: BREAK, label: '休憩', color: 'amber', group: GROUP_BREAK, minutes: DEFAULT_MINUTES[BREAK] },
  { id: LONG_BREAK, label: '長休憩', color: 'purple', group: GROUP_BREAK, minutes: DEFAULT_MINUTES[LONG_BREAK] },
];
const DEFAULT_PROFILE_NAME = '既定';
const NEW_TYPE_LABEL = 'ボタン';
const NEW_PROFILE_NAME = '新しい設定';

const DEFAULT_REPEAT_MINUTES = '5';
const UNDO_LIMIT = 50; // 「元に戻す」で遡れる手数

/* 通知音の種類。一度きりの短い音は聞き逃しやすいので、どれもモチーフを間を置いて
 * 繰り返し、2 秒前後は鳴り続ける（repeats 回 × cycle 秒 ＋ 最後の一音）。
 *
 *   motif    モチーフ内の [開始秒, 周波数]
 *   partials 基音に重ねる [倍率, 音量比（1 が最大）]。多いほど硬く、遠くでも残る
 *   tone     一音の長さ
 *   hold     一音のうち、減衰を始めずに同じ大きさで伸ばす割合
 */
const SOUNDS = [
  {
    id: 'chime', label: 'チャイム', wave: 'sine',
    motif: [[0, 880], [0.26, 660]], partials: [[1, 1]],
    tone: 0.42, hold: 0.6, cycle: 0.78, repeats: 3,
  },
  {
    id: 'bell', label: 'ベル', wave: 'sine',
    motif: [[0, 1046]], partials: [[1, 1], [2.76, 0.4], [5.4, 0.2]],
    tone: 1.05, hold: 0.05, cycle: 1.05, repeats: 2,
  },
  {
    id: 'beep', label: 'ビープ', wave: 'square',
    motif: [[0, 1200], [0.2, 1200]], partials: [[1, 0.5]],
    tone: 0.14, hold: 0.9, cycle: 0.62, repeats: 4,
  },
  {
    id: 'alarm', label: 'アラーム', wave: 'triangle',
    motif: [[0, 660], [0.17, 990], [0.34, 1320]], partials: [[1, 0.8]],
    tone: 0.46, hold: 0.7, cycle: 0.7, repeats: 3,
  },
];

const DEFAULT_SOUND = 'chime';
const CUSTOM_SOUND = 'custom';        // 読み込んだ音声ファイルを指す名前
const CUSTOM_SOUND_MAX = 5 << 20;     // 読み込めるのは 5MB まで
const CUSTOM_SOUND_LIMIT = 20;        // 長い曲でも 20 秒で止める
const DEFAULT_VOLUME = 70;            // 音量（0〜100）。50 で以前の版と同じ大きさ

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']; // 月曜始まり
const DEFAULT_AUTO_START_TIME = '09:00';
const DEFAULT_AUTO_END_TIME = '18:00';
const DEFAULT_AUTO_START_DAYS = [0, 1, 2, 3, 4];

/* 要望・不具合の報告先（Google フォームの回答 URL）。ここを埋めると、使い方タブと
 * 設定タブにリンクが出る。空のままなら、行き先のないリンクは出さない。
 * 送信はフォーム側で完結するので、このアプリから外部へ出るものは何もない。 */
const FEEDBACK_URL = 'https://forms.gle/g7pt1QbgeLv2eCLP6';

const THEME_NAMES = ['standard', 'dark', 'light'];
const DEFAULT_THEME = 'standard';
const SETTINGS_KEY = 'Hakadory.settings';
const SESSION_KEY = 'Hakadory.session';
const SESSION_VERSION = 2; // 2 で種別の控え（types）が付いた。1 も読める
const TICK_MS = 50;

// ---------------------------------------------------------------- 小さな道具

/** 秒を H:MM:SS の文字列にする（小数点以下は表示しない）。 */
function formatTime(seconds) {
  if (!(seconds > 0)) seconds = 0;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(secs)}`;
}

/** ラップを結合したときに、両方のメモを残す。 */
function joinNotes(first, second) {
  return [first, second]
    .map((text) => String(text ?? '').trim())
    .filter((text) => text !== '')
    .join(' / ');
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
  'total', 'lap', 'lap-title', 'lap-note', 'alert-hint', 'sum-work', 'sum-break',
  'sum-work-head', 'sum-break-head', 'start', 'lap-rows', 'auto-start-hint',
  'auto-end-hint', 'keep-awake-hint', 'toast', 'key-hint', 'lap-buttons',
  'sheet-types', 'minutes', 'profiles', 'type-rows', 'type-count',
  'mini', 'mini-total', 'mini-lap', 'mini-hint', 'mini-type', 'mini-start',
  'mini-keys',
];

function cacheUi() {
  for (const id of UI_IDS) {
    ui[id.replace(/-(.)/g, (_, c) => c.toUpperCase())] = $(id);
  }
}

// ------------------------------------------- ボタン（ラップ種別）とプロファイル

/* ボタン 1 つ = { id, label, color, group, minutes } の連想配列。
 *   id      設定と記録をつなぐ識別子。表示名を変えても動かさない
 *   label   ボタンに出る名前。.md にもこの名前で残る
 *   color   PALETTE の色名（配色ごとに実際の色へ読み替える）
 *   group   集計をどちら側に足すか（GROUP_WORK / GROUP_BREAK）
 *   minutes 通知までの分（文字列。空や 0 なら鳴らさない）
 *
 * 記録（laps / currentType）が持つのは id だけで、表示名と色はそのつど
 * typeInfo() から引く。焼き込むと、名前を変えたときに過去のラップだけ
 * 古い名前で残ってしまう。 */

/** 表示名を整える。空白を詰め、長すぎるものは切る。 */
function cleanLabel(text, limit = MAX_LABEL, fallback = '') {
  const name = String(text ?? '').split(/\s+/).filter(Boolean).join(' ')
    .replace(/\|/g, '／'); // .md の表を壊さないため
  return name.slice(0, limit) || fallback;
}

/** 同じ名前が並ばないよう、必要なら末尾に数字を足す。 */
function uniqueLabel(name, taken, limit = MAX_LABEL) {
  if (!taken.has(name)) return name;
  for (let number = 2; number < 100; number += 1) {
    const suffix = String(number);
    const candidate = name.slice(0, Math.max(limit - suffix.length, 1)) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  return name;
}

/** ボタンの識別子を作る。表示名とは別に、保存した設定の中で固定する。 */
function newTypeId(taken) {
  for (let number = 1; number < 1000; number += 1) {
    const candidate = `type${number}`;
    if (!taken.has(candidate)) return candidate;
  }
  return 'type';
}

/** 保存されたボタン定義を、使える形に整える。1 つも読めなければ null。 */
function normalizeTypes(raw) {
  if (!Array.isArray(raw)) return null;
  const types = [];
  const ids = new Set();
  const labels = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || ids.has(id)) continue;
    const label = uniqueLabel(cleanLabel(item.label, MAX_LABEL, id), labels);
    types.push({
      id,
      label,
      color: PALETTE_NAMES.includes(item.color) ? item.color : DEFAULT_COLOR,
      group: GROUP_NAMES.includes(item.group) ? item.group : DEFAULT_GROUP,
      minutes: typeof item.minutes === 'string' ? item.minutes : '',
    });
    ids.add(id);
    labels.add(label);
    if (types.length >= MAX_LAP_TYPES) break; // 読み込みでも上限は超えさせない
  }
  return types.length ? types : null;
}

/** 既定のボタン 3 つ。minutes があれば通知の分数だけ差し替える。 */
function defaultTypes(minutes) {
  return DEFAULT_TYPES.map((entry) => {
    const value = minutes && typeof minutes === 'object' ? minutes[entry.id] : null;
    return { ...entry, minutes: typeof value === 'string' ? value : entry.minutes };
  });
}

/** プロファイル一覧を整える。読めなければ既定の 1 つだけを返す。
 *
 * 数に上限は設けない（作ったぶんだけ残す）。minutes は、プロファイルが
 * まだ無かったころの設定（alertMinutes）から分数を引き継ぐためのもの。
 */
function normalizeProfiles(raw, minutes) {
  const profiles = [];
  const names = new Set();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const types = normalizeTypes(item.types);
      if (types === null) continue;
      const name = uniqueLabel(
        cleanLabel(item.name, MAX_PROFILE_NAME, DEFAULT_PROFILE_NAME),
        names, MAX_PROFILE_NAME);
      profiles.push({ name, types });
      names.add(name);
    }
  }
  if (!profiles.length) {
    profiles.push({ name: DEFAULT_PROFILE_NAME, types: defaultTypes(minutes) });
  }
  return profiles;
}

// ---------------------------------------------------------------- 状態

const state = {
  running: false,
  totalBase: 0,   // 停止中までに積み上げた総時間
  totalMark: 0,   // 直近に走り出した時刻
  lapBase: 0,     // 現在ラップの停止中までの経過
  lapMark: 0,
  currentType: WORK,
  lapNote: '',        // 進行中のラップに添えるメモ
  laps: [],           // 確定したラップ
  sums: {},           // 確定ラップだけの種別合計（種別の識別子 -> 秒）
  nextAlert: null,    // 次に鳴らすラップ内経過秒
  startedAt: null,                            // 計測開始（壁時計、ミリ秒）
  lapStartedAt: null,                         // 現在ラップ開始（壁時計、ミリ秒）
  autoStartDone: null,
  autoEndDone: null,
};

const settings = {
  theme: DEFAULT_THEME,
  alertEnabled: true,
  alertRepeat: false,
  sound: DEFAULT_SOUND,
  volume: DEFAULT_VOLUME,
  customSoundName: '', // 読み込んだ音声ファイルの名前（中身は IndexedDB）
  // ボタンの並びと通知までの分はプロファイルが持つ（音・配色などは共通のまま）
  profiles: normalizeProfiles(null),
  profileIndex: 0,
  alertRepeatMinutes: DEFAULT_REPEAT_MINUTES,
  autoStartEnabled: false,
  autoStartTime: DEFAULT_AUTO_START_TIME,
  autoEndEnabled: false,
  autoEndTime: DEFAULT_AUTO_END_TIME,
  autoStartDays: [...DEFAULT_AUTO_START_DAYS],
  keepAwake: false,
};

/* 一度でも見た種別を控えておく（消したボタン、切り替える前のプロファイル、
 * 保存された記録から戻したもの）。これがないと、ボタンを消した瞬間に
 * 記録済みのラップが名無しになる。 */
const typeRegistry = {};

/** いま画面に出ているボタンの並び（プロファイルが持つ配列そのもの）。 */
function currentTypes() {
  return settings.profiles[settings.profileIndex].types;
}

function typeIds() {
  return currentTypes().map((entry) => entry.id);
}

function hasType(id) {
  return currentTypes().some((entry) => entry.id === id);
}

/** 今のボタンを控えに写す（名前や色を変えたら、控えのほうも新しくする）。 */
function rememberTypes() {
  for (const entry of currentTypes()) typeRegistry[entry.id] = { ...entry };
}

/** 種別 1 つ分の定義。今のプロファイルに無ければ控えから引く。
 *
 * 「今のプロファイル → 控え → 最低限の既定」の順を崩さないこと
 * （崩すと、今のプロファイルでの改名が控えの古い名前に負ける）。
 */
function typeInfo(id) {
  for (const entry of currentTypes()) {
    if (entry.id === id) return entry;
  }
  if (typeRegistry[id]) return typeRegistry[id];
  return {
    id, label: String(id), color: DEFAULT_COLOR, group: DEFAULT_GROUP, minutes: '',
  };
}

const typeLabel = (id) => typeInfo(id).label;
const typeColor = (id) => typeInfo(id).color;

/** .md にしか無かった種別や、保存された記録の種別を控える。 */
function rememberType(id, label, color, group) {
  if (typeRegistry[id]) return;
  typeRegistry[id] = {
    id,
    label: cleanLabel(label, MAX_LABEL, String(id)),
    color: PALETTE_NAMES.includes(color) ? color : DEFAULT_COLOR,
    // 集計側が分からないときは名前から見当を付ける（違えば一覧から直せる）
    group: GROUP_NAMES.includes(group)
      ? group : (String(label).includes('休憩') ? GROUP_BREAK : GROUP_WORK),
    minutes: '',
  };
}

/** 記録に出てくる種別を、出てきた順に並べる（進行中も含む）。 */
function recordedTypes() {
  const seen = [];
  for (const entry of state.laps) {
    if (!seen.includes(entry.type)) seen.push(entry.type);
  }
  if (!seen.includes(state.currentType)) seen.push(state.currentType);
  return seen;
}

/** その集計側に足す種別。今は無いボタンの記録も取りこぼさない。 */
function summaryTypes(group) {
  const ids = currentTypes().filter((entry) => entry.group === group)
    .map((entry) => entry.id);
  for (const id of recordedTypes()) {
    if (!ids.includes(id) && typeInfo(id).group === group) ids.push(id);
  }
  return ids;
}

/** 集計の見出しの色。その側にある最初のボタンの色を借りる。 */
function groupColor(group) {
  const entry = currentTypes().find((item) => item.group === group);
  return entry ? entry.color : null;
}

/** 自動開始で使う種別。集計が「作業」側の最初のボタン。 */
function firstWorkType() {
  const ids = summaryTypes(GROUP_WORK).filter(hasType);
  return ids.length ? ids[0] : typeIds()[0];
}

/** 単キーの割り当て。並び順の 1〜9 と、既定の 3 つが残っていれば W / B / L。 */
function lapKeys() {
  const keys = {};
  currentTypes().slice(0, 9).forEach((entry, index) => {
    keys[String(index + 1)] = entry.id;
  });
  for (const [key, id] of [['w', WORK], ['b', BREAK], ['l', LONG_BREAK]]) {
    if (hasType(id)) keys[key] = id;
  }
  return keys;
}

/** フッターに出す単キーの案内（ボタンの数で 1〜n が変わる）。 */
function keyHint() {
  const count = currentTypes().length;
  return `Space  ${count <= 1 ? '1' : `1-${count}`}  M  ⌃Z/Y`;
}

// --------------------------------------------- ボタンとプロファイルの操作

/** ボタンの数・名前・色・並びが変わったあとの後始末。
 *
 * rebuildRows が false のときは編集画面の行を作り直さず、印と色だけ付け替える
 * （押した部品を消さないため。名前・色・集計側の変更はこちらを通る）。
 */
function afterTypesChanged(rebuildRows = true) {
  // 数・並びが変わったとき（追加・削除・入れ替え・プロファイル切替）だけ行を組み直す
  rememberTypes();
  recomputeSums();
  renderLapButtons();
  renderSheetTypes();
  renderMiniKeys();
  renderMinutes();
  renderProfiles();
  if (rebuildRows) renderTypeRows(); else restyleTypeRows();
  rebuildLapRows(); // 名前と色は一覧にも出るので引き直す
  resetAlert();     // 通知までの分はボタンごと
  refresh();
  saveSettings();
}

function profileNames() {
  return settings.profiles.map((profile) => profile.name);
}

/** 使うプロファイルを切り替える。記録はそのまま残す。 */
function setProfile(index) {
  if (!(index >= 0 && index < settings.profiles.length)) return false;
  if (index === settings.profileIndex) return false;
  settings.profileIndex = index;
  afterTypesChanged();
  return true;
}

/** プロファイルを増やして、そちらに切り替える。数に上限は設けない。 */
function addProfile(name, copyCurrent) {
  const types = copyCurrent
    ? currentTypes().map((entry) => ({ ...entry }))
    : defaultTypes();
  const label = uniqueLabel(
    cleanLabel(name, MAX_PROFILE_NAME, NEW_PROFILE_NAME),
    new Set(profileNames()), MAX_PROFILE_NAME);
  settings.profiles.push({ name: label, types });
  settings.profileIndex = settings.profiles.length - 1;
  afterTypesChanged();
  return true;
}

function renameProfile(index, name) {
  if (!(index >= 0 && index < settings.profiles.length)) return false;
  const taken = new Set(profileNames());
  taken.delete(settings.profiles[index].name);
  settings.profiles[index].name = uniqueLabel(
    cleanLabel(name, MAX_PROFILE_NAME, settings.profiles[index].name),
    taken, MAX_PROFILE_NAME);
  renderProfiles();
  saveSettings();
  return true;
}

/** プロファイルを消す。最後の 1 つは残す（ボタンが無くなるため）。 */
function removeProfile(index) {
  if (settings.profiles.length <= 1) return false;
  if (!(index >= 0 && index < settings.profiles.length)) return false;
  settings.profiles.splice(index, 1);
  if (index < settings.profileIndex) settings.profileIndex -= 1;
  settings.profileIndex = Math.min(settings.profileIndex,
    settings.profiles.length - 1);
  afterTypesChanged();
  return true;
}

const canAddType = () => currentTypes().length < MAX_LAP_TYPES;

/** ボタンを 1 つ増やす。並べても崩れない数までに限る。 */
function addType() {
  if (!canAddType()) return false;
  const types = currentTypes();
  const used = new Set(types.map((entry) => entry.color));
  const color = PALETTE_NAMES.find((name) => !used.has(name)) || DEFAULT_COLOR;
  const taken = new Set(Object.keys(typeRegistry).concat(typeIds()));
  types.push({
    id: newTypeId(taken),
    label: uniqueLabel(NEW_TYPE_LABEL, new Set(types.map((e) => e.label))),
    color,
    group: DEFAULT_GROUP,
    minutes: DEFAULT_MINUTES[WORK],
  });
  afterTypesChanged();
  return true;
}

/** ボタンを 1 つ減らす。その種別で記録済みのラップはそのまま残る。 */
function removeType(index) {
  const types = currentTypes();
  if (types.length <= MIN_LAP_TYPES || !(index >= 0 && index < types.length)) {
    return false;
  }
  types.splice(index, 1);
  /* 進行中の種別が消えても差し替えない（記録を書き換えないため。見出しには
   * 消したボタンの名前が残り、次のラップで新しい種別になる）。 */
  afterTypesChanged();
  return true;
}

/** ボタンの並び順を入れ替える（押しやすい位置に置けるように）。 */
function moveType(index, step) {
  const types = currentTypes();
  const target = index + step;
  if (!(index >= 0 && index < types.length)) return false;
  if (!(target >= 0 && target < types.length)) return false;
  [types[index], types[target]] = [types[target], types[index]];
  afterTypesChanged();
  return true;
}

/** ボタンの名前・色・集計側を変える。記録済みのラップの表示にも効く。 */
function setTypeField(index, key, value) {
  const types = currentTypes();
  if (!(index >= 0 && index < types.length)) return false;
  const entry = types[index];
  if (key === 'label') {
    const taken = new Set(types.filter((other) => other !== entry)
      .map((other) => other.label));
    value = uniqueLabel(cleanLabel(value, MAX_LABEL, entry.label), taken);
  } else if (key === 'color') {
    if (!PALETTE_NAMES.includes(value)) return false;
  } else if (key === 'group') {
    if (!GROUP_NAMES.includes(value)) return false;
  } else {
    return false;
  }
  if (entry[key] === value) return false;
  entry[key] = value;
  /* 編集画面の行は作り直さない（名前・色・集計側は印と文字を書き換えるだけ）。
   * 作り直すと、直したばかりの部品が消えて、続けて押した先が無くなる
   * （名前を打ってからそのまま色を押す、のような操作が 1 回空振りする）。 */
  afterTypesChanged(false);
  return true;
}

function totalElapsed() {
  return state.running ? state.totalBase + (now() - state.totalMark) : state.totalBase;
}

function lapElapsed() {
  return state.running ? state.lapBase + (now() - state.lapMark) : state.lapBase;
}

/** 確定ラップの合計に、進行中ラップの分も足した値。 */
function liveSum(type) {
  return (state.sums[type] ?? 0) + (type === state.currentType ? lapElapsed() : 0);
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
  scheduleAlert();
}

function pause() {
  const mark = now();
  state.totalBase += mark - state.totalMark;
  state.lapBase += mark - state.lapMark;
  state.running = false;
  cancelAlert(); // 止めたあとに鳴らないように
}

function toggleRun() {
  if (state.running) pause(); else start();
  refresh();
  saveSession();
}

/** 現在のラップを確定し、指定種別で新しいラップを開始する。 */
function lap(type) {
  closeLapSheet(); // ラップが増減すると、開いているシートが別のラップを指してしまう
  pushUndo();
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
    state.sums[state.currentType] = (state.sums[state.currentType] ?? 0) + duration;
    state.laps.push({
      type: state.currentType,
      duration,
      startedAt: state.lapStartedAt,
      endedAt: Date.now(),
      note: state.lapNote.trim(),
    });
    rebuildLapRows();
  }

  state.currentType = type;
  state.lapBase = 0;
  state.lapMark = now();
  state.lapStartedAt = Date.now();
  state.lapNote = ''; // メモは確定したラップに残し、次はまっさらから
  resetAlert();
  refresh();
  saveSession();
}

// ------------------------------------------------- ラップの手直し

/** 種別ごとの合計を、確定ラップから数え直す。
 *
 * いま画面に無いボタンの記録も数える（プロファイルを切り替えても、
 * 書き出しと集計から抜け落ちないようにするため）。
 */
function recomputeSums() {
  state.sums = {};
  for (const id of typeIds()) state.sums[id] = 0;
  if (state.sums[state.currentType] === undefined) state.sums[state.currentType] = 0;
  for (const entry of state.laps) {
    state.sums[entry.type] = (state.sums[entry.type] ?? 0) + entry.duration;
  }
}

/** ラップを手直ししたあとの後始末。alert は進行中ラップが動いたとき。 */
function afterLapEdit(alert) {
  recomputeSums();
  rebuildLapRows();
  if (alert) resetAlert();
  refresh();
  saveSession();
}

/** 確定ラップの種別を変える。時間はいっさい動かさない。 */
function setLapType(index, type) {
  if (!hasType(type) || !state.laps[index]) return false;
  if (state.laps[index].type === type) return false;
  pushUndo();
  state.laps[index].type = type;
  afterLapEdit(false);
  return true;
}

/** 確定ラップのメモを書き換える。時間や種別には触らない。 */
function setLapNote(index, text) {
  if (!state.laps[index]) return false;
  const note = String(text ?? '').trim();
  if ((state.laps[index].note ?? '') === note) return false;
  pushUndo();
  state.laps[index].note = note;
  afterLapEdit(false);
  return true;
}

/** 進行中のラップの種別だけを直す（ラップを切らずに種別を差し替える）。 */
function setCurrentType(type) {
  if (!hasType(type) || type === state.currentType) return false;
  pushUndo();
  state.currentType = type;
  resetAlert(); // 通知までの分は種別ごとなので張り直す
  refresh();
  saveSession();
  return true;
}

/** そのラップを指定方向へ畳めるか。末尾は進行中ラップへ畳める。 */
function canMergeLap(index, direction) {
  if (!state.laps[index]) return false;
  return direction === 'prev' ? index > 0 : true;
}

/** 結合するとどの種別に吸われるかを、メニューに出すための名前。 */
function mergeTargetLabel(index, direction) {
  if (direction === 'prev') {
    return index > 0 ? typeLabel(state.laps[index - 1].type) : 'なし';
  }
  if (state.laps[index + 1]) return typeLabel(state.laps[index + 1].type);
  return `進行中・${typeLabel(state.currentType)}`;
}

/** 確定ラップを隣のラップへ畳み込む。総時間は変わらない。
 *
 * 種別と時刻は畳み込み先に合わせる。末尾のラップを 'next' で畳むと、
 * 進行中のラップの先頭に戻る（押し間違いで増えた短いラップの掃除）。
 */
function mergeLap(index, direction) {
  if (!canMergeLap(index, direction)) return false;
  pushUndo();
  const [entry] = state.laps.splice(index, 1);
  if (direction === 'prev') {
    const target = state.laps[index - 1];
    target.duration += entry.duration;
    target.endedAt = entry.endedAt;
    target.note = joinNotes(target.note, entry.note); // メモは捨てず、時系列につなぐ
    afterLapEdit(false);
  } else if (state.laps[index]) {
    const target = state.laps[index];
    target.duration += entry.duration;
    target.startedAt = entry.startedAt;
    target.note = joinNotes(entry.note, target.note);
    afterLapEdit(false);
  } else {
    // 進行中のラップへ畳む（種別は進行中のまま）
    state.lapBase += entry.duration;
    state.lapStartedAt = entry.startedAt;
    state.lapNote = joinNotes(entry.note, state.lapNote);
    afterLapEdit(true);
  }
  return true;
}

/** 進行中のラップを直前の確定ラップに畳む（種別も前のものに戻す）。
 *
 * mergeLap の 'next' と向きが逆で、こちらは種別を畳み込む側に合わせる。
 * 押した直後に「今のは違う」と気づいたときの操作。
 */
function mergeCurrentIntoPrev() {
  if (!state.laps.length) return false;
  pushUndo();
  const entry = state.laps.pop();
  state.lapBase += entry.duration;
  state.lapStartedAt = entry.startedAt;
  state.currentType = entry.type;
  state.lapNote = joinNotes(entry.note, state.lapNote);
  afterLapEdit(true);
  return true;
}

// ------------------------------------------------- 元に戻す / やり直す

const undoStack = [];
const redoStack = [];

/** やり直しに要る分だけの控え。走っている時計そのものは含めない。 */
function snapshot() {
  return {
    laps: state.laps.map((entry) => ({ ...entry })),
    currentType: state.currentType,
    lapNote: state.lapNote, // メモの編集も結合も、これで戻せる
    lapStartedAt: state.lapStartedAt,
  };
}

/** 手を加える前に今の状態を控える。やり直しの列はここで捨てる。 */
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

/** 控えを戻す。
 *
 * 確定ラップの合計が変わったぶんは進行中ラップで相殺する。こうすると
 * 総時間も、控えてからここまでに経った時間も失われない。
 */
function restore(shot) {
  const before = state.laps.reduce((sum, entry) => sum + entry.duration, 0);
  const after = shot.laps.reduce((sum, entry) => sum + entry.duration, 0);
  state.laps = shot.laps.map((entry) => ({ ...entry }));
  state.currentType = shot.currentType;
  state.lapNote = shot.lapNote ?? '';
  state.lapStartedAt = shot.lapStartedAt;
  state.lapBase += before - after;
  afterLapEdit(true);
}

const canUndo = () => undoStack.length > 0;
const canRedo = () => redoStack.length > 0;

/** 直前のラップ操作を取り消す（計測そのものは止めも進めもしない）。 */
function undo() {
  if (!undoStack.length) return false;
  const shot = undoStack.pop();
  redoStack.push(snapshot());
  restore(shot);
  return true;
}

/** 取り消した操作をやり直す。 */
function redo() {
  if (!redoStack.length) return false;
  const shot = redoStack.pop();
  undoStack.push(snapshot());
  restore(shot);
  return true;
}

function reset() {
  if ((totalElapsed() > 0 || state.laps.length) &&
      !window.confirm('計測とラップをすべて消去します。')) {
    return;
  }
  closeLapSheet();
  state.running = false;
  state.totalBase = 0;
  state.lapBase = 0;
  state.currentType = typeIds()[0];
  state.startedAt = null;
  state.lapStartedAt = null;
  state.lapNote = '';
  state.laps = [];
  // 総時間や開始時刻までは控えていないので、リセットは戻せない
  undoStack.length = 0;
  redoStack.length = 0;
  recomputeSums();
  rebuildLapRows();
  resetAlert();
  refresh();
  saveSession();
}

// ---------------------------------------------------------------- 通知音

let audioContext = null;
let masterGain = null;

/** 設定の音量（0〜100）を実際の増幅率にする。耳に合うよう二乗で効かせる。 */
function volumeGain() {
  const value = Number(settings.volume);
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(Math.max(value, 0), 100);
  return (clamped / 100) ** 2;
}

/** 音を出す用意をする。使えない環境なら false。 */
function openAudio() {
  if (audioContext === null) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    audioContext = new Ctor();
    /* 音量を上げても割れないよう、出口で頭を押さえる。
     * 倍音を重ねた音は合計が 1 を超えるので、リミッターは音量に関わらず要る。 */
    const limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    masterGain = audioContext.createGain();
    masterGain.connect(limiter).connect(audioContext.destination);
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  masterGain.gain.value = volumeGain();
  decodeCustomSound(); // 予約して鳴らせるのは展開したあとなので、ここで始めておく
  return true;
}

/* 一回分の再生は、部品をまとめて一つの gain につなぐ。鳴らし直すときは、ここを
 * 絞ってまとめて止める（音を選び直すたびに前の音が重なって鳴るのを防ぐ）。 */
let voice = null; // 手で鳴らしている音。予約したぶんは alertPlan が持つ

/** 一音鳴らす。すぐ減衰させず、途中まで同じ大きさで伸ばす。 */
function playTone(target, sound, start, frequency) {
  for (const [multiple, ratio] of sound.partials) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = multiple === 1 ? sound.wave : 'sine'; // 倍音はやわらかく重ねる
    osc.frequency.value = frequency * multiple;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(ratio, start + 0.02);
    gain.gain.setValueAtTime(ratio, start + sound.tone * sound.hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.tone);
    osc.connect(gain).connect(target.gain);
    osc.start(start);
    osc.stop(start + sound.tone + 0.02);
    target.sources.push(osc);
  }
}

/* 選ばれている音を start から鳴らす一式を組む。start はオーディオ側の時計の秒で、
 * 先の時刻を渡せばそのときに鳴る。鳴らすのはオーディオスレッドなので、タブが裏に
 * 回って JS のタイマーが間引かれても時刻はずれない。 */
function makeVoice(start) {
  const target = { gain: audioContext.createGain(), sources: [] };
  target.gain.connect(masterGain);
  if (settings.sound === CUSTOM_SOUND && customBuffer !== null) {
    const source = audioContext.createBufferSource();
    source.buffer = customBuffer;
    source.connect(target.gain);
    source.start(start);
    source.stop(start + CUSTOM_SOUND_LIMIT); // 長い曲は途中で切り上げる
    target.sources.push(source);
  } else {
    const sound = currentSound();
    for (let round = 0; round < sound.repeats; round += 1) {
      for (const [offset, frequency] of sound.motif) {
        playTone(target, sound, start + round * sound.cycle + offset, frequency);
      }
    }
  }
  // 鳴りきったら手を離す（予約したぶんが溜まったままにならないように）
  target.sources[target.sources.length - 1].onended = () => {
    target.gain.disconnect();
    if (voice === target) voice = null;
  };
  return target;
}

/** 鳴っている音を止める。切り際が「ブツッ」とならないよう軽く絞ってから。 */
function stopVoice(target) {
  if (target === null || audioContext === null) return;
  const at = audioContext.currentTime;
  target.gain.gain.cancelScheduledValues(at);
  target.gain.gain.setValueAtTime(target.gain.gain.value, at);
  target.gain.gain.linearRampToValueAtTime(0, at + 0.02);
  for (const source of target.sources) {
    try {
      source.stop(at + 0.03); // まだ鳴り始めていない分は、鳴らずに終わる
    } catch (error) {
      // すでに終わっているものは放っておく
    }
  }
}

function stopSound() {
  stopVoice(voice);
  voice = null;
  if (customAudio !== null) customAudio.pause();
  if (customTimer !== null) {
    clearTimeout(customTimer);
    customTimer = null;
  }
}

/** 選ばれている組み込みの音。読み込んだ音声を選んでいる場合も既定値を返す。 */
function currentSound() {
  return SOUNDS.find((sound) => sound.id === settings.sound)
    || SOUNDS.find((sound) => sound.id === DEFAULT_SOUND);
}

/** その場で鳴らす。音は最初の操作より前には出せないので、押されたときに用意する。 */
function playSound() {
  stopSound(); // 押し直したぶんが前の音に重ならないように
  try {
    if (!openAudio()) {
      if (settings.sound === CUSTOM_SOUND) playCustomSound();
      return;
    }
    // 展開が済むまでは、読み込んだ音声を <audio> のまま鳴らす
    if (settings.sound === CUSTOM_SOUND && customBuffer === null
        && playCustomSound()) {
      return;
    }
    voice = makeVoice(audioContext.currentTime);
  } catch (error) {
    // 音が出せない環境でも計測は続ける
  }
}

// ------------------------------------------------ 読み込んだ音声ファイル

/* 音声ファイルは localStorage には入らない大きさになるので IndexedDB に置く。
 * 名前だけは設定側にも持たせ、読み込みを待たずに画面へ出せるようにする。 */
const SOUND_DB = 'Hakadory';
const SOUND_STORE = 'sound';
const SOUND_KEY = 'custom';

let customAudio = null;   // 読み込み済みの <audio>。未読み込みなら null
let customBlob = null;    // その実体。展開し直すときに要る
let customBuffer = null;  // 予約して鳴らせるよう展開したもの。展開前は null
let decodingBlob = null;  // 展開の最中の実体。二重に展開しないための目印
let customTimer = null;

function openSoundDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB がない'));
      return;
    }
    const request = indexedDB.open(SOUND_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SOUND_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function soundDbRequest(mode, run) {
  return openSoundDb().then((db) => new Promise((resolve, reject) => {
    const request = run(db.transaction(SOUND_STORE, mode).objectStore(SOUND_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

/** 保存してある音声を <audio> に読み込む。無ければ何もしない。 */
async function loadCustomSound() {
  let blob;
  try {
    blob = await soundDbRequest('readonly', (store) => store.get(SOUND_KEY));
  } catch (error) {
    blob = null; // 使えない環境では組み込みの音だけで動かす
  }
  setCustomAudio(blob instanceof Blob ? blob : null);
  if (!customAudio && settings.sound === CUSTOM_SOUND) settings.sound = DEFAULT_SOUND;
  if (!customAudio) settings.customSoundName = '';
  buildSounds();
}

function setCustomAudio(blob) {
  if (customAudio !== null) {
    customAudio.pause();
    URL.revokeObjectURL(customAudio.src);
    customAudio = null;
  }
  customBlob = null;
  customBuffer = null;
  if (blob === null) return;
  customBlob = blob;
  customAudio = new Audio(URL.createObjectURL(blob));
  customAudio.preload = 'auto';
  customAudio.volume = Math.min(volumeGain(), 1);
  decodeCustomSound();
}

/* <audio> は先の時刻を指定して鳴らせないので、通知の予約には使えない。読み込んだ
 * 音声も展開して波形にしておき、組み込みの音と同じように予約できるようにする。 */
function decodeCustomSound() {
  if (customBlob === null || customBuffer !== null || audioContext === null) return;
  if (decodingBlob === customBlob) return; // 展開の最中
  const blob = customBlob;
  decodingBlob = blob;
  blob.arrayBuffer()
    .then((data) => audioContext.decodeAudioData(data))
    .then((buffer) => {
      if (customBlob !== blob) return; // 待っているあいだに差し替わっていた
      customBuffer = buffer;
      resetAlert();                    // 予約できるようになったぶんを渡し直す
    })
    .catch(() => {
      // 展開できない形式でも <audio> でなら鳴らせる（予約はできない）
    })
    .then(() => {
      if (decodingBlob === blob) decodingBlob = null;
    });
}

/** 読み込んだ音声を頭から鳴らす。鳴らせなければ false（組み込みの音に落ちる）。 */
function playCustomSound() {
  const audio = customAudio; // 止めるころには差し替わっているかもしれない
  if (audio === null) return false;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Math.min(volumeGain(), 1);
    const started = audio.play();
    if (started && typeof started.catch === 'function') started.catch(() => {});
    if (customTimer !== null) clearTimeout(customTimer);
    customTimer = setTimeout(() => audio.pause(), CUSTOM_SOUND_LIMIT * 1000);
    return true;
  } catch (error) {
    return false;
  }
}

async function pickCustomSound(file) {
  if (!file) return;
  if (file.size > CUSTOM_SOUND_MAX) {
    toast('音声ファイルは 5MB までです。');
    return;
  }
  try {
    await soundDbRequest('readwrite', (store) => store.put(file, SOUND_KEY));
  } catch (error) {
    toast('この環境では音声ファイルを保存できません。');
    return;
  }
  setCustomAudio(file);
  settings.sound = CUSTOM_SOUND;
  settings.customSoundName = file.name;
  saveSettings();
  buildSounds();
  resetAlert();
  toast(`${file.name} を通知音にしました。`);
}

async function clearCustomSound() {
  try {
    await soundDbRequest('readwrite', (store) => store.delete(SOUND_KEY));
  } catch (error) {
    // 消せなくても、この画面からは使わない状態にする
  }
  setCustomAudio(null);
  if (settings.sound === CUSTOM_SOUND) settings.sound = DEFAULT_SOUND;
  settings.customSoundName = '';
  saveSettings();
  buildSounds();
  resetAlert();
}

/** 現在の種別に設定された通知間隔（秒）。無効なら null。
 *
 * 進行中の種別が今のプロファイルに無ければ（ボタンを消した直後など）、
 * 控えに残っている分数で鳴らす。
 */
function alertSeconds() {
  if (!settings.alertEnabled) return null;
  const text = typeInfo(state.currentType).minutes;
  if (String(text).trim() === '') return null;
  const minutes = Number(text);
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
  cancelAlert();
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
  scheduleAlert();
  updateAlertHint();
}

/* ブラウザは裏に回ったタブのタイマーを 1 秒に 1 回まで、しばらく経てば 1 分に
 * 1 回まで間引く。時刻が来ても JS が動かないので、そのままでは表に戻るまで鳴らない。
 * そこで、鳴らす時刻が近づいたぶんはオーディオ側の時計に先に渡しておく。 */
const ALERT_AHEAD = 150; // 秒。間引きの幅（1 分）に余裕をみて先に渡す
let alertPlan = null;    // 渡してある通知音 { elapsed, at, voice }。無ければ null

/** 次の通知が ALERT_AHEAD 以内なら、鳴る時刻を決めて渡しておく。 */
function scheduleAlert() {
  if (alertPlan !== null && alertPlan.elapsed === state.nextAlert) return;
  cancelAlert();
  if (!state.running || state.nextAlert === null) return;
  const wait = state.nextAlert - lapElapsed();
  if (wait > ALERT_AHEAD) return;
  // 一度も操作していないうちは音を出せない。この場合は表に戻ったときに鳴らす
  if (audioContext === null || audioContext.state !== 'running') return;
  // 展開できていない音声ファイルは <audio> でしか鳴らせず、先の時刻を指定できない
  if (settings.sound === CUSTOM_SOUND && customBuffer === null) return;
  try {
    const at = audioContext.currentTime + Math.max(wait, 0);
    alertPlan = { elapsed: state.nextAlert, at, voice: makeVoice(at) };
  } catch (error) {
    alertPlan = null; // 渡せなくても、表に戻ったときに鳴らす道は残る
  }
}

/** 渡してある通知音を取り消す。まだ鳴り始めていなければ、鳴らずに終わる。 */
function cancelAlert() {
  if (alertPlan === null) return;
  stopVoice(alertPlan.voice);
  alertPlan = null;
}

/** 通知音を鳴らす。計測は止めず、そのまま進み続ける。 */
function fireAlert() {
  /* オーディオ側の時計が渡した時刻を過ぎていれば、もう鳴っている。止めずに
   * そのまま鳴らせておく。過ぎていなければ（音を止められていた等）ここで鳴らす。 */
  if (alertPlan !== null && alertPlan.elapsed === state.nextAlert
      && audioContext !== null && audioContext.currentTime >= alertPlan.at) {
    alertPlan = null;
  } else {
    cancelAlert();
    playSound();
  }
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
    : `通知まで ${formatTime(Math.max(state.nextAlert - lapElapsed(), 0))}`;
  ui.alertHint.textContent = text;
  ui.miniHint.textContent = text;
}

// ---------------------------------------------------------------- Markdown 書き出し

/** 確定ラップに、進行中のラップを末尾に足した書き出し用の一覧。
 *
 * 「通過」は保存せず、ここで先頭から積み直す。ラップを手直ししても
 * 積算がずれないようにするため。
 */
function lapRows() {
  const rows = state.laps.map((entry) => ({ ...entry }));
  const current = lapElapsed();
  if (current > 0) {
    rows.push({
      type: state.currentType,
      duration: current,
      startedAt: state.lapStartedAt,
      endedAt: null, // 未確定
      note: state.lapNote.trim(),
    });
  }
  let total = 0;
  for (const row of rows) {
    total += row.duration;
    row.total = total;
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

/** 記録と集計を Markdown 文字列にする。
 *
 * 集計はボタン 1 つずつの行を出し、そのあとに「作業計」「休憩計」を置く。
 * ボタンを増やしても、どれにどれだけ使ったかが残るようにする。
 */
function buildMarkdown() {
  const rows = lapRows();
  const total = totalElapsed();
  const counts = {};
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1;
  const share = (seconds) => Math.round(total > 0 ? (seconds / total) * 100 : 0);

  const lines = [`# Hakadory 記録 ${dateText(Date.now())}`, ''];
  if (state.startedAt !== null) {
    lines.push(`- 計測開始: ${dateText(state.startedAt)} ${clockText(state.startedAt)}`);
  }
  lines.push(`- 書き出し: ${dateText(Date.now())} ${clockText(Date.now())}`);
  lines.push(`- 総時間: ${formatTime(total)}`);
  lines.push('', '## 集計', '',
    '| 種別 | 時間 | 回数 | 割合 |',
    '| --- | ---: | ---: | ---: |');
  for (const group of GROUPS) {
    const types = summaryTypes(group.name);
    for (const type of types) {
      const seconds = liveSum(type);
      lines.push(`| ${typeLabel(type)} | ${formatTime(seconds)}`
        + ` | ${counts[type] ?? 0} | ${share(seconds)}% |`);
    }
    const seconds = groupSum(types);
    const count = types.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
    lines.push(`| **${group.text}計** | **${formatTime(seconds)}**`
      + ` | **${count}** | **${share(seconds)}%** |`);
  }
  lines.push(`| **合計** | **${formatTime(total)}** | **${rows.length}** | **100%** |`);

  lines.push('', '## ラップ', '',
    '| # | 種別 | ラップ | 通過 | 開始 | 終了 | メモ |',
    '| ---: | --- | ---: | ---: | --- | --- | --- |');
  if (!rows.length) lines.push('| - | - | - | - | - | - | - |');
  rows.forEach((row, index) => {
    const number = row.endedAt ? String(index + 1) : `${index + 1}（進行中）`;
    // 表の区切りと衝突しないよう、メモの縦棒だけ逃がす
    const note = String(row.note ?? '').replace(/\|/g, '\\|');
    lines.push(`| ${number} | ${typeLabel(row.type)} | ${formatTime(row.duration)}`
      + ` | ${formatTime(row.total)} | ${clockText(row.startedAt)}`
      + ` | ${clockText(row.endedAt)} | ${note} |`);
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

/** 作業ラップにして計測を動かす（止まっていれば動かす）。
 *
 * 使う種別は、集計が「作業」側の最初のボタン。既定のままなら「作業」で、
 * ボタンを入れ替えたときはその先頭になる。
 */
function startWorkSession() {
  lap(firstWorkType());
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

/** その要素を見本の色で塗る（色ごとのクラスは置かず、--tint に流し込む）。 */
function setTint(el, color) {
  const name = PALETTE_NAMES.includes(color) ? color : DEFAULT_COLOR;
  el.classList.add('tinted');
  el.style.setProperty('--tint', `var(--${name})`);
}

/** その要素を種別の色で塗る。 */
function setTypeTint(el, type) {
  setTint(el, typeColor(type));
}

function insertLapRow(number, entry, total) {
  const row = document.createElement('tr');
  row.tabIndex = 0;
  row.dataset.index = String(number - 1); // 押されたときに laps の位置を引く
  const note = entry.note ?? '';
  const cells = [
    ['col-no', String(number)],
    ['col-type', typeLabel(entry.type)],
    ['col-num', formatTime(entry.duration)],
    ['col-num', formatTime(total)],
    ['col-note', note],
  ];
  for (const [cls, text] of cells) {
    const cell = document.createElement('td');
    cell.className = cls;
    cell.textContent = text;
    // メモ列は幅で切るので、全文はカーソルを載せたときに出す
    if (cls === 'col-note' && text !== '') cell.title = text;
    row.appendChild(cell);
  }
  setTypeTint(row, entry.type);
  const body = ui.lapRows;
  body.insertBefore(row, body.firstChild); // 新しい順
}

// ------------------------------------------------- ボタンの組み立て

/* ラップのボタンは 1 行 LAP_COLUMNS 個ずつ並べる。その行が 1 個や 2 個で
 * 終わるとき（ボタンが 1・2・4・5 個のとき）は、右側を空けたままにせず
 * 行いっぱいまで広げる。列を LAP_COLUMNS ではなく LAP_SPAN_UNITS で刻んで
 * おき、1 個なら 6 列ぶん、2 個なら 3 列ぶん、3 個なら 2 列ぶんを占めさせる
 * （6 は 1・2・3 のどれでも割り切れる）。 */
function lapSpan(index, count) {
  const rowStart = Math.floor(index / LAP_COLUMNS) * LAP_COLUMNS;
  return LAP_SPAN_UNITS / Math.min(LAP_COLUMNS, count - rowStart);
}

/** ラップのボタン 1 つ。名前と色はボタンの定義から引く。 */
function makeLapButton(entry, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action';
  button.textContent = entry.label;
  setTint(button, entry.color);
  button.addEventListener('click', onClick);
  return button;
}

/** タイマータブのラップのボタン。 */
function renderLapButtons() {
  const types = currentTypes();
  ui.lapButtons.textContent = '';
  types.forEach((entry, index) => {
    const button = makeLapButton(entry, () => lap(entry.id));
    button.style.gridColumn = `span ${lapSpan(index, types.length)}`;
    ui.lapButtons.appendChild(button);
  });
}

/** 手直しシートの「種別を変える」。押せるかどうかは renderLapSheet が決める。 */
function renderSheetTypes() {
  const types = currentTypes();
  ui.sheetTypes.textContent = '';
  types.forEach((entry, index) => {
    const button = makeLapButton(entry, () => sheetSetType(entry.id));
    button.dataset.lapType = entry.id;
    button.style.gridColumn = `span ${lapSpan(index, types.length)}`;
    ui.sheetTypes.appendChild(button);
  });
}

/** ミニ表示の操作。「開始」も同じ行に置き、余りは下の行へ折り返す。 */
function renderMiniKeys() {
  const holder = ui.miniKeys;
  holder.textContent = '';
  holder.appendChild(ui.miniStart); // 同じ部品を使い回す（表示の更新先が変わらない）
  for (const entry of currentTypes()) {
    holder.appendChild(makeLapButton(entry, () => lap(entry.id)));
  }
}

/* 分の入力欄。名前や色が変わっただけのときに捨てて作り直すと、打っている
 * 途中の入力欄が消える（打ち直しになる）ので、並びが同じなら書き換える。 */
let minutesParts = [];

/** 設定タブの、ボタンごとの通知までの分。 */
function renderMinutes() {
  const types = currentTypes();
  const same = minutesParts.length === types.length
    && minutesParts.every((part, index) => part.id === types[index].id);
  if (same) {
    types.forEach((entry, index) => {
      const part = minutesParts[index];
      part.name.textContent = entry.label;
      part.field.setAttribute('aria-label', `${entry.label}の通知までの分`);
      setTint(part.field, entry.color);
      // 打っている最中の入力欄は触らない（同じ文字列なら書き込まない）
      if (part.field.value !== entry.minutes) part.field.value = entry.minutes;
    });
    return;
  }

  const holder = ui.minutes;
  holder.textContent = '';
  minutesParts = [];
  for (const entry of types) {
    const cell = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'caption caption-small';
    name.textContent = entry.label;
    const field = document.createElement('input');
    field.className = 'field';
    field.inputMode = 'numeric';
    field.size = 3;
    field.value = entry.minutes;
    field.setAttribute('aria-label', `${entry.label}の通知までの分`);
    setTint(field, entry.color);
    field.addEventListener('input', () => {
      entry.minutes = field.value;
      saveSettings();
      resetAlert();
    });
    const unit = document.createElement('span');
    unit.className = 'caption caption-small';
    unit.textContent = '分';
    cell.append(name, field, unit);
    holder.appendChild(cell);
    minutesParts.push({ id: entry.id, name, field });
  }
}

/** 設定タブのプロファイルの選択肢。 */
function renderProfiles() {
  const holder = ui.profiles;
  holder.textContent = '';
  profileNames().forEach((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.classList.toggle('is-selected', index === settings.profileIndex);
    button.title = name;
    button.textContent = name;
    button.addEventListener('click', () => setProfile(index));
    holder.appendChild(button);
  });
  // 最後の 1 つは消せない（ボタンが無くなるため）
  $('profile-remove').hidden = settings.profiles.length <= 1;
}

/* 編集画面の行 -> その行の色・集計の部品。色と集計側を選び直したときは、
 * 行ごと作り直さずにここを見て印だけ付け替える（押したボタンを消さない）。 */
let typeRowParts = [];

/** 設定タブのボタン一覧。数・並び・名前が変わったときだけ呼ぶ。 */
function renderTypeRows() {
  const types = currentTypes();
  const holder = ui.typeRows;
  holder.textContent = '';
  typeRowParts = [];
  types.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'type-row';
    const parts = { colors: {}, groups: {}, field: null };
    typeRowParts.push(parts);

    const field = document.createElement('input');
    field.className = 'field field-label';
    field.maxLength = MAX_LABEL;
    field.value = entry.label;
    field.setAttribute('aria-label', 'ボタンの名前');
    setTint(field, entry.color);
    parts.field = field;
    // 1 文字ごとに直さず、入力欄から離れたところで確定する
    const commit = () => {
      setTypeField(index, 'label', field.value);
      // 整えた結果に合わせる（空欄や、他と同じ名前は元に戻る）
      field.value = entry.label;
    };
    field.addEventListener('change', commit);
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') field.blur();
    });

    const colors = document.createElement('span');
    colors.className = 'swatches';
    for (const [name, text] of PALETTE) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.textContent = '●';
      swatch.title = text;
      swatch.setAttribute('aria-label', `色: ${text}`);
      swatch.classList.toggle('is-selected', name === entry.color);
      setTint(swatch, name);
      swatch.addEventListener('click', () => setTypeField(index, 'color', name));
      parts.colors[name] = swatch;
      colors.appendChild(swatch);
    }

    const groups = document.createElement('span');
    groups.className = 'groups';
    for (const group of GROUPS) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'choice';
      choice.textContent = group.text;
      choice.setAttribute('aria-label', `集計: ${group.text}`);
      choice.classList.toggle('is-selected', group.name === entry.group);
      choice.addEventListener('click', () => setTypeField(index, 'group', group.name));
      parts.groups[group.name] = choice;
      groups.appendChild(choice);
    }

    const tools = document.createElement('span');
    tools.className = 'type-tools';
    for (const [text, step] of [['↑', -1], ['↓', 1]]) {
      if (!(index + step >= 0 && index + step < types.length)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text';
      button.textContent = text;
      button.setAttribute('aria-label', step < 0 ? '上へ移動' : '下へ移動');
      button.addEventListener('click', () => moveType(index, step));
      tools.appendChild(button);
    }
    if (types.length > MIN_LAP_TYPES) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text';
      remove.textContent = '削除';
      remove.addEventListener('click', () => {
        if (window.confirm(`ボタン「${entry.label}」を消します。`
          + '\n記録したラップは名前と色を保ったまま残ります。')) {
          removeType(index);
        }
      });
      tools.appendChild(remove);
    }

    row.append(field, colors, groups, tools);
    holder.appendChild(row);
  });

  ui.typeCount.textContent = `${types.length} / ${MAX_LAP_TYPES}`;
  // 上限に達したら「追加」を出さないだけにする（上の「6 / 6」で足りる）
  $('type-add').hidden = !canAddType();
}

/** 名前・色・集計側を直したときに、行を作り直さず印と色だけ付け替える。 */
function restyleTypeRows() {
  currentTypes().forEach((entry, index) => {
    const parts = typeRowParts[index];
    if (!parts) return;
    for (const [name, swatch] of Object.entries(parts.colors)) {
      swatch.classList.toggle('is-selected', name === entry.color);
    }
    for (const [name, choice] of Object.entries(parts.groups)) {
      choice.classList.toggle('is-selected', name === entry.group);
    }
    setTint(parts.field, entry.color);
    // 名前は打っている本人の入力欄なので、違うときだけ書き換える
    if (parts.field.value !== entry.label) parts.field.value = entry.label;
  });
}

/** 名前を 1 つ聞く（プロファイルの追加と改名）。取り消したら null。 */
function askName(message, initial) {
  const answer = window.prompt(`${message}（${MAX_PROFILE_NAME} 文字まで）`, initial);
  return answer === null ? null : answer;
}

// ------------------------------------------------- 手直しシート（画面）

let sheetIndex = null; // 開いているラップの位置。null は進行中のラップ

/** 手直しシートを開く。index が null なら進行中のラップを対象にする。 */
function openLapSheet(index) {
  if (index !== null && !state.laps[index]) return;
  sheetIndex = index;
  renderLapSheet();
  $('lap-sheet').hidden = false;
}

function closeLapSheet() {
  $('lap-sheet').hidden = true;
  sheetIndex = null;
}

function renderLapSheet() {
  const running = sheetIndex === null;
  const entry = running
    ? { type: state.currentType, duration: lapElapsed() }
    : state.laps[sheetIndex];
  const title = $('lap-sheet-title');
  // 進行中は数字が動き続けるので、長さは出さない
  title.textContent = running
    ? `進行中 ・ ${typeLabel(entry.type)}`
    : `${sheetIndex + 1} 本目 ・ ${typeLabel(entry.type)} ・ ${formatTime(entry.duration)}`;
  setTypeTint(title, entry.type);
  for (const button of ui.sheetTypes.querySelectorAll('button[data-lap-type]')) {
    button.disabled = button.dataset.lapType === entry.type;
  }

  /* 進行中のラップのメモは大きい時計の下に入力欄があるので、シートには出さない
   * （同じものが 2 か所にあると、どちらが効くのか分からなくなる）。 */
  $('note-row').hidden = running;
  if (!running) $('note-edit').value = entry.note ?? '';

  const prev = $('merge-prev');
  const next = $('merge-next');
  if (running) {
    // 進行中を前と結合する = 直前の確定を取り消す（種別も前に戻る）
    const last = state.laps[state.laps.length - 1];
    prev.hidden = !last;
    if (last) prev.textContent = `前のラップ（${typeLabel(last.type)}）と結合`;
    next.hidden = true;
  } else {
    prev.hidden = !canMergeLap(sheetIndex, 'prev');
    prev.textContent = `前のラップ（${mergeTargetLabel(sheetIndex, 'prev')}）と結合`;
    next.hidden = false;
    next.textContent = `次のラップ（${mergeTargetLabel(sheetIndex, 'next')}）と結合`;
  }
  // 結合できる相手が居ないときは見出しごと引っ込める
  $('merge-note').hidden = prev.hidden && next.hidden;

  // 画面から元に戻せるようにする（スマートフォンには Ctrl+Z が無い）
  $('undo').disabled = !canUndo();
  $('redo').disabled = !canRedo();
}

/** シートで書いたメモを、対象の確定ラップへ書き戻す。
 *
 * 種別の変更や結合の前にも呼ぶ。書いたものが黙って消えないようにするため
 * （結合は位置がずれるので、必ず先に書き戻す）。
 */
function commitSheetNote() {
  if (sheetIndex === null) return;
  setLapNote(sheetIndex, $('note-edit').value);
}

function sheetSetType(type) {
  commitSheetNote();
  if (sheetIndex === null) setCurrentType(type); else setLapType(sheetIndex, type);
  closeLapSheet();
}

function sheetMerge(direction) {
  commitSheetNote();
  if (sheetIndex === null) mergeCurrentIntoPrev();
  else mergeLap(sheetIndex, direction);
  closeLapSheet();
}

/** メモを書き戻してシートを閉じる（閉じる操作はどれもこれを通す）。 */
function sheetClose() {
  commitSheetNote();
  closeLapSheet();
}

/* 元に戻す / やり直すは、シートに書きかけのメモを書き戻さない。
 * 書き戻すと、戻したはずのメモをその場で上書きしてしまう。 */
function sheetHistory(action) {
  action();
  closeLapSheet();
}

/** ラップ一覧を laps から作り直す（通過は毎回積算し直す）。 */
function rebuildLapRows() {
  ui.lapRows.textContent = '';
  let total = 0;
  state.laps.forEach((entry, index) => {
    total += entry.duration;
    insertLapRow(index + 1, entry, total);
  });
}

/** ラベル・操作の表示を現在の状態に合わせる。 */
function refresh() {
  const type = state.currentType;
  const label = typeLabel(type);
  const running = state.running;

  const lapTitle = ui.lapTitle;
  lapTitle.textContent = `${label} ・ ${running ? '計測中' : '停止中'}`;
  setTypeTint(lapTitle, type);
  setTypeTint(ui.lap, type);
  setTypeTint(ui.miniLap, type);
  const miniType = ui.miniType;
  miniType.textContent = label;
  setTypeTint(miniType, type);

  // 合計の見出しは、その側にある最初のボタンの色を借りる（無ければ淡色のまま）
  for (const group of GROUPS) {
    const color = groupColor(group.name);
    if (color === null) ui[group.head].classList.remove('tinted');
    else setTint(ui[group.head], color);
  }
  ui.keyHint.textContent = keyHint(); // 単キーの案内はボタンの数で変わる

  // 結合や「元に戻す」でメモが変わるので、入力欄を state に合わせ直す
  // （同じ文字列のときは触らない。書いている途中のカーソルを飛ばさないため）
  if (ui.lapNote.value !== state.lapNote) ui.lapNote.value = state.lapNote;

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
  ui.miniTotal.textContent = formatTime(total);
  ui.miniLap.textContent = formatTime(current);
  for (const group of GROUPS) {
    ui[group.ref].textContent = formatTime(groupSum(summaryTypes(group.name)));
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
    scheduleAlert(); // 時刻が近づいたぶんを、間引かれても鳴るよう先に渡しておく
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

  /* ボタンとプロファイル。プロファイルがまだ無かったころの設定からは、
   * 種別ごとの通知の分数（alertMinutes）だけを既定のボタンへ引き継ぐ。
   * 保存は新しい形だけにして、二重の真実を作らない。 */
  settings.profiles = normalizeProfiles(data.profiles, data.alertMinutes);
  const index = data.profileIndex;
  settings.profileIndex = (Number.isInteger(index) && index >= 0
    && index < settings.profiles.length) ? index : 0;

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
  // 読み込んだ音声は、実体が IndexedDB から取れたところで選び直す
  if (SOUNDS.some((sound) => sound.id === data.sound) || data.sound === CUSTOM_SOUND) {
    settings.sound = data.sound;
  }
  if (typeof data.customSoundName === 'string') {
    settings.customSoundName = data.customSoundName;
  }
  const volume = Number(data.volume);
  if (Number.isFinite(volume) && volume >= 0 && volume <= 100) settings.volume = volume;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // 保存できない設定でも動作は続ける
  }
}

/** タブを閉じても記録が消えないよう、計測状態も保存しておく。
 *
 * 記録が持つのは種別の識別子だけなので、記録に出てくる種別の定義も一緒に
 * 保存する。desktop 版は記録自体を保存しないので控えも保存しないが、web 版は
 * 記録が残る。これがないと、消したボタンや別プロファイルのラップが、
 * 次に開いたときに名無しになる。
 */
function saveSession() {
  try {
    const types = {};
    for (const id of recordedTypes()) {
      const { label, color, group } = typeInfo(id);
      types[id] = { label, color, group };
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: SESSION_VERSION,
      savedAt: Date.now(),
      types,
      running: state.running,
      totalBase: state.totalBase,
      lapBase: state.lapBase,
      runningSince: state.running ? Date.now() : null,
      currentType: state.currentType,
      lapNote: state.lapNote,
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
  // 版 1 は種別の控えを持たない（種別は既定の 3 つだけだったので、そのまま読める）
  if (!data || (data.version !== 1 && data.version !== SESSION_VERSION)) return;

  // 記録に出てくる種別を控えに戻す（今のボタンに無いものも名前と色を保つ）
  if (data.types && typeof data.types === 'object') {
    for (const [id, info] of Object.entries(data.types)) {
      if (!info || typeof info !== 'object') continue;
      rememberType(id, info.label, info.color, info.group);
    }
  }

  state.totalBase = Number(data.totalBase) || 0;
  state.lapBase = Number(data.lapBase) || 0;
  state.currentType = (typeof data.currentType === 'string' && data.currentType)
    ? data.currentType : typeIds()[0];
  state.lapNote = typeof data.lapNote === 'string' ? data.lapNote : '';
  state.laps = Array.isArray(data.laps)
    ? data.laps.filter((entry) => entry && typeof entry.type === 'string'
        && entry.type && Number.isFinite(entry.duration))
      // メモは後から足したので、それより前に保存されたラップには無い
      .map((entry) => ({ ...entry, note: String(entry.note ?? '') }))
    : [];
  // 控えにも今のボタンにも無い種別（古い保存など）は、識別子を名前にして残す
  for (const id of recordedTypes()) rememberType(id, id);
  recomputeSums(); // 保存された合計は当てにせず、ラップから数え直す
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

/** 報告リンクは、行き先が決まっているときだけ見せる。 */
function applyFeedbackLinks() {
  const url = FEEDBACK_URL.trim();
  for (const link of document.querySelectorAll('a[data-feedback]')) link.href = url;
  for (const area of document.querySelectorAll('[data-feedback-area]')) area.hidden = !url;
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

/** 音量つまみ。動かしている間は鳴っている音にも即あてる。 */
function bindVolume() {
  const field = $('volume');
  const label = $('volume-value');
  field.value = String(settings.volume);
  label.textContent = `${settings.volume}%`;
  field.addEventListener('input', () => {
    settings.volume = Number(field.value);
    label.textContent = `${settings.volume}%`;
    if (masterGain !== null) masterGain.gain.value = volumeGain();
    if (customAudio !== null) customAudio.volume = Math.min(volumeGain(), 1);
  });
  // つまみを離したところで保存し、決めた大きさをその場で確かめられるように鳴らす
  field.addEventListener('change', () => {
    saveSettings();
    playSound();
  });
}

/** 通知音の選択肢を並べ直す。読み込んだ音声は、実体があるときだけ出す。 */
function buildSounds() {
  const holder = $('sound-choices');
  const choices = SOUNDS.map((sound) => [sound.id, sound.label]);
  if (customAudio !== null) {
    choices.push([CUSTOM_SOUND, settings.customSoundName || '読み込んだ音']);
  }
  holder.textContent = '';
  for (const [id, label] of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.classList.toggle('is-selected', settings.sound === id);
    button.title = label;
    button.textContent = label;
    button.addEventListener('click', () => {
      settings.sound = id;
      saveSettings();
      buildSounds();
      playSound(); // 選んだその場で確かめられるように鳴らす
      resetAlert(); // 渡してある通知音も選び直した音に替える
    });
    holder.appendChild(button);
  }
  $('sound-clear').hidden = customAudio === null;
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
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;

  // 手直しシートを開いている間は、裏のキー操作を効かせない
  // （そのままだと W などでラップが確定し、シートが別のラップを指してしまう）
  if (!$('lap-sheet').hidden) {
    if (event.key !== 'Escape') return; // 押した先のボタンには任せる
    event.preventDefault();
    sheetClose(); // 書きかけのメモは残す
    return;
  }

  // 元に戻す / やり直すだけは修飾キー付き
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const pressed = event.key.toLowerCase();
    if (pressed === 'z' || pressed === 'y') {
      event.preventDefault();
      // Ctrl+Shift+Z も Ctrl+Y と同じ「やり直す」
      if (pressed === 'y' || event.shiftKey) redo(); else undo();
      return;
    }
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const actions = { ' ': toggleRun, m: openMini };
  /* ラップは並び順の 1〜n で押す。既定の 3 つが残っているうちは、
   * これまでどおり W / B / L でも押せる（消したボタンのキーは効かない）。 */
  const type = lapKeys()[key];
  const action = type !== undefined ? () => lap(type) : actions[key];
  if (!action) return;
  event.preventDefault();
  action();
}

function init() {
  cacheUi();
  loadSettings();
  rememberTypes(); // 記録を読む前に、今のボタンを控えへ（名前と色の引き元）
  setTheme(settings.theme);
  loadSession();

  for (const button of document.querySelectorAll('button[data-tab]')) {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  }
  for (const button of document.querySelectorAll('button[data-theme]')) {
    button.addEventListener('click', () => setTheme(button.dataset.theme));
  }
  ui.start.addEventListener('click', toggleRun);
  ui.miniStart.addEventListener('click', toggleRun);

  // 押し間違いの手直し。行と進行中の見出しから同じシートを開く
  ui.lapRows.addEventListener('click', (event) => {
    const row = event.target.closest('tr');
    if (row && row.dataset.index !== undefined) openLapSheet(Number(row.dataset.index));
  });
  ui.lapRows.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr');
    if (!row || row.dataset.index === undefined) return;
    event.preventDefault();
    openLapSheet(Number(row.dataset.index));
  });
  ui.lapTitle.addEventListener('click', () => openLapSheet(null));
  ui.lapTitle.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openLapSheet(null);
  });
  $('merge-prev').addEventListener('click', () => sheetMerge('prev'));
  $('merge-next').addEventListener('click', () => sheetMerge('next'));
  $('undo').addEventListener('click', () => sheetHistory(undo));
  $('redo').addEventListener('click', () => sheetHistory(redo));
  $('note-save').addEventListener('click', sheetClose);
  /* 書きかけのメモは、どの閉じ方でも残す（Escape で消えると、打ち直しになる）。
   * 入力欄にカーソルがある間は onKeyDown が働かないので、ここで受ける。 */
  $('note-edit').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    sheetClose();
  });
  $('lap-sheet-close').addEventListener('click', sheetClose);
  $('lap-sheet-back').addEventListener('click', sheetClose);

  // 進行中のラップに添えるメモ。ラップを押した時点でそのラップへ移る
  ui.lapNote.addEventListener('input', () => { state.lapNote = ui.lapNote.value; });
  ui.lapNote.addEventListener('change', saveSession);

  $('reset').addEventListener('click', reset);
  $('export').addEventListener('click', exportMarkdown);
  $('compact').addEventListener('click', openMini);
  $('mini-back').addEventListener('click', closeMini);
  $('preview').addEventListener('click', playSound);
  $('sound-pick').addEventListener('click', () => $('sound-file').click());
  $('sound-file').addEventListener('change', (event) => {
    pickCustomSound(event.target.files[0]);
    event.target.value = ''; // 同じファイルをもう一度選べるようにしておく
  });
  $('sound-clear').addEventListener('click', clearCustomSound);

  bindToggle('alert-enabled', 'alertEnabled', resetAlert);
  bindToggle('alert-repeat', 'alertRepeat', resetAlert);
  bindToggle('auto-start-enabled', 'autoStartEnabled', resetAutoSchedule);
  bindToggle('auto-end-enabled', 'autoEndEnabled', resetAutoSchedule);
  bindToggle('keep-awake', 'keepAwake', applyKeepAwake);

  // ボタンとプロファイル（ボタンごとの通知の分は renderMinutes が受け持つ）
  $('profile-add').addEventListener('click', () => {
    const name = askName('新しいプロファイルの名前', NEW_PROFILE_NAME);
    if (name !== null) addProfile(name, false);
  });
  $('profile-copy').addEventListener('click', () => {
    const name = askName('複製したプロファイルの名前', NEW_PROFILE_NAME);
    if (name !== null) addProfile(name, true);
  });
  $('profile-rename').addEventListener('click', () => {
    const index = settings.profileIndex;
    const name = askName('プロファイルの名前', settings.profiles[index].name);
    if (name !== null) renameProfile(index, name);
  });
  $('profile-remove').addEventListener('click', () => {
    const index = settings.profileIndex;
    if (!window.confirm(`「${settings.profiles[index].name}」を消します。`
      + 'ボタンの並びと通知の分数も消えます。\n記録したラップは残ります。')) return;
    removeProfile(index);
  });
  $('type-add').addEventListener('click', addType);

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

  applyFeedbackLinks();
  // ボタンに関わる部分（ラップのボタン・分・ミニ・プロファイル・一覧）を組み立てる
  renderLapButtons();
  renderSheetTypes();
  renderMiniKeys();
  renderMinutes();
  renderProfiles();
  renderTypeRows();
  bindVolume();
  buildSounds();
  loadCustomSound(); // 音声ファイルの読み込みを待たずに画面は出す
  buildDays();
  document.addEventListener('keydown', onKeyDown);
  /* 音は最初の操作より前には出せない。最初に押されたところで用意しておくと、
   * 一度も鳴らしていなくても、最初の通知から予約が効く。 */
  const openOnce = () => { openAudio(); scheduleAlert(); };
  document.addEventListener('pointerdown', openOnce, { once: true });
  document.addEventListener('keydown', openOnce, { once: true });
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
