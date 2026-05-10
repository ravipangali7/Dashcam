require("dotenv").config();

const net = require("node:net");
const { isDebugEnabled, debug, hexPreview } = require("./debugLog");
const { Jt808TcpSession } = require("./jt808/session");
const { startMediaTcpServer } = require("./media/server");
const { startControlApi } = require("./http/controlApi");

const PORT = Number(process.env.PORT) || 9000;
const HOST = process.env.HOST || "0.0.0.0";
const MEDIA_PORT = Number(process.env.MEDIA_PORT) || 10700;
const MEDIA_HOST = process.env.MEDIA_HOST || "0.0.0.0";
const MEDIA_PUBLIC_HOST =
  process.env.MEDIA_PUBLIC_HOST || process.env.HOST_PUBLIC || "127.0.0.1";
const MEDIA_UDP_PORT = Number(process.env.MEDIA_UDP_PORT) || 0;
const HTTP_CONTROL_PORT = Number(process.env.HTTP_CONTROL_PORT) || 0;
const HTTP_CONTROL_HOST = process.env.HTTP_CONTROL_HOST || "0.0.0.0";
const JT808_PROTOCOL = (process.env.JT808_PROTOCOL || "2013").toLowerCase() === "2019" ? "2019" : "2013";
const AUTO_REPLY_REGISTER = String(process.env.AUTO_REPLY_REGISTER || "").toLowerCase() === "true";
const AUTO_PLATFORM_ACK = String(process.env.AUTO_PLATFORM_GENERAL_ACK || "").toLowerCase() === "true";
const REGISTER_AUTH_CODE = process.env.REGISTER_AUTH_CODE || "AUTH";
const MEDIA_RECORD_DIR = process.env.MEDIA_RECORD_DIR || "";
const AUTO_STREAM_9101 = String(process.env.AUTO_STREAM_9101 || "").toLowerCase() === "true";
const STREAM_CHANNEL_NO = Number(process.env.STREAM_CHANNEL_NO) || 1;
const STREAM_DATA_TYPE = Number(process.env.STREAM_DATA_TYPE) || 1;
const STREAM_STREAM_TYPE = Number(process.env.STREAM_STREAM_TYPE) || 0;

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), ...a),
};

/** @type {Map<string, import('./jt808/session').Jt808TcpSession>} */
const sessionsByPhone = new Map();

function registerSession(sess) {
  if (!sess.terminalPhone) return;
  sessionsByPhone.set(sess.terminalPhone, sess);
}

function unregisterSession(sess) {
  if (sess.terminalPhone) sessionsByPhone.delete(sess.terminalPhone);
}

/** Normal when scanners or clients drop the link; not a protocol decode failure. */
function isBenignSocketEnd(code) {
  return code === "ECONNRESET" || code === "EPIPE" || code === "ETIMEDOUT" || code === "ECONNABORTED";
}

const jt808Server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  log.info(`[jt808] client ${remote}`);

  const session = new Jt808TcpSession(socket, {
    protocolYear: JT808_PROTOCOL,
    autoReplyRegister: AUTO_REPLY_REGISTER,
    autoPlatformGeneralAck: AUTO_PLATFORM_ACK,
    registerAuthCode: REGISTER_AUTH_CODE,
    autoStream9101: AUTO_STREAM_9101,
    mediaPublicHost: MEDIA_PUBLIC_HOST,
    mediaTcpPort: MEDIA_PORT,
    mediaUdpPort: MEDIA_UDP_PORT,
    streamChannelNo: STREAM_CHANNEL_NO,
    streamDataType: STREAM_DATA_TYPE,
    streamStreamType: STREAM_STREAM_TYPE,
    log,
    onMessage(sess, parsed, decoded) {
      registerSession(sess);
      log.info(
        `[jt808] ${remote} ${decoded.msgId} phone=${decoded.phone} ${decoded.name} ${JSON.stringify(decoded.detail)}`
      );
    },
  });

  socket.setNoDelay(true);
  socket.on("data", (chunk) => {
    debug(`[jt808] rx ${remote} +${chunk.length} B`, hexPreview(chunk, 48));
    session.feed(chunk);
  });
  socket.on("end", () => {
    unregisterSession(session);
    debug(`[jt808] end ${remote} rxBytes=${session._rxBytes}`);
    log.info(`[jt808] disconnected ${remote}`);
  });
  socket.on("error", (err) => {
    unregisterSession(session);
    if (isBenignSocketEnd(err.code)) {
      log.info(`[jt808] peer closed ${remote} (${err.code})`);
    } else {
      log.warn(`[jt808] socket error ${remote}: ${err.message}`);
    }
  });
});

jt808Server.on("error", (err) => {
  log.warn(`jt808 server error: ${err.message}`);
  process.exit(1);
});

jt808Server.listen(PORT, HOST, async () => {
  const a = jt808Server.address();
  log.info(`[jt808] TCP (signalling) on ${a.address}:${a.port} protocol=${JT808_PROTOCOL}`);
  if (isDebugEnabled()) {
    log.info("[jt808] verbose debug logging on (set DEBUG=1 or JT808_DEBUG=true in .env)");
  }

  try {
    await startMediaTcpServer(MEDIA_PORT, MEDIA_HOST, log, MEDIA_RECORD_DIR || null);
  } catch (e) {
    log.warn(`[media] failed to bind: ${e.message}`);
  }

  if (HTTP_CONTROL_PORT > 0) {
    try {
      await startControlApi(HTTP_CONTROL_PORT, HTTP_CONTROL_HOST, log, {
        sessionsByPhone,
        mediaEndpoint: () => ({
          host: MEDIA_PUBLIC_HOST,
          tcpPort: MEDIA_PORT,
          udpPort: MEDIA_UDP_PORT,
        }),
      });
    } catch (e) {
      log.warn(`[http] failed to bind: ${e.message}`);
    }
  } else {
    log.info("[http] control API disabled (set HTTP_CONTROL_PORT>0 to enable)");
  }
});
