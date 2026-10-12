# 视觉回归测试（tests/visual）

无头 Chromium + CDP，360×800 真机视口，对 App 做"跑起来看"级别的回归断言。
900+ node 单元测试拦不住的 UI bug（v31 onclick 引号、v32 顶栏游离 `0`、v33 聊天抖动）
全部是真机肉眼抓出来的——这一层补的就是这个缺口。

## 用法

```bash
bash tests/visual/run.sh
```

- 全过 exit 0；任一失败 exit 非零并打印失败项。
- 截图存 `tests/visual/shots/`（gitignore，不入库）；断言日志 `assert_log.json` 入库。
- `WWW_URL=file:///tmp/buggy-www/index.html bash tests/visual/run.sh` 可对指定页面跑
  （TDD 验证 bug 复现副本用）。

## 用例（4 个，全部 TDD 还债式：先在 bug 代码上确认能失败）

| 用例 | 断言 | 还的债 |
|---|---|---|
| `ctxbar-no-stray` | 顶栏 ctxbar：低占用 innerHTML 不以游离 `0` 结尾；高占用警告条不被 `NaN` 吞 | v32 一元正号 bug |
| `scroll-no-jitter` | 上滑看历史时：打字机跑 500ms、streamToken 打 5 个 token，scrollTop 漂移 < 4px | v33 抖动 bug |
| `scroll-hidebars` | 下滑超 140px：顶栏+底栏联动隐藏（底栏整体移出视口）、正文补位；小幅上滑保持隐藏；大幅上滑恢复 | v33 底栏不隐藏 |
| `layout-no-overlap` | 聊天/设置/穿越三页：文字重叠 0、横向溢出 0、页面无横向滚动 | 16 页 UI 审计专项 |

`audit.js` 的几何判定用的是**可见区域**（rect 与滚动祖先可视盒求交），
滚出/半滚出滚动容器的内容不参与重叠判定——否则 chatlog 里滚出视口的消息
会产生幻影重叠。

## 给 build.sh 的钩子（发版门禁）

在 `build.sh` 的 javac 守卫之后、正式打包之前加一行：

```bash
bash ~/workspace/github/novel-reader/tests/visual/run.sh || exit 1
```

失败直接中断，不再产出坏包（同 javac 守卫的处理方式）。

## 加新用例

1. 在 `runner.py` 的 `CASES` 里加 `(name, async_fn)`，`async_fn(c)` 返回 `(ok, detail)`，
   `c` 是 CDP 封装（`c.ev(js, await_promise)` / `c.shot(path)`）。
2. 页面内可用的全局函数：`showChat/showSettings/showTraverse`（页面跳转）、
   `renderCtxBar/streamToken/twStart/twStop`（聊天行为）、`window.__setHeadHidden`
   （顶栏/底栏显隐测试钩子）。
3. 先造 bug 复现副本验证用例能红，再在修复代码上确认变绿。

## 已知问题（2026-09-30 首次运行发现，2026-10-13 已修复关闭）

`scroll-hidebars` 的 `barGone` 子项曾在当前代码上**失败**（2026-09-30）：
隐藏后底栏 rect 隐藏前 722–791、隐藏后 722–791，位移为 0——v33 的底栏隐藏实现有残留 bug。
根因：`.chatbar{position:sticky;bottom:0}` 在 `margin-bottom:-69px` 时被浏览器
重新锚定上拉，恰好抵消 `translateY(110%)` 的下移。
**状态（2026-10-13）**：App 侧已修复（隐藏时改 `position:fixed` 脱离文档流收占位，
见 AGENTS.md 沉浸式条目），`tests/visual/assert_log.json` 最近一次运行 7 个用例全部通过。
本节保留作历史记录；若未来某次回归变红，先查僵尸 chrome 端口冲突再查代码。
