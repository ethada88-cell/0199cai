import { readDcFile } from "@/lib/dc-publish"

type Ctx = { params: Promise<{ name: string }> }

export async function GET(_request: Request, ctx: Ctx) {
  const { name } = await ctx.params
  const fileName = name.endsWith(".txt") ? name : `${name}.txt`
  const body = await readDcFile(fileName)
  if (!body) {
    return new Response("not found", { status: 404 })
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
