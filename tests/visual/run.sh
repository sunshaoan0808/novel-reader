#!/bin/bash
# 视觉回归测试入口：起无头 Chromium → 跑 tests/visual/runner.py → 汇总结果。
#   全过 exit 0；任一失败 exit 非零并打印失败项。
#   WWW_URL 可覆盖被测页面（用于对 bug 复现副本跑 TDD 验证）。
# 用法：
#   bash tests/visual/run.sh
#   WWW_URL=file:///tmp/buggy-www/index.html bash tests/visual/run.sh
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${VPORT:-9444}"
CHROME="${VISUAL_CHROME:-/opt/meta-chromium/chrome}"
PROFILE="/tmp/visreg-profile-$$"
URL="${WWW_URL:-file:///home/hatch/workspace/github/novel-reader/www/index.html}"

"$CHROME" --headless=new --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" --no-sandbox --disable-gpu --hide-scrollbars \
  >/dev/null 2>&1 &
CPID=$!
cleanup(){ kill "$CPID" 2>/dev/null; rm -rf "$PROFILE" 2>/dev/null || true; }
trap cleanup EXIT

python3 "$DIR/runner.py" --port "$PORT" --url "$URL" --shots "$DIR/shots"
RC=$?
exit $RC
