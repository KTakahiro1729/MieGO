// 最強 has its own worker and network (about 100 MB, 9路 or larger boards),
// started only once a game against it is under way. If it cannot load, the
// COM plays on with the small network instead.
import { strongNetworkFor } from "./strong-networks.mjs";
import { TEXT } from "./texts.mjs";

// Behind by this many points, 最強 reads one or two moves ahead.
const STRONG_READ = {one:2,two:6};

/**
 * One worker per network, kept for the page's lifetime. `boardSize()` picks the
 * network of the running game; the callbacks hear about that network only,
 * except for its readings and moves, which answer the move asked for.
 */
export function createStrongWorkers({boardSize, onProgress, onReady, onFailed, onReading, onMove,
  createWorker = url => new Worker(url,{type:"module"})}) {
  const nets = {};
  const current = () => {
    const key=strongNetworkFor(boardSize());
    return nets[key] ??= {key,worker:null,state:"idle",progress:0};
  };
  function start(net=current()) {
    if(net.worker || net.state==="failed")return;
    net.state="loading";net.progress=0;
    net.worker=createWorker("/katago-worker.bundle.mjs?net="+net.key);
    net.worker.onerror=e=>fail(net,e.message || "worker startup error");
    net.worker.onmessage=event=>receive(net,event.data);
  }
  function fail(net, reason) {
    console.warn("Strongest ("+net.key+") network unavailable; the COM plays with the small network:",reason);
    net.state="failed";
    net.worker?.terminate();net.worker=null;
    if(net===current())onFailed();
  }
  function receive(net, result) {
    if(result?.kind==="progress") {
      net.progress=result.total>0?Math.floor(100*result.loaded/result.total):0;
      if(net===current())onProgress(net.progress);
      return;
    }
    if(result?.kind==="availability") {
      if(!result.available){fail(net,result.error || TEXT.analysis.initFailed);return;}
      net.state="ready";
      if(net===current())onReady();
      return;
    }
    if(result?.kind==="reading"){onReading(result);return;}
    if(result?.kind==="move") {
      if(result.error){fail(net,result.error);return;}
      onMove(result);
    }
  }
  const requestMove = (net, id, state) => net.worker.postMessage({id,kind:"move",state,read:STRONG_READ});
  return {current,requestMove,start};
}
