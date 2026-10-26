"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MemoPad } from "@/components/memo-pad";
import { addDays, formatStay, monthStart, shanghaiDay } from "@/lib/day";

type Verdict = "fake" | "farm" | "crawler" | "other" | "emulator" | "cloud_phone" | "auto" | "suspect";
type AccountOption = { id: string; username: string; role: "admin" | "user"; parentUsername?: string };
type Part = { count: number; note: string; startedAt: number; visitedAt: number; dwellMs: number };
type Row = {
  account: string;
  accountId: string;
  site: string;
  host: string;
  ip: string;
  ipRegion?: string;
  note: string;
  device: string;
  label: string;
  traffic: string;
  count: number;
  startedAt: number;
  visitedAt: number;
  dwellMs: number;
  sitePv: number;
  sitePopupAll: number;
  siteIpCount: number;
  siteFake: number;
  siteFakeIps: number;
  siteSuspect: number;
  siteSuspectIps: number;
  siteSlide: number;
  ipCount: number;
};
type Payload = {
  account: string;
  siteKey: string;
  sites: string[];
  from: string;
  to: string;
  verdict: Verdict;
  fake: number;
  fakeIps: number;
  suspect: number;
  suspectIps: number;
  farm: number;
  crawler: number;
  other: number;
  popupShown: number;
  popupAll: number;
  popupClosed: number;
  slidePassed: number;
  realIps: number;
  realPv: number;
  focusIp: number;
  focusReal: number;
  focusFake: number;
  focusPv: number;
  focusFakeIps: number;
  focusSuspect: number;
  focusSuspectIps: number;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  detail: "sites" | "visits" | "real";
  q: string;
  notes: Record<string, string>;
  siteNotes: Record<string, string>;
};

const PRESETS = [
  ["today", "今日"],
  ["yesterday", "昨日"],
  ["week", "近 7 天"],
  ["month", "本月"],
] as const;

function rangeFor(id: (typeof PRESETS)[number][0], today: string) {
  if (id === "yesterday") {
    const day = addDays(today, -1);
    return { from: day, to: day };
  }
  if (id === "week") return { from: addDays(today, -6), to: today };
  if (id === "month") return { from: monthStart(today), to: today };
  return { from: today, to: today };
}

function queryHref(action: string, query: { from: string; to: string; verdict: Verdict; site: string; account: string; page?: number; size?: number; q?: string; list?: "sites" | "visits" }) {
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    verdict: query.verdict,
    site: query.site,
    account: query.account,
  });
  if (query.list === "sites" || query.list === "visits") params.set("list", query.list);
  if (query.q) params.set("q", query.q);
  if (query.size && query.size !== 20) params.set("size", String(query.size));
  if (query.page && query.page > 1) params.set("page", String(query.page));
  return `${action}?${params.toString()}`;
}

function markHit(text: string, needle: string) {
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-medium text-[#18a058]">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  );
}

function SiteSearch({
  action,
  notes,
  value,
  q,
  preserved,
  onDraft,
}: {
  action: string;
  notes: Record<string, string>;
  value: string;
  q: string;
  preserved: { from: string; to: string; verdict: Verdict; account: string; size?: number };
  onDraft: (text: string, open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<Array<{ site: string; note: string }>>([]);
  const [more, setMore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const needle = text.trim().toLowerCase();
  const shown = items;
  const active = Math.min(cursor, shown.length);
  const selectedNote = value === "*" ? "" : notes[value] || "";
  const current = value === "*" ? (q ? q : "全部站点") : selectedNote ? `${value} · ${selectedNote}` : value;

  useEffect(() => {
    onDraft(text, open);
  }, [text, open, onDraft]);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    setLoading(true);
    const wait = window.setTimeout(() => {
      const params = new URLSearchParams();
      params.set("account", preserved.account);
      if (text.trim()) params.set("q", text.trim());
      fetch(`/api/v1/admin/sites?${params}`, { signal: ac.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("bad"))))
        .then((body: { items?: Array<{ site: string; note: string }>; more?: number }) => {
          if (ac.signal.aborted) return;
          setItems(Array.isArray(body.items) ? body.items : []);
          setMore(body.more || 0);
          setFailed(false);
          setLoading(false);
        })
        .catch((error: Error) => {
          if (error.name === "AbortError") return;
          setFailed(true);
          setLoading(false);
        });
    }, text.trim() ? 120 : 0);
    return () => {
      ac.abort();
      window.clearTimeout(wait);
    };
  }, [open, text, preserved.account]);

  useEffect(() => {
    setCursor(0);
  }, [needle, items]);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [open, active, needle]);

  function hrefFor(site: string, query = "") {
    return queryHref(action, { ...preserved, site, q: query });
  }

  return (
    <div ref={box} className="relative w-full sm:w-80">
      <input type="hidden" name="site" value={value} />
      {q ? <input type="hidden" name="q" value={q} /> : null}
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="site-search-list"
        aria-label="检索站点或备注"
        autoComplete="off"
        spellCheck={false}
        placeholder="输入域名或备注"
        title={current}
        value={open ? text : current}
        onFocus={() => {
          setText(q);
          setOpen(true);
          onDraft(q, true);
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!box.current?.contains(document.activeElement)) setOpen(false);
          }, 120);
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (!open && q && value === "*" && next === "") {
            window.location.assign(hrefFor("*"));
            return;
          }
          setText(next);
          setOpen(true);
          onDraft(next, true);
        }}
        onKeyDown={(event) => {
          if (!open && event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            return;
          }
          if (!open) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((item) => Math.min(item + 1, shown.length));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((item) => Math.max(item - 1, 0));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const link = box.current?.querySelector<HTMLAnchorElement>("[data-active='true']");
            if (!link) return;
            const picked = link.getAttribute("data-site") || "*";
            const typed = text.trim();
            if (typed && picked !== "*") window.history.pushState(null, "", hrefFor("*", typed));
            window.location.assign(link.href);
          }
        }}
        className="h-10 w-full rounded border border-[#d9d9d9] bg-white px-2 text-base outline-none"
      />
      {open ? (
        <div id="site-search-list" role="listbox" className="absolute left-0 top-11 z-20 max-h-[70vh] w-full overflow-auto rounded border border-[#d9d9d9] bg-white py-1 shadow-sm">
          {needle ? (
            <a
              href={hrefFor("*", text.trim())}
              data-site="*"
              data-active={active === 0}
              className={`block px-3 py-2 text-sm ${active === 0 ? "bg-[#e8f6ee] text-[#18a058]" : "text-[#333] hover:bg-[#f5f5f5]"}`}
            >
              查看「{text.trim()}」的站点
            </a>
          ) : (
            <a
              href={hrefFor("*")}
              data-site="*"
              data-active={active === 0}
              className={`block px-3 py-2 text-sm ${active === 0 ? "bg-[#e8f6ee] text-[#18a058]" : "text-[#333] hover:bg-[#f5f5f5]"}`}
            >
              全部站点
            </a>
          )}
          {shown.map((item, index) => {
            const name = item.site;
            const picked = active === index + 1;
            const note = item.note || notes[name] || "";
            return (
              <a
                key={name}
                href={hrefFor(name, text.trim())}
                data-site={name}
                title={note ? `${name} ${note}` : name}
                data-active={picked}
                onClick={(event) => {
                  const typed = text.trim();
                  if (!typed || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  window.history.pushState(null, "", hrefFor("*", typed));
                  window.location.assign(hrefFor(name, typed));
                }}
                className={`block px-3 py-2 text-sm ${picked ? "bg-[#e8f6ee] text-[#18a058]" : "text-[#333] hover:bg-[#f5f5f5]"}`}
              >
                <span className="block truncate">{markHit(name, needle)}</span>
                {note ? <span className="block truncate text-xs text-[#8a8f98]">{markHit(note, needle)}</span> : null}
              </a>
            );
          })}
          {!shown.length ? <div className="px-3 py-2 text-sm text-[#9aa0a6]">{failed ? "站点列表没有载入，再输入一次" : loading ? "查找中…" : "没有匹配的站点或备注"}</div> : null}
          {needle ? (
            <a href={hrefFor("*")} data-site="*" className="block border-t border-[#f2f2f2] px-3 py-2 text-sm text-[#8a8f98] hover:bg-[#f5f5f5]">
              全部站点
            </a>
          ) : null}
          {more > 0 ? (
            <div className="px-3 py-2 text-xs text-[#9aa0a6]">还有 {more} 个，继续输入缩小范围</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Dashboard({
  action,
  today,
  role,
  opens = false,
  sharesParent = false,
  accounts,
  memo,
  initial,
}: {
  action: string;
  today: string;
  role: "admin" | "user";
  opens?: boolean;
  sharesParent?: boolean;
  accounts: AccountOption[];
  memo: string;
  initial: Payload;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initial.notes);
  const [noteState, setNoteState] = useState<Record<string, string>>({});
  const [live, setLive] = useState({
    fake: initial.fake,
    fakeIps: initial.fakeIps,
    suspect: initial.suspect,
    suspectIps: initial.suspectIps,
    farm: initial.farm,
    crawler: initial.crawler,
    other: initial.other,
    popupShown: initial.popupShown,
    popupAll: initial.popupAll,
    popupClosed: initial.popupClosed,
    slidePassed: initial.slidePassed,
    realIps: initial.realIps,
    realPv: initial.realPv,
    at: 0,
  });
  const savedNotes = useRef(initial.notes);
  const draft = useRef({ text: "", open: false });
  const onDraft = useCallback((text: string, open: boolean) => {
    draft.current = { text, open };
  }, []);

  async function saveNote(accountId: string, site: string, value: string) {
    const key = `${accountId}\n${site}`;
    const next = value.replace(/\s+/g, " ").trim().slice(0, 80);
    setNotes((prev) => ({ ...prev, [key]: next }));
    if ((savedNotes.current[key] || "") === next) return;
    setNoteState((prev) => ({ ...prev, [key]: "保存中" }));
    const res = await fetch("/api/v1/admin/site-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, site, note: next }),
    });
    if (res.ok) savedNotes.current = { ...savedNotes.current, [key]: next };
    setNoteState((prev) => ({ ...prev, [key]: res.ok ? "已保存" : "没保存" }));
  }
  useEffect(() => {
    (window as Window & { __tgHydrated?: boolean }).__tgHydrated = true;
  }, []);
  useEffect(() => {
    setNotes(initial.notes);
    savedNotes.current = initial.notes;
    setLive((prev) => ({
      ...prev,
      fake: initial.fake,
      fakeIps: initial.fakeIps,
      suspect: initial.suspect,
      suspectIps: initial.suspectIps,
      farm: initial.farm,
      crawler: initial.crawler,
      other: initial.other,
      popupShown: initial.popupShown,
      popupAll: initial.popupAll,
      popupClosed: initial.popupClosed,
      slidePassed: initial.slidePassed,
      realIps: initial.realIps,
      realPv: initial.realPv,
    }));
  }, [initial]);
  useEffect(() => {
    function onPop() {
      const params = new URLSearchParams(window.location.search);
      const urlQ = params.get("q") || "";
      const urlSite = params.get("site") || "*";
      if (urlQ === (initial.q || "") && urlSite === initial.siteKey) return;
      window.location.reload();
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initial.q, initial.siteKey]);
  // 顶栏走轻量 /live 接口约 3 秒一刷；表格仍用 SSR，60 秒刷新，避免大账号整页重绘。
  useEffect(() => {
    let dead = false;
    async function pullLive() {
      if (document.hidden || draft.current.open) return;
      try {
        const params = new URLSearchParams({
          from: initial.from,
          to: initial.to,
          account: initial.account || "*",
        });
        const res = await fetch(`/api/v1/admin/live?${params}`, { cache: "no-store" });
        if (!res.ok || dead) return;
        const data = (await res.json()) as Partial<typeof live> & { ok?: boolean; at?: number };
        if (!data?.ok || dead) return;
        setLive((prev) => ({
          ...prev,
          fake: Number(data.fake) || 0,
          fakeIps: Number(data.fakeIps) || 0,
          suspect: Number(data.suspect) || 0,
          suspectIps: Number(data.suspectIps) || 0,
          farm: Number(data.farm) || 0,
          crawler: Number(data.crawler) || 0,
          other: Number(data.other) || 0,
          popupShown: Number(data.popupShown) || 0,
          popupAll: Number(data.popupAll) || 0,
          slidePassed: Number(data.slidePassed) || 0,
          realIps: Number(data.realIps) || 0,
          realPv: Number(data.realPv) || 0,
          at: Number(data.at) || Date.now(),
        }));
      } catch {
        /* keep last good numbers */
      }
    }
    pullLive();
    const liveTick = window.setInterval(pullLive, 3000);
    const pageTick = window.setInterval(() => {
      if (document.hidden) return;
      if (draft.current.open) return;
      router.refresh();
    }, 60000);
    return () => {
      dead = true;
      window.clearInterval(liveTick);
      window.clearInterval(pageTick);
    };
  }, [router, initial.from, initial.to, initial.account]);

  const stats = {
    ...initial,
    fake: live.fake,
    fakeIps: live.fakeIps,
    suspect: live.suspect,
    suspectIps: live.suspectIps,
    farm: live.farm,
    crawler: live.crawler,
    other: live.other,
    popupShown: live.popupShown,
    popupAll: live.popupAll,
    popupClosed: live.popupClosed,
    slidePassed: live.slidePassed,
    realIps: live.realIps,
    realPv: live.realPv,
  };
  const pageSize = stats.pageSize || 20;
  const totalRows = stats.total ?? stats.rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(stats.page || 1, pageCount);
  const pageRows = stats.rows;
  const showSite = stats.siteKey === "*";
  const canPick = role === "admin" || opens || sharesParent;
  const showAccount = canPick && stats.account === "*";
  const realList = stats.detail === "real";
  const siteDetail = stats.detail === "sites";
  const visitDetail = stats.detail === "visits";
  const fakeVisitDetail = visitDetail && stats.verdict === "fake";
  const queryBase = {
    from: stats.from,
    to: stats.to,
    verdict: stats.verdict,
    account: stats.account,
    size: pageSize,
    q: stats.q || "",
    list: realList ? "sites" as const : fakeVisitDetail && stats.siteKey === "*" ? "visits" as const : undefined,
  };
  const backHref = stats.siteKey !== "*"
    ? queryHref(action, { from: stats.from, to: stats.to, verdict: stats.verdict, site: "*", account: stats.account, size: pageSize, q: stats.q || "", list: stats.verdict === "fake" ? "sites" : undefined })
    : fakeVisitDetail
      ? queryHref(action, { from: stats.from, to: stats.to, verdict: "fake", site: "*", account: stats.account, size: pageSize, q: stats.q || "", list: "sites" })
      : "";
  const cards = [
    { label: "真实 IP", value: stats.realIps || 0, note: "各站分别记 IP 再相加。有广告来路需停留约 4 秒或有滑动/点击才记，口径靠拢百度统计；含嫌疑 IP", verdict: null as Verdict | null, list: false as false | "sites" | "visits", tag: "" },
    { label: "真实 PV", value: stats.realPv || 0, note: "正常打开或滑动成功各算一次，同一 IP 反复打开也累加", verdict: null as Verdict | null, list: false as false | "sites" | "visits", tag: "" },
    { label: "IP假量", value: stats.fakeIps || 0, note: "广告商外部来路刷量 IP。站点内去重；汇总只相加、不再去重（同 IP 进两个站算两次）。点击看来路 / IP / 设备", verdict: "fake" as Verdict, list: "visits" as const, tag: "精准假量" },
    { label: "PV假量", value: stats.fake || 0, note: "广告商外部来路刷量次数。点击看来路 / IP / 设备", verdict: "fake" as Verdict, list: "visits" as const, tag: "" },
    { label: "嫌疑 IP", value: stats.suspectIps || 0, note: "软特征且无正常浏览。各站分别去重再相加；同一 IP 进多站分别计。已计入真实 IP。有正常浏览改真实；脚本态互动改假量", verdict: "suspect" as Verdict, list: false as false | "sites" | "visits", tag: "" },
    { label: "嫌疑 PV", value: stats.suspect || 0, note: "软特征且无正常浏览的访问次数。点击查看各站 / 来路 / IP / 设备", verdict: "suspect" as Verdict, list: false as false | "sites" | "visits", tag: "" },
    { label: "弹窗未通过", value: stats.popupAll || 0, note: "发过滑块且未滑过（含超时/离开/客户端未回报）。爬虫/无头等硬自动化不弹窗，只记 PV假量，所以会小于 PV假量", verdict: null as Verdict | null, list: false as false | "sites" | "visits", tag: "" },
    { label: "机房 IP", value: stats.farm, note: "点击查看各站", verdict: "farm" as Verdict, list: false as false | "sites" | "visits", tag: "" },
    { label: "爬虫", value: stats.crawler, note: "点击查看各站", verdict: "crawler" as Verdict, list: false as false | "sites" | "visits", tag: "" },
    { label: "滑动成功", value: stats.slidePassed || 0, note: "自然滑到头计入真实；轨迹像脚本仍记假量。爬虫/无头不弹窗", verdict: null as Verdict | null, list: false as false | "sites" | "visits", tag: "" },
  ];
  const countLabel = stats.verdict === "farm"
    ? "机房 IP"
    : stats.verdict === "crawler"
      ? "爬虫"
      : stats.verdict === "emulator"
        ? "模拟器"
        : stats.verdict === "cloud_phone"
          ? "云手机"
          : stats.verdict === "auto"
            ? "全自动"
            : stats.verdict === "other"
              ? "其他假量"
              : stats.verdict === "suspect"
                ? "嫌疑"
                : "假量";
  const detailLabel = stats.q ? `「${stats.q}」的站点` : `${countLabel} · 站点明细`;
  const suspectDetail = stats.verdict === "suspect" && !realList;
  const siteFakeHref = (site: string, accountId: string) =>
    queryHref(action, { from: stats.from, to: stats.to, verdict: "fake", site, account: accountId || stats.account, size: pageSize, q: stats.q || "" });
  const siteSuspectHref = (site: string, accountId: string) =>
    queryHref(action, { from: stats.from, to: stats.to, verdict: "suspect", site, account: accountId || stats.account, size: pageSize, q: stats.q || "" });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,420px)] xl:items-stretch">
      <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-xl font-medium text-[#222]">刷量检测</h1>
        <p className="mt-2 max-w-4xl text-[13px] leading-6 text-[#8a8f98]">
          {role === "admin"
            ? "管理账号可以查看全部账号的假量，也可以只看某一个账号。每个账号的脚本仍然分开，普通账号登录后只能看到自己的记录。"
            : opens
              ? "这个账号可以查看自己和子账号的假量。子账号有自己的脚本，只能看到自己的记录，看不到这里的其他数据。"
              : sharesParent
                ? "这个账号和主账号互通，两边都能看到对方的假量。脚本仍然分开，这里不能开账号，也不能改主账号的密码。"
                : "脚本在账号页获取。这个账号的网站共用这一段，和其他账号的数据分开。一定先进站再监测：页面先照常打开，约 4 秒后的二次检测才可能弹窗。假量只拦广告商外部来路刷量：只要判定假量就弹窗滑动，滑到头改记真实，没有通过（不滑/超时/离开；弹窗无关闭键，只有滑到头才消失）才记假量并按来路域名归到渠道。收藏夹、直达、站内跳转（空来路）一律记真实。群控/仿真人（换机农场、差来路设备、云控环境等）有广告来路时必弹窗，不被正常浏览直接洗白。普通软特征：有正常浏览改真实，脚本态弹窗，无操作继续嫌疑。没跑脚本的访问记不到。系统有自我学习：确认假量抬分、滑过冲淡并降权，账本约 7 天衰减一半。"}
        </p>
      </div>

      <form
        id="guard-query"
        action={action}
        method="get"
        className="grid gap-3"
        onSubmit={(event) => {
          const field = event.currentTarget.querySelector<HTMLInputElement>('input[aria-label="检索站点或备注"]');
          const typed = (field?.value || "").trim();
          if (!typed || typed === "全部站点") return;
          if (stats.siteKey !== "*" && (typed === stats.siteKey || typed.startsWith(`${stats.siteKey} · `))) return;
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const verdict = String(form.get("verdict") || stats.verdict);
          window.location.assign(queryHref(action, {
            from: String(form.get("from") || stats.from),
            to: String(form.get("to") || stats.to),
            verdict: (verdict || "fake") as Verdict,
            account: String(form.get("account") || stats.account),
            site: "*",
            q: typed,
            size: pageSize,
            list: realList ? "sites" : undefined,
          }));
        }}
      >
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <label className="grid gap-1 text-sm text-[#666]">
            开始
            <input
              type="date"
              name="from"
              defaultValue={stats.from}
              className="h-10 w-full min-w-0 rounded border border-[#d9d9d9] bg-white px-2 text-base outline-none sm:w-40"
            />
          </label>
          <label className="grid gap-1 text-sm text-[#666]">
            结束
            <input
              type="date"
              name="to"
              defaultValue={stats.to}
              className="h-10 w-full min-w-0 rounded border border-[#d9d9d9] bg-white px-2 text-base outline-none sm:w-40"
            />
          </label>
        </div>
        <div className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap sm:items-center">
          <p className="text-xs text-[#8a8f98] w-full basis-full">日期与「今日/昨日」均按北京时间（UTC+8）。</p>
          {PRESETS.map(([id, label]) => {
            const next = rangeFor(id, shanghaiDay() || today);
            return (
              <a
                key={id}
                href={queryHref(action, { ...next, verdict: stats.verdict, site: stats.siteKey, account: stats.account, size: pageSize, q: stats.q || "", list: queryBase.list })}
                className="inline-flex h-10 items-center justify-center text-sm text-[#555] sm:px-1 sm:text-base"
              >
                {label}
              </a>
            );
          })}
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-end">
          {canPick ? (
            <label className="grid gap-1 text-sm text-[#666]">
              账号
              <select
                name="account"
                defaultValue={stats.account}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                className="h-10 w-full rounded border border-[#d9d9d9] bg-white px-2 text-base sm:w-48"
              >
                <option value="*">{role === "admin" ? "全部账号" : sharesParent ? "互通账号" : "我和子账号"}</option>
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.username}
                    {item.role === "admin" ? " · 管理" : ""}
                    {role === "admin" && item.parentUsername ? ` · ${item.parentUsername}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="account" value={stats.account} />
          )}
          <label className="grid gap-1 text-sm text-[#666]">
            站点
            <SiteSearch
              action={action}
              notes={stats.siteNotes || {}}
              value={stats.siteKey}
              q={stats.q || ""}
              preserved={{ from: stats.from, to: stats.to, verdict: stats.verdict, account: stats.account, size: pageSize }}
              onDraft={onDraft}
            />
          </label>
          <label className="grid gap-1 text-sm text-[#666]">
            分类
            <select
              name="verdict"
              defaultValue={stats.verdict}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              className="h-10 w-full rounded border border-[#d9d9d9] bg-white px-2 text-base sm:w-36"
            >
              <option value="fake">全部假量</option>
              <option value="suspect">嫌疑</option>
              <option value="farm">机房</option>
              <option value="crawler">爬虫</option>
              <option value="emulator">模拟器</option>
              <option value="cloud_phone">云手机</option>
              <option value="auto">全自动</option>
              <option value="other">其他假量</option>
            </select>
          </label>
          {realList ? <input type="hidden" name="list" value="sites" /> : null}
          <button type="submit" className="h-10 rounded bg-[#18a058] px-4 text-base text-white sm:self-end">
            查询
          </button>
        </div>
      </form>

      {backHref ? (
        <a href={backHref} className="inline-flex h-10 w-fit items-center gap-1 self-start rounded border border-[#d9d9d9] bg-white px-3 text-sm text-[#222]">
          <span aria-hidden="true">←</span>
          {fakeVisitDetail && stats.siteKey === "*" ? "返回站点总览" : "返回上一步"}
        </a>
      ) : null}
      </div>
      <MemoPad initial={memo} />
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#666]">
          <span>刷量检测</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#18a058]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#18a058]/opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#18a058]" />
            </span>
            实时更新{live.at ? ` · ${new Date(live.at).toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}` : ""}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((card) => {
            const active = card.list === "sites"
              ? realList
              : card.list === "visits"
                ? fakeVisitDetail
                : card.verdict !== null && stats.verdict === card.verdict && !realList;
            const className = `block bg-white px-4 py-3 text-left ${(card.verdict || card.list) ? "hover:bg-[#f7fbf8]" : ""} ${active ? "ring-2 ring-[#18a058]" : ""}`;
            const body = (
              <>
                <div className="flex items-center gap-2 text-sm text-[#666]">
                  <span>{card.label}</span>
                  {card.tag ? <span className="text-xs font-medium text-[#e11]">{card.tag}</span> : null}
                </div>
                <div className="mt-2 text-[28px] font-medium leading-none text-[#18a058] tabular-nums">{card.value}</div>
                <div className="mt-2 text-xs text-[#9aa0a6]">{card.note}</div>
              </>
            );
            if (!card.verdict && !card.list) return <div key={card.label} className={className}>{body}</div>;
            if (card.list === "visits") {
              return (
                <a
                  key={card.label}
                  href={queryHref(action, {
                    from: stats.from,
                    to: stats.to,
                    verdict: "fake",
                    site: "*",
                    account: stats.account,
                    size: pageSize,
                    q: stats.q || "",
                    list: active ? "sites" : "visits",
                  })}
                  className={className}
                >
                  {body}
                </a>
              );
            }
            const nextVerdict = card.verdict && active ? "fake" : card.verdict || stats.verdict;
            const site = card.list === "sites" ? (realList ? stats.siteKey : "*") : nextVerdict === "fake" ? stats.siteKey : "*";
            return (
              <a
                key={card.label}
                href={queryHref(action, {
                  from: stats.from,
                  to: stats.to,
                  verdict: nextVerdict,
                  site,
                  account: stats.account,
                  size: pageSize,
                  q: stats.q || "",
                  list: card.list === "sites" && !realList ? "sites" : undefined,
                })}
                className={className}
              >
                {body}
              </a>
            );
          })}
        </div>
      </div>

      <section className="bg-white">
        <div className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-medium text-[#222]">{realList ? "各站点 · 真实 IP / 假量 / 嫌疑" : siteDetail ? detailLabel : suspectDetail ? "嫌疑明细 · 来路域名 / IP / 设备" : fakeVisitDetail ? "假量明细 · 来路域名 / IP / 设备" : "刷量检测 · 来路域名 / IP / 设备"}</h2>
            {realList ? (
              <p className="mt-1 text-xs text-[#666]">每个站点单独统计并记下自己的 IP。站点内去重，汇总只相加、不再做全库去重；同一 IP 出现在两个站算两次。嫌疑是软特征且没有正常浏览的访问，已计入真实 IP；有正常浏览改真实，脚本态互动才弹窗判假量。点站点名、「IP假量」或「看来路」看来路、IP、设备明细。</p>
            ) : siteDetail && suspectDetail ? (
              <p className="mt-1 text-xs text-[#666]">点站点名进入该站嫌疑明细，可看来路域名、IP、设备。这里是软特征且无正常浏览的访问；有正常浏览的已改真实，脚本态的已走假量。</p>
            ) : fakeVisitDetail && stats.siteKey === "*" ? (
              <p className="mt-1 text-xs text-[#666]">广告商外部来路已确认的假量明细。可看来路域名、IP、设备；点站点名可只看该站。</p>
            ) : !siteDetail && stats.siteKey !== "*" ? (
              <p className="mt-1 text-xs text-[#666]">
                {suspectDetail
                  ? `这个站的真实 IP ${stats.focusIp || pageRows[0]?.siteIpCount || 0}，嫌疑 IP ${stats.focusSuspectIps || pageRows[0]?.siteSuspectIps || 0}，嫌疑 PV ${stats.focusSuspect || pageRows[0]?.siteSuspect || 0}。下面是广告商外部来路、软特征且无正常浏览的嫌疑明细（来路域名 / IP / 设备）。`
                  : `这个站的真实 IP ${stats.focusIp || pageRows[0]?.siteIpCount || 0}，真实 PV ${stats.focusReal || 0}，IP假量 ${stats.focusFakeIps || pageRows[0]?.siteFakeIps || 0}，PV假量 ${stats.focusPv || pageRows[0]?.siteFake || 0}，嫌疑 IP ${stats.focusSuspectIps || pageRows[0]?.siteSuspectIps || 0}，嫌疑 PV ${stats.focusSuspect || pageRows[0]?.siteSuspect || 0}，弹窗未通过 ${stats.focusFake || pageRows[0]?.sitePopupAll || 0}。下面是广告商外部来路已确认的假量明细。收藏夹、直达、站内跳转和滑动成功只加真实量，不进下面的明细。`}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-[#98a]">{stats.from} ~ {stats.to}</span>
        </div>
        <div className="md:hidden">
          {pageRows.length ? pageRows.map((row) => {
            const stay = formatStay(row.dwellMs || 0);
            const noteKey = `${row.accountId}\n${row.site}`;
            const siteMetrics = realList || siteDetail;
            const facts: Array<[string, string]> = realList
              ? [
                  ["滑动成功", String(row.siteSlide || 0)],
                ]
              : siteDetail
              ? [
                  ...(countLabel === "假量" ? [] : [[countLabel, String(row.count)] as [string, string]]),
                ]
              : [
                  ["来路域名", row.traffic || "—"],
                  ["IP", row.ip || "—"],
                  ["归属地", row.ipRegion || "—"],
                  ["设备", row.device || "—"],
                  ["判定", row.note || "—"],
                  ["真实IP", String(row.siteIpCount || 0)],
                  ["IP假量", String(row.siteFakeIps || 0)],
                  ["PV假量", String(row.siteFake || 0)],
                  ["嫌疑IP", String(row.siteSuspectIps || 0)],
                  ["嫌疑PV", String(row.siteSuspect || 0)],
                  ["弹窗未通过", String(row.sitePopupAll || 0)],
                  ["同IP一次", String(row.sitePv || 0)],
                  ["停留时间", stay ? (row.count > 1 ? `合计 ${stay}` : stay) : "—"],
                ];
            return (
              <article key={`${row.account}-${row.site}-${row.host}-${row.ip}`} className="border-t border-[#f2f2f2] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {showAccount ? <div className="text-xs text-[#8a8f98]">{row.account}</div> : null}
                    {showSite || siteDetail || realList ? (
                      siteDetail || realList || visitDetail ? (
                        <a
                          href={queryHref(action, { ...queryBase, list: undefined, site: row.site, account: row.accountId || stats.account, verdict: stats.verdict })}
                          className="block truncate text-base text-[#18a058]"
                        >
                          {row.site}
                        </a>
                      ) : <div className="truncate text-base text-[#222]">{row.site}</div>
                    ) : null}
                    {realList ? (
                      <a
                        href={siteFakeHref(row.site, row.accountId)}
                        className="mt-1 inline-flex text-xs text-[#18a058]"
                      >
                        看来路 / IP / 设备
                      </a>
                    ) : null}
                  </div>
                  {siteMetrics ? null : <div className="shrink-0 text-lg font-medium tabular-nums text-[#18a058]">{row.count}</div>}
                </div>
                {siteMetrics ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
                    <div className="min-w-0 rounded bg-[#f7fbf8] px-2 py-2">
                      <div className="text-[11px] text-[#8a8f98]">真实IP</div>
                      <div className="mt-1 text-base font-medium tabular-nums text-[#18a058]">{row.siteIpCount || 0}</div>
                    </div>
                    <a href={siteFakeHref(row.site, row.accountId)} className="min-w-0 rounded bg-[#fff7f7] px-2 py-2 hover:bg-[#ffecec]">
                      <div className="text-[11px] text-[#8a8f98]">IP假量</div>
                      <div className="mt-1 text-base font-medium tabular-nums text-[#c23]">{row.siteFakeIps || 0}</div>
                    </a>
                    <a href={siteFakeHref(row.site, row.accountId)} className="min-w-0 rounded bg-[#fff7f7] px-2 py-2 hover:bg-[#ffecec]">
                      <div className="text-[11px] text-[#8a8f98]">PV假量</div>
                      <div className="mt-1 text-base font-medium tabular-nums text-[#c23]">{row.siteFake || 0}</div>
                    </a>
                    <a href={siteSuspectHref(row.site, row.accountId)} className="min-w-0 rounded bg-[#fff8f1] px-2 py-2 hover:bg-[#fff1e0]">
                      <div className="text-[11px] text-[#8a8f98]">嫌疑IP</div>
                      <div className="mt-1 text-base font-medium tabular-nums text-[#1677ff]">{row.siteSuspectIps || 0}</div>
                    </a>
                    <a href={siteSuspectHref(row.site, row.accountId)} className="min-w-0 rounded bg-[#fff8f1] px-2 py-2 hover:bg-[#fff1e0]">
                      <div className="text-[11px] text-[#8a8f98]">嫌疑PV</div>
                      <div className="mt-1 text-base font-medium tabular-nums text-[#1677ff]">{row.siteSuspect || 0}</div>
                    </a>
                    <div className="min-w-0 rounded bg-[#f7f8fa] px-2 py-2">
                      <div className="text-[11px] text-[#8a8f98]">弹窗未通过</div>
                      <div className="mt-1 text-base font-medium tabular-nums text-[#333]">{row.sitePopupAll || 0}</div>
                    </div>
                  </div>
                ) : null}
                <label className="mt-2 grid gap-1 text-xs text-[#8a8f98]">
                  站点备注
                  <input
                    value={notes[noteKey] || ""}
                    placeholder="谁的站"
                    maxLength={80}
                    onChange={(event) => {
                      setNotes((prev) => ({ ...prev, [noteKey]: event.target.value }));
                    }}
                    onBlur={(event) => void saveNote(row.accountId, row.site, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className="h-10 w-full rounded border border-[#d9d9d9] bg-white px-2 text-base text-[#333] outline-none"
                  />
                  {noteState[noteKey] ? <span>{noteState[noteKey]}</span> : null}
                </label>
                {facts.length ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    {facts.map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-xs text-[#8a8f98]">{label}</dt>
                        <dd className={label === "设备" ? "whitespace-normal break-words text-[#333]" : "truncate text-[#333]"}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </article>
            );
          }) : (
            <p className="border-t border-[#f2f2f2] px-4 py-8 text-center text-sm text-[#9aa0a6]">
              {realList ? "这段时间没有真实 IP，也没有 IP假量或 PV假量。" : siteDetail ? (stats.q ? `没有域名或备注包含「${stats.q}」的站点。` : `这段时间没有${countLabel}。`) : suspectDetail ? "这段时间没有嫌疑明细。只有软特征且没有正常浏览的访问会显示来路、IP 和设备。" : fakeVisitDetail ? "这段时间没有假量明细。只有广告商外部来路确认的假量会显示来路、IP 和设备。" : "这个站这段时间没有假量明细。真实访问记真实 IP 和真实 PV，不逐条看来路、IP 和设备。"}
            </p>
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className={`w-full text-sm ${realList || siteDetail ? "min-w-[980px]" : "min-w-[1840px]"}`}>
            <thead>
              <tr className="border-y border-[#eee] text-left text-[#666]">
                {showAccount ? <th className="px-4 py-2 font-medium">账号</th> : null}
                {showSite || siteDetail || realList ? <th className="px-4 py-2 font-medium">站点</th> : null}
                <th className="px-4 py-2 font-medium">站点备注</th>
                {realList ? (
                  <>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="没弹窗的访问和滑动成功的不同 IP，同一 IP 在这个站点只算一次">真实IP</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="站点内去重；汇总只相加，同 IP 进别的站另算一次">IP假量</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="这个站点自己的假量访问次数">PV假量</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="软特征且无正常浏览，本站内去重；已计入真实 IP。有正常浏览改真实">嫌疑IP</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="这个站点自己的软特征访问次数">嫌疑PV</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="已弹窗但没有滑动成功的次数（弹窗无关闭键）">弹窗未通过</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium">滑动成功</th>
                    <th className="px-4 py-2 font-medium">明细</th>
                  </>
                ) : siteDetail ? (
                  <>
                    {countLabel === "假量" ? null : <th className="px-4 py-2 text-right font-medium">{countLabel}</th>}
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="没弹窗的访问和滑动成功的不同 IP，同一 IP 在这个站点只算一次">真实IP</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="站点内去重；汇总只相加，同 IP 进别的站另算一次">IP假量</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="这个站点自己的假量访问次数">PV假量</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="软特征且无正常浏览，本站内去重；已计入真实 IP。有正常浏览改真实">嫌疑IP</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="这个站点自己的软特征访问次数">嫌疑PV</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="已弹窗但没有滑动成功的次数（弹窗无关闭键）">弹窗未通过</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-2 font-medium">来路域名</th>
                    <th className="px-4 py-2 font-medium">IP</th>
                    <th className="px-4 py-2 font-medium">归属地</th>
                    <th className="px-4 py-2 font-medium">设备</th>
                    <th className="px-4 py-2 font-medium">判定</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium">次数</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium" title="访客在页停留时长；同一 IP 多次合计">停留时间</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="这个站的真实 IP 总数">真实IP</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="站点内去重；汇总只相加，同 IP 进别的站另算一次">IP假量</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="这个站点自己的假量访问次数">PV假量</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="软特征且无正常浏览，本站内去重；已计入真实 IP。有正常浏览改真实">嫌疑IP</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="这个站点自己的软特征访问次数">嫌疑PV</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="已弹窗但没有滑动成功的次数（弹窗无关闭键）">弹窗未通过</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? pageRows.map((row) => {
                const stay = formatStay(row.dwellMs || 0);
                const noteKey = `${row.accountId}\n${row.site}`;
                return (
                <tr key={`${row.account}-${row.site}-${row.host}-${row.ip}`} className="border-b border-[#f2f2f2]">
                  {showAccount ? <td className="px-4 py-3 text-[#333]">{row.account}</td> : null}
                  {showSite || siteDetail || realList ? (
                    <td className="px-4 py-3 text-[#333]">
                      {siteDetail || realList || visitDetail ? (
                        <a
                          href={queryHref(action, { ...queryBase, list: undefined, site: row.site, account: row.accountId || stats.account, verdict: stats.verdict })}
                          className="text-[#18a058]"
                        >
                          {row.site}
                        </a>
                      ) : row.site}
                    </td>
                  ) : null}
                  <td className="px-4 py-3">
                    <input
                      value={notes[noteKey] || ""}
                      placeholder="谁的站"
                      maxLength={80}
                      onChange={(event) => {
                        setNotes((prev) => ({ ...prev, [noteKey]: event.target.value }));
                      }}
                      onBlur={(event) => void saveNote(row.accountId, row.site, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      className="h-8 w-40 rounded border border-[#d9d9d9] bg-white px-2 text-sm outline-none"
                    />
                    {noteState[noteKey] ? (
                      <span className="ml-2 text-xs text-[#8a8f98]">{noteState[noteKey]}</span>
                    ) : null}
                  </td>
                  {realList ? (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums text-[#18a058]">{row.siteIpCount || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteFakeHref(row.site, row.accountId)} className="text-[#c23] hover:underline">{row.siteFakeIps || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteFakeHref(row.site, row.accountId)} className="text-[#c23] hover:underline">{row.siteFake || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteSuspectHref(row.site, row.accountId)} className="text-[#1677ff] hover:underline">{row.siteSuspectIps || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteSuspectHref(row.site, row.accountId)} className="text-[#1677ff] hover:underline">{row.siteSuspect || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#333]">{row.sitePopupAll || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#333]">{row.siteSlide || 0}</td>
                      <td className="px-4 py-3">
                        <a
                          href={siteFakeHref(row.site, row.accountId)}
                          className="text-[#18a058]"
                        >
                          看来路
                        </a>
                      </td>
                    </>
                  ) : siteDetail ? (
                    <>
                      {countLabel === "假量" ? null : <td className="px-4 py-3 text-right tabular-nums text-[#18a058]">{row.count}</td>}
                      <td className="px-4 py-3 text-right tabular-nums text-[#18a058]">{row.siteIpCount || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteFakeHref(row.site, row.accountId)} className="text-[#c23] hover:underline">{row.siteFakeIps || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteFakeHref(row.site, row.accountId)} className="text-[#c23] hover:underline">{row.siteFake || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteSuspectHref(row.site, row.accountId)} className="text-[#1677ff] hover:underline">{row.siteSuspectIps || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <a href={siteSuspectHref(row.site, row.accountId)} className="text-[#1677ff] hover:underline">{row.siteSuspect || 0}</a>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#333]">{row.sitePopupAll || 0}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-[#333]">{row.traffic || "—"}</td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#333]">{row.ip || "—"}</td>
                      <td className="max-w-[12rem] px-4 py-3 whitespace-normal break-words text-[#666]">{row.ipRegion || "—"}</td>
                      <td className="max-w-xs px-4 py-3 whitespace-normal break-words text-[#333]">{row.device || "—"}</td>
                      <td className="px-4 py-3 text-[#333]">{row.note || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#3b82f6]">{row.count}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#333]">{stay ? (row.count > 1 ? `合计 ${stay}` : stay) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#18a058]">{row.siteIpCount || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#c23]">{row.siteFakeIps || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#c23]">{row.siteFake || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#1677ff]">{row.siteSuspectIps || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#1677ff]">{row.siteSuspect || 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#333]">{row.sitePopupAll || 0}</td>
                    </>
                  )}
                </tr>
                );
              }) : (
                <tr>
                  <td colSpan={realList ? 10 + (showAccount ? 1 : 0) : siteDetail ? (countLabel === "假量" ? 8 : 9) + (showAccount ? 1 : 0) : 13 + (showSite ? 1 : 0) + (showAccount ? 1 : 0)} className="px-4 py-8 text-center text-[#9aa0a6]">
                    {realList ? "这段时间没有真实 IP，也没有 IP假量或 PV假量。" : siteDetail ? (stats.q ? `没有域名或备注包含「${stats.q}」的站点。` : `这段时间没有${countLabel}。`) : suspectDetail ? "这段时间没有嫌疑明细。只有软特征且没有正常浏览的访问会显示来路、IP 和设备。" : fakeVisitDetail ? "这段时间没有假量明细。只有广告商外部来路确认的假量会显示来路、IP 和设备。" : "这个站这段时间没有假量明细。真实访问记真实 IP 和真实 PV，不逐条看来路、IP 和设备。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalRows ? (
          <form id="guard-page" action={action} method="get" className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eee] px-4 py-3 text-sm text-[#666]">
            <input type="hidden" name="from" value={stats.from} />
            <input type="hidden" name="to" value={stats.to} />
            <input type="hidden" name="verdict" value={stats.verdict} />
            <input type="hidden" name="site" value={stats.siteKey} />
            {stats.q ? <input type="hidden" name="q" value={stats.q} /> : null}
            {realList ? <input type="hidden" name="list" value="sites" /> : null}
            {fakeVisitDetail && stats.siteKey === "*" ? <input type="hidden" name="list" value="visits" /> : null}
            <input type="hidden" name="account" value={stats.account} />
            <div className="flex flex-wrap items-center gap-2">
              <span>{realList ? `共 ${totalRows} 个站点` : `共 ${totalRows} 条`}</span>
              <label className="flex items-center gap-2">
                每页
                <select
                  name="size"
                  defaultValue={pageSize}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  className="h-8 rounded border border-[#d9d9d9] bg-white px-2 text-sm text-[#333]"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                条
              </label>
            </div>
            <div className="flex items-center gap-2">
              <a
                aria-disabled={safePage <= 1}
                href={safePage <= 1 ? undefined : queryHref(action, { ...queryBase, site: stats.siteKey, page: safePage - 1 })}
                className={`inline-flex h-8 items-center rounded border border-[#d9d9d9] bg-white px-3 text-sm ${safePage <= 1 ? "pointer-events-none text-[#c5c8ce]" : "text-[#333]"}`}
              >
                上一页
              </a>
              <span className="tabular-nums">{safePage} / {pageCount}</span>
              <a
                aria-disabled={safePage >= pageCount}
                href={safePage >= pageCount ? undefined : queryHref(action, { ...queryBase, site: stats.siteKey, page: safePage + 1 })}
                className={`inline-flex h-8 items-center rounded border border-[#d9d9d9] bg-white px-3 text-sm ${safePage >= pageCount ? "pointer-events-none text-[#c5c8ce]" : "text-[#333]"}`}
              >
                下一页
              </a>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
