import { redirect } from "next/navigation";
import { visibleAccounts } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";
import { summarizeClicks } from "@/lib/clicks";
import { addDays, monthStart, shanghaiDay } from "@/lib/day";

export const dynamic = "force-dynamic";

function dayOf(value: string | string[] | undefined, fallback: string) {
  const text = Array.isArray(value) ? value[0] || "" : value || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function pageOf(value: string | string[] | undefined) {
  const text = Array.isArray(value) ? value[0] || "" : value || "";
  const n = Number(text);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function href(from: string, to: string, source: string, part = "site", page = 1) {
  const params = new URLSearchParams({ from, to });
  if (source) params.set("source", source);
  if (part === "url" || part === "slot") params.set("part", part);
  if (page > 1) params.set("page", String(page));
  return `/admin/clicks?${params.toString()}`;
}

export default async function ClicksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const query = await searchParams;
  const today = shanghaiDay();
  let from = dayOf(query.from, today);
  let to = dayOf(query.to, today);
  if (from > to) [from, to] = [to, from];
  const sourceText = Array.isArray(query.source) ? query.source[0] || "" : query.source || "";
  const source = sourceText.trim().toLowerCase();
  const partText = Array.isArray(query.part) ? query.part[0] || "" : query.part || "";
  const part = partText === "url" || partText === "slot" ? partText : "site";
  const page = pageOf(query.page);
  const accounts = session.role === "admin" ? null : visibleAccounts(session).map((account) => account.id);
  const detail = part !== "site";
  const needsSource = detail && !source;
  const report = summarizeClicks({
    from,
    to,
    accountIds: accounts,
    source,
    detail: detail && !needsSource,
    page: needsSource ? 1 : page,
  });
  const listTotal = part === "url" ? report.urlTotal : part === "slot" ? report.slotTotal : report.siteTotal;
  const pageCount = Math.max(1, Math.ceil(Math.max(listTotal, 1) / report.pageSize));
  const safePage = Math.min(needsSource ? 1 : page, pageCount);
  const presets = [
    ["今日", today, today],
    ["昨日", addDays(today, -1), addDays(today, -1)],
    ["近 7 天", addDays(today, -6), today],
    ["本月", monthStart(today), today],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-medium text-[#222]">出站点击</h1>
        <p className="mt-2 max-w-4xl text-[13px] leading-6 text-[#8a8f98]">
          这里只看出站：别人的广告从你的哪个站点点出去。出站域名是访客离开的你自己的站点。出站 IP 按不同 IP 计；点击量按每一次点击计。刷量检测那一页仍是你投在别人站点上的真实 IP 和假量。这一页只读出站记录，不改刷量脚本，也不影响进站。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {presets.map(([label, start, end]) => (
          <a key={label} href={href(start, end, source, part)} className="text-[#555]">{label}</a>
        ))}
        <span className="text-xs text-[#98a]">{from} ~ {to}</span>
      </div>
      <form action="/admin/clicks" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        {part !== "site" ? <input type="hidden" name="part" value={part} /> : null}
        <label className="grid gap-1 text-sm text-[#666]">
          出站站点
          <input name="source" defaultValue={source} placeholder="99951bb.app 或 67845bb.app" className="h-10 w-64 rounded border border-[#d9d9d9] bg-white px-2 text-base" />
        </label>
        <button type="submit" className="h-10 rounded bg-[#18a058] px-4 text-base text-white">查询</button>
      </form>
      <div className="flex flex-wrap gap-4 text-sm">
        {([
          ["site", "出站站点"],
          ["url", "目标链接"],
          ["slot", "广告位"],
        ] as const).map(([id, label]) => (
          <a key={id} href={href(from, to, source, id)} className={part === id ? "font-medium text-[#18a058]" : "text-[#555]"}>
            {label}
          </a>
        ))}
      </div>
      <section className="bg-white">
        <div className="px-4 py-3 text-sm">
          <h2 className="font-medium text-[#222]">{part === "url" ? "按目标链接" : part === "slot" ? "按广告位" : "按出站站点"}</h2>
          <p className="mt-1 text-xs text-[#9aa0a6]">
            合计 {report.ips} 个出站 IP，{report.total} 次点击。出站 IP 按不同 IP 计；点击量按每一次点击计。
            {part === "site" ? ` 子域名已按根域名汇总，下面共 ${report.siteTotal} 个站点（如 99951bb.app、67845bb.app）。` : null}
            {part === "url" && !needsSource ? ` 下面共 ${report.urlTotal} 条目标链接。` : null}
            {part === "slot" && !needsSource ? ` 下面共 ${report.slotTotal} 个广告位。` : null}
          </p>
        </div>
        {needsSource ? (
          <div className="border-t border-[#f2f2f2] px-4 py-6 text-sm text-[#666]">
            <p>看目标链接或广告位时，先选出站站点再查询。同一根域名下的子域名已汇总成一行。</p>
            {report.sites.length ? (
              <div className="mt-4">
                <p className="text-xs text-[#9aa0a6]">点下面的站点直接看：</p>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {report.sites.map((row) => (
                    <li key={row.host} className="rounded border border-[#eee] bg-[#fafafa] px-4 py-3">
                      <a href={href(from, to, row.host, part)} className="break-all text-base font-medium text-[#18a058]">
                        {row.host}
                      </a>
                      <div className="mt-2 text-sm tabular-nums text-[#666]">
                        <span className="text-[#18a058]">{row.ips}</span> IP / {row.count} 次
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 text-[#8a8f98]">这段时间没有出站点击。</p>
            )}
          </div>
        ) : null}
        {!needsSource && part === "site" && report.sites.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-y border-[#eee] text-left text-[#666]">
                  <th className="px-4 py-2 font-medium" title="同一根域名下的子域名已汇总成一行">出站站点</th>
                  <th className="px-4 py-2 text-right font-medium" title="这个根域名下出去的不同 IP">出站IP</th>
                  <th className="px-4 py-2 text-right font-medium" title="每一次出站点击都算一次">点击量</th>
                </tr>
              </thead>
              <tbody>
                {report.sites.map((row) => (
                  <tr key={row.host} className="border-b border-[#f2f2f2]">
                    <td className="px-4 py-3 break-all text-[#333]">
                      <a href={href(from, to, row.host, "url")} className="text-[#18a058]">{row.host}</a>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#18a058]">{row.ips}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#333]">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!needsSource && part === "url" && report.urls.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-y border-[#eee] text-left text-[#666]">
                  <th className="px-4 py-2 font-medium">出站域名</th>
                  <th className="px-4 py-2 text-right font-medium">出站IP</th>
                  <th className="px-4 py-2 text-right font-medium">点击量</th>
                  <th className="px-4 py-2 font-medium">目标域名</th>
                  <th className="px-4 py-2 font-medium">目标链接</th>
                </tr>
              </thead>
              <tbody>
                {report.urls.map((row) => (
                  <tr key={`${row.source}\n${row.target}`} className="border-b border-[#f2f2f2]">
                    <td className="px-4 py-3 break-all text-[#333]">{row.source}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#18a058]">{row.ips}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#333]">{row.count}</td>
                    <td className="px-4 py-3 break-all">{row.host}</td>
                    <td className="max-w-[480px] truncate px-4 py-3 text-[#444]" title={row.target}>{row.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!needsSource && part === "slot" && report.slots.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-[#eee] text-left text-[#666]">
                  <th className="px-4 py-2 font-medium">出站域名</th>
                  <th className="px-4 py-2 text-right font-medium">出站IP</th>
                  <th className="px-4 py-2 text-right font-medium">点击量</th>
                  <th className="px-4 py-2 font-medium">广告位</th>
                </tr>
              </thead>
              <tbody>
                {report.slots.map((row) => (
                  <tr key={`${row.source}\n${row.slot}`} className="border-b border-[#f2f2f2]">
                    <td className="px-4 py-3 break-all text-[#333]">{row.source}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#18a058]">{row.ips}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#333]">{row.count}</td>
                    <td className="px-4 py-3">{row.slot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!needsSource && ((part === "site" && !report.sites.length) || (part === "url" && !report.urls.length) || (part === "slot" && !report.slots.length)) ? (
          <p className="px-4 pb-4 text-sm text-[#8a8f98]">这段时间没有出站点击。</p>
        ) : null}
        {!needsSource && listTotal > report.pageSize ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eee] px-4 py-3 text-sm text-[#666]">
            <span className="tabular-nums">第 {safePage} / {pageCount} 页，每页 {report.pageSize} 条</span>
            <div className="flex items-center gap-2">
              <a
                aria-disabled={safePage <= 1}
                href={safePage <= 1 ? undefined : href(from, to, source, part, safePage - 1)}
                className={`inline-flex h-8 items-center rounded border border-[#d9d9d9] bg-white px-3 text-sm ${safePage <= 1 ? "pointer-events-none text-[#c5c8ce]" : "text-[#333]"}`}
              >
                上一页
              </a>
              <a
                aria-disabled={safePage >= pageCount}
                href={safePage >= pageCount ? undefined : href(from, to, source, part, safePage + 1)}
                className={`inline-flex h-8 items-center rounded border border-[#d9d9d9] bg-white px-3 text-sm ${safePage >= pageCount ? "pointer-events-none text-[#c5c8ce]" : "text-[#333]"}`}
              >
                下一页
              </a>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
