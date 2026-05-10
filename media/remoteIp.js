/** @param {string|undefined} addr */
function normalizeIp(addr) {
  if (!addr) return "";
  const a = String(addr);
  if (a.startsWith("::ffff:")) return a.slice(7);
  return a;
}

module.exports = { normalizeIp };
