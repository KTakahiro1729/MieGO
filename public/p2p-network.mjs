// Stateless P2P network policy; the WebRTC lifecycle remains in p2p-transport.mjs.
export async function postP2PJson(path,data,fetchRequest=globalThis.fetch) {
  const response=await fetchRequest(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
  let result;
  try {result=await response.json();}
  catch {throw Error("サーバーの応答が不正です");}
  if(!response.ok) {
    const error=Error(result?.error||"通信に失敗しました");
    error.status=response.status;
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
