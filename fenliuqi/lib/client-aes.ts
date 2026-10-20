/** Browser AES-128-CBC decrypt matching CryptoJS uppercase-hex ciphertext. */

function hexToBytes(hex: string) {
  const clean = hex.trim()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export async function decryptDcHex(hex: string, key: string, iv: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  )
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: new TextEncoder().encode(iv) },
    cryptoKey,
    hexToBytes(hex)
  )
  return new TextDecoder().decode(plain)
}
