/**
 * JT/T 808 message IDs (subset).
 * Multimedia commands 0x9101/0x9102 use the same JT808 framing (e.g. 2013 header + escape + checksum);
 * they are not a separate “signalling protocol” on this TCP link.
 */

exports.MSG = {
  TERMINAL_GENERAL_RESPONSE: 0x0001,
  HEARTBEAT: 0x0002,
  /** Terminal logout / unregister (JT/T 808 终端注销), body often empty */
  TERMINAL_LOGOUT: 0x0003,
  TERMINAL_REGISTER: 0x0100,
  TERMINAL_AUTH: 0x0102,
  LOCATION_REPORT: 0x0200,
  /** Batch / supplementary positioning data upload */
  LOCATION_BATCH: 0x0704,
  /** 0x1003 terminal AV capability report (common JT/T 1078-style body; still JT808-framed) */
  TERMINAL_AV_ATTRIBUTES: 0x1003,
  PLATFORM_GENERAL_RESPONSE: 0x8001,
  REGISTER_RESPONSE: 0x8100,
  /** Real-time AV transmission request — multimedia extension, carried in JT808-2013 frames */
  REALTIME_AV_REQUEST: 0x9101,
  /** Real-time AV transmission control — multimedia extension, carried in JT808-2013 frames */
  REALTIME_AV_CONTROL: 0x9102,
};
