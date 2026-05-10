/**
 * Verifies XOR checksum + parse against SmallChi/JT808 README sample (0x0200).
 */
const { parseFrame } = require("../jt808/package");
const { decodeMessage } = require("../jt808/messages");
const { decodePhone } = require("../jt808/bcd");

const hex =
  "7E02000026123456789012007D02000000010000000200BA7F0E07E4F11C0028003C00001810151010100104000000640202007D01137E";

function hexToBuf(s) {
  const clean = s.replace(/\s/g, "");
  return Buffer.from(clean, "hex");
}

const wire = hexToBuf(hex);
const esc = wire.subarray(1, wire.length - 1);
const p = parseFrame(esc, "2013");
if (p.error) {
  console.error(p);
  process.exit(1);
}
console.log("checksum ok:", p.ok, "msgId", p.msgId.toString(16), "phone", decodePhone(p.terminalPhone));
const d = decodeMessage(p.msgId, p.body, p.terminalPhone);
console.log(JSON.stringify(d, null, 2));
if (!p.ok) process.exit(1);
