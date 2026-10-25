import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listAccounts, normalizeAccountId } from "@/lib/accounts";
import { deviceClaim, noteClaim } from "@/lib/claims";
import { addDays, shanghaiDay, referrerHost } from "@/lib/day";
import { deviceLabel, phoneMark, spoofPhone } from "@/lib/device";
import { sameSite } from "@/lib/registrable";
import { SUSPICIOUS_SCORE } from "@/lib/score";
import { normalizeSiteKey } from "@/lib/site";
import { noteLearnFake, noteLearnHuman } from "@/lib/learn";
import type { StoredEvent } from "@/lib/types";

const ROOT = path.resolve(process.cwd(), "data", "accounts");
const MAX = 2000;
/** 超过此站点数量走增量扫 / 长 TTL 名单，避免 listSites 拖死事件循环。 */
const OVERVIEW_FULL_SCAN_MAX_SITES = 8_000;
/** 后台站点列表只保留假量靠前的站；顶栏数字仍走 day-totals。 */
const OVERVIEW_HEAD_CAP = 800;

/** 后台容器只读检测进程落盘的账本；必须按 mtime 重读，否则页面数字会停住。 */
function isAdminReader() {
  return process.env.TG_ADMIN === "1" || process.env.TG_RELOAD_DISK === "1";
}

type SourceBucket = { fake: number; farm?: number; crawler?: number; other?: number; real?: number };
type DayStat = {
  real?: number;
  fake: number;
  farm?: number;
  crawler?: number;
  other?: number;
  popupShown: number;
  popupClosed: number;
  slidePassed?: number;
  /** How many slidePassed values are already folded into real. */
  slideInReal?: number;
  suspect?: number;
  sources: Record<string, SourceBucket>;
};
type DayFile = Record<string, DayStat>;

export type VerdictFilter = "fake" | "farm" | "crawler" | "other" | "emulator" | "cloud_phone" | "auto" | "suspect";
export type TrafficPart = {
  count: number;
  note: string;
  startedAt: number;
  visitedAt: number;
  dwellMs: number;
};
export type TrafficRow = {
  account: string;
  site: string;
  host: string;
  ip: string;
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
  siteFake?: number;
  siteFakeIps?: number;
  siteSuspect?: number;
  siteSuspectIps?: number;
  siteFarm?: number;
  siteCrawler?: number;
  siteOther?: number;
  siteSlide?: number;
  siteClosed?: number;
  parts: Partial<Record<VerdictFilter, TrafficPart>>;
};

type StoreGlobal = typeof globalThis & {
  __tgEvents?: Map<string, StoredEvent[]>;
  __tgDays?: Map<string, DayFile>;
  __tgReports?: Map<string, { at: number; value: BuiltReport }>;
};
const storeGlobal = globalThis as StoreGlobal;
const cache = storeGlobal.__tgEvents || (storeGlobal.__tgEvents = new Map<string, StoredEvent[]>());
const daysCache = storeGlobal.__tgDays || (storeGlobal.__tgDays = new Map<string, DayFile>());

/**
 * Next 会把这份文件打进多个 server chunk。检查接口和后台页面如果各持一份 Map，
 * 假量账本、脏站点、总览缓存就互不可见：文件在涨，页面数字却停住。
 * 同一进程里的状态都挂在 globalThis 上。
 */
function tgRun(): Record<string, any> {
  const g = storeGlobal as StoreGlobal & { __tgRun?: Record<string, any> };
  if (!g.__tgRun) g.__tgRun = {};
  return g.__tgRun;
}
function tgSet<T>(name: string): Set<T> {
  const run = tgRun();
  if (!run[name]) run[name] = new Set<T>();
  return run[name] as Set<T>;
}
function tgMap<K, V>(name: string): Map<K, V> {
  const run = tgRun();
  if (!run[name]) run[name] = new Map<K, V>();
  return run[name] as Map<K, V>;
}

function locate(accountId: string, siteKey: string) {
  const account = normalizeAccountId(accountId);
  const key = normalizeSiteKey(siteKey);
  if (!account || !key) throw new Error("invalid site");
  const root = path.resolve(ROOT, account, "sites");
  const dir = path.resolve(root, key);
  if (dir !== path.join(root, key)) throw new Error("invalid site");
  return {
    account,
    key,
    cacheKey: `${account}/${key}`,
    dir,
    file: path.join(dir, "events.jsonl"),
    day: path.join(dir, "days.json"),
  };
}

const STALE_PENDING_MS = 60 * 1000;
let rebuildDepth = 0;

function flushStalePending(account: string, key: string, list: StoredEvent[]) {
  if (rebuildDepth > 0) return;
  const cutoff = Date.now() - STALE_PENDING_MS;
  let changed = false;
  for (const event of list) {
    if (!event.pending || event.lab || event.accountId !== account || event.siteKey !== key) continue;
    if (!isReview(event)) continue;
    if ((event.at || 0) > cutoff) continue;
    if (commitPending(account, key, event)) changed = true;
  }
  if (changed) persistEvents(account, key);
}

function loadEvents(accountId: string, siteKey: string): StoredEvent[] {
  const { account, key, cacheKey, file } = locate(accountId, siteKey);
  const cached = cache.get(cacheKey);
  if (cached) {
    flushStalePending(account, key, cached);
    return cached;
  }
  if (!existsSync(file)) {
    const empty: StoredEvent[] = [];
    cache.set(cacheKey, empty);
    return empty;
  }
  const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-MAX);
  const events: StoredEvent[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as StoredEvent;
      if (event.siteKey === key && event.accountId === account) events.push(event);
    } catch {
      /* skip a broken line */
    }
  }
  cache.set(cacheKey, events);
  flushStalePending(account, key, events);
  return events;
}

function persistEvents(accountId: string, siteKey: string) {
  const { cacheKey, file } = locate(accountId, siteKey);
  const list = cache.get(cacheKey) || [];
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, list.map((event) => JSON.stringify(event)).join("\n") + (list.length ? "\n" : ""));
  rollupMemory().delete(cacheKey);
  markSiteDirty(accountId, siteKey);
  invalidateReports();
}

function isSoftSuspect(event: StoredEvent) {
  return event.verdict === "suspicious" && !event.pending && !event.lab && (event.score || 0) >= SUSPICIOUS_SCORE;
}

function emptyStat(): DayStat {
  return { fake: 0, farm: 0, crawler: 0, other: 0, popupShown: 0, popupClosed: 0, slidePassed: 0, suspect: 0, sources: {} };
}

function classesOf(event: StoredEvent) {
  const farm = Boolean(event.farm || event.categories?.includes("datacenter_ip"));
  const crawler = Boolean(event.categories?.includes("known_crawler"));
  return { farm, crawler, other: !farm && !crawler };
}

const AUTO_CODES = new Set(["headless", "webdriver", "automation", "disguised_automation"]);

function hasCategory(event: StoredEvent, code: string) {
  return Boolean(event.categories?.includes(code));
}

function matchesVerdict(event: StoredEvent, verdict: VerdictFilter) {
  if (event.lab || event.pending) return false;
  if (verdict === "suspect") return isSoftSuspect(event) && countsAsFakeTraffic(event);
  if (!isFlagged(event)) return false;
  const flags = classesOf(event);
  if (verdict === "farm") return flags.farm;
  if (verdict === "crawler") return flags.crawler;
  if (verdict === "other") return flags.other;
  if (verdict === "emulator") return hasCategory(event, "emulator");
  if (verdict === "cloud_phone") return hasCategory(event, "cloud_phone");
  if (verdict === "auto") return Boolean(event.categories?.some((code) => AUTO_CODES.has(code)));
  return true;
}

function notesOf(event: StoredEvent) {
  const labels: string[] = [];
  for (const reason of event.reasons || []) {
    if (!reason?.label) continue;
    if ((reason.weight || 0) <= 0 && reason.code !== "perfect_slide") continue;
    if (!labels.includes(reason.label)) labels.push(reason.label);
  }
  // 假量弹窗无关闭键：只有滑动成功才消失。未滑过 / 离开未滑 → 记未通过。
  const needsPopup =
    Boolean(event.challenge) || Boolean(event.popupShown) || Boolean(event.popupClosed);
  if (needsPopup && (event.verdict === "fake" || event.pending || event.popupShown || event.popupClosed)) {
    const status = event.popupShown || event.popupClosed ? "已弹窗·未滑动" : "需弹窗·未滑动";
    if (!labels.includes(status)) labels.push(status);
  }
  return labels;
}

function addClass(stat: DayStat, host: string, flags: { farm: boolean; crawler: boolean; other: boolean }) {
  stat.fake += 1;
  if (flags.farm) stat.farm = (stat.farm || 0) + 1;
  if (flags.crawler) stat.crawler = (stat.crawler || 0) + 1;
  if (flags.other) stat.other = (stat.other || 0) + 1;
  const bucket = stat.sources[host] || { fake: 0, farm: 0, crawler: 0, other: 0 };
  bucket.fake += 1;
  if (flags.farm) bucket.farm = (bucket.farm || 0) + 1;
  if (flags.crawler) bucket.crawler = (bucket.crawler || 0) + 1;
  if (flags.other) bucket.other = (bucket.other || 0) + 1;
  stat.sources[host] = bucket;
}

function eventReferrer(event: { source?: { referrer?: string } | null }) {
  return referrerHost(event.source?.referrer || "");
}

/**
 * 假量只记广告商外部来路。空来路、直达、站内跳转、以及历史上误写的 (bot) 渠道都不算假量。
 */
function countsAsFakeTraffic(event: {
  siteKey?: string;
  source?: { referrer?: string; host?: string } | null;
}) {
  const ref = eventReferrer(event);
  if (!ref || ref === "(bot)") return false;
  const page = String(event.source?.host || event.siteKey || "")
    .trim()
    .toLowerCase();
  if (page && sameSite(ref, page)) return false;
  return true;
}

function fakeSourceHost(event: {
  siteKey?: string;
  source?: { referrer?: string; host?: string } | null;
}) {
  const ref = eventReferrer(event);
  if (!ref || ref === "(bot)") return "";
  const page = String(event.source?.host || event.siteKey || "")
    .trim()
    .toLowerCase();
  if (page && sameSite(ref, page)) return "";
  return ref;
}

function isNonAdSourceHost(host: string, siteKey: string) {
  if (!host || host === "(bot)") return true;
  return Boolean(siteKey && sameSite(host, siteKey));
}

/** 把直达、站内来路上误记的假量改记真实 PV，并从渠道表去掉。 */
function dropNonAdFake(days: DayFile, siteKey: string) {
  let changed = false;
  for (const stat of Object.values(days)) {
    if (!stat?.sources) continue;
    for (const [host, bucket] of Object.entries(stat.sources)) {
      const fake = bucket?.fake || 0;
      if (!fake || !isNonAdSourceHost(host, siteKey)) continue;
      stat.fake = Math.max(0, (stat.fake || 0) - fake);
      if (bucket.farm) stat.farm = Math.max(0, (stat.farm || 0) - (bucket.farm || 0));
      if (bucket.crawler) stat.crawler = Math.max(0, (stat.crawler || 0) - (bucket.crawler || 0));
      if (bucket.other) stat.other = Math.max(0, (stat.other || 0) - (bucket.other || 0));
      stat.real = (stat.real || 0) + fake;
      delete stat.sources[host];
      changed = true;
    }
  }
  return changed;
}

function rebuildDays(accountId: string, siteKey: string): DayFile {
  const { account, key } = locate(accountId, siteKey);
  const days: DayFile = {};
  rebuildDepth += 1;
  try {
    for (const event of loadEvents(account, key)) {
      if (event.lab || event.pending || event.accountId !== account || event.siteKey !== key || !isFlagged(event)) continue;
      if (!countsAsFakeTraffic(event)) continue;
      const day = shanghaiDay(event.at);
      const stat = days[day] || emptyStat();
      addClass(stat, fakeSourceHost(event), classesOf(event));
      if (event.popupShown) stat.popupShown += 1;
      if (event.popupClosed) stat.popupClosed += 1;
      days[day] = stat;
    }
  } finally {
    rebuildDepth -= 1;
  }
  return days;
}

function needsClass(days: DayFile) {
  return Object.values(days).some((stat) => stat && stat.farm === undefined && (stat.fake || 0) > 0);
}

function foldSlidesIntoReal(days: DayFile) {
  let changed = false;
  for (const stat of Object.values(days)) {
    if (!stat) continue;
    const slides = Math.max(0, stat.slidePassed || 0);
    const folded = Math.max(0, stat.slideInReal || 0);
    if (slides <= folded) continue;
    stat.real = Math.max(0, (stat.real || 0) + (slides - folded));
    stat.slideInReal = slides;
    changed = true;
  }
  return changed;
}

const daysRebuildQueued = tgSet<string>("daysRebuildQueued");
function scheduleRebuildDays(accountId: string, siteKey: string) {
  const { cacheKey } = locate(accountId, siteKey);
  if (daysRebuildQueued.has(cacheKey)) return;
  daysRebuildQueued.add(cacheKey);
  setTimeout(() => {
    daysRebuildQueued.delete(cacheKey);
    try {
      const { account, key, cacheKey: ck } = locate(accountId, siteKey);
      const current = daysCache.get(ck) || {};
      const rebuilt = rebuildDays(accountId, siteKey);
      for (const [dayKey, stat] of Object.entries(current)) {
        if (!stat) continue;
        const next = rebuilt[dayKey] || emptyStat();
        // 热路径上已累加的增量并回重建结果
        next.real = Math.max(next.real || 0, stat.real || 0);
        next.suspect = Math.max(next.suspect || 0, stat.suspect || 0);
        next.fake = Math.max(next.fake || 0, stat.fake || 0);
        next.farm = Math.max(next.farm || 0, stat.farm || 0);
        next.crawler = Math.max(next.crawler || 0, stat.crawler || 0);
        next.other = Math.max(next.other || 0, stat.other || 0);
        next.popupShown = Math.max(next.popupShown || 0, stat.popupShown || 0);
        next.popupClosed = Math.max(next.popupClosed || 0, stat.popupClosed || 0);
        next.slidePassed = Math.max(next.slidePassed || 0, stat.slidePassed || 0);
        if (stat.slideInReal) next.slideInReal = Math.max(next.slideInReal || 0, stat.slideInReal || 0);
        if (stat.sources) next.sources = { ...(next.sources || {}), ...stat.sources };
        rebuilt[dayKey] = next;
      }
      foldSlidesIntoReal(rebuilt);
      dropNonAdFake(rebuilt, key);
      daysCache.set(ck, rebuilt);
      saveDays(account, key);
      reseedLiveAccount(account);
      flushStalePending(account, key, cache.get(ck) || []);
    } catch {
      /* keep serving memory stats */
    }
  }, 25);
}

const daysFileMtime = tgMap<string, number>("daysFileMtime");

function fileNewer(file: string, seenMtime: number) {
  try {
    if (!existsSync(file)) return false;
    return statSync(file).mtimeMs > seenMtime;
  } catch {
    return false;
  }
}

function loadDays(accountId: string, siteKey: string): DayFile {
  const { account, key, cacheKey, day } = locate(accountId, siteKey);
  const cached = daysCache.get(cacheKey);
  if (cached && !(isAdminReader() && fileNewer(day, daysFileMtime.get(cacheKey) || 0))) {
    return cached;
  }
  if (existsSync(day)) {
    try {
      const mtime = statSync(day).mtimeMs;
      const parsed = JSON.parse(readFileSync(day, "utf8")) as DayFile;
      const days = parsed && typeof parsed === "object" ? parsed : {};
      // 后台只读：不要 fold/save，避免和检测进程互相覆盖。
      if (isAdminReader()) {
        daysCache.set(cacheKey, days);
        daysFileMtime.set(cacheKey, mtime);
        return days;
      }
      const changed = foldSlidesIntoReal(days) || dropNonAdFake(days, key);
      daysCache.set(cacheKey, days);
      daysFileMtime.set(cacheKey, mtime);
      if (changed) saveDays(accountId, siteKey);
      // 分类补齐改异步，禁止在 check 热路径同步 rebuildDays
      if (needsClass(days)) scheduleRebuildDays(accountId, siteKey);
      flushStalePending(account, key, cache.get(cacheKey) || []);
      return days;
    } catch {
      const empty: DayFile = {};
      daysCache.set(cacheKey, empty);
      return empty;
    }
  }
  // 无 days.json：先空账接待，后台再从 events 重建
  const empty: DayFile = {};
  daysCache.set(cacheKey, empty);
  if (!isAdminReader()) {
    scheduleRebuildDays(accountId, siteKey);
    flushStalePending(account, key, cache.get(cacheKey) || []);
  }
  return empty;
}

/** 站点 days.json 脏集：检测路径只改内存，定时批量落盘，避免每次 check 同步写盘拖死事件循环。 */
const daysFileDirty = tgSet<string>("daysFileDirty");
function daysFlushTimer() {
  return tgRun().daysFlushTimer as ReturnType<typeof setTimeout> | null;
}
function setDaysFlushTimer(timer: ReturnType<typeof setTimeout> | null) {
  tgRun().daysFlushTimer = timer;
}
function flushDaysFiles() {
  setDaysFlushTimer(null);
  // 小批量 + 让出事件循环，避免一次刷盘卡住 check/admin
  const batch = [...daysFileDirty].slice(0, 40);
  const start = Date.now();
  for (const cacheKey of batch) {
    daysFileDirty.delete(cacheKey);
    const slash = cacheKey.indexOf("/");
    if (slash < 0) continue;
    const accountId = cacheKey.slice(0, slash);
    const siteKey = cacheKey.slice(slash + 1);
    const { day } = locate(accountId, siteKey);
    try {
      mkdirSync(path.dirname(day), { recursive: true });
      writeFileSync(day, JSON.stringify(daysCache.get(cacheKey) || {}));
    } catch {
      /* memory copy still serves; retry next tick */
      daysFileDirty.add(cacheKey);
    }
    if (Date.now() - start > 12) break;
  }
  if (daysFileDirty.size) {
    setDaysFlushTimer(setTimeout(flushDaysFiles, 40));
  }
}
function scheduleDaysFlush() {
  if (daysFlushTimer()) return;
  setDaysFlushTimer(setTimeout(flushDaysFiles, 1000));
}

function saveDays(accountId: string, siteKey: string) {
  const { cacheKey } = locate(accountId, siteKey);
  daysFileDirty.add(cacheKey);
  markSiteDirty(accountId, siteKey);
  scheduleDaysFlush();
}

function touchDay(accountId: string, siteKey: string, day: string, edit: (stat: DayStat) => void) {
  const { cacheKey } = locate(accountId, siteKey);
  const days = loadDays(accountId, siteKey);
  const prev = days[day] || emptyStat();
  const before = {
    fake: prev.fake || 0,
    real: prev.real || 0,
    suspect: prev.suspect || 0,
    farm: prev.farm || 0,
    crawler: prev.crawler || 0,
    other: prev.other || 0,
    slidePassed: prev.slidePassed || 0,
    popupShown: prev.popupShown || 0,
  };
  const stat = days[day] || emptyStat();
  edit(stat);
  days[day] = stat;
  daysCache.set(cacheKey, days);
  saveDays(accountId, siteKey);
  bumpLiveDays(accountId, day, {
    fake: (stat.fake || 0) - before.fake,
    real: (stat.real || 0) - before.real,
    suspect: (stat.suspect || 0) - before.suspect,
    farm: (stat.farm || 0) - before.farm,
    crawler: (stat.crawler || 0) - before.crawler,
    other: (stat.other || 0) - before.other,
    slidePassed: (stat.slidePassed || 0) - before.slidePassed,
    popupShown: (stat.popupShown || 0) - before.popupShown,
  });
}

export function isFlagged(event: StoredEvent) {
  return event.verdict === "fake" || event.farm || event.categories.includes("datacenter_ip");
}

function isReview(event: StoredEvent) {
  return isFlagged(event) || (event.verdict === "suspicious" && (event.score || 0) >= SUSPICIOUS_SCORE);
}

export function addEvent(event: StoredEvent) {
  const { account, key, cacheKey, file } = locate(event.accountId, event.siteKey);
  if (event.accountId !== account || event.siteKey !== key) return;
  const list = loadEvents(account, key);
  list.push(event);
  if (list.length > MAX) list.splice(0, list.length - MAX);
  cache.set(cacheKey, list);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(event) + "\n");
  rollupMemory().delete(cacheKey);
  markSiteDirty(account, key);
  invalidateReports();
  noteClaim(event);
}

export function recordVisit(event: StoredEvent, options?: { defer?: boolean; replaceReal?: boolean }) {
  if (!normalizeAccountId(event.accountId)) return;
  if (event.lab) {
    if (isReview(event)) addEvent(event);
    return;
  }
  if (options?.replaceReal) releaseReal(event);
  // 非广告来路（收藏夹、直达、站内跳转）：记真实 IP / 真实 PV，不走假量。
  if (!countsAsFakeTraffic(event)) {
    try {
      noteReal(event);
    } catch {
      /* a counting failure must not change the allow response */
    }
    return;
  }
  // 无操作/轻触的普通软嫌疑：记嫌疑 + 真实 IP，并落明细，不挡页。
  // 群控/仿真人或脚本态已在 check 里改假量并走弹窗；普通软特征有正常浏览的已改真实。
  if (!event.challenge && event.verdict === "suspicious" && (event.score || 0) >= SUSPICIOUS_SCORE) {
    noteSuspect(event);
    addEvent(event);
    return;
  }
  if (!isReview(event)) {
    if (event.lab) return;
    try {
      noteReal(event);
    } catch {
      /* a counting failure must not change the allow response */
    }
    return;
  }
  if (event.lab) {
    addEvent(event);
    return;
  }
  const located = locate(event.accountId, event.siteKey);
  event.pending = true;
  addEvent(event);
  // 判定假量后：在页上先弹窗等滑动（无关闭键）；滑到头改真实。
  // 不滑、超时，或离开时还没滑，都算未通过 → 落假量。
  if (options?.defer) return;
  commitPending(located.account, located.key, event);
  persistEvents(located.account, located.key);
}

function commitPending(account: string, key: string, event: StoredEvent) {
  if (!event.pending) return false;
  if (event.verdict === "suspicious") event.verdict = "fake";
  // 非广告来路的待确认访问改记真实量。
  if (!countsAsFakeTraffic(event)) {
    event.pending = false;
    try {
      noteReal(event);
    } catch {
      /* keep the response path clear */
    }
    return true;
  }
  const host = fakeSourceHost(event);
  const flags = classesOf(event);
  touchDay(account, key, shanghaiDay(event.at), (stat) => {
    addClass(stat, host, flags);
    if (event.popupShown) stat.popupShown += 1;
    if (event.popupClosed) stat.popupClosed += 1;
  });
  // 确认假量后写入自我学习账本（来路 / 出口 / 设备），下次更容易抓到。
  noteLearnFake({ accountId: account, host, ip: event.ip || "", fp: event.fp || "" });
  event.pending = false;
  return true;
}

export function markPopup(accountId: string, siteKey: string, id: string, kind: "show" | "close") {
  const { account, key } = locate(accountId, siteKey);
  const event = loadEvents(account, key).find((item) => item.id === id && item.accountId === account && item.siteKey === key && !item.lab && isReview(item));
  if (!event) return false;
  // 弹窗无关闭键：close 只记「已露出」，不落假量、不撤遮罩；只有滑动成功才放行。
  // 未滑过的假量由停留超时 / 离开 / 过期待确认落库。
  if (kind === "close") kind = "show";
  if (!event.popupShown) {
    event.popupShown = true;
    if (!event.pending && countsAsFakeTraffic(event)) {
      touchDay(account, key, shanghaiDay(event.at), (stat) => {
        stat.popupShown += 1;
      });
    }
    persistEvents(account, key);
  }
  return true;
}

/** 单站每天最多记住多少个真实/嫌疑 IP；顶满后新 IP 不再进该站名单。 */
const REAL_IP_CAP = 100_000;
type RealIpFile = Record<string, string[]>;
/** 与 RealIpFile 并行的 Set 索引：热站 IP 可达数万，禁止每次 includes 扫全表。 */
type RealIpSets = Map<string, Set<string>>;
function ipSetMemory(kind: "real" | "suspect") {
  const name = kind === "real" ? "realIpSets" : "suspectIpSets";
  return tgMap<string, RealIpSets>(name);
}
function dayIpSet(kind: "real" | "suspect", cacheKey: string, day: string, list?: string[]) {
  const root = ipSetMemory(kind);
  let byDay = root.get(cacheKey);
  if (!byDay) {
    byDay = new Map();
    root.set(cacheKey, byDay);
  }
  let set = byDay.get(day);
  if (!set) {
    set = new Set(list || []);
    byDay.set(day, set);
  }
  return set;
}
function dropDayIpSet(kind: "real" | "suspect", cacheKey: string, day: string) {
  const byDay = ipSetMemory(kind).get(cacheKey);
  if (!byDay) return;
  byDay.delete(day);
}

/**
 * 账号级 IP 引用账本（ip-totals.json / 内存引用计数）。
 * 顶栏「真实 IP / 嫌疑 IP」按站分别去重后再相加：同一 IP 进站1和站2算两次。
 * 此账本仍可用于其它内部合并，不再覆盖顶栏展示。
 */
type IpKind = "real" | "suspect";
type AccountIpDay = { real: number; suspect: number };
type AccountIpFile = Record<string, AccountIpDay>;
type IpRefDay = { real: Map<string, number>; suspect: Map<string, number> };

const accountIpTotalsMem = tgMap<string, AccountIpFile>("accountIpTotalsMem");
const accountIpRefs = tgMap<string, Record<string, IpRefDay>>("accountIpRefs");
const accountIpRefsReady = tgSet<string>("accountIpRefsReady");
const accountIpBuilding = tgSet<string>("accountIpBuilding");
const accountIpDirty = tgSet<string>("accountIpDirty");
/** 重建扫站期间有新的 remember/forget：扫完后延迟再扫一次，避免与站点文件双计。 */
const accountIpResync = tgSet<string>("accountIpResync");
const accountIpResyncAt = tgMap<string, number>("accountIpResyncAt");

function ipTotalsFile(accountId: string) {
  return path.resolve(ROOT, accountId, "ip-totals.json");
}

function emptyIpDay(): AccountIpDay {
  return { real: 0, suspect: 0 };
}

function emptyIpRefs(): IpRefDay {
  return { real: new Map(), suspect: new Map() };
}

function ipFlushTimer() {
  return tgRun().accountIpFlushTimer as ReturnType<typeof setTimeout> | null;
}

function setIpFlushTimer(timer: ReturnType<typeof setTimeout> | null) {
  tgRun().accountIpFlushTimer = timer;
}

function flushAccountIpTotals() {
  setIpFlushTimer(null);
  for (const account of [...accountIpDirty]) {
    const data = accountIpTotalsMem.get(account);
    if (!data) {
      accountIpDirty.delete(account);
      continue;
    }
    try {
      mkdirSync(path.dirname(ipTotalsFile(account)), { recursive: true });
      writeFileSync(ipTotalsFile(account), JSON.stringify(data));
    } catch {
      /* memory copy still serves */
    }
    accountIpDirty.delete(account);
  }
}

function scheduleAccountIpFlush() {
  if (ipFlushTimer()) return;
  setIpFlushTimer(setTimeout(flushAccountIpTotals, 800));
}

const accountIpTotalsMtime = tgMap<string, number>("accountIpTotalsMtime");

function readAccountIpTotals(accountId: string): AccountIpFile | null {
  const account = normalizeAccountId(accountId);
  if (!account) return null;
  const file = ipTotalsFile(account);
  const hit = accountIpTotalsMem.get(account);
  if (hit && !(isAdminReader() && fileNewer(file, accountIpTotalsMtime.get(account) || 0))) {
    return hit;
  }
  if (!existsSync(file)) return hit || null;
  try {
    const mtime = statSync(file).mtimeMs;
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const data: AccountIpFile = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [day, row] of Object.entries(raw as Record<string, unknown>)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        data[day] = {
          real: Math.max(0, Number(rec.real) || 0),
          suspect: Math.max(0, Number(rec.suspect) || 0),
        };
      }
    }
    accountIpTotalsMem.set(account, data);
    accountIpTotalsMtime.set(account, mtime);
    return data;
  } catch {
    return hit || null;
  }
}

function syncIpDayCount(account: string, day: string, refs: IpRefDay) {
  let file = accountIpTotalsMem.get(account);
  if (!file) {
    file = {};
    accountIpTotalsMem.set(account, file);
  }
  const next: AccountIpDay = { real: refs.real.size, suspect: refs.suspect.size };
  if (!next.real && !next.suspect) delete file[day];
  else file[day] = next;
  accountIpDirty.add(account);
  scheduleAccountIpFlush();
}

function applyAccountIpBump(account: string, day: string, kind: IpKind, ip: string, delta: number) {
  let refsByDay = accountIpRefs.get(account);
  if (!refsByDay) {
    refsByDay = {};
    accountIpRefs.set(account, refsByDay);
  }
  const refs = refsByDay[day] || emptyIpRefs();
  refsByDay[day] = refs;
  const bag = kind === "real" ? refs.real : refs.suspect;
  const prev = bag.get(ip) || 0;
  const next = prev + delta;
  if (next <= 0) bag.delete(ip);
  else bag.set(ip, next);
  syncIpDayCount(account, day, refs);
}

function bumpAccountIp(accountId: string, day: string, kind: IpKind, ip: string, delta: number) {
  const account = normalizeAccountId(accountId);
  const value = ip.trim();
  if (!account || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !value || value.length > 80 || /\s/.test(value)) return;
  if (delta !== 1 && delta !== -1) return;
  if (!accountIpRefsReady.has(account) || accountIpBuilding.has(account)) {
    // 站点 real-ips/suspect-ips 已落盘；重建以文件为准，这里只记需要补扫。
    accountIpResync.add(account);
    ensureAccountIpTotals(account);
    return;
  }
  applyAccountIpBump(account, day, kind, value, delta);
}

function ingestSiteIpFile(refsByDay: Record<string, IpRefDay>, filePath: string, kind: IpKind) {
  if (!existsSync(filePath)) return;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [day, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(list)) continue;
      const refs = refsByDay[day] || emptyIpRefs();
      refsByDay[day] = refs;
      const bag = kind === "real" ? refs.real : refs.suspect;
      for (const ip of list) {
        if (typeof ip !== "string" || !ip) continue;
        bag.set(ip, (bag.get(ip) || 0) + 1);
      }
    }
  } catch {
    /* skip broken site file */
  }
}

function rebuildAccountIpTotals(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account || accountIpBuilding.has(account)) return;
  accountIpBuilding.add(account);
  accountIpRefsReady.delete(account);
  readAccountIpTotals(account);
  const refsByDay: Record<string, IpRefDay> = {};
  const sites = listSites(account);
  let index = 0;
  const step = () => {
    const start = Date.now();
    for (; index < sites.length && Date.now() - start < 30; index += 1) {
      const dir = path.join(ROOT, account, "sites", sites[index]);
      ingestSiteIpFile(refsByDay, path.join(dir, "real-ips.json"), "real");
      ingestSiteIpFile(refsByDay, path.join(dir, "suspect-ips.json"), "suspect");
    }
    if (index < sites.length) {
      setImmediate(step);
      return;
    }
    const totals: AccountIpFile = {};
    for (const [day, refs] of Object.entries(refsByDay)) {
      if (!refs.real.size && !refs.suspect.size) continue;
      totals[day] = { real: refs.real.size, suspect: refs.suspect.size };
    }
    accountIpRefs.set(account, refsByDay);
    accountIpTotalsMem.set(account, totals);
    accountIpRefsReady.add(account);
    accountIpDirty.add(account);
    scheduleAccountIpFlush();
    accountIpBuilding.delete(account);
    if (accountIpResync.has(account)) {
      accountIpResync.delete(account);
      const now = Date.now();
      if (now - (accountIpResyncAt.get(account) || 0) >= 30_000) {
        accountIpResyncAt.set(account, now);
        setTimeout(() => {
          accountIpRefsReady.delete(account);
          rebuildAccountIpTotals(account);
        }, 30_000);
      }
    }
  };
  setImmediate(step);
}

function ensureAccountIpTotals(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account) return;
  readAccountIpTotals(account);
  // 后台只读盘上的 ip-totals，禁止再扫站重建。
  if (isAdminReader()) return;
  if (accountIpRefsReady.has(account) || accountIpBuilding.has(account)) return;
  rebuildAccountIpTotals(account);
}

/** 账号内 IP 并集（内部备用）。顶栏已改为各站相加，不再用此覆盖展示。 */
function fastIpTotals(accounts: { id: string }[], from: string, to: string): Partial<BundleTotals> | null {
  if (!accounts.length) return { realIps: 0, suspectIps: 0 };
  let realIps = 0;
  let suspectIps = 0;
  let any = false;
  for (const account of accounts) {
    const id = normalizeAccountId(account.id);
    if (!id) continue;
    ensureAccountIpTotals(id);
    if (accountIpRefsReady.has(id)) {
      const refsByDay = accountIpRefs.get(id) || {};
      const realSet = new Set<string>();
      const susSet = new Set<string>();
      for (const [day, refs] of Object.entries(refsByDay)) {
        if (day < from || day > to || !refs) continue;
        for (const ip of refs.real.keys()) realSet.add(ip);
        for (const ip of refs.suspect.keys()) susSet.add(ip);
      }
      realIps += realSet.size;
      suspectIps += susSet.size;
      any = true;
      continue;
    }
    const file = accountIpTotalsMem.get(id);
    if (!file) continue;
    any = true;
    for (const [day, tot] of Object.entries(file)) {
      if (day < from || day > to || !tot) continue;
      realIps += tot.real || 0;
      suspectIps += tot.suspect || 0;
    }
  }
  return any ? { realIps, suspectIps } : null;
}

function realIpMemory() {
  const g = storeGlobal as StoreGlobal & { __tgRealIps?: Map<string, RealIpFile> };
  if (!g.__tgRealIps) g.__tgRealIps = new Map();
  return g.__tgRealIps;
}

const realIpFileMtime = tgMap<string, number>("realIpFileMtime");

function loadRealIps(accountId: string, siteKey: string): RealIpFile {
  const { cacheKey, dir } = locate(accountId, siteKey);
  const memory = realIpMemory();
  const file = path.join(dir, "real-ips.json");
  const cached = memory.get(cacheKey);
  if (cached && !(isAdminReader() && fileNewer(file, realIpFileMtime.get(cacheKey) || 0))) {
    return cached;
  }
  const days: RealIpFile = {};
  let mtime = 0;
  if (existsSync(file)) {
    try {
      mtime = statSync(file).mtimeMs;
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [day, list] of Object.entries(raw as Record<string, unknown>)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(list)) continue;
          const ips: string[] = [];
          const seen = new Set<string>();
          for (const ip of list) {
            if (typeof ip !== "string" || !ip || seen.has(ip) || ips.length >= REAL_IP_CAP) continue;
            seen.add(ip);
            ips.push(ip);
          }
          if (ips.length) {
            days[day] = ips;
            dayIpSet("real", cacheKey, day, ips);
          }
        }
      }
    } catch {
      /* a broken file starts empty; the next pass writes a clean one */
    }
  }
  memory.set(cacheKey, days);
  if (mtime) realIpFileMtime.set(cacheKey, mtime);
  return days;
}

const realIpFileDirty = tgSet<string>("realIpFileDirty");
const suspectIpFileDirty = tgSet<string>("suspectIpFileDirty");
function ipFileFlushTimer() {
  return tgRun().ipFileFlushTimer as ReturnType<typeof setTimeout> | null;
}
function setIpFileFlushTimer(timer: ReturnType<typeof setTimeout> | null) {
  tgRun().ipFileFlushTimer = timer;
}
function flushIpFiles() {
  setIpFileFlushTimer(null);
  const start = Date.now();
  const realBatch = [...realIpFileDirty].slice(0, 30);
  for (const cacheKey of realBatch) {
    realIpFileDirty.delete(cacheKey);
    const slash = cacheKey.indexOf("/");
    if (slash < 0) continue;
    const accountId = cacheKey.slice(0, slash);
    const siteKey = cacheKey.slice(slash + 1);
    const { dir } = locate(accountId, siteKey);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "real-ips.json"), JSON.stringify(realIpMemory().get(cacheKey) || {}));
    } catch {
      realIpFileDirty.add(cacheKey);
    }
    if (Date.now() - start > 12) break;
  }
  const susBatch = [...suspectIpFileDirty].slice(0, 30);
  for (const cacheKey of susBatch) {
    if (Date.now() - start > 12) break;
    suspectIpFileDirty.delete(cacheKey);
    const slash = cacheKey.indexOf("/");
    if (slash < 0) continue;
    const accountId = cacheKey.slice(0, slash);
    const siteKey = cacheKey.slice(slash + 1);
    const { dir } = locate(accountId, siteKey);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "suspect-ips.json"), JSON.stringify(suspectIpMemory().get(cacheKey) || {}));
    } catch {
      suspectIpFileDirty.add(cacheKey);
    }
  }
  if (realIpFileDirty.size || suspectIpFileDirty.size) {
    setIpFileFlushTimer(setTimeout(flushIpFiles, 50));
  }
}
function scheduleIpFileFlush() {
  if (ipFileFlushTimer()) return;
  setIpFileFlushTimer(setTimeout(flushIpFiles, 1200));
}

function rememberRealIp(accountId: string, siteKey: string, day: string, ip: string) {
  const value = ip.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value || value.length > 80 || /\s/.test(value)) return;
  const { cacheKey } = locate(accountId, siteKey);
  const days = loadRealIps(accountId, siteKey);
  const list = days[day] || [];
  const set = dayIpSet("real", cacheKey, day, list);
  if (set.has(value) || list.length >= REAL_IP_CAP) return;
  set.add(value);
  days[day] = list.concat(value);
  realIpMemory().set(cacheKey, days);
  realIpFileDirty.add(cacheKey);
  scheduleIpFileFlush();
  bumpAccountIp(accountId, day, "real", value, 1);
  markSiteDirty(accountId, siteKey);
}

function forgetRealIp(accountId: string, siteKey: string, day: string, ip: string) {
  const value = ip.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value) return;
  const { cacheKey } = locate(accountId, siteKey);
  const days = loadRealIps(accountId, siteKey);
  const list = days[day] || [];
  const set = dayIpSet("real", cacheKey, day, list);
  if (!set.has(value)) return;
  set.delete(value);
  const at = list.indexOf(value);
  if (at >= 0) list.splice(at, 1);
  if (list.length) days[day] = list;
  else {
    delete days[day];
    dropDayIpSet("real", cacheKey, day);
  }
  realIpMemory().set(cacheKey, days);
  realIpFileDirty.add(cacheKey);
  scheduleIpFileFlush();
  bumpAccountIp(accountId, day, "real", value, -1);
  markSiteDirty(accountId, siteKey);
}

function noteReal(event: StoredEvent) {
  // 爬虫/无头不进真实 IP，避免和百度统计差一截。
  const cats = event.categories || [];
  if (cats.some((code) => code === "known_crawler" || code === "webdriver" || code === "headless" || code === "automation" || code === "disguised_automation")) {
    return;
  }
  const day = shanghaiDay(event.at);
  // 之后又判真实时，不要继续占着嫌疑 IP。
  forgetSuspectIp(event.accountId, event.siteKey, day, event.ip || "");
  touchDay(event.accountId, event.siteKey, day, (stat) => {
    stat.real = (stat.real || 0) + 1;
  });
  rememberRealIp(event.accountId, event.siteKey, day, event.ip || "");
}

function releaseReal(event: StoredEvent) {
  const day = shanghaiDay(event.at);
  touchDay(event.accountId, event.siteKey, day, (stat) => {
    stat.real = Math.max(0, (stat.real || 0) - 1);
  });
  forgetRealIp(event.accountId, event.siteKey, day, event.ip || "");
}

function noteSuspect(event: StoredEvent) {
  const day = shanghaiDay(event.at);
  touchDay(event.accountId, event.siteKey, day, (stat) => {
    stat.suspect = (stat.suspect || 0) + 1;
  });
  // 嫌疑只是软特征、页面照常打开：IP 仍计入真实 IP，同时进嫌疑名单。
  rememberRealIp(event.accountId, event.siteKey, day, event.ip || "");
  rememberSuspectIp(event.accountId, event.siteKey, day, event.ip || "");
}

function suspectIpMemory() {
  const g = storeGlobal as StoreGlobal & { __tgSuspectIps?: Map<string, RealIpFile> };
  if (!g.__tgSuspectIps) g.__tgSuspectIps = new Map();
  return g.__tgSuspectIps;
}

const suspectIpFileMtime = tgMap<string, number>("suspectIpFileMtime");

function loadSuspectIps(accountId: string, siteKey: string): RealIpFile {
  const { cacheKey, dir } = locate(accountId, siteKey);
  const memory = suspectIpMemory();
  const file = path.join(dir, "suspect-ips.json");
  const cached = memory.get(cacheKey);
  if (cached && !(isAdminReader() && fileNewer(file, suspectIpFileMtime.get(cacheKey) || 0))) {
    return cached;
  }
  const days: RealIpFile = {};
  let mtime = 0;
  if (existsSync(file)) {
    try {
      mtime = statSync(file).mtimeMs;
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [day, list] of Object.entries(raw as Record<string, unknown>)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(list)) continue;
          const ips: string[] = [];
          const seen = new Set<string>();
          for (const ip of list) {
            if (typeof ip !== "string" || !ip || seen.has(ip) || ips.length >= REAL_IP_CAP) continue;
            seen.add(ip);
            ips.push(ip);
          }
          if (ips.length) {
            days[day] = ips;
            dayIpSet("suspect", cacheKey, day, ips);
          }
        }
      }
    } catch {
      /* a broken file starts empty */
    }
  }
  memory.set(cacheKey, days);
  if (mtime) suspectIpFileMtime.set(cacheKey, mtime);
  return days;
}

function rememberSuspectIp(accountId: string, siteKey: string, day: string, ip: string) {
  const value = ip.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value || value.length > 80 || /\s/.test(value)) return;
  const { cacheKey } = locate(accountId, siteKey);
  const days = loadSuspectIps(accountId, siteKey);
  const list = days[day] || [];
  const set = dayIpSet("suspect", cacheKey, day, list);
  if (set.has(value) || list.length >= REAL_IP_CAP) return;
  set.add(value);
  days[day] = list.concat(value);
  suspectIpMemory().set(cacheKey, days);
  suspectIpFileDirty.add(cacheKey);
  scheduleIpFileFlush();
  bumpAccountIp(accountId, day, "suspect", value, 1);
  markSiteDirty(accountId, siteKey);
}

function forgetSuspectIp(accountId: string, siteKey: string, day: string, ip: string) {
  const value = ip.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value) return;
  const { cacheKey } = locate(accountId, siteKey);
  const days = loadSuspectIps(accountId, siteKey);
  const list = days[day] || [];
  const set = dayIpSet("suspect", cacheKey, day, list);
  if (!set.has(value)) return;
  set.delete(value);
  const at = list.indexOf(value);
  if (at >= 0) list.splice(at, 1);
  if (list.length) days[day] = list;
  else {
    delete days[day];
    dropDayIpSet("suspect", cacheKey, day);
  }
  suspectIpMemory().set(cacheKey, days);
  suspectIpFileDirty.add(cacheKey);
  scheduleIpFileFlush();
  bumpAccountIp(accountId, day, "suspect", value, -1);
  markSiteDirty(accountId, siteKey);
}

function suspectIpCount(accountId: string, siteKey: string, from: string, to: string) {
  const ips = new Set<string>();
  for (const [day, list] of Object.entries(loadSuspectIps(accountId, siteKey))) {
    if (day < from || day > to) continue;
    for (const ip of list) ips.add(ip);
  }
  return ips.size;
}

function realIpCount(accountId: string, siteKey: string, from: string, to: string) {
  const ips = new Set<string>();
  for (const [day, list] of Object.entries(loadRealIps(accountId, siteKey))) {
    if (day < from || day > to) continue;
    for (const ip of list) ips.add(ip);
  }
  return ips.size;
}

function realIpsInRange(accountId: string, siteKey: string, from: string, to: string) {
  try {
    const file = path.join(locate(accountId, siteKey).dir, "real-ips.json");
    if (shanghaiDay(statSync(file).mtimeMs) < from) return 0;
  } catch {
    return 0;
  }
  return realIpCount(accountId, siteKey, from, to);
}

export function acceptHuman(accountId: string, siteKey: string, id: string) {
  const { account, key, cacheKey } = locate(accountId, siteKey);
  const list = loadEvents(account, key);
  const index = list.findIndex((item) => item.id === id && item.accountId === account && item.siteKey === key && !item.lab && isReview(item));
  if (index < 0) return false;
  const event = list[index];
  const flags = classesOf(event);
  const host = fakeSourceHost(event);
  const day = shanghaiDay(event.at);
  const countedFake = !event.pending && countsAsFakeTraffic(event);
  rememberRealIp(account, key, day, event.ip || "");
  touchDay(account, key, day, (stat) => {
    stat.slidePassed = (stat.slidePassed || 0) + 1;
    stat.real = (stat.real || 0) + 1;
    stat.slideInReal = (stat.slideInReal || 0) + 1;
    if (!countedFake) return;
    stat.fake = Math.max(0, (stat.fake || 0) - 1);
    if (flags.farm) stat.farm = Math.max(0, (stat.farm || 0) - 1);
    if (flags.crawler) stat.crawler = Math.max(0, (stat.crawler || 0) - 1);
    if (flags.other) stat.other = Math.max(0, (stat.other || 0) - 1);
    if (event.popupShown) stat.popupShown = Math.max(0, (stat.popupShown || 0) - 1);
    if (event.popupClosed) stat.popupClosed = Math.max(0, (stat.popupClosed || 0) - 1);
    const bucket = stat.sources[host];
    if (bucket) {
      bucket.fake = Math.max(0, (bucket.fake || 0) - 1);
      if (flags.farm) bucket.farm = Math.max(0, (bucket.farm || 0) - 1);
      if (flags.crawler) bucket.crawler = Math.max(0, (bucket.crawler || 0) - 1);
      if (flags.other) bucket.other = Math.max(0, (bucket.other || 0) - 1);
      if ((bucket.fake || 0) <= 0) delete stat.sources[host];
    }
  });
  list.splice(index, 1);
  cache.set(cacheKey, list);
  persistEvents(account, key);
  // 滑到头说明有真人，压低来路 / 出口 / 设备的误伤。
  noteLearnHuman({ accountId: account, host, ip: event.ip || "", fp: event.fp || "" });
  return true;
}

export function failSlide(accountId: string, siteKey: string, id: string) {
  const { account, key } = locate(accountId, siteKey);
  const event = loadEvents(account, key).find((item) => item.id === id && item.accountId === account && item.siteKey === key && !item.lab && isReview(item));
  if (!event) return false;
  if (!event.pending) return true;
  event.popupShown = true;
  commitPending(account, key, event);
  persistEvents(account, key);
  return true;
}

export function notePerfectSlide(accountId: string, siteKey: string, id: string) {
  const { account, key } = locate(accountId, siteKey);
  const event = loadEvents(account, key).find((item) => item.id === id && item.accountId === account && item.siteKey === key && !item.lab && isReview(item));
  if (!event) return false;
  if (!event.categories) event.categories = [];
  if (!event.reasons) event.reasons = [];
  if (!event.categories.includes("perfect_slide")) event.categories.push("perfect_slide");
  if (!event.reasons.some((reason) => reason.code === "perfect_slide")) {
    event.reasons.push({
      code: "perfect_slide",
      label: "滑动轨迹",
      detail: "滑动太整齐、太快，没有真人的停顿和快慢，仍记为假量",
      weight: 0,
    });
  }
  commitPending(account, key, event);
  persistEvents(account, key);
  return true;
}

const MAX_DWELL_MS = 24 * 60 * 60 * 1000;
const COUNT_AFTER_MS = 60 * 1000;

export function noteDwell(accountId: string, siteKey: string, id: string, dwellMs: number, commit = false) {
  const { account, key } = locate(accountId, siteKey);
  const event = loadEvents(account, key).find((item) => item.id === id && item.accountId === account && item.siteKey === key && !item.lab && isReview(item));
  if (!event) return false;
  if (!Number.isFinite(dwellMs) || dwellMs < 0) return false;
  const next = Math.min(MAX_DWELL_MS, Math.round(dwellMs));
  const grew = (event.dwellMs || 0) < next;
  if (grew) event.dwellMs = next;
  const committed = commit || next >= COUNT_AFTER_MS ? commitPending(account, key, event) : false;
  if (grew || committed) persistEvents(account, key);
  return true;
}

export function recentHits(accountId: string, siteKey: string, ip: string, fp: string, windowMs = 10 * 60 * 1000) {
  const since = Date.now() - windowMs;
  let ipHits = 0;
  let fpHits = 0;
  for (const event of loadEvents(accountId, siteKey)) {
    if (event.at < since || event.lab || event.accountId !== accountId || event.siteKey !== siteKey) continue;
    if (event.ip === ip) ipHits += 1;
    if (fp && event.fp === fp) fpHits += 1;
  }
  return { ipHits, fpHits };
}

const siteDirCache = tgMap<string, { mtimeMs: number; names: string[]; at: number }>("siteDirCache");
/** 大账号站点目录几乎每秒都有新站；mtime 一变就全量 readdir 会拖死事件循环。 */
const SITE_LIST_TTL_LARGE_MS = 15 * 60_000;
const SITE_LIST_TTL_SMALL_MS = 30_000;
const dirtySites = tgSet<string>("dirtySites");
const siteListBuilding = tgSet<string>("siteListBuilding");

function markSiteDirty(accountId: string, siteKey: string) {
  dirtySites.add(`${accountId}/${siteKey}`);
  forgetHead(accountId, siteKey);
  invalidateFastPv(accountId);
  // 新站出现时只追加到内存名单，避免立刻重扫十万目录。
  const account = normalizeAccountId(accountId);
  const key = normalizeSiteKey(siteKey);
  if (!account || !key) return;
  noteTouchedSite(account, key);
  const cached = siteDirCache.get(account);
  if (!cached) return;
  if (cached.names.includes(key)) return;
  cached.names.push(key);
}

/** 当天有过写入的站。大账号回补只扫这些，禁止再 stat 三十五万目录。 */
const touchedDayMem = tgMap<string, Set<string>>("touchedDayMem");
const touchedDayDirty = tgSet<string>("touchedDayDirty");
const touchedFlushTimer = { id: null as ReturnType<typeof setTimeout> | null };
const siteListRefreshAt = tgMap<string, number>("siteListRefreshAt");

function touchedDayFile(accountId: string, day: string) {
  return path.resolve(ROOT, accountId, "touched", `${day}.json`);
}

function loadTouchedDay(account: string, day: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(touchedDayFile(account, day), "utf8")) as { sites?: unknown };
    if (!Array.isArray(parsed?.sites)) return new Set();
    return new Set(
      parsed.sites.map((item) => normalizeSiteKey(String(item || ""))).filter((key): key is string => Boolean(key)),
    );
  } catch {
    return new Set();
  }
}

function flushTouchedDays() {
  touchedFlushTimer.id = null;
  for (const memKey of [...touchedDayDirty]) {
    touchedDayDirty.delete(memKey);
    const set = touchedDayMem.get(memKey);
    if (!set) continue;
    const [account, day] = memKey.split("\n");
    if (!account || !day) continue;
    try {
      mkdirSync(path.dirname(touchedDayFile(account, day)), { recursive: true });
      writeFileSync(touchedDayFile(account, day), JSON.stringify({ at: Date.now(), sites: [...set] }));
    } catch {
      /* memory set still serves backfill */
    }
  }
}

function scheduleTouchedFlush() {
  if (touchedFlushTimer.id) return;
  touchedFlushTimer.id = setTimeout(flushTouchedDays, 1200);
}

function noteTouchedSite(accountId: string, siteKey: string, day = shanghaiDay()) {
  const account = normalizeAccountId(accountId);
  const key = normalizeSiteKey(siteKey);
  if (!account || !key || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const memKey = `${account}\n${day}`;
  let set = touchedDayMem.get(memKey);
  if (!set) {
    set = loadTouchedDay(account, day);
    touchedDayMem.set(memKey, set);
  }
  if (set.has(key)) return;
  set.add(key);
  touchedDayDirty.add(memKey);
  scheduleTouchedFlush();
}

function sitesTouchedInRange(accountId: string, from: string, to: string) {
  const account = normalizeAccountId(accountId);
  if (!account || from > to) return [] as string[];
  const out = new Set<string>();
  let day = from;
  for (let guard = 0; day <= to && guard < 400; guard += 1) {
    const memKey = `${account}\n${day}`;
    let set = touchedDayMem.get(memKey);
    if (!set) {
      set = loadTouchedDay(account, day);
      touchedDayMem.set(memKey, set);
    }
    for (const site of set) out.add(site);
    day = addDays(day, 1);
  }
  return [...out];
}

function sitesIndexFile(accountId: string) {
  return path.resolve(ROOT, accountId, "sites-index.json");
}

function readSitesIndex(accountId: string): string[] | null {
  try {
    const parsed = JSON.parse(readFileSync(sitesIndexFile(accountId), "utf8")) as { names?: unknown };
    if (!Array.isArray(parsed?.names)) return null;
    return parsed.names.map((item) => normalizeSiteKey(String(item || ""))).filter((key): key is string => Boolean(key));
  } catch {
    return null;
  }
}

function writeSitesIndex(accountId: string, names: string[]) {
  try {
    mkdirSync(path.dirname(sitesIndexFile(accountId)), { recursive: true });
    writeFileSync(sitesIndexFile(accountId), JSON.stringify({ at: Date.now(), names }));
  } catch {
    /* memory list still works */
  }
}

function scanSiteNames(root: string) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeSiteKey(entry.name))
    .filter((key): key is string => Boolean(key))
    .sort();
}

export function listSites(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account) return [];
  const root = path.resolve(ROOT, account, "sites");
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(root).mtimeMs;
  } catch {
    return [];
  }
  const now = Date.now();
  const cached = siteDirCache.get(account);
  if (cached && cached.mtimeMs === mtimeMs) return cached.names;
  const largeHint = (cached?.names.length || 0) > OVERVIEW_FULL_SCAN_MAX_SITES;
  const ttl = largeHint ? SITE_LIST_TTL_LARGE_MS : SITE_LIST_TTL_SMALL_MS;
  if (cached && now - cached.at < ttl) return cached.names;

  // 冷启动：优先读持久化索引，把十万级 readdir 挪到后台（且限频）。
  if (!cached) {
    const indexed = readSitesIndex(account);
    if (indexed && indexed.length > OVERVIEW_FULL_SCAN_MAX_SITES) {
      siteDirCache.set(account, { mtimeMs, names: indexed, at: now });
      scheduleSiteListRefresh(account, root, mtimeMs, true);
      return indexed;
    }
  }

  // 大账号：mtime 几乎每秒变；在 TTL 外也只续期名单，禁止同步 readdir 三十万站。
  if (cached && cached.names.length > OVERVIEW_FULL_SCAN_MAX_SITES) {
    cached.mtimeMs = mtimeMs;
    cached.at = now;
    scheduleSiteListRefresh(account, root, mtimeMs, true);
    return cached.names;
  }

  if (siteListBuilding.has(account) && cached) return cached.names;
  siteListBuilding.add(account);
  try {
    const names = scanSiteNames(root);
    siteDirCache.set(account, { mtimeMs, names, at: Date.now() });
    if (names.length > OVERVIEW_FULL_SCAN_MAX_SITES) writeSitesIndex(account, names);
    return names;
  } finally {
    siteListBuilding.delete(account);
  }
}

function scheduleSiteListRefresh(account: string, root: string, mtimeMs: number, large = false) {
  if (siteListBuilding.has(account)) return;
  // 超大账号全量 readdir 极贵：最多一小时一次，新站靠 markSiteDirty 追加。
  if (large) {
    const last = siteListRefreshAt.get(account) || 0;
    if (Date.now() - last < 60 * 60_000) return;
  }
  siteListBuilding.add(account);
  siteListRefreshAt.set(account, Date.now());
  setImmediate(() => {
    try {
      const names = scanSiteNames(root);
      siteDirCache.set(account, { mtimeMs, names, at: Date.now() });
      if (names.length > OVERVIEW_FULL_SCAN_MAX_SITES) writeSitesIndex(account, names);
    } catch {
      /* keep stale list */
    } finally {
      siteListBuilding.delete(account);
    }
  });
}

/** 站点下拉/检索用：大账号只扫笔记和 overview 头部，禁止同步 readdir 十万站。 */
export function listSitesForPicker(accountId: string, needle = "", limit = 40) {
  const account = normalizeAccountId(accountId);
  if (!account) return { items: [] as string[], more: 0 };
  const q = needle.trim().toLowerCase();
  const cached = siteDirCache.get(account);
  const large = (cached?.names.length || 0) > OVERVIEW_FULL_SCAN_MAX_SITES || isLargeAccount(account);
  let names: string[];
  if (large) {
    names = cached?.names || readSitesIndex(account) || [];
    if (!names.length) names = listSites(account);
  } else {
    names = listSites(account);
  }
  const cap = Math.max(1, limit);
  if (!q) {
    // 索引已按站名排好；空检索只取前 N 条，禁止再 sort 十几万项。
    return { items: names.slice(0, cap), more: Math.max(0, names.length - cap) };
  }
  const matched: string[] = [];
  const prefix: string[] = [];
  for (const site of names) {
    const lower = site.toLowerCase();
    if (!lower.includes(q)) continue;
    if (lower.startsWith(q)) prefix.push(site);
    else matched.push(site);
    if (prefix.length >= cap) break;
  }
  const items = prefix.concat(matched).slice(0, cap);
  return { items, more: Math.max(0, prefix.length + matched.length - items.length) };
}

type PartDraft = { notes: string[]; count: number; startedAt: number; visitedAt: number; dwellMs: number };
type BuiltReport = { fake: number; farm: number; crawler: number; other: number; popupShown: number; popupAll: number; popupClosed: number; slidePassed: number; ipCount: number; rows: TrafficRow[] };

const OVERVIEW_TTL_MS = 30_000;
const ROLLUP_VERSION = 8;

const reportCache = storeGlobal.__tgReports || (storeGlobal.__tgReports = new Map<string, { at: number; value: BuiltReport }>());

type RollupRow = { host: string; ip: string; device: string; parts: Partial<Record<VerdictFilter, TrafficPart>> };
type DayRollup = { popupAll: number; siteIps: string[]; popupIps: string[]; closedIps: string[]; rows: RollupRow[] };
type RollupFile = { version: number; eventsMtimeMs: number; byDay: Record<string, DayRollup> };
type OverviewResult = { sites: string[]; fake: number; farm: number; crawler: number; other: number; popupShown: number; popupClosed: number; slidePassed: number; rows: TrafficRow[] };

function rollupMemory() {
  const g = storeGlobal as StoreGlobal & { __tgRollups?: Map<string, RollupFile>; __tgOverview?: Map<string, { at: number; value: OverviewResult }>; __tgWarming?: boolean };
  if (!g.__tgRollups) g.__tgRollups = new Map();
  return g.__tgRollups;
}

function overviewMemory() {
  const g = storeGlobal as StoreGlobal & { __tgOverview?: Map<string, { at: number; value: OverviewResult }> };
  if (!g.__tgOverview) g.__tgOverview = new Map();
  return g.__tgOverview;
}

function invalidateReports() {
  if (reportCache.size > 48) reportCache.clear();
}

function eventTags(event: StoredEvent): VerdictFilter[] {
  if (isSoftSuspect(event)) return ["suspect"];
  const tags: VerdictFilter[] = ["fake"];
  const flags = classesOf(event);
  if (flags.farm) tags.push("farm");
  if (flags.crawler) tags.push("crawler");
  if (flags.other) tags.push("other");
  if (hasCategory(event, "emulator")) tags.push("emulator");
  if (hasCategory(event, "cloud_phone")) tags.push("cloud_phone");
  if (event.categories?.some((code) => AUTO_CODES.has(code))) tags.push("auto");
  return tags;
}

function addToPart(parts: Partial<Record<VerdictFilter, PartDraft>>, tag: VerdictFilter, event: StoredEvent, labels: string[]) {
  const part = parts[tag] || { notes: [], count: 0, startedAt: event.at, visitedAt: event.at, dwellMs: 0 };
  part.count += 1;
  if (event.at < part.startedAt) part.startedAt = event.at;
  if (event.at > part.visitedAt) part.visitedAt = event.at;
  if (typeof event.dwellMs === "number" && event.dwellMs > 0) part.dwellMs += event.dwellMs;
  for (const label of labels) {
    if (!part.notes.includes(label)) part.notes.push(label);
  }
  parts[tag] = part;
}

function freezeParts(parts: Partial<Record<VerdictFilter, PartDraft>>): Partial<Record<VerdictFilter, TrafficPart>> {
  const frozen: Partial<Record<VerdictFilter, TrafficPart>> = {};
  for (const [tag, part] of Object.entries(parts) as [VerdictFilter, PartDraft][]) {
    frozen[tag] = {
      count: part.count,
      note: part.notes.join("、"),
      startedAt: part.startedAt,
      visitedAt: part.visitedAt,
      dwellMs: part.dwellMs,
    };
  }
  return frozen;
}

function projectRow(row: TrafficRow, verdict: VerdictFilter): TrafficRow | null {
  if (verdict === "fake") return row;
  const part = row.parts[verdict];
  if (!part) return null;
  return {
    ...row,
    note: part.note,
    count: part.count,
    startedAt: part.startedAt,
    visitedAt: part.visitedAt,
    dwellMs: part.dwellMs,
  };
}

function unionNote(left: string, right: string) {
  if (!left) return right || "";
  if (!right) return left;
  const notes = left.split("、");
  for (const part of right.split("、")) {
    if (part && !notes.includes(part)) notes.push(part);
  }
  return notes.join("、");
}

function mergeTrafficPart(left: TrafficPart | undefined, right: TrafficPart | undefined): TrafficPart | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    count: left.count + right.count,
    note: unionNote(left.note, right.note),
    startedAt: Math.min(left.startedAt, right.startedAt),
    visitedAt: Math.max(left.visitedAt, right.visitedAt),
    dwellMs: (left.dwellMs || 0) + (right.dwellMs || 0),
  };
}

function buildRollup(accountId: string, siteKey: string, eventsMtimeMs: number): RollupFile {
  const { cacheKey, key } = locate(accountId, siteKey);
  const hadEvents = cache.has(cacheKey);
  const grouped = new Map<string, { popupAll: number; siteIps: Set<string>; popupIps: Set<string>; closedIps: Set<string>; rows: Map<string, { host: string; ip: string; device: string; parts: Partial<Record<VerdictFilter, PartDraft>> }> }>();
  const switched = new Map<string, string[]>();
  for (const event of loadEvents(accountId, key)) {
    if (event.accountId !== accountId || event.siteKey !== key || event.lab || event.pending) continue;
    if (!countsAsFakeTraffic(event)) continue;
    const soft = isSoftSuspect(event);
    const fakeRow = isFlagged(event);
    if (!soft && !fakeRow) continue;
    const day = shanghaiDay(event.at);
    const bucket = grouped.get(day) || { popupAll: 0, siteIps: new Set<string>(), popupIps: new Set<string>(), closedIps: new Set<string>(), rows: new Map() };
    const host = fakeSourceHost(event);
    const ip = event.ip || "";
    const device = deviceLabel(event.ua || "");
    if (ip && spoofPhone(event) && device) {
      const seen = switched.get(ip) || [];
      if (!seen.includes(device)) seen.push(device);
      switched.set(ip, seen);
    }
    if (ip) bucket.siteIps.add(ip);
    if (event.popupShown) {
      bucket.popupAll += 1;
      if (ip) bucket.popupIps.add(ip);
    }
    if (ip && event.popupClosed) bucket.closedIps.add(ip);
    const rowKey = `${host}\n${ip}`;
    const row = bucket.rows.get(rowKey) || { host, ip, device, parts: {} };
    if (!row.device && device) row.device = device;
    for (const tag of eventTags(event)) addToPart(row.parts, tag, event, notesOf(event));
    bucket.rows.set(rowKey, row);
    grouped.set(day, bucket);
  }
  if (!hadEvents) cache.delete(cacheKey);
  const byDay: Record<string, DayRollup> = {};
  for (const [day, bucket] of grouped) {
    byDay[day] = {
      popupAll: bucket.popupAll,
      siteIps: [...bucket.siteIps],
      popupIps: [...bucket.popupIps],
      closedIps: [...bucket.closedIps],
      rows: [...bucket.rows.values()].map((row) => {
        const systems = switched.get(row.ip) || [];
        const device = systems.length ? phoneMark(systems) : row.device || "";
        return { host: row.host, ip: row.ip, device, parts: freezeParts(row.parts) };
      }),
    };
  }
  return { version: ROLLUP_VERSION, eventsMtimeMs, byDay };
}

function loadRollup(accountId: string, siteKey: string): RollupFile {
  const { cacheKey, file, dir } = locate(accountId, siteKey);
  const memory = rollupMemory();
  const cached = memory.get(cacheKey);
  if (cached) return cached;
  const eventsMtimeMs = existsSync(file) ? Math.round(statSync(file).mtimeMs) : 0;
  const rollupFile = path.join(dir, "rollup.json");
  if (existsSync(rollupFile)) {
    try {
      const parsed = JSON.parse(readFileSync(rollupFile, "utf8")) as RollupFile;
      if (parsed && parsed.version === ROLLUP_VERSION && parsed.eventsMtimeMs === eventsMtimeMs && parsed.byDay) {
        memory.set(cacheKey, parsed);
        return parsed;
      }
    } catch {
      /* rebuild a broken rollup */
    }
  }
  const built = buildRollup(accountId, siteKey, eventsMtimeMs);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(rollupFile, JSON.stringify(built));
  } catch {
    /* the page can still use the in-memory copy */
  }
  memory.set(cacheKey, built);
  return built;
}

function rangeActive(days: DayFile, from: string, to: string) {
  for (const [day, stat] of Object.entries(days)) {
    if (day < from || day > to || !stat) continue;
    if ((stat.real || 0) > 0 || (stat.fake || 0) > 0 || (stat.suspect || 0) > 0 || (stat.slidePassed || 0) > 0 || (stat.popupShown || 0) > 0 || (stat.farm || 0) > 0 || (stat.crawler || 0) > 0) return true;
  }
  return false;
}

function buildReport(accountId: string, siteKey: string, from: string, to: string, accountName: string): BuiltReport {
  const { key } = locate(accountId, siteKey);
  const days = loadDays(accountId, key);
  let fake = 0;
  let farm = 0;
  let crawler = 0;
  let other = 0;
  let popupShown = 0;
  let popupAll = 0;
  let popupClosed = 0;
  let slidePassed = 0;
  for (const [day, stat] of Object.entries(days)) {
    if (day < from || day > to || !stat || typeof stat !== "object") continue;
    fake += Math.max(0, stat.fake || 0);
    farm += Math.max(0, stat.farm || 0);
    crawler += Math.max(0, stat.crawler || 0);
    other += Math.max(0, stat.other || 0);
    slidePassed += stat.slidePassed || 0;
  }
  const popupIps = new Set<string>();
  const closedIps = new Set<string>();
  const grouped = new Map<string, { host: string; ip: string; device: string; parts: Partial<Record<VerdictFilter, TrafficPart>> }>();
  for (const [day, bucket] of Object.entries(loadRollup(accountId, key).byDay)) {
    if (day < from || day > to || !bucket) continue;
    popupAll += bucket.popupAll || 0;
    for (const ip of bucket.popupIps || []) if (ip) popupIps.add(ip);
    for (const ip of bucket.closedIps || []) if (ip) closedIps.add(ip);
    for (const row of bucket.rows || []) {
      const id = `${row.host}\n${row.ip}`;
      const found = grouped.get(id) || { host: row.host, ip: row.ip, device: row.device || "", parts: {} };
      if (!found.device && row.device) found.device = row.device;
      for (const [tag, part] of Object.entries(row.parts || {}) as [VerdictFilter, TrafficPart][]) {
        found.parts[tag] = mergeTrafficPart(found.parts[tag], part);
      }
      grouped.set(id, found);
    }
  }
  const rows: TrafficRow[] = [...grouped.values()]
    .map((row) => {
      const main = row.parts.fake || { count: 0, note: "", startedAt: 0, visitedAt: 0, dwellMs: 0 };
      return {
        account: accountName,
        site: key,
        host: row.host,
        ip: row.ip,
        note: main.note,
        device: deviceClaim(accountId, row.ip) || row.device || "",
        label: row.host ? `来路:${row.host}` : "直接访问",
        traffic: row.host || "直接访问",
        count: main.count,
        startedAt: main.startedAt,
        visitedAt: main.visitedAt,
        dwellMs: main.dwellMs,
        sitePv: 0,
        sitePopupAll: 0,
        siteIpCount: 0,
        parts: row.parts,
      };
    })
    .sort((a, b) => b.count - a.count || a.ip.localeCompare(b.ip, "en") || a.traffic.localeCompare(b.traffic, "en"));
  popupShown = popupIps.size;
  popupClosed = closedIps.size;
  return { fake, farm, crawler, other, popupShown, popupAll, popupClosed, slidePassed, ipCount: realIpCount(accountId, key, from, to), rows };
}

export function report(accountId: string, siteKey: string, from: string, to: string, verdict: VerdictFilter, accountName = "") {
  const { key } = locate(accountId, siteKey);
  const built = buildReport(accountId, key, from, to, accountName);
  if (verdict === "fake") return built;
  const rows = built.rows
    .map((row) => projectRow(row, verdict))
    .filter((row): row is TrafficRow => Boolean(row))
    .sort((a, b) => b.count - a.count || a.ip.localeCompare(b.ip, "en") || a.traffic.localeCompare(b.traffic, "en"));
  return { ...built, rows };
}

export function reportSites(accountId: string, siteKey: string | null, from: string, to: string, verdict: VerdictFilter, accountName = "") {
  const sites = listSites(accountId);
  const keys = siteKey ? [siteKey] : sites;
  let fake = 0;
  let farm = 0;
  let crawler = 0;
  let other = 0;
  let popupShown = 0;
  let popupClosed = 0;
  let slidePassed = 0;
  const rows: TrafficRow[] = [];
  for (const key of keys) {
    const located = locate(accountId, key);
    let touched = 0;
    try {
      touched = statSync(located.day).mtimeMs;
    } catch {
      continue;
    }
    // A day file last written before the range cannot contain those days.
    if (shanghaiDay(touched) < from) continue;
    if (!rangeActive(loadDays(accountId, key), from, to)) continue;
    const part = report(accountId, key, from, to, verdict, accountName);
    fake += part.fake;
    farm += part.farm;
    crawler += part.crawler;
    other += part.other;
    popupShown += part.popupShown;
    popupClosed += part.popupClosed;
    slidePassed += part.slidePassed;
    const fakeIps = new Set<string>();
    for (const row of part.rows) {
      if (row.ip && (row.parts.fake?.count || 0) > 0) fakeIps.add(row.ip);
    }
    for (const row of part.rows) {
      rows.push({
        ...row,
        sitePv: part.popupShown,
        sitePopupAll: part.popupAll,
        siteIpCount: part.ipCount,
        siteFake: part.fake,
        siteFakeIps: fakeIps.size,
        siteFarm: part.farm,
        siteCrawler: part.crawler,
        siteOther: part.other,
        siteSlide: part.slidePassed,
        siteClosed: part.popupClosed,
      });
    }
  }
  rows.sort((a, b) => b.count - a.count || a.site.localeCompare(b.site) || a.ip.localeCompare(b.ip, "en") || a.traffic.localeCompare(b.traffic, "en"));
  return { sites, fake, farm, crawler, other, popupShown, popupClosed, slidePassed, rows };
}

function computeAccounts(
  accounts: { id: string; username: string }[],
  siteKey: string | null,
  from: string,
  to: string,
  verdict: VerdictFilter,
): OverviewResult {
  let fake = 0;
  let farm = 0;
  let crawler = 0;
  let other = 0;
  let popupShown = 0;
  let popupClosed = 0;
  let slidePassed = 0;
  const sites = new Set<string>();
  const rows: TrafficRow[] = [];
  for (const account of accounts) {
    const part = reportSites(account.id, siteKey, from, to, verdict, account.username);
    for (const site of part.sites) sites.add(site);
    fake += part.fake;
    farm += part.farm;
    crawler += part.crawler;
    other += part.other;
    popupShown += part.popupShown;
    popupClosed += part.popupClosed;
    slidePassed += part.slidePassed;
    rows.push(...part.rows);
  }
  rows.sort((a, b) => b.count - a.count || a.account.localeCompare(b.account) || a.site.localeCompare(b.site) || a.ip.localeCompare(b.ip, "en") || a.traffic.localeCompare(b.traffic, "en"));
  return { sites: [...sites].sort(), fake, farm, crawler, other, popupShown, popupClosed, slidePassed, rows };
}

export function reportAccounts(
  accounts: { id: string; username: string }[],
  siteKey: string | null,
  from: string,
  to: string,
  verdict: VerdictFilter,
) {
  const key = `${accounts.map((account) => account.id).join(",")}\n${siteKey || "*"}\n${from}\n${to}\n${verdict}`;
  const memory = overviewMemory();
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < OVERVIEW_TTL_MS) return hit.value;
  const value = computeAccounts(accounts, siteKey, from, to, verdict);
  memory.set(key, { at: Date.now(), value });
  return value;
}

const PAGE_VERDICTS: VerdictFilter[] = ["fake", "farm", "crawler", "other", "emulator", "cloud_phone", "auto", "suspect"];

type SiteHead = {
  account: string;
  accountId: string;
  site: string;
  fake: number;
  fakeIps: number;
  suspect: number;
  suspectIps: number;
  realPv: number;
  farm: number;
  crawler: number;
  other: number;
  popupShown: number;
  popupAll: number;
  popupClosed: number;
  slidePassed: number;
  ipCount: number;
  rows: RollupRow[];
  partCount: Partial<Record<VerdictFilter, number>>;
  partIps: Partial<Record<VerdictFilter, number>>;
};

type VisitItem = { head: SiteHead; row: RollupRow; count: number };

type BundleTotals = { fake: number; fakeIps: number; suspect: number; suspectIps: number; realPv: number; farm: number; crawler: number; other: number; popupShown: number; popupAll: number; popupClosed: number; slidePassed: number; realIps: number };

type Bundle = {
  heads: SiteHead[];
  totals: BundleTotals;
  /** 内存里的全量站点。表格只展示 heads（已按假量裁过），合计用这份，避免裁完再加总把 IP 假量写小。不落盘。 */
  allHeads?: SiteHead[];
  visits: Partial<Record<VerdictFilter, VisitItem[]>>;
  grouped: Partial<Record<VerdictFilter, SiteHead[]>>;
};

function bundleMemory() {
  const g = storeGlobal as StoreGlobal & { __tgBundle?: Map<string, { at: number; value: Bundle; settled?: boolean }> };
  if (!g.__tgBundle) g.__tgBundle = new Map();
  return g.__tgBundle;
}

function collectRange(rollup: RollupFile, from: string, to: string) {
  const popupIps = new Set<string>();
  const closedIps = new Set<string>();
  const siteIps = new Set<string>();
  let popupAll = 0;
  if (from === to) {
    const bucket = rollup.byDay[from];
    if (!bucket) return { popupAll, popupIps, closedIps, siteIps, rows: [] as RollupRow[] };
    popupAll = bucket.popupAll || 0;
    for (const ip of bucket.siteIps || []) if (ip) siteIps.add(ip);
    for (const ip of bucket.popupIps || []) if (ip) popupIps.add(ip);
    for (const ip of bucket.closedIps || []) if (ip) closedIps.add(ip);
    return { popupAll, popupIps, closedIps, siteIps, rows: bucket.rows || [] };
  }
  const grouped = new Map<string, RollupRow>();
  for (const [day, bucket] of Object.entries(rollup.byDay)) {
    if (day < from || day > to || !bucket) continue;
    popupAll += bucket.popupAll || 0;
    for (const ip of bucket.siteIps || []) if (ip) siteIps.add(ip);
    for (const ip of bucket.popupIps || []) if (ip) popupIps.add(ip);
    for (const ip of bucket.closedIps || []) if (ip) closedIps.add(ip);
    for (const row of bucket.rows || []) {
      const id = `${row.host}\n${row.ip}`;
      const found = grouped.get(id) || { host: row.host, ip: row.ip, device: row.device || "", parts: {} };
      if (!found.device && row.device) found.device = row.device;
      for (const [tag, part] of Object.entries(row.parts || {}) as [VerdictFilter, TrafficPart][]) {
        found.parts[tag] = mergeTrafficPart(found.parts[tag], part);
      }
      grouped.set(id, found);
    }
  }
  return { popupAll, popupIps, closedIps, siteIps, rows: [...grouped.values()] };
}

function emptyHead(account: string, accountId: string, site: string): SiteHead {
  return {
    account,
    accountId,
    site,
    fake: 0,
    fakeIps: 0,
    suspect: 0,
    suspectIps: 0,
    realPv: 0,
    farm: 0,
    crawler: 0,
    other: 0,
    popupShown: 0,
    popupAll: 0,
    popupClosed: 0,
    slidePassed: 0,
    ipCount: 0,
    rows: [],
    partCount: {},
    partIps: {},
  };
}

function summarizeSite(accountId: string, username: string, siteKey: string, from: string, to: string, withRows: boolean): SiteHead | null {
  const days = loadDays(accountId, siteKey);
  let fake = 0;
  let suspect = 0;
  let farm = 0;
  let crawler = 0;
  let other = 0;
  let slidePassed = 0;
  let realPv = 0;
  for (const [day, stat] of Object.entries(days)) {
    if (day < from || day > to || !stat || typeof stat !== "object") continue;
    fake += Math.max(0, stat.fake || 0);
    suspect += Math.max(0, stat.suspect || 0);
    realPv += Math.max(0, stat.real || 0);
    farm += Math.max(0, stat.farm || 0);
    crawler += Math.max(0, stat.crawler || 0);
    other += Math.max(0, stat.other || 0);
    slidePassed += stat.slidePassed || 0;
  }
  const collected = collectRange(loadRollup(accountId, siteKey), from, to);
  const partCount: Partial<Record<VerdictFilter, number>> = {};
  const ipSets: Partial<Record<VerdictFilter, Set<string>>> = {};
  for (const row of collected.rows) {
    for (const tag of PAGE_VERDICTS) {
      const part = row.parts[tag];
      if (!part?.count) continue;
      partCount[tag] = (partCount[tag] || 0) + part.count;
      if (!row.ip) continue;
      const ips = ipSets[tag] || new Set<string>();
      ips.add(row.ip);
      ipSets[tag] = ips;
    }
  }
  const partIps: Partial<Record<VerdictFilter, number>> = {};
  for (const tag of PAGE_VERDICTS) partIps[tag] = ipSets[tag]?.size || 0;
  return {
    account: username,
    accountId,
    site: siteKey,
    fake,
    fakeIps: partIps.fake || 0,
    suspect,
    suspectIps: suspectIpCount(accountId, siteKey, from, to),
    realPv,
    farm,
    crawler,
    other,
    popupShown: collected.popupIps.size,
    popupAll: collected.popupAll,
    popupClosed: collected.closedIps.size,
    slidePassed,
    ipCount: realIpCount(accountId, siteKey, from, to),
    rows: withRows ? collected.rows : [],
    partCount,
    partIps,
  };
}

function headMemo() {
  const g = storeGlobal as StoreGlobal & { __tgHeadMemo?: Map<string, { head: SiteHead | null }> };
  if (!g.__tgHeadMemo) g.__tgHeadMemo = new Map();
  return g.__tgHeadMemo;
}

function headMemoKey(accountId: string, siteKey: string, from: string, to: string, withRows: boolean) {
  return `${accountId}/${siteKey}\n${from}\n${to}\n${withRows ? "1" : "0"}`;
}

function rememberHead(accountId: string, siteKey: string, from: string, to: string, head: SiteHead | null, withRows: boolean) {
  const memory = headMemo();
  if (memory.size > 250000) memory.clear();
  memory.set(headMemoKey(accountId, siteKey, from, to, withRows), { head });
}

function forgetHead(accountId: string, siteKey: string) {
  const memory = headMemo();
  const prefix = `${accountId}/${siteKey}\n`;
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
}

const BUNDLE_FRESH_MS = 15_000;
/** Settled overview older than this must be rescanned so IP 假量等跟得上。 */
const BUNDLE_STALE_MS = 45_000;
/** 超大账号（十万站）禁止周期性全量扫；只靠脏站点增量更新。 */
const BUNDLE_STALE_LARGE_MS = 30 * 60_000;
const OVERVIEW_CACHE_VERSION = 8;
const overviewCacheFile = path.resolve(process.cwd(), "data", "cache", "overview-cache.json");
const overviewQueued = tgSet<string>("overviewQueued");
function scanActive() {
  return Boolean(tgRun().scanActive);
}
function setScanActive(active: boolean) {
  tgRun().scanActive = active;
}

function accountSiteCount(accountId: string) {
  return listSites(accountId).length;
}

function isLargeAccount(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account) return false;
  const cached = siteDirCache.get(account);
  if (cached) return cached.names.length > OVERVIEW_FULL_SCAN_MAX_SITES;
  // 有超大 sites-index 就直接当大账号，禁止为了判定再去 readdir。
  try {
    if (statSync(sitesIndexFile(account)).size > 400_000) return true;
  } catch {
    /* fall through */
  }
  try {
    const indexed = readSitesIndex(account);
    if (indexed && indexed.length > OVERVIEW_FULL_SCAN_MAX_SITES) {
      siteDirCache.set(account, { mtimeMs: 0, names: indexed, at: Date.now() });
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

function accountHasDirtySites(accountId: string) {
  const prefix = `${accountId}/`;
  for (const id of dirtySites) {
    if (id.startsWith(prefix)) return true;
  }
  return false;
}

function takeDirtySites(accountId: string, limit = 800) {
  const prefix = `${accountId}/`;
  const keys: string[] = [];
  const cap = Math.max(1, limit);
  for (const id of [...dirtySites]) {
    if (!id.startsWith(prefix)) continue;
    dirtySites.delete(id);
    keys.push(id.slice(prefix.length));
    if (keys.length >= cap) break;
  }
  return keys;
}

function priorOverviewBundle(key: string): Bundle | null {
  const hit = bundleMemory().get(key);
  if (hit?.value?.heads && hit.value.totals) return hit.value;
  const saved = readOverviewDisk().entries[key];
  if (saved?.value?.heads && saved.value.totals) return saved.value;
  return null;
}

type LiveDayTot = {
  fake: number;
  real: number;
  suspect: number;
  farm: number;
  crawler: number;
  other: number;
  slidePassed: number;
  popupShown: number;
};

type LiveDelta = Partial<LiveDayTot>;
type AccountDayTotals = Record<string, LiveDayTot>;

/**
 * 账号级日合计（day-totals.json）。大账号有十万级站点，禁止在请求里扫 days.json，
 * 否则会把整站 SSR 拖死，其他账号也打不开。
 */
const accountTotalsMem = tgMap<string, AccountDayTotals>("accountTotalsMem");
const accountTotalsReady = tgSet<string>("accountTotalsReady");
const accountTotalsBuilding = tgSet<string>("accountTotalsBuilding");
const accountTotalsDirty = tgSet<string>("accountTotalsDirty");
const accountTotalsPending = tgMap<string, Array<{ day: string; delta: LiveDelta }>>("accountTotalsPending");
function totalsFlushTimer() {
  return tgRun().accountTotalsFlushTimer as ReturnType<typeof setTimeout> | null;
}
function setTotalsFlushTimer(timer: ReturnType<typeof setTimeout> | null) {
  tgRun().accountTotalsFlushTimer = timer;
}

function emptyLiveDay(): LiveDayTot {
  return { fake: 0, real: 0, suspect: 0, farm: 0, crawler: 0, other: 0, slidePassed: 0, popupShown: 0 };
}

function applyLiveDelta(cur: LiveDayTot, delta: LiveDelta) {
  if (delta.fake) cur.fake = Math.max(0, cur.fake + delta.fake);
  if (delta.real) cur.real = Math.max(0, cur.real + delta.real);
  if (delta.suspect) cur.suspect = Math.max(0, cur.suspect + delta.suspect);
  if (delta.farm) cur.farm = Math.max(0, cur.farm + delta.farm);
  if (delta.crawler) cur.crawler = Math.max(0, cur.crawler + delta.crawler);
  if (delta.other) cur.other = Math.max(0, cur.other + delta.other);
  if (delta.slidePassed) cur.slidePassed = Math.max(0, cur.slidePassed + delta.slidePassed);
  if (delta.popupShown) cur.popupShown = Math.max(0, cur.popupShown + delta.popupShown);
}

function totalsFile(accountId: string) {
  return path.resolve(ROOT, accountId, "day-totals.json");
}

function invalidateFastPv(_accountId?: string) {
  /* day-totals 本身就是实时源；保留钩子给 markSiteDirty */
}

const accountTotalsMtime = tgMap<string, number>("accountTotalsMtime");

function readAccountTotals(accountId: string): AccountDayTotals | null {
  const account = normalizeAccountId(accountId);
  if (!account) return null;
  const file = totalsFile(account);
  const hit = accountTotalsMem.get(account);
  if (hit && !(isAdminReader() && fileNewer(file, accountTotalsMtime.get(account) || 0))) {
    return hit;
  }
  if (!existsSync(file)) return hit || null;
  try {
    const mtime = statSync(file).mtimeMs;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as AccountDayTotals;
    const data = parsed && typeof parsed === "object" ? parsed : {};
    accountTotalsMem.set(account, data);
    accountTotalsMtime.set(account, mtime);
    accountTotalsReady.add(account);
    return data;
  } catch {
    return hit || null;
  }
}

function flushAccountTotals() {
  setTotalsFlushTimer(null);
  for (const account of [...accountTotalsDirty]) {
    const data = accountTotalsMem.get(account);
    if (!data) {
      accountTotalsDirty.delete(account);
      continue;
    }
    try {
      mkdirSync(path.dirname(totalsFile(account)), { recursive: true });
      writeFileSync(totalsFile(account), JSON.stringify(data));
    } catch {
      /* memory copy still serves */
    }
    accountTotalsDirty.delete(account);
  }
}

function scheduleAccountTotalsFlush() {
  if (totalsFlushTimer()) return;
  setTotalsFlushTimer(setTimeout(flushAccountTotals, 800));
}

function rebuildAccountTotals(accountId: string, force = false) {
  const account = normalizeAccountId(accountId);
  if (!account || accountTotalsBuilding.has(account)) return;
  // 空文件也算读到了。强制重建不能走这条，否则 reseed 写成 {} 后会直接返回，账本被清掉。
  if (!force && readAccountTotals(account)) return;
  accountTotalsBuilding.add(account);
  const byDay: AccountDayTotals = {};
  const sites = listSites(account);
  let index = 0;
  const step = () => {
    const start = Date.now();
    for (; index < sites.length && Date.now() - start < 30; index += 1) {
      const file = path.join(ROOT, account, "sites", sites[index], "days.json");
      if (!existsSync(file)) continue;
      try {
        const days = JSON.parse(readFileSync(file, "utf8")) as DayFile;
        if (!days || typeof days !== "object") continue;
        for (const [day, stat] of Object.entries(days)) {
          if (!stat || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          const cur = byDay[day] || emptyLiveDay();
          cur.fake += Math.max(0, stat.fake || 0);
          cur.real += Math.max(0, stat.real || 0);
          cur.suspect += Math.max(0, stat.suspect || 0);
          cur.farm += Math.max(0, stat.farm || 0);
          cur.crawler += Math.max(0, stat.crawler || 0);
          cur.other += Math.max(0, stat.other || 0);
          cur.slidePassed += Math.max(0, stat.slidePassed || 0);
          cur.popupShown += Math.max(0, stat.popupShown || 0);
          byDay[day] = cur;
        }
      } catch {
        /* skip */
      }
    }
    if (index < sites.length) {
      setImmediate(step);
      return;
    }
    const pending = accountTotalsPending.get(account) || [];
    accountTotalsPending.delete(account);
    for (const item of pending) {
      const cur = byDay[item.day] || emptyLiveDay();
      applyLiveDelta(cur, item.delta);
      byDay[item.day] = cur;
    }
    accountTotalsMem.set(account, byDay);
    accountTotalsReady.add(account);
    accountTotalsDirty.add(account);
    scheduleAccountTotalsFlush();
    accountTotalsBuilding.delete(account);
  };
  setImmediate(step);
}

function ensureAccountTotals(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account) return;
  // 后台每次按 mtime 重读 day-totals；不要因 Ready 标记跳过，也不要在后台全量扫站重建。
  if (isAdminReader()) {
    readAccountTotals(account);
    return;
  }
  if (accountTotalsReady.has(account)) return;
  if (readAccountTotals(account)) return;
  rebuildAccountTotals(account);
}

/** 顶部 PV：读账号 day-totals，O(天数)。重建账本时仍用内存里的旧合计，避免卡片掉回站点表的旧数字。 */
function fastPvTotals(accounts: { id: string }[], from: string, to: string): Partial<BundleTotals> | null {
  if (!accounts.length) return { fake: 0, realPv: 0, suspect: 0, farm: 0, crawler: 0, other: 0, slidePassed: 0, popupShown: 0 };
  const out = { fake: 0, realPv: 0, suspect: 0, farm: 0, crawler: 0, other: 0, slidePassed: 0, popupShown: 0 };
  let any = false;
  for (const account of accounts) {
    const id = normalizeAccountId(account.id);
    if (!id) continue;
    ensureAccountTotals(id);
    const file = accountTotalsMem.get(id);
    if (!file) continue;
    any = true;
    for (const [day, tot] of Object.entries(file)) {
      if (day < from || day > to || !tot) continue;
      out.fake += tot.fake || 0;
      out.realPv += tot.real || 0;
      out.suspect += tot.suspect || 0;
      out.farm += tot.farm || 0;
      out.crawler += tot.crawler || 0;
      out.other += tot.other || 0;
      out.slidePassed += tot.slidePassed || 0;
      out.popupShown += tot.popupShown || 0;
    }
  }
  return any ? out : null;
}

function bumpLiveDays(accountId: string, day: string, delta: LiveDelta) {
  const account = normalizeAccountId(accountId);
  if (!account || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  if (!delta.fake && !delta.real && !delta.suspect && !delta.farm && !delta.crawler && !delta.other && !delta.slidePassed && !delta.popupShown) {
    return;
  }
  if (!accountTotalsReady.has(account)) {
    const q = accountTotalsPending.get(account) || [];
    q.push({ day, delta });
    accountTotalsPending.set(account, q);
    ensureAccountTotals(account);
    return;
  }
  let file = accountTotalsMem.get(account);
  if (!file) {
    file = {};
    accountTotalsMem.set(account, file);
  }
  const cur = file[day] || emptyLiveDay();
  applyLiveDelta(cur, delta);
  file[day] = cur;
  accountTotalsDirty.add(account);
  scheduleAccountTotalsFlush();
}

function seedLiveAccount(accountId: string) {
  ensureAccountTotals(accountId);
  ensureAccountIpTotals(accountId);
}

const accountTotalsReseedAt = tgMap<string, number>("accountTotalsReseedAt");

function reseedLiveAccount(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account || accountTotalsBuilding.has(account)) return;
  const now = Date.now();
  if (now - (accountTotalsReseedAt.get(account) || 0) < 10 * 60_000) return;
  accountTotalsReseedAt.set(account, now);
  // 保留内存里的旧合计，重建完成再替换。不能先写成 {}，否则卡片会掉成 0，而且重建会误以为已经就绪。
  accountTotalsReady.delete(account);
  rebuildAccountTotals(account, true);
}

type OverviewDisk = { version: number; entries: Record<string, { at: number; value: Bundle }> };

function bundleCacheKey(accounts: { id: string }[], from: string, to: string) {
  return `${accounts.map((account) => account.id).join(",")}\n*\n${from}\n${to}`;
}

function readOverviewDisk(): OverviewDisk {
  const cached = tgRun().overviewDisk as OverviewDisk | null;
  if (cached) return cached;
  const overviewDisk: OverviewDisk = { version: OVERVIEW_CACHE_VERSION, entries: {} };
  tgRun().overviewDisk = overviewDisk;
  if (!existsSync(overviewCacheFile)) return overviewDisk;
  try {
    const parsed = JSON.parse(readFileSync(overviewCacheFile, "utf8")) as OverviewDisk;
    if (parsed && parsed.version === OVERVIEW_CACHE_VERSION && parsed.entries) {
      tgRun().overviewDisk = parsed;
      let trimmed = false;
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (!entry?.value?.heads || entry.value.heads.length <= OVERVIEW_HEAD_CAP) continue;
        entry.value = compactBundle(entry.value);
        parsed.entries[key] = entry;
        trimmed = true;
      }
      pruneOverviewDiskEntries(parsed);
      if (trimmed) {
        tgRun().overviewDiskDirty = true;
        if (!tgRun().overviewDiskWriteTimer) tgRun().overviewDiskWriteTimer = setTimeout(flushOverviewDisk, 5_000);
      }
      return parsed;
    }
  } catch {
    /* a broken cache is rebuilt on the next pass */
  }
  return overviewDisk;
}

const OVERVIEW_DISK_FLUSH_MS = 60_000;

function flushOverviewDisk() {
  tgRun().overviewDiskWriteTimer = null;
  const overviewDisk = tgRun().overviewDisk as OverviewDisk | null;
  if (!tgRun().overviewDiskDirty || !overviewDisk) return;
  tgRun().overviewDiskDirty = false;
  try {
    mkdirSync(path.dirname(overviewCacheFile), { recursive: true });
    writeFileSync(overviewCacheFile, JSON.stringify(overviewDisk));
  } catch {
    tgRun().overviewDiskDirty = true;
  }
}

function headRank(head: SiteHead) {
  return (head.fakeIps || 0) * 1_000_000 + (head.fake || 0) * 1_000 + (head.suspectIps || 0) * 10 + (head.ipCount || 0);
}

/** 大账号 overview 只留假量靠前的站；排序一次后分页可直接 slice。 */
function pruneHeads(heads: SiteHead[], cap = OVERVIEW_HEAD_CAP) {
  if (heads.length <= cap) {
    return heads.slice().sort((a, b) => headRank(b) - headRank(a) || a.site.localeCompare(b.site, "en"));
  }
  return heads
    .slice()
    .sort((a, b) => headRank(b) - headRank(a) || a.site.localeCompare(b.site, "en"))
    .slice(0, cap);
}

function compactBundle(value: Bundle): Bundle {
  const accountId = value.heads[0]?.accountId || "";
  const large = accountId ? isLargeAccount(accountId) || value.heads.length > OVERVIEW_HEAD_CAP : value.heads.length > OVERVIEW_HEAD_CAP;
  const heads = large ? pruneHeads(value.heads) : value.heads;
  return { heads, totals: value.totals, visits: {}, grouped: {} };
}

function pruneOverviewDiskEntries(disk: OverviewDisk) {
  const keepAfter = shanghaiDay(Date.now() - 3 * 86400_000);
  for (const key of Object.keys(disk.entries)) {
    const parts = key.split("\n");
    const day = parts[2] || "";
    if (day && day < keepAfter) delete disk.entries[key];
  }
}

function writeOverviewDisk(key: string, at: number, value: Bundle) {
  const disk = readOverviewDisk();
  disk.entries[key] = { at, value: compactBundle(value) };
  pruneOverviewDiskEntries(disk);
  tgRun().overviewDiskDirty = true;
  // 大缓存不要每次增量扫站都同步写盘，否则会把 CPU/IO 打满导致 502。
  if (tgRun().overviewDiskWriteTimer) return;
  tgRun().overviewDiskWriteTimer = setTimeout(flushOverviewDisk, OVERVIEW_DISK_FLUSH_MS);
}

function buildBundle(accounts: { id: string; username: string }[], siteKey: string | null, from: string, to: string): Bundle {
  const withRows = Boolean(siteKey);
  const heads: SiteHead[] = [];
  const totals: BundleTotals = { fake: 0, fakeIps: 0, suspect: 0, suspectIps: 0, realPv: 0, farm: 0, crawler: 0, other: 0, popupShown: 0, popupAll: 0, popupClosed: 0, slidePassed: 0, realIps: 0 };
  const memory = headMemo();
  const add = (head: SiteHead) => {
    heads.push(head);
    totals.fake += head.fake;
    totals.fakeIps += head.fakeIps;
    totals.suspect += head.suspect;
    totals.suspectIps += head.suspectIps;
    totals.realPv += head.realPv;
    totals.farm += head.farm;
    totals.crawler += head.crawler;
    totals.other += head.other;
    totals.popupShown += head.popupShown;
    totals.popupAll += head.popupAll;
    totals.popupClosed += head.popupClosed;
    totals.slidePassed += head.slidePassed;
    totals.realIps += head.ipCount;
  };
  const jobs: Array<{ id: string; username: string; key: string }> = [];
  for (const account of accounts) {
    const keys = siteKey ? [siteKey] : listSites(account.id);
    for (const key of keys) jobs.push({ id: account.id, username: account.username, key });
  }
  let index = 0;
  const take = (budgetMs: number) => {
    const start = Date.now();
    for (; index < jobs.length; index += 1) {
      if (Date.now() - start >= budgetMs) return false;
      const job = jobs[index];
      const siteId = `${job.id}/${job.key}`;
      if (dirtySites.has(siteId)) {
        dirtySites.delete(siteId);
        forgetHead(job.id, job.key);
      } else if (!isAdminReader()) {
        // 后台跨进程读盘，不用本进程 head 记忆（那是检测进程的增量缓存）。
        const saved = memory.get(headMemoKey(job.id, job.key, from, to, withRows));
        if (saved) {
          if (saved.head) add(saved.head);
          continue;
        }
      }
      let daysLive = false;
      try {
        const touched = statSync(locate(job.id, job.key).day).mtimeMs;
        daysLive = shanghaiDay(touched) >= from && rangeActive(loadDays(job.id, job.key), from, to);
      } catch {
        daysLive = false;
      }
      if (!daysLive && realIpsInRange(job.id, job.key, from, to) <= 0) {
        if (!isAdminReader()) rememberHead(job.id, job.key, from, to, null, withRows);
        continue;
      }
      const head = summarizeSite(job.id, job.username, job.key, from, to, withRows);
      if (!isAdminReader()) rememberHead(job.id, job.key, from, to, head, withRows);
      if (head) add(head);
    }
    return true;
  };
  // First paint only. Keep this short — long sync scans freeze every account's SSR.
  take(800);
  return { heads, totals, visits: {}, grouped: {} };
}

function rememberBundle(key: string, value: Bundle, settled: boolean) {
  const memory = bundleMemory();
  const at = Date.now();
  memory.set(key, { at, value, settled });
  if (memory.size > 12) {
    let oldest = "";
    let oldestAt = Infinity;
    for (const [name, item] of memory) {
      if (item.at < oldestAt) {
        oldest = name;
        oldestAt = item.at;
      }
    }
    if (oldest) memory.delete(oldest);
  }
  return at;
}

function publishBundle(key: string, value: Bundle) {
  // 内存留全量站点（allHeads），表格和磁盘只留假量靠前的站。合计不跟着裁剪。
  const at = rememberBundle(key, value, true);
  writeOverviewDisk(key, at, value);
}

const largeBackfillKeys = tgSet<string>("largeBackfillKeys");

/** 大账号站点表回补：只扫「当天触达」名单，禁止再对三十万站目录做 stat。 */
function scheduleLargeBackfill(account: { id: string; username: string }, from: string, to: string, key: string) {
  if (largeBackfillKeys.has(key)) return;
  const live = fastPvTotals([account], from, to);
  const traffic = (live?.fake || 0) + (live?.realPv || 0) + (live?.suspect || 0);
  if (live && traffic <= 0) return;
  largeBackfillKeys.add(key);
  const dirty = takeDirtySites(account.id, 2_000);
  const touched = sitesTouchedInRange(account.id, from, to);
  // 脏站优先；当天触达可能上万，截断以免回补本身又打满 CPU。顶栏仍走 day-totals。
  const names = [...new Set(dirty.concat(touched))];
  const BACKFILL_CAP = 2_500;
  if (names.length > BACKFILL_CAP) names.length = BACKFILL_CAP;
  if (!names.length) {
    largeBackfillKeys.delete(key);
    return;
  }
  const prior = priorOverviewBundle(key);
  const bySite = new Map<string, SiteHead>();
  for (const head of prior?.allHeads || prior?.heads || []) bySite.set(head.site, head);
  let cursor = 0;
  const sum = () => {
    const began = Date.now();
    for (; cursor < names.length && Date.now() - began < 20; cursor += 1) {
      try {
        const head = summarizeSite(account.id, account.username, names[cursor], from, to, false);
        if (head) bySite.set(names[cursor], head);
        else bySite.delete(names[cursor]);
      } catch {
        /* 单站失败不影响其余站 */
      }
    }
    if (cursor < names.length) {
      setImmediate(sum);
      return;
    }
    const found = [...bySite.values()];
    publishBundle(key, { heads: pruneHeads(found), totals: sumHeads(found), allHeads: found, visits: {}, grouped: {} });
    largeBackfillKeys.delete(key);
  };
  setImmediate(sum);
}

let bundleGeneration = 0;

const overviewQueue = (tgRun().overviewQueue || (tgRun().overviewQueue = [])) as Array<{ accounts: { id: string; username: string }[]; from: string; to: string; key: string }>;

function runOverviewQueue() {
  if (scanActive()) return;
  const next = overviewQueue.shift();
  if (!next) return;
  setScanActive(true);
  scanOverview(next.accounts, next.from, next.to, next.key, () => {
    overviewQueued.delete(next.key);
    setScanActive(false);
    runOverviewQueue();
  });
}

function scheduleOverviewRefresh(accounts: { id: string; username: string }[], from: string, to: string, key: string) {
  // 多账号视图改走单账号缓存拼接，不再排队扫「全部站点」巨任务。
  if (accounts.length > 1) {
    for (const account of accounts) {
      scheduleOverviewRefresh([account], from, to, bundleCacheKey([account], from, to));
    }
    return;
  }
  if (overviewQueued.has(key)) return;
  overviewQueued.add(key);
  overviewQueue.unshift({ accounts, from, to, key });
  runOverviewQueue();
}

function scanOverview(accounts: { id: string; username: string }[], from: string, to: string, key: string, done: () => void) {
  const generation = bundleGeneration;
  const withRows = false;
  const memory = headMemo();
  const emptyTotals = (): BundleTotals => ({
    fake: 0,
    fakeIps: 0,
    suspect: 0,
    suspectIps: 0,
    realPv: 0,
    farm: 0,
    crawler: 0,
    other: 0,
    popupShown: 0,
    popupAll: 0,
    popupClosed: 0,
    slidePassed: 0,
    realIps: 0,
  });
  const summarizeOne = (job: { id: string; username: string; key: string }): SiteHead | null => {
    const siteId = `${job.id}/${job.key}`;
    if (dirtySites.has(siteId)) {
      dirtySites.delete(siteId);
      forgetHead(job.id, job.key);
    } else {
      const saved = memory.get(headMemoKey(job.id, job.key, from, to, withRows));
      if (saved) return saved.head;
    }
    let daysLive = false;
    try {
      const touched = statSync(locate(job.id, job.key).day).mtimeMs;
      daysLive = shanghaiDay(touched) >= from && rangeActive(loadDays(job.id, job.key), from, to);
    } catch {
      daysLive = false;
    }
    if (!daysLive && realIpsInRange(job.id, job.key, from, to) <= 0) {
      rememberHead(job.id, job.key, from, to, null, withRows);
      return null;
    }
    try {
      const head = summarizeSite(job.id, job.username, job.key, from, to, withRows);
      rememberHead(job.id, job.key, from, to, head, withRows);
      return head;
    } catch {
      rememberHead(job.id, job.key, from, to, null, withRows);
      return null;
    }
  };

  // 超大账号：只扫脏站点并合并旧 heads，禁止再 readdir/扫十万站。
  if (accounts.length === 1 && isLargeAccount(accounts[0].id)) {
    const account = accounts[0];
    const prior = priorOverviewBundle(key);
    if (!prior?.heads?.length || (!prior.allHeads && prior.heads.length >= OVERVIEW_HEAD_CAP)) {
      // 没有全量站点时不要先取走脏标记。回补会自己扫当天改过的 days.json。
      scheduleLargeBackfill(account, from, to, key);
      done();
      return;
    }
    const dirtyKeys = takeDirtySites(account.id);
    if (!dirtyKeys.length) {
      done();
      return;
    }
    const source = prior.allHeads?.length ? prior.allHeads : prior.heads;
    const bySite = new Map<string, SiteHead>();
    for (const head of source) bySite.set(head.site, head);
    let index = 0;
    const step = () => {
      if (generation !== bundleGeneration) {
        done();
        return;
      }
      const start = Date.now();
      for (; index < dirtyKeys.length && Date.now() - start < 20; index += 1) {
        const site = dirtyKeys[index];
        const head = summarizeOne({ id: account.id, username: account.username, key: site });
        if (head) bySite.set(site, head);
        else bySite.delete(site);
      }
      if (index < dirtyKeys.length) {
        setImmediate(step);
        return;
      }
      const all = [...bySite.values()];
      publishBundle(key, { heads: pruneHeads(all), totals: sumHeads(all), allHeads: all, visits: {}, grouped: {} });
      done();
    };
    setImmediate(step);
    return;
  }

  const jobs: Array<{ id: string; username: string; key: string }> = [];
  for (const account of accounts) {
    for (const site of listSites(account.id)) jobs.push({ id: account.id, username: account.username, key: site });
  }
  const heads: SiteHead[] = [];
  const totals = emptyTotals();
  const add = (head: SiteHead) => {
    heads.push(head);
    totals.fake += head.fake;
    totals.fakeIps += head.fakeIps;
    totals.suspect += head.suspect;
    totals.suspectIps += head.suspectIps;
    totals.realPv += head.realPv;
    totals.farm += head.farm;
    totals.crawler += head.crawler;
    totals.other += head.other;
    totals.popupShown += head.popupShown;
    totals.popupAll += head.popupAll;
    totals.popupClosed += head.popupClosed;
    totals.slidePassed += head.slidePassed;
    totals.realIps += head.ipCount;
  };
  let index = 0;
  const step = () => {
    if (generation !== bundleGeneration) {
      done();
      return;
    }
    const start = Date.now();
    for (; index < jobs.length && Date.now() - start < 20; index += 1) {
      const head = summarizeOne(jobs[index]);
      if (head) add(head);
    }
    if (index < jobs.length) {
      setImmediate(step);
      return;
    }
    publishBundle(key, { heads, totals, visits: {}, grouped: {} });
    done();
  };
  setImmediate(step);
}

function withLiveTotals(accounts: { id: string; username: string }[], from: string, to: string, bundle: Bundle): Bundle {
  const live = fastPvTotals(accounts, from, to);
  if (!live) return bundle;
  return {
    ...bundle,
    totals: {
      ...bundle.totals,
      fake: live.fake ?? bundle.totals.fake,
      realPv: live.realPv ?? bundle.totals.realPv,
      suspect: live.suspect ?? bundle.totals.suspect,
      farm: live.farm ?? bundle.totals.farm,
      crawler: live.crawler ?? bundle.totals.crawler,
      other: live.other ?? bundle.totals.other,
      slidePassed: live.slidePassed ?? bundle.totals.slidePassed,
      // 真实 IP / 嫌疑 IP / IP假量：各站名单分别去重后再相加，跨站相同 IP 不算一次。
    },
  };
}

function mergeBundles(parts: Bundle[]): Bundle {
  const heads: SiteHead[] = [];
  const totals: BundleTotals = {
    fake: 0,
    fakeIps: 0,
    suspect: 0,
    suspectIps: 0,
    realPv: 0,
    farm: 0,
    crawler: 0,
    other: 0,
    popupShown: 0,
    popupAll: 0,
    popupClosed: 0,
    slidePassed: 0,
    realIps: 0,
  };
  for (const part of parts) {
    for (const head of part.heads || []) heads.push(head);
    const t = part.totals;
    if (!t) continue;
    totals.fake += t.fake || 0;
    totals.fakeIps += t.fakeIps || 0;
    totals.suspect += t.suspect || 0;
    totals.suspectIps += t.suspectIps || 0;
    totals.realPv += t.realPv || 0;
    totals.farm += t.farm || 0;
    totals.crawler += t.crawler || 0;
    totals.other += t.other || 0;
    totals.popupShown += t.popupShown || 0;
    totals.popupAll += t.popupAll || 0;
    totals.popupClosed += t.popupClosed || 0;
    totals.slidePassed += t.slidePassed || 0;
    totals.realIps += t.realIps || 0;
  }
  return { heads, totals, visits: {}, grouped: {} };
}

function shouldRefreshSolo(accountId: string, settled: boolean, age: number) {
  const dirty = accountHasDirtySites(accountId);
  if (dirty) return true;
  if (!settled) return true;
  // 后台不共享检测进程的脏站集合；短 TTL + day-totals mtime，保证数字及时跟上。
  if (isAdminReader()) {
    const id = normalizeAccountId(accountId) || "";
    const totalsPath = totalsFile(id);
    if (fileNewer(totalsPath, accountTotalsMtime.get(id) || 0)) return true;
    return age >= 8_000;
  }
  const staleMs = isLargeAccount(accountId) ? BUNDLE_STALE_LARGE_MS : BUNDLE_STALE_MS;
  return age >= staleMs;
}

function maybeBackfillLarge(account: { id: string; username: string }, from: string, to: string, key: string, bundle: Bundle) {
  if (!isLargeAccount(account.id) || bundle.allHeads) return;
  // 已有满页站点时只靠脏站增量；再触发全量回补会把事件循环打满。
  if (bundle.heads.length === 0) scheduleLargeBackfill(account, from, to, key);
}

function loadSoloBundle(account: { id: string; username: string }, from: string, to: string): Bundle | null {
  const key = bundleCacheKey([account], from, to);
  const memory = bundleMemory();
  const hit = memory.get(key);
  if (hit?.value?.heads && hit.value.totals) {
    const age = Date.now() - hit.at;
    if (shouldRefreshSolo(account.id, Boolean(hit.settled), age)) {
      scheduleOverviewRefresh([account], from, to, key);
    }
    if (isLargeAccount(account.id)) maybeBackfillLarge(account, from, to, key, hit.value);
    return hit.value;
  }
  const saved = readOverviewDisk().entries[key];
  if (saved?.value?.heads && saved.value.totals) {
    // 磁盘缓存先当 settled，超大账号不再启动即全量扫。
    const large = isLargeAccount(account.id);
    const value = saved.value.heads.length > OVERVIEW_HEAD_CAP ? compactBundle(saved.value) : saved.value;
    if (value !== saved.value) writeOverviewDisk(key, saved.at, value);
    memory.set(key, { at: saved.at, value, settled: true });
    if (!large || accountHasDirtySites(account.id)) {
      scheduleOverviewRefresh([account], from, to, key);
    }
    if (large) maybeBackfillLarge(account, from, to, key, value);
    return value;
  }
  // 超大账号冷启动：不要立刻 listSites 十万目录，先空壳 + day-totals 顶栏。
  if (isLargeAccount(account.id)) {
    const empty: Bundle = {
      heads: [],
      totals: { fake: 0, fakeIps: 0, suspect: 0, suspectIps: 0, realPv: 0, farm: 0, crawler: 0, other: 0, popupShown: 0, popupAll: 0, popupClosed: 0, slidePassed: 0, realIps: 0 },
      visits: {},
      grouped: {},
    };
    memory.set(key, { at: Date.now(), value: empty, settled: true });
    scheduleLargeBackfill(account, from, to, key);
    return empty;
  }
  return null;
}

function loadBundle(accounts: { id: string; username: string }[], siteKey: string | null, from: string, to: string) {
  // 单站详情用该站自己的汇总；实时账本只覆盖「全部站点」顶部卡片。
  if (siteKey) return buildBundle(accounts, siteKey, from, to);
  for (const account of accounts) seedLiveAccount(account.id);

  // 多账号（管理员全部 / 父账号+子账号）：只拼单账号缓存，绝不冷扫十万站。
  if (accounts.length > 1) {
    const parts: Bundle[] = [];
    let missing = false;
    for (const account of accounts) {
      const solo = loadSoloBundle(account, from, to);
      if (!solo) {
        missing = true;
        scheduleOverviewRefresh([account], from, to, bundleCacheKey([account], from, to));
        parts.push({ heads: [], totals: { fake: 0, fakeIps: 0, suspect: 0, suspectIps: 0, realPv: 0, farm: 0, crawler: 0, other: 0, popupShown: 0, popupAll: 0, popupClosed: 0, slidePassed: 0, realIps: 0 }, visits: {}, grouped: {} });
        continue;
      }
      parts.push(solo);
    }
    const merged = mergeBundles(parts);
    if (!missing) rememberBundle(bundleCacheKey(accounts, from, to), merged, true);
    return withLiveTotals(accounts, from, to, merged);
  }

  const key = bundleCacheKey(accounts, from, to);
  const memory = bundleMemory();
  const soloId = accounts[0]?.id || "";
  const hit = memory.get(key);
  if (hit) {
    const age = Date.now() - hit.at;
    if (shouldRefreshSolo(soloId, Boolean(hit.settled), age)) scheduleOverviewRefresh(accounts, from, to, key);
    if (soloId) maybeBackfillLarge(accounts[0], from, to, key, hit.value);
    return withLiveTotals(accounts, from, to, hit.value);
  }
  const saved = readOverviewDisk().entries[key];
  if (saved?.value?.heads && saved.value.totals) {
    const large = soloId ? isLargeAccount(soloId) : false;
    memory.set(key, { at: saved.at, value: saved.value, settled: true });
    if (!large || accountHasDirtySites(soloId)) scheduleOverviewRefresh(accounts, from, to, key);
    if (large) maybeBackfillLarge(accounts[0], from, to, key, saved.value);
    return withLiveTotals(accounts, from, to, saved.value);
  }
  // Cold start: short partial for the cards, then full scan. Never mark settled here.
  // 超大账号禁止同步 buildBundle（内部会 listSites 十万站）。
  if (soloId && isLargeAccount(soloId)) {
    const empty: Bundle = {
      heads: [],
      totals: { fake: 0, fakeIps: 0, suspect: 0, suspectIps: 0, realPv: 0, farm: 0, crawler: 0, other: 0, popupShown: 0, popupAll: 0, popupClosed: 0, slidePassed: 0, realIps: 0 },
      visits: {},
      grouped: {},
    };
    rememberBundle(key, empty, true);
    scheduleLargeBackfill(accounts[0], from, to, key);
    return withLiveTotals(accounts, from, to, empty);
  }
  const value = buildBundle(accounts, null, from, to);
  rememberBundle(key, value, false);
  scheduleOverviewRefresh(accounts, from, to, key);
  return withLiveTotals(accounts, from, to, value);
}

function sumHeads(heads: SiteHead[]) {
  const totals: BundleTotals = { fake: 0, fakeIps: 0, suspect: 0, suspectIps: 0, realPv: 0, farm: 0, crawler: 0, other: 0, popupShown: 0, popupAll: 0, popupClosed: 0, slidePassed: 0, realIps: 0 };
  for (const head of heads) {
    totals.fake += head.fake;
    totals.fakeIps += head.fakeIps;
    totals.suspect += head.suspect;
    totals.suspectIps += head.suspectIps;
    totals.realPv += head.realPv;
    totals.farm += head.farm;
    totals.crawler += head.crawler;
    totals.other += head.other;
    totals.popupShown += head.popupShown;
    totals.popupAll += head.popupAll;
    totals.popupClosed += head.popupClosed;
    totals.slidePassed += head.slidePassed;
    totals.realIps += head.ipCount;
  }
  return totals;
}

function notedHead(account: string, accountId: string, site: string, from: string, to: string) {
  const head = emptyHead(account, accountId, site);
  try {
    head.ipCount = realIpCount(accountId, site, from, to);
  } catch {
    /* a note for an unknown site still lists with zero */
  }
  return head;
}

function blankPart(): TrafficPart {
  return { count: 0, note: "", startedAt: 0, visitedAt: 0, dwellMs: 0 };
}

function visitRow(head: SiteHead, row: RollupRow, verdict: VerdictFilter): TrafficRow & { ipCount: number } {
  const part = (verdict === "fake" ? row.parts.fake : row.parts[verdict]) || blankPart();
  return {
    account: head.account,
    site: head.site,
    host: row.host,
    ip: row.ip,
    note: part.note,
    device: deviceClaim(head.accountId, row.ip) || row.device || "",
    label: row.host ? `来路:${row.host}` : "直接访问",
    traffic: row.host || "直接访问",
    count: part.count,
    startedAt: part.startedAt,
    visitedAt: part.visitedAt,
    dwellMs: part.dwellMs,
    sitePv: head.popupShown,
    sitePopupAll: head.popupAll,
    siteIpCount: head.ipCount,
    siteFake: head.fake,
    siteFakeIps: head.fakeIps,
    siteSuspect: head.suspect,
    siteSuspectIps: head.suspectIps,
    siteFarm: head.farm,
    siteCrawler: head.crawler,
    siteOther: head.other,
    siteSlide: head.slidePassed,
    siteClosed: head.popupClosed,
    ipCount: 0,
    parts: row.parts,
  };
}

function siteRow(head: SiteHead, verdict: VerdictFilter): TrafficRow & { ipCount: number } {
  const count = verdict === "suspect"
    ? (head.partCount.suspect || head.suspect || 0)
    : (head.partCount[verdict] || 0);
  const ipCount = verdict === "suspect"
    ? (head.partIps.suspect || head.suspectIps || 0)
    : (head.partIps[verdict] || 0);
  return {
    account: head.account,
    site: head.site,
    host: "",
    ip: "",
    note: "",
    device: "",
    label: "",
    traffic: "",
    count,
    startedAt: 0,
    visitedAt: 0,
    dwellMs: 0,
    sitePv: head.popupShown,
    sitePopupAll: head.popupAll,
    siteIpCount: head.ipCount,
    siteFake: head.fake,
    siteFakeIps: head.fakeIps,
    siteSuspect: head.suspect,
    siteSuspectIps: head.suspectIps,
    siteFarm: head.farm,
    siteCrawler: head.crawler,
    siteOther: head.other,
    siteSlide: head.slidePassed,
    siteClosed: head.popupClosed,
    ipCount,
    parts: {},
  };
}

export function reportPage(input: {
  accounts: { id: string; username: string }[];
  siteKey: string | null;
  from: string;
  to: string;
  verdict: VerdictFilter;
  q: string;
  page: number;
  pageSize: number;
  notes: Record<string, string>;
  list?: "visits" | "sites";
}) {
  const pageSize = input.pageSize === 50 || input.pageSize === 100 ? input.pageSize : 20;
  const needle = input.q.trim().toLowerCase();
  const bundle = loadBundle(input.accounts, input.siteKey, input.from, input.to);
  const searching = Boolean(needle) && !input.siteKey;
  const detail = ((input.verdict === "farm" || input.verdict === "crawler" || input.verdict === "suspect") && !input.siteKey) || searching;
  let heads = bundle.heads;
  let totals = bundle.totals;
  if (searching) {
    const seen = new Set<string>();
    const matched: SiteHead[] = [];
    for (const head of heads) {
      const note = input.notes[`${head.accountId}\n${head.site}`] || "";
      if (!head.site.toLowerCase().includes(needle) && !note.toLowerCase().includes(needle)) continue;
      matched.push(head);
      seen.add(`${head.accountId}\n${head.site}`);
    }
    for (const account of input.accounts) {
      for (const [key, note] of Object.entries(input.notes)) {
        const splitAt = key.indexOf("\n");
        if (splitAt < 0) continue;
        const accountId = key.slice(0, splitAt);
        const siteName = key.slice(splitAt + 1);
        if (accountId !== account.id || !siteName) continue;
        if (!siteName.toLowerCase().includes(needle) && !note.toLowerCase().includes(needle)) continue;
        const id = `${accountId}\n${siteName}`;
        if (seen.has(id)) continue;
        seen.add(id);
        matched.push(notedHead(account.username, account.id, siteName, input.from, input.to));
      }
      // 大账号禁止在 SSR 里扫十万站目录；名单走缓存/索引，最多补 80 条。
      const picked = listSitesForPicker(account.id, needle, 80).items;
      for (const siteName of picked) {
        const id = `${account.id}\n${siteName}`;
        if (seen.has(id)) continue;
        seen.add(id);
        matched.push(notedHead(account.username, account.id, siteName, input.from, input.to));
      }
    }
    heads = matched;
    totals = sumHeads(matched);
  }
  const clamp = (total: number) => {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(input.page) || 1), pageCount);
    return { page, start: (page - 1) * pageSize };
  };
  if (input.list === "sites" && input.verdict !== "farm" && input.verdict !== "crawler" && input.verdict !== "suspect") {
    // overview 已按假量排好序；只过滤，避免每次 SSR 对几万站 sort。
    const visible = heads.filter((head) => searching || head.ipCount > 0 || head.popupAll > 0 || head.fake > 0 || head.suspect > 0);
    const { page, start } = clamp(visible.length);
    return {
      ...totals,
      rows: visible.slice(start, start + pageSize).map((head) => siteRow(head, "fake")),
      total: visible.length,
      page,
      detail: "real" as const,
      focusIp: 0,
      focusFake: 0,
      focusPv: 0,
      focusFakeIps: 0,
      focusSuspect: 0,
      focusSuspectIps: 0,
      focusReal: 0,
    };
  }
  if (detail) {
    let visible = searching ? null : bundle.grouped[input.verdict];
    if (!visible) {
      visible = (searching ? heads : heads.filter((head) => {
        if ((head.partCount[input.verdict] || 0) > 0) return true;
        if (input.verdict === "suspect") return (head.suspect || 0) > 0 || (head.suspectIps || 0) > 0;
        return false;
      })).slice();
      visible.sort((a, b) => {
        const score = (head: SiteHead) => input.verdict === "suspect"
          ? (head.partCount.suspect || head.suspect || 0)
          : (head.partCount[input.verdict] || 0);
        return score(b) - score(a) || a.site.localeCompare(b.site, "en") || a.account.localeCompare(b.account, "en");
      });
      if (!searching) bundle.grouped[input.verdict] = visible;
    }
    const { page, start } = clamp(visible.length);
    return { ...totals, rows: visible.slice(start, start + pageSize).map((head) => siteRow(head, input.verdict)), total: visible.length, page, detail: "sites" as const, focusIp: 0, focusFake: 0, focusPv: 0, focusFakeIps: 0, focusSuspect: 0, focusSuspectIps: 0, focusReal: 0 };
  }
  let items = bundle.visits[input.verdict];
  if (!items) {
    items = [];
    for (const head of heads) {
      for (const row of head.rows) {
        // 普通直达/站内跳转不进假量明细。
        if (!row.host) continue;
        if (sameSite(row.host, head.site)) continue;
        const part = input.verdict === "fake" ? row.parts.fake : row.parts[input.verdict];
        if (!part?.count) continue;
        items.push({ head, row, count: part.count });
      }
    }
    items.sort((a, b) => b.count - a.count || a.head.account.localeCompare(b.head.account) || a.head.site.localeCompare(b.head.site) || a.row.ip.localeCompare(b.row.ip, "en") || a.row.host.localeCompare(b.row.host, "en"));
    bundle.visits[input.verdict] = items;
  }
  const { page, start } = clamp(items.length);
  const focused = input.siteKey ? heads.find((head) => head.site === input.siteKey) : undefined;
  return {
    ...totals,
    rows: items.slice(start, start + pageSize).map((item) => visitRow(item.head, item.row, input.verdict)),
    total: items.length,
    page,
    detail: "visits" as const,
    focusIp: focused?.ipCount || 0,
    focusFake: focused?.popupAll || 0,
    focusPv: focused?.fake || 0,
    focusFakeIps: focused?.fakeIps || 0,
    focusSuspect: focused?.suspect || 0,
    focusSuspectIps: focused?.suspectIps || 0,
    focusReal: focused?.realPv || 0,
  };
}

export function warmReports() {
  const g = storeGlobal as StoreGlobal & { __tgWarming?: boolean };
  if (g.__tgWarming) return;
  g.__tgWarming = true;
  setImmediate(() => {
    try {
      const today = shanghaiDay();
      const accounts = listAccounts().map((account) => ({ id: account.id, username: account.username }));
      if (!accounts.length) return;
      for (const account of accounts) seedLiveAccount(account.id);
      // 只预热单账号；超大账号只加载磁盘缓存，禁止启动即全量扫站。
      for (const account of accounts) {
        const group = [account];
        const key = bundleCacheKey(group, today, today);
        const saved = readOverviewDisk().entries[key];
        const large = isLargeAccount(account.id);
        if (saved?.value?.heads && saved.value.totals) {
          bundleMemory().set(key, { at: saved.at, value: saved.value, settled: true });
        }
        if (large) continue;
        scheduleOverviewRefresh(group, today, today, key);
      }
    } catch {
      /* the first page view still builds the same index */
    }
  });
}
