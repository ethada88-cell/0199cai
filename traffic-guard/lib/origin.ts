export const SCRIPT_ORIGIN = "https://llcj.mtekww.cn";

function labelOf(username?: string) {
  const name = String(username || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(name)) return "";
  return name;
}

/** 每个账号一段独立脚本；data-account 必须是该账号自己的 id，不能共用。 */
export function embedSnippet(accountId: string, username?: string) {
  const label = labelOf(username);
  const tag = `<script async src="${SCRIPT_ORIGIN}/guard.js" data-account="${accountId}"></script>`;
  return label ? `<!-- lljc account:${label} -->\n${tag}` : tag;
}

export function clickSnippet(accountId: string, username?: string) {
  const label = labelOf(username);
  const tag = `<script async src="${SCRIPT_ORIGIN}/track.js" data-account="${accountId}"></script>`;
  return label ? `<!-- lljc click:${label} -->\n${tag}` : tag;
}
