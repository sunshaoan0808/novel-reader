(function(){
function desc(el){
  var t = el.tagName.toLowerCase();
  if(el.id) t += "#"+el.id;
  else if(el.className && typeof el.className==="string"){ var c=el.className.trim().split(/\s+/).slice(0,2).join("."); if(c) t += "."+c; }
  var txt = (el.innerText||"").trim().replace(/\s+/g," ").slice(0,28);
  if(txt) t += ' "'+txt+'"';
  return t;
}
function vis(el){ var r=el.getBoundingClientRect(); var cs=getComputedStyle(el);
  return r.width>1 && r.height>1 && cs.visibility!=="hidden" && parseFloat(cs.opacity)>0; }
var res = {overlaps:[], overflows:[], contrasts:[], smallTargets:[], lineHeights:[], pageOverflow:null, nLeaf:0};
function isFixed(el){ var n=el; while(n&&n!==document.body){ if(getComputedStyle(n).position==="fixed") return true; n=n.parentElement; } return false; }
/* 元素的真实可见区域：rect 与所有滚动祖先可视盒、视口求交。
   被裁掉的部分不参与重叠判定，否则滚出/半滚出滚动容器的内容会产生幻影重叠。 */
function visibleRect(el){
  var r = el.getBoundingClientRect();
  var x1=r.left, y1=r.top, x2=r.right, y2=r.bottom;
  var n = el.parentElement;
  while(n && n !== document.body){
    var cs = getComputedStyle(n);
    if(cs.overflowX !== "visible" || cs.overflowY !== "visible"){
      var nr = n.getBoundingClientRect();
      var bl=parseFloat(cs.borderLeftWidth)||0, br=parseFloat(cs.borderRightWidth)||0,
          bt=parseFloat(cs.borderTopWidth)||0, bb=parseFloat(cs.borderBottomWidth)||0;
      x1=Math.max(x1, nr.left+bl); y1=Math.max(y1, nr.top+bt);
      x2=Math.min(x2, nr.right-br); y2=Math.min(y2, nr.bottom-bb);
    }
    n = n.parentElement;
  }
  x1=Math.max(x1,0); y1=Math.max(y1,0);
  x2=Math.min(x2,window.innerWidth); y2=Math.min(y2,window.innerHeight);
  if(x2<=x1+1 || y2<=y1+1) return null;
  return {left:x1,top:y1,right:x2,bottom:y2,width:x2-x1,height:y2-y1};
}
var all = Array.prototype.filter.call(document.querySelectorAll("body *"), vis);
var allNoFixed = all.filter(function(e){ return !isFixed(e); });
var leaf = all.filter(function(e){
  var kids = e.children;
  for(var i=0;i<kids.length;i++) if(vis(kids[i])) return false;
  return (e.innerText||"").trim().length>0;
});
res.nLeaf = leaf.length;
function contains(a,b){ return a.left<=b.left+1 && a.top<=b.top+1 && a.right>=b.right-1 && a.bottom>=b.bottom-1; }
var L = [];
leaf.forEach(function(e){
  if(isFixed(e)) return;
  var vr = visibleRect(e);
  if(!vr) return;
  L.push({el:e, vr:vr});
});
L = L.slice(0, 600);
for(var i=0;i<L.length;i++){ for(var j=i+1;j<L.length;j++){
  var a=L[i].el, b=L[j].el;
  if(a.contains(b)||b.contains(a)) continue;
  var ra=L[i].vr, rb=L[j].vr;
  if(contains(ra,rb)||contains(rb,ra)) continue;
  var ix = Math.max(0, Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left));
  var iy = Math.max(0, Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top));
  if(ix<=0||iy<=0) continue;
  var area = ix*iy, minA = Math.min(ra.width*ra.height, rb.width*rb.height);
  if(minA>0 && area/minA > 0.25){
    res.overlaps.push({a:desc(a), b:desc(b), pct:Math.round(area/minA*100)});
    if(res.overlaps.length>=25) break;
  }
  if(res.overlaps.length>=25) break;
}}
all.forEach(function(e){
  try{
    var cs = getComputedStyle(e);
    if(cs.overflowX==="visible" && e.scrollWidth > e.clientWidth + 3 && e.clientWidth > 0){
      if(e.scrollWidth - e.clientWidth > 8) res.overflows.push({el:desc(e), sw:e.scrollWidth, cw:e.clientWidth});
    }
  }catch(err){}
});
if(res.overflows.length>20) res.overflows = res.overflows.slice(0,20);
var de = document.documentElement;
res.pageOverflow = {sw: de.scrollWidth, iw: window.innerWidth, overflow: de.scrollWidth > window.innerWidth + 2};
function lum(rgb){
  var m = String(rgb).match(/[\d.]+/g); if(!m) return 0;
  var c = [m[0]/255,m[1]/255,m[2]/255].map(function(v){ return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
function effBg(el){
  var n = el;
  while(n && n!==document){
    var bg = getComputedStyle(n).backgroundColor;
    var m = String(bg).match(/[\d.]+/g);
    if(m){
      var alpha = m[3]===undefined ? 1 : parseFloat(m[3]);
      if(alpha > 0.9) return bg;
    }
    n = n.parentElement;
  }
  return "rgb(255,255,255)";
}
var seen = {};
leaf.slice(0,400).forEach(function(e){
  try{
    var cs = getComputedStyle(e);
    var fg = cs.color;
    if(!fg || fg.indexOf("rgba(0, 0, 0, 0")==0) return;
    var fs = parseFloat(cs.fontSize)||14;
    if(fs < 10) return;
    var bgEl = e, hasGrad = false, nn = e;
    while(nn && nn!==document){ var bi = getComputedStyle(nn).backgroundImage; if(bi && bi!=="none"){ hasGrad = true; break; } nn = nn.parentElement; }
    if(hasGrad) return;
    var bg = effBg(e);
    var L1 = lum(fg), L2 = lum(bg);
    var ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    var key = fg+"|"+bg;
    if(ratio < 4.5 && !seen[key]){ seen[key]=1;
      res.contrasts.push({el:desc(e), ratio:Math.round(ratio*100)/100, fg:fg, bg:bg, fs:Math.round(fs)}); }
  }catch(err){}
});
Array.prototype.forEach.call(document.querySelectorAll("button,a,input,select,textarea,[role=button]"), function(e){
  if(!vis(e)) return;
  var r = e.getBoundingClientRect();
  if(r.width>0 && r.height>0 && (r.width < 44 || r.height < 44)){
    res.smallTargets.push({el:desc(e), w:Math.round(r.width), h:Math.round(r.height)});
  }
});
if(res.smallTargets.length>30) res.smallTargets = res.smallTargets.slice(0,30);
leaf.forEach(function(e){
  try{
    var txt=(e.innerText||"").trim();
    if(txt.length<30) return;
    var cs=getComputedStyle(e);
    var fs=parseFloat(cs.fontSize)||14, lh=cs.lineHeight;
    var lhv = lh==="normal"? fs*1.2 : parseFloat(lh);
    if(lhv/fs < 1.35) res.lineHeights.push({el:desc(e), lh:Math.round(lhv/fs*100)/100, fs:Math.round(fs)});
  }catch(err){}
});
if(res.lineHeights.length>15) res.lineHeights=res.lineHeights.slice(0,15);
return res;
})()
