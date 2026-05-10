const { MSG } = require("./constants");
const { decodePhone } = require("./bcd");

function readBeUint32(buf, o) {
  return buf.readUInt32BE(o);
}

function decode9101(body) {
  if (!body || body.length < 9) return { error: "body too short" };
  const serverIPLen = body[0];
  const need = 1 + serverIPLen + 7;
  if (body.length < need) return { error: "9101 length mismatch", expected: need, have: body.length };
  const serverIPAddr = body.subarray(1, 1 + serverIPLen).toString("ascii");
  const o = 1 + serverIPLen;
  const tcpPort = body.readUInt16BE(o);
  const udpPort = body.readUInt16BE(o + 2);
  const channelNo = body[o + 4];
  const dataType = body[o + 5];
  const streamType = body[o + 6];
  return {
    type: "0x9101",
    serverIPLen,
    serverIPAddr,
    tcpPort,
    udpPort,
    channelNo,
    dataType,
    streamType,
    dataTypeLabel: ["AV", "video", "intercom", "listen", "broadcast", "transparent"][dataType] || String(dataType),
    streamTypeLabel: streamType === 0 ? "main" : "sub",
  };
}

function encode9101(fields) {
  const ip = String(fields.serverIPAddr || fields.ip || "127.0.0.1");
  const ipBuf = Buffer.from(ip, "ascii");
  const tcpPort = fields.tcpPort >>> 0;
  const udpPort = fields.udpPort >>> 0;
  const channelNo = fields.channelNo != null ? fields.channelNo & 0xff : 1;
  const dataType = fields.dataType != null ? fields.dataType & 0xff : 1;
  const streamType = fields.streamType != null ? fields.streamType & 0xff : 0;
  return Buffer.concat([
    Buffer.from([ipBuf.length]),
    ipBuf,
    Buffer.from([(tcpPort >> 8) & 0xff, tcpPort & 0xff]),
    Buffer.from([(udpPort >> 8) & 0xff, udpPort & 0xff]),
    Buffer.from([channelNo, dataType, streamType]),
  ]);
}

function decode9102(body) {
  if (!body || body.length !== 4) return { error: "9102 expects 4 bytes" };
  return {
    type: "0x9102",
    channelNo: body[0],
    controlCmd: body[1],
    closeAudioVideoData: body[2],
    streamType: body[3],
    controlLabel: ["close AV", "switch stream", "pause", "resume", "close intercom"][body[1]] || String(body[1]),
  };
}

function encode9102(fields) {
  return Buffer.from([
    fields.channelNo & 0xff,
    fields.controlCmd & 0xff,
    fields.closeAudioVideoData & 0xff,
    fields.streamType & 0xff,
  ]);
}

/** Platform general response 0x8001 */
function encode8001(responseSerial, responseMsgId, result = 0) {
  return Buffer.from([
    (responseSerial >> 8) & 0xff,
    responseSerial & 0xff,
    (responseMsgId >> 8) & 0xff,
    responseMsgId & 0xff,
    result & 0xff,
  ]);
}

/** Platform register response 0x8100 */
function encode8100(responseSerial, result, authCode) {
  const code = Buffer.from(String(authCode || ""), "utf8");
  return Buffer.concat([
    Buffer.from([(responseSerial >> 8) & 0xff, responseSerial & 0xff, result & 0xff]),
    code,
  ]);
}

function decode0200(body) {
  if (!body || body.length < 28) return { error: "0x0200 body too short", len: body?.length };
  return {
    type: "0x0200",
    alarmFlag: readBeUint32(body, 0),
    statusFlag: readBeUint32(body, 4),
    latitude: readBeUint32(body, 8),
    longitude: readBeUint32(body, 12),
    altitudeM: body.readUInt16BE(16),
    speedTenthKmh: body.readUInt16BE(18),
    direction: body.readUInt16BE(20),
    timeBcd6: body.subarray(22, 28).toString("hex"),
    extraHex: body.length > 28 ? body.subarray(28).toString("hex") : null,
  };
}

function decodeMessage(msgId, body, terminalPhoneBuf) {
  const phone = decodePhone(terminalPhoneBuf);
  const base = { msgId: `0x${msgId.toString(16).padStart(4, "0")}`, phone };
  switch (msgId) {
    case MSG.HEARTBEAT:
      return { ...base, name: "heartbeat", detail: {} };
    case MSG.TERMINAL_REGISTER:
      return { ...base, name: "terminal_register", detail: { bodyHex: body.toString("hex") } };
    case MSG.TERMINAL_AUTH:
      return { ...base, name: "terminal_auth", detail: { bodyHex: body.toString("hex") } };
    case MSG.LOCATION_REPORT:
      return { ...base, name: "location", detail: decode0200(body) };
    case MSG.TERMINAL_GENERAL_RESPONSE: {
      if (body.length < 5) return { ...base, name: "terminal_general_response", detail: { raw: body.toString("hex") } };
      return {
        ...base,
        name: "terminal_general_response",
        detail: {
          responseSerial: body.readUInt16BE(0),
          responseMsgId: body.readUInt16BE(2),
          result: body[4],
        },
      };
    }
    case MSG.REALTIME_AV_REQUEST:
      return { ...base, name: "realtime_av_request", detail: decode9101(body) };
    case MSG.REALTIME_AV_CONTROL:
      return { ...base, name: "realtime_av_control", detail: decode9102(body) };
    default:
      return { ...base, name: "unknown", detail: { bodyHex: body.toString("hex") } };
  }
}

module.exports = {
  decodeMessage,
  decode9101,
  encode9101,
  decode9102,
  encode9102,
  encode8001,
  encode8100,
  MSG,
};
