"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Site } from "@/lib/types"

function randomToken() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error || "操作失败"
}

export function AdminClient() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [sites, setSites] = useState<Site[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const [siteCode, setSiteCode] = useState("")
  const [token, setToken] = useState("")
  const [url, setUrl] = useState("")
  const [label, setLabel] = useState("")
  const [bulk, setBulk] = useState("")

  const selected = sites.find((site) => site.id === selectedId) ?? null

  async function loadSites(preferId?: string) {
    const response = await fetch("/api/sites", { cache: "no-store" })
    if (response.status === 401) {
      setAuthenticated(false)
      return
    }
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    const body = (await response.json()) as { sites: Site[] }
    setSites(body.sites)
    setAuthenticated(true)
    setSelectedId((current) => {
      if (preferId && body.sites.some((site) => site.id === preferId)) return preferId
      if (body.sites.some((site) => site.id === current)) return current
      return body.sites[0]?.id ?? ""
    })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSites()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function login(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    setBusy(false)
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    setUsername("")
    setPassword("")
    await loadSites()
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" })
    setAuthenticated(false)
    setSites([])
  }

  async function createSite(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setNotice("")
    const nextToken = token.trim() || randomToken()
    if (!token.trim()) setToken(nextToken)
    const response = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, siteCode, token: nextToken }),
    })
    setBusy(false)
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    const body = (await response.json()) as { site: Site }
    setName("")
    setSiteCode("")
    setToken("")
    setNotice(`已创建 ${body.site.name}`)
    await loadSites(body.site.id)
  }

  async function removeSite(site: Site) {
    if (!window.confirm(`删除站点「${site.name}」和它的全部域名？`)) return
    setError("")
    const response = await fetch(`/api/sites/${site.id}`, { method: "DELETE" })
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    await loadSites()
  }

  async function addOne(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError("")
    setNotice("")
    const response = await fetch(`/api/sites/${selected.id}/domains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, label }),
    })
    setBusy(false)
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    setUrl("")
    setLabel("")
    setNotice("已添加域名")
    await loadSites(selected.id)
  }

  async function addBulk(text: string) {
    if (!selected) return
    setBusy(true)
    setError("")
    setNotice("")
    const response = await fetch(`/api/sites/${selected.id}/domains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bulk: text }),
    })
    const body = (await response.json().catch(() => null)) as {
      error?: string
      added?: unknown[]
      skipped?: string[]
    } | null
    setBusy(false)
    if (!response.ok) {
      setError(body?.error || "上传失败")
      return
    }
    setBulk("")
    const added = body?.added?.length ?? 0
    const skipped = body?.skipped?.length ?? 0
    setNotice(skipped ? `添加了 ${added} 条，跳过 ${skipped} 条` : `添加了 ${added} 条`)
    await loadSites(selected.id)
  }

  async function patchDomain(domainId: string, payload: Record<string, unknown>) {
    if (!selected) return
    setError("")
    const response = await fetch(`/api/sites/${selected.id}/domains/${domainId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    await loadSites(selected.id)
  }

  async function removeDomain(domainId: string) {
    if (!selected) return
    setError("")
    const response = await fetch(`/api/sites/${selected.id}/domains/${domainId}`, { method: "DELETE" })
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    await loadSites(selected.id)
  }

  async function copyLink(site: Site, manual: boolean) {
    const query = new URLSearchParams({ siteCode: site.siteCode, token: site.token })
    if (manual) query.set("optional", "1")
    const link = `${window.location.origin}/go?${query.toString()}`
    await navigator.clipboard.writeText(link)
    setNotice(manual ? "已复制选线链接" : "已复制自动跳转链接")
  }

  if (authenticated === null) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <p className="px-8 py-10 text-sm text-muted-foreground">正在确认登录状态…</p>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader aside={<Button variant="outline" nativeButton={false} render={<Link href="/" />}>返回首页</Button>} />
        <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 pb-16">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>登录后台</CardTitle>
              <CardDescription>账号 admin，密码 admin123@。</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={login}>
                <Label htmlFor="username">账号</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <Button className="h-10" type="submit" disabled={busy}>
                  进入
                </Button>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader
        aside={
          <div className="flex gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
              首页
            </Button>
            <Button variant="outline" onClick={() => void logout()}>
              退出
            </Button>
          </div>
        }
      />
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-4 px-4 pb-16 md:grid-cols-[280px_1fr] md:px-8">
        <section className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>站点</CardTitle>
              <CardDescription>一个站点对应一条对外入口。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {sites.length === 0 ? <p className="text-sm text-muted-foreground">还没有站点。</p> : null}
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => setSelectedId(site.id)}
                  className={`rounded-xl border px-3 py-2 text-left ${
                    site.id === selectedId ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <span className="block font-medium">{site.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {site.siteCode} · {site.domains.length} 条域名
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>新建站点</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={createSite}>
                <Input aria-label="站点名称" placeholder="站点名称" value={name} onChange={(event) => setName(event.target.value)} />
                <Input aria-label="站点代号" placeholder="站点代号" value={siteCode} onChange={(event) => setSiteCode(event.target.value)} />
                <div className="flex gap-2">
                  <Input
                    aria-label="令牌"
                    placeholder="令牌（可留空自动生成）"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => setToken(randomToken())}>
                    生成
                  </Button>
                </div>
                <Button className="h-10" type="submit" disabled={busy}>
                  创建
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="grid content-start gap-4">
          {error ? <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p> : null}

          {!selected ? (
            <Card>
              <CardHeader>
                <CardTitle>先创建一个站点</CardTitle>
                <CardDescription>创建后就可以往里面添加、上传和删除域名。</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{selected.name}</CardTitle>
                  <CardDescription>
                    代号 {selected.siteCode}，令牌 {selected.token}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button variant="outline" onClick={() => void copyLink(selected, false)}>
                    复制自动跳转链接
                  </Button>
                  <Button variant="outline" onClick={() => void copyLink(selected, true)}>
                    复制选线链接
                  </Button>
                  <Button variant="destructive" onClick={() => void removeSite(selected)}>
                    删除站点
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>添加域名</CardTitle>
                  <CardDescription>每行一个网址。名称写在竖线后面，例如 https://example.com | 主线路</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <form className="grid gap-2 sm:grid-cols-[1fr_180px_auto]" onSubmit={addOne}>
                    <Input
                      aria-label="域名"
                      placeholder="https://example.com"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                    <Input
                      aria-label="线路名称"
                      placeholder="线路名称"
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                    />
                    <Button className="h-8" type="submit" disabled={busy}>
                      添加
                    </Button>
                  </form>
                  <Textarea
                    aria-label="批量域名"
                    placeholder={"https://a.example | 线路一\nhttps://b.example | 线路二"}
                    value={bulk}
                    onChange={(event) => setBulk(event.target.value)}
                    className="min-h-28"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" disabled={busy || !bulk.trim()} onClick={() => void addBulk(bulk)}>
                      粘贴导入
                    </Button>
                    <Label className="inline-flex h-8 cursor-pointer items-center rounded-lg border px-2.5 text-sm">
                      上传 txt
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        className="sr-only"
                        onChange={async (event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ""
                          if (!file) return
                          if (file.size > 20000) {
                            setError("文件超过 20KB")
                            return
                          }
                          await addBulk(await file.text())
                        }}
                      />
                    </Label>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>域名列表</CardTitle>
                  <CardDescription>
                    {selected.domains.length === 0 ? "还没有域名。" : `共 ${selected.domains.length} 条。停用后访问页不会探测它。`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {selected.domains.map((domain, index) => (
                    <div key={domain.id} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1fr_auto]">
                      <div className="min-w-0">
                        <Input
                          aria-label="线路名称"
                          defaultValue={domain.label}
                          key={`${domain.id}-${domain.label}`}
                          onBlur={(event) => {
                            if (event.target.value !== domain.label) {
                              void patchDomain(domain.id, { label: event.target.value })
                            }
                          }}
                        />
                        <p className="mt-2 truncate text-xs text-muted-foreground">{domain.url}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <Button type="button" variant="outline" disabled={index === 0} onClick={() => void patchDomain(domain.id, { move: "up" })}>
                          上移
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={index === selected.domains.length - 1}
                          onClick={() => void patchDomain(domain.id, { move: "down" })}
                        >
                          下移
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void patchDomain(domain.id, { enabled: !domain.enabled })}
                        >
                          {domain.enabled ? "停用" : "启用"}
                        </Button>
                        <Button type="button" variant="destructive" onClick={() => void removeDomain(domain.id)}>
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
