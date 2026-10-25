import { createHash, randomUUID } from "node:crypto";
import { referrerHost } from "@/lib/day";
import { classifySuspectEngage } from "@/lib/engage";
import { isGroupControlSuspect } from "@/lib/group-control";
import { collectLearnHints } from "@/lib/learn";
import { observeMemory } from "@/lib/memory";
import { sameSite } from "@/lib/registrable";
import { SUSPICIOUS_SCORE, evaluateCheck, fingerprint } from "@/lib/score";
import { normalizeSiteKey } from "@/lib/site";
import { cleanSource } from "@/lib/source";
import { noteSourceProbe } from "@/lib/source-probe";
import { recordVisit } from "@/lib/store";
import type { CheckResult, ClientSignals, Reason } from "@/lib/types";

export function challengeFor(action: "allow" | "flag", _categories: string[]) {
  return action === "flag";
}

/** 脏特征里只有来路信誉（bad_source，可附带 watch_source），没有环境/设备/出口等。 */
function onlyBadSourceReputation(categories: string[]) {
  const ignore = new Set([
    "good_source",
    "good_ip",
    "good_device",
    "cdn_ip",
    "private_ip",
    "group_control",
    "human_engage",
    "source_rep_pass",
  ]);
  const dirty = categories.filter((code) => !ignore.has(code));
  if (!dirty.includes("bad_source")) return false;
  return dirty.every((code) => code === "bad_source" || code === "watch_source");
}

function farmPattern(signals: ClientSignals, followUp?: boolean) {
  if (!followUp) return "";
  const engagement = signals.engagement || {};
  const motion = signals.motion || {};
  const samples = motion.samples || 0;
  const mag = motion.accelMag || 0;
  const bucket = samples < 6 ? "n" : mag < 1.2 ? "z" : "g";
  const pointer = (engagement.pointerMoves || 0) < 2 ? "p0" : "p1";
  const scroll = (engagement.scroll || 0) < 12 ? "s0" : "s1";
  const pattern = `${pointer}|${scroll}|${bucket}`;
  return pattern === "p0|s0|z" ? pattern : "";
}

export function runCheck(input: {
  ip: string;
  accountId: string;
  siteKey: string;
  signals: ClientSignals;
  headerUa: string;
  lab?: boolean;
  source?: unknown;
  persist?: boolean;
  followUp?: boolean;
}): CheckResult {
  const siteKey = normalizeSiteKey(input.siteKey);
  if (!siteKey) throw new Error("invalid site");
  const leaving = Boolean(input.signals.engagement?.leaving);
  // 离开上报也算二次监测：跳转站常在 4 秒定时器前 pagehide，不能只靠 followUp 字段。
  const followUp = Boolean(input.followUp || leaving);
  const fp = fingerprint(input.signals, input.signals.ua || input.headerUa || "");
  const fpKey = createHash("sha1").update(fp).digest("hex").slice(0, 12);
  const pattern = farmPattern(input.signals, followUp);
  const memory = input.lab || input.persist === false
    ? {}
    : observeMemory(input.ip, fpKey, siteKey, input.signals.visitor || "", pattern, !followUp);
  const source = cleanSource(input.source);
  // 没有外部广告来路（空来路、直达、站内跳转）一律按真实：没有来路域名就无法判断假量从哪来，不记假量、不弹窗。
  const refHost = referrerHost(source.referrer || "");
  const pageHost = source.host || siteKey;
  const direct = !refHost || sameSite(refHost, pageHost);
  // 有外部广告来路时套用自我学习（来路 / 出口 / 设备），越用越准；二次监测才可能弹窗。
  const learnHints =
    !input.lab && input.persist !== false && !direct
      ? collectLearnHints({
          accountId: input.accountId,
          host: refHost,
          ip: input.ip,
          fp: fpKey,
          externalSource: true,
        })
      : [];
  const judged = evaluateCheck({
    ip: input.ip,
    signals: input.signals,
    headerUa: input.headerUa,
    followUp,
    memory,
    learnHints,
  });
  const farm = judged.categories.includes("datacenter_ip");
  const virtual = judged.categories.includes("proxy_ip");
  const suspicious = judged.verdict === "suspicious" && judged.score >= SUSPICIOUS_SCORE;
  let action: "allow" | "flag" = judged.verdict === "fake" || suspicious ? "flag" : "allow";
  // Only a confirmed fake may cover the page. A single soft signal leaves the site usable.
  let challenge = judged.verdict === "fake" && challengeFor(action, judged.categories);
  let verdict = judged.verdict;
  const reasons: Reason[] = judged.reasons.slice();
  const categories = judged.categories.slice();
  if (direct) {
    action = "allow";
    challenge = false;
    verdict = "real";
  } else if (!followUp && !input.lab) {
    // 先进站再监测：首次只放行、不弹窗盖页，且不落库。
    // 约 4 秒后的二次检测（或离开时的 followUp）再记真实 / 嫌疑 / 假量，避免秒退冲高真实量。
    action = "allow";
    challenge = false;
  } else if (followUp && !input.lab && onlyBadSourceReputation(categories)) {
    // 仅「来路信誉差」：全部记真实、不弹窗（不再因来路账本误伤整条渠道）。
    action = "allow";
    challenge = false;
    verdict = "real";
    reasons.push({
      code: "source_rep_pass",
      label: "来路信誉不拦",
      detail: "只有来路信誉差、没有其它脏特征，记真实不弹窗",
      weight: 0,
    });
  } else if (followUp && !input.lab && suspicious) {
    // 群控/仿真人（有广告来路）：必弹窗验证，不被「正常浏览 → 真实」短路。
    // 空来路已在上方强制真实，不会进此分支。
    if (isGroupControlSuspect(categories)) {
      action = "flag";
      verdict = "fake";
      if (!categories.includes("group_control")) categories.push("group_control");
      reasons.push({
        code: "group_control",
        label: "群控仿真",
        detail: "设备/来路/农场特征像群控或仿真人，需滑块验证",
        weight: 40,
      });
    } else {
      // 普通软嫌疑看互动：正常浏览 → 真实；脚本态 → 假量；无操作/轻触 → 继续嫌疑。
      const engage = classifySuspectEngage(input.signals);
      if (engage === "human") {
        action = "allow";
        challenge = false;
        verdict = "real";
        reasons.push({
          code: "human_engage",
          label: "正常浏览",
          detail: "下拉或移动像真人浏览，不像脚本",
          weight: 0,
        });
      } else if (engage === "idle") {
        // 机房 IP 完全不动：不洗白、不继续挂嫌疑，直接假量并弹窗（离开未滑仍记假）。
        if (farm || categories.includes("datacenter_ip")) {
          action = "flag";
          verdict = "fake";
          if (!categories.includes("idle_datacenter")) categories.push("idle_datacenter");
          reasons.push({
            code: "idle_datacenter",
            label: "机房无操作",
            detail: "机房地址进站后没有下拉或移动，需滑块验证",
            weight: 40,
          });
        } else {
          action = "allow";
          challenge = false;
          // verdict 保持 suspicious
        }
      } else {
        action = "flag";
        verdict = "fake";
        if (!categories.includes("weak_engage")) categories.push("weak_engage");
        reasons.push({
          code: "weak_engage",
          label: "脚本互动",
          detail: "轨迹过于匀速、点击间隔过匀，或真人概率过低",
          weight: 40,
        });
      }
    }
  }
  // 硬自动化（爬虫/无头/webdriver）不弹窗：直接假量，避免脚本滑过冲高「滑动成功」。
  // 其余假量：人还在页上就弹窗；滑不过 / 关掉 / 超时 / 离开未滑 → 假量；滑过 → 真实。
  const hardAuto = categories.some((code) =>
    code === "known_crawler" ||
    code === "webdriver" ||
    code === "headless" ||
    code === "automation" ||
    code === "disguised_automation"
  );
  if (!input.lab && followUp && !direct && verdict === "fake") {
    action = "flag";
    challenge = !leaving && !hardAuto;
  }
  if (!input.lab && input.persist !== false) {
    noteSourceProbe({
      accountId: input.accountId,
      siteKey,
      source,
      judgedVerdict: judged.verdict,
      finalVerdict: verdict,
      direct,
    });
  }
  const result: CheckResult & { lab?: boolean; fp?: string } = {
    ok: true,
    id: randomUUID(),
    at: Date.now(),
    accountId: input.accountId,
    siteKey,
    ip: input.ip,
    verdict,
    action,
    challenge,
    farm,
    virtual,
    tracked: action === "flag",
    score: judged.score,
    categories,
    reasons,
    ua: judged.ua,
    source,
    lab: input.lab || undefined,
    fp: fpKey,
  };
  // 首次打开不记账；二次检测（含离开触发）或实验室请求才落库。
  // 仅「需要滑块」的假量才 defer；硬自动化当场落假量。
  // 记 IP 口径靠拢百度统计：要像「有效浏览」才落库。
  // - 有广告来路：停留不足约 4 秒且几乎无操作 → 不记（含秒退离开）
  // - 空来路/直达：同样要求，避免 WebView 空 referrer 冲高真实 IP
  const elapsed = Number(input.signals.engagement?.elapsed || 0);
  const moves = Number(input.signals.engagement?.pointerMoves || 0);
  const scrolls = Number(input.signals.engagement?.scroll || 0);
  const engaged = moves >= 2 || scrolls >= 1;
  const MIN_DWELL_MS = 4000;
  const thinVisit =
    !input.lab &&
    followUp &&
    !engaged &&
    elapsed < MIN_DWELL_MS;
  if (input.persist !== false && (followUp || input.lab) && !thinVisit) {
    recordVisit(result, { defer: verdict === "fake" && action === "flag" && !leaving && challenge });
  }
  return result;
}
