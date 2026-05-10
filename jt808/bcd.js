/** Terminal mobile number: 6-byte BCD, 12 decimal digits, high nibble first per pair. */

function encodePhone(digits) {
  const s = String(digits).replace(/\D/g, "");
  const pad = s.length > 12 ? s.slice(-12) : s.padStart(12, "0");
  const out = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    const a = Number(pad[i * 2] || "0");
    const b = Number(pad[i * 2 + 1] || "0");
    out[i] = (a << 4) | b;
  }
  return out;
}

function decodePhone(buf6) {
  if (!buf6 || buf6.length < 6) return "";
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += String((buf6[i] >> 4) & 0xf);
    s += String(buf6[i] & 0xf);
  }
  return s;
}

module.exports = { encodePhone, decodePhone };
