const MAGIC_U32 = 0x30316364;

/**
 * JT/T 1078–style TCP packets: magic 0x30 0x31 0x63 0x64, fixed header, uint16 BE body length, then payload (often RTP).
 * @see JT/T 1078-2016 (common stacks use a 30-byte header; body length at bytes 28–29).
 */
class Jt1078TcpAccumulator {
  /**
   * @param {{ headerLen?: number, maxBodyLen?: number, log?: { info?: Function, warn?: Function }, label?: string }} opts
   */
  constructor(opts) {
    this.headerLen = Math.max(14, Math.min(64, Number(opts.headerLen) || 30));
    this.maxBodyLen = Math.min(4 * 1024 * 1024, Number(opts.maxBodyLen) || 512 * 1024);
    this.log = opts.log;
    this.label = opts.label || "";
    /** @type {Buffer} */
    this._q = Buffer.alloc(0);
    this._passthrough = false;
    this._loggedPassthrough = false;
    this._loggedUnwrap = false;
  }

  /** @returns {Buffer[]} */
  push(chunk) {
    if (this._passthrough) {
      return chunk.length ? [chunk] : [];
    }
    this._q = this._q.length ? Buffer.concat([this._q, chunk]) : chunk;
    /** @type {Buffer[]} */
    const out = [];
    const scanCap = 4096;

    while (this._q.length > 0) {
      if (this._q.length < 4) return out;

      if (this._q.readUInt32BE(0) !== MAGIC_U32) {
        const lim = Math.min(this._q.length - 3, scanCap);
        let found = -1;
        for (let i = 1; i < lim; i++) {
          if (this._q.readUInt32BE(i) === MAGIC_U32) {
            found = i;
            break;
          }
        }
        if (found > 0) {
          this.log?.warn?.(
            `[jt1078-unwrap ${this.label}] dropped ${found} B before 0x30316364 sync`
          );
          this._q = this._q.subarray(found);
          continue;
        }
        if (this._q.length > 8192) {
          if (!this._loggedPassthrough) {
            this.log?.warn?.(
              `[jt1078-unwrap ${this.label}] no JT1078 magic in first 8KiB — passing through raw (set MEDIA_JT1078_TCP_UNWRAP=false if wrong)`
            );
            this._loggedPassthrough = true;
          }
          const emit = this._q;
          this._q = Buffer.alloc(0);
          this._passthrough = true;
          out.push(emit);
          return out;
        }
        return out;
      }

      if (this._q.length < this.headerLen + 2) return out;
      const bodyLen = this._q.readUInt16BE(this.headerLen - 2);
      if (bodyLen === 0 || bodyLen > this.maxBodyLen) {
        this.log?.warn?.(
          `[jt1078-unwrap ${this.label}] bad bodyLen=${bodyLen} at headerLen=${this.headerLen} — skip 1 B`
        );
        this._q = this._q.subarray(1);
        continue;
      }
      const packetLen = this.headerLen + bodyLen;
      if (this._q.length < packetLen) return out;

      if (!this._loggedUnwrap) {
        this.log?.info?.(
          `[jt1078-unwrap ${this.label}] stripping ${this.headerLen} B JT1078 headers (body up to ${this.maxBodyLen} B)`
        );
        this._loggedUnwrap = true;
      }
      out.push(this._q.subarray(this.headerLen, packetLen));
      this._q = this._q.subarray(packetLen);
    }
    return out;
  }

  /** @returns {Buffer[]} */
  flush() {
    if (this._passthrough || !this._q.length) return [];
    const tail = this._q;
    this._q = Buffer.alloc(0);
    return [tail];
  }
}

/** Wraps a sink with the same write/end API. */
class Jt1078UnwrapSink {
  /**
   * @param {{ write: (b: Buffer) => void, end: () => void }} inner
   * @param {{ headerLen?: number, maxBodyLen?: number, log?: { info?: Function, warn?: Function }, label?: string }} accOpts
   */
  constructor(inner, accOpts) {
    this.inner = inner;
    this._acc = new Jt1078TcpAccumulator(accOpts);
  }

  write(buf) {
    for (const p of this._acc.push(buf)) this.inner.write(p);
  }

  end() {
    for (const p of this._acc.flush()) this.inner.write(p);
    this.inner.end();
  }
}

module.exports = { Jt1078TcpAccumulator, Jt1078UnwrapSink };
