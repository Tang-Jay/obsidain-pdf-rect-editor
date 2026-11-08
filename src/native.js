'use strict';
const {Notice}=require('obsidian');
const {excalidrawSources,saveSelection,viewFor,closedExcalidrawSource}=require('./excalidraw');
const {findLink,updateRect,applySelectionStyle,boxFromRect,rectFromBox,dragBox}=require('./core');
class NativeRectEditor {
  constructor(plugin,leaf){
    this.plugin=plugin;this.app=plugin.app;this.leaf=leaf;this.layers=[];this.states=[];this.links=[];this.key='';this.disposed=false;
    this.bar=document.createElement('div');this.bar.className='pre-native-bar';
    this.bar.createSpan({text:'选区编辑 · '});
    this.select=this.bar.createEl('select',{attr:{'aria-label':'选区来源笔记'}});
    this.select.onchange=()=>{this.source=this.select.value;this.key='';this.tick();};
    this.status=this.bar.createSpan({text:'读取选区…'});
    this.undoButton=this.bar.createEl('button',{text:'撤销上次调整'});this.undoButton.disabled=true;this.undoButton.onclick=()=>this.undo();
    // Keep status controls detached; the PDF has no persistent toolbar.
  }
  get pdf(){return this.leaf.view.file;}
  get viewer(){return this.leaf.view.viewer?.child?.pdfViewer?.pdfViewer;}
  sourceView(file){return this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v.file===file&&v.getMode?.()==='source');}
  async read(file){const view=this.sourceView(file);return view?view.editor.getValue():await this.app.vault.read(file);}
  async tick(){
    if(this.disposed||this.busy||this.editing||this.drag||this.saving)return;
    this.busy=true;
    try{
      const pdf=this.pdf,viewer=this.viewer;if(!pdf||!viewer)return;
      const refs=this.app.metadataCache.getBacklinksForFile(pdf)?.data;
      const candidates=excalidrawSources(this.app,pdf);
      const origin=this.source?.endsWith('.excalidraw.md')?this.source:this.plugin.lastSource;
      if(origin&&!candidates.some(c=>c.file.path===origin)){
        // Following a PDF link can replace the Excalidraw leaf entirely.
        // Cache the disk scene; parsing PDF resources on every timer tick is expensive.
        const file=this.app.vault.getFileByPath(origin);
        const cacheKey=file?pdf.path+':'+origin+':'+file.stat.mtime:null;
        if(cacheKey&&this.closedSourceKey!==cacheKey){this.closedSourceKey=cacheKey;this.closedSource=await closedExcalidrawSource(this.app,origin,pdf);}
        if(this.closedSource&&this.closedSourceKey===cacheKey)candidates.unshift(this.closedSource);
      }
      for(const path of refs?.keys()||[]){
        const file=this.app.vault.getAbstractFileByPath(path);if(!file||file.extension!=='md'||file.path.endsWith('.excalidraw.md'))continue;
        const text=await this.read(file),links=[];
        for(const m of text.matchAll(/!?\[\[[^\]\n]+\]\]/g)){
          try{const link=findLink(text,m.index+2);if(this.app.metadataCache.getFirstLinkpathDest(link.path,path)===pdf)links.push(link);}catch{}
        }
        if(links.length)candidates.push({file,text,links});
      }
      if(this.disposed)return;
      this.sourceChoices=candidates.map(c=>({path:c.file.path,name:c.file.basename}));
      const choices=candidates.map(c=>c.file.path).join('\n');
      if(this.choices!==choices){
        this.choices=choices;this.select.empty();
        for(const c of candidates)this.select.createEl('option',{text:c.file.path+' ('+c.links.length+')',value:c.file.path});
      }
      if(!candidates.some(c=>c.file.path===this.source))this.source=candidates.find(c=>c.file.path===origin)?.file.path||candidates.find(c=>c.file.path===this.plugin.lastMarkdown)?.file.path||candidates[0]?.file.path;
      if(this.source)this.select.value=this.source;
      const source=candidates.find(c=>c.file.path===this.source);
      const dimensions=source?.links.map(l=>{const p=viewer.getPageView(l.page-1);return [l.page,p?.viewport?.width,p?.viewport?.height,p?.viewport?.rotation];});
      const key=JSON.stringify([pdf.path,source?.file.path,source?.text,dimensions]);
      if(this.key===key&&this.layers.every(l=>l.isConnected))return;
      this.clearLayers();this.key=key;
      if(!source){this.status.setText('此 PDF 尚无 rect 选区链接');return;}
      this.links=source.links;this.snapshot=source.text;this.file=source.file;this.sourceAdapter=source;
      this.status.setText('展示模式 · 右键选区 → 编辑选区');
      for(const link of this.links){
        const pv=viewer.getPageView(link.page-1);if(!pv?.viewport)continue;
        const layer=pv.div.createDiv({cls:'pre-native-layer'});
        layer.style.width=pv.viewport.width+'px';layer.style.height=pv.viewport.height+'px';
        const box=boxFromRect(pv.viewport,link.rect);
        const el=layer.createDiv({cls:'pre-selection pre-native-selection',attr:{title:'右键选区可编辑 · 来源：'+source.file.path}});
        const label=el.createDiv({cls:'pre-native-label',text:(link.raw.split('|')[1]?.replace(/\]\]$/,'')||'选区')});label.style.pointerEvents='none';
        for(const mode of ['nw','n','ne','e','se','s','sw','w'])el.createDiv({cls:'pre-handle pre-'+mode,attr:{'data-mode':mode}});
        applySelectionStyle(el,link.raw,this.app.plugins?.plugins?.['pdf-plus']?.settings);
        const state={el,box,link,pv,layer,source};this.paint(state);this.states.push(state);
        el.onpointerdown=e=>this.start(e,state);el.onpointermove=e=>this.move(e);el.onpointerup=e=>this.end(e,false);el.onpointercancel=e=>this.end(e,true);
        this.layers.push(layer);
      }
    }catch(e){if(!this.disposed)this.status.setText('读取失败：'+e.message);}
    finally{this.busy=false;}
  }
  paint(s){Object.assign(s.el.style,{left:s.box.x+'px',top:s.box.y+'px',width:s.box.w+'px',height:s.box.h+'px'});}
  hit(event){
    if(!this.leaf.view.contentEl.contains(event.target))return null;
    const hits=this.states.filter(s=>{
      const r=s.el.getBoundingClientRect();
      return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;
    }).sort((a,b)=>a.box.w*a.box.h-b.box.w*b.box.h);
    const selected=hits.find(s=>s.source.kind==='excalidraw'&&viewFor(this.app,s.source.file.path)?.excalidrawAPI.getAppState().selectedElementIds?.[s.link.elementId]);
    return selected||hits[0]||null;
  }
  async activate(s){
    if(this.disposed||this.saving||this.drag)return;
    if(s.source.kind==='excalidraw'){
      const duplicates=this.states.filter(other=>other.source===s.source&&other.link.page===s.link.page&&JSON.stringify(other.link.rect)===JSON.stringify(s.link.rect));
      const selected=viewFor(this.app,s.source.file.path)?.excalidrawAPI.getAppState().selectedElementIds||{};
      if(duplicates.length>1&&!selected[s.link.elementId]){new Notice('画布中有多个相同范围的选区，请先在来源画布中选中要编辑的图片，再返回 PDF。');return;}
    }
    if(!this.states.includes(s)){new Notice('选区已刷新，请重新右键选择编辑。');return;}
    const sourceFile=this.file,sourceSnapshot=this.snapshot;
    if((this.sourceAdapter?.kind!=='excalidraw'&&await this.read(sourceFile)!==sourceSnapshot)||this.file!==sourceFile||this.snapshot!==sourceSnapshot||!this.states.includes(s)){this.key='';await this.tick();new Notice('来源笔记已更新，请再次右键选择编辑选区。');return;}
    this.finishEditing();this.editing=s;this.editingInitial={...s.box};s.el.addClass('pre-editing');
    this.status.setText('编辑中 · 拖动松开或在框外双击保存退出 · Esc 取消');
    this.escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(this.drag)this.end({pointerId:this.drag.id},true);else this.finishEditing();}};
    document.addEventListener('keydown',this.escape,true);
    this.outsideDoubleClick=e=>{
      const state=this.editing;
      if(!state||this.drag||this.saving||e.button!==0||state.el.contains(e.target)||e.target.closest?.('.menu,.modal-container,input,textarea,button,select'))return;
      e.preventDefault();e.stopPropagation();
      const initial=this.editingInitial;this.finishEditing();
      this.commit(state,initial,state.pv.viewport);
    };
    document.addEventListener('dblclick',this.outsideDoubleClick,true);
  }
  finishEditing(){
    this.editing?.el.removeClass('pre-editing');this.editing=null;
    if(this.escape)document.removeEventListener('keydown',this.escape,true);
    if(this.outsideDoubleClick)document.removeEventListener('dblclick',this.outsideDoubleClick,true);
    this.status.setText('展示模式 · 右键选区 → 编辑选区');
  }
  start(e,s){
    if(e.button!==0||this.saving||this.drag||this.editing!==s)return;e.preventDefault();e.stopPropagation();
    this.drag={id:e.pointerId,state:s,initial:{...s.box},x:e.clientX,y:e.clientY,mode:e.target.dataset.mode||'move',viewport:s.pv.viewport};
    s.el.setPointerCapture(e.pointerId);this.status.setText('调整中 · 松开自动保存 · Esc 取消');

  }
  move(e){
    const d=this.drag;if(!d||d.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();
    const r=d.state.layer.getBoundingClientRect(),v=d.viewport;
    d.state.box=dragBox(d.initial,d.mode,(e.clientX-d.x)*v.width/r.width,(e.clientY-d.y)*v.height/r.height,v.width,v.height);this.paint(d.state);
  }
  async end(e,cancel){
    const d=this.drag;if(!d||e.pointerId!==d.id)return;e.stopPropagation?.();this.drag=null;
    this.finishEditing();
    if(d.state.el.hasPointerCapture(d.id))d.state.el.releasePointerCapture(d.id);
    if(cancel){d.state.box=d.initial;this.paint(d.state);this.status.setText('已取消本次调整');return;}
    await this.commit(d.state,d.initial,d.viewport);
  }
  async commit(state,initial,viewport){
    // No movement means no file write (including no rounding of original coordinates).
    if(['x','y','w','h'].every(k=>Math.abs(state.box[k]-initial[k])<1e-7)){this.status.setText('未修改选区，已退出编辑');return;}
    const d={state,initial,viewport};
    const next=updateRect(d.state.link.raw,rectFromBox(d.viewport,d.state.box));
    if(next===d.state.link.raw){this.status.setText('选区未改变');return;}
    const before=this.snapshot,after=before.slice(0,d.state.link.start)+next+before.slice(d.state.link.end);
    this.saving=true;this.status.setText('正在保存…');
    try{
      if(state.source.kind==='excalidraw'){
        const rect=rectFromBox(viewport,state.box).map(v=>Number(v.toFixed(2)));
        this.last=await saveSelection(this.app,state.source.file.path,state.link,rect,state.pv.pdfPage);
      }else{
        await this.write(this.file,before,after,d.state.link.start,d.state.link.end,next);
        this.last={file:this.file,before,after,start:d.state.link.start,end:d.state.link.start+next.length,raw:d.state.link.raw};
      }this.undoButton.disabled=false;
      this.snapshot=after;this.key='';this.status.setText('已自动保存到 '+this.file.basename);
    }catch(err){d.state.box=d.initial;this.paint(d.state);this.key='';new Notice('选区未保存：'+err.message);this.status.setText('保存失败，已恢复选框');}
    finally{this.saving=false;}
  }
  async write(file,before,after,start,end,replacement){
    const views=this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).filter(v=>v.file===file&&v.getMode?.()==='source');
    if(views.length){
      if(views.some(v=>v.editor.getValue()!==before))throw Error('来源笔记已变化，请等待选区刷新后重试。');
      views[0].editor.replaceRange(replacement,views[0].editor.offsetToPos(start),views[0].editor.offsetToPos(end));
    }else await this.app.vault.process(file,text=>{if(text!==before)throw Error('来源笔记已变化，请等待刷新后重试。');return after;});
  }
  async undo(){
    if(!this.last||this.saving||this.drag)return;this.saving=true;
    try{const l=this.last;if(l.undo)await l.undo();else await this.write(l.file,l.after,l.before,l.start,l.end,l.raw);this.last=null;this.undoButton.disabled=true;this.key='';this.status.setText('已撤销上次调整');}
    catch(e){new Notice('无法撤销：'+e.message);}finally{this.saving=false;}
  }
  clearLayers(){this.finishEditing();for(const layer of this.layers)layer.remove();this.layers=[];this.states=[];}
  dispose(){this.disposed=true;if(this.drag)this.end({pointerId:this.drag.id},true);this.clearLayers();this.bar.remove();}
}
module.exports={NativeRectEditor};
