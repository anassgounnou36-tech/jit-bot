/* Minimal Alchemy smoke: HTTP + optional WS.
   Usage:
     RPC_URL_HTTP=https://eth-mainnet.g.alchemy.com/v2/KEY node scripts/smoke-alchemy.js
     (optional) RPC_URL_WS=wss://eth-mainnet.g.alchemy.com/v2/KEY node scripts/smoke-alchemy.js
*/

const { WebSocket } = require('ws');

async function httpSmoke() {
  const url = process.env.RPC_URL_HTTP;
  if (!url) {
    console.log('HTTP: skipped (RPC_URL_HTTP not set)');
    return;
  }
  const payloads = [
    { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'net_version', params: [] },
    { jsonrpc: '2.0', id: 3, method: 'eth_gasPrice', params: [] },
  ];
  for (const p of payloads) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
    const body = await res.json();
    console.log('HTTP', p.method, JSON.stringify(body).slice(0, 300));
  }
}

async function wsSmoke() {
  const url = process.env.RPC_URL_WS;
  if (!url) {
    console.log('WS: skipped (RPC_URL_WS not set)');
    return;
  }
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS connect timeout')), 15000);
    ws.on('open', () => {
      clearTimeout(t);
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
      console.log('WS subscribed to newHeads');
      setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 10000);
    });
    ws.on('message', (m) => console.log('WS msg', m.toString().slice(0, 200)));
    ws.on('error', (e) => { console.error('WS error', e.message); reject(e); });
    ws.on('close', () => {});
  });
}

(async () => {
  await httpSmoke().catch(e => console.error('HTTP error', e.message));
  await wsSmoke().catch(e => console.error('WS error', e.message));
})();