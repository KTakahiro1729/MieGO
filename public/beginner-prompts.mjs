import { BLACK, sizeOf, handicapOf, komiOf } from "./core.mjs";
import { formatBoardSection } from "./board-text.mjs";
import { shareableReviewUrl } from "./sgf-link.mjs";

// Questions a beginner can paste into any AI chat. Like the forbidden-move
// question they carry a public SGF replay URL at most, never a P2P room URL.
const AS_BEGINNER="私は囲碁を始めたばかりの初心者です。専門用語にはひと言説明を添え、短く、やさしく答えてください。";
const AFTERWARDS="説明のあとで、私が次に試すとよいことを1つだけ教えてください。わからない点はこのあと質問します。";

function ruleLine(game) {
  const handicap=handicapOf(game);
  return "ルール：中国ルール（盤上の石と地の合計で数える）、"+
    (handicap?"置き石"+handicap+"子、コミ"+komiOf(game)+"目＋置き石補正"+handicap+"目":"コミ"+komiOf(game)+"目");
}

export function makeRulesPrompt(game) {
  return [
    AS_BEGINNER,
    "囲碁アプリMieGOで"+sizeOf(game.board)+"路盤を打っています。"+ruleLine(game)+"。",
    "囲碁の基本を順番に教えてください。",
    "1. 石を取るしくみ（呼吸点）",
    "2. 打てない場所（自殺手とコウ）",
    "3. 地とは何か、勝ち負けの数え方",
    "4. いつ対局を終えればよいか（終局とパス）",
    AFTERWARDS
  ].join("\n");
}

/** reviewUrl is optional; a long game may not fit in a URL. */
export function makePositionPrompt(game,reviewUrl=null) {
  const url=reviewUrl===null?null:shareableReviewUrl(reviewUrl);
  const color=game.next===BLACK?"黒":"白";
  const state=game.status==="playing"?"手番："+color+"。"+(game.moveNumber?game.moveNumber+"手目まで打ちました。":"まだ1手も打っていません。"):
    game.status==="scoring"?"いま採点中です。":"対局は終わっています。";
  const ask=game.status==="playing"?
    "この局面について、1. いまどちらが優勢そうか、2. "+color+"が気をつけること、3. 次に考えられる手、を教えてください。":
    "この局面について、どちらがどこを地にしているか、勝敗をどう数えるかを教えてください。";
  return [
    AS_BEGINNER,
    "囲碁アプリMieGOで"+sizeOf(game.board)+"路盤を打っています。"+ruleLine(game)+"。",
    state,
    ask,
    "場所は「上から○行目・左から○列目」で示してください。",
    AFTERWARDS,
    ...(url?["棋譜URL: "+url.href]:[]),
    "",
    formatBoardSection("現在の盤面",game.board)
  ].join("\n");
}
