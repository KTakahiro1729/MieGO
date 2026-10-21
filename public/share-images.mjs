import {
  BLACK,
  WHITE,
  handicapOf,
  komiOf,
  sizeOf
} from "./core.mjs";
import { shareLabels, shareFrameSize, paintShareFrame, buildGameAnimation, loadShareFonts } from "./share-image.mjs";
import { createBoardRenderer } from "./board-renderer.mjs";
import { influence } from "./influence.mjs";
import {
  playStyle,
  reportPlayStyles,
  styleLink,
  styleMoves,
  styleMovesHash
} from "./play-style.mjs";
import { exportSGF } from "./sgf.mjs";
import { stoneMark } from "./player-row.mjs";
import { TEXT } from "./texts.mjs";

export function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// The 画像 part of the share sheet. sharedPosition() is the board the sheet
// works on; stillColoured() tells whether that board now shows ownership.
// playedSides() lists the colours a person played (a COM's style is its setting);
// watchedSides() lists the COMs' colours in a watched game, read and shown but not counted.
export function createShareImages({$,canvas,draw,sharedPosition,stillColoured,ownershipStore,playedSides,watchedSides=()=>[],
                                   appearance:{shownPalette,overlayOn,opacity,boardTheme}}) {
  // Shared images end on the board exactly as drawn (board look, ownership
  // colours, marks and labels come from the canvas itself), set in a card
  // naming the moves, the result, where to play and where it is developed.
  // Both kinds are made when the sheet opens so each choice shows its image.
  const SHARE_KINDS=["still","animation"];
  let shareImageKind="still",shareImageJob=0;
  let shareImages={},sharePreviewUrls=[];
  let frameRenderer=null,frameState=null,frameOwnership=null,shownStyles=[];
  const ANIMATION_SIZE=600;
  const frameCanvas=(width,height)=>Object.assign(document.createElement("canvas"),{width,height});
  function shareImageDetails(animated){
    const {snapshot,metadata,step,gameId}=sharedPosition();
    const total=snapshot.moves.filter(m=>m.position!=="resign").length;
    const result=metadata?.result || (snapshot.status==="finished" ? snapshot.result : null);
    // The legend explains colours only when the image carries them: every
    // animation frame is coloured, a still only what the board now shows.
    const coloured=overlayOn() && (animated || stillColoured());
    return {snapshot,step,gameId,labels:{...shareLabels({step,total,result,animated,
        komi:Number.isFinite(Number(metadata?.komi)) ? Number(metadata.komi) : komiOf(snapshot),
        handicap:handicapOf(snapshot)}),boardSize:sizeOf(snapshot.board),
      theme:boardTheme(),legend:coloured ? {palette:shownPalette(),opacity:opacity()} : null,styles:shownStyles}};
  }
  // 棋風診断 of each person who played, counted (by type only) the first time it is shown.
  function playStyles(){
    const {snapshot,metadata,step,gameId}=sharedPosition();
    try{
      const recall=state=>gameId===null ? null : ownershipStore.recall(gameId,state.board);
      const read=color=>playStyle(snapshot,color,{through:step,recall});
      const styles=playedSides().map(read).filter(Boolean);
      reportPlayStyles(gameId+":"+step+":"+styles.map(s=>s.type).join(","),snapshot,styles);
      const watched=watchedSides().map(read).filter(Boolean).map(style=>({...style,com:true}));
      // The /style page shows each player's あなたらしかった手 from its link's fragment.
      return [...styles,...watched].map(style=>{
        try{
          const picks=styleMoves(snapshot,style.color==="B" ? BLACK : WHITE,style,{through:step,recall});
          return {...style,moves:styleMovesHash(picks,exportSGF({snapshot,sgfMeta:metadata}),style.com)};
        }catch(error){console.warn("Style moves not read",error);return style;}
      });
    }catch(error){console.warn("Play style not read",error);return [];}
  }
  // An animation frame: the replayed position with the ownership recorded for
  // it, or the replay view's quick estimate where none was recorded.
  function renderFrameBoard(state,gameId){
    if(!frameRenderer){
      const board=frameCanvas(ANIMATION_SIZE,ANIMATION_SIZE);
      frameRenderer={board,...createBoardRenderer({canvas:board,getView:()=>({game:frameState,
        boardReview:{display:frameState,ownership:frameOwnership},candidate:null,illegalCandidate:null,
        lastPosition:null,displayedOwnership:null,palette:shownPalette(),opacity:opacity(),
        boardTheme:boardTheme()})})};
    }
    frameState=state;
    frameOwnership=overlayOn() ? ownershipStore.recall(gameId,state.board) ?? influence(state.board) : null;
    frameRenderer.draw();
    return frameRenderer.board;
  }
  async function makeShareImage(kind,job){
    await loadShareFonts();
    draw();
    const animated=kind==="animation";
    const {snapshot,step,gameId,labels}=shareImageDetails(animated);
    if(animated){
      frameRenderer=null;
      const bytes=await buildGameAnimation({snapshot,step,size:ANIMATION_SIZE,
        renderBoard:state=>renderFrameBoard(state,gameId),finalBoard:canvas,createCanvas:frameCanvas,labels,
        onProgress:(i,total)=>{
          if(job!==shareImageJob)throw Error("Superseded");
          shareImages.animation={progress:TEXT.share.progress(i,total)};renderShareImages();
        }});
      return new File([bytes],"miego-moves"+step+".gif",{type:"image/gif"});
    }
    const {width,height}=shareFrameSize(canvas.width);
    const target=frameCanvas(width,height);
    paintShareFrame(target,canvas,labels);
    const blob=await new Promise((resolve,reject)=>
      target.toBlob(b=>b?resolve(b):reject(Error("Canvas export failed")),"image/png"));
    return new File([blob],"miego-move"+step+".png",{type:"image/png"});
  }
  const canShareFile=file=>{
    try{return typeof navigator.share==="function" && !!navigator.canShare?.({files:[file]});}
    catch{return false;}
  };
  function renderShareImages(){
    for(const kind of SHARE_KINDS){
      const entry=shareImages[kind]||{},id=kind==="still"?"Still":"Animation";
      const preview=$("share"+id+"Preview"),status=$("share"+id+"Status");
      preview.hidden=!entry.url;
      if(entry.url && preview.getAttribute("src")!==entry.url)preview.src=entry.url;
      status.hidden=!!entry.url;
      status.textContent=entry.failed?TEXT.share.failedShort:TEXT.common.creating+(entry.progress?" "+entry.progress:"");
    }
    // Saving always works; sharing appears where the device can take the file.
    const file=shareImages[shareImageKind]?.file;
    $("saveImage").disabled=$("shareImage").disabled=!file;
    $("saveImage").textContent=file ? TEXT.share.saveImage :
      shareImages[shareImageKind]?.failed ? TEXT.share.imageFailed : TEXT.share.imageCreating;
    $("shareImage").hidden=!file || !canShareFile(file);
  }
  function clearShareImages(){
    shareImageJob++;shareImages={};
    sharePreviewUrls.forEach(url=>URL.revokeObjectURL(url));sharePreviewUrls=[];
  }
  // The images are made before the tap: sharing must start straight from the
  // tap, and a long game's animation takes a moment to encode.
  // Each player's type in the sheet, opening its /style page in a new tab.
  function renderPlayStyles(){
    // The way to several games stays even when this one has no type yet.
    $("sharePlayStyleNone").hidden=!!shownStyles.length;
    $("sharePlayStyleList").replaceChildren(...shownStyles.map(style=>{
      const button=Object.assign(document.createElement("button"),{type:"button",className:"secondary full described"});
      const name=document.createElement("span"),note=document.createElement("small");
      name.append(stoneMark(style.color==="B" ? BLACK : WHITE),TEXT.share.cardPlayStyle(style.type,TEXT.playStyle.types[style.type].name));
      note.textContent=style.com ? TEXT.playStyle.openPageCom : TEXT.playStyle.openPage;
      button.append(name,note);
      button.onclick=()=>window.open(styleLink(style)+(style.moves ?? ""),"_blank","noopener");
      return button;
    }));
    // Two people played: their 相性診断, Black's type first.
    if(shownStyles.length===2){
      const pair=Object.assign(document.createElement("button"),{type:"button",className:"secondary full",
        textContent:TEXT.playStyle.compat.openFromShare});
      pair.onclick=()=>window.open(styleLink(shownStyles[0],shownStyles[1]),"_blank","noopener");
      $("sharePlayStyleList").append(pair);
    }
  }
  async function prepareShareImages(){
    clearShareImages();
    const job=shareImageJob;
    shownStyles=playStyles();
    renderPlayStyles();
    renderShareImages();
    for(const kind of SHARE_KINDS){
      try{
        const file=await makeShareImage(kind,job);
        if(job!==shareImageJob)return;
        const url=URL.createObjectURL(file);sharePreviewUrls.push(url);
        shareImages[kind]={file,url};
      }catch(error){
        if(job!==shareImageJob)return;
        shareImages[kind]={failed:true};
        $("shareNotice").textContent=TEXT.share.imageError;
      }
      renderShareImages();
    }
  }
  function saveImage(){
    const file=shareImages[shareImageKind]?.file;
    if(!file)return;
    downloadBlob(file,file.name);
    $("shareNotice").textContent=TEXT.share.imageSaved;
  }
  async function shareImage(){
    const file=shareImages[shareImageKind]?.file;
    if(!file || !canShareFile(file))return;
    try{await navigator.share({files:[file]});$("shareNotice").textContent="";}
    catch(error){
      if(error?.name!=="AbortError")$("shareNotice").textContent=TEXT.share.imageShareFailed;
    }
  }
  $("saveImage").onclick=saveImage;
  $("shareImage").onclick=()=>void shareImage();
  document.querySelectorAll('input[name="shareImageKind"]').forEach(input=>{
    input.onchange=e=>{
      if(!e.target.checked)return;
      shareImageKind=e.target.value==="animation"?"animation":"still";
      renderShareImages();
    };
  });
  return {prepare:prepareShareImages,clear:clearShareImages};
}
