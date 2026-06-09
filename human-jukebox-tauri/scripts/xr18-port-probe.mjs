import dgram from 'dgram';

const mixerIp = process.env.XR18_IP || '192.168.10.70';
const bindIp = process.env.XR18_BIND_IP || '192.168.10.194';
const ports = [10023, 10024];

function oscStr(s) {
  const n = Math.ceil((s.length + 1) / 4) * 4;
  const b = Buffer.alloc(n, 0);
  b.write(s, 'ascii');
  return b;
}

function msg(addr) {
  return Buffer.concat([oscStr(addr), oscStr(',')]);
}

for (const p of ports) {
  const sock = dgram.createSocket('udp4');
  let count = 0;

  sock.on('message', (buf, rinfo) => {
    count++;
    if (count <= 3) {
      console.log(`[port ${p}] recv ${buf.length} bytes from ${rinfo.address}:${rinfo.port}`);
    }
  });

  sock.on('error', (e) => {
    console.log(`[port ${p}] socket error: ${e.message}`);
  });

  sock.bind(0, bindIp, () => {
    const local = sock.address();
    console.log(`[port ${p}] bound ${local.address}:${local.port}`);
    sock.send(msg('/xremote'), p, mixerIp, () => console.log(`[port ${p}] sent /xremote`));
    setTimeout(() => {
      sock.send(msg('/info'), p, mixerIp, () => console.log(`[port ${p}] sent /info`));
    }, 150);

    setTimeout(() => {
      console.log(`[port ${p}] total received: ${count}`);
      sock.close();
    }, 1800);
  });
}
