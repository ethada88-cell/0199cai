/**
 * 事件循环延迟监测：洪峰时 Next 单线程会堵死，用延迟判断是否进入过载快路径。
 * 过载只影响记量/评分，响应仍立刻放行，不挡正常浏览。
 */

declare global {
  // eslint-disable-next-line no-var
  var __tgLoopLagMs: number | undefined;
  // eslint-disable-next-line no-var
  var __tgLagMonitorStarted: boolean | undefined;
}

const OVERLOAD_LAG_MS = 60;

export function eventLoopLagMs() {
  return globalThis.__tgLoopLagMs || 0;
}

export function isEventLoopOverloaded() {
  return eventLoopLagMs() >= OVERLOAD_LAG_MS;
}

export function startEventLoopMonitor() {
  if (globalThis.__tgLagMonitorStarted) return;
  globalThis.__tgLagMonitorStarted = true;
  globalThis.__tgLoopLagMs = 0;
  const tick = () => {
    const started = Date.now();
    setImmediate(() => {
      globalThis.__tgLoopLagMs = Date.now() - started;
      setTimeout(tick, 150).unref?.();
    });
  };
  tick();
}
