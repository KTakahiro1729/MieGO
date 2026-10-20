import { isPaletteChoice, normalizePalette, showsOwnership, countingPalette, paletteGradient, countingGradient, PALETTE_CUSTOM, COLOUR_KEYS, paletteColours, setCustomColours, setOpacityShape, opacityShape, DEFAULT_OPACITY_SHAPE } from "./territory-view.mjs";
import { DEFAULT_BOARD_THEME, isBoardTheme, surfaceCss, boardTheme as boardLook } from "./board-theme.mjs";

// The 設定 sheet's 碁盤 and 地合いの表示 groups: the board look, the colour
// map, its opacity and curve, kept in localStorage, plus the legend and the
// swatches that preview them.
// hidingStones() and isCounting() describe the board on screen; onOverlayOn()
// asks for an estimate when the colours are switched back on.
export function createAppearanceSettings({$,canvas,getGame,hidingStones,isCounting,show,draw,onOverlayOn}) {
  let palette = normalizePalette(localStorage.getItem("miego-palette"));
  // The player's own colours and the opacity curve live in territory-view.
  try{setCustomColours(JSON.parse(localStorage.getItem("miego-custom-colours")||"null"));}catch{}
  setOpacityShape(localStorage.getItem("miego-opacity-shape"));
  const storedBoardTheme = localStorage.getItem("miego-board");
  let boardTheme = isBoardTheme(storedBoardTheme) ? storedBoardTheme : DEFAULT_BOARD_THEME;
  const storedOpacity = Number(localStorage.getItem("miego-opacity"));
  let opacity = Number.isFinite(storedOpacity) && storedOpacity>=0 && storedOpacity<=1 && localStorage.getItem("miego-opacity")!==null ? storedOpacity : .55;
  // With the stones hidden the colours are all there is, so "表示しない" falls
  // back to the default map, as counting does.
  const shownPalette = () => hidingStones() ? countingPalette(palette) : palette;
  const overlayOn = () => showsOwnership(shownPalette());

  // Choosing "表示しない" hides the overlay; the next colour map brings it back.
  document.querySelectorAll('input[name="palette"]').forEach(input => {
    input.onchange = e => {
      if (!e.target.checked) return;
      const wasOn=overlayOn();
      palette=isPaletteChoice(e.target.value)?e.target.value:"mono";
      try{localStorage.setItem("miego-palette",palette);}catch{}
      fillColourInputs();updateGradient();show();
      if(wasOn!==overlayOn())onOverlayOn();
    };
  });
  document.querySelectorAll('input[name="boardTheme"]').forEach(input => {
    input.onchange = e => {
      if (!e.target.checked) return;
      boardTheme=isBoardTheme(e.target.value)?e.target.value:DEFAULT_BOARD_THEME;
      try{localStorage.setItem("miego-board",boardTheme);}catch{}
      updateGradient();draw();
    };
  });
  // The colour pickers show the chosen map; editing one turns it into "カスタム".
  function fillColourInputs(){
    const shown=paletteColours(showsOwnership(palette)?palette:PALETTE_CUSTOM);
    for(const key of COLOUR_KEYS)$("colour-"+key).value=shown[key];
  }
  for(const key of COLOUR_KEYS)$("colour-"+key).oninput=()=>{
    const wasOn=overlayOn();
    const chosen=Object.fromEntries(COLOUR_KEYS.map(k=>[k,$("colour-"+k).value]));
    if(!setCustomColours(chosen))return;
    try{localStorage.setItem("miego-custom-colours",JSON.stringify(chosen));}catch{}
    palette=PALETTE_CUSTOM;
    try{localStorage.setItem("miego-palette",palette);}catch{}
    const radio=document.querySelector('input[name="palette"][value="custom"]');
    if(radio)radio.checked=true;
    updateGradient();show();
    if(!wasOn)onOverlayOn();
  };
  document.querySelectorAll('input[name="opacityShape"]').forEach(input=>{
    input.onchange=e=>{
      if(!e.target.checked)return;
      try{localStorage.setItem("miego-opacity-shape",setOpacityShape(e.target.value));}catch{}
      updateGradient();draw();
    };
  });
  $("opacity").oninput=e=>{
    opacity=Number(e.target.value)/100;
    localStorage.setItem("miego-opacity",String(opacity));
    $("opacityValue").textContent=e.target.value+"%";
    updateGradient();draw();
  };
  $("resetAppearance").onclick=()=>{
    const wasOn=overlayOn();
    palette="mono";opacity=.55;boardTheme=DEFAULT_BOARD_THEME;
    localStorage.setItem("miego-palette",palette);
    localStorage.setItem("miego-opacity","0.55");
    localStorage.setItem("miego-board",boardTheme);
    const selected=document.querySelector('input[name="palette"][value="mono"]');
    if(selected)selected.checked=true;
    const selectedBoard=document.querySelector('input[name="boardTheme"][value="'+boardTheme+'"]');
    if(selectedBoard)selectedBoard.checked=true;
    $("opacity").value="55";$("opacityValue").textContent="55%";
    setOpacityShape(DEFAULT_OPACITY_SHAPE);
    try{localStorage.setItem("miego-opacity-shape",DEFAULT_OPACITY_SHAPE);}catch{}
    const shapeRadio=document.querySelector('input[name="opacityShape"][value="'+DEFAULT_OPACITY_SHAPE+'"]');
    if(shapeRadio)shapeRadio.checked=true;
    fillColourInputs();
    updateGradient();show();
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
    canvas.closest(".board-frame")?.setAttribute("data-board-theme",boardTheme);
  }
  // The controls start on the remembered choices.
  function syncControls(){
    const selectedPalette=document.querySelector('input[name="palette"][value="'+palette+'"]');
    if(selectedPalette)selectedPalette.checked=true;
    const selectedBoardTheme=document.querySelector('input[name="boardTheme"][value="'+boardTheme+'"]');
    if(selectedBoardTheme)selectedBoardTheme.checked=true;
    {const shapeRadio=document.querySelector('input[name="opacityShape"][value="'+opacityShape()+'"]');
    if(shapeRadio)shapeRadio.checked=true;}
    fillColourInputs();
    $("opacity").value=String(Math.round(opacity*100));
    $("opacityValue").textContent=Math.round(opacity*100)+"%";
    updateGradient();
  }
  return {palette:()=>palette,opacity:()=>opacity,boardTheme:()=>boardTheme,
    shownPalette,overlayOn,updateGradient,syncControls};
}
