export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startEventLoopMonitor } = await import("@/lib/load");
  startEventLoopMonitor();
  const { warmClaims } = await import("@/lib/claims");
  warmClaims();
  // 检测进程启动时禁止预热扫库，否则与洪峰 check 叠在一起会堵死事件循环。
  if (process.env.TG_SKIP_WARM === "1") return;
  const { warmReports } = await import("@/lib/store");
  warmReports();
}
