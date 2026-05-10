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
      return false;
    }
    const buf = buildFrame({
      msgId,
      terminalPhone: phone,
      msgSerial: this.nextSerial(),
      body,
      protocolYear: this.opts.protocolYear || "2013",
    });
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
      return;
    }
    if (!parsed.ok) {
      this.opts.log?.warn?.(
        `checksum fail msg=0x${parsed.msgId.toString(16)} serial=${parsed.msgSerial} check=0x${parsed.check?.toString(16)}`
      );
    }
    const phone = decodePhone(parsed.terminalPhone);
    if (!this.terminalPhone) this.terminalPhone = phone;
    const decoded = decodeMessage(parsed.msgId, parsed.body, parsed.terminalPhone);
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
    const frames = this.splitter.push(chunk);
    for (const esc of frames) {
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
