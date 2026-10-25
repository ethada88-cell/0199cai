import { redirect } from "next/navigation";
import { Dashboard } from "@/app/dashboard";
import { normalizeAccountId, visibleAccounts } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";
import { shanghaiDay } from "@/lib/day";
import { normalizeSiteKey } from "@/lib/site";
import { readMemo } from "@/lib/memo";
import { readSiteNotes } from "@/lib/site-note";
import { lookupIpRegions } from "@/lib/ip-geo";
import { reportPage, type TrafficRow, type VerdictFilter } from "@/lib/store";

const VERDICTS: VerdictFilter[] = ["fake", "farm", "crawler", "other", "emulator", "cloud_phone", "auto", "suspect"];

type RawQuery = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function dayOf(value: string, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

async function slim(rows: Array<TrafficRow & { ipCount?: number }>, idByName: Map<string, string>) {
  const regions = await lookupIpRegions(rows.map((row) => row.ip || ""));
  return rows.map((row) => ({
    account: row.account,
    accountId: idByName.get(row.account) || "",
    site: row.site,
    host: row.host,
    ip: row.ip,
    ipRegion: row.ip ? regions[row.ip] || "" : "",
    note: row.note,
    device: row.device || "",
    label: row.label,
    traffic: row.traffic,
    count: row.count,
    startedAt: row.startedAt,
    visitedAt: row.visitedAt,
    dwellMs: row.dwellMs,
    sitePv: row.sitePv || 0,
    sitePopupAll: row.sitePopupAll || 0,
    siteIpCount: row.siteIpCount || 0,
    siteFake: row.siteFake || 0,
    siteFakeIps: row.siteFakeIps || 0,
    siteSuspect: row.siteSuspect || 0,
    siteSuspectIps: row.siteSuspectIps || 0,
    siteSlide: row.siteSlide || 0,
    ipCount: row.ipCount || 0,
  }));
}

export async function AdminScreen({
  siteKey = "*",
  action = "/admin",
  searchParams,
}: {
  siteKey?: string;
  action?: string;
  searchParams?: RawQuery;
}) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const canPick = session.role === "admin" || session.opens || session.sharesParent;
  const accounts = visibleAccounts(session).map((account) => ({
    id: account.id,
    username: account.username,
    role: account.role,
    parentUsername: account.parentUsername,
  }));
  const today = shanghaiDay();
  const query = searchParams || {};
  let from = dayOf(first(query.from), today);
  let to = dayOf(first(query.to), today);
  if (from > to) [from, to] = [to, from];
  const pickedVerdict = first(query.verdict);
  const verdict: VerdictFilter = VERDICTS.includes(pickedVerdict as VerdictFilter) ? pickedVerdict as VerdictFilter : "fake";
  // 管理员默认全部；互通子账号默认互通视图；其余默认自己（避免冷扫空白）。
  let account =
    first(query.account) ||
    (session.role === "admin" || session.sharesParent ? "*" : session.accountId);
  if (!canPick) account = session.accountId;
  else if (account !== "*") {
    const id = normalizeAccountId(account);
    account = id && accounts.some((item) => item.id === id) ? id : session.accountId;
  }
  const pickedSite = first(query.site);
  const fallbackSite = !siteKey || siteKey === "*" ? "*" : siteKey;
  const site = pickedSite === "*" || pickedSite === "" ? (pickedSite === "*" ? "*" : fallbackSite) : (normalizeSiteKey(pickedSite) || fallbackSite);
  const q = first(query.q).replace(/\s+/g, " ").trim().slice(0, 80);
  const pickedList = first(query.list);
  const drilled = (verdict === "farm" || verdict === "crawler" || verdict === "suspect") && site === "*" && !q;
  const list = pickedList === "visits" || drilled ? "visits" : pickedList === "sites" || (site === "*" && !q) ? "sites" : "visits";
  const sizeRaw = Number(first(query.size));
  const pageSize = sizeRaw === 20 || sizeRaw === 50 || sizeRaw === 100 ? sizeRaw : list === "sites" ? 100 : 20;
  const pageRaw = Number(first(query.page));
  const requestedPage = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.floor(pageRaw) : 1;
  // 互通子账号始终看主账号+自己，避免选成自己账号时整页变成 0。
  const scope =
    account === "*" || session.sharesParent
      ? accounts
      : accounts.filter((item) => item.id === account);
  const notes: Record<string, string> = {};
  for (const item of scope) {
    for (const [siteName, note] of Object.entries(readSiteNotes(item.id))) notes[`${item.id}\n${siteName}`] = note;
  }
  const idByName = new Map(accounts.map((item) => [item.username, item.id]));
  const stats = reportPage({
    accounts: scope.map((item) => ({ id: item.id, username: item.username })),
    siteKey: site === "*" ? null : site,
    from,
    to,
    verdict,
    q,
    page: requestedPage,
    pageSize,
    notes,
    list,
  });
  const totals = {
    fake: stats.fake,
    fakeIps: stats.fakeIps || 0,
    suspect: stats.suspect || 0,
    suspectIps: stats.suspectIps || 0,
    farm: stats.farm,
    crawler: stats.crawler,
    other: stats.other,
    popupShown: stats.popupShown,
    popupAll: stats.popupAll || 0,
    popupClosed: stats.popupClosed,
    slidePassed: stats.slidePassed,
    realIps: stats.realIps,
    realPv: stats.realPv || 0,
  };
  const safePage = stats.page;
  const rows = await slim(stats.rows, idByName);
  const siteNotes: Record<string, string> = {};
  if (site !== "*") {
    for (const item of scope) {
      const note = notes[`${item.id}\n${site}`];
      if (!note) continue;
      const prev = siteNotes[site];
      if (!prev) siteNotes[site] = note;
      else if (prev !== note && !prev.split("、").includes(note)) siteNotes[site] = `${prev}、${note}`;
    }
  }
  const pageNotes: Record<string, string> = {};
  for (const row of rows) {
    const key = `${row.accountId}\n${row.site}`;
    if (notes[key]) pageNotes[key] = notes[key];
  }
  return (
    <>
      <Dashboard
        key={`${from}|${to}|${verdict}|${account}|${site}|${q}|${safePage}|${pageSize}|${list}`}
        action={action}
        today={today}
        role={session.role}
        opens={session.opens}
        sharesParent={session.sharesParent}
        accounts={accounts}
        memo={readMemo(session.accountId)}
        initial={{
          account,
          siteKey: site,
          sites: [],
          from,
          to,
          verdict,
          fake: totals.fake,
          fakeIps: totals.fakeIps,
          suspect: totals.suspect,
          suspectIps: totals.suspectIps,
          farm: totals.farm,
          crawler: totals.crawler,
          other: totals.other,
          popupShown: totals.popupShown,
          popupAll: totals.popupAll,
          popupClosed: totals.popupClosed,
          slidePassed: totals.slidePassed,
          realIps: totals.realIps,
          realPv: totals.realPv,
          focusIp: stats.focusIp || 0,
          focusReal: stats.focusReal || 0,
          focusFake: stats.focusFake || 0,
          focusPv: stats.focusPv || 0,
          focusFakeIps: stats.focusFakeIps || 0,
          focusSuspect: stats.focusSuspect || 0,
          focusSuspectIps: stats.focusSuspectIps || 0,
          rows,
          total: stats.total,
          page: safePage,
          pageSize,
          detail: stats.detail,
          q,
          notes: pageNotes,
          siteNotes,
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: "document.addEventListener('change',function(e){var el=e.target;if(!el||!el.form||window.__tgHydrated)return;var id=el.form.id;if(id!=='guard-query'&&id!=='guard-page')return;if(el.name==='verdict'||el.name==='account'||el.name==='site'||el.name==='from'||el.name==='to'||el.name==='size'){if(el.form.requestSubmit)el.form.requestSubmit();else el.form.submit();}});",
        }}
      />
    </>
  );
}
