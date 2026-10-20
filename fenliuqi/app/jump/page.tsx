import type { Metadata } from "next"
import { Suspense } from "react"
import { JumpSpa } from "@/components/jump-spa"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "获取域名节点中",
  description: "获取域名节点中",
  robots: { index: false, follow: false },
}

export default function JumpPage() {
  return (
    <Suspense fallback={<p className="px-8 py-10 text-center text-lg text-zinc-600">获取域名节点中 请等待...</p>}>
      <JumpSpa />
    </Suspense>
  )
}
