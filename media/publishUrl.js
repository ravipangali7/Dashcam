/**
 * Build MediaMTX / RTSP path segments and URLs from templates ({phone}, optional {host}).
 */

/** @param {string} phone */
function sanitizePhoneForPath(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  return d.length > 12 ? d.slice(-12) : d.padStart(12, "0");
}

/**
 * @param {string} template e.g. rtsp://127.0.0.1:8554/dashcam/{phone} or rtsp://{host}:8554/{phone}
 * @param {{ phone: string, host?: string, fallbackPhoneLabel?: string }} vars
 */
function expandTemplate(template, vars) {
  const phone = sanitizePhoneForPath(vars.phone);
  const rawFb = vars.fallbackPhoneLabel != null ? String(vars.fallbackPhoneLabel) : "unknown";
  const fb = rawFb.replace(/[^a-zA-Z0-9._-]/g, "") || "unknown";
  const ph = phone || fb;
  let s = String(template || "");
  s = s.split("{phone}").join(ph);
  if (vars.host != null) s = s.split("{host}").join(String(vars.host));
  return s;
}

/**
 * @param {string} pathTemplate path only, e.g. dashcam/{phone} or {phone}
 * @param {string} phone
 * @param {string} [fallbackLabel]
 */
function expandPathTemplate(pathTemplate, phone, fallbackLabel) {
  const t = String(pathTemplate || "{phone}");
  return expandTemplate(t, { phone, fallbackPhoneLabel: fallbackLabel });
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ kind: "static", url: string } | { kind: "template", template: string }}
 */
function resolvePublishUrlMode(env) {
  const fixed = String(env.MEDIAMTX_PUBLISH_URL || "").trim();
  if (fixed.includes("{phone}")) return { kind: "template", template: fixed };
  if (fixed) return { kind: "static", url: fixed };
  const tpl = String(env.MEDIAMTX_PUBLISH_URL_TEMPLATE || "").trim();
  if (tpl) return { kind: "template", template: tpl };
  return { kind: "template", template: "rtsp://127.0.0.1:8554/dashcam/{phone}" };
}

module.exports = { sanitizePhoneForPath, expandTemplate, expandPathTemplate, resolvePublishUrlMode };
