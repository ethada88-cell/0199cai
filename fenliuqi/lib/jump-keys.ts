/** Shared AES key material for dc/*.txt (same role as Vue app module 2510). */
export const DEFAULT_JUMP_AES_KEY = "01sg4CXbluB1it3b"
export const DEFAULT_JUMP_AES_IV = "Tssmyuzo24eraO5f"

export function publicJumpKey() {
  return process.env.NEXT_PUBLIC_JUMP_AES_KEY || DEFAULT_JUMP_AES_KEY
}

export function publicJumpIv() {
  return process.env.NEXT_PUBLIC_JUMP_AES_IV || DEFAULT_JUMP_AES_IV
}
