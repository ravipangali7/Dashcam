const net = require("node:net");
const { debug, hexPreview } = require("../debugLog");
const { Jt1078MediaSink } = require("./jt1078Sink");

function startMediaTcpServer(port, host, log, recordDir) {
  const srv = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    log.info(`[media] connect ${remote}`);
    debug(`[media] socket ${remote} connect`);
    const sink = new Jt1078MediaSink(remote, { log, recordDir });
    let mediaChunks = 0;
    socket.on("data", (buf) => {
      mediaChunks += 1;
      if (mediaChunks <= 3 || mediaChunks % 200 === 0) {
        debug(`[media] rx ${remote} chunk#${mediaChunks} +${buf.length} B`, hexPreview(buf, 48));
      }
      sink.write(buf);
    });
    socket.on("close", () => {
      debug(`[media] close ${remote} chunks=${mediaChunks}`);
      sink.end();
    });
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
