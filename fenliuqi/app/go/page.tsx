import type { Metadata } from "next"
import { Suspense } from "react"
import { JumpClient } from "@/components/jump-client"

export const metadata: Metadata = {
  title: "请稍候",
  description: "正在确认可用线路。",
  robots: { index: false, follow: false },
}

export default function GoPage() {
  return (
    <Suspense fallback={<p className="px-8 py-10 text-sm text-muted-foreground">正在打开入口…</p>}>
      <JumpClient />
    </Suspense>
  )
}
