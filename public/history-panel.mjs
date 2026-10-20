import {parseSGF} from "./sgf.mjs";
import {recordName,recordIcon,recordSummary} from "./history-navigation.mjs";
import {recordThumbnailSvg} from "./board-thumbnail.mjs";
import { TEXT } from "./texts.mjs";

// The library sheet is a file picker and saved-game list. All board/replay
// controls live on the main board; it never creates a second playing surface.
export function createHistoryPanel({$,gameLibrary,storageError,onSelect=()=>{},getBoardTheme=()=>undefined}) {
  function renderHistoryList() {
    const list=$("historyList");list.replaceChildren();
    let records=[];
    try{records=gameLibrary.list();}catch(error){storageError(error);}
    $("historyEmpty").hidden=records.length!==0;
    for(const record of records){
      const item=document.createElement("button");
      item.type="button";item.className="history-list-item";
      const thumb=document.createElement("span");thumb.className="history-thumb";
      try{thumb.innerHTML=recordThumbnailSvg(record,getBoardTheme());}catch{}
      const icon=document.createElement("span");icon.className="history-list-icon";
      icon.textContent=recordIcon(record);
      thumb.append(icon);
      const copy=document.createElement("span");copy.className="history-item-copy";
      const title=document.createElement("span");title.className="history-item-name";
      title.textContent=recordName(record);
      const detail=document.createElement("span");detail.className="history-item-meta";
      detail.textContent=recordSummary(record);
      copy.append(title,detail);item.append(thumb,copy);
      item.onclick=()=>{
        // Re-read to avoid opening a stale snapshot after another tab updated it.
        const selected=gameLibrary.load(record.id);
        if(!selected) {
          $("historySaveNotice").textContent=TEXT.history.updated;
          renderHistoryList();
          return;
        }
        onSelect(selected);
      };
      list.append(item);
    }
  }
  // The list is the 履歴 tab of the 新規対戦 sheet; the sheet itself handles opening and focus.
  function showHistory() {
    $("historySaveNotice").textContent="";
    renderHistoryList();
  }
  async function importHistoryFile(file) {
    if(!file)return;
    try {
      if(file.size>512*1024)throw Error(TEXT.history.sgfTooLarge);
      const parsed=parseSGF(await file.text());
      const record=gameLibrary.save({mode:"local",snapshot:parsed.snapshot,source:"sgf",
        sgfMeta:parsed.metadata,lastPosition:parsed.snapshot.moves.at(-1)?.position??null});
      onSelect(record);
      // A non-blocking notification is available in the replay controls.
    } catch(error) {
      $("modePanel").scrollTop=0;
      $("historySaveNotice").textContent=TEXT.history.sgfFailed(error.message);
    } finally{$("historyImportFile").value="";}
  }
  return {renderHistoryList,showHistory,importHistoryFile};
}
