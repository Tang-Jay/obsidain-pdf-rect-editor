'use strict';
const {Plugin,Modal,Notice,MarkdownView,Menu,PluginSettingTab,Setting,loadPdfJs}=require('obsidian');
const {NativeRectEditor}=require('./native');
const {targetState,saveSelection}=require('./excalidraw');
const {parseLink,findLink,updateRect,applySelectionStyle,boxFromRect,rectFromBox,dragBox}=require('./core');
class RectModal extends Modal {
  constructor(plugin,editor,file,link) {super(plugin.app);Object.assign(this,{plugin,editor,file,link,closed:false,rotation:0});}
  onOpen() {
    this.modalEl.addClass('pdf-rect-editor-modal');
    this.setTitle('调整 PDF 选区');
    this.contentEl.createEl('p',{text:this.excalidrawLink?'拖动框内移动；拖动八个手柄调整边界。保存同步画布裁切、链接、尺寸和画框，Esc 取消。':'拖动框内移动；拖动八个手柄调整边界。保存更新原链接，Esc 取消。'});
    const tools=this.contentEl.createDiv({cls:'pre-tools'});
    this.topSaveButton=tools.createEl('button',{text:'保存选区',cls:'mod-cta'});
    this.topSaveButton.disabled=true;this.topSaveButton.onclick=()=>this.save();
    tools.createEl('button',{text:'取消'}).onclick=()=>this.close();
    this.resetButton=tools.createEl('button',{text:'恢复原选区'});
    this.resetButton.onclick=()=>{this.box=boxFromRect(this.viewport,this.link.rect);this.paint();};
    this.resetButton.disabled=true;
    this.rotateButton=tools.createEl('button',{text:'旋转 90°'});
    this.rotateButton.disabled=true;
    this.rotateButton.onclick=()=>this.rotate();
    this.label=tools.createEl('span',{text:'加载 PDF…'});
    this.scroller=this.contentEl.createDiv({cls:'pre-scroll'});
    this.stage=this.scroller.createDiv({cls:'pre-stage'});
    this.canvas=this.stage.createEl('canvas');
    this.selection=this.stage.createDiv({cls:'pre-selection',attr:{tabindex:'0','aria-label':'可调整的 PDF 选区'}});
    this.selection.style.display='none';
    applySelectionStyle(this.selection,this.link.raw,this.app.plugins?.plugins?.['pdf-plus']?.settings);
    for(const mode of ['nw','n','ne','e','se','s','sw','w']) this.selection.createDiv({cls:`pre-handle pre-${mode}`,attr:{'data-mode':mode}});
    this.selection.onpointerdown=e=>this.beginDrag(e);
    this.selection.onpointermove=e=>this.moveDrag(e);
    this.selection.onpointerup=e=>this.endDrag(e);
    this.selection.onpointercancel=e=>this.endDrag(e);
    const actions=this.contentEl.createDiv({cls:'modal-button-container'});
    actions.createEl('button',{text:'取消'}).onclick=()=>this.close();
    this.saveButton=actions.createEl('button',{text:'保存选区',cls:'mod-cta'});
    this.saveButton.disabled=true;this.saveButton.onclick=()=>this.save();
    this.ready=this.load().catch(err=>{if(!this.closed){this.label.setText('加载失败：'+err.message);new Notice(err.message);}});
  }
  async load() {
    const pdf=this.app.metadataCache.getFirstLinkpathDest(this.link.path,this.file.path);
    if(!pdf || pdf.extension.toLowerCase()!=='pdf') throw Error('无法解析 PDF 文件路径。');
    await loadPdfJs();if(this.closed)return;
    if(!window.pdfjsLib?.getDocument)throw Error('当前 Obsidian 的 PDF.js 接口不可用。');
    const bytes=await this.app.vault.readBinary(pdf);if(this.closed)return;
    this.loading=window.pdfjsLib.getDocument({data:new Uint8Array(bytes),cMapPacked:true,cMapUrl:'/lib/pdfjs/cmaps/',standardFontDataUrl:'/lib/pdfjs/standard_fonts/'});
    this.pdfDocument=await this.loading.promise;if(this.closed)return;
    if(this.link.page>this.pdfDocument.numPages)throw Error('选区页码超出 PDF 页数。');
    this.page=await this.pdfDocument.getPage(this.link.page);if(this.closed)return;
    this.rotation=this.page.rotate;
    const view=this.page.view, r=this.link.rect;
    if(r[0]<view[0]-.1||r[1]<view[1]-.1||r[2]>view[2]+.1||r[3]>view[3]+.1)throw Error('原选区超出页面范围，请核对 rect 坐标。');
    await this.render(this.link.rect);
  }
  async render(rect) {
    this.saveButton.disabled=true;this.topSaveButton.disabled=true;this.rotateButton.disabled=true;this.resetButton.disabled=true;
    const base=this.page.getViewport({scale:1,rotation:this.rotation});
    const scale=Math.min(1.6,Math.max(300,this.scroller.clientWidth-24)/base.width);
    this.viewport=this.page.getViewport({scale,rotation:this.rotation});
    const v=this.viewport,dpr=Math.min(window.devicePixelRatio||1,2);
    this.stage.style.width=v.width+'px';this.stage.style.height=v.height+'px';
    this.canvas.width=Math.ceil(v.width*dpr);this.canvas.height=Math.ceil(v.height*dpr);
    this.canvas.style.width=v.width+'px';this.canvas.style.height=v.height+'px';
    this.renderTask=this.page.render({canvasContext:this.canvas.getContext('2d'),viewport:v,transform:[dpr,0,0,dpr,0,0]});
    await this.renderTask.promise;if(this.closed)return;
    this.box=boxFromRect(v,rect);this.selection.style.display='block';this.paint();
    this.saveButton.disabled=false;this.topSaveButton.disabled=false;this.rotateButton.disabled=false;this.resetButton.disabled=false;
  }
  async rotate(){
    try{const rect=rectFromBox(this.viewport,this.box);this.rotation=(this.rotation+90)%360;await this.render(rect);}
    catch(e){if(!this.closed)new Notice('旋转失败：'+e.message);}
  }
  paint(){
    const b=this.box;Object.assign(this.selection.style,{left:b.x+'px',top:b.y+'px',width:b.w+'px',height:b.h+'px'});
    this.label.setText(`第 ${this.link.page} 页 · rect=${rectFromBox(this.viewport,b).map(v=>Number(v.toFixed(2))).join(',')}`);
  }
  beginDrag(e){
    if(e.button!==0||this.saveButton.disabled)return;e.preventDefault();e.stopPropagation();
    this.drag={id:e.pointerId,mode:e.target.dataset.mode||'move',x:e.clientX,y:e.clientY,box:{...this.box}};
    this.selection.setPointerCapture(e.pointerId);
  }
  moveDrag(e){
    if(!this.drag||this.drag.id!==e.pointerId)return;
    const bounds=this.stage.getBoundingClientRect();
    this.box=dragBox(this.drag.box,this.drag.mode,(e.clientX-this.drag.x)*this.viewport.width/bounds.width,(e.clientY-this.drag.y)*this.viewport.height/bounds.height,this.viewport.width,this.viewport.height);this.paint();
  }
  endDrag(e){if(this.drag?.id===e.pointerId){if(this.selection.hasPointerCapture(e.pointerId))this.selection.releasePointerCapture(e.pointerId);this.drag=null;}}
  async save(){
    if(!this.box||this.saving)return;
    if(this.excalidrawLink){
      this.saving=true;this.saveButton.disabled=true;this.topSaveButton.disabled=true;
      try{this.plugin.lastExcalidrawEdit=await saveSelection(this.app,this.file.path,this.excalidrawLink,rectFromBox(this.viewport,this.box).map(v=>Number(v.toFixed(2))),this.page);new Notice('画布选区、跳转链接及画框已同步保存。');this.close();}
      catch(err){new Notice(err.message);this.saveButton.disabled=false;this.topSaveButton.disabled=false;}
      finally{this.saving=false;}return;
    }
    // A snapshot check deliberately rejects concurrent edits; never guess a moved occurrence.
    if(this.editor.getValue()!==this.snapshot || this.editor.getRange(this.editor.offsetToPos(this.link.start),this.editor.offsetToPos(this.link.end))!==this.link.raw || this.sourceView.file!==this.file){new Notice('原笔记已变化，请取消后从原链接重新打开，避免修改错误位置。');return;}
    const next=updateRect(this.link.raw,rectFromBox(this.viewport,this.box));
    this.editor.replaceRange(next,this.editor.offsetToPos(this.link.start),this.editor.offsetToPos(this.link.end));
    new Notice('PDF 选区已更新，可在笔记中撤销。');this.close();
  }
  onClose(){
    this.closed=true;this.drag=null;this.renderTask?.cancel();
    if(this.loading)Promise.resolve(this.loading.destroy()).catch(()=>{});
    this.plugin.modals.delete(this);this.contentEl.empty();
  }
}
class RectSettings extends PluginSettingTab {
  display(){
    const {containerEl}=this;containerEl.empty();
    containerEl.createEl('h2',{text:'PDF++ Region Editor'});
    new Setting(containerEl).setName('PDF 页面内直接编辑').setDesc('打开 PDF 默认展示；右键选区选择编辑后可拖动，松开鼠标自动保存并回到展示状态。').addToggle(t=>t.setValue(this.plugin.nativeEnabled).onChange(async value=>{this.plugin.nativeEnabled=value;await this.plugin.saveData({nativeEnabled:value});this.plugin.syncNative();}));
    containerEl.createEl('p',{text:'支持 Markdown 链接与已打开的 Excalidraw 画布。画布中选中一个 PDF 裁切图片（或独立画框），点击左侧选区图标或运行“编辑选中的 Excalidraw PDF 选区”。也可跳入 PDF 后右键编辑；多来源时通过“选区来源笔记”切换。画布保存会同步裁切、链接、尺寸及独立 Frame；不会改动其它引用。'});
    new Setting(containerEl).setName('打开选区编辑器').setDesc('先在笔记源码中把光标放进包含 rect= 的 PDF 链接，再点击左侧工具栏的选区图标，或使用命令面板。').addButton(button=>button.setButtonText('编辑当前链接').setCta().onClick(()=>{
      const view=this.app.workspace.getActiveViewOfType(MarkdownView);
      if(!view){new Notice('请先打开 Markdown 笔记，并将光标放进 PDF 选区链接。');return;}
      try{findLink(view.editor.getValue(),view.editor.posToOffset(view.editor.getCursor()));}
      catch(err){new Notice(err.message);return;}
      this.app.setting.close();this.plugin.edit(view.editor,view);
    }));
    new Setting(containerEl).setName('界面入口').setDesc('左侧工具栏：调整 PDF 选区；命令面板：PDF++ Region Editor: 编辑光标所在的 PDF 选区；编辑器右键菜单：调整 PDF 选区。');
    new Setting(containerEl).setName('保存与取消').setDesc('顶部和底部均有保存按钮。Esc 取消；Markdown 可用 Cmd+Z，画布可运行“撤销上次画布选区调整”。PDF 页面内可右键撤销上次调整。不修改 PDF 文件。');
    new Setting(containerEl).setName('版本').setDesc(this.plugin.manifest.version+' · 插件 ID: pdf-rect-editor');
  }
}
module.exports=class PdfRectEditor extends Plugin {
  async onload(){
    this.nativeEnabled=(await this.loadData())?.nativeEnabled!==false;
    this.controllers=new Map();
    // PDF++ backlink color menus do not emit pdf-menu. Extend the existing
    // Menu at display time so its original color actions remain untouched.
    const originalShow=Menu.prototype.showAtMouseEvent,plugin=this;
    let menuHookActive=true;
    function showWithRectEditor(event,...args){
      if(menuHookActive&&plugin.nativeEnabled){
        for(const controller of plugin.controllers.values()){
          const state=controller.hit(event);
          if(state){
            this.addItem(item=>item.setSection('color').setTitle('编辑选区').setIcon('scan').onClick(()=>controller.activate(state)));
            if(controller.last)this.addItem(item=>item.setTitle('撤销上次选区调整').setIcon('undo').onClick(()=>controller.undo()));
            if(controller.sourceChoices?.length>1)this.addItem(item=>{
              item.setTitle('选区来源笔记').setIcon('file-text');
              const submenu=item.setSubmenu();
              for(const source of controller.sourceChoices)submenu.addItem(choice=>choice.setTitle(source.name).setChecked(source.path===controller.source).onClick(()=>{
                controller.finishEditing();controller.source=source.path;controller.key='';controller.tick();
              }));
            });
            break;
          }
        }
      }
      return originalShow.call(this,event,...args);
    }
    Menu.prototype.showAtMouseEvent=showWithRectEditor;
    this.register(()=>{menuHookActive=false;if(Menu.prototype.showAtMouseEvent===showWithRectEditor)Menu.prototype.showAtMouseEvent=originalShow;});
    this.modals=new Set();
    this.lastMarkdown=this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
    this.lastSource=this.app.workspace.activeLeaf?.view?.file?.path;
    this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{if(leaf?.view instanceof MarkdownView)this.lastMarkdown=leaf.view.file?.path;if(['markdown','excalidraw'].includes(leaf?.view?.getViewType?.()))this.lastSource=leaf.view.file?.path;}));
    this.registerInterval(window.setInterval(()=>this.syncNative(),1000));
    this.app.workspace.onLayoutReady(()=>this.syncNative());
    this.addSettingTab(new RectSettings(this.app,this));
    this.addRibbonIcon('scan','调整 PDF 选区',()=>{
      if(this.app.workspace.activeLeaf?.view?.getViewType?.()==='excalidraw'){this.editExcalidraw();return;}
      const view=this.app.workspace.getActiveViewOfType(MarkdownView);
      if(!view){new Notice('请先打开 Markdown 笔记，并将光标放进 PDF 选区链接。');return;}
      this.edit(view.editor,view);
    });
    this.addCommand({id:'edit-excalidraw-rect',name:'编辑选中的 Excalidraw PDF 选区',checkCallback:checking=>{const v=this.app.workspace.activeLeaf?.view;if(v?.getViewType?.()!=='excalidraw')return false;if(!checking)this.editExcalidraw();return true;}});
    this.addCommand({id:'undo-excalidraw-rect',name:'撤销上次画布选区调整',callback:async()=>{try{if(this.lastExcalidrawEdit){await this.lastExcalidrawEdit.undo();this.lastExcalidrawEdit=null;new Notice('已撤销画布选区调整。');}}catch(e){new Notice(e.message);}}});
    this.addCommand({id:'edit-rect',name:'编辑光标所在的 PDF 选区',editorCallback:(editor,view)=>this.edit(editor,view)});
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,view)=>{
      try{findLink(editor.getValue(),editor.posToOffset(editor.getCursor()));}
      catch{return;}
      menu.addItem(item=>item.setTitle('调整 PDF 选区').setIcon('scan').onClick(()=>this.edit(editor,view)));
    }));
  }
  editExcalidraw(view=this.app.workspace.activeLeaf?.view){
    try{
      const a=view?.excalidrawAPI;
      if(!a)throw Error('请先打开来源 Excalidraw 画布。');
      if(this.modals.size)throw Error('请先保存或关闭当前选区编辑窗口。');
      const selected=a.getAppState().selectedElementIds||{};
      const images=a.getSceneElements().filter(e=>e.type==='image'&&(selected[e.id]||selected[e.frameId]));
      if(images.length!==1)throw Error('请只选中一个 PDF 选区图片或其画框。');
      const image=images[0],link={...parseLink(image.link),elementId:image.id,state:targetState(view,image.id)};
      const modal=new RectModal(this,null,view.file,link);modal.excalidrawLink=link;this.modals.add(modal);modal.open();
    }catch(e){new Notice(e.message);}
  }
  edit(editor,view){
    try{
      if(!view.file)throw Error('请在 Markdown 笔记中使用此命令。');
      if(this.modals.size)throw Error('请先保存或关闭当前选区编辑窗口。');
      const snapshot=editor.getValue(),link=findLink(snapshot,editor.posToOffset(editor.getCursor()));
      const modal=new RectModal(this,editor,view.file,link);modal.snapshot=snapshot;modal.sourceView=view;this.modals.add(modal);modal.open();
    }catch(err){new Notice(err.message);}
  }
  syncNative(){
    const leaves=this.nativeEnabled?this.app.workspace.getLeavesOfType('pdf'):[];
    for(const [leaf,c] of this.controllers)if(!leaves.includes(leaf)){c.dispose();this.controllers.delete(leaf);}
    for(const leaf of leaves){if(!this.controllers.has(leaf))this.controllers.set(leaf,new NativeRectEditor(this,leaf));this.controllers.get(leaf).tick();}
  }
  onunload(){for(const c of this.controllers.values())c.dispose();for(const modal of [...this.modals])modal.close();}
};
