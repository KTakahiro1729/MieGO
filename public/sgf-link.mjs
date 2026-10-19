import { exportSGF, parseSGF } from "./sgf.mjs";

// A human- and AI-readable 9x9 SGF is carried in the URL query string.
// Keep the uncompressed SGF, rather than inventing a proprietary binary code.
export const MAX_SHARE_URL_LENGTH = 8192;

export function makeReviewUrl(origin, record, step) {
  const sgf=exportSGF(record);
  const {snapshot}=parseSGF(sgf);
  const total=snapshot.moves.length;
  if(!Number.isSafeInteger(step) || step<0 || step>total)
    throw Error("共有する手数が棋譜の範囲外です");
  const url=new URL("/",origin);
  url.searchParams.set("sgf",sgf);
  url.searchParams.set("move",String(step));
  if(url.href.length>MAX_SHARE_URL_LENGTH)
    throw Error("URLが長すぎます。SGFファイルで共有してください");
  return url.href;
}

export function readReviewUrl(input) {
  const url=new URL(input);
  // A live invitation must never be mistaken for a static SGF replay.
  if(url.searchParams.has("room"))return {kind:"room"};
  if(!url.searchParams.has("sgf"))return {kind:"none"};
  if(url.href.length>MAX_SHARE_URL_LENGTH)
    throw Error("棋譜URLが長すぎます（上限8192文字）");
  if(url.searchParams.getAll("sgf").length!==1 ||
     url.searchParams.getAll("move").length>1)throw Error("棋譜URLの項目が重複しています");
  const source=url.searchParams.get("sgf");
  if(!source)throw Error("SGF棋譜が指定されていません");
  const parsed=parseSGF(source);
  const stepValue=url.searchParams.get("move");
  const step=stepValue===null?parsed.snapshot.moves.length:
    /^(0|[1-9][0-9]*)$/.test(stepValue)?Number(stepValue):NaN;
  if(!Number.isSafeInteger(step) || step<0 || step>parsed.snapshot.moves.length)
    throw Error("表示手数が棋譜の範囲外です");
  return {kind:"review",snapshot:parsed.snapshot,step,sgf:source,metadata:parsed.metadata};
}

export function makeAiHandoff(reviewUrl) {
  const url=new URL(reviewUrl);
  const guide=new URL("/ai.md",url.origin);
  return [
    "MieGOの9路盤棋譜URLです。以下のURL仕様に従って解釈・生成できます。",
    "",
    "棋譜URL: "+url.href,
    "",
    "sgf はURLエンコードされた標準SGFの全着手列です。move は表示する手数で、0は初期盤面、省略時は最終局面です。",
    "同じ棋譜の別の局面はsgfを変えずmoveの値を変更して提示できます。",
    "仮想的な別の着手を示すときはSGFの着手列を合法な手順に編集してURLエンコードしてください。",
    "利用者はそのURLをMieGOの別タブで開き、一手ずつ前後に再生できます。",
    "URLを直接参照できなくても、sgfクエリをURLデコードして棋譜を解析できます。",
    "",
    "詳細仕様: "+guide.href
  ].join("\n");
}
