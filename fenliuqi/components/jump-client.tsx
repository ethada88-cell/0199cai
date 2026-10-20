"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ProbeLine } from "@/lib/types"

type JumpResult = {
  site: { name: string; siteCode: string }
  lines: ProbeLine[]
  fastestId: string | null
}

export function JumpClient() {
  const params = useSearchParams()
  const router = useRouter()
  const d = params.get("d")?.trim() ?? ""
  const siteCode = params.get("siteCode")?.trim() ?? ""
  const token = params.get("token")?.trim() ?? ""
  const optional = params.get("optional") === "1"
  const isCheck = params.get("isCheck") !== "0"
  const ready = Boolean(d || (siteCode && token))

  const [draftCode, setDraftCode] = useState(siteCode)
  const [draftToken, setDraftToken] = useState(token)
  const [result, setResult] = useState<JumpResult | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(ready)

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        setError("")
        try {
          const query = new URLSearchParams()
          if (d) query.set("d", d)
          else {
            query.set("siteCode", siteCode)
            query.set("token", token)
          }
          if (!isCheck) query.set("isCheck", "0")
          if (optional) query.set("full", "1")
          const response = await fetch(`/api/jump?${query.toString()}`, {
            signal: controller.signal,
            cache: "no-store",
          })
          const body = (await response.json()) as JumpResult & { error?: string }
          if (!response.ok) {
            setResult(null)
            setError(body.error || "入口暂时不可用")
            return
          }
          setResult(body)
          if (!optional) {
            const best = body.lines.find((line) => line.id === body.fastestId)
            if (best?.status === "ok" || best?.status === "skipped") {
              window.location.replace(best.url)
              return
            }
            const firstOk = body.lines.find((line) => line.status === "ok")
            if (firstOk) {
              window.location.replace(firstOk.url)
              return
            }
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return
          setError("探测请求失败")
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      })()
    }, 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [ready, d, siteCode, token, isCheck, optional])

  const fastest = result?.lines.find((line) => line.id === result.fastestId) ?? null

  function openDraft(manual: boolean) {
    const query = new URLSearchParams({
      siteCode: draftCode.trim(),
      token: draftToken.trim(),
    })
    if (manual) query.set("optional", "1")
    router.push(`/go?${query.toString()}`)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pb-16 pt-8 md:pt-16">
        {!ready ? (
          <form
            className="grid w-full gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              openDraft(false)
            }}
          >
            <h1 className="text-2xl font-semibold tracking-tight">打开入口</h1>
            <Input
              aria-label="站点代号"
              placeholder="站点代号"
              value={draftCode}
              onChange={(event) => setDraftCode(event.target.value)}
            />
            <Input
              aria-label="令牌"
              placeholder="令牌"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
            />
            <Button className="h-10" type="submit">
              继续
            </Button>
          </form>
        ) : (
          <div className="flex w-full flex-col items-center gap-6 text-center">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {loading || (fastest && !optional)
                  ? "获取域名节点中"
                  : error
                    ? "暂时进不去"
                    : optional
                      ? "选择线路"
                      : "线路不可用"}
              </h1>
              {loading || (fastest && !optional) ? null : (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {error
                    ? error
                    : optional
                      ? "选择一条线路进入。延迟越低，打开通常越快。"
                      : "没有可用线路，请稍后重试。"}
                </p>
              )}
            </div>

            {result && optional ? (
              <div className="grid w-full gap-3 text-left">
                {result.lines.map((line, index) => {
                  const clickable = line.status === "ok" || line.status === "skipped"
                  return (
                    <button
                      key={line.id}
                      type="button"
                      disabled={!clickable}
                      onClick={() => {
                        window.location.href = line.url
                      }}
                      className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition ${
                        line.status === "ok"
                          ? line.ms !== null && line.ms >= 2000
                            ? "border-amber-400 bg-amber-50"
                            : "border-emerald-500 bg-emerald-50"
                          : line.status === "skipped"
                            ? "border-border bg-card"
                            : "cursor-not-allowed border-red-200 bg-red-50 text-muted-foreground"
                      }`}
                    >
                      <span>
                        <span className="block font-medium">
                          {line.label || `线路 ${index + 1}`}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{hostOf(line.url)}</span>
                      </span>
                      <span className="text-sm font-medium">{line.detail}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  )
}

function hostOf(value: string) {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}
