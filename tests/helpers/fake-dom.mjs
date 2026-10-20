// Just enough of the DOM to run a UI module's handlers in Node: elements
// with ids, attributes, classes, children and focus, a document that
// dispatches events to its listeners, and the window globals modules read.

class ClassList {
  constructor(){this.names=new Set();}
  add(...names){for(const name of names)this.names.add(name);}
  remove(...names){for(const name of names)this.names.delete(name);}
  contains(name){return this.names.has(name);}
  toggle(name,force=!this.names.has(name)){force?this.add(name):this.remove(name);return force;}
}

// Selectors are a comma-separated list of tag, #id or [attribute] parts.
function matches(element,selector) {
  return selector.split(",").map(part=>part.trim()).some(part=>{
    if(part.startsWith("#"))return element.id===part.slice(1);
    const attribute=part.match(/^\[([\w-]+)\]$/);
    if(attribute)return element.hasAttribute(attribute[1]);
    return element.tagName===part.toUpperCase();
  });
}

export class FakeElement {
  constructor(document,tagName="div",{id=null,text="",rect={top:0,bottom:0,left:0,width:0}}={}) {
    this.ownerDocument=document;
    this.tagName=tagName.toUpperCase();
    this.attributes=new Map();
    this.classList=new ClassList();
    this.children=[];this.parent=null;
    this.dataset={};this.style={};
    this.textContent=text;this.value="";
    this.hidden=false;this.open=false;this.disabled=false;
    this.selected=null;this.scrollTop=0;
    this.rect=rect;this.offsetWidth=0;this.offsetHeight=0;
    if(id)this.id=id;
  }
  get id(){return this.getAttribute("id");}
  set id(value){this.setAttribute("id",value);}
  setAttribute(name,value){
    this.attributes.set(name,String(value));
    if(name==="id")this.ownerDocument?.register(this);
    if(name.startsWith("data-"))this.dataset[name.slice(5)]=String(value);
  }
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);if(name.startsWith("data-"))delete this.dataset[name.slice(5)];}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
  after(node){
    node.remove();
    const siblings=this.parent.children;
    siblings.splice(siblings.indexOf(this)+1,0,node);node.parent=this.parent;
  }
  remove(){if(!this.parent)return;this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
  contains(node){for(let at=node;at;at=at.parent)if(at===this)return true;return false;}
  closest(selector){for(let at=this;at;at=at.parent)if(matches(at,selector))return at;return null;}
  querySelectorAll(selector){
    const found=[];
    const walk=element=>{for(const child of element.children){if(matches(child,selector))found.push(child);walk(child);}};
    walk(this);
    return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  cloneNode(deep){
    const copy=new FakeElement(null,this.tagName,{text:this.textContent});
    for(const [name,value] of this.attributes)copy.attributes.set(name,value);
    copy.dataset={...this.dataset};
    if(deep)copy.append(...this.children.map(child=>child.cloneNode(true)));
    return copy;
  }
  focus(){this.ownerDocument.activeElement=this;}
  select(){this.selected=[0,this.value.length];}
  setSelectionRange(start,end){this.selected=[start,end];}
  getBoundingClientRect(){const {top,bottom,left,width}=this.rect;return {top,bottom,left,width,right:left+width};}
  // A click on this element: its own handler first, then the document's listeners.
  click(){this.onclick?.({target:this});this.ownerDocument.dispatch("click",{target:this});}
}

export class FakeDocument {
  constructor(){
    this.ids=new Map();this.listeners=new Map();this.activeElement=null;
    this.body=new FakeElement(this,"body");
  }
  register(element){this.ids.set(element.id,element);}
  getElementById(id){return this.ids.get(id)??null;}
  createElement(tagName){return new FakeElement(this,tagName);}
  // An element in the body, so it can be found by id and reached by events.
  add(tagName,id,options){
    const element=new FakeElement(this,tagName,{id,...options});
    this.body.append(element);
    return element;
  }
  addEventListener(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,[]);
    this.listeners.get(type).push(listener);
  }
  dispatch(type,event){for(const listener of this.listeners.get(type)??[])listener(event);}
}

// Installs document and the window globals UI modules read; returns a
// function that puts the originals back.
export function installDom({width=390,height=844,origin="https://miego.example",clipboard}={}) {
  const document=new FakeDocument();
  const windowListeners=new Map();
  const values={
    document,innerWidth:width,innerHeight:height,location:{origin},
    navigator:{clipboard},
    addEventListener(type,listener){
      if(!windowListeners.has(type))windowListeners.set(type,[]);
      windowListeners.get(type).push(listener);
    }
  };
  const saved=Object.keys(values).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
  for(const [name,value] of Object.entries(values))
    Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  const restore=()=>{
    for(const [name,descriptor] of saved){
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
    }
  };
  const dispatchWindow=(type,event={})=>{for(const listener of windowListeners.get(type)??[])listener(event);};
  return {document,restore,dispatchWindow,$:id=>document.getElementById(id)};
}
