// Multi-part public suffixes. A host under one of these keeps three labels
// (example.com.cn, example.co.uk). Everything else keeps two (example.com).
export const MULTI_SUFFIXES = [
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "bj.cn", "sh.cn", "tj.cn", "cq.cn", "he.cn", "sx.cn", "nm.cn", "ln.cn", "jl.cn", "hl.cn",
  "js.cn", "zj.cn", "ah.cn", "fj.cn", "jx.cn", "sd.cn", "ha.cn", "hb.cn", "hn.cn", "gd.cn",
  "gx.cn", "hi.cn", "sc.cn", "gz.cn", "yn.cn", "xz.cn", "sn.cn", "gs.cn", "qh.cn", "nx.cn",
  "xj.cn", "tw.cn", "hk.cn", "mo.cn",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "ad.jp", "ed.jp",
  "com.hk", "edu.hk", "gov.hk", "idv.hk", "net.hk", "org.hk",
  "com.tw", "edu.tw", "gov.tw", "idv.tw", "net.tw", "org.tw",
  "com.sg", "edu.sg", "gov.sg", "net.sg", "org.sg", "per.sg",
  "co.kr", "ne.kr", "or.kr", "re.kr", "pe.kr", "go.kr", "ac.kr",
  "co.nz", "net.nz", "org.nz", "ac.nz", "govt.nz",
  "com.br", "net.br", "org.br", "gov.br",
  "com.mx", "org.mx", "gob.mx",
  "co.za", "org.za", "web.za", "net.za",
  "com.tr", "org.tr", "net.tr", "gov.tr",
  "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in",
  "com.ar", "com.my", "com.ph", "co.id", "co.th", "com.vn", "com.co",
];

const MULTI = new Set(MULTI_SUFFIXES);

export function registrableHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!host || host === "localhost" || host.includes(":")) return host;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host;
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return host;
  const last2 = parts.slice(-2).join(".");
  if (parts.length >= 3 && MULTI.has(last2)) return parts.slice(-3).join(".");
  return last2;
}

export function sameSite(left: string, right: string) {
  const a = registrableHost(left);
  const b = registrableHost(right);
  return Boolean(a && a === b);
}
