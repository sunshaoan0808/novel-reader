/* 借鉴清单 Tier2 #18: 模型能力标签 (对标 Janitor 模型目录过滤器 "Reasoning"/"Vision"/"Web search"/"128k+ context")。
 * 模型配置页给模型打能力标签（推理/视觉/长上下文），用户自配模型时不再盲选。
 * 存储: nd_model_tags_v1 {小写模型id: [标签]}; 手动维护常见模型对照表 TABLE + 用户自定义覆盖。 */
var RP_MODELTAGS = (function(){
"use strict";
var KEY = "nd_model_tags_v1";
var TAGS = ["推理", "视觉", "长上下文"];
/* 手动维护的常见模型标签表（键小写；get 时先精确匹配，再前缀回退） */
var TABLE = {
"gpt-4o": ["推理", "视觉", "长上下文"],
"gpt-4o-mini": ["视觉", "长上下文"],
"gpt-4.1": ["推理", "长上下文"],
"gpt-4.1-mini": ["长上下文"],
"gpt-4.1-nano": ["长上下文"],
"o1": ["推理", "长上下文"],
"o1-mini": ["推理"],
"o3": ["推理", "长上下文"],
"o3-mini": ["推理"],
"o4-mini": ["推理", "视觉", "长上下文"],
"claude-3-5-sonnet": ["推理", "视觉", "长上下文"],
"claude-3-7-sonnet": ["推理", "视觉", "长上下文"],
"claude-opus-4": ["推理", "视觉", "长上下文"],
"claude-sonnet-4": ["推理", "视觉", "长上下文"],
"deepseek-chat": ["长上下文"],
"deepseek-reasoner": ["推理", "长上下文"],
"deepseek-r1": ["推理", "长上下文"],
"qwen-max": ["推理", "长上下文"],
"qwen-plus": ["长上下文"],
"qwen-turbo": ["长上下文"],
"qwen2.5-72b": ["长上下文"],
"qwen3-235b": ["推理", "长上下文"],
"gemini-2.0-flash": ["推理", "视觉", "长上下文"],
"gemini-2.5-pro": ["推理", "视觉", "长上下文"],
"gemini-2.5-flash": ["推理", "视觉", "长上下文"],
"doubao-1-5-pro": ["推理", "视觉", "长上下文"],
"doubao-seed-1-6": ["推理", "视觉", "长上下文"],
"kimi-k2": ["推理", "长上下文"],
"moonshot-v1-128k": ["长上下文"],
"glm-4": ["推理", "长上下文"],
"glm-4v": ["推理", "视觉", "长上下文"],
"grok-3": ["推理", "长上下文"]
};
function norm(id){ return String(id || "").trim().toLowerCase(); }
/* 表内查找：精确匹配优先，其次最长前缀匹配（如 gpt-4o-2024-05-13 命中 gpt-4o） */
function tableFor(id){
var n = norm(id);
if(!n) return [];
if(TABLE[n]) return TABLE[n].slice();
var best = null;
Object.keys(TABLE).forEach(function(k){
if(n.indexOf(k) === 0 && (!best || k.length > best.length)) best = k;
});
return best ? TABLE[best].slice() : [];
}
function readAll(){
try{ var o = JSON.parse(localStorage.getItem(KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
catch(e){ return {}; }
}
/* 用户自定义优先，其次查表 */
function get(id){
var all = readAll(), n = norm(id);
if(n && all[n]) return all[n].slice();
return tableFor(id);
}
function save(id, tags){
var n = norm(id);
if(!n) return;
tags = (tags || []).map(function(t){ return String(t == null ? "" : t).trim(); }).filter(function(t){ return t; });
var all = readAll();
if(!tags.length) delete all[n]; else all[n] = tags.slice();
try{ localStorage.setItem(KEY, JSON.stringify(all)); }catch(e){}
}
/* 按 TAGS 顺序 + 自定义标签（保持用户添加顺序）合并，用于渲染复选框 */
function allTagsFor(id){
var cur = get(id), out = TAGS.slice();
cur.forEach(function(t){ if(out.indexOf(t) < 0) out.push(t); });
return out;
}
return {TAGS: TAGS, TABLE: TABLE, norm: norm, tableFor: tableFor, get: get, save: save, allTagsFor: allTagsFor};
})();
