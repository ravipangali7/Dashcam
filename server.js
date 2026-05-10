require("dotenv").config();

const net = require("node:net");
const { isDebugEnabled, debug, hexPreview } = require("./debugLog");
const { Jt808TcpSession } = require("./jt808/session");
const { startMediaTcpServer } = require("./media/server");
const { startControlApi } = require("./http/controlApi");
const { MediaSourceRegistry } = require("./media/mediaSourceRegistry");
const { resolvePublishUrlMode, expandTemplate, expandPathTemplate } = require("./media/publishUrl");

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
const MEDIAMTX_PLAYBACK_URL_TEMPLATE = (process.env.MEDIAMTX_PLAYBACK_URL_TEMPLATE || "").trim();
const MEDIAMTX_PLAYBACK_PATH_TEMPLATE = (process.env.MEDIAMTX_PLAYBACK_PATH_TEMPLATE || "dashcam/{phone}").trim();
const MEDIAMTX_UNKNOWN_PHONE_LABEL = (process.env.MEDIAMTX_UNKNOWN_PHONE_LABEL || "unknown").trim() || "unknown";
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

const publishUrlMode = resolvePublishUrlMode(process.env);

const ffmpegExtraArgs = (() => {
  const a = splitPipeDelimitedArgs(process.env.MEDIAMTX_FFMPEG_EXTRA_BEFORE_INPUT || "");
  return a.length ? a : undefined;
})();

const mediaPhoneRegistry = new MediaSourceRegistry();

function buildPublishUrlForPhone(phone12) {
  if (publishUrlMode.kind === "static") return publishUrlMode.url;
  return expandTemplate(publishUrlMode.template, {
    phone: phone12 || "",
    fallbackPhoneLabel: MEDIAMTX_UNKNOWN_PHONE_LABEL,
  });
}

function buildFfmpegMediamtx(mediaSocket) {
  if (!MEDIAMTX_FFMPEG_ENABLED) return null;
  const ph = mediaPhoneRegistry.getPhoneForMediaSocket(mediaSocket);
  const publishUrl = buildPublishUrlForPhone(ph);
  log.info(`[mediamtx] publish ${publishUrl} (jt808 phone for this IP: ${ph || "none — using fallback segment"})`);
  return {
    ffmpegBin: MEDIAMTX_FFMPEG_BIN,
    publishUrl,
    inputFormat: MEDIAMTX_FFMPEG_INPUT_FORMAT || undefined,
    extraArgsBeforeInput: ffmpegExtraArgs,
  };
}

function getMediamtxPlaybackHints(forPhone12) {
  const wantHints =
    MEDIAMTX_FFMPEG_ENABLED || !!MEDIAMTX_PLAYBACK_URL || MEDIAMTX_PLAYBACK_HINTS;
  if (!wantHints) return null;

  if (publishUrlMode.kind === "static") {
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

  const host = MEDIAMTX_PLAYBACK_HOST || MEDIA_PUBLIC_HOST;
  const playbackTpl =
    MEDIAMTX_PLAYBACK_URL_TEMPLATE ||
    `rtsp://{host}:${MEDIAMTX_RTSP_PORT}/${MEDIAMTX_PLAYBACK_PATH_TEMPLATE}`;

  if (!forPhone12) {
    if (!host || host === "0.0.0.0") {
      return {
        rtspUrlTemplate: playbackTpl,
        note: "Set MEDIAMTX_PLAYBACK_HOST or MEDIAMTX_PLAYBACK_URL_TEMPLATE; substitute {phone} with 12-digit terminal id",
      };
    }
    return {
      rtspUrlTemplate: playbackTpl,
      rtspExample: expandTemplate(playbackTpl, { host, phone: "015770066239" }),
      note: "VLC URL is per terminal phone; POST /jt808/stream/request returns mediamtx for that phone",
    };
  }

  if (!host || host === "0.0.0.0") return null;
  const rtsp = expandTemplate(playbackTpl, { host, phone: forPhone12 });
  const pathOnly = expandPathTemplate(MEDIAMTX_PLAYBACK_PATH_TEMPLATE, forPhone12, MEDIAMTX_UNKNOWN_PHONE_LABEL);
  const hls = `http://${host}:${MEDIAMTX_HLS_PORT}/${pathOnly}/index.m3u8`;
  return { rtsp, hls };
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
    onTerminalPhone(sock, phone) {
      mediaPhoneRegistry.noteTerminalPhone(sock, phone);
    },
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
    mediaPhoneRegistry.clearForSocket(socket);
    debug(`[jt808] end ${remote} rxBytes=${session._rxBytes}`);
    log.info(`[jt808] disconnected ${remote}`);
  });
  socket.on("error", (err) => {
    unregisterSession(session);
    mediaPhoneRegistry.clearForSocket(socket);
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
      buildFfmpegMediamtx,
      logMediamtxVlcHint: !MEDIAMTX_FFMPEG_ENABLED,
    });
    if (MEDIAMTX_FFMPEG_ENABLED) {
      const mode =
        publishUrlMode.kind === "static"
          ? `static ${publishUrlMode.url}`
          : `per-ip phone → ${publishUrlMode.template}`;
      const h = getMediamtxPlaybackHints();
      log.info(
        `[mediamtx] ffmpeg bridge on (${mode})${h ? `; hints ${JSON.stringify(h)}` : "; set MEDIAMTX_PLAYBACK_HOST / MEDIAMTX_PLAYBACK_HINTS for VLC URLs"}`
      );
    } else {
      log.info(
        "[mediamtx] ffmpeg bridge off — VLC RTSP URLs will not work until MEDIAMTX_FFMPEG_ENABLED=true (MediaMTX needs a live publisher on that path)."
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
