const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// UI-00 回归: getHist 在 RP_STORE 缓存未命中时必须回退 localStorage，
// 否则冷启动后小键历史读成空，showChat 的打招呼分支会覆盖真实历史（数据丢失）。
const src = fs.readFileSync(WWW + "/app.js", "utf8");
function extract(src, name){
  const pats = [
    "(?:let|const|var)\\s+" + name + "\\s*=\\s*\\([^)]*\\)\\s*=>",
  ];
  for(const p of pats){
    const m = src.match(new RegExp(p));
    if(!m) continue;
    let j = src.indexOf("{", m.index), depth = 0;
    for(let k = j; k < src.length; k++){
      if(src[k] === "{") depth++;
      else if(src[k] === "}"){ depth--; if(!depth) return src.slice(m.index, k + 1); }
    }
  }
  throw new Error("not found: " + name);
}
const store = {};
const localStorage = {
  getItem: (k)=> (k in store ? store[k] : null),
  setItem: (k, v)=>{ store[k] = String(v); },
  removeItem: (k)=>{ delete store[k]; },
};
const MEM = {};
const RP_STORE = {
  cacheGet: (k)=> (k in MEM ? MEM[k] : null),
  cacheSet: (k, v)=>{ MEM[k] = String(v); },
  syncBig: ()=>{},
};
const ctx = { console, localStorage, RP_STORE };
vm.createContext(ctx);
vm.runInContext(extract(src, "getHist"), ctx);
vm.runInContext(extract(src, "saveHist"), ctx);
const E = (code)=>vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const T = (name, cond)=>{ if(cond){ pass++; } else { fail++; console.log("FAIL:", name); } };

// 场景1: localStorage 有 6 条历史（直接写入，不走缓存，模拟冷启动/旧数据），缓存未命中
const K = "nd_chat_r1_林黛玉";
const six = [1,2,3,4,5,6].map(i=>({mid:"m"+i, role:i%2?"user":"assistant", content:"c"+i, ts:i}));
localStorage.setItem(K, JSON.stringify(six));
T("缓存未命中时回退 localStorage（6 条）", E(`getHist(${JSON.stringify(K)}).length`) === 6);
T("回退读到正确内容", E(`getHist(${JSON.stringify(K)})[0].content`) === "c1");

// 场景2: 缓存命中时优先用缓存
MEM[K] = JSON.stringify([{mid:"mx", role:"user", content:"cached", ts:9}]);
T("缓存命中时用缓存", E(`getHist(${JSON.stringify(K)})[0].content`) === "cached");
delete MEM[K];

// 场景3: 两边都空 → 空数组（打招呼分支可正常触发）
localStorage.removeItem(K);
T("两边都空返回 []", Array.isArray(E(`getHist(${JSON.stringify(K)})`)) && E(`getHist(${JSON.stringify(K)}).length`) === 0);

// 场景4: RP_STORE 不存在（极端）→ 直接读 localStorage
localStorage.setItem(K, JSON.stringify(six));
const ctx2 = { console, localStorage };
vm.createContext(ctx2);
vm.runInContext(extract(src, "getHist"), ctx2);
const E2 = (code)=>vm.runInContext(code, ctx2);
T("无 RP_STORE 时读 localStorage", E2(`getHist(${JSON.stringify(K)}).length`) === 6);

// 场景5: saveHist 写入后，即使缓存被清空（模拟重启），仍能读回
E(`saveHist(${JSON.stringify(K)}, ${JSON.stringify(six)})`);
for(const k of Object.keys(MEM)) delete MEM[k];
T("saveHist 后清缓存仍可读回", E(`getHist(${JSON.stringify(K)}).length`) === 6);

console.log(`gethist_fallback: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
