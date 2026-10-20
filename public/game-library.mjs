import { parseGameSnapshot } from "./mode-state.mjs";
import {readCom} from "./ai-characters.mjs";
import { TEXT } from "./texts.mjs";
import { UserError } from "./user-error.mjs";

const PREFIX="miego:game:v1:";
const ACTIVE="miego:active:v1:";
const MIGRATED="miego:library:migrated:v1";
const MODES=new Set(["local","ai","online"]);
const ROOM_RE=/^[a-f0-9]{32}$/;
// No single MieGO value comes near this; a larger one is not worth emptying the library for.
const MAX_EVICTING_VALUE=1_000_000;

/** The browser's storage is full (names differ between engines). */
export function isQuotaError(error) {
  return error?.name==="QuotaExceededError" || error?.name==="NS_ERROR_DOM_QUOTA_REACHED" ||
    error?.code===22 || error?.code===1014;
}

/** Both COMs of a watched game, or null when they cannot be read. */
export function cleanWatchAi(value) {
  if(!value?.black || !value?.white)return null;
  return {black:readCom(value.black),white:readCom(value.white)};
}
export class GameLibrary {
  /** onRemove(record) runs after a game is deleted; keep() names games that must stay. */
  constructor(storage, createId=()=>crypto.randomUUID(), now=()=>new Date().toISOString(),
              {onRemove=()=>{},keep=()=>[]}={}) {
    this.storage=storage;
    this.createId=createId;
    this.now=now;
    this.onRemove=onRemove;
    this.keep=keep;
  }
  load(id) {
    if(typeof id!=="string" || !/^[a-zA-Z0-9-]{8,100}$/.test(id))return null;
    let record;
    try { record=JSON.parse(this.storage.getItem(PREFIX+id)); } catch { return null; }
    return record?.version===1 && record.id===id && MODES.has(record.mode) &&
      parseGameSnapshot(JSON.stringify(record.snapshot)) ? record : null;
  }
  list() {
    const results=[];
    for(let i=0;i<this.storage.length;i++){
      const key=this.storage.key(i);
      if(!key?.startsWith(PREFIX))continue;
      const record=this.load(key.slice(PREFIX.length));
      if(record)results.push(record);
    }
    const time=value=>typeof value==="string"?value:"";
    return results.sort((a,b)=>time(b.updatedAt).localeCompare(time(a.updatedAt))||
      time(b.createdAt).localeCompare(time(a.createdAt)));
  }
  active(mode) {
    if(!["local","ai"].includes(mode))return null;
    const r=this.load(this.storage.getItem(ACTIVE+mode));
    return r?.mode===mode ? r : null;
  }
  setActive(mode,id) {
    const record=this.load(id);
    if(!record || record.mode!==mode || !["local","ai"].includes(mode))throw new UserError(TEXT.history.recordMissing);
    this.storage.setItem(ACTIVE+mode,id);
  }
  /** Stores a value; when the storage is full, the least recently updated
   * games that are neither favourites, active nor kept make room, oldest first. */
  write(key,value,keep=[]) {
    for(;;) {
      try { this.storage.setItem(key,value); return; }
      catch(error) {
        if(!isQuotaError(error) || String(value).length>MAX_EVICTING_VALUE || !this.evictOldest(keep))throw error;
      }
    }
  }
  evictOldest(keep=[]) {
    const protect=new Set([...keep,...this.keep(),
      ...["local","ai"].map(mode=>this.storage.getItem(ACTIVE+mode))]);
    const victim=this.list().filter(record=>!record.favorite && !protect.has(record.id)).at(-1);
    if(!victim)return false;
    this.remove(victim.id);
    return true;
  }
  remove(id) {
    const record=this.load(id);
    if(!record)return false;
    this.storage.removeItem(PREFIX+id);
    for(const mode of ["local","ai"])
      if(this.storage.getItem(ACTIVE+mode)===id)this.storage.removeItem(ACTIVE+mode);
    this.onRemove(record);
    return true;
  }
  /** Favourites are never deleted to make room. Marking one is not an edit:
   * neither its order nor its revision changes. */
  setFavorite(id,favorite) {
    const record=this.load(id);
    if(!record)throw new UserError(TEXT.history.recordMissing);
    const updated={...record,favorite:favorite===true};
    this.write(PREFIX+id,JSON.stringify(updated),[id]);
    return updated;
  }
  save({id=null,mode,snapshot,roomId=null,lastPosition=null,humanColor=1,
        aiCom=null,aiStrength="strong",invasion=50,reinforcement=50,seat=null,source="played",sgfMeta=null,watch=false,watchAi=null},expectedRevision=null) {
    const previous=id===null?null:this.load(id);
    // Nothing that cannot be read back is written.
    if(!MODES.has(mode) || !parseGameSnapshot(JSON.stringify(snapshot)) ||
       (mode==="online" && !ROOM_RE.test(roomId||"")) || (previous && previous.mode!==mode))
      throw Error("Record would not read back");
    if(id!==null && !previous)throw new UserError(TEXT.history.recordMissing);
    if(previous && expectedRevision!==null && previous.revision!==expectedRevision)
      throw new UserError(TEXT.history.otherTab);
    const timestamp=this.now();
    const com=readCom(aiCom ?? {strength:aiStrength,invasion,reinforcement});
    const result={
      version:1,id:previous?.id||this.createId(),mode,
      roomId:mode==="online"?roomId:null,
      createdAt:previous?.createdAt||timestamp,updatedAt:timestamp,
      revision:(previous?.revision||0)+1,
      favorite:previous?.favorite===true,
      snapshot:JSON.parse(JSON.stringify(snapshot)),
      lastPosition:Number.isInteger(lastPosition)?lastPosition:null,
      humanColor:humanColor===-1?-1:1,
      // The COM: a character, or カスタム with its own strength and style.
      // Records written before strength levels existed played at full policy.
      aiCom:com,
      // The fields from before characters, for older copies of the app.
      aiStrength:com.strength,
      invasion:com.invasion,
      // 守る was 補強 重視.
      reinforcement:100-com.stance,
      // COM同士: the AI plays both colours and the player only watches.
      watch:mode==="ai" && watch===true,
      // Each colour's COM in a watched game: strength and personality.
      watchAi:mode==="ai" && watch===true ? cleanWatchAi(watchAi) : null,
      seat:mode==="online"?(seat==="guest"?"guest":seat==="host"?"host":null):null,
      source:previous?.source==="sgf" || previous?.source==="variation"?previous.source:
        source==="sgf" || source==="variation"?source:"played",
      sgfMeta:previous?.sgfMeta||((source==="sgf" && sgfMeta)?{
        komi:String(sgfMeta.komi??"7.5"),rules:String(sgfMeta.rules??"Chinese"),
        result:sgfMeta.result?String(sgfMeta.result):null,
        blackName:sgfMeta.blackName?String(sgfMeta.blackName):null,
        whiteName:sgfMeta.whiteName?String(sgfMeta.whiteName):null
      }:null)
    };
    this.write(PREFIX+result.id,JSON.stringify(result),[result.id]);
    return result;
  }
  migrateLegacy() {
    if(this.storage.getItem(MIGRATED)==="1")return;
    let settings={};
    try {settings=JSON.parse(this.storage.getItem("miego-local-settings")||"{}")||{};}catch{}
    for(const mode of ["local","ai"]){
      if(this.active(mode))continue;
      const raw=this.storage.getItem(mode==="local"?"miego-game-local":"miego-game-ai") ||
        (mode==="local"?this.storage.getItem("miego-local"):null);
      const snapshot=parseGameSnapshot(raw);
      if(!snapshot)continue;
      const record=this.save({mode,snapshot,humanColor:settings.humanColor,
        invasion:settings.invasion,reinforcement:settings.reinforcement});
      this.setActive(mode,record.id);
    }
    // Retain the original keys so migration never destroys the user's data.
    this.storage.setItem(MIGRATED,"1");
  }
}
