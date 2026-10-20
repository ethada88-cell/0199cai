import type { Metadata } from "next"
import { Suspense } from "react"
import { JumpClient } from "@/components/jump-client"

export const metadata: Metadata = {
  title: "正在为您选择最优线路",
  description: "正在为您选择最优线路",
  robots: { index: false, follow: false },
}

export default function GoPage() {
  return (
    <Suspense fallback={<p className="px-8 py-10 text-sm text-muted-foreground">正在打开入口…</p>}>
      <JumpClient />
    </Suspense>
  )
}
