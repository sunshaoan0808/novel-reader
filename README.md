# novel-reader · 浮生

单机 WebView 的小说人物 RP 聊天 App：自研 RP 引擎，App 内直接开聊，无后端、用户自配 LLM Key。

- 包名 `com.ling.novelreader`，Android 原生壳 + WebView（`www/` 纯 HTML/JS/CSS，零依赖）
- 人物卡由 novel-distill 管线从原著蒸馏而来（红楼梦全本），随 App 内置

## 功能

- **单聊 / 群聊**：群聊 v2 对标 SillyTavern Natural Order——点名优先、每位成员独立发言欲（0–100 可调）、一轮最多 3 人依次发言、自然/轮流两种排序策略
- **记忆系统**：记忆事件簿（Talkie Memory Album 式）、记忆 Pin、上下文用量条、单条消息 👍/👎
- **世界书**：触发词匹配（单条上限 8 条注入）、触发可视化、ST 格式导入
- **人设**：Persona 全局/单会话覆盖、叙事视角与人称切换
- **剧情线**：角色原著剧情大纲（读者可编辑）、剧情选项卡
- **平行存档**：快照聊天 + 记忆 + 剧情线
- **写卡助手**：五步向导生成原创角色卡；角色卡 PNG 导出（Tavern chara_card_v2 兼容）
- **穿越模式（P0–P3）**：魂穿（扮演原著角色进入剧情锚点）、肉身穿越（AI 十项完整身份捏造、逐项重随、现代人直穿携带手机/打火机/纸巾、出戏值）、酒馆角色卡导入（PNG tEXt/iTXt + JSON，AI 补完卡片世界）、异世界穿越（P2：书↔卡异世界框架，林黛玉→水浒式；水浒 profile/plot 数据待蒸馏管线接入，不预置人物剧情）、组团穿越（P3：2–4 人组队，复用群聊 v2 发言欲 0–100 可调 + Natural Order）；世界状态栏 + `<ws>` 状态自动合并、OOC 提醒
- **RP 设置**：温度 / Top P / 最大 token / 上下文、ST 预设导入、正则表达式、打字机效果（默认开，可打断）、聊天壁纸（默认 + 4 套古风深色渐变）、界面字体（系统/宋体/楷体）、记忆小说风格（白话直叙/古风雅致/戏剧化）、大体积角色卡与聊天历史自动迁 IndexedDB（失败回退 localStorage）

## 试玩（不用打包）

`www/` 是纯静态页面，直接用浏览器打开即可体验全部聊天逻辑（聊天需要自备 OpenAI 兼容接口的 Key，在 App 内设置页填写，只存本地）：

```bash
cd www && python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

Node 回归测试（834 项）：

```bash
for f in tests/test_*.js; do node "$f"; done
```

## 打包 APK

`android/build.sh` 是极简原生壳打包脚本（javac + d8 + aapt2 + apksigner，不依赖 Gradle）：

```bash
cd android
# 需先准备 Android SDK（build-tools 34、platform-34）并导出 ANDROID_HOME
VCODE=31 VNAME=1.30 bash build.sh
```

签名用自动生成的 debug keystore（发布请换正式签名）。

成品 APK 请走 GitHub Releases 分发，不要提交进仓库。

## 数据来源

`www/data/` 内置红楼梦人物卡与剧情大纲，由 novel-distill 管线蒸馏生成（`tools/gen_char_plots.py`）。红楼梦原著已进入公有领域。

## License

MIT
