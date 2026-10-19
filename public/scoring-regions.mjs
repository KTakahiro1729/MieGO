import {SIZE,BLACK,WHITE,areaScore,neighbors} from "./core.mjs";

/** Area-scoring overlay: connected same-color groups AFTER adding owned
 * empty points as provisional stones. Labels count live stones AND area.
 * Dead stones are removed from the effective board, but are kept in the
 * original board for manual review until both players confirm.
 */
export function scoringRegions(state) {
  if(!state || !Array.isArray(state.board) || state.board.length!==SIZE*SIZE)
    throw new Error("9路盤の局面が必要です");
  const dead=new Set(state.dead||[]);
  const effective=state.board.map((stone,i)=>dead.has(i)?0:stone);
  const owned=areaScore(state).owned;
  const filled=owned.map((owner)=>owner===BLACK||owner===WHITE?owner:0);
  const seen=new Set(),regions=[];
  for(let start=0;start<filled.length;start++){
    if(!filled[start]||seen.has(start))continue;
    const color=filled[start],positions=[start];seen.add(start);
    for(let head=0;head<positions.length;head++){
      for(const next of neighbors(positions[head])){
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
    regions.push({color,count:positions.length,stones:stones.length,
      territory:territory.length,position,positions});
  }
  return {filled,regions,owned};
}
