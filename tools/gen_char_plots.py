#!/usr/bin/env python3
"""从 novel-distill 红楼梦 plot 产物生成 App 用的角色原著剧情大纲.

输入: runs/honglou_full/plot/sections.json (+ outline.json 的 book_summary)
输出: www/data/char_plots.js
      (window.CHAR_PLOTS = {runId: {人物名: 大纲文本, ...}, ...})
按 runId 分层是必须的: 不同书里有同名角色时, App 只按名字取会串味泄露别的书的剧情。
arcs.json 落地后重新跑本脚本即可刷新.
"""
import json, os, sys

RUN_ID = "honglou_full"
RUN = os.path.expanduser("~/workspace/novel-distill/runs/%s/plot" % RUN_ID)
OUT = os.path.expanduser("~/workspace/github/novel-reader/www/data/char_plots.js")

CHARS = ["贾宝玉","林黛玉","薛宝钗","王熙凤","贾母","王夫人","袭人","晴雯","刘姥姥","秦钟"]
# 摘要里常用简称, 补全匹配(全名优先, 简称只补漏)
ALIASES = {"贾宝玉":["宝玉"], "林黛玉":["黛玉"], "薛宝钗":["宝钗"],
           "王熙凤":["凤姐"], "刘姥姥":["姥姥"]}

def main():
    secs = json.load(open(os.path.join(RUN, "sections.json")))
    plots = {}
    for name in CHARS:
        keys = [name] + ALIASES.get(name, [])
        hits = [s for s in secs if any(k in s["title"] or k in s["summary"] for k in keys)]
        lines = []
        for s in hits:
            ev = "；".join(s.get("key_events") or [])
            if not ev:
                ev = s["summary"][:80]
            lines.append(f"· {s['title']}：{ev}")
        body = "\n".join(lines) if lines else "（暂无该角色的原著剧情记录）"
        if len(body) > 1400:  # prompt 注入预算: 截断并标注, 编辑器仍可见全文? 否: 统一截断, 等 arcs.json 后换单人物弧光
            body = body[:1400] + "\n……（后略，全文见蒸馏产物）"
        plots[name] = (
            f"【{name} · 原著剧情脉络】\n"
            f"以下为《红楼梦》原著中与{name}相关的剧情脉络，由蒸馏管线从全书抽取，读者可自行编辑。\n"
            + body
        )
    # JS 文件: file:// 下无 fetch 风险, script 标签直接引入
    js = "// 自动生成: tools/gen_char_plots.py, 数据源 runs/%s/plot/sections.json\n" % RUN_ID
    js += "window.CHAR_PLOTS = " + json.dumps({RUN_ID: plots}, ensure_ascii=False, indent=1) + ";\n"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w").write(js)
    for name in CHARS:
        print(f"{name}: {len(plots[name])}字")
    print("total bytes:", os.path.getsize(OUT))
    print("wrote", OUT)

if __name__ == "__main__":
    main()
