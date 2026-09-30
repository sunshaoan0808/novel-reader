"use strict";
/* P0-3 注入链路回归: arc -> prompt.js -> 段 */
global.localStorage = { _s:{}, getItem(k){ return this._s[k]||null;}, setItem(k,v){ this._s[k]=String(v);}, removeItem(k){ delete this._s[k];}};
const fs = require("fs");
const assert = require("assert");
function load(p){ return fs.readFileSync("./" + p, "utf8");}
var src = load("www/data.js");
var D = JSON.parse(src.match(/window\.__DATA__=(\{.*\});?\s*$/s)[1]);
var cards = D.rp_cards.honglou_full;
assert.strictEqual(cards.length, 10, "10 cards");
var daiyu = cards.filter(c => c.name === "林黛玉")[0];
eval(load("www/rp/arc.js") + "\n;globalThis.RP_ARC = RP_ARC;");
eval(load("www/rp/prompt.js") + "\n;globalThis.RP_PROMPT = RP_PROMPT;");

var arcText = RP_ARC.renderArcPrompt(daiyu, "honglou_full");
assert.ok(arcText.length > 0 && arcText.length <= 300, "arcText 300字内, len=" + arcText.length);
assert.ok(arcText.indexOf("大观园诗社时期") >= 0, "含 timeline_stage");

// 注入链路
var b = RP_PROMPT.buildMessages(daiyu, { novel: "红楼梦", arc: arcText, history: []}, { maxContext: 8192});
assert.ok(b.preview.indexOf("人物弧光") >= 0, "preview 含弧光段");
assert.ok(b.stats.droppedSegs.indexOf("arc") < 0, "arc 段未被丢弃: " + JSON.stringify(b.stats.droppedSegs));

// 无弧光卡: 不注入、不报错
var b2 = RP_PROMPT.buildMessages({name: "路人", fields: {}}, { novel: "红楼梦", arc: "", history: []}, {});
assert.ok(b2.preview.indexOf("人物弧光") < 0, "无弧光卡不注入");

// 四个 preset 都有 arc 顺序位
["classic","lite","immers","narr"].forEach(function(p){
assert.ok(RP_PROMPT.PRESETS[p].order.arc!= null, "preset " + p + " 有 arc 位");
});

// 阶段覆盖优先生效
localStorage.setItem("nd_arcstage_honglou_full_林黛玉", "黛玉入府时期");
var arcText2 = RP_ARC.renderArcPrompt(daiyu, "honglou_full");
assert.ok(arcText2.indexOf("黛玉入府时期") >= 0, "覆盖阶段优先生效");
localStorage.removeItem("nd_arcstage_honglou_full_林黛玉");

console.log("arc wiring: 7 pass, 0 fail");
