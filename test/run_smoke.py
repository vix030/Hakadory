"""Hakadory (web) の煙テスト。

app.js の中身をブラウザで実際に動かし、ボタンとプロファイルの操作と、
前の版の設定・記録の引き継ぎを確かめる。テスト用の道具はこのフォルダだけに
置き、公開するファイル（index.html / app.js / style.css）には何も足さない。

    py test/run_smoke.py            ボタンとプロファイルの操作（smoke.js）
    py test/run_smoke.py migrate    前の版からの引き継ぎ（seed.js + migrate.js）

やっていること: 公開するファイルを一時フォルダへ写し、その index.html にだけ
検査用のスクリプトを足して、headless の Edge / Chrome で開く。検査の結果は
#smoke-out に書き出させ、--dump-dom で読み取る。

app.js は module ではない普通のスクリプトなので、そこで定義した関数と定数は
あとから読み込むスクリプトからそのまま呼べる。だから本体には検査用の
入口を作らなくてよい。
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE_FILES = ("index.html", "app.js", "style.css")
TEST_FILES = ("smoke.js", "seed.js", "migrate.js")

BROWSERS = (
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
)


def find_browser():
    """Edge か Chrome の場所。見つからなければ None。"""
    for path in BROWSERS:
        real = os.path.expandvars(path)
        if "%" not in real and os.path.isfile(real):
            return real
    return None


def build_page(work, migrate):
    """公開するファイルを写し、index.html にだけ検査用のスクリプトを足す。"""
    for name in PAGE_FILES:
        shutil.copyfile(os.path.join(ROOT, name), os.path.join(work, name))
    for name in TEST_FILES:
        shutil.copyfile(os.path.join(HERE, name), os.path.join(work, name))
    page = os.path.join(work, "index.html")
    text = io.open(page, encoding="utf-8").read()
    # seed だけは app.js より前に置く（前の版の設定を先に残しておくため）
    before = '<script src="seed.js"></script>\n' if migrate else ""
    after = "migrate.js" if migrate else "smoke.js"
    text = text.replace(
        '<script src="app.js"></script>',
        '%s<script src="app.js"></script>\n<script src="%s"></script>'
        % (before, after))
    io.open(page, "w", encoding="utf-8", newline="\n").write(text)
    return page


def run(browser, page, profile):
    """headless で開いて、書き出された DOM を返す。"""
    result = subprocess.run(
        [browser, "--headless", "--disable-gpu", "--no-first-run",
         "--user-data-dir=" + profile, "--virtual-time-budget=6000",
         "--dump-dom", "file:///" + page.replace("\\", "/")],
        capture_output=True)
    return result.stdout.decode("utf-8", "replace")


def main():
    migrate = len(sys.argv) > 1 and sys.argv[1] == "migrate"
    sys.stdout.reconfigure(encoding="utf-8")
    browser = find_browser()
    if browser is None:
        print("[smoke] Edge / Chrome が見つからないので飛ばした")
        return 0

    work = tempfile.mkdtemp(prefix="hakadory-smoke-")
    try:
        page = build_page(work, migrate)
        # 前の回の localStorage が残っていると既定から始まらないので毎回まっさらにする
        dom = run(browser, page, os.path.join(work, "browser"))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    found = re.search(r'<pre id="smoke-out">(.*?)</pre>', dom, re.S)
    if not found:
        print("[smoke] 結果が見つからない（読み込みの途中で落ちた可能性）")
        print(dom[-2000:])
        return 1
    body = (found.group(1).replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&amp;", "&"))
    print(body)
    lines = body.splitlines()
    fails = [line for line in lines if not line.startswith(("PASS", "SKIP"))]
    print("[smoke] %d 件中 %d 件が失敗" % (len(lines), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
