/**
 * 新检测项开关。改成 false 即可回滚该项，不影响原有判定。
 * 客户端对应开关在 public/guard-run.js 顶部 FLAGS。
 */
export const DETECT = {
  nativeHook: true,
  fontBlank: true,
  scriptedPointer: true,
  pow: true,
  /** 来路域名信誉：确认假量/滑过会写进账号账本，下次同来路自动抬分或克制。 */
  sourceRep: true,
  /** 出口 IP / 设备指纹信誉：同样用确认假量与滑过自我学习。 */
  actorRep: true,
};
