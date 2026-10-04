const SAFE_ENV = new Set(['PATH','HOME','LANG','LC_ALL','LC_CTYPE','TMPDIR','TMP','TEMP','USER','LOGNAME','SHELL','TERM','CODEX_HOME','CODEX_ACCESS_TOKEN']);
const SENSITIVE_NAME = /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i;
export function buildChildEnv(parentEnv = process.env) {
  const out = {};
  for (const key of SAFE_ENV) if (parentEnv[key] != null) out[key] = String(parentEnv[key]);
  return out;
}
export function redactText(text, inheritedEnv = process.env) {
  let out = String(text ?? '');
  const secretValues = [];
  for (const [key, value] of Object.entries(inheritedEnv ?? {})) {
    if (!SENSITIVE_NAME.test(key)) continue;
    if (typeof value !== 'string' || value.length < 3) continue;
    secretValues.push(value);
  }
  secretValues.sort((a,b) => b.length - a.length);
  for (const value of secretValues) out = out.split(value).join('[REDACTED]');
  return out;
}
