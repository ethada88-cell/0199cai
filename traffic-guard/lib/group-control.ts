/**
 * 群控 / 仿真人特征：有外部广告来路时，命中则必须弹窗验证，
 * 不能被「正常浏览 → 真实」短路。空来路仍由 check 侧强制真实。
 *
 * 只保留硬环境 + 确认差出口/设备（bad_ip / bad_device）+ 换机/重复点法。
 * bad_source / watch_* 不进群控；仅来路信誉差由 check 侧直接记真实。
 */

/** 环境/群控马甲（多为硬假，列入以防漏网）。 */
const ENV_CONTROL = new Set([
  "cloud_phone",
  "emulator",
  "virtual_gpu",
  "automation",
  "webdriver",
  "headless",
  "disguised_automation",
  "stealth_browser",
  "click_farm",
  "rotated_host",
  "flat_sensors",
  "device_mismatch",
]);

/** 换机 / 重复点法。共用出口（NAT）不进群控强制弹窗。 */
const FARM_MEMORY = new Set([
  "residential_proxy",
  "repeat_device",
  "repeat_pattern",
]);

/** 学习账本确认的差设备 / 差出口（不含来路信誉差）。 */
const LEARN_BAD = new Set(["bad_device", "bad_ip"]);

export function isGroupControlSuspect(categories: string[] | null | undefined): boolean {
  if (!categories?.length) return false;
  const set = new Set(categories);
  for (const code of set) {
    if (ENV_CONTROL.has(code) || FARM_MEMORY.has(code) || LEARN_BAD.has(code)) {
      return true;
    }
  }
  return false;
}
