import {
  BLACK,
  WHITE,
  areaScore,
  countingBoard,
  handicapBonusOf,
  isJapanese,
  komiOf,
  neighbors,
  scoringStepOf,
  sizeOf,
} from "./core.mjs";

/** Outline colours of the filled-in prisoners, shared by the board and the アゲハマ counter. */
export const PRISONER_OUTLINE=Object.freeze({black:"#e0a03a",white:"#3aaec4"});
import { TEXT } from "./texts.mjs";

/** Area-scoring overlay: connected same-color groups AFTER adding owned
 * empty points as provisional stones. Labels count live stones AND area.
 * Dead stones are removed from the effective board, but are kept in the
 * original board for manual review until both players confirm. The settle
 * playout's kept fill stones count as stones.
 */
export function scoringRegions(state, {prisonerPoints=null}={}) {
  const SIZE=sizeOf(state.board);
  const effective=countingBoard(state);
  const owned=areaScore(state).owned;
  const filled=owned.map((owner)=>owner===BLACK||owner===WHITE?owner:0);
  const seen=new Set(),regions=[];
  for(let start=0;start<filled.length;start++){
    if(!filled[start]||seen.has(start))continue;
    const color=filled[start],positions=[start];seen.add(start);
    for(let head=0;head<positions.length;head++){
      for(const next of neighbors(positions[head],SIZE)){
        if(filled[next]!==color||seen.has(next))continue;
        seen.add(next);positions.push(next);
      }
    }
    const stones=positions.filter(i=>effective[i]===color);
    const territory=positions.filter(i=>effective[i]===0);
    const visibleTerritory=territory.filter(i=>state.board[i]===0);
    const candidates=visibleTerritory.length?visibleTerritory:
      territory.length?territory:stones;
    const centerX=positions.reduce((n,i)=>n+i%SIZE,0)/positions.length;
    const centerY=positions.reduce((n,i)=>n+Math.floor(i/SIZE),0)/positions.length;
    const position=[...candidates].sort((a,b)=>{
      const da=(a%SIZE-centerX)**2+(Math.floor(a/SIZE)-centerY)**2;
      const db=(b%SIZE-centerX)**2+(Math.floor(b/SIZE)-centerY)**2;
      return da-db||a-b;
    })[0];
    // Japanese labels count territory only; stones on the board score nothing.
    // Once the prisoners are filled in, the label is the territory they leave.
    const count=isJapanese(state)?territory.filter(i=>!prisonerPoints?.has(i)).length:positions.length;
    if(!count && !prisonerPoints)continue;
    regions.push({color,count,stones:stones.length,
      territory:territory.length,position,positions});
  }
  return {filled,regions,owned};
}

/** One line that adds up: each side's board count plus what is added to it. */
export function scoreBreakdown(state) {
  const rows=scoreRows(state);
  return TEXT.scoring.breakdown(rows.black,rows.white);
}

/** Japanese counting after the dead stones are agreed (or a finished count). */
export const prisonersFilled=state=>isJapanese(state) &&
  (scoringStepOf(state)==="count" || state.status==="finished" && !state.result?.endsWith("+R"));

/** The scoreboard rows: board count (area, or territory under Japanese
 * rules), what is added to it, and the total. Once the prisoners fill
 * territory, each side's count is the territory left, plus komi for White;
 * the difference is the same as territory plus prisoners. */
export function scoreRows(state) {
  const score=areaScore(state),komi=komiOf(state),bonus=handicapBonusOf(state);
  const japanese=isJapanese(state),filled=prisonersFilled(state);
  const row=(color,total)=>{
    const prisoners=japanese?score.prisoners[color]:0;
    const extra=color==="white"?komi+bonus:0;
    if(filled){
      const other=color==="black"?"white":"black";
      const area=score.territory[color]-score.prisoners[other];
      return {area,detail:TEXT.scoring.detail(area,{komi:color==="white"?komi:null,
        bonus:color==="white"?bonus:0}),total:area+extra};
    }
    const area=total-prisoners-extra;
    return {area,detail:TEXT.scoring.detail(area,{prisoners:japanese?prisoners:null,
      komi:color==="white"?komi:null,bonus:color==="white"?bonus:0}),total};
  };
  return {
    black:row("black",score.black),
    white:row("white",score.white),
    leader:score.difference>0?"black":score.difference<0?"white":null
  };
}

/**
 * 日本式の整地: each side's prisoners go back into the territory of the side
 * they came from (White stones Black took fill White's territory, and the
 * other way round), packed as one compact block per region where possible.
 * This is the second counting step, after the dead stones are agreed. Returns the filled points per prisoner colour; a side with more
 * prisoners than visible territory fills what there is.
 */
export function prisonerFill(state, {avoid=null}={}) {
  if(!prisonersFilled(state))return {black:[],white:[]};
  const score=areaScore(state),size=sizeOf(state.board),board=countingBoard(state);
  const regions=scoringRegions(state).regions;
  // The dead stones are off the board by now; kept playout stones stay clear.
  const free=i=>score.owned[i] && !avoid?.has(i);
  const fill=(color,count)=>{
    const placed=[];
    // Largest territory first; each block grows from the region point farthest
    // from its count label, always next to points already filled.
    const own=regions.filter(r=>r.color===color)
      .map(r=>r.positions.filter(i=>!board[i]).filter(free))
      .filter(points=>points.length).sort((a,b)=>b.length-a.length);
    for(const points of own){
      if(placed.length>=count)break;
      const inRegion=new Set(points),label=regions.find(r=>r.positions.includes(points[0]))?.position;
      const dist=(a,b)=>(a%size-b%size)**2+(Math.floor(a/size)-Math.floor(b/size))**2;
      const seed=Number.isInteger(label)?points.reduce((best,p)=>dist(p,label)>dist(best,label)?p:best,points[0]):points[0];
      const taken=new Set([seed]),frontier=new Set();placed.push(seed);
      const grow=p=>{for(const n of neighbors(p,size))if(inRegion.has(n)&&!taken.has(n))frontier.add(n);};
      grow(seed);
      while(placed.length<count && frontier.size){
        const next=[...frontier].sort((a,b)=>dist(a,seed)-dist(b,seed)||a-b)[0];
        frontier.delete(next);taken.add(next);placed.push(next);grow(next);
      }
      // A region of several separate empty areas continues from its next area.
      for(const p of points){
        if(placed.length>=count)break;
        if(taken.has(p))continue;
        taken.add(p);placed.push(p);grow(p);
        while(placed.length<count && frontier.size){
          const next=[...frontier].sort((a,b)=>dist(a,p)-dist(b,p)||a-b)[0];
          frontier.delete(next);taken.add(next);placed.push(next);grow(next);
        }
      }
    }
    return placed.slice(0,count).sort((a,b)=>a-b);
  };
  // Black's prisoners are White stones, so they fill White's territory.
  return {white:fill(WHITE,score.prisoners.black),black:fill(BLACK,score.prisoners.white)};
}
