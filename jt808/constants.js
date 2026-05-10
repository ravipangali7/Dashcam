/** JT/T 808 message IDs (subset). Video control IDs are from JT/T 1078 extension over 808. */

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
  /** JT/T 1078 — terminal → platform AV capability / attribute report */
  TERMINAL_AV_ATTRIBUTES: 0x1003,
  PLATFORM_GENERAL_RESPONSE: 0x8001,
  REGISTER_RESPONSE: 0x8100,
  REALTIME_AV_REQUEST: 0x9101,
  REALTIME_AV_CONTROL: 0x9102,
};
