import { Suspense } from "react"
import { JumpClient } from "@/components/jump-client"

export default function GoPage() {
  return (
    <Suspense fallback={<p className="px-8 py-10 text-sm text-muted-foreground">正在打开入口…</p>}>
      <JumpClient />
    </Suspense>
  )
}
