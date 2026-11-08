'use strict';
const {parseLink,updateRect,boxFromRect}=require('./core');
const clone=x=>JSON.parse(JSON.stringify(x));
function signature(state){
 const keys=['id','type','x','y','width','height','angle','crop','link','fileId','frameId','scale','groupIds','isDeleted','customData'];
 return JSON.stringify([state.image,state.frame].map(e=>e?Object.fromEntries(keys.filter(k=>e[k]!==undefined).map(k=>[k,e[k]])):null));
}
function resizeSelection(image,frame,rect,viewport){
  if(!image.crop)throw Error('此图片没有原生 PDF 裁切。');
  if(image.angle||frame?.angle)throw Error('请先将图片及画框旋转角度恢复为 0 后调整选区。');
  const c=image.crop,b=boxFromRect(viewport,rect),sx=c.naturalWidth/viewport.width,sy=c.naturalHeight/viewport.height;
  if(b.x<-.01||b.y<-.01||b.x+b.w>viewport.width+.01||b.y+b.h>viewport.height+.01)throw Error('选区超出 PDF 页面。');
  const next=clone(image);next.crop={...c,x:b.x*sx,y:b.y*sy,width:b.w*sx,height:b.h*sy};
  next.width=image.width*next.crop.width/c.width;next.height=image.height*next.crop.height/c.height;
  if(![next.width,next.height].every(v=>Number.isFinite(v)&&v>0))throw Error('裁切尺寸无效。');
  next.link=updateRect(image.link,rect);
  let nextFrame=null;
  if(frame){nextFrame=clone(frame);nextFrame.width+=next.width-image.width;nextFrame.height+=next.height-image.height;if(nextFrame.width<=0||nextFrame.height<=0)throw Error('画框尺寸无效。');}
  return {image:next,frame:nextFrame};
}
function viewFor(app,path){return app.workspace.getLeavesOfType('excalidraw').map(l=>l.view).find(v=>v.file?.path===path&&v.excalidrawAPI);}
function targets(view){return view.excalidrawAPI.getSceneElements().filter(e=>e.type==='image'&&!e.isDeleted&&e.crop&&e.link);}
function targetState(view,id){
 const es=view.excalidrawAPI.getSceneElements(),image=es.find(e=>e.id===id&&!e.isDeleted);
 if(!image)throw Error('来源图片已删除，请重新打开选区。');
 const frame=image.frameId?es.find(e=>e.id===image.frameId&&!e.isDeleted):null;
 if(image.frameId&&!frame)throw Error('关联画框已变化，请重新打开选区。');
 if(frame&&es.some(e=>e.frameId===frame.id&&e.id!==id))throw Error('此画框包含多个元素，请将选区放入独立画框后再编辑。');
 return {image:clone(image),frame:frame?clone(frame):null};
}
async function ensureView(app,path){
 let view=viewFor(app,path);if(view)return view;
 const file=app.vault.getFileByPath(path);if(!file)throw Error('来源画布不存在。');
 const leaf=app.workspace.getLeaf('tab');
 await leaf.setViewState({type:'excalidraw',state:{file:path},active:false});
 for(let i=0;i<100;i++){
  view=viewFor(app,path);if(view?.excalidrawAPI&&view.isLoaded!==false)return view;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('来源画布尚未加载完成，请稍后重试。');
}
async function replaceState(app,path,expected,replacement){
 const view=await ensureView(app,path);
 const current=targetState(view,expected.image.id);
 if(signature(current)!==signature(expected))throw Error('来源图片或画框已变化，请刷新选区后重试。');
 const edits=new Map([replacement.image,replacement.frame].filter(Boolean).map(e=>[e.id,e]));
 const elements=view.excalidrawAPI.getSceneElements().map(e=>edits.has(e.id)?{...clone(edits.get(e.id)),version:e.version+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now()}:e);
 view.excalidrawAPI.updateScene({elements,captureUpdate:'IMMEDIATELY'});
 try{await view.forceSave();}catch(err){view.excalidrawAPI.updateScene({elements:view.excalidrawAPI.getSceneElements().map(e=>e.id===expected.image.id?expected.image:expected.frame&&e.id===expected.frame.id?expected.frame:e)});throw err;}
 return targetState(view,expected.image.id);
}
function excalidrawSources(app,pdf){
 const sources=[];
 for(const leaf of app.workspace.getLeavesOfType('excalidraw')){
  const view=leaf.view;if(!view.file||!view.excalidrawAPI)continue;
  const links=[];
  for(const image of targets(view))try{
   const link=parseLink(image.link);if(app.metadataCache.getFirstLinkpathDest(link.path,view.file.path)!==pdf)continue;
   links.push({...link,elementId:image.id,state:targetState(view,image.id)});
  }catch{}
  if(links.length)sources.push({kind:'excalidraw',file:view.file,links,text:JSON.stringify(links.map(l=>l.state))});
 }
 return sources;
}
async function closedExcalidrawSource(app,path,pdf){
 if(!path||viewFor(app,path))return null;
 const plugin=app.plugins?.plugins?.['obsidian-excalidraw-plugin'],ea=plugin?.ea;
 const file=app.vault.getFileByPath(path);
 if(!file||!ea?.isExcalidrawFile(file))return null;
 const scene=await ea.getSceneFromFile(file);if(!scene?.elements)return null;
 const fakeView={file,excalidrawAPI:{getSceneElements:()=>scene.elements}};
 const links=[];
 for(const image of targets(fakeView))try{
  const link=parseLink(image.link);if(app.metadataCache.getFirstLinkpathDest(link.path,path)!==pdf)continue;
  links.push({...link,elementId:image.id,state:targetState(fakeView,image.id)});
 }catch{}
 return links.length?{kind:'excalidraw',file,links,text:JSON.stringify(links.map(l=>l.state))}:null;
}
async function saveSelection(app,path,link,rect,page){
 const props=link.state.image.customData?.pdfPageViewProps;
 if(!page?.getViewport)throw Error('PDF 页面尚未加载。');
 // Raster crop orientation follows the embedded PDF page, not the viewer rotation.
 const viewport=page.getViewport({scale:1,rotation:props?.rotate??page.rotate});
 const after=resizeSelection(link.state.image,link.state.frame,rect,viewport);
 const committed=await replaceState(app,path,link.state,after);
 return {undo:()=>replaceState(app,path,committed,link.state)};
}
module.exports={resizeSelection,excalidrawSources,saveSelection,viewFor,targetState,closedExcalidrawSource};
