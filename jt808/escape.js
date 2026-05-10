/**
 * JT/T 808: bytes between start 0x7E and end 0x7E are escaped on the wire.
 * 0x7E -> 0x7D 0x02; 0x7D -> 0x7D 0x01
 */

function unescape(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x7d && i + 1 < buf.length) {
      const n = buf[i + 1];
      if (n === 0x02) {
        out.push(0x7e);
        i++;
      } else if (n === 0x01) {
        out.push(0x7d);
        i++;
      } else {
        out.push(buf[i]);
      }
    } else {
      out.push(buf[i]);
    }
  }
  return Buffer.from(out);
}

function escape(buf) {
  const parts = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x7e) {
      parts.push(0x7d, 0x02);
    } else if (b === 0x7d) {
      parts.push(0x7d, 0x01);
    } else {
      parts.push(b);
    }
  }
  return Buffer.from(parts);
}

module.exports = { unescape, escape };
