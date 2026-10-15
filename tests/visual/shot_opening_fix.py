#!/usr/bin/env python3
"""开场列表 [object Object] 修复的视觉验证。

背景: cardOpenings() 返回 [{text,label}] 对象，cardLandingHTML 曾把元素当字符串用
      g.length / g.slice / esc(prev)，落地页"开场"列表整片渲染成 [object Object]。

断言（无头 Chromium 360x800 dsf2，file:// 打开 www/index.html 的卡片落地页）:
  1. 落地页真的渲染出了开场列表，且条数与 cardOpenings() 一致；
  2. 每条 .opn-text 是真实开场文本（含 greeting / altGreetings 原文）；
  3. 列表内无 "[object Object]"；
  4. 列表顺序与 cardOpenings() 下标逐条对齐（点击下标由同一 map 的 i 生成，
     错位会把别的开场送进 chatWithOpening 的首条消息）；
  5. 点击带的下标 0..n-1 连续。

截图存 /tmp/shot_opening_fix.png，全过 exit 0。

依赖: websockets（与 tests/visual 下其余脚本一致）。
用法: python3 tests/visual/shot_opening_fix.py
"""
import asyncio, json, os, sys, urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9473
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
SHOT = "/tmp/shot_opening_fix.png"

GREETING = "你来了，我等你好久了。"
ALT1 = "好久不见，最近还好吗？"
ALT2 = "今晚月色真美，要一起去天台看看吗？"

SEED = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
var card = {id:"imp_cl", name:"白月光", novel:"导入角色卡",
  fields:{core_identity:"温柔体贴的学姐，笑起来眼睛弯成月牙", core_traits:"温柔，偶尔腹黑",
    role_tags:"校园；纯爱；学姐", speech_style:"轻声细语"},
  greeting:"你来了，我等你好久了。",
  altGreetings:["好久不见，最近还好吗？","今晚月色真美，要一起去天台看看吗？"],
  exampleDialogue:"", scenario:"", systemPrompt:"", postHistoryInstructions:"",
  creatorNotes:"", tags:["校园","纯爱"], worldbook:[], raw:{tags:["校园","纯爱"]}, createdAt:Date.now()};
localStorage.setItem("nd_imported_cards", JSON.stringify([card]));
localStorage.setItem("nd_playstats_v1", JSON.stringify(
  {"imported|白月光":{s:7,t:85,pi:128400,po:96200,fav:1,like:0,first:1,last:2}}));
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
"ok";
"""

# 读落地页开场列表 + 同源真值(cardOpenings())，一次性带回
PROBE = r"""(function(){
  var root = document.getElementById('view');
  var texts = Array.prototype.map.call(
    root.querySelectorAll('.opn-text'), function(e){ return e.textContent.trim(); });
  /* 同一次渲染里 cardOpenings() 的真值，用来逐条对齐下标 */
  var ops = [];
  try{ ops = cardOpenings('imported', '白月光') || []; }catch(e){}
  var idxs = Array.prototype.map.call(
    root.querySelectorAll('[onclick*="chatWithOpening"]'), function(e){
      var m = /chatWithOpening\([^)]*,(\d+)\)/.exec(e.getAttribute('onclick') || '');
      return m ? parseInt(m[1], 10) : null;
    });
  var heading = null;
  Array.prototype.forEach.call(root.querySelectorAll('.sec'), function(h){
    if (/^开场\s*·/.test(h.textContent.trim())) heading = h.textContent.trim();
  });
  /* 把开场列表滚进视口，让截图看得到 */
  var first = root.querySelector('.opn-text');
  if(first) first.scrollIntoView({block:'center'});
  return JSON.stringify({
    texts: texts,
    opsText: ops.map(function(o){ return String((o && o.text) || ''); }),
    idxs: idxs,
    heading: heading,
    pageHasObject: document.body.textContent.indexOf('[object Object]') >= 0,
    opnTextCount: texts.length
  });
})()"""

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
        async with websockets.connect(page["webSocketDebuggerUrl"],
                                      max_size=50*1024*1024) as ws:
            c = CDP(ws)
            await c.send("Page.enable")
            await c.send("Runtime.enable")
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width":360,"height":800,"deviceScaleFactor":2,"mobile":True})
            await c.send("Page.navigate", {"url": URL})
            for _ in range(60):
                if await c.ev("document.readyState") == "complete":
                    break
                await asyncio.sleep(0.5)
            await asyncio.sleep(1.5)
            if await c.ev(SEED) != "ok":
                print("FAIL: seed 失败"); return 2

            print("\n[开场列表] 卡片落地页 charDetail('imported','白月光')")
            await c.ev("charDetail('imported','白月光'); 'ok'")
            await asyncio.sleep(1.5)
            await c.ev("window.scrollTo(0,0); 'ok'")
            await asyncio.sleep(0.4)

            r = json.loads(await c.ev(PROBE))
            await asyncio.sleep(0.6)
            await c.shot(SHOT)

            print("  probe:", json.dumps(r, ensure_ascii=False))
            check("落地页渲染出了开场列表", r["opnTextCount"] > 0, "count=%d" % r["opnTextCount"])
            check("开场列表标题有数量", bool(r["heading"]), str(r["heading"]))
            check("列表内无 [object Object]",
                  all("[object Object]" not in t for t in r["texts"]) and not r["pageHasObject"],
                  "texts=%s pageHasObject=%s" % (r["texts"], r["pageHasObject"]))
            check("含 greeting 真实文本", GREETING in r["texts"], str(r["texts"]))
            check("含 altGreetings 真实文本",
                  ALT1 in r["texts"] and ALT2 in r["texts"], str(r["texts"]))
            check("渲染顺序与 cardOpenings 下标对齐",
                  len(r["texts"]) == len(r["opsText"]) and len(r["texts"]) > 0
                  and all(r["texts"][i] == (r["opsText"][i][:72] + "…" if len(r["opsText"][i]) > 72
                                            else r["opsText"][i])
                          for i in range(len(r["texts"]))),
                  "texts=%s opsText=%s" % (r["texts"], r["opsText"]))
            check("点击下标连续 0..n-1",
                  r["idxs"] == list(range(len(r["texts"]))), str(r["idxs"]))

            print("\n==== %s ====" % ("全部通过" if not fails else "失败: " + ", ".join(fails)))
            print("截图:", SHOT)
    finally:
        proc.terminate()
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
