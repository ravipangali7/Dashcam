const { spawn } = require("node:child_process");

/**
 * Pipes raw TCP media bytes into ffmpeg stdin; ffmpeg publishes RTSP to MediaMTX (or any RTSP URL).
 * Input format is device-specific (MPEG-TS, RTP+PS, etc.) — tune MEDIAMTX_FFMPEG_INPUT_FORMAT / extra flags.
 */
class FfmpegPublishSink {
  /**
   * @param {string} remoteLabel
   * @param {object} opts
   * @param {{ info?: (s: string) => void, warn?: (s: string) => void }} opts.log
   * @param {string} opts.ffmpegBin
   * @param {string} opts.publishUrl e.g. rtsp://127.0.0.1:8554/dashcam
   * @param {string} [opts.inputFormat] ffmpeg demuxer short name, e.g. mpegts — omit to let ffmpeg probe
   * @param {string[]} [opts.extraArgsBeforeInput] additional argv inserted before -i pipe:0
   * @param {'copy'|'h264'} [opts.videoOut] copy stream vs re-encode H.264 for cleaner VLC (more CPU)
   * @param {number} [opts.h264Crf] default ~20 (lower = sharper, larger bitrate)
   */
  constructor(remoteLabel, opts) {
    this.remoteLabel = remoteLabel;
    this.opts = opts;
    this.bytes = 0;
    /** @type {import('child_process').ChildProcessWithoutNullStreams|null} */
    this._proc = null;
    this._spawn();
  }

  _spawn() {
    const { log, ffmpegBin, publishUrl, inputFormat, extraArgsBeforeInput = [] } = this.opts;
    const videoOut = this.opts.videoOut === "h264" ? "h264" : "copy";
    const pre = [];
    if (inputFormat) {
      pre.push("-f", inputFormat);
    }
    const fflags = videoOut === "h264" ? "+genpts" : "+nobuffer+discardcorrupt";
    const probe =
      videoOut === "h264" && !extraArgsBeforeInput.some((a) => a === "-analyzeduration" || a === "-probesize")
        ? ["-analyzeduration", "10M", "-probesize", "10M"]
        : [];
    const postInput =
      videoOut === "h264"
        ? [
            "-map",
            "0:v:0",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-crf",
            String(Number(this.opts.h264Crf) > 0 ? Number(this.opts.h264Crf) : 20),
            "-pix_fmt",
            "yuv420p",
            "-g",
            "50",
            "-an",
          ]
        : ["-c", "copy"];
    const argv = [
      ffmpegBin,
      "-hide_banner",
      "-loglevel",
      "warning",
      "-fflags",
      fflags,
      "-flags",
      "low_delay",
      ...pre,
      ...probe,
      ...extraArgsBeforeInput,
      "-i",
      "pipe:0",
      ...postInput,
      "-f",
      "rtsp",
      "-rtsp_transport",
      "tcp",
      publishUrl,
    ];
    try {
      this._proc = spawn(argv[0], argv.slice(1), {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      log.warn?.(`[mediamtx/ffmpeg ${this.remoteLabel}] spawn failed: ${e.message}`);
      return;
    }
    const errBuf = [];
    this._proc.stderr.on("data", (c) => {
      errBuf.push(c);
      if (errBuf.reduce((n, b) => n + b.length, 0) > 8000) errBuf.shift();
    });
    this._proc.on("error", (e) => {
      log.warn?.(`[mediamtx/ffmpeg ${this.remoteLabel}] ${e.message}`);
    });
    this._proc.on("exit", (code, sig) => {
      if (code && code !== 0 && code !== 255) {
        const tail = Buffer.concat(errBuf).toString("utf8").trim().split("\n").slice(-6).join("\n");
        log.warn?.(
          `[mediamtx/ffmpeg ${this.remoteLabel}] exited code=${code} sig=${sig || ""}${tail ? `\n${tail}` : ""}`
        );
      }
      this._proc = null;
    });
    log.info?.(`[mediamtx/ffmpeg ${this.remoteLabel}] publishing → ${publishUrl}`);
  }

  write(buf) {
    this.bytes += buf.length;
    if (!this._proc || !this._proc.stdin.writable) return;
    const ok = this._proc.stdin.write(buf);
    if (!ok) this._proc.stdin.once("drain", () => {});
  }

  end() {
    if (this._proc) {
      try {
        this._proc.stdin.end();
      } catch (_) {}
      setTimeout(() => {
        if (this._proc && !this._proc.killed) {
          this._proc.kill("SIGTERM");
        }
      }, 500).unref?.();
      this._proc = null;
    }
    this.opts.log?.info?.(`[mediamtx/ffmpeg ${this.remoteLabel}] closed, fed ${this.bytes} B`);
  }
}

module.exports = { FfmpegPublishSink };
