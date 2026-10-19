import { SIZE, boardHash } from "./core.mjs";

// The ownership estimate shown for each position of a game, kept so a shared
// animation can colour every move as it looked while playing. Values are
// stored as signed bytes (−127…127) in base64: 81 bytes per position.
const PREFIX = "miego:ownership:v1:";

export function encodeOwnership(values) {
  if(!Array.isArray(values) || values.length!==SIZE*SIZE ||
     !values.every(v=>Number.isFinite(v)))throw Error("地合いデータが不正です");
  const bytes=values.map(v=>Math.round(Math.max(-1,Math.min(1,v))*127)&255);
  return btoa(String.fromCharCode(...bytes));
}
export function decodeOwnership(text) {
  try {
    const raw=atob(text);
    if(raw.length!==SIZE*SIZE)return null;
    return [...raw].map(c=>{const b=c.charCodeAt(0);return (b>127?b-256:b)/127;});
  } catch { return null; }
}

export class OwnershipStore {
  constructor(storage) {
    this.storage=storage;
    // Positions seen before the game had a saved id, and a fallback when
    // storage is full or unavailable.
    this.memory=new Map();
  }
  read(gameId) {
    if(!gameId)return {};
    try {
      const value=JSON.parse(this.storage.getItem(PREFIX+gameId)||"{}");
      return value && typeof value==="object" && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  remember(gameId,board,values) {
    const hash=boardHash(board),encoded=encodeOwnership(values);
    this.memory.set(hash,encoded);
    if(!gameId)return;
    const entries=this.read(gameId);
    entries[hash]=encoded;
    try { this.storage.setItem(PREFIX+gameId,JSON.stringify(entries)); } catch {}
  }
  recall(gameId,board) {
    const hash=boardHash(board);
    const encoded=this.read(gameId)[hash] ?? this.memory.get(hash);
    return typeof encoded==="string" ? decodeOwnership(encoded) : null;
  }
}
