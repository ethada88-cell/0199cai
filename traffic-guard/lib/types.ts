export type Verdict = "real" | "suspicious" | "fake";

export type Reason = {
  code: string;
  label: string;
  detail: string;
  weight: number;
};

export type ClientSignals = {
  ua?: string;
  language?: string;
  languages?: string[];
  platform?: string;
  vendor?: string;
  webdriver?: boolean;
  automation?: string[];
  webglVendor?: string;
  webglRenderer?: string;
  screen?: { w?: number; h?: number; dpr?: number };
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  timezone?: string;
  outerWidth?: number;
  outerHeight?: number;
  plugins?: number;
  brands?: string[];
  chrome?: boolean;
  architecture?: string;
  model?: string;
  uaPlatform?: string;
  visitor?: string;
  canvas?: string;
  motion?: { samples?: number; accelMag?: number; accelVar?: number };
  engagement?: { pointerMoves?: number; scroll?: number; elapsed?: number; leaving?: boolean };
  stealthCdc?: boolean;
  stealthAttr?: boolean;
  stealthBrand?: boolean;
  /** 1 = 新采集脚本。旧脚本不带此字段，新增检测不对其计分。 */
  probe?: number;
  nativeHook?: boolean;
  /** 测到被改写的原生函数名，最多 4 个。 */
  hooked?: string[];
  audio?: string;
  fonts?: string;
  fontCount?: number;
  colorDepth?: number;
  pow?: { n?: number; h?: string };
  behavior?: {
    moves?: number;
    keys?: number;
    clicks?: number;
    straight?: boolean;
    speedCv?: number;
    clickCv?: number;
    human?: number;
  };
};

export type TrafficSource = {
  page: string;
  referrer: string;
  host: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

export type CheckResult = {
  ok: true;
  id: string;
  at: number;
  accountId: string;
  siteKey: string;
  ip: string;
  verdict: Verdict;
  action: "allow" | "flag";
  challenge?: boolean;
  farm: boolean;
  virtual: boolean;
  tracked: boolean;
  score: number;
  categories: string[];
  reasons: Reason[];
  ua: string;
  source: TrafficSource;
};

export type StoredEvent = CheckResult & {
  lab?: boolean;
  fp?: string;
  popupShown?: boolean;
  popupClosed?: boolean;
  dwellMs?: number;
  pending?: boolean;
};
