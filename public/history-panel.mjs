import {SIZE,BLACK} from "./core.mjs";
import {parseSGF,exportSGF,replaySteps} from "./sgf.mjs";
import {recordName,recordIcon,recordSummary,readOnlyHint,navigationState} from "./history-navigation.mjs";

// Saved-record presentation and import/export. Live match mutations stay in app.mjs.
export function createHistoryPanel({$,gameLibrary,storageError}) {
  let selection=null,step=0;
  function drawHistoryBoard(record) {
    const canvas=$("historyBoard"), ctx=canvas.getContext("2d"),d=canvas.width;
    const gap=d/(SIZE+1),pad=gap;
    ctx.fillStyle="#e5c58c";ctx.fillRect(0,0,d,d);
    ctx.lineWidth=1.5;ctx.strokeStyle="#6c5638";
    for(let i=0;i<SIZE;i++){
      const p=pad+i*gap;
      ctx.beginPath();ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);
      ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);
      ctx.moveTo(p,pad);ctx.lineTo(p,d-pad);ctx.stroke();
    }
    for(const [x,y] of [[2,2],[6,2],[4,4],[2,6],[6,6]]){
      ctx.beginPath();ctx.arc(pad+x*gap,pad+y*gap,2.5,0,Math.PI*2);
      ctx.fillStyle="#755d3a";ctx.fill();
    }
    record.snapshot.board.forEach((stone,i)=>{
      if(!stone)return;
      const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
      ctx.beginPath();ctx.arc(x,y,gap*.44,0,Math.PI*2);
      ctx.fillStyle=stone===BLACK?"#161b20":"#faf8f3";
      ctx.strokeStyle=stone===BLACK?"#080a0a":"#88857c";
      ctx.lineWidth=1.3;ctx.fill();ctx.stroke();
    });
  }
  function renderHistoryList() {
    selection=null;step=0;
    $("historyDetail").hidden=true;$("historyList").hidden=false;
    $("historyPanel").scrollTop=0;
    const list=$("historyList");list.replaceChildren();
    let records=[];
    try{records=gameLibrary.list();}catch(error){storageError(error);}
    $("historyEmpty").hidden=records.length!==0;
    for(const record of records){
      const item=document.createElement("button");item.type="button";item.className="history-list-item";
      const icon=document.createElement("span");icon.className="history-list-icon";
      icon.textContent=recordIcon(record);
      const copy=document.createElement("span");copy.className="history-item-copy";
      const title=document.createElement("span");title.className="history-item-name";
      title.textContent=recordName(record);
      const desc=document.createElement("span");desc.className="history-item-meta";
      desc.textContent=recordSummary(record);
      copy.append(title,desc);item.append(icon,copy);
      item.onclick=()=>showHistoryRecord(record.id);
      list.append(item);
    }
  }
  function updateHistoryPosition() {
    const record=selection;
    if(!record)return;
    const navigation=navigationState(record,step);
    step=navigation.step;
    const count=navigation.count;
    $("historyStepLabel").textContent=step+" / "+count;
    $("historyStepRange").max=String(count);
    $("historyStepRange").value=String(step);
    $("historyFirst").disabled=navigation.firstDisabled;
    $("historyPrevious").disabled=navigation.firstDisabled;
    $("historyNext").disabled=navigation.lastDisabled;
    $("historyLast").disabled=navigation.lastDisabled;
    $("historyResume").hidden=!navigation.resumable;
    try {
      const state=replaySteps(record.snapshot,step);
      drawHistoryBoard({snapshot:state});
      $("historyBranch").disabled=false;
      $("historyActionNotice").textContent="";
    } catch(error) {
      $("historyBranch").disabled=true;
      $("historyResume").hidden=true;
      $("historyActionNotice").textContent="棋譜を再生できません："+error.message;
    }
  }
  function setHistoryStep(value){
    step=Number(value);
    updateHistoryPosition();
  }
  function showHistoryRecord(id) {
    let record=null;
    try{record=gameLibrary.load(id);}catch(error){storageError(error);return;}
    if(!record)return;
    selection=record;step=record.snapshot.moves.length;
    $("historyList").hidden=true;$("historyEmpty").hidden=true;
    $("historyDetail").hidden=false;
    $("historyPanel").scrollTop=0;
    $("historyActionNotice").textContent="";
    $("historySelectionName").textContent=recordName(record);
    $("historyMeta").textContent=recordSummary(record,true);
    $("historyReadOnlyHint").textContent=readOnlyHint(record);
    updateHistoryPosition();
    $("historyBack").focus();
  }
  function openHistoryPanel() {
    $("gameMenu").open=false;
    $("settingsBackdrop").hidden=false;
    $("settingsPanel").hidden=true;$("modePanel").hidden=true;
    $("historyPanel").hidden=false;
    $("historyActionNotice").textContent="";
    $("historyPanel").scrollTop=0;
    $("settingsToggle").setAttribute("aria-expanded","false");
    renderHistoryList();
    $("closeHistory").focus();
  }
  async function importHistoryFile(file) {
    if(!file)return;
    try{
      if(file.size>512*1024)throw Error("SGFファイルは512KB以内にしてください。");
      const parsed=parseSGF(await file.text());
      const record=gameLibrary.save({mode:"local",snapshot:parsed.snapshot,source:"sgf",sgfMeta:parsed.metadata,
        lastPosition:parsed.snapshot.moves.at(-1)?.position??null});
      // Import does not change the active game or its board.
      renderHistoryList();showHistoryRecord(record.id);
      $("historySaveNotice").textContent=parsed.variationsIgnored?
        "SGFの分岐は最初の変化だけ読み込みました。":"SGFを保存しました。";
    }catch(error){
      $("historyPanel").scrollTop=0;
      $("historySaveNotice").textContent="SGFを読み込めません："+error.message;
    }finally{$("historyImportFile").value="";}
  }
  function exportHistorySGF() {
    if(!selection)return;
    try{
      const text=exportSGF(selection);
      const blob=new Blob([text],{type:"application/x-go-sgf;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");link.href=url;
      link.download="miego-"+selection.id+".sgf";
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      $("historyActionNotice").textContent="SGFを書き出しました。";
    }catch(error){$("historyActionNotice").textContent="SGFの書き出しに失敗："+error.message;}
  }
    return {
    get selection(){return selection;},
    get step(){return step;},
    renderHistoryList,updateHistoryPosition,setHistoryStep,showHistoryRecord,
    openHistoryPanel,importHistoryFile,exportHistorySGF
  };
}
