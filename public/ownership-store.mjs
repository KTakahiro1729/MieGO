import { BOARD_SIZES, boardHash } from "./core.mjs";
import { TEXT } from "./texts.mjs";

// The ownership estimate shown for each position of a game, kept so a shared
// animation can colour every move as it looked while playing. Values are
// stored as signed bytes (−127…127) in base64: one byte per point.
const POINTS = new Set(BOARD_SIZES.map(size=>size*size));
const PREFIX = "miego:ownership:v1:";

export function encodeOwnership(values) {
  if(!Array.isArray(values) || !POINTS.has(values.length) ||
     !values.every(v=>Number.isFinite(v)))throw Error(TEXT.rules.badOwnership);
  const bytes=values.map(v=>Math.round(Math.max(-1,Math.min(1,v))*127)&255);
  return btoa(String.fromCharCode(...bytes));
}
export function decodeOwnership(text) {
  try {
    const raw=atob(text);
    if(!POINTS.has(raw.length))return null;
    return [...raw].map(c=>{const b=c.charCodeAt(0);return (b>127?b-256:b)/127;});
  } catch { return null; }
}

// What is kept: every position of the current game, and one position (the
// final board, the thumbnail's) of every other saved game. Positions computed
// while replaying another game stay in memory for this page only.
const MEMORY_LIMIT = 1500;

export class OwnershipStore {
  /** write(key,value) stores a value; the game library's write makes room when storage is full. */
  constructor(storage, {write=(key,value)=>storage.setItem(key,value)}={}) {
    this.storage=storage;
    this.write=write;
    // Positions seen before the game had a saved id, replayed positions, and a
    // fallback when storage is full or unavailable.
    this.memory=new Map();
    this.cached=null;
  }
  read(gameId) {
    if(!gameId)return {};
    if(this.cached?.id===gameId)return this.cached.entries;
    let entries={};
    try {
      const value=JSON.parse(this.storage.getItem(PREFIX+gameId)||"{}");
      if(value && typeof value==="object" && !Array.isArray(value))entries=value;
    } catch {}
    this.cached={id:gameId,entries};
    return entries;
  }
  /** Keeps a position for this page only. */
  keep(board,values) {
    if(values?.length!==board.length)throw Error(TEXT.rules.ownershipMismatch);
    const hash=boardHash(board),encoded=encodeOwnership(values);
    this.memory.delete(hash);this.memory.set(hash,encoded);
    if(this.memory.size>MEMORY_LIMIT)this.memory.delete(this.memory.keys().next().value);
    return {hash,encoded};
  }
  /** Keeps a position in memory and in the game's saved entries. */
  remember(gameId,board,values) {
    const {hash,encoded}=this.keep(board,values);
    if(!gameId)return;
    const entries=this.read(gameId);
    entries[hash]=encoded;
    try { this.write(PREFIX+gameId,JSON.stringify(entries)); } catch {}
  }
  recall(gameId,board) {
    const hash=boardHash(board);
    const encoded=this.read(gameId)[hash] ?? this.memory.get(hash);
    const values=typeof encoded==="string" ? decodeOwnership(encoded) : null;
    return values?.length===board.length ? values : null;
  }
  forget(gameId) {
    if(this.cached?.id===gameId)this.cached=null;
    try { this.storage.removeItem(PREFIX+gameId); } catch {}
  }
  /** Every game but the current one keeps only its final board's estimate;
   * entries of games no longer saved are removed. finalBoards: id -> board. */
  compact(currentId,finalBoards) {
    const ids=[];
    for(let i=0;i<this.storage.length;i++){
      const key=this.storage.key(i);
      if(key?.startsWith(PREFIX))ids.push(key.slice(PREFIX.length));
    }
    for(const id of ids){
      if(id===currentId)continue;
      const board=finalBoards.get(id);
      const entries=board ? this.read(id) : {};
      const hash=board ? boardHash(board) : null;
      if(!hash || typeof entries[hash]!=="string"){this.forget(id);continue;}
      if(Object.keys(entries).length===1)continue;
      const kept={[hash]:entries[hash]};
      this.cached={id,entries:kept};
      try { this.storage.setItem(PREFIX+id,JSON.stringify(kept)); } catch { this.forget(id); }
    }
  }
}
