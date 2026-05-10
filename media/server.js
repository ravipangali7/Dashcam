const net = require("node:net");
const { Jt1078MediaSink } = require("./jt1078Sink");

function startMediaTcpServer(port, host, log, recordDir) {
  const srv = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    log.info(`[media] connect ${remote}`);
    const sink = new Jt1078MediaSink(remote, { log, recordDir });
    socket.on("data", (buf) => sink.write(buf));
    socket.on("close", () => sink.end());
    socket.on("error", (err) => log.warn(`[media] ${remote} ${err.message}`));
  });
  return new Promise((resolve, reject) => {
    srv.listen(port, host, () => {
      const a = srv.address();
      log.info(`[media] TCP sink listening on ${a.address}:${a.port} (terminal pushes JT1078/RTP here after 0x9101)`);
      resolve(srv);
    });
    srv.on("error", reject);
  });
}

module.exports = { startMediaTcpServer };
