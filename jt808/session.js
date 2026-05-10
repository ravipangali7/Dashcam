const { debug, hexPreview } = require("../debugLog");
const { Jt808FrameSplitter, parseFrame, buildFrame } = require("./package");
const { decodeMessage, encode8001, encode8100, encode9101, encode9102, MSG } = require("./messages");
const { decodePhone } = require("./bcd");

class Jt808TcpSession {
  /**
   * @param {import('net').Socket} socket
   * @param {object} opts
   */
  constructor(socket, opts) {
    this.socket = socket;
    this.opts = opts;
    this.remote = `${socket.remoteAddress}:${socket.remotePort}`;
    this.splitter = new Jt808FrameSplitter();
    this.outSerial = (opts.initialOutSerial || 1) & 0xffff;
    /** @type {string|null} */
    this.terminalPhone = null;
    this._rxBytes = 0;
  }

  nextSerial() {
    const s = this.outSerial;
    this.outSerial = (this.outSerial + 1) & 0xffff;
    return s;
  }

  sendFrame(msgId, body, phoneOverride) {
    const phone = phoneOverride || this.terminalPhone;
    if (!phone) {
      this.opts.log?.warn?.(`skip send 0x${msgId.toString(16)}: unknown terminal phone`);
      debug(`[jt808] tx skipped msg=0x${msgId.toString(16)} (no phone yet)`);
      return false;
    }
    const serial = this.nextSerial();
    const buf = buildFrame({
      msgId,
      terminalPhone: phone,
      msgSerial: serial,
      body,
      protocolYear: this.opts.protocolYear || "2013",
    });
    debug(
      `[jt808] tx ${this.remote} msg=0x${msgId.toString(16)} serial=${serial} bodyLen=${body.length} wire=${buf.length} B`,
      hexPreview(buf, 96)
    );
    this.socket.write(buf);
    return true;
  }

  sendPlatformGeneralResponse(responseSerial, responseMsgId, result = 0) {
    return this.sendFrame(MSG.PLATFORM_GENERAL_RESPONSE, encode8001(responseSerial, responseMsgId, result));
  }

  sendRegisterResponse(responseSerial, result, authCode) {
    return this.sendFrame(MSG.REGISTER_RESPONSE, encode8100(responseSerial, result, authCode));
  }

  /**
   * JT/T 1078 — real-time AV transmission request (terminal opens media session to given host/ports).
   */
  sendRealtimeAvRequest9101(fields) {
    return this.sendFrame(MSG.REALTIME_AV_REQUEST, encode9101(fields));
  }

  sendRealtimeAvControl9102(fields) {
    return this.sendFrame(MSG.REALTIME_AV_CONTROL, encode9102(fields));
  }

  handleParsed(parsed) {
    if (parsed.error) {
      this.opts.log?.warn?.(`parse: ${parsed.error}`, parsed.msgId != null ? `msgId=${parsed.msgId}` : "");
      if (parsed.raw) debug(`[jt808] parse error raw inner (${parsed.raw.length} B):`, hexPreview(parsed.raw, 128));
      return;
    }
    debug(
      `[jt808] frame ${this.remote} msg=0x${parsed.msgId.toString(16)} serial=${parsed.msgSerial} phone=${decodePhone(parsed.terminalPhone)} bodyLen=${parsed.bodyLength} encrypt=${parsed.encrypt} subPkg=${parsed.isSubPackage ? 1 : 0} checksumOk=${parsed.ok}`
    );
    if (!parsed.ok) {
      this.opts.log?.warn?.(
        `checksum fail msg=0x${parsed.msgId.toString(16)} serial=${parsed.msgSerial} check=0x${parsed.check?.toString(16)}`
      );
      debug(`[jt808] checksum body preview:`, hexPreview(parsed.body, 64));
    }
    const phone = decodePhone(parsed.terminalPhone);
    if (!this.terminalPhone) this.terminalPhone = phone;
    const decoded = decodeMessage(parsed.msgId, parsed.body, parsed.terminalPhone);
    debug(`[jt808] decoded ${this.remote} name=${decoded.name} msgId=${decoded.msgId}`);
    this.opts.onMessage?.(this, parsed, decoded);

    const autoReg = this.opts.autoReplyRegister && parsed.msgId === MSG.TERMINAL_REGISTER;
    if (autoReg) {
      this.sendRegisterResponse(parsed.msgSerial, 0, this.opts.registerAuthCode || "OK");
    }
    const autoAck = this.opts.autoPlatformGeneralAck;
    if (autoAck && wantsGeneralAck(parsed.msgId)) {
      this.sendPlatformGeneralResponse(parsed.msgSerial, parsed.msgId, 0);
    }
  }

  feed(chunk) {
    this._rxBytes += chunk.length;
    debug(`[jt808] feed ${this.remote} chunk=${chunk.length} B totalRx=${this._rxBytes} B`);
    const frames = this.splitter.push(chunk);
    debug(`[jt808] splitter ${this.remote} extracted ${frames.length} frame(s) this chunk`);
    for (const esc of frames) {
      debug(`[jt808] escaped frame ${esc.length} B:`, hexPreview(esc, 128));
      const parsed = parseFrame(esc, this.opts.protocolYear || "2013");
      this.handleParsed(parsed);
    }
  }
}

/** Messages that commonly expect a 0x8001 from platform (conservative default list). */
function wantsGeneralAck(msgId) {
  switch (msgId) {
    case MSG.TERMINAL_AUTH:
    case MSG.LOCATION_REPORT:
      return true;
    default:
      return false;
  }
}

module.exports = { Jt808TcpSession, wantsGeneralAck };
