#!/usr/bin/env python3
"""导入卡聊天"我/你"指代翻转的视觉验证（360x800 无头 Chromium 真机视口）。

背景（详见 tests/test_imported_pronoun.js 里的根因说明）:
  导入卡的 few-shot 对话示例里说话人标签错位 —— 卡片原文里 {{char}} 抢话先开口的
  <START> 块被重排成"角色在回答自己还没听到的话"，且卡片自带示例把 {{user}} 标签
  原样漏进 prompt，被 subMacros 展开成"你"，正好撞上开头那句"你是<角色名>"。
  模型照着这个错位的 few-shot 学，回复里我/你的指代就翻了。

为什么截图能证伪:
  翻转的源头是渲染出来的 prompt，不是 UI。聊天页本身看不出问题，必须把人设 prompt
  拉出来看【对话示例】那一段的"标签 -> 台词"配对。本脚本把 App 里真实的卡
  （RP_CARDIMPORT 解析 ST v2 卡）+ 真实的组装函数（RP_PROMPT.buildMessages，
  与 RP.chat 同一个入口）跑一遍，再走 App 自带的 showSystem() 预览页截图。

断言:
  1. 聊天页渲染出开场 + 两轮对话（导入卡真的接上了 runId=imported 的历史）；
  2. 人设 prompt 里【对话示例】的"角色名：还在？"排在"用户：我在想，这盏灯值多少。"
     之前 —— 即卡片原文里角色先开口的那一轮没有被倒置；
  3. prompt 里没有把用户台词标成"你："的说话人标签，也没有 {{user}}/{{char}} 字面宏；
  4. few-shot 与人设段不打架：叙事者人称约定在位，且叙事人称("你"=玩家) 与
     示例段的说话人标签("用户："=玩家) 指向同一个人。

用法: python3 tests/visual/shot_imported_pronoun.py
截图存 tests/visual/shot_imported_pronoun_*.png；全过 exit 0。
"""
import asyncio, base64, json, os, sys, urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
REPO = "/home/hatch/workspace/github/novel-reader"
PORT = 9487
URL = os.environ.get("WWW_URL", "file://" + REPO + "/www/index.html")
SHOT_CHAT = os.path.join(DIR, "shot_imported_pronoun_chat.png")
SHOT_SYS = os.path.join(DIR, "shot_imported_pronoun_system.png")
SHOT_EX = os.path.join(DIR, "shot_imported_pronoun_examples.png")

# 一张贴近真实 ST 卡的导入卡。块 2 是关键: 角色抢话先开口(旧解析会把这一轮倒过来)。
MES_EXAMPLE = (
    "<START>\n{{user}}: 我听说你这当铺收旧物？\n{{char}}: 收。但我只收干净的东西。\n"
    "<START>\n{{char}}: 还在？\n{{user}}: 我在想，这盏灯值多少。\n{{char}}: 你想听的不是价钱。\n"
    "<START>\n{{user}}: 沈砚。\n{{char}}: ……这个名字，别再叫第二遍。"
)
RAW_CARD = {
    "name": "沈砚", "tags": ["夜行录"],
    "description": "沈砚是当铺的年轻掌柜，说话简短，嘴上刻薄心里柔软。",
    "personality": "冷淡、警觉",
    "first_mes": "门没栓。当东西，还是当别的？",
    "mes_example": MES_EXAMPLE,
    "system_prompt": "",
    "creator_notes": "",
}
NAME = "沈砚"
HIST = [
    {"role": "assistant", "content": RAW_CARD["first_mes"], "ts": 1},
    {"role": "user", "content": "我听说你这当铺收旧物？", "ts": 2},
    {"role": "assistant", "content": "收。但我只收干净的东西。", "ts": 3},
    {"role": "user", "content": "我在想，这盏灯值多少。", "ts": 4},
    {"role": "assistant", "content": "你想听的不是价钱。", "ts": 5},
]

# 用 App 真实的导入解析器把 ST 卡灌进 nd_imported_cards, 再塞两轮历史。
SEED = r"""
(function(){
  localStorage.setItem("nd_imported_cards", JSON.stringify([
    RP_CARDIMPORT.normalizeTavern(%(card)s)
  ]));
  localStorage.setItem("nd_chat_imported_" + %(name)s, JSON.stringify(%(hist)s));
  CHAT = {mode:"single", runId:"imported", name:%(name)s, members:[], forcedSpeaker:null};
  try{ localStorage.setItem("nd_onboarded","1"); onboardDone(); }catch(e){}
  return "ok";
})()
"""


class CDP:
    def __init__(self, ws):
        self.ws = ws; self.iid = 0
    async def send(self, method, params=None):
        self.iid += 1
        await self.ws.send(json.dumps({"id": self.iid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self.iid:
                if "error" in msg: raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})

    async def ev(self, js, await_promise=False):
        r = await self.send("Runtime.evaluate",
                             {"expression": js, "awaitPromise": await_promise, "returnByValue": True})
        res = r.get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError("page JS error: %s" % str(res.get("description", ""))[:400])
        return res.get("value")

    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(path, "wb").write(base64.b64decode(r["data"]))

# 把真实的 RP.chat 组装入口(RP_PROMPT.buildMessages)跑一遍, 把结果喂给 showSystem 预览页
BUILD_SYS = r"""
(function(){
  var card = RP.findCard("imported", %(name)s);
  if(!card) return {err:"findCard 没取到导入卡"};
  var hist = getHistSafe("nd_chat_imported_" + %(name)s);
  var b = RP_PROMPT.buildMessages(card, {
    novel: card.novel,
    worldbook: card.worldbook || [],
    history: hist.map(function(m){ return {role:m.role, content:m.content}; }),
    persona: "", personaName: "", pov: "player", person: "second"
  }, {maxContext: 8192, response: 512, preset: "narr"});
  LAST_SYSTEM = b.preview;
  window.__SYS__ = b.preview;
  return {text: b.preview, turns: (card.exampleBlocks||[]).map(function(x){
    return (x.turns||[]).map(function(t){ return t.who + ":" + t.text; });
  })};
})()
""" % {"name": json.dumps(NAME)}

fails = []
def check(name, cond, detail=""):
    if cond: print("  PASS  %s" % name)
    else:
        print("  FAIL  %s  %s" % (name, detail)); fails.append(name)


async def main():
    proc = await asyncio.create_subprocess_exec(
        "/opt/meta-chromium/chrome", "--headless=new",
        "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=/tmp/cl_profile_%d" % PORT,
        "--no-sandbox", "--disable-gpu", "about:blank",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    try:
        targets = None
        for _ in range(60):
            try:
                targets = json.loads(urllib.request.urlopen(
                    "http://127.0.0.1:%d/json" % PORT, timeout=5).read())
                break
            except Exception:
                await asyncio.sleep(0.5)
        if not targets:
            print("FAIL: 连不上 Chrome"); return 2
        page = [t for t in targets if t.get("type") == "page"][0]
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50*1024*1024) as ws:
            c = CDP(ws)
            await c.send("Page.enable")
            await c.send("Runtime.enable")
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width": 360, "height": 800, "deviceScaleFactor": 2, "mobile": True})
            await c.send("Page.navigate", {"url": URL})
            for _ in range(60):
                if await c.ev("document.readyState") == "complete":
                    break
                await asyncio.sleep(0.5)
            await asyncio.sleep(1.5)

            seed = SEED % {"card": json.dumps(RAW_CARD, ensure_ascii=False),
                           "name": json.dumps(NAME, ensure_ascii=False),
                           "hist": json.dumps(HIST, ensure_ascii=False)}
            if await c.ev(seed) != "ok":
                print("FAIL: seed 失败"); return 2

            print("\n[聊天页] 导入卡 runId=imported 开场 + 两轮")
            await c.ev("(async()=>{ await showChat(); return 1; })()", True)
            await asyncio.sleep(1.5)
            await c.ev("window.scrollTo(0,0); 1")
            await asyncio.sleep(0.4)
            chat_text = await c.ev("document.querySelector('#chatlog')?.innerText || ''")
            check("聊天页有开场白", "门没栓" in chat_text, chat_text[:200])
            check("聊天页有两轮用户发言",
                  "我听说你这当铺收旧物？" in chat_text and "我在想，这盏灯值多少。" in chat_text,
                  chat_text[:400])
            check("聊天页有角色回复", "收。但我只收干净的东西。" in chat_text and "你想听的不是价钱。" in chat_text,
                  chat_text[:400])
            await c.shot(SHOT_CHAT)

            print("\n[人设 prompt] RP_PROMPT.buildMessages(narr 预设) + showSystem 预览页")
            sysinfo = await c.ev(BUILD_SYS, True)
            if not sysinfo or sysinfo.get("err"):
                print("FAIL: buildMessages 失败", sysinfo); fails.append("buildMessages"); return 1
            sys_text = sysinfo["text"]
            print("  exampleBlocks 轮次:", json.dumps(sysinfo["turns"], ensure_ascii=False))

            still = sys_text.find("沈砚：还在？")
            think = sys_text.find("用户：我在想，这盏灯值多少。")
            price = sys_text.find("沈砚：你想听的不是价钱。")
            check("角色先开口那轮顺序没被倒置",
                  still >= 0 and still < think and think < price,
                  "still=%d think=%d price=%d" % (still, think, price))
            check("few-shot 无字面 {{user}}/{{char}} 宏",
                  "{{user}}" not in sys_text and "{{char}}" not in sys_text)
            check("没有把用户台词标成「你：」",
                  not any(l.strip().startswith("你：") or l.strip().startswith("你:")
                          for l in sys_text.splitlines()),
                  [l for l in sys_text.splitlines() if l.strip().startswith("你")][:3])
            check("用户一侧说话人标签是「用户：」", "用户：我在想，这盏灯值多少。" in sys_text)
            check("叙事者人称约定在位", "人称约定" in sys_text and "指玩家本人" in sys_text)
            check("叙事人称与示例不打架(同一段都指向玩家)",
                  "「用户：」是玩家说的话" in sys_text)

            await c.ev("showSystem(); 1")
            await asyncio.sleep(1.0)
            await c.shot(SHOT_SYS)
            # 滚到【对话示例】那一段再截一张: 说话人标签与轮次顺序才是本 bug 的证伪面
            await c.ev(
                "(function(){var pre=document.querySelector('#view pre');"
                "var t=pre?pre.innerText:'';var i=t.indexOf('【对话示例】');"
                "if(i<0) return 'no-example';"
                "window.scrollTo(0, pre.getBoundingClientRect().top + window.scrollY + i*7 - 40);"
                "return 'ok';})()")
            await asyncio.sleep(0.6)
            await c.shot(SHOT_EX)

            print("\n==== %s ====" % ("全部通过" if not fails else "失败: " + ", ".join(fails)))
            print("截图:", SHOT_CHAT, "|", SHOT_SYS)
    finally:
        proc.terminate()
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))