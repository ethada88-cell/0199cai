import { StoreError } from "./sites"

export function jsonError(error: unknown) {
  if (error instanceof StoreError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error(error)
  return Response.json({ error: "服务器处理失败" }, { status: 500 })
}
