/* ============ SVG 图标库 (Lucide/Feather 风格手写, 零依赖) ============
 * window.icon(name, size) -> inline SVG 字符串
 * 24x24 viewBox, stroke 1.8px round caps/joins, fill none, stroke=currentColor,
 * 颜色由 CSS 控制(默认继承文字色)。 */
(function(){
"use strict";
var P = {
"book-open": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
"user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
"users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
"save": '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
"scroll": '<path d="M19 17V7a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
"pin": '<path d="M9 4h6v5l3 5H6l3-5z"/><path d="M12 14v7"/>',
"clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
"clapperboard": '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
"ws_sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
"ws_cloud": '<path d="M17.5 18a4.5 4.5 0 0 0 .4-8.98A6 6 0 0 0 6.2 10.5 3.8 3.8 0 0 0 7 18h10.5z"/>',
"ws_rain": '<path d="M17.5 14a4.5 4.5 0 0 0 .4-8.98A6 6 0 0 0 6.2 6.5 3.8 3.8 0 0 0 7 14h10.5z"/><path d="M8 17v3M12 16v3M16 17v3"/>',
"ws_snow": '<path d="M17.5 14a4.5 4.5 0 0 0 .4-8.98A6 6 0 0 0 6.2 6.5 3.8 3.8 0 0 0 7 14h10.5z"/><path d="M8 17l1 1M15 18l1 1M11.5 16.5l1 1"/>',
"ws_fog": '<path d="M4 10h16M6 14h14M8 18h10"/>',
"ws_storm": '<path d="M17.5 13a4.5 4.5 0 0 0 .4-8.98A6 6 0 0 0 6.2 5.5 3.8 3.8 0 0 0 7 13h10.5z"/><path d="M12 13l-2.5 5H12l-1 4 4.5-7H13l1.5-2z"/>',
"brain": '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3 4 4.5 4.5 0 0 1-3-4"/>',
"books": '<path d="M16 6l4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
"dice": '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/>',
"repeat": '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
"thumb-up": '<path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
"thumb-down": '<g transform="translate(0,24) scale(1,-1)"><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></g>',
"volume": '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
"plus": '<path d="M12 5v14"/><path d="M5 12h14"/>',
"edit": '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
"copy": '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
"trash": '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
"x": '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
"chat": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
"download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
"upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 8l5-5 5 5"/><path d="M12 3v12"/>',
"eye": '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
"palette": '<path d="M12 22a10 10 0 1 1 10-10c0 1.5-1 2.5-2.5 2.5H17a2 2 0 0 0-2 2c0 .8-.7 1.7-1.7 2.1-.9.4-1.3 1.3-1.3 3.4z"/><circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/>',
"chart": '<path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V7"/><path d="M18 17v-3"/>',
"send": '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
"bell": '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
"history": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
"stop": '<rect x="6" y="6" width="12" height="12" rx="2"/>',
"back": '<path d="M15 18l-6-6 6-6"/>',
"menu": '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
"settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
"check": '<path d="M20 6L9 17l-5-5"/>',
"search": '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
"play": '<polygon points="7 4 20 12 7 20 7 4"/>',
"pause": '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
/* P1-6/P1-30/P2-25：emoji 当图标时补的字形。同一套手绘路径、同一 1.8 描边，
   与既有图标同源，不再出现"这一枚是系统 emoji、旁边那枚是 SVG"的混排。 */
"type": '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
"image": '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
"lightbulb": '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
"sparkles": '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
"masks": '<path d="M3 4h5a3 3 0 0 1 3 3v6a4 4 0 0 1-4 4H5a2 2 0 0 1-2-2z"/><path d="M21 4h-5a3 3 0 0 0-3 3v6a4 4 0 0 0 4 4h2a2 2 0 0 0 2-2z"/><path d="M6.5 9.5h.01"/><path d="M17.5 9.5h.01"/>'
};
/* 实心图标: stop(方块)、menu(省略号圆点)、play/pause */
var FILLED = {stop:1, menu:1, play:1, pause:1};
window.icon = function(name, size){
  size = size || 18;
  var inner = P[name] || "";
  var filled = !!FILLED[name];
  return '<svg class="ic" width="'+size+'" height="'+size+'" viewBox="0 0 24 24"'
    + ' fill="'+(filled?"currentColor":"none")+'"'
    + ' stroke="'+(filled?"none":"currentColor")+'"'
    + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + inner + '</svg>';
};
})();
