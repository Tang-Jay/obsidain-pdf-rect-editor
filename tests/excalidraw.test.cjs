const {test}=require('node:test');const assert=require('node:assert/strict');
const {resizeSelection,saveSelection,excalidrawSources,targetState,closedExcalidrawSource}=require('../src/excalidraw');
const image={id:'image001',type:'image',x:100,y:200,width:200,height:100,angle:0,version:1,crop:{x:40,y:80,width:400,height:200,naturalWidth:1200,naturalHeight:1600},link:'[[paper.pdf#page=1&rect=10,330,110,380&color=green]]',fileId:'shared',frameId:'frame001',groupIds:['group001']};
const frame={id:'frame001',type:'frame',x:86,y:186,width:228,height:128,angle:0,version:1};
const vp={width:300,height:400,convertToViewportRectangle:r=>[r[0],400-r[1],r[2],400-r[3]]};
function fixture(){let es=structuredClone([image,frame,{...image,id:'other001',frameId:null}]);let saved=0;const view={file:{path:'drawing.excalidraw.md'},excalidrawAPI:{getSceneElements:()=>es,updateScene:s=>{es=s.elements;}},forceSave:async()=>{saved++;}};const app={workspace:{getLeavesOfType:()=>[{view}]},metadataCache:{getFirstLinkpathDest:()=>pdf}};const pdf={path:'paper.pdf'};return {view,app,pdf,get saved(){return saved;}};}
test('converts raster scale and preserves display scaling, source, placement and frame padding',()=>{
 const n=resizeSelection(image,frame,[20,300,170,390],vp);
 assert.deepEqual(n.image.crop,{x:80,y:40,width:600,height:360,naturalWidth:1200,naturalHeight:1600});assert.equal(n.image.width,300);assert.equal(n.image.height,180);assert.equal(n.frame.width,328);assert.equal(n.frame.height,208);assert.equal(n.image.x,100);assert.equal(n.image.fileId,'shared');assert.deepEqual(n.image.groupIds,['group001']);assert.match(n.image.link,/rect=20,300,170,390&color=green/);assert.equal(image.width,200);
});
test('rejects invalid bounds and rotated canvas elements without mutating source',()=>{
 assert.throws(()=>resizeSelection(image,frame,[-1,300,170,390],vp));assert.throws(()=>resizeSelection({...image,angle:1},frame,[20,300,170,390],vp));assert.equal(image.crop.width,400);
});
test('save and undo update only target and frame, preserving another image on shared page',async()=>{
 const f=fixture(),before=targetState(f.view,image.id),other=structuredClone(f.view.excalidrawAPI.getSceneElements()[2]);
 const operation=await saveSelection(f.app,f.view.file.path,{state:before},[20,300,170,390],{rotate:0,getViewport:()=>vp});assert.equal(f.saved,1);assert.equal(targetState(f.view,image.id).image.width,300);assert.deepEqual(f.view.excalidrawAPI.getSceneElements()[2],other);
 await operation.undo();assert.equal(f.saved,2);const restored=targetState(f.view,image.id);for(const k of ['crop','link','width','height','x','y'])assert.deepEqual(restored.image[k],before.image[k]);assert.equal(restored.frame.width,frame.width);
});
test('concurrent image edits and deleted source files are refused',async()=>{
 const f=fixture(),before=targetState(f.view,image.id);f.view.excalidrawAPI.getSceneElements()[0].x++;
 await assert.rejects(saveSelection(f.app,f.view.file.path,{state:before},[20,300,170,390],{getViewport:()=>vp}),/已变化/);assert.equal(f.saved,0);
 f.app.workspace.getLeavesOfType=()=>[];f.app.vault={getFileByPath:()=>null};await assert.rejects(saveSelection(f.app,f.view.file.path,{state:before},[20,300,170,390],{getViewport:()=>vp}),/不存在/);
});
test('uses embedded page rotation rather than current viewer orientation',async()=>{
 const f=fixture();f.view.excalidrawAPI.getSceneElements()[0].customData={pdfPageViewProps:{rotate:90}};let rotation;
 await saveSelection(f.app,f.view.file.path,{state:targetState(f.view,image.id)},[20,300,170,390],{rotate:180,getViewport:opts=>{rotation=opts.rotation;return vp;}});assert.equal(rotation,90);
});
test('discovers element identity for duplicate rectangles independently of markdown backlinks',()=>{
 const f=fixture(),sources=excalidrawSources(f.app,f.pdf);assert.equal(sources.length,1);assert.deepEqual(sources[0].links.map(l=>l.elementId),['image001','other001']);
});
test('shared frame changes and undo after subsequent movement are refused',async()=>{
 const f=fixture();f.view.excalidrawAPI.getSceneElements()[2].frameId=frame.id;assert.throws(()=>targetState(f.view,image.id),/多个元素/);
 f.view.excalidrawAPI.getSceneElements()[2].frameId=null;const operation=await saveSelection(f.app,f.view.file.path,{state:targetState(f.view,image.id)},[20,300,170,390],{getViewport:()=>vp});f.view.excalidrawAPI.getSceneElements()[0].y++;await assert.rejects(operation.undo(),/已变化/);
});
test('save failure restores the target and frame without touching other images',async()=>{
 const f=fixture(),before=targetState(f.view,image.id);f.view.forceSave=async()=>{throw Error('disk failure');};
 await assert.rejects(saveSelection(f.app,f.view.file.path,{state:before},[20,300,170,390],{getViewport:()=>vp}),/disk failure/);assert.deepEqual(targetState(f.view,image.id),before);
});

test('closed drawing is reopened before saving and undo remains available',async()=>{
 const f=fixture(),before=targetState(f.view,image.id);let open=false;
 f.app.workspace.getLeavesOfType=()=>open?[{view:f.view}]:[];
 f.app.vault={getFileByPath:()=>f.view.file};
 f.app.workspace.getLeaf=()=>({setViewState:async state=>{assert.equal(state.type,'excalidraw');assert.equal(state.active,false);open=true;}});
 const op=await saveSelection(f.app,f.view.file.path,{state:before},[20,300,170,390],{getViewport:()=>vp});assert(open);assert.equal(f.saved,1);await op.undo();assert.equal(targetState(f.view,image.id).image.width,image.width);
});

test('closed drawing PDF links are recovered from scene data without markdown backlink parsing',async()=>{
 const f=fixture();f.app.workspace.getLeavesOfType=()=>[];f.app.vault={getFileByPath:()=>f.view.file};
 f.app.plugins={plugins:{'obsidian-excalidraw-plugin':{ea:{isExcalidrawFile:()=>true,getSceneFromFile:async()=>({elements:f.view.excalidrawAPI.getSceneElements()})}}}};
 const source=await closedExcalidrawSource(f.app,f.view.file.path,f.pdf);assert.equal(source.kind,'excalidraw');assert.equal(source.links.length,2);assert.equal(source.links[0].elementId,image.id);
});
test('save and undo preserve every original color including an absent color parameter',async()=>{
 for(const suffix of ['&color=yellow','&color=blue','&color=green','']){
  const f=fixture(),e=f.view.excalidrawAPI.getSceneElements()[0];e.link=e.link.replace('&color=green',suffix);
  const before=targetState(f.view,e.id),op=await saveSelection(f.app,f.view.file.path,{state:before},[20,300,170,390],{getViewport:()=>vp});
  assert.equal(targetState(f.view,e.id).image.link,before.image.link.replace('10,330,110,380','20,300,170,390'));
  await op.undo();assert.equal(targetState(f.view,e.id).image.link,before.image.link);
 }
});
