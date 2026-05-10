const { MediaRecordSink } = require("./jt1078Sink");
const { FfmpegPublishSink } = require("./ffmpegPublishSink");

class TeeMediaSink {
  /** @param {{ write: (b: Buffer) => void, end: () => void }[]} parts */
  constructor(parts) {
    this.parts = parts;
  }

  write(buf) {
    for (const p of this.parts) p.write(buf);
  }

  end() {
    for (const p of this.parts) p.end();
  }
}

/**
 * @param {string} remoteLabel
 * @param {{ log: { info?: Function, warn?: Function }, recordDir?: string|null, logEveryBytes?: number, ffmpegMediamtx?: { ffmpegBin: string, publishUrl: string, inputFormat?: string, extraArgsBeforeInput?: string[] }|null }} opts
 */
function createMediaPipelineSink(remoteLabel, opts) {
  /** @type {{ write: (b: Buffer) => void, end: () => void }[]} */
  const parts = [];
  parts.push(
    new MediaRecordSink(remoteLabel, {
      log: opts.log,
      recordDir: opts.recordDir || undefined,
      logEveryBytes: opts.logEveryBytes,
    })
  );
  if (opts.ffmpegMediamtx) {
    parts.push(new FfmpegPublishSink(remoteLabel, { log: opts.log, ...opts.ffmpegMediamtx }));
  }
  return parts.length === 1 ? parts[0] : new TeeMediaSink(parts);
}

module.exports = { createMediaPipelineSink, TeeMediaSink };
