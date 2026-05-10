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
const MEDIAMTX_FFMPEG_ENABLED =
  String(process.env.MEDIAMTX_FFMPEG_ENABLED || "").toLowerCase() === "true";
const MEDIAMTX_PUBLISH_URL =
  process.env.MEDIAMTX_PUBLISH_URL || "rtsp://127.0.0.1:8554/dashcam";
const MEDIAMTX_FFMPEG_BIN =
  process.env.MEDIAMTX_FFMPEG_BIN || process.env.FFMPEG_PATH || "ffmpeg";
const MEDIAMTX_FFMPEG_INPUT_FORMAT = (process.env.MEDIAMTX_FFMPEG_INPUT_FORMAT || "").trim();
const MEDIAMTX_PATH = (process.env.MEDIAMTX_PATH || "dashcam").replace(/^\//, "");
const MEDIAMTX_RTSP_PORT = Number(process.env.MEDIAMTX_RTSP_PORT) || 8554;
const MEDIAMTX_HLS_PORT = Number(process.env.MEDIAMTX_HLS_PORT) || 8888;
const MEDIAMTX_PLAYBACK_URL = (process.env.MEDIAMTX_PLAYBACK_URL || "").trim();
const MEDIAMTX_PLAYBACK_HOST = (process.env.MEDIAMTX_PLAYBACK_HOST || "").trim();
const MEDIAMTX_PLAYBACK_HINTS =
  String(process.env.MEDIAMTX_PLAYBACK_HINTS || "").toLowerCase() === "true";
const AUTO_STREAM_9101 = String(process.env.AUTO_STREAM_9101 || "").toLowerCase() === "true";
const STREAM_CHANNEL_NO = Number(process.env.STREAM_CHANNEL_NO) || 1;
const STREAM_DATA_TYPE = Number(process.env.STREAM_DATA_TYPE) || 1;
const STREAM_STREAM_TYPE = Number(process.env.STREAM_STREAM_TYPE) || 0;

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), ...a),
};

function splitPipeDelimitedArgs(s) {
  if (!s || !String(s).trim()) return [];
  return String(s)
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

const ffmpegMediamtxOpts = MEDIAMTX_FFMPEG_ENABLED
  ? {
      ffmpegBin: MEDIAMTX_FFMPEG_BIN,
      publishUrl: MEDIAMTX_PUBLISH_URL,
      inputFormat: MEDIAMTX_FFMPEG_INPUT_FORMAT || undefined,
      extraArgsBeforeInput: (() => {
        const a = splitPipeDelimitedArgs(process.env.MEDIAMTX_FFMPEG_EXTRA_BEFORE_INPUT || "");
        return a.length ? a : undefined;
      })(),
    }
  : null;

function getMediamtxPlaybackHints() {
  const wantHints =
    MEDIAMTX_FFMPEG_ENABLED || !!MEDIAMTX_PLAYBACK_URL || MEDIAMTX_PLAYBACK_HINTS;
  if (!wantHints) return null;
  const rtsp =
    MEDIAMTX_PLAYBACK_URL ||
    (() => {
      const host = MEDIAMTX_PLAYBACK_HOST || MEDIA_PUBLIC_HOST;
      if (!host || host === "0.0.0.0") return "";
      return `rtsp://${host}:${MEDIAMTX_RTSP_PORT}/${MEDIAMTX_PATH}`;
    })();
  if (!rtsp) return null;
  const host = MEDIAMTX_PLAYBACK_HOST || MEDIA_PUBLIC_HOST;
  const hls =
    host && host !== "0.0.0.0"
      ? `http://${host}:${MEDIAMTX_HLS_PORT}/${MEDIAMTX_PATH}/index.m3u8`
      : null;
  return { rtsp, ...(hls ? { hls } : {}) };
}

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
    await startMediaTcpServer(MEDIA_PORT, MEDIA_HOST, log, {
      recordDir: MEDIA_RECORD_DIR || null,
      ffmpegMediamtx: ffmpegMediamtxOpts,
    });
    if (MEDIAMTX_FFMPEG_ENABLED) {
      const h = getMediamtxPlaybackHints();
      log.info(
        `[mediamtx] ffmpeg bridge on (publish ${MEDIAMTX_PUBLISH_URL})${h ? `; playback ${JSON.stringify(h)}` : "; set MEDIAMTX_PLAYBACK_URL or MEDIAMTX_PLAYBACK_HINTS for VLC URLs"}`
      );
    }
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
        getMediamtxPlaybackHints,
      });
    } catch (e) {
      log.warn(`[http] failed to bind: ${e.message}`);
    }
  } else {
    log.info("[http] control API disabled (set HTTP_CONTROL_PORT>0 to enable)");
  }
});
