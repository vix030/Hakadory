"""タスク連携（Dandory との受け渡し）の検査を回す。

    py test/run_link.py

test/shim.js の最小の器に app.js を読み込ませて確かめるので、ブラウザは要らない。
Node が無い環境では、VS Code / Cursor に同梱されている Electron を Node として
使う（ELECTRON_RUN_AS_NODE=1）。どちらも見つからなければ、飛ばして 0 を返す。
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ELECTRON_APPS = (
    r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
    r"%LOCALAPPDATA%\Programs\cursor\Cursor.exe",
    r"%ProgramFiles%\Microsoft VS Code\Code.exe",
)


def find_node():
    """(実行するコマンド, 追加の環境変数) を返す。見つからなければ (None, None)。"""
    for name in ("node", "nodejs"):
        found = shutil.which(name)
        if found:
            return found, {}
    for path in ELECTRON_APPS:
        real = os.path.expandvars(path)
        if "%" not in real and os.path.isfile(real):
            return real, {"ELECTRON_RUN_AS_NODE": "1"}
    return None, None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    node, extra = find_node()
    if node is None:
        print("[link] Node も Electron も見つからないので飛ばした")
        return 0
    env = dict(os.environ)
    env.update(extra)
    result = subprocess.run([node, os.path.join(HERE, "link_test.js")],
                            capture_output=True, env=env)
    sys.stdout.write(result.stdout.decode("utf-8", "replace"))
    complaint = result.stderr.decode("utf-8", "replace").strip()
    if complaint:
        sys.stderr.write(complaint + "\n")
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
