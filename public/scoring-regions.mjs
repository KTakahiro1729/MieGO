import {BLACK,WHITE,areaScore,neighbors,isBoardSize,sizeOf,komiOf,handicapBonusOf,isJapanese} from "./core.mjs";
import { TEXT } from "./texts.mjs";

/** Area-scoring overlay: connected same-color groups AFTER adding owned
 * empty points as provisional stones. Labels count live stones AND area.
 * Dead stones are removed from the effective board, but are kept in the
 * original board for manual review until both players confirm.
 */
export function scoringRegions(state) {
  if(!state || !Array.isArray(state.board) || !isBoardSize(Math.sqrt(state.board.length)))
    throw new Error(TEXT.rules.needsSizedBoard);
  const SIZE=sizeOf(state.board);
  const dead=new Set(state.dead||[]);
  const effective=state.board.map((stone,i)=>dead.has(i)?0:stone);
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
    const count=isJapanese(state)?territory.length:positions.length;
    if(!count)continue;
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

/** The scoreboard rows: board count (area, or territory under Japanese
 * rules), what is added to it, and the total. */
export function scoreRows(state) {
  const score=areaScore(state),komi=komiOf(state),bonus=handicapBonusOf(state);
  const japanese=isJapanese(state);
  const row=(color,total)=>{
    const prisoners=japanese?score.prisoners[color]:0;
    const extra=color==="white"?komi+bonus:0;
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
