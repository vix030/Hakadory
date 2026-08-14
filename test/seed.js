/* 前の版（v1.4）が残した設定と記録を置いてから app.js を読ませる。 */
(function () {
  const at = Date.now();
  localStorage.setItem('Hakadory.settings', JSON.stringify({
    theme: 'dark',
    alertEnabled: true,
    alertRepeat: true,
    sound: 'bell',
    volume: 40,
    customSoundName: '',
    alertMinutes: { work: '45', break: '7', long_break: '20' },
    alertRepeatMinutes: '3',
    autoStartEnabled: true,
    autoStartTime: '08:30',
    autoEndEnabled: false,
    autoEndTime: '18:00',
    autoStartDays: [0, 1, 2],
    keepAwake: false,
  }));
  localStorage.setItem('Hakadory.session', JSON.stringify({
    version: 1,
    savedAt: at,
    running: false,
    totalBase: 120,
    lapBase: 30,
    runningSince: null,
    currentType: 'break',
    lapNote: '書きかけ',
    laps: [
      { type: 'work', duration: 60, startedAt: at, endedAt: at, note: '設計' },
      { type: 'long_break', duration: 30, startedAt: at, endedAt: at },
    ],
    sums: { work: 60, break: 0, long_break: 30 },
    startedAt: at,
    lapStartedAt: at,
  }));
})();
