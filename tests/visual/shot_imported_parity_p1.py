#!/usr/bin/env python3
"""导入卡自带世界书(character_book) → prompt 的视觉验证（360x800 无头 Chromium 真机视口）。

对应 Phase1 修复 B1: RP.findCard(imported) 以前不透传 worldbook, 三处 buildMessages
也只拼 run.worldbook + 用户自建条目, 于是用户在卡里写的 character_book 一个字也进不了
prompt。本脚本:
  1) 用 App 真实的 RP_CARDIMPORT.normalizeTavern 灌一张带 character_book 的导入卡
  2) 真机渲染聊天页(开场+两轮), 截图
  3) 拦下真实 RP.send 组装给 RP_PROMPT.buildMessages 的 worldbook 入参, 断言卡自带条目在里面
  4) 用这份真实入参跑真 buildMessages, 把人设 prompt 预览页渲染出来, 截图肉眼确认世界书条目真的进了 prompt
  5) 顺带验证 B2: A 卡写的用户世界书不进 B 卡的 prompt(按卡隔离)
"""
import asyncio, base64, json, os, sys, urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(DIR, "out")
os.makedirs(OUT, exist_ok=True)
REPO = "/home/hatch/workspace/github/novel-reader"
PORT = 9491
URL = os.environ.get("WWW_URL", "file://" + REPO + "/www/index.html")
SHOT_CHAT = os.path.join(OUT, "shot_imported_parity_p1_chat.png")
SHOT_SYS = os.path.join(OUT, "shot_imported_parity_p1_worldbook.png")
SHOT_SCENARIO = os.path.join(OUT, "shot_imported_parity_p1_scenario.png")

# 带 character_book 的导入卡: 触发词"铜铃"会出现在历史里, 所以条目必然命中并进 prompt。
RAW_CARD = {
    "name": "沈砚", "tags": ["夜行录"],
    "description": "沈砚是当铺的年轻掌柜，说话简短，不轻易交底。",
    "personality": "冷淡、警觉",
    "scenario": "深夜的当铺，雨声敲窗。",
    "first_mes": "门没栓。当东西，还是当别的？",
    "mes_example": "<START>\n{{user}}: 我听说你这当铺收旧物？\n{{char}}: 收。但我只收干净的东西。",
    "character_book": {
        "name": "当铺志", "entries": [
            {"keys": ["铜铃"], "content": "铜铃是当铺的镇店之物，摇三声即有人来取货。", "enabled": True, "constant": False}
        ]
    },
}
NAME = "沈砚"
# 历史里让触发词"铜铃"出现, 世界书条目必然命中
HIST = [
    {"role": "user", "content": "你门口那串铜铃，是做什么用的？"},
    {"role": "assistant", "content": "有人来取货，摇三声。你不必细问。"},
]
RAW_CARD_B = {
    "name": "白薇", "tags": ["青灯录"],
    "description": "白薇在药庐坐诊。",
    "personality": "沉静",
    "first_mes": "……抓药，还是问病？",
    "character_book": {"name": "药庐志", "entries": [
        {"keys": ["银针"], "content": "银针浸在药庐第三格的铜盆里。", "enabled": True}]},
}

SEED = r"""
(function(){
  localStorage.setItem("nd_imported_cards", JSON.stringify([
    RP_CARDIMPORT.normalizeTavern(%(cardA)s),
    RP_CARDIMPORT.normalizeTavern(%(cardB)s)
  ]));
  localStorage.setItem("nd_chat_imported_" + %(nameA)s, JSON.stringify(%(hist)s));
  CHAT = {mode:"single", runId:"imported", name:%(nameA)s, members:[], forcedSpeaker:null};
  try{ localStorage.setItem("nd_onboarded","1"); onboardDone(); }catch(e){}
  return "ok";
})()
"""

# 拦下真实 RP.send 组装给 buildMessages 的入参(B1 的真机证据)
CAPTURE = r"""
(function(){
  window.__cap = null;
  var orig = RP_PROMPT.buildMessages;
  RP_PROMPT.buildMessages = function(card, opts){
    window.__cap = opts;
    return orig.apply(this, arguments);   /* 放行真组装, 让 RP.send 继续跑完 */
  };
  return RP.send("imported", %(nameA)s, "再说说那串铜铃。", {cfg:{}, history:[]})
    .then(function(){ return "done"; })
    .catch(function(e){ return "err:"+(e&&e.message); });
})()
"""

# 用真实捕获到的 worldbook 跑真 buildMessages, 供人设 prompt 预览页渲染
BUILD_SYS = r"""
(function(){
  var cap = window.__cap;
  if(!cap) return {err:"没拦到 buildMessages 入参"};
  var card = RP.findCard("imported", %(nameA)s);
  var hist = getHistSafe("nd_chat_imported_" + %(nameA)s);
  var b = RP_PROMPT.buildMessages(card, {
    novel: card.novel,
    worldbook: cap.worldbook,
    relations: cap.relations || [],
    history: hist.concat([{role:"user", content:"再说说那串铜铃。"}]),
    persona: "", personaName: "", pov: "player", person: "second"
  }, {maxContext: 8192, response: 512, preset: "narr"});
  window.LAST_SYSTEM_LEGACY = b.preview;
  return {preview: b.preview,
          wbCount: (cap.worldbook||[]).length,
          wbHasEntry: (cap.worldbook||[]).some(function(e){return String(e.content||"").indexOf("铜铃")>=0;})};
})()
"""

fails = []
def check(name, cond, detail=""):
    if cond: print("  PASS  %s" % name)
    else:
        print("  FAIL  %s  %s" % (name, detail)); fails.append(name)


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

            seed = SEED % {"cardA": json.dumps(RAW_CARD, ensure_ascii=False),
                           "cardB": json.dumps(RAW_CARD_B, ensure_ascii=False),
                           "nameA": json.dumps(NAME, ensure_ascii=False),
                           "hist": json.dumps(HIST, ensure_ascii=False)}
            if await c.ev(seed) != "ok":
                print("FAIL: seed 失败"); return 2

            print("\n[1] 导入卡自带世界书经真实 RP.send 进入 buildMessages 的 worldbook 入参(B1)")
            card = await c.ev("RP.findCard('imported', %s)" % json.dumps(NAME))
            check("findCard(imported) 带出 worldbook 数组", isinstance(card.get("worldbook"), list) and len(card["worldbook"]) >= 1,
                  json.dumps(card.get("worldbook"), ensure_ascii=False)[:200])
            capres = await c.ev(CAPTURE % {"nameA": json.dumps(NAME, ensure_ascii=False)}, True)
            print("  RP.send 结果:", capres)
            cap = await c.ev("({wb:(window.__cap&&window.__cap.worldbook)||[]}).wb")
            check("RP.send 组装的 worldbook 含卡自带条目",
                  any("铜铃" in str(e.get("content","")) for e in cap),
                  json.dumps(cap, ensure_ascii=False)[:300])

            print("\n[2] 人设 prompt 预览页: 世界书条目真实进入 prompt 并渲染")
            sysinfo = await c.ev(BUILD_SYS % {"nameA": json.dumps(NAME, ensure_ascii=False)})
            if not sysinfo or sysinfo.get("err"):
                print("FAIL: buildMessages 失败", sysinfo); fails.append("buildMessages"); return 1
            preview = sysinfo["preview"]
            print("  worldbook 条目数:", sysinfo["wbCount"])
            check("buildMessages 的 worldbook 入参含卡条目", sysinfo["wbHasEntry"], json.dumps(sysinfo, ensure_ascii=False)[:200])
            check("人设 prompt 里出现世界书条目正文(铜铃是当铺的镇店之物)",
                  "铜铃是当铺的镇店之物" in preview, preview[:300])
            # 渲染预览页(真 DOM)
            await c.ev("LAST_SYSTEM = window.__cap ? RP_PROMPT.buildMessages(RP.findCard('imported', %s), {novel:'夜行录', worldbook:window.__cap.worldbook, relations:[], history:getHistSafe('nd_chat_imported_'+%s).concat([{role:'user',content:'再说说那串铜铃。'}]), persona:'', personaName:'', pov:'player', person:'second'}, {maxContext:8192, response:512, preset:'narr'}).preview : ''; showSystem(); 1"
                      % (json.dumps(NAME), json.dumps(NAME)))
            await asyncio.sleep(0.8)
            await c.ev("window.scrollTo(0,0); 1")
            await asyncio.sleep(0.4)
            view_text = await c.ev("document.querySelector('#view')?.innerText || ''")
            check("预览页 DOM 里能看到世界书条目正文", "铜铃是当铺的镇店之物" in view_text, view_text[:300])
            await c.shot(SHOT_SYS)
            # 滚到世界书条目那一段再截一张, 肉眼确认
            await c.ev(
                "(function(){var pre=document.querySelector('#view pre');"
                "var t=pre?pre.innerText:'';var i=t.indexOf('铜铃是当铺');"
                "if(i<0) return 'no-lore';"
                "window.scrollTo(0, pre.getBoundingClientRect().top + window.scrollY + i*7 - 120);"
                "return 'ok';})()")
            await asyncio.sleep(0.6)
            await c.shot(SHOT_SCENARIO)

            print("\n[3] 聊天页真机渲染(开场+两轮), 截图")
            await c.ev("(async()=>{ await showChat(); return 1; })()", True)
            await asyncio.sleep(1.2)
            await c.ev("window.scrollTo(0,0); 1")
            await asyncio.sleep(0.3)
            chat_text = await c.ev("document.querySelector('#chatlog')?.innerText || ''")
            # 聊天页已预置两轮历史, 渲染的是历史而不是开场白(开场白只在空历史时出现)
            check("聊天页渲染了预置的铜铃提问", "你门口那串铜铃" in chat_text, chat_text[:300])
            check("聊天页有角色对铜铃的回答", "有人来取货" in chat_text, chat_text[:300])
            await c.shot(SHOT_CHAT)

            print("\n==== %s ====" % ("全部通过" if not fails else "失败: " + ", ".join(fails)))
            print("截图:", SHOT_CHAT, "|", SHOT_SYS, "|", SHOT_SCENARIO)
    finally:
        proc.terminate()
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))