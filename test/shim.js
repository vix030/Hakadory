/* ブラウザなしで app.js を読み込むための、最小限の器。
 *
 * headless ブラウザが使えない環境でも、計測と連携の中身だけは確かめられるように
 * する。画面の見た目は再現しない（部品は値を覚えるだけの入れ物）。
 *
 * 使い方は test/link_test.js を参照。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** index.html に出てくる id を全部集める（app.js が引くのはここにあるものだけ）。 */
function idsFromHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ids = new Set();
  for (const found of html.matchAll(/\sid="([^"]+)"/g)) ids.add(found[1]);
  return ids;
}

class Node_ {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.attributes = {};
    this.listeners = {};
    this._text = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.href = '';
    this.type = '';
    this.size = 0;
    this.tabIndex = 0;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      get length() { return classes.size; },
    };
  }

  get textContent() { return this._text; }

  /** 文字を入れると中身は消える（本物と同じ）。空文字で子を空にできる。 */
  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }

  get firstChild() { return this.children[0] ?? null; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') this._text += node;
      else this.appendChild(node);
    }
  }

  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  remove() {
    if (this.parentNode === null) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  getAttribute(name) { return this.attributes[name] ?? null; }

  removeAttribute(name) { delete this.attributes[name]; }

  addEventListener(name, handler) {
    (this.listeners[name] ??= []).push(handler);
  }

  removeEventListener(name, handler) {
    const list = this.listeners[name];
    if (list) this.listeners[name] = list.filter((item) => item !== handler);
  }

  /** 押されたことにする（テストから使う）。 */
  dispatch(name, event = {}) {
    for (const handler of this.listeners[name] ?? []) {
      handler({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
    }
  }

  closest() { return null; }

  querySelector() { return null; }

  querySelectorAll() { return []; }

  focus() {}

  blur() {}
}

/** localStorage の代わり。中身は素の Map。 */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    _map: map,
  };
}

/** app.js を読み込み、テストから触れる入口をまとめて返す。 */
function load() {
  const elements = new Map();
  for (const id of idsFromHtml()) elements.set(id, new Node_());

  const document_ = {
    documentElement: new Node_('html'),
    body: new Node_('body'),
    head: new Node_('head'),
    title: '',
    visibilityState: 'visible',
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => new Node_(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };

  const timers = [];   // setInterval に渡された処理（自動では回さない）
  const storage = makeStorage();
  const window_ = {
    addEventListener() {},
    removeEventListener() {},
    confirm: () => true,
    prompt: () => null,
    indexedDB: null,          // 音声ファイルの置き場所。無い扱いで構わない
    documentPictureInPicture: undefined,
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };

  const context = {
    document: document_,
    window: window_,
    localStorage: storage,
    navigator: { serviceWorker: undefined, wakeLock: undefined },
    location: { protocol: 'file:', href: 'file:///test' },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval() {},
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {},
    requestAnimationFrame: (fn) => { fn(0); return 0; },
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    URL,
    Blob: class {},
    Audio: class {},
    Intl,
    isNaN,
    parseInt,
    parseFloat,
  };
  context.globalThis = context;
  context.self = context;
  Object.assign(window_, {
    localStorage: storage,
    setInterval: context.setInterval,
    setTimeout: context.setTimeout,
  });

  const vm = require('vm');
  vm.createContext(context);
  /* app.js の const / let は、素の script と同じでグローバルには乗らない。
   * 末尾に一行足して、テストから触りたいものだけを外へ出す。 */
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + `
;globalThis.__test = { settings, state, ui, LINK_KEY, LAPS_KEY,
  LINK_VERSION, LINK_START, LINK_SELECT, LAPS_MAX, LAPS_KEEP,
  SETTINGS_KEY, SESSION_KEY };
`;
  vm.runInContext(source, context, { filename: 'app.js' });
  return {
    app: context, inner: context.__test, elements, storage, timers, Node: Node_,
  };
}

module.exports = { load, makeStorage, Node: Node_ };
