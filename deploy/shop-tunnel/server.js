'use strict';

const net = require('net');

const AUTH = process.env.FOT_TUNNEL_AUTH || 'fot:e7Kq9mN2pL4xW8vR';
const shopPort = Number(process.env.LISTEN_SHOP || 4704);
const localPort = Number(process.env.LISTEN_LOCAL || 5000);
const pool = [];

function take() {
  while (pool.length) {
    const sock = pool.shift();
    if (sock && !sock.destroyed && sock.writable) return sock;
  }
  return null;
}

const shopServer = net.createServer((sock) => {
  sock.setKeepAlive(true, 15000);
  sock.setNoDelay(true);
  let acc = Buffer.alloc(0);
  const onData = (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    const nl = acc.indexOf(10);
    if (nl < 0) {
      if (acc.length > 256) sock.destroy();
      return;
    }
    const line = acc.subarray(0, nl).toString('utf8').replace(/\r$/, '').trim();
    sock.off('data', onData);
    const leftover = acc.subarray(nl + 1);
    if (leftover.length) sock.unshift(leftover);
    if (line !== `AUTH ${AUTH}`) {
      sock.end('ERR\n');
      return;
    }
    pool.push(sock);
    const drop = () => {
      const i = pool.indexOf(sock);
      if (i >= 0) pool.splice(i, 1);
    };
    sock.on('close', drop);
    sock.on('error', drop);
  };
  sock.on('data', onData);
  sock.on('error', () => {});
});

shopServer.listen(shopPort, '0.0.0.0', () => {
  console.log(`shop-tunnel waiting on :${shopPort} (pool ready)`);
});

const localServer = net.createServer((client) => {
  const worker = take();
  if (!worker) {
    client.destroy();
    return;
  }
  worker.write('GO\n');
  client.setNoDelay(true);
  worker.setNoDelay(true);
  client.pipe(worker);
  worker.pipe(client);
  const end = () => {
    try { client.destroy(); } catch { /* ignore */ }
    try { worker.destroy(); } catch { /* ignore */ }
  };
  client.on('error', end);
  worker.on('error', end);
  client.on('close', end);
  worker.on('close', end);
});

localServer.listen(localPort, '127.0.0.1', () => {
  console.log(`shop-tunnel local bind 127.0.0.1:${localPort}`);
});
