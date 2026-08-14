/* 前の版の設定と記録が、そのまま引き継がれているかを見る。 */
(function () {
  const out = [];
  const ok = (name, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + name
    + (cond ? '' : ' :: ' + JSON.stringify(extra ?? null)));

  try {
    const types = currentTypes();
    ok('one default profile', settings.profiles.length === 1
      && settings.profiles[0].name === '既定', profileNames());
    ok('default 3 buttons', typeIds().join(',') === 'work,break,long_break', typeIds());
    ok('alertMinutes carried over',
      types.map((entry) => entry.minutes).join(',') === '45,7,20',
      types.map((entry) => entry.minutes));
    ok('minutes fields show them',
      Array.from(ui.minutes.querySelectorAll('input')).map((el) => el.value)
        .join(',') === '45,7,20',
      Array.from(ui.minutes.querySelectorAll('input')).map((el) => el.value));
    ok('alert seconds from the button', alertSeconds() === 7 * 60, alertSeconds());
    ok('other settings kept', settings.theme === 'dark' && settings.sound === 'bell'
      && settings.volume === 40 && settings.alertRepeatMinutes === '3'
      && settings.autoStartTime === '08:30', settings);
    ok('old alertMinutes not saved back',
      JSON.parse(localStorage.getItem(SETTINGS_KEY)).alertMinutes === undefined,
      Object.keys(JSON.parse(localStorage.getItem(SETTINGS_KEY))));

    ok('session v1 laps restored', state.laps.length === 2, state.laps);
    ok('note filled in for old laps', state.laps[1].note === '', state.laps[1]);
    ok('current type kept', state.currentType === 'break', state.currentType);
    ok('lap note kept', state.lapNote === '書きかけ', state.lapNote);
    ok('sums recomputed', Math.round(state.sums.work) === 60
      && Math.round(state.sums.long_break) === 30, state.sums);
    ok('labels from the default buttons',
      typeLabel('long_break') === '長休憩', typeLabel('long_break'));
    ok('rows rebuilt', ui.lapRows.rows.length === 2, ui.lapRows.rows.length);
    saveSession();
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY));
    ok('saved as version 2', stored.version === 2, stored.version);
    ok('saved types cover the record',
      Object.keys(stored.types).sort().join(',') === 'break,long_break,work',
      stored.types);
  } catch (error) {
    out.push('THROW ' + (error && error.stack ? error.stack : error));
  }

  const box = document.createElement('pre');
  box.id = 'smoke-out';
  box.textContent = out.join('\n');
  document.body.appendChild(box);
})();
