#!/usr/bin/env python3
"""导入卡平等待遇 Phase4 视觉验证（360x800 无头 Chromium 真机视口）。

Phase4 是结构性的三项，这一轮验的是"原来根本进不去 / 根本不存在的界面，
现在能进、进去之后显示的是卡上真有的东西"。所以断言全部是"该出现的出现了"
+"不该出现的（编造数据）没出现"。

覆盖：
  B7  卡片档案聚合页 —— 入口在落地页；卡自带的世界书/多开场/卡面字段都渲染；
      裸卡缺失的部分是 honest 空态（说明是什么、为什么没有、怎么补）；
      铁律断言：导入卡聚合页里绝不出现蒸馏 run 的关系/世界书/人物档案。
  B8  与其它导入卡组队 —— 聊天选择器有入口；选人页列的是 allChars() 的导入卡；
      startGroupChat 起出的群 runId 是 "imported" 而非借 RUN.run_id；
      群聊抽屉的关系编辑器没有可继承的静态关系，给诚实说明。
  B17 弧光可录入 —— 卡片编辑器渲染出 arc_type/arc_start/arc_mid/arc_end/
      timeline_stage 五个输入框；填完保存再读，五个值一个都不丢，
      并且真的进了 RP_ARC 的读数链路（详情页弧光区不再是空态）。

截图落在 /tmp/phase4_shots/。
"""
import asyncio, base64, json, os, sys, urllib.request
import websockets

OUT = "/tmp/phase4_shots"
os.makedirs(OUT, exist_ok=True)
REPO = "/home/hatch/workspace/github/novel-reader"
PORT = 9494
URL = "file://" + REPO + "/www/index.html"

# 丰富卡: 带 character_book / 多开场 / 卡面字段 —— 聚合页应该把它们都渲染出来
RAW_RICH = {
    "name": "沈砚", "tags": ["夜行录"],
    "description": "沈砚是当铺的年轻掌柜，说话简短，不轻易交底。",
    "personality": "冷淡、警觉",
    "scenario": "深夜的当铺，雨声敲窗。",
    "system_prompt": "扮演沈砚，语气克制，惜字如金。",
    "creator_notes": "作者是个夜猫子。",
    "first_mes": "门没栓。当东西，还是当别的？",
    "alternate_greetings": ["……沈砚搁下笔，没抬头。"],
    "mes_example": "<START>\n{{user}}: 我听说你这当铺收旧物？\n{{char}}: 收。但我只收干净的东西。",
    "extensions": {"example_dialogue": "你来了？<START>嗯。落雨了。"},
    "character_book": {"name": "当铺志", "entries": [
        {"keys": ["铜铃"], "content": "铜铃是当铺的镇店之物，摇三声即有人来取货。",
         "enabled": True, "constant": False}]},
}
# 裸卡: 什么都没有 —— 聚合页在它身上必须全是 honest 空态
RAW_BARE = {
    "name": "白薇", "tags": ["青灯录"],
    "description": "白薇在药庐坐诊。",
    "personality": "沉静",
    "first_mes": "……抓药，还是问病？",
}

SEED = r"""
(function(){
  var a = RP_CARDIMPORT.normalizeTavern(%(rich)s);
  var b = RP_CARDIMPORT.normalizeTavern(%(bare)s);
  localStorage.setItem("nd_imported_cards", JSON.stringify([a, b]));
  try{ localStorage.setItem("nd_onboarded","1"); onboardDone(); }catch(e){}
  return "ok";
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
    async def shot(self, name):
        p = os.path.join(OUT, name)
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(p, "wb").write(base64.b64decode(r["data"]))
        print("  shot  %s" % p)

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

            seed = SEED % {"rich": json.dumps(RAW_RICH, ensure_ascii=False),
                           "bare": json.dumps(RAW_BARE, ensure_ascii=False)}
            if await c.ev(seed) != "ok":
                print("FAIL: seed 失败"); return 2

            # ================= B7 卡片档案聚合页 =================
            print("\n[B7] 卡片档案聚合页")
            entry = await c.ev(
                "cardDetailBtn = (typeof cardDetailBtn!=='undefined');"
                "(function(){ charDetail('imported','沈砚'); return "
                "document.getElementById('view').innerHTML.indexOf('openCardArchive')>=0; })()")
            check("落地页有「卡片档案」入口", entry is True)
            await asyncio.sleep(0.5)
            await c.shot("p4_b7_landing_entry.png")

            rich = await c.ev("openCardArchive('imported','沈砚'); window.scrollTo(0,0);"
                              "document.getElementById('view').innerText")
            check("聚合页渲染卡自带世界书条目", "铜铃是当铺的镇店之物" in rich, rich[:200])
            check("聚合页渲染开场白", "门没栓" in rich and "搁下笔" in rich)
            check("聚合页渲染场景设定", "雨声敲窗" in rich)
            check("聚合页渲染系统提示词", "惜字如金" in rich)
            check("聚合页渲染示例对话", "落雨了" in rich)
            check("聚合页列出蒸馏产物缺席清单", "蒸馏产物 · 导入卡天然没有" in rich, rich[:200])
            # 铁律: 蒸馏 run 的数据一个字都不许漏进来
            for label, needle in [("静态关系摘要", "两小无猜"), ("蒸馏世界书", "大观园的规矩"),
                                  ("蒸馏人物档案", "两弯似蹙非蹙罥烟眉"), ("红楼人物名", "林黛玉")]:
                check("聚合页不含" + label, needle not in rich)
            await asyncio.sleep(0.5)
            await c.shot("p4_b7_archive_rich_top.png")
            await c.ev("window.scrollTo(0, document.body.scrollHeight); 1")
            await asyncio.sleep(0.5)
            await c.shot("p4_b7_archive_rich_bottom.png")

            await c.ev("openCardArchive('imported','白薇'); window.scrollTo(0,0); 1")
            await asyncio.sleep(0.5)
            bare = await c.ev("document.getElementById('view').innerText")
            check("裸卡：世界书给 honest 空态", "这张卡没有自带世界书" in bare, bare[:200])
            check("裸卡：示例对话给 honest 空态", "没有示例对话" in bare)
            check("裸卡：自建世界书给 honest 空态", "还没写条目" in bare)
            check("裸卡：AI 补完给 honest 空态", "没有任何 AI 补完字段" in bare)
            check("裸卡：缺席清单仍在", "蒸馏产物 · 导入卡天然没有" in bare)
            await c.shot("p4_b7_archive_bare_empty.png")

            # ================= B8 与其它导入卡组队 =================
            print("\n[B8] 与其它导入卡组队")
            await c.ev("showChatPicker(); window.scrollTo(0,0); 1")
            await asyncio.sleep(0.8)
            sel = await c.ev("document.getElementById('view').innerText")
            check("聊天选择器有组队入口", "与其它导入卡组队" in sel, sel[:200])
            await c.shot("p4_b8_chatpicker_entry.png")

            await c.ev("importedGroupPicker(); window.scrollTo(0,0); 1")
            await asyncio.sleep(0.6)
            pick = await c.ev("document.getElementById('view').innerText")
            check("选人页列出两张导入卡", "沈砚" in pick and "白薇" in pick, pick[:200])
            check("选人页不列蒸馏 run 人物", "林黛玉" not in pick)
            check("选人页说明没有共用静态关系", "没有共用的静态人物关系" in pick, pick[:200])
            await c.shot("p4_b8_group_picker.png")

            # 勾两张 -> 起群聊（startGroupChat 自己会 setNav("chat") -> showGroupChat）
            started = await c.ev(
                "(function(){ var bs=document.querySelectorAll('#gpick input');"
                " bs.forEach(function(b){ b.checked=true; });"
                " startGroupChat();"
                " return JSON.stringify({runId:CHAT.runId, mode:CHAT.mode, members:CHAT.members}); })()")
            st = json.loads(started)
            check("群聊 runId 是 imported", st.get("runId") == "imported", started)
            check("群聊成员来自导入卡", len(st.get("members") or []) == 2
                  and "沈砚" in st["members"] and "白薇" in st["members"], started)
            await asyncio.sleep(1.2)
            await c.shot("p4_b8_groupchat.png")

            # 群聊抽屉里的关系编辑器
            rel = await c.ev("toggleDrawer(true); 1")
            await asyncio.sleep(0.6)
            dt = await c.ev("document.getElementById('drawer').innerText")
            check("群聊抽屉有角色关系编辑器", "角色关系" in dt, dt[:200])
            check("关系编辑器给诚实说明（不假装有静态关系）",
                  "导入卡之间没有共用的静态人物关系" in dt, dt[:300])
            relHtml = await c.ev("document.getElementById('drawer').innerHTML")
            check("关系编辑器仍可手写关系",
                  'id="grel_r"' in relHtml and 'id="grel_a"' in relHtml)
            await c.ev("(function(){var d=document.getElementById('drawer');"
                       "var b=[...d.querySelectorAll('button.ditem')].find(x=>x.innerText.indexOf('群聊设置')>=0);"
                       "if(b) d.scrollTop=b.offsetTop-140; return 1;})()")
            await asyncio.sleep(0.5)
            await c.shot("p4_b8_groupchat_relbox.png")
            await c.ev("toggleDrawer(false); 1")

            # ================= B17 弧光可录入 =================
            print("\n[B17] 弧光可录入")
            cid = await c.ev("RP_CARDIMPORT.list()[0].id")
            await c.ev("editCard('imported', %s); window.scrollTo(0,0); 1" % json.dumps(cid))
            await asyncio.sleep(0.8)
            form = await c.ev("document.getElementById('view').innerHTML")
            labels = await c.ev("document.getElementById('view').innerText")
            for k in ["arc_type", "arc_start", "arc_mid", "arc_end", "timeline_stage"]:
                check("编辑器渲染了 %s 输入框" % k, ('id="cef_%s"' % k) in form)
            check("编辑器显示弧光中文标签", "弧光类型" in labels and "弧光·起" in labels, labels[:200])
            await c.ev("(function(){var f=document.getElementById('cef_arc_type');"
                       "if(f) f.scrollIntoView({block:'center'}); return 1;})()")
            await asyncio.sleep(0.5)
            await c.shot("p4_b17_editor_arc_fields.png")

            # 填 -> 存 -> 重读
            ARC = {"arc_type": "rise", "arc_start": "被迫寄人篱下",
                   "arc_mid": "渐生情愫；被人拿捏", "arc_end": "自毁以求全",
                   "timeline_stage": "流放途中"}
            saved = await c.ev(
                "(function(){ var V=%s; var id=%s;"
                " Object.keys(V).forEach(function(k){"
                "   var el=document.getElementById('cef_'+k); if(el) el.value=V[k]; });"
                # saveCardEdit 结尾是 alert('已保存') + showTraverse()。原生弹窗在 CDP 下
                # 会挂起整个 Runtime.evaluate（前面几轮就是卡死在这儿），两个都先桩掉。
                " var oa=window.alert, os_=window.showTraverse;"
                " window.alert=function(){}; window.showTraverse=function(){};"
                " saveCardEdit('imported', id);"
                " window.alert=oa; window.showTraverse=os_;"
                " return JSON.stringify(RP_CARDIMPORT.findById(id).fields); })()"
                % (json.dumps(ARC, ensure_ascii=False), json.dumps(cid)))
            fields = json.loads(saved)
            for k, v in ARC.items():
                check("保存往返不丢 " + k, fields.get(k) == v, "%s=%r" % (k, fields.get(k)))

            summ = await c.ev("JSON.stringify(RP_ARC.arcSummary(RP_CARDIMPORT.findById(%s),'imported'))"
                              % json.dumps(cid))
            s = json.loads(summ)
            check("RP_ARC 读得到类型标签", s.get("typeLabel") == "上升", summ)
            check("RP_ARC 拆出 2 个转折点", len(s.get("mids") or []) == 2, summ)
            arc_prompt = await c.ev("RP_ARC.renderArcPrompt(RP_CARDIMPORT.findById(%s),'imported')"
                                    % json.dumps(cid))
            check("录入后弧光进 prompt", "上升" in arc_prompt and "起：" in arc_prompt, arc_prompt[:120])

            # 详情页弧光区不再是空态
            await c.ev("charDetail('imported','沈砚'); charTab('arc'); window.scrollTo(0,0); 1")
            await asyncio.sleep(0.8)
            arcHtml = await c.ev("document.getElementById('view').innerText")
            check("详情页弧光区显示录入内容", "上升" in arcHtml and "被迫寄人篱下" in arcHtml, arcHtml[:200])
            check("详情页弧光区不再是空态", "暂无人物弧光资料" not in arcHtml)
            await c.shot("p4_b17_detail_arc_filled.png")

            # 回归: 没录入的卡仍然是 honest 空态，不给假弧光
            await c.ev("charDetail('imported','白薇'); charTab('arc'); window.scrollTo(0,0); 1")
            await asyncio.sleep(0.8)
            bare_arc = await c.ev("document.getElementById('view').innerText")
            check("未录入的卡仍是空态", "暂无人物弧光资料" in bare_arc, bare_arc[:200])
            check("空态不编造弧光内容", "上升" not in bare_arc and "起：" not in bare_arc)
            await c.shot("p4_b17_detail_arc_empty.png")

            print("\n==== %s ====" % ("全部通过" if not fails else "失败: " + ", ".join(fails)))
    finally:
        proc.terminate()
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))