const http = require("node:http");
const { debug } = require("../debugLog");
const { MSG } = require("../jt808/messages");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const t = Buffer.concat(chunks).toString("utf8");
        resolve(t ? JSON.parse(t) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * @param {object} ctx
 * @param {Map<string, import('../jt808/session').Jt808TcpSession>} ctx.sessionsByPhone
 * @param {() => { host: string, tcpPort: number, udpPort: number }} ctx.mediaEndpoint
 * @param {(phone12?: string) => Record<string, string> | null} [ctx.getMediamtxPlaybackHints]
 */
function startControlApi(port, host, log, ctx) {
  const server = http.createServer(async (req, res) => {
    try {
      debug(`[http] ${req.method} ${req.url}`);
      if (req.method === "GET" && req.url === "/health") {
        return json(res, 200, { ok: true, sessions: ctx.sessionsByPhone.size });
      }
      if (req.method === "POST" && req.url === "/jt808/stream/request") {
        const body = await readJsonBody(req);
        debug("[http] /jt808/stream/request body:", body);
        const phone = String(body.phone || "").replace(/\D/g, "");
        if (phone.length < 6) return json(res, 400, { error: "phone required (6–12 digits)" });
        const phone12 = phone.length > 12 ? phone.slice(-12) : phone.padStart(12, "0");
        const sess = ctx.sessionsByPhone.get(phone12);
        if (!sess) return json(res, 404, { error: "no JT808 session for that phone" });
        const ep = ctx.mediaEndpoint();
        const ok = sess.sendRealtimeAvRequest9101({
          serverIPAddr: body.mediaHost || ep.host,
          tcpPort: body.tcpPort != null ? Number(body.tcpPort) : ep.tcpPort,
          udpPort: body.udpPort != null ? Number(body.udpPort) : ep.udpPort,
          channelNo: body.channelNo != null ? Number(body.channelNo) : 1,
          dataType: body.dataType != null ? Number(body.dataType) : 1,
          streamType: body.streamType != null ? Number(body.streamType) : 0,
        });
        const hints = ctx.getMediamtxPlaybackHints?.(phone12) ?? ctx.getMediamtxPlaybackHints?.() ?? null;
        return json(res, ok ? 200 : 500, {
          ok,
          sent: "0x9101",
          to: phone12,
          media: { host: body.mediaHost || ep.host, tcp: body.tcpPort ?? ep.tcpPort, udp: body.udpPort ?? ep.udpPort },
          ...(hints ? { mediamtx: hints } : {}),
        });
      }
      if (req.method === "POST" && req.url === "/jt808/stream/stop") {
        const body = await readJsonBody(req);
        debug("[http] /jt808/stream/stop body:", body);
        const phone = String(body.phone || "").replace(/\D/g, "");
        const phone12 = phone.length > 12 ? phone.slice(-12) : phone.padStart(12, "0");
        const sess = ctx.sessionsByPhone.get(phone12);
        if (!sess) return json(res, 404, { error: "no JT808 session for that phone" });
        const ok = sess.sendRealtimeAvControl9102({
          channelNo: body.channelNo != null ? Number(body.channelNo) : 1,
          controlCmd: body.controlCmd != null ? Number(body.controlCmd) : 0,
          closeAudioVideoData: body.closeAudioVideoData != null ? Number(body.closeAudioVideoData) : 0,
          streamType: body.streamType != null ? Number(body.streamType) : 0,
        });
        return json(res, ok ? 200 : 500, { ok, sent: "0x9102", to: phone12 });
      }
      if (req.method === "GET" && req.url === "/jt808/help") {
        const hints = ctx.getMediamtxPlaybackHints?.() || null;
        return json(res, 200, {
          endpoints: [
            "GET /health",
            "POST /jt808/stream/request JSON { phone, channelNo?, dataType?, streamType?, tcpPort?, udpPort?, mediaHost? }",
            "POST /jt808/stream/stop JSON { phone, channelNo?, controlCmd? (0=close), closeAudioVideoData?, streamType? }",
          ],
          msgIds: { "0x9101": MSG.REALTIME_AV_REQUEST, "0x9102": MSG.REALTIME_AV_CONTROL },
          ...(hints ? { mediamtxPlayback: hints, note: "VLC: Open Network Stream → mediamtx.rtsp after publisher is up" } : {}),
        });
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const a = server.address();
      log.info(`[http] control API http://${a.address}:${a.port}/jt808/help`);
      resolve(server);
    });
    server.on("error", reject);
  });
}

module.exports = { startControlApi };
