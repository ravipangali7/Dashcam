/**
 * Verbose tracing for development. Enable with DEBUG=1 or JT808_DEBUG=true in .env
 */

function isDebugEnabled() {
  const d = process.env.DEBUG;
  const j = process.env.JT808_DEBUG;
  if (d === "1" || String(d).toLowerCase() === "true") return true;
  if (j === "1" || String(j).toLowerCase() === "true") return true;
  return false;
}

/** @param {unknown[]} args */
function debug(...args) {
  if (!isDebugEnabled()) return;
  console.log(new Date().toISOString(), "[debug]", ...args);
}

/** Hex preview without dumping huge buffers. */
function hexPreview(buf, maxBytes = 64) {
  if (!buf || !buf.length) return "";
  const n = Math.min(buf.length, maxBytes);
  const h = buf.subarray(0, n).toString("hex");
  return buf.length > n ? `${h}…(+${buf.length - n}B)` : h;
}

module.exports = { isDebugEnabled, debug, hexPreview };
