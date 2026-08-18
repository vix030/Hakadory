/* タスク連携（Dandory との受け渡し）の検査。
 *
 * headless ブラウザが使えない環境でも回せるよう、test/shim.js の最小の器に
 * app.js を読み込ませて確かめる。実行:
 *
 *     py test/run_link.py
 *     node test/link_test.js
 */
'use strict';

const { load } = require('./shim.js');

const out = [];
const ok = (name, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + name
  + (cond ? '' : ' :: ' + JSON.stringify(extra ?? null)));

const box = load();
const app = box.app;              // 関数宣言（readLink など）はここに乗る
const { settings, state, ui, LINK_KEY, LAPS_KEY, LINK_VERSION,
  LAPS_MAX, LAPS_KEEP } = box.inner;

const putLink = (payload) => box.storage.setItem(LINK_KEY, JSON.stringify(payload));
const laps = () => JSON.parse(box.storage.getItem(LAPS_KEY) || '[]');

try {
  // --- 出発点 ---
  ok('link on by default', settings.linkEnabled === true);
  ok('no task at first', state.task === null);
  ok('task row hidden', ui.taskRow.hidden === true);
  ok('no laps yet', laps().length === 0);

  // --- 壊れた指示は読まない ---
  for (const bad of [{}, { version: 2, seq: 1 }, { version: 1 },
    { version: 1, seq: 'x' }, [1, 2]]) {
    putLink(bad);
    ok('reject ' + JSON.stringify(bad), app.readLink() === null, bad);
  }
  box.storage.setItem(LINK_KEY, '{壊れている');
  ok('reject broken json', app.readLink() === null);

  // --- 名前の無いタスクは受け取らない ---
  putLink({ version: 1, seq: 1, task: { id: 't0', title: '  ' } });
  ok('reject nameless task', app.readLink().task === null);

  // --- 開く前に置かれていた start では、ラップを切らずにタスクだけ受け取る ---
  putLink({
    version: 1, seq: 1, action: 'start',
    task: { id: 't1', title: 'カット 12' },
  });
  const lapsBefore = state.laps.length;
  app.pollLink();
  ok('task received', state.task && state.task.id === 't1', state.task);
  ok('no lap cut on first read', state.laps.length === lapsBefore);
  ok('empty note filled with task', state.lapNote === 'カット 12', state.lapNote);
  ok('task row shown', ui.taskRow.hidden === false);
  ok('task name rendered', ui.taskName.textContent === 'カット 12');
  ok('seq remembered', settings.linkSeq === 1, settings.linkSeq);

  // --- 同じ番号は二度実行しない ---
  app.pollLink();
  ok('same seq ignored', settings.linkSeq === 1 && state.laps.length === lapsBefore);

  // --- 以後の start はラップを切り、確定したぶんが実績として戻る ---
  app.lap('work');            // 計測を始める（未計測からの 1 押し目）
  state.lapBase = 60;         // 60 秒ぶん測ったことにする
  putLink({
    version: 1, seq: 2, action: 'start', lap_type: 'break',
    task: { id: 't2', title: 'カット 13' },
  });
  app.pollLink();
  ok('lap switched', state.currentType === 'break', state.currentType);
  ok('task switched', state.task.id === 't2', state.task);

  const records = laps();
  ok('one record written', records.length === 1, records.length);
  const record = records[0] ?? {};
  ok('record version', record.version === LINK_VERSION);
  ok('record keeps the task at confirm time', record.task_id === 't1', record);
  ok('record keeps the title', record.task_title === 'カット 12', record);
  ok('record type', record.type === 'work' && record.group === 'work', record);
  ok('record seconds', record.seconds >= 60, record.seconds);
  ok('record note', record.note === 'カット 12', record.note);
  ok('record uid', typeof record.uid === 'string' && record.uid.includes('-'));
  ok('record stamps', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(record.started_at)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(record.ended_at), record);

  // --- 打ちかけのメモは、タスク名で上書きしない ---
  state.lapNote = '手で書いたメモ';
  putLink({
    version: 1, seq: 3, action: 'select',
    task: { id: 't3', title: 'カット 14' },
  });
  app.pollLink();
  ok('select keeps the note', state.lapNote === '手で書いたメモ', state.lapNote);
  ok('select does not cut a lap', laps().length === 1);
  ok('select still switches task', state.task.id === 't3');

  // --- 知らない種別が来ても、作業側の先頭に寄せて切る ---
  state.lapBase = 30;
  putLink({ version: 1, seq: 4, action: 'start', lap_type: '知らない種別', task: null });
  app.pollLink();
  ok('unknown type falls back', state.currentType === app.firstWorkType(),
    state.currentType);
  ok('null task clears', state.task === null);
  ok('task row hidden again', ui.taskRow.hidden === true);
  ok('second record written', laps().length === 2, laps().length);

  // --- 連携を切ると、読みにも書きにも行かない ---
  settings.linkEnabled = false;
  app.onLinkToggled();
  state.lapBase = 15;
  app.lap('work');
  ok('no record while off', laps().length === 2, laps().length);
  putLink({ version: 1, seq: 9, task: { id: 't9', title: 'x' } });
  app.pollLink();
  ok('no read while off', state.task === null && settings.linkSeq === 4,
    settings.linkSeq);
  settings.linkEnabled = true;
  app.onLinkToggled();
  ok('reading resumes', state.task && state.task.id === 't9', state.task);

  // --- 実績は際限なく育たない ---
  for (let index = 0; index < LAPS_MAX + 5; index += 1) {
    app.appendLapRecord({ version: LINK_VERSION, uid: 'n-' + index, seconds: 1 });
  }
  /* 上限を超えた時点で新しい LAPS_KEEP 件まで詰め、そこからまた足していく。
   * ちょうど LAPS_KEEP 件で止まるのではなく、上限を超えないことが決まりごと。 */
  const trimmed = laps();
  ok('stays under the cap', trimmed.length <= LAPS_MAX, trimmed.length);
  ok('trimmed at least once', trimmed.length >= LAPS_KEEP
    && trimmed.length < LAPS_KEEP + 100, trimmed.length);
  ok('kept the newest', trimmed[trimmed.length - 1].uid === 'n-' + (LAPS_MAX + 4),
    trimmed[trimmed.length - 1]);
} catch (error) {
  out.push('FAIL threw :: ' + (error && error.stack ? error.stack : error));
}

console.log(out.join('\n'));
const fails = out.filter((line) => !line.startsWith('PASS'));
console.log(`[link] ${out.length} 件中 ${fails.length} 件が失敗`);
process.exitCode = fails.length ? 1 : 0;
