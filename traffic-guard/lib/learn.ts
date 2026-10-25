import { DETECT } from "@/lib/detect-flags";
import { lookupActorRep, noteActorFake, noteActorHuman } from "@/lib/actor-rep";
import { lookupSourceRep, noteSourceFake, noteSourceHuman } from "@/lib/source-rep";

/**
 * 自我学习总入口：把确认假量 / 滑过反馈写进来路、出口、设备账本。
 * 假量占比高抬分；滑过会冲淡历史假量并在占比低时负分降权；账本按约 7 天半衰期衰减。
 */

export type LearnHint = {
  code: string;
  label: string;
  detail: string;
  weight: number;
};

export function noteLearnFake(input: { accountId: string; host?: string; ip?: string; fp?: string }) {
  if (DETECT.sourceRep && input.host) noteSourceFake(input.accountId, input.host);
  if (DETECT.actorRep) noteActorFake(input.accountId, input.ip || "", input.fp || "");
}

export function noteLearnHuman(input: { accountId: string; host?: string; ip?: string; fp?: string }) {
  if (DETECT.sourceRep && input.host) noteSourceHuman(input.accountId, input.host);
  if (DETECT.actorRep) noteActorHuman(input.accountId, input.ip || "", input.fp || "");
}

/** 收集当前访问可套用的学习提示（来路 + 出口 + 设备）。 */
export function collectLearnHints(input: {
  accountId: string;
  host?: string;
  ip?: string;
  fp?: string;
  /** 无外部广告来路时不用来路信誉，但仍可用出口/设备学习（仅当调用方允许）。 */
  externalSource?: boolean;
}): LearnHint[] {
  const out: LearnHint[] = [];
  if (DETECT.sourceRep && input.externalSource && input.host) {
    const source = lookupSourceRep(input.accountId, input.host);
    if (source) out.push(source);
  }
  if (DETECT.actorRep) {
    for (const hit of lookupActorRep(input.accountId, input.ip || "", input.fp || "")) out.push(hit);
  }
  return out;
}
