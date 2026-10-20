"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { decryptDcHex } from "@/lib/client-aes"
import {
  lastResortEntryUrl,
  mintSafetyCandidates,
  splitFixedAndWild,
  wildcardRootsForFallback,
} from "@/lib/jump-guarantee"
import { DEFAULT_JUMP_AES_IV, DEFAULT_JUMP_AES_KEY } from "@/lib/jump-keys"
import { expandLiveUrl, isWildcardUrl } from "@/lib/wildcard"

type DcJson = {
  siteCode: string
  alias?: string
  token: string
  domains: string
}

type Line = {
  id: string
  domain: string
  domainHost: string
  jumpLink: string
  index: number
  state: 0 | 1 | 2 | 3 | 4
  ping: number
}

type Phase = "need" | "loading-config" | "probing" | "fail-config" | "fail-nodes" | "pick"

const PRESERVE = new Set(["optional", "routerecord", "token", "siteCode", "isCheck"])

function hostOf(domain: string) {
  try {
    const url = new URL(domain.includes("://") ? domain : `https://${domain}`)
    return `${url.protocol}//${url.host}`
  } catch {
    return domain
  }
}

function withExtraQuery(domain: string, pairs: { key: string; value: string }[]) {
  try {
    const url = new URL(domain.includes("://") ? domain : `https://${domain}`)
    for (const pair of pairs) url.searchParams.set(pair.key, pair.value)
    return url.toString()
  } catch {
    return domain
  }
}

async function heartbeat(line: Line) {
  const response = await fetch(`${line.domainHost}/melody/api/v1/base/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  })
  const body = (await response.json().catch(() => null)) as { code?: string } | null
  const code = body?.code
  if (code === "12200" || code === "10008") {
    return { line, code }
  }
  throw line
}

function promiseAny<T>(items: Promise<T>[]) {
  return new Promise<T>((resolve, reject) => {
    let failed = 0
    if (!items.length) {
      reject(new Error("empty"))
      return
    }
    items.forEach((item) => {
      item.then(resolve).catch(() => {
        failed += 1
        if (failed === items.length) reject(new Error("all failed"))
      })
    })
  })
}

async function serverRace(urls: string[]) {
  const response = await fetch("/api/heartbeat-race", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ urls, guarantee: true }),
  })
  const body = (await response.json().catch(() => null)) as { url?: string; error?: string } | null
  if (!response.ok || !body?.url) {
    throw new Error(body?.error || "server race failed")
  }
  return body.url
}

function toLines(
  domains: string[],
  siteCode: string,
  token: string,
  otherQuery: { key: string; value: string }[],
  isCheck: boolean
): Line[] {
  return domains.map((domain, index) => {
    const live = isWildcardUrl(domain) ? expandLiveUrl(domain) : domain
    return {
      id: `${siteCode}-${token}-${index}-${live}`,
      domain: live,
      domainHost: hostOf(live),
      jumpLink: withExtraQuery(live, otherQuery),
      index,
      state: isCheck ? 1 : 0,
      ping: -1,
    }
  })
}

export function JumpSpa() {
  const params = useSearchParams()
  const siteCode = params.get("siteCode")?.trim() ?? ""
  const token = params.get("token")?.trim() ?? ""
  const optional = Number(params.get("optional") || "0") === 1
  const isCheck = params.get("isCheck") !== "0"
  const ready = Boolean(siteCode && token)

  const otherQueryKey = useMemo(() => {
    const pairs: string[] = []
    params.forEach((value, key) => {
      if (!PRESERVE.has(key)) pairs.push(`${key}=${value}`)
    })
    pairs.sort()
    return pairs.join("&")
  }, [params])

  const otherQuery = useMemo(() => {
    if (!otherQueryKey) return [] as { key: string; value: string }[]
    return otherQueryKey.split("&").map((part) => {
      const i = part.indexOf("=")
      return { key: part.slice(0, i), value: part.slice(i + 1) }
    })
  }, [otherQueryKey])

  const [phase, setPhase] = useState<Phase>(ready ? "loading-config" : "need")
  const [lines, setLines] = useState<Line[]>([])
  const [errorDetail, setErrorDetail] = useState("")
  const [draftCode, setDraftCode] = useState(siteCode)
  const [draftToken, setDraftToken] = useState(token)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const key = process.env.NEXT_PUBLIC_JUMP_AES_KEY || DEFAULT_JUMP_AES_KEY
    const iv = process.env.NEXT_PUBLIC_JUMP_AES_IV || DEFAULT_JUMP_AES_IV

    void (async () => {
      setPhase("loading-config")
      setErrorDetail("")
      let domains: string[] = []
      try {
        const uuid = crypto.randomUUID()
        const response = await fetch(`/dc/${encodeURIComponent(siteCode)}-${encodeURIComponent(token)}.txt?uuid=${uuid}`, {
          cache: "no-store",
        })
        if (!response.ok) {
          throw Object.assign(new Error("config missing"), { kind: "config" as const })
        }
        const hex = (await response.text()).trim()
        if (cancelled) return
        let plain: string
        try {
          plain = await decryptDcHex(hex, key, iv)
        } catch {
          throw Object.assign(new Error("decrypt failed"), { kind: "config" as const })
        }
        const json = JSON.parse(plain) as DcJson
        domains = String(json.domains || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
        if (!domains.length) {
          throw Object.assign(new Error("empty domains"), { kind: "config" as const })
        }
      } catch (err) {
        if (!cancelled) {
          setErrorDetail(err instanceof Error ? err.message : "")
          setPhase("fail-config")
        }
        return
      }

      const { fixed, wild } = splitFixedAndWild(domains)
      const roots = wildcardRootsForFallback(wild)

      if (optional) {
        // 选线页：固定线路 + 当场生成的通配子域都展示
        const nextLines = toLines([...fixed, ...mintSafetyCandidates(roots, 1)], siteCode, token, otherQuery, isCheck)
        if (cancelled) return
        setLines(nextLines)
        setPhase("pick")
        if (!isCheck) return
        nextLines.forEach((line) => {
          const started = Date.now()
          void heartbeat(line)
            .then((result) => {
              if (cancelled) return
              setLines((prev) =>
                prev.map((item) =>
                  item.id === line.id
                    ? {
                        ...item,
                        state: result.code === "10008" ? 4 : 2,
                        ping: Date.now() - started,
                      }
                    : item
                )
              )
            })
            .catch(() => {
              if (cancelled) return
              setLines((prev) =>
                prev.map((item) => (item.id === line.id ? { ...item, state: 3, ping: -1 } : item))
              )
            })
        })
        return
      }

      setPhase("probing")
      // 1) 先只探测客户固定域名
      if (fixed.length) {
        const fixedLines = toLines(fixed, siteCode, token, otherQuery, isCheck)
        if (!cancelled) setLines(fixedLines)
        try {
          const winner = await promiseAny(fixedLines.map((line) => heartbeat(line)))
          if (cancelled) return
          if (winner.code !== "10008") {
            window.location.replace(winner.line.jumpLink)
            return
          }
        } catch {
          // 固定域名全挂 → 继续走通配兜底
        }
      }

      // 2) 浏览器侧再铸一批 0199x/y/z 随机子域竞速
      try {
        const safetyLines = toLines(mintSafetyCandidates(roots, 2), siteCode, token, otherQuery, isCheck)
        if (!cancelled) setLines(safetyLines)
        const winner = await promiseAny(safetyLines.map((line) => heartbeat(line)))
        if (cancelled) return
        if (winner.code !== "10008") {
          window.location.replace(winner.line.jumpLink)
          return
        }
      } catch {
        // 浏览器通配也失败 → 服务端保证进站
      }

      // 3) 服务端：固定失败后自动生成三个通配根域的新子域，失败仍给最后兜底入口
      try {
        const url = await serverRace(domains)
        if (!cancelled) window.location.replace(withExtraQuery(url, otherQuery))
      } catch {
        if (!cancelled) {
          window.location.replace(withExtraQuery(lastResortEntryUrl(), otherQuery))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, siteCode, token, optional, isCheck, otherQuery])

  if (!ready || phase === "need") {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">打开入口</h1>
        <input
          className="h-10 w-full rounded-lg border px-3"
          placeholder="站点代号"
          value={draftCode}
          onChange={(event) => setDraftCode(event.target.value)}
        />
        <input
          className="h-10 w-full rounded-lg border px-3"
          placeholder="令牌"
          value={draftToken}
          onChange={(event) => setDraftToken(event.target.value)}
        />
        <button
          type="button"
          className="h-10 w-full rounded-lg bg-emerald-500 text-white"
          onClick={() => {
            const query = new URLSearchParams({
              siteCode: draftCode.trim(),
              token: draftToken.trim(),
            })
            window.location.href = `/jump?${query.toString()}`
          }}
        >
          继续
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 pb-16 pt-10 text-center">
      {phase === "loading-config" ? (
        <p className="text-lg text-zinc-600">获取域名配置中 请等待...</p>
      ) : null}
      {phase === "probing" ? (
        <p className="text-lg text-zinc-600">获取域名节点中 请等待...</p>
      ) : null}
      {phase === "fail-config" ? (
        <>
          <p className="text-lg text-zinc-600">未找到域名配置 请重试或联系管理员</p>
          {errorDetail ? <p className="mt-2 text-xs text-zinc-400">{errorDetail}</p> : null}
          <button
            type="button"
            className="mt-8 h-12 min-w-[180px] rounded bg-emerald-500 px-6 text-lg text-white"
            onClick={() => window.location.reload()}
          >
            重新检测
          </button>
        </>
      ) : null}
      {phase === "fail-nodes" ? (
        <>
          <p className="text-lg text-zinc-600">未找到可用的域名节点 请重试或联系管理员</p>
          {errorDetail ? <p className="mt-2 text-xs text-zinc-400">{errorDetail}</p> : null}
          <button
            type="button"
            className="mt-8 h-12 min-w-[180px] rounded bg-emerald-500 px-6 text-lg text-white"
            onClick={() => window.location.reload()}
          >
            重新检测
          </button>
        </>
      ) : null}

      {phase === "pick" ? (
        <>
          <p className="mt-6 text-sm text-zinc-500">温馨提示：延迟数值越低的节点，访问网站速度越快。</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {lines.map((line) => {
              const ok = line.state === 2 || !isCheck
              const warn = line.state === 2 && line.ping >= 2000
              const err = line.state === 3 || line.state === 4
              return (
                <button
                  key={line.id}
                  type="button"
                  disabled={!ok}
                  onClick={() => {
                    if (ok) window.location.replace(line.jumpLink)
                  }}
                  className={`flex min-w-[140px] items-center justify-between gap-2 rounded-l border rounded-r-2xl px-3 py-2 text-left text-xs font-bold ${
                    err
                      ? "cursor-not-allowed border-red-500 text-zinc-500"
                      : warn
                        ? "border-amber-400"
                        : ok
                          ? "border-emerald-500"
                          : "border-zinc-200"
                  }`}
                >
                  <span>线路{line.index + 1}</span>
                  <span className="text-zinc-500">
                    {line.state === 1
                      ? "检测中."
                      : line.state === 2
                        ? `${line.ping}ms`
                        : line.state === 3
                          ? "超时"
                          : line.state === 4
                            ? "受限"
                            : ""}
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      err ? "bg-red-500" : warn ? "bg-amber-400" : ok ? "bg-emerald-500" : "bg-black"
                    }`}
                  />
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="mt-10 h-12 min-w-[180px] rounded bg-emerald-500 px-6 text-lg text-white"
            onClick={() => window.location.reload()}
          >
            重新检测
          </button>
        </>
      ) : null}
    </main>
  )
}
