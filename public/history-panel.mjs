import {parseSGF} from "./sgf.mjs";
import {recordName,recordIcon,recordSummary} from "./history-navigation.mjs";
import {recordThumbnailSvg} from "./board-thumbnail.mjs";
import { TEXT } from "./texts.mjs";

const STAR='<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';
// The library sheet is a file picker and saved-game list. All board/replay
// controls live on the main board; it never creates a second playing surface.
// getThumbnailOverlay(record) gives the kept ownership tint of its final board, or null.
export function createHistoryPanel({$,gameLibrary,storageError,onSelect=()=>{},getBoardTheme=()=>undefined,
                                    getThumbnailOverlay=()=>null}) {
  function favoriteButton(record) {
    const star=document.createElement("button");
    star.type="button";star.className="icon-button history-favorite";star.innerHTML=STAR;
    star.dataset.favoriteId=record.id;
    const on=record.favorite===true,label=on?TEXT.history.favoriteOff:TEXT.history.favoriteOn;
    star.setAttribute("aria-pressed",String(on));
    star.setAttribute("aria-label",label);star.title=label;
    star.onclick=()=>{
      try{gameLibrary.setFavorite(record.id,!on);}catch(error){storageError(error);}
      renderHistoryList();
      $("historyList").querySelector('[data-favorite-id="'+record.id+'"]')?.focus();
    };
    return star;
  }
  function renderHistoryList() {
    const list=$("historyList");list.replaceChildren();
    let records=[];
    try{records=gameLibrary.list();}catch(error){storageError(error);}
    $("historyEmpty").hidden=records.length!==0;
    for(const record of records){
      const item=document.createElement("button");
      item.type="button";item.className="history-list-item";
      const thumb=document.createElement("span");thumb.className="history-thumb";
      try{thumb.innerHTML=recordThumbnailSvg(record,getBoardTheme(),getThumbnailOverlay(record));}catch{}
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
      const row=document.createElement("div");row.className="history-row";
      row.append(item,favoriteButton(record));
      list.append(row);
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
