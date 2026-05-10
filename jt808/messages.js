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

/** JT/T 808-2013 0x0100 terminal register (fixed fields + trailing vehicle identifier, often GBK). */
function decode0100(body) {
  if (!body || body.length < 37) {
    return { error: "0x0100 body too short", len: body?.length, bodyHex: body?.toString("hex") };
  }
  const provinceId = body.readUInt16BE(0);
  const cityId = body.readUInt16BE(2);
  const manufacturer = body.subarray(4, 9).toString("ascii").replace(/\0/g, "");
  const model = body.subarray(9, 29).toString("ascii").replace(/\0+$/g, "");
  const terminalId = body.subarray(29, 36).toString("ascii").replace(/\0/g, "");
  const plateColor = body[36];
  const vehicleTail = body.subarray(37);
  const vehicleHex = vehicleTail.length ? vehicleTail.toString("hex") : null;
  let vehicleNote = vehicleTail.length ? "raw tail (often GBK plate; decode with GBK if needed)" : null;
  if (vehicleTail.length && vehicleTail.every((b) => b >= 0x20 && b <= 0x7e)) {
    vehicleNote = vehicleTail.toString("ascii").replace(/\0/g, "");
  }
  return {
    type: "0x0100",
    provinceId,
    cityId,
    manufacturer,
    model,
    terminalId,
    plateColor,
    vehicleTailHex: vehicleHex,
    vehicleNote,
  };
}

/**
 * JT/T 808 0x0704 — batch location upload.
 * Body: WORD itemCount; BYTE locationType; then per item WORD len + len bytes (0x0200-style + optional attachment).
 */
function decode0704(body) {
  if (!body || body.length < 5) {
    return { type: "0x0704", error: "body too short", bodyLen: body?.length || 0, bodyHex: body?.toString("hex") };
  }
  const itemCount = body.readUInt16BE(0);
  const locationType = body[2];
  const typeLabel =
    locationType === 0 ? "normal_batch" : locationType === 1 ? "blind_spot_supplement" : `type_${locationType}`;
  const items = [];
  let o = 3;
  const maxItems = Math.min(itemCount, 256);
  for (let i = 0; i < maxItems; i++) {
    if (o + 2 > body.length) {
      items.push({ index: i, error: "truncated_before_len" });
      break;
    }
    const len = body.readUInt16BE(o);
    o += 2;
    if (len < 0 || o + len > body.length) {
      items.push({ index: i, error: "bad_item_len", len, remaining: body.length - o });
      break;
    }
    const slice = body.subarray(o, o + len);
    o += len;
    let location = null;
    if (slice.length >= 28) {
      location = decode0200(slice.subarray(0, 28));
    } else {
      location = { error: "item shorter than 28B", itemLen: slice.length };
    }
    items.push({
      index: i,
      locationDataLen: len,
      location,
      attachmentHex: slice.length > 28 ? slice.subarray(28).toString("hex") : null,
    });
    if (o >= body.length) break;
  }
  return {
    type: "0x0704",
    itemCount,
    locationType,
    locationTypeLabel: typeLabel,
    parsedItems: items.length,
    items,
    remainderBytes: body.length - o,
  };
}

const SAMPLING_RATE_LABEL = ["8_kHz", "22_05_kHz", "44_1_kHz", "48_kHz"];
const SAMPLING_BITS_LABEL = ["8_bit", "16_bit", "32_bit"];

/**
 * JT/T 1078 0x1003 — terminal uploads audio/video attributes (binary layout per common stacks / middleware docs).
 * Layout (10 B): audioCoding, inputChlNum, samplingRate, samplingNum, frameLen(WORD BE), output, videoCoding, maxAudioChl, maxVideoChl.
 */
function decode1003(body) {
  if (!body || !body.length) {
    return { type: "0x1003", standard: "JT/T 1078", bodyHex: "", note: "empty body" };
  }
  const base = {
    type: "0x1003",
    standard: "JT/T 1078",
    bodyLen: body.length,
    bodyHex: body.toString("hex"),
  };
  if (body.length < 10) {
    return {
      ...base,
      note: "body shorter than common 10-byte AV-attribute layout",
      bytes: Array.from(body, (b) => `0x${b.toString(16).padStart(2, "0")}`),
    };
  }
  const audioCoding = body[0];
  const inputChlNum = body[1];
  const samplingRate = body[2];
  const samplingNum = body[3];
  const audioFrameLen = body.readUInt16BE(4);
  const audioOutput = body[6];
  const videoCoding = body[7];
  const maxAudioChlNum = body[8];
  const maxVideoChlNum = body[9];
  const out = {
    ...base,
    audioCoding,
    inputChlNum,
    samplingRate,
    samplingRateLabel: SAMPLING_RATE_LABEL[samplingRate] || `rate_${samplingRate}`,
    samplingNum,
    samplingNumLabel: SAMPLING_BITS_LABEL[samplingNum] || `bits_${samplingNum}`,
    audioFrameLen,
    audioOutput,
    audioOutputLabel: audioOutput ? "supported" : "not_supported",
    videoCoding,
    maxAudioChlNum,
    maxVideoChlNum,
  };
  if (body.length > 10) {
    out.extraHex = body.subarray(10).toString("hex");
    out.note = "parsed first 10 B; trailing bytes in extraHex";
  }
  return out;
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
    case MSG.TERMINAL_LOGOUT:
      return {
        ...base,
        name: "terminal_logout",
        detail: { bodyLen: body.length, bodyHex: body.length ? body.toString("hex") : "" },
      };
    case MSG.TERMINAL_REGISTER:
      return { ...base, name: "terminal_register", detail: decode0100(body) };
    case MSG.TERMINAL_AUTH:
      return { ...base, name: "terminal_auth", detail: { bodyHex: body.toString("hex") } };
    case MSG.LOCATION_REPORT:
      return { ...base, name: "location", detail: decode0200(body) };
    case MSG.LOCATION_BATCH:
      return { ...base, name: "location_batch", detail: decode0704(body) };
    case MSG.TERMINAL_AV_ATTRIBUTES:
      return { ...base, name: "terminal_av_attributes", detail: decode1003(body) };
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
      return {
        ...base,
        name: "unknown",
        detail: { bodyLen: body.length, bodyHex: body.length ? body.toString("hex") : "" },
      };
  }
}

module.exports = {
  decodeMessage,
  decode0100,
  decode0704,
  decode1003,
  decode9101,
  encode9101,
  decode9102,
  encode9102,
  encode8001,
  encode8100,
  MSG,
};
