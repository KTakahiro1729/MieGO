import { DEFAULT_PALETTE, PALETTE_COLOUR_CHOICES, isPaletteChoice, normalizePalette, showsOwnership, countingPalette, paletteGradient, countingGradient, PALETTE_CUSTOM, COLOUR_KEYS, paletteColours, setCustomColours, setOpacityShape, opacityShape, DEFAULT_OPACITY_SHAPE } from "./territory-view.mjs";
import {
  BOARD_COLOUR_CHOICES,
  BOARD_COLOUR_KEYS,
  BOARD_CUSTOM,
  boardColours,
  boardTheme as boardLook,
  DEFAULT_BOARD_THEME,
  isBoardTheme,
  setCustomBoardColours,
  surfaceCss,
} from "./board-theme.mjs";
import { DEFAULT_LIBERTY_MODE, isLibertyMode } from "./liberty-view.mjs";
import { TEXT } from "./texts.mjs";

// The 設定 sheet's 碁盤 and 地合いの表示 groups: the board look, the colour
// map, its opacity and curve, kept in localStorage, plus the legend and the
// swatches that preview them.
// hidingStones() and isCounting() describe the board on screen; onOverlayOn()
// asks for an estimate when the colours are switched back on.
// Saved choices are a convenience: where storage is blocked or full, the
// sheet still works and starts on the defaults.
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const DEFAULT_OPACITY = .55;
export function createAppearanceSettings({$,canvas,getGame,hidingStones,isCounting,show,draw,onOverlayOn}) {
  let palette = normalizePalette(stored("miego-palette"));
  // The player's own colours and the opacity curve live in territory-view.
  try{setCustomColours(JSON.parse(stored("miego-custom-colours")||"null"));}catch{}
  setOpacityShape(stored("miego-opacity-shape"));
  // The player's own board colours live in board-theme.
  try{setCustomBoardColours(JSON.parse(stored("miego-board-colours")||"null"));}catch{}
  const storedBoardTheme = stored("miego-board");
  let boardTheme = isBoardTheme(storedBoardTheme) ? storedBoardTheme : DEFAULT_BOARD_THEME;
  const storedLiberties = stored("miego-liberties");
  let liberties = isLibertyMode(storedLiberties) ? storedLiberties : DEFAULT_LIBERTY_MODE;
  // つながった石: drawn apart ("off"), joined by a bar ("bridge"), as one shape
  // ("fused"), as one shape that bulges toward its liberties ("breathing"),
  // as squares that bulge toward liberties and dent at opponents ("square"),
  // or by the board's lines, thickened between stones and halfway to liberties ("lines").
  const LINK_MODES=["off","bridge","fused","breathing","square","lines"];
  const storedLink = stored("miego-link-stones");
  let linkStones = LINK_MODES.includes(storedLink) ? storedLink : storedLink==="on" ? "bridge" : "off";
  document.querySelectorAll('input[name="linkStones"]').forEach(input => {
    input.onchange = e => {
      if (!e.target.checked) return;
      linkStones=LINK_MODES.includes(e.target.value)?e.target.value:"off";
      store("miego-link-stones",linkStones);
      draw();
    };
  });
  const storedOpacity = stored("miego-opacity")===null ? NaN : Number(stored("miego-opacity"));
  let opacity = storedOpacity>=0 && storedOpacity<=1 ? storedOpacity : DEFAULT_OPACITY;
  // With the stones hidden the colours are all there is, so "表示しない" falls
  // back to the default map, as counting does.
  const shownPalette = () => hidingStones() ? countingPalette(palette) : palette;
  const overlayOn = () => showsOwnership(shownPalette());

  // Choosing "表示しない" hides the overlay; the next colour map brings it back.
  document.querySelectorAll('input[name="palette"]').forEach(input => {
    input.onchange = e => {
      if (!e.target.checked) return;
      const wasOn=overlayOn();
      palette=isPaletteChoice(e.target.value)?e.target.value:DEFAULT_PALETTE;
      store("miego-palette",palette);
      morphEditing(palette===PALETTE_CUSTOM?"palette":null);
      fillColourInputs();updateGradient();show();
      if(wasOn!==overlayOn())onOverlayOn();
    };
  });
  document.querySelectorAll('input[name="boardTheme"]').forEach(input => {
    input.onchange = e => {
      if (!e.target.checked) return;
      boardTheme=isBoardTheme(e.target.value)?e.target.value:DEFAULT_BOARD_THEME;
      store("miego-board",boardTheme);
      morphEditing(boardTheme===BOARD_CUSTOM?"board":null);
      updateGradient();draw();
    };
  });
  document.querySelectorAll('input[name="liberties"]').forEach(input => {
    input.onchange = e => {
      if (!e.target.checked) return;
      liberties=isLibertyMode(e.target.value)?e.target.value:DEFAULT_LIBERTY_MODE;
      store("miego-liberties",liberties);
      draw();
    };
  });
  // Changing カスタム's colours: the sheet shrinks to that group's swatches
  // until 完了, so the board stays in view. Choosing カスタム opens it;
  // 色を変える opens it again later.
  let editing=null;
  const editGroups={board:"customBoardColours",palette:"customPaletteColours"};
  function setEditing(which){
    const boardChanged=(editing==="board")!==(which==="board");
    editing=which;
    $("settingsPanel").classList.toggle("is-editing",!!which);
    for(const [name,id] of Object.entries(editGroups)){
      $(id).hidden=editing!==name;
      $(id).closest?.(".settings-section")?.classList.toggle("has-editing",editing===name);
    }
    document.body?.classList.toggle("colour-editing",!!which);
    $("editBoardColours").hidden=!!which || boardTheme!==BOARD_CUSTOM;
    $("editPaletteColours").hidden=!!which || palette!==PALETTE_CUSTOM;
    // An empty board gets sample stones while its colours are edited.
    if(boardChanged)draw();
  }
  // Tapped into or out of: the sheet shrinks to the swatches (or grows back)
  // as one shape, so it reads as the same sheet. Still where motion is reduced.
  function morphEditing(which){
    const still=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if(which===editing || still || !document.startViewTransition)setEditing(which);
    else document.startViewTransition(()=>setEditing(which));
  }
  $("editBoardColours").onclick=()=>morphEditing("board");
  $("editPaletteColours").onclick=()=>morphEditing("palette");
  for(const id of Object.values(editGroups))$(id).querySelector?.("[data-done]")?.addEventListener("click",()=>morphEditing(null));
  // Closing the sheet ends the editing, so it opens whole next time.
  for(const id of ["closeSettings","settingsBackdrop"])$(id).addEventListener?.("click",()=>setEditing(null));
  // Each custom colour is a row of swatches that apply at once; only the last
  // button, "＋", opens the device's colour picker, so a stray tap never
  // brings up a dialog. Used by カスタム on the board and on the colour map.
  function colourRow(row,item,choices,pick){
    if(!row.append)return {chips:[],other:{}};
    const label=document.createElement("span");
    label.className="colour-row-label";label.textContent=item;label.setAttribute("aria-hidden","true");
    const chips=choices.map((colour,i)=>{
      const chip=document.createElement("button");
      chip.type="button";chip.className="colour-chip";chip.dataset.colour=colour;
      chip.style.backgroundColor=colour;chip.setAttribute("role","radio");
      chip.setAttribute("aria-label",TEXT.settings.colourChoice(item,i+1));
      chip.onclick=()=>pick(colour);
      return chip;
    });
    const other=document.createElement("label");
    other.className="colour-chip colour-other";other.title=TEXT.settings.otherColour(item);
    const input=document.createElement("input");
    input.type="color";input.setAttribute("aria-label",TEXT.settings.otherColour(item));
    input.oninput=()=>pick(input.value);
    other.append(input);
    row.append(label,...chips,other);
    return {chips,other,input};
  }
  // Marks the chosen swatch; a colour of the player's own shows on "＋".
  function markColourRow({chips,other,input},colour){
    let preset=false;
    for(const chip of chips){
      const on=chip.dataset.colour===colour;
      preset||=on;
      chip.setAttribute("aria-checked",String(on));
    }
    if(input)input.value=colour;
    other.classList?.toggle("is-chosen",!preset);
    if(other.style)other.style.backgroundColor=preset?"":colour;
  }
  const boardRows=Object.fromEntries(BOARD_COLOUR_KEYS.map(key=>[key,
    colourRow($("boardColour-"+key),TEXT.settings.boardColours[key],BOARD_COLOUR_CHOICES[key],colour=>pickBoardColour(key,colour))]));
  function pickBoardColour(key,colour){
    const chosen={...boardColours(BOARD_CUSTOM),[key]:colour};
    if(!setCustomBoardColours(chosen))return;
    store("miego-board-colours",JSON.stringify(chosen));
    updateGradient();draw();
  }
  function markBoardColours(){
    const custom=boardColours(BOARD_CUSTOM);
    for(const key of BOARD_COLOUR_KEYS)markColourRow(boardRows[key],custom[key]);
  }

  // The ramp's dots show the chosen map; カスタム adds a row of swatches per colour.
  const paletteRows=Object.fromEntries(COLOUR_KEYS.map(key=>[key,
    colourRow($("paletteColour-"+key),TEXT.settings.paletteColours[key],PALETTE_COLOUR_CHOICES[key],colour=>pickPaletteColour(key,colour))]));
  function pickPaletteColour(key,colour){
    const chosen={...paletteColours(PALETTE_CUSTOM),[key]:colour};
    if(!setCustomColours(chosen))return;
    store("miego-custom-colours",JSON.stringify(chosen));
    fillColourInputs();updateGradient();show();
  }
  function fillColourInputs(){
    const shown=paletteColours(showsOwnership(palette)?palette:PALETTE_CUSTOM);
    for(const key of COLOUR_KEYS)$("colour-"+key).style.backgroundColor=shown[key];
    setEditing(editing==="palette" && palette!==PALETTE_CUSTOM ? null : editing);
    const custom=paletteColours(PALETTE_CUSTOM);
    for(const key of COLOUR_KEYS)markColourRow(paletteRows[key],custom[key]);
  }
  document.querySelectorAll('input[name="opacityShape"]').forEach(input=>{
    input.onchange=e=>{
      if(!e.target.checked)return;
      store("miego-opacity-shape",setOpacityShape(e.target.value));
      updateGradient();draw();
    };
  });
  $("opacity").oninput=e=>{
    opacity=Number(e.target.value)/100;
    store("miego-opacity",String(opacity));
    $("opacityValue").textContent=e.target.value+"%";
    updateGradient();draw();
  };
  $("resetAppearance").onclick=()=>{
    const wasOn=overlayOn();
    palette=DEFAULT_PALETTE;opacity=DEFAULT_OPACITY;boardTheme=DEFAULT_BOARD_THEME;
    liberties=DEFAULT_LIBERTY_MODE;
    store("miego-liberties",liberties);
    linkStones="off";
    store("miego-link-stones",linkStones);
    store("miego-palette",palette);
    store("miego-opacity",String(opacity));
    store("miego-board",boardTheme);
    store("miego-opacity-shape",setOpacityShape(DEFAULT_OPACITY_SHAPE));
    syncControls();show();
    if(!wasOn)onOverlayOn();
  };
  // The legend, the colour-map swatches and the board frame follow the chosen board.
  // Layers for a strip of the chosen board under an optional colour layer.
  function onBoardStrip(colour){
    const look=boardLook(boardTheme);
    const grid=dir=>"repeating-linear-gradient("+dir+",transparent 0 9px,"+look.line+" 9px 10.5px,transparent 10.5px 20px)";
    const fill="linear-gradient(135deg,"+(look.fill.length>1?look.fill.join(","):look.fill[0]+","+look.fill[0])+")";
    return [colour,grid("90deg"),grid("0deg"),fill].filter(Boolean).join(",");
  }
  function updateGradient(){
    const surface=surfaceCss(boardTheme);
    $("gradient").style.backgroundColor=surface;
    // While counting, the same legend explains the flat area colours instead.
    const counting=isCounting();
    $("gradient").style.backgroundImage=counting?countingGradient(palette,opacity):
      paletteGradient(shownPalette(),opacity);
    $("legendNeutral").hidden=!counting;
    $("ownershipLegend").classList.toggle("overlay-off",!counting && !overlayOn() ||
      getGame().status==="finished" && !counting);
    // Colour and strength mean nothing while the overlay is hidden.
    $("ownershipSettings").classList.toggle("is-off",!showsOwnership(palette));
    for(const input of document.querySelectorAll(".ownership-tuning input"))input.disabled=!showsOwnership(palette);
    // The V and U icons rise as high as the slider lets the colour go.
    const top=17-14*opacity;
    document.querySelector('input[name="opacityShape"][value="V"]+span path')?.setAttribute("d","M3 "+top+" 20 17 37 "+top);
    document.querySelector('input[name="opacityShape"][value="U"]+span path')?.setAttribute("d","M3 "+top+"C10 "+top+" 13 17 20 17S30 "+top+" 37 "+top);
    // The editor's ramp and the colour-map swatches lie on a strip of the
    // chosen board, grid lines and all, at the chosen strength, so every
    // colour is seen as it is on the board.
    $("rampPreview").style.backgroundColor=surface;
    $("rampPreview").style.backgroundImage=onBoardStrip(paletteGradient(showsOwnership(palette)?palette:PALETTE_CUSTOM,opacity));
    document.querySelectorAll(".swatch[data-palette]").forEach(swatch=>{
      const name=swatch.dataset.palette;
      swatch.style.backgroundColor=surface;
      swatch.style.backgroundImage=onBoardStrip(showsOwnership(name)?paletteGradient(name,opacity):null);
    });
    setEditing(editing==="board" && boardTheme!==BOARD_CUSTOM ? null : editing);
    markBoardColours();
    const custom=boardColours(BOARD_CUSTOM),swatch=$("customBoardSwatch");
    swatch.style.setProperty("--sw-board",custom.board);
    swatch.style.setProperty("--sw-line",custom.line);
    swatch.style.setProperty("--sw-black",custom.black);
    swatch.style.setProperty("--sw-white",custom.white);
    const frame=canvas.closest(".board-frame");
    frame?.setAttribute("data-board-theme",boardTheme);
    frame?.style.setProperty("--board-colour",custom.board);
  }
  // The controls start on the remembered choices.
  function check(name,value){
    const radio=document.querySelector('input[name="'+name+'"][value="'+value+'"]');
    if(radio)radio.checked=true;
  }
  function syncControls(){
    check("palette",palette);
    check("boardTheme",boardTheme);
    check("liberties",liberties);
    check("linkStones",linkStones);
    check("opacityShape",opacityShape());
    fillColourInputs();
    $("opacity").value=String(Math.round(opacity*100));
    $("opacityValue").textContent=Math.round(opacity*100)+"%";
    updateGradient();
  }
  return {palette:()=>palette,opacity:()=>opacity,boardTheme:()=>boardTheme,liberties:()=>liberties,linkStones:()=>linkStones,
    editingBoard:()=>editing==="board",
    shownPalette,overlayOn,updateGradient,syncControls};
}
