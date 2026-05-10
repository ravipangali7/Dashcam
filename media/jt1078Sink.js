const fs = require("node:fs");
const path = require("node:path");

/**
 * JT/T 1078 media is usually RTP (PS/H.264) over a separate TCP/UDP session from JT808.
 * This sink records raw bytes and prints light-weight stats for integration / debugging.
 */
class Jt1078MediaSink {
  constructor(remoteLabel, options) {
    this.remoteLabel = remoteLabel;
    this.options = options || {};
    this.bytes = 0;
    this.chunks = 0;
    /** @type {import('fs').WriteStream|null} */
    this._file = null;
    const dir = this.options.recordDir;
    if (dir) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const fname = path.join(
          dir,
          `media_${remoteLabel.replace(/[:\\/?*]/g, "_")}_${Date.now()}.bin`
        );
        this._file = fs.createWriteStream(fname);
        this.options.log?.info?.(`JT1078 recording to ${fname}`);
      } catch (e) {
        this.options.log?.warn?.(`record dir failed: ${e.message}`);
      }
    }
  }

  write(buf) {
    this.bytes += buf.length;
    this.chunks += 1;
    if (this._file) this._file.write(buf);
    const every = this.options.logEveryBytes || 256 * 1024;
    if (this.bytes % every < buf.length || this.chunks === 1) {
      this.options.log?.info?.(
        `[media ${this.remoteLabel}] ${(this.bytes / 1024).toFixed(1)} KiB in ${this.chunks} chunks (JT1078 RTP demux not applied)`
      );
    }
  }

  end() {
    if (this._file) {
      this._file.end();
      this._file = null;
    }
    this.options.log?.info?.(`[media ${this.remoteLabel}] closed, total ${this.bytes} B`);
  }
}

module.exports = { Jt1078MediaSink };
