/* Hakadory (web) の煙テスト。index.html のコピーに読み込ませ、結果を
 * #smoke-out に書き出す（--dump-dom で読む）。 */
(function () {
  const out = [];
  const ok = (name, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + name
    + (cond ? '' : ' :: ' + JSON.stringify(extra ?? null)));
  const spans = () => Array.from(ui.lapButtons.children)
    .map((el) => el.style.gridColumn);
  const labels = () => currentTypes().map((entry) => entry.label);

  try {
    // --- 出発点は既定の 3 つ ---
    ok('default 3 types', typeIds().join(',') === 'work,break,long_break', typeIds());
    ok('default spans', spans().join('|') === 'span 2|span 2|span 2', spans());
    ok('key hint', ui.keyHint.textContent.includes('1-3'), ui.keyHint.textContent);
    ok('mini keys = start + types', ui.miniKeys.children.length === 4,
      ui.miniKeys.children.length);
    ok('sheet types', ui.sheetTypes.children.length === 3);

    // --- 単キー（既定の 3 つが残っている間は W / B / L も効く） ---
    let keys = lapKeys();
    ok('digit keys', keys['1'] === 'work' && keys['3'] === 'long_break', keys);
    ok('w/b/l while defaults remain',
      keys.w === 'work' && keys.b === 'break' && keys.l === 'long_break', keys);

    // --- 行の余りを空けたままにしない ---
    removeType(2);
    removeType(1);
    ok('1 type spans full row', spans().join('|') === 'span 6', spans());
    ok('cannot remove last', removeType(0) === false && typeIds().length === 1);
    ok('w dropped with its button', lapKeys().b === undefined, lapKeys());
    addType();
    ok('2 types split row', spans().join('|') === 'span 3|span 3', spans());
    addType();
    ok('3 types thirds', spans().join('|') === 'span 2|span 2|span 2', spans());
    addType();
    ok('4th wraps and fills', spans().join('|') === 'span 2|span 2|span 2|span 6', spans());
    addType();
    ok('5 types', spans().slice(3).join('|') === 'span 3|span 3', spans());
    addType();
    ok('6 types', spans().slice(3).join('|') === 'span 2|span 2|span 2', spans());
    ok('cannot add over max', canAddType() === false && addType() === false,
      typeIds().length);
    ok('add hidden at max', document.getElementById('type-add').hidden === true);
    ok('new ids do not collide', new Set(typeIds()).size === 6, typeIds());
    ok('minutes fields', ui.minutes.children.length === 6, ui.minutes.children.length);
    ok('editor rows', ui.typeRows.children.length === 6, ui.typeRows.children.length);
    ok('count text', ui.typeCount.textContent === '6 / 6', ui.typeCount.textContent);
    ok('key hint follows count', ui.keyHint.textContent.includes('1-6'),
      ui.keyHint.textContent);

    // --- 名前と色 ---
    ok('label is trimmed to 5', setTypeField(0, 'label', 'あいうえおかきく')
      && currentTypes()[0].label === 'あいうえお', labels());
    setTypeField(1, 'label', 'あいうえお');
    // 5 文字に収めるため、数字のぶんだけ手前を削る
    ok('label made unique', currentTypes()[1].label === 'あいうえ2', labels());
    ok('empty label refused', setTypeField(0, 'label', '   ') === false, labels());
    ok('bad color refused', setTypeField(0, 'color', 'gold') === false);
    ok('color applied', setTypeField(0, 'color', 'cyan')
      && ui.lapButtons.children[0].style.getPropertyValue('--tint') === 'var(--cyan)',
      ui.lapButtons.children[0].style.cssText);
    ok('swatch mark moved',
      ui.typeRows.children[0].querySelectorAll('.swatch.is-selected').length === 1);
    ok('group applied', setTypeField(0, 'group', 'break')
      && summaryTypes('break').includes(typeIds()[0]), summaryTypes('break'));
    setTypeField(0, 'group', 'work');

    // 名前・色・集計側を直したときは、編集画面の行と分の入力欄を作り直さない
    // （直したばかりの部品が消えると、続けて押した先が無くなる）
    const rowNode = ui.typeRows.children[0];
    const minuteNode = ui.minutes.querySelectorAll('input')[0];
    setTypeField(0, 'label', 'かきくけこ');
    ok('row kept on rename', ui.typeRows.children[0] === rowNode
      && rowNode.querySelector('input').value === 'かきくけこ',
      rowNode.querySelector('input').value);
    ok('minutes field kept on rename',
      ui.minutes.querySelectorAll('input')[0] === minuteNode
      && ui.minutes.children[0].textContent.startsWith('かきくけこ'),
      ui.minutes.children[0].textContent);
    setTypeField(0, 'color', 'pink');
    ok('row kept on color change', ui.typeRows.children[0] === rowNode);
    removeType(5);
    ok('rows rebuilt when the count changes',
      ui.typeRows.children[0] !== rowNode && ui.typeRows.children.length === 5,
      ui.typeRows.children.length);

    // --- 記録が持つのは識別子だけ（名前と色はそのつど引く） ---
    while (currentTypes().length > 2) removeType(currentTypes().length - 1);
    setTypeField(0, 'label', '雑務');
    setTypeField(1, 'label', '会議');
    // 増やしたボタン（既定に無い識別子）で記録する。別プロファイルが同じ
    // 識別子を持たないので、消したあとも控えの名前がそのまま残る
    const meeting = typeIds()[1];
    lap(meeting);
    state.lapBase = 60;      // 1 分ぶんのラップにする
    lap(typeIds()[0]);       // ここで会議のラップが確定する
    ok('lap keeps id', state.laps[0].type === meeting, state.laps[0]);
    setTypeField(1, 'label', '打合せ');
    ok('renaming shows in old lap', typeLabel(meeting) === '打合せ', typeLabel(meeting));
    ok('lap row shows new name', ui.lapRows.rows[0].cells[1].textContent === '打合せ',
      ui.lapRows.rows[0].cells[1].textContent);
    ok('sum follows the lap', Math.round(liveSum(meeting)) === 60, state.sums);

    // --- 消したボタンのラップは名前と色を保つ ---
    removeType(1);
    ok('removed type keeps label', typeLabel(meeting) === '打合せ', typeLabel(meeting));
    ok('removed type still summed', summaryTypes('work').includes(meeting),
      summaryTypes('work'));
    ok('md keeps removed type', buildMarkdown().includes('| 打合せ |'));
    ok('md has group totals', buildMarkdown().includes('**作業計**')
      && buildMarkdown().includes('**休憩計**'));

    // --- プロファイル ---
    const lapCount = state.laps.length;
    addProfile('勉強', false);
    ok('profile added', profileNames().join(',') === '既定,勉強', profileNames());
    ok('profile switched', settings.profileIndex === 1);
    ok('profile has defaults', typeIds().join(',') === 'work,break,long_break', typeIds());
    ok('laps kept across profiles', state.laps.length === lapCount, state.laps.length);
    ok('label kept across profiles', typeLabel(meeting) === '打合せ', typeLabel(meeting));
    ok('md still has the old lap', buildMarkdown().includes('| 打合せ |'));
    renameProfile(1, 'とてもながいなまえ');
    ok('profile name trimmed', profileNames()[1] === 'とてもながいなま', profileNames());
    addProfile('既定', true);
    ok('profile name made unique', profileNames()[2] === '既定2', profileNames());
    ok('copy took current types', typeIds().join(',') === 'work,break,long_break');
    removeProfile(2);
    ok('profile removed', settings.profiles.length === 2, profileNames());
    ok('w/b/l back with the default buttons', lapKeys().w === 'work', lapKeys());
    setProfile(0);
    ok('back to first profile', settings.profileIndex === 0);
    ok('cannot remove last profile',
      (removeProfile(1), removeProfile(0), settings.profiles.length === 1),
      profileNames());

    // 今のプロファイルにある種別は、控えより今の名前が勝つ（この順を崩さない）
    setProfile(0);
    addProfile('確認', false);              // 既定の 3 つ（work を含む）
    const before = typeLabel('work');
    setTypeField(0, 'label', '本業');
    ok('current profile wins over registry',
      before === '作業' && typeLabel('work') === '本業', [before, typeLabel('work')]);

    // --- 保存と読み直し ---
    let stored = null;
    try {
      saveSession();
      stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (error) {
      stored = null;
    }
    if (stored === null) {
      out.push('SKIP session round trip (localStorage が使えない)');
    } else {
      ok('session version 2', stored.version === 2, stored.version);
      ok('session keeps type names', stored.types[meeting]
        && stored.types[meeting].label === '打合せ', stored.types);
      delete typeRegistry[meeting];        // 閉じて開き直した状態にする
      state.laps = [];
      loadSession();
      ok('restored laps', state.laps.length === lapCount, state.laps.length);
      ok('restored label', typeLabel(meeting) === '打合せ', typeLabel(meeting));
      ok('restored color', typeColor(meeting) === stored.types[meeting].color,
        typeColor(meeting));
    }
  } catch (error) {
    out.push('THROW ' + (error && error.stack ? error.stack : error));
  }

  const box = document.createElement('pre');
  box.id = 'smoke-out';
  box.textContent = out.join('\n');
  document.body.appendChild(box);
})();
