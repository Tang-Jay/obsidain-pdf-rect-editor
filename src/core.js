'use strict';
function parseLink(raw) {
  const m = /^!?\[\[([^\n]+)\]\]$/.exec(raw);
  if (!m) throw Error('请选择一个完整的 PDF 选区链接。');
  const body = m[1], pipe = body.indexOf('|'), target = pipe < 0 ? body : body.slice(0, pipe).replace(/\\$/, '');
  const hash = target.indexOf('#');
  if (hash < 0 || !/\.pdf$/i.test(target.slice(0, hash))) throw Error('这不是 PDF 链接。');
  const params = new URLSearchParams(target.slice(hash + 1));
  const page = Number(params.get('page'));
  const values = params.getAll('rect');
  const rect = (values[0] || '').split(',').map(Number);
  if (!Number.isInteger(page) || page < 1 || values.length !== 1 || rect.length !== 4 || rect.some(v => !Number.isFinite(v)) || rect[0] >= rect[2] || rect[1] >= rect[3]) throw Error('链接中的 page 或 rect 参数无效。');
  if (params.has('annotation')) throw Error('此链接关联 PDF 批注，不能只修改 rect；请先使用不含 annotation 参数的普通选区链接。');
  return { raw, path: target.slice(0, hash), page, rect };
}
function findLink(text, offset) {
  for (const m of text.matchAll(/!?\[\[[^\]\n]+\]\]/g)) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      const parsed = parseLink(m[0]);
      return { ...parsed, start: m.index, end: m.index + m[0].length };
    }
  }
  throw Error('请先将光标放在包含 rect= 的 PDF 链接内。');
}
function updateRect(raw, rect) {
  parseLink(raw);
  const next=raw.replace(/([#&]rect=)[^&|\]\n]+/, (_, prefix) => prefix + rect.map(v => Number(v.toFixed(2))).join(','));
  // Only the rect value may change. Keep explicit, encoded and absent colors verbatim.
  const strip=s=>s.replace(/([#&]rect=)[^&|\]\n]+/,'$1');
  if(strip(next)!==strip(raw))throw Error('选区颜色或其它链接参数发生变化，已取消保存。');
  return next;
}
function selectionStyle(raw,settings={}) {
  const link=parseLink(raw),target=link.raw.split('|')[0];
  const params=new URLSearchParams(target.slice(target.indexOf('#')+1).replace(/\]\]$/,''));
  const name=params.get('color');
  const value=name??(settings.highlightColorSpecifiedOnly?null:settings.defaultColor);
  let color=settings.colors?.[value]??value;
  if(/^#[0-9a-f]{3}$/i.test(color||''))color='#'+[...color.slice(1)].map(c=>c+c).join('');
  if(!/^#[0-9a-f]{6}$/i.test(color||''))color='#64748b';
  return {color,fill:color+'22'};
}
function applySelectionStyle(el,raw,settings) {
 const style=selectionStyle(raw,settings);
 el.style.setProperty('--pre-selection-color',style.color);
 el.style.setProperty('--pre-selection-fill',style.fill);
}
function boxFromRect(viewport, rect) {
  const a = viewport.convertToViewportRectangle(rect);
  return { x: Math.min(a[0], a[2]), y: Math.min(a[1], a[3]), w: Math.abs(a[2]-a[0]), h: Math.abs(a[3]-a[1]) };
}
function rectFromBox(viewport, box) {
  const a = viewport.convertToPdfPoint(box.x, box.y), b = viewport.convertToPdfPoint(box.x+box.w, box.y+box.h);
  return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
}
function dragBox(b, mode, dx, dy, width, height) {
  if (mode === 'move') return {...b, x:Math.max(0,Math.min(width-b.w,b.x+dx)), y:Math.max(0,Math.min(height-b.h,b.y+dy))};
  let l=b.x,t=b.y,r=l+b.w,d=t+b.h;
  if(mode.includes('w')) l=Math.max(0,Math.min(r-4,l+dx));
  if(mode.includes('e')) r=Math.min(width,Math.max(l+4,r+dx));
  if(mode.includes('n')) t=Math.max(0,Math.min(d-4,t+dy));
  if(mode.includes('s')) d=Math.min(height,Math.max(t+4,d+dy));
  return {x:l,y:t,w:r-l,h:d-t};
}
module.exports={parseLink,findLink,updateRect,selectionStyle,applySelectionStyle,boxFromRect,rectFromBox,dragBox};
