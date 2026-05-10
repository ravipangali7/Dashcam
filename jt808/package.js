const { unescape, escape } = require("./escape");
const { checksum } = require("./checksum");
const { encodePhone } = require("./bcd");

/**
 * Split raw TCP bytes into frames (content between 0x7E delimiters, still escaped).
 */
class Jt808FrameSplitter {
  constructor() {
    this._buf = Buffer.alloc(0);
  }

  /** @returns {Buffer[]} escaped frame payloads (without 0x7E wrappers) */
  push(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    const frames = [];
    while (this._buf.length) {
      let start = this._buf.indexOf(0x7e);
      if (start === -1) {
        this._buf = Buffer.alloc(0);
        break;
      }
      if (start > 0) this._buf = this._buf.subarray(start);
      const end = this._buf.indexOf(0x7e, 1);
      if (end === -1) break;
      const escaped = this._buf.subarray(1, end);
      this._buf = this._buf.subarray(end);
      if (escaped.length) frames.push(escaped);
    }
    return frames;
  }
}

function parseBodyProps(props) {
  return {
    bodyLength: props & 0x3ff,
    encrypt: (props >> 10) & 7,
    isSubPackage: (props >> 13) & 1,
    reserved: (props >> 14) & 3,
  };
}

function parsePackageInner(inner, protocolYear) {
  if (inner.length < 13) {
    return { error: "packet too short", raw: inner };
  }
  const msgId = inner.readUInt16BE(0);
  const props = inner.readUInt16BE(2);
  const { bodyLength, encrypt, isSubPackage } = parseBodyProps(props);
  let o = 4;
  let protocolVersion = null;
  if (protocolYear === "2019") {
    protocolVersion = inner[o++];
  }
  if (inner.length < o + 6 + 2) {
    return { error: "header truncated", raw: inner, msgId, props };
  }
  const terminalPhone = inner.subarray(o, o + 6);
  o += 6;
  const msgSerial = inner.readUInt16BE(o);
  o += 2;
  let packageTotal = null;
  let packageIndex = null;
  if (isSubPackage) {
    if (inner.length < o + 4) return { error: "subpackage header truncated", raw: inner };
    packageTotal = inner.readUInt16BE(o);
    o += 2;
    packageIndex = inner.readUInt16BE(o);
    o += 2;
  }
  const headerEnd = o;
  const need = headerEnd + bodyLength + 1;
  if (inner.length < need) {
    return { error: "incomplete body/check", raw: inner, msgId, bodyLength, have: inner.length };
  }
  const body = inner.subarray(headerEnd, headerEnd + bodyLength);
  const check = inner[headerEnd + bodyLength];
  const xorRange = inner.subarray(0, headerEnd + bodyLength);
  const ok = checksum(xorRange) === check;
  return {
    ok,
    msgId,
    props,
    bodyLength,
    encrypt,
    isSubPackage,
    protocolVersion,
    terminalPhone,
    msgSerial,
    packageTotal,
    packageIndex,
    headerEnd,
    body,
    check,
    raw: inner,
  };
}

/**
 * @param {Buffer} escaped - bytes between 0x7E markers (still escaped)
 * @param {string} protocolYear - '2013' | '2019'
 */
function parseFrame(escaped, protocolYear) {
  const inner = unescape(escaped);
  const parsed = parsePackageInner(inner, protocolYear);
  return parsed;
}

function buildBodyProps(bodyLen, { encrypt = 0, isSubPackage = 0 } = {}) {
  let w = bodyLen & 0x3ff;
  w |= (encrypt & 7) << 10;
  w |= (isSubPackage & 1) << 13;
  return w & 0xffff;
}

/**
 * Build full on-wire frame (including 0x7E ... 0x7E).
 * @param {object} o
 * @param {number} o.msgId
 * @param {string|Buffer} o.terminalPhone - 12 digits or 6-byte BCD buffer
 * @param {number} o.msgSerial
 * @param {Buffer} o.body
 * @param {'2013'|'2019'} [o.protocolYear]
 * @param {number} [o.protocolVersion] for 2019, default 1
 */
function buildFrame(o) {
  const protocolYear = o.protocolYear || "2013";
  const body = o.body || Buffer.alloc(0);
  const props = buildBodyProps(body.length, o);
  const phoneBuf =
    typeof o.terminalPhone === "string" ? encodePhone(o.terminalPhone) : Buffer.from(o.terminalPhone);
  if (phoneBuf.length !== 6) throw new Error("terminalPhone must be 6 BCD bytes or digit string");

  const parts = [];
  parts.push(Buffer.from([(o.msgId >> 8) & 0xff, o.msgId & 0xff]));
  parts.push(Buffer.from([(props >> 8) & 0xff, props & 0xff]));
  if (protocolYear === "2019") {
    parts.push(Buffer.from([o.protocolVersion != null ? o.protocolVersion & 0xff : 1]));
  }
  parts.push(phoneBuf);
  parts.push(Buffer.from([(o.msgSerial >> 8) & 0xff, o.msgSerial & 0xff]));
  if (o.isSubPackage) {
    parts.push(Buffer.from([(o.packageTotal >> 8) & 0xff, o.packageTotal & 0xff]));
    parts.push(Buffer.from([(o.packageIndex >> 8) & 0xff, o.packageIndex & 0xff]));
  }
  parts.push(body);
  const headAndBody = Buffer.concat(parts);
  const chk = Buffer.from([checksum(headAndBody)]);
  const escaped = escape(Buffer.concat([headAndBody, chk]));
  return Buffer.concat([Buffer.from([0x7e]), escaped, Buffer.from([0x7e])]);
}

module.exports = {
  Jt808FrameSplitter,
  parseFrame,
  parsePackageInner,
  buildFrame,
  parseBodyProps,
  buildBodyProps,
};
