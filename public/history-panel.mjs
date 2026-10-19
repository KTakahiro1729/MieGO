import {parseSGF} from "./sgf.mjs";

// The library sheet is a file picker and saved-game list. All board/replay
// controls live on the main board; it never creates a second playing surface.
export function createHistoryPanel({$,gameLibrary,storageError,onSelect=()=>{}}) {
  const recordName=record=>record.source==="sgf"?"SGFから読み込んだ棋譜":
    record.mode==="ai"?"AIと対戦":record.mode==="online"?"友人と対戦":"1台で打つ";
  const recordStatus=record=>record.source==="sgf"?"読み込み済み":
    record.snapshot.status==="finished"?"終局済み":
    record.snapshot.status==="scoring"?"採点中":"対局中";
  const dateLabel=timestamp=>{
    const date=new Date(timestamp);
    return Number.isNaN(date.getTime())?"日時不明":
      date.toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
  };
  function renderHistoryList() {
    const list=$("historyList");list.replaceChildren();
    let records=[];
    try{records=gameLibrary.list();}catch(error){storageError(error);}
    $("historyEmpty").hidden=records.length!==0;
    for(const record of records){
      const item=document.createElement("button");
      item.type="button";item.className="history-list-item";
      const icon=document.createElement("span");icon.className="history-list-icon";
      icon.textContent=record.source==="sgf"?"SGF":record.mode==="online"?"↗":
        record.mode==="ai"?"AI":"●";
      const copy=document.createElement("span");copy.className="history-item-copy";
      const title=document.createElement("span");title.className="history-item-name";
      title.textContent=recordName(record);
      const detail=document.createElement("span");detail.className="history-item-meta";
      detail.textContent=recordStatus(record)+" · "+record.snapshot.moveNumber+"手 · "+dateLabel(record.updatedAt);
      copy.append(title,detail);item.append(icon,copy);
      item.onclick=()=>{
        // Re-read to avoid opening a stale snapshot after another tab updated it.
        const selected=gameLibrary.load(record.id);
        if(!selected) {
          $("historySaveNotice").textContent="棋譜が更新されました。もう一度選んでください。";
          renderHistoryList();
          return;
        }
        onSelect(selected);
      };
      list.append(item);
    }
  }
  function openHistoryPanel() {
    $("gameMenu").open=false;
    $("settingsBackdrop").hidden=false;
    $("settingsPanel").hidden=true;$("modePanel").hidden=true;
    $("historyPanel").hidden=false;
    $("historySaveNotice").textContent="";
    $("historyPanel").scrollTop=0;
    $("settingsToggle").setAttribute("aria-expanded","false");
    renderHistoryList();
    $("closeHistory").focus();
  }
  async function importHistoryFile(file) {
    if(!file)return;
    try {
      if(file.size>512*1024)throw Error("SGFファイルは512KB以内にしてください。");
      const parsed=parseSGF(await file.text());
      const record=gameLibrary.save({mode:"local",snapshot:parsed.snapshot,source:"sgf",
        sgfMeta:parsed.metadata,lastPosition:parsed.snapshot.moves.at(-1)?.position??null});
      onSelect(record);
      // A non-blocking notification is available in the replay controls.
    } catch(error) {
      $("historyPanel").scrollTop=0;
      $("historySaveNotice").textContent="SGFを読み込めません："+error.message;
    } finally{$("historyImportFile").value="";}
  }
  return {renderHistoryList,openHistoryPanel,importHistoryFile};
}
