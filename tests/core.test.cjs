const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseLink,findLink,updateRect,boxFromRect,rectFromBox,dragBox}=require('../src/core');
const link='[[paper.pdf#page=5&rect=104,488,508,712&color=yellow|图 1]]';
test('preserves link parameters, embed marker, table alias and only replaces rect',()=>{
 for(const raw of [link,'!'+link,link.replace('|','\\|')]){
  assert.equal(updateRect(raw,[100,400,500,700]),raw.replace('104,488,508,712','100,400,500,700'));
 }
});
test('identical occurrences resolve by cursor rather than global replace',()=>{
 const text=link+'\n'+link;assert.equal(findLink(text,link.length+8).start,link.length+1);
});
test('invalid rectangles, missing values and annotation-linked rectangles are rejected',()=>{
 for(const raw of [link.replace('104,488,508,712','x,1,2,3'),link.replace('104,488,508,712','2,1,1,3'),link.replace('page=5','page=0'),link.replace('104,488,508,712',',,,'),link.replace('&color','&annotation=abc&color')])assert.throws(()=>parseLink(raw));
});
test('move and all eight resize handles remain inside page',()=>{
 const box={x:20,y:30,w:100,h:200};
 for(const mode of ['move','n','ne','e','se','s','sw','w','nw']) for(const d of [-1000,1000]){
  const b=dragBox(box,mode,d,d,612,792);assert(b.x>=0&&b.y>=0&&b.x+b.w<=612&&b.y+b.h<=792&&b.w>=4&&b.h>=4);
 }
});
test('PDF/display conversions round-trip for all right-angle rotations with crop offset',()=>{
 const rect=[114,508,518,732];
 for(let rotation=0;rotation<360;rotation+=90){
  const scale=1.6,c=Math.cos(rotation*Math.PI/180),s=Math.sin(rotation*Math.PI/180);
  const point=(x,y)=>[scale*(c*(x-10)-s*(y-20)),scale*(s*(x-10)+c*(y-20))];
  const viewport={convertToViewportRectangle:r=>[...point(r[0],r[1]),...point(r[2],r[3])],convertToPdfPoint:(x,y)=>[10+(c*x+s*y)/scale,20+(-s*x+c*y)/scale]};
  rectFromBox(viewport,boxFromRect(viewport,rect)).forEach((v,i)=>assert(Math.abs(v-rect[i])<1e-8));
 }
});
test('resizing preserves explicit, encoded, custom and absent colors verbatim',()=>{
 for(const suffix of ['&color=yellow','&color=blue','&color=green','&color=%23086ddd','&color=purple','']){
  const raw='![[paper.pdf#page=5&rect=104,488,508,712'+suffix+'&width=600|caption]]';
  assert.equal(updateRect(raw,[100,400,500,700]),raw.replace('104,488,508,712','100,400,500,700'));
 }
});
test('editor outline follows PDF++ configured selection color without changing the link',()=>{
 const {selectionStyle}=require('../src/core');const settings={colors:{yellow:'#ffd000',blue:'#086ddd',green:'#37d322'},defaultColor:'green'};
 for(const color of ['yellow','blue','green'])assert.equal(selectionStyle(link.replace('yellow',color),settings).color,settings.colors[color]);
 assert.equal(selectionStyle(link.replace('&color=yellow',''),settings).color,settings.colors.green);
 assert.equal(selectionStyle(link.replace('yellow','%23086ddd'),settings).color,'#086ddd');
});
