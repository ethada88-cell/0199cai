"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function HomePage() {
  const router = useRouter()
  const [siteCode, setSiteCode] = useState("demo")
  const [token, setToken] = useState("demo-token")

  function open(optional: boolean) {
    const params = new URLSearchParams({ siteCode: siteCode.trim(), token: token.trim() })
    if (optional) params.set("optional", "1")
    router.push(`/go?${params.toString()}`)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader
        aside={
          <div className="flex gap-2">
            <Button variant="outline" nativeButton={false} render={<a href="/linegate-source.zip" download="linegate-source.zip" />}>
              下载源码
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/admin" />}>
              管理域名
            </Button>
          </div>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pb-16 md:px-8">
        <section className="max-w-2xl pt-6 md:pt-14">
          <p className="text-sm font-medium text-primary">多域名入口</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            后台维护线路，访问时跳到当前可用的域名。
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            每个站点有自己的代号和令牌。后台可以单条添加、粘贴名单，或上传 txt。访问页会逐个探测，然后进入延迟最低的那条。源码打包在
            linegate-source.zip，下载后解压，上传到你的服务器即可安装。
          </p>
          <div className="mt-5">
            <Button className="h-10 px-4" nativeButton={false} render={<a href="/linegate-source.zip" download="linegate-source.zip" />}>
              下载 linegate-source.zip
            </Button>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-[1.3fr_0.7fr]">
          <Card>
            <CardHeader>
              <CardTitle>打开一个入口</CardTitle>
              <CardDescription>演示站点已经放了三条线路，其中一条会探测失败。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="siteCode">站点代号</Label>
                  <Input id="siteCode" value={siteCode} onChange={(event) => setSiteCode(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="token">令牌</Label>
                  <Input id="token" value={token} onChange={(event) => setToken(event.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="h-10 px-4" onClick={() => open(false)}>
                  自动进入
                </Button>
                <Button className="h-10 px-4" variant="outline" onClick={() => open(true)}>
                  查看全部线路
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>后台</CardTitle>
              <CardDescription>本地默认口令是 linegate-admin。部署前请用环境变量 ADMIN_PASSWORD 换掉。</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="h-10 px-4" nativeButton={false} render={<Link href="/admin" />}>
                上传和管理域名
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
