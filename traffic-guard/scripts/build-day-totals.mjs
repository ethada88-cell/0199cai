#!/usr/bin/env node
/**
 * One-shot: build data/accounts/<id>/day-totals.json from each site's days.json.
 * Safe to re-run. Used after deploy so PV cards never scan 100k sites on request.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "data", "accounts");

function empty() {
  return { fake: 0, real: 0, suspect: 0, farm: 0, crawler: 0, other: 0, slidePassed: 0, popupShown: 0 };
}

function buildAccount(account) {
  const sitesRoot = path.join(ROOT, account, "sites");
  if (!existsSync(sitesRoot)) return null;
  const byDay = {};
  let sites = 0;
  for (const entry of readdirSync(sitesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(sitesRoot, entry.name, "days.json");
    if (!existsSync(file)) continue;
    sites += 1;
    try {
      const days = JSON.parse(readFileSync(file, "utf8"));
      if (!days || typeof days !== "object") continue;
      for (const [day, stat] of Object.entries(days)) {
        if (!stat || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const cur = byDay[day] || empty();
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
  const out = path.join(ROOT, account, "day-totals.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(byDay));
  return { sites, days: Object.keys(byDay).length, today: byDay[new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)] };
}

const accounts = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && /^[a-f0-9]{24}$/.test(entry.name))
  .map((entry) => entry.name);

for (const account of accounts) {
  const t0 = Date.now();
  const result = buildAccount(account);
  console.log(account, result, `${Date.now() - t0}ms`);
}
