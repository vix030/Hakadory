# -*- coding: utf-8 -*-
"""Hakadory (web) のスモークテスト。

ブラウザや Node.js を用意せずに検証できる範囲を確認する。

- 公開に必要なファイルがそろっているか
- index.html / app.js / sw.js / manifest が指す先が実在するか
- app.js が触る id が index.html に実在するか（移植時の取りこぼし検出）
- 外部ホストへの参照が混ざっていないか（第三者に閲覧を知られないため）

実行:
    py test_Hakadory.py
"""

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

REQUIRED = (
    "index.html", "style.css", "app.js", "sw.js", "manifest.webmanifest",
    "icon-32.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png",
    "README.md",
)


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as handle:
        return handle.read()


def test_required_files():
    for name in REQUIRED:
        path = os.path.join(HERE, name)
        assert os.path.isfile(path), "missing: %s" % name
        assert os.path.getsize(path) > 0, "empty: %s" % name


def test_html_references_exist():
    """href / src が指すローカルファイルが実在するか。"""
    html = read("index.html")
    targets = re.findall(r'(?:href|src)="([^"]+)"', html)
    assert targets, "no references found"
    for target in targets:
        assert not target.startswith(("http:", "https:", "//")), \
            "外部ホストへの参照: %s" % target
        assert os.path.isfile(os.path.join(HERE, target)), "missing asset: %s" % target


def feedback_url():
    """app.js の FEEDBACK_URL（要望・不具合の報告フォーム）。未設定なら空文字。"""
    found = re.search(r"const FEEDBACK_URL = '([^']*)';", read("app.js"))
    assert found, "app.js の FEEDBACK_URL が読めない"
    return found.group(1).strip()


def test_no_external_hosts():
    """HTML / CSS / JS のどこにも外部ホストを書かない。

    唯一の例外が報告フォームの URL。これは押したときだけ別タブで開くもので、
    ページを見ただけでは外部に何も出ない（自動で読み込む先ではない）。
    """
    allowed = {feedback_url()} - {""}
    for name in ("index.html", "style.css", "app.js", "sw.js"):
        found = set(re.findall(r'https?://[^\s"\'()]+', read(name))) - allowed
        assert not found, "%s に外部 URL: %s" % (name, sorted(found))


def test_feedback_link():
    """報告フォームへの入口が、行き先の有無にかかわらず筋の通った形か。"""
    html = read("index.html")
    js = read("app.js")

    # リンクと、それを包む（未設定のとき隠す）かたまりは同じ数だけ置く
    links = re.findall(r'<a class="link" data-feedback\b', html)
    areas = re.findall(r"data-feedback-area\b", html)
    assert len(links) == len(areas) == 2, (len(links), len(areas))
    # 隠す既定と、外部タブで開く際の作法
    assert html.count("data-feedback-area hidden") == 2
    assert html.count('rel="noopener"') == len(links)
    # href は JS が入れる。HTML に直書きしない（未設定のまま公開しても踏めない）
    assert 'data-feedback href=' not in html
    assert "applyFeedbackLinks()" in js
    assert ".link" in read("style.css"), "CSS に .link がない"

    url = feedback_url()
    if url:
        assert url.startswith("https://"), "報告フォームは https で: %s" % url


def test_manifest():
    data = json.loads(read("manifest.webmanifest"))
    for key in ("name", "short_name", "start_url", "scope", "display", "icons"):
        assert key in data, "manifest に %s がない" % key
    assert data["display"] in ("standalone", "minimal-ui", "fullscreen")
    sizes = set()
    for icon in data["icons"]:
        assert os.path.isfile(os.path.join(HERE, icon["src"])), icon["src"]
        sizes.add(icon["sizes"])
    # インストール可能にするには 192 と 512 の両方が要る
    assert {"192x192", "512x512"} <= sizes, sizes
    assert any(icon.get("purpose") == "maskable" for icon in data["icons"])


def test_service_worker_assets():
    assets = re.search(r"const ASSETS = \[(.*?)\];", read("sw.js"), re.S)
    assert assets, "ASSETS が読めない"
    for name in re.findall(r"'([^']+)'", assets.group(1)):
        if name == "./":
            continue
        assert os.path.isfile(os.path.join(HERE, name)), "sw.js が存在しない %s を参照" % name


def html_ids():
    return set(re.findall(r'id="([^"]+)"', read("index.html")))


def test_js_ids_exist():
    """app.js が引く id が index.html にあるか。"""
    js = read("app.js")
    ids = html_ids()

    for name in re.findall(r"\$\('([^']+)'\)", js):
        assert name in ids, "index.html に id=%s がない" % name

    cached = re.search(r"const UI_IDS = \[(.*?)\];", js, re.S)
    assert cached, "UI_IDS が読めない"
    for name in re.findall(r"'([^']+)'", cached.group(1)):
        assert name in ids, "UI_IDS の %s が index.html にない" % name

    # 分単位の入力欄は種別ごとに min-<種別> という規則で引いている
    for lap_type in ("work", "break", "long_break"):
        assert "min-%s" % lap_type in ids, lap_type


def test_data_attributes():
    html = read("index.html")
    assert set(re.findall(r'data-lap="([^"]+)"', html)) == {"work", "break", "long_break"}
    assert set(re.findall(r'data-theme="([^"]+)"', html)) == {"standard", "dark", "light"}
    assert set(re.findall(r'data-tab="([^"]+)"', html)) == {"timer", "settings", "help", "log"}
    ids = html_ids()
    for tab in ("timer", "settings", "help", "log"):
        assert "page-%s" % tab in ids, tab


def test_js_and_css_agree():
    """JS が付け外しするクラスが CSS に定義されているか。"""
    css = read("style.css")
    for name in ("type-work", "type-break", "type-long", "action-start",
                 "action-pause", "is-selected", "is-on", "flash", "inline-mini",
                 "pip"):
        assert ".%s" % name in css, "CSS に .%s がない" % name


def test_lap_edit_ui():
    """押し間違いを直す入口（手直しシート）がひととおりそろっているか。"""
    html = read("index.html")
    js = read("app.js")
    css = read("style.css")

    # シートの種別ボタンは 3 種類そろえる
    assert set(re.findall(r'data-lap-type="([^"]+)"', html)) == \
        {"work", "break", "long_break"}
    # 行と進行中の見出しは、キーボードでも開ける
    assert 'id="lap-title"' in html and 'role="button"' in html
    assert 'tabindex="0"' in html
    for name in ("sheet", "sheet-back", "sheet-body", "sheet-note", "tappable"):
        assert ".%s" % name in css, "CSS に .%s がない" % name

    # 行から laps の位置を引くための印
    assert "row.dataset.index" in js and "dataset.index = String" in js
    # 手直しの操作がそろっている
    for name in ("function setLapType(", "function setCurrentType(",
                 "function mergeLap(", "function mergeCurrentIntoPrev(",
                 "function recomputeSums(",
                 "function undo(", "function redo(", "function pushUndo("):
        assert name in js, "app.js に %s がない" % name
    # 記録を変える操作は、すべて控えを取ってから行う
    for name in ("function lap(", "function setLapType(", "function setLapNote(",
                 "function setCurrentType(",
                 "function mergeLap(", "function mergeCurrentIntoPrev("):
        body = js[js.index(name):]
        body = body[:body.index("\n}\n")]
        assert "pushUndo()" in body, "%s が控えを取っていない" % name
    # 「通過」と合計は保存せず、そのつどラップから数え直す
    assert "total: totalElapsed()" not in js, "通過を保存し直している"
    assert "recomputeSums(); // 保存された合計は当てにせず" in js


def test_lap_note():
    """ラップのメモが、入力・一覧・保存・書き出しのすべてに通っているか。"""
    html = read("index.html")
    js = read("app.js")
    css = read("style.css")

    # 進行中のラップに書く欄（大きい時計の下）と、確定ラップを直す欄（シート）
    assert 'id="lap-note"' in html and 'for="lap-note"' in html
    assert 'id="note-edit"' in html and 'id="note-save"' in html
    # 進行中のラップはシートに欄を出さない（同じものが 2 か所にならないように）
    assert 'id="note-row"' in html and "$('note-row').hidden = running" in js
    # 一覧の「メモ」列
    assert '<th class="col-note">メモ</th>' in html
    assert ".col-note" in css and "table-layout: fixed" in css

    for name in ("function joinNotes(", "function setLapNote(",
                 "function commitSheetNote("):
        assert name in js, "app.js に %s がない" % name
    # 結合したメモは捨てない（前後の確定ラップ・進行中・直前へ畳む の 4 経路）
    assert js.count("joinNotes(") >= 5, js.count("joinNotes(")
    # 控え（元に戻す）と localStorage の保存の両方に、進行中のメモを通す
    assert js.count("lapNote: state.lapNote") >= 2, "控えか保存のどちらかが漏れている"
    assert "state.lapNote = shot.lapNote ?? ''" in js
    # 復元も両方（古い保存データには note が無いので空文字で補う）
    assert "typeof data.lapNote === 'string'" in js
    assert "note: String(entry.note ?? '')" in js
    # .md 書き出しの表はメモ列を持ち、表を壊さないよう縦棒だけ逃がす
    assert "| # | 種別 | ラップ | 通過 | 開始 | 終了 | メモ |" in js
    assert "| ---: | --- | ---: | ---: | --- | --- | --- |" in js
    assert r"replace(/\|/g, '\\|')" in js


def test_theme_tokens():
    """3 つの配色すべてで同じ変数がそろっているか（未定義の色を出さない）。"""
    css = read("style.css")
    blocks = re.findall(r':root(?:\[data-theme="(\w+)"\])?\s*\{([^}]*)\}', css)
    tokens = {}
    for name, body in blocks:
        tokens.setdefault(name or "standard", set()).update(
            re.findall(r"(--[\w-]+):", body))
    assert set(tokens) == {"standard", "dark", "light"}, set(tokens)
    base = tokens["standard"]
    assert len(base) >= 10, base
    for name, names in tokens.items():
        assert names == base, "%s の色が %s だけ違う" % (name, base ^ names)


def test_desktop_parity():
    """デスクトップ版と食い違うと困る既定値をそろえておく。"""
    js = read("app.js")
    for line in ("work: '25'", "break: '5'", "long_break: '30'"):
        assert line in js, line
    assert "const DEFAULT_REPEAT_MINUTES = '5';" in js
    assert "const DEFAULT_AUTO_START_TIME = '09:00';" in js
    assert "const DEFAULT_AUTO_END_TIME = '18:00';" in js
    assert "const DEFAULT_AUTO_START_DAYS = [0, 1, 2, 3, 4];" in js


def test_no_decimals_in_display():
    """時間も割合も小数点以下は出さない（デスクトップ版と同じ仕様）。"""
    js = read("app.js")
    assert "toFixed" not in js, "割合に小数が残っている"
    assert "100.0%" not in js, "合計の割合に小数が残っている"
    # 時計の初期表示（index.html）も小数を含まない
    for text in re.findall(r'class="[^"]*clock[^"]*"[^>]*>([^<]+)<', read("index.html")):
        assert "." not in text, "時計の初期表示に小数: %s" % text


def main():
    for name, test in sorted(globals().items()):
        if name.startswith("test_") and callable(test):
            test()
    print("[test] Hakadory (web) smoke test passed")


if __name__ == "__main__":
    main()
