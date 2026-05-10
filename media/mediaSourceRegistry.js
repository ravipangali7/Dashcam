const { normalizeIp } = require("./remoteIp");

/**
 * Last known JT808 terminal phone per client IP (for pairing raw media TCP from same device).
 * Same NAT IP for JT808 + media is typical for a dashcam; multiple terminals per IP are ambiguous.
 */
class MediaSourceRegistry {
  constructor() {
    /** @type {Map<string, string>} */
    this._ipToPhone = new Map();
  }

  /** @param {import('net').Socket} socket */
  noteTerminalPhone(socket, phone) {
    const ip = normalizeIp(socket.remoteAddress);
    const p = String(phone || "").replace(/\D/g, "");
    if (!ip || p.length < 6) return;
    const phone12 = p.length > 12 ? p.slice(-12) : p.padStart(12, "0");
    this._ipToPhone.set(ip, phone12);
  }

  /** @param {import('net').Socket} socket */
  clearForSocket(socket) {
    const ip = normalizeIp(socket.remoteAddress);
    if (ip) this._ipToPhone.delete(ip);
  }

  /** @param {import('net').Socket} socket */
  getPhoneForMediaSocket(socket) {
    const ip = normalizeIp(socket.remoteAddress);
    if (!ip) return null;
    return this._ipToPhone.get(ip) || null;
  }
}

module.exports = { MediaSourceRegistry };
