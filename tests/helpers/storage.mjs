import {GameLibrary} from "../../public/game-library.mjs";

// localStorage in memory. Past `limit` characters a write throws like a full
// browser store and leaves the old value in place.
export class MemoryStorage {
  constructor(limit=Infinity){this.items=new Map();this.limit=limit;}
  get length(){return this.items.size;}
  key(i){return [...this.items.keys()][i]??null;}
  getItem(k){return this.items.has(k)?this.items.get(k):null;}
  used(){let n=0;for(const [k,v] of this.items)n+=k.length+v.length;return n;}
  setItem(k,v){
    v=String(v);
    const before=this.items.get(k);
    this.items.set(k,v);
    if(this.used()>this.limit){
      if(before===undefined)this.items.delete(k);else this.items.set(k,before);
      throw Object.assign(new Error("full"),{name:"QuotaExceededError"});
    }
  }
  removeItem(k){this.items.delete(k);}
}

// A game library over MemoryStorage with predictable ids and a clock that
// ticks one second per save, so "latest first" is well defined.
export function testLibrary(limit=Infinity,options) {
  const storage=new MemoryStorage(limit);
  let counter=0,clock=0;
  const lib=new GameLibrary(storage,()=>`game-test-${++counter}`,
    ()=>new Date(Date.UTC(2026,0,1,0,0,++clock)).toISOString(),options);
  return {lib,storage};
}
