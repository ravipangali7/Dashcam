const net = require("node:net");
const { debug, hexPreview } = require("../debugLog");
const { createMediaPipelineSink } = require("./sinkFactory");

/**
 * @param {number} port
 * @param {string} host
 * @param {{ info: Function, warn: Function }} log
 * @param {{ recordDir?: string|null, ffmpegMediamtx?: { ffmpegBin: string, publishUrl: string, inputFormat?: string, extraArgsBeforeInput?: string[] }|null, buildFfmpegMediamtx?: (s: import('net').Socket) => { ffmpegBin: string, publishUrl: string, inputFormat?: string, extraArgsBeforeInput?: string[] }|null, logMediamtxVlcHint?: boolean }} sinkOpts
 */
function startMediaTcpServer(port, host, log, sinkOpts) {
  const srv = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    log.info(`[media] connect ${remote}`);
    debug(`[media] socket ${remote} connect`);
    const ff =
      typeof sinkOpts.buildFfmpegMediamtx === "function"
        ? sinkOpts.buildFfmpegMediamtx(socket)
        : sinkOpts.ffmpegMediamtx;
    if (!ff && sinkOpts.logMediamtxVlcHint) {
      log.warn(
        `[media] ${remote} raw bytes only — no RTSP publisher. Set MEDIAMTX_FFMPEG_ENABLED=true (and install ffmpeg) so MediaMTX gets a stream; open firewall TCP 8554 for VLC.`
      );
    }
    const sink = createMediaPipelineSink(remote, { log, recordDir: sinkOpts.recordDir, ffmpegMediamtx: ff });
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
      log.info(
        `[media] TCP sink on ${a.address}:${a.port} (raw media after 0x9101; payload may be RTP/PS/etc. per device)`
      );
      resolve(srv);
    });
    srv.on("error", reject);
  });
}

module.exports = { startMediaTcpServer };
