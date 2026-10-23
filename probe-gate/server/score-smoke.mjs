/** node server/score-smoke.mjs */
import { buildScore, softWatchScore, levelFromScore } from "./score.mjs";

function ok(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
  } else console.log("ok", name);
}

ok("level-boundaries", levelFromScore(0).id === "normal" && levelFromScore(20).id === "watch" && levelFromScore(40).id === "suspect" && levelFromScore(70).id === "fake");

const soft = softWatchScore("Mozilla/5.0 (Linux; Android 13; SM-G991B) Mobile Safari/537.36", {
  uaMobile: true,
  platform: "Linux armv8l",
  touch: 0,
  hasOrientation: false,
  hasMotion: false,
  netType: "ethernet",
  screen: "1920x1080",
  dpr: 1,
});
ok("soft-capped-under-40", soft.score <= 30 && soft.score >= 20);

const watch = buildScore({ kind: "human" }, "Mozilla/5.0 (Linux; Android 13; SM-G991B) Mobile", {
  uaMobile: true,
  platform: "Linux armv8l",
  touch: 0,
  hasOrientation: false,
  hasMotion: false,
  netType: "ethernet",
  screen: "1920x1080",
  dpr: 1,
});
ok("weak-stack-watch-no-trap", watch.level === "watch" && watch.trap === false && watch.fake === false);

const weak = buildScore({ kind: "human" }, "Mozilla/5.0 (Linux; Android 13; SM-G991B) Mobile", {
  uaMobile: true,
  platform: "Linux armv8l",
  touch: 0,
  hasOrientation: false,
  hasMotion: false,
});
ok("weak-only-no-trap", weak.trap === false && weak.fake === false && weak.score < 40);

const emu = buildScore({ kind: "emulator" }, "Android BlueStacks", {});
ok("emulator-suspect-or-fake", emu.score >= 40 && emu.trap === true);

const bot = buildScore({ kind: "crawler" }, "curl/8.5.0", {});
ok("crawler-confirmed-fake", bot.level === "fake" && bot.score >= 70);

const dc = buildScore({ kind: "datacenter" }, "Mozilla/5.0 Chrome/120", {});
ok("datacenter-suspect", dc.level === "suspect" && dc.trap === true && dc.score === 40);

const clean = buildScore({ kind: "human" }, "Mozilla/5.0 (iPhone) Mobile", {
  uaMobile: true,
  platform: "iPhone",
  touch: 5,
});
ok("clean-human-normal", clean.level === "normal" && clean.score < 20);

if (process.exitCode) {
  console.error("score-smoke FAILED");
  process.exit(1);
}
console.log("score-smoke PASSED");
