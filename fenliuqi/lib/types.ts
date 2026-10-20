export type Domain = {
  id: string
  url: string
  label: string
  enabled: boolean
  createdAt: string
}

export type Site = {
  id: string
  name: string
  siteCode: string
  token: string
  createdAt: string
  domains: Domain[]
}

export type Store = {
  sites: Site[]
}

export type ProbeStatus = "ok" | "down" | "skipped"

export type ProbeLine = {
  id: string
  label: string
  url: string
  status: ProbeStatus
  ms: number | null
  detail: string
}
