import { fastestLine } from "@/lib/probe"
import { resolveJumpTarget, runJumpProbe } from "@/lib/jump-resolve"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const d = url.searchParams.get("d")?.trim() ?? ""
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? ""
  const token = url.searchParams.get("token")?.trim() ?? ""
  const check = url.searchParams.get("isCheck") !== "0"
  const full = url.searchParams.get("full") === "1"

  const resolved = await resolveJumpTarget({ d, siteCode, token })
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: resolved.status })
  }

  const mode = !check ? "skip" : full ? "full" : "quick"
  const { lines, targetUrl } = await runJumpProbe(resolved.target.domains, mode)
  const fastest = fastestLine(lines)
  const fallbackId =
    !fastest && targetUrl
      ? resolved.target.domains.find((domain) => domain.url === targetUrl && domain.enabled)?.id ??
        null
      : null

  return Response.json({
    site: resolved.target.site,
    lines,
    fastestId: fastest?.id ?? fallbackId,
    encrypted: resolved.target.source === "encrypted",
  })
}
