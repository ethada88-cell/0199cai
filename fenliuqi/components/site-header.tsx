import type { ReactNode } from "react"
import Link from "next/link"

export function SiteHeader({
  aside,
}: {
  aside?: ReactNode
}) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-4 md:px-8">
      <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">
          线
        </span>
        线路台
      </Link>
      {aside}
    </header>
  )
}
