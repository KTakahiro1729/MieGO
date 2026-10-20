import { TEXT } from "./texts.mjs";
import { UserError } from "./user-error.mjs";
// Stateless P2P network policy; the WebRTC lifecycle remains in p2p-transport.mjs.
// The server's error text is for logs; its code picks what the player is told to do.
const SERVER_ERRORS={
  verification:TEXT.online.verifyFailed,
  create_failed:TEXT.online.createFailed,
  room_gone:TEXT.online.roomGone,
  rate_limited:TEXT.online.rateLimited,
  invalid_invitation:TEXT.online.badInvite,
  session_expired:TEXT.online.sessionExpired,
};
export async function postP2PJson(path,data,fetchRequest=globalThis.fetch) {
  let response,result;
  try {
    response=await fetchRequest(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
    result=await response.json();
  }
  catch {throw new UserError(TEXT.online.requestFailed);}
  if(!response.ok) {
    const error=new UserError(SERVER_ERRORS[result?.code]||TEXT.online.requestFailed);
    error.status=response.status;error.serverError=result?.error;
    throw error;
  }
  return result;
}

export function reconnectDelay(attempt) {
  return Math.min(30000,1000*2**Math.min(attempt,5));
}

export function isTerminalTicketFailure(status) {
  return [401,403,404,410].includes(status);
}

export function signalingUrl({protocol,host},room,ticket) {
  const scheme=protocol==="https:"?"wss:":"ws:";
  return scheme+"//"+host+"/api/rooms/"+room+"/ws?ticket="+encodeURIComponent(ticket);
}
