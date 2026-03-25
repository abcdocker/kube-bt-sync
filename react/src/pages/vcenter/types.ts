export type VCenterVMRow = {
  moref: string;
  name: string;
  powerState: string;
  guestId: string;
  cpu: number;
  memoryMB: number;
  ip: string;
  overallStatus?: string;
  cpuUsageMHz?: number;
  cpuCapacityMHz?: number;
  cpuUsagePercent?: number;
  memoryUsageMB?: number;
  memoryMaxMB?: number;
  memoryUsagePercent?: number;
  uptimeSec?: number;
};

export type VCenterVMsResponse = { vms: VCenterVMRow[] };

/** GET /api/vcenter/vms/perf-snapshot — 与详情页资源监控同源计数器，实时窗口最新点 */
export type VCenterVMPerfRateRow = {
  diskRead: number;
  diskWrite: number;
  netRx: number;
  netTx: number;
  diskReadUnit?: string;
  diskWriteUnit?: string;
  netRxUnit?: string;
  netTxUnit?: string;
};

export type VCenterVMsPerfSnapshotProbe = {
  moref?: string;
  chosen?: string;
  reason?: string;
  historicalOk?: boolean;
  realtimeOk?: boolean;
  historicalSamples?: number;
  realtimeSamples?: number;
  currentSupported?: boolean;
  refreshRateSec?: number;
  summarySupported?: boolean;
  providerSummaryErr?: string;
};

export type VCenterVMsPerfSnapshotResponse = {
  rates: Record<string, VCenterVMPerfRateRow>;
  note?: string;
  probe?: VCenterVMsPerfSnapshotProbe;
};

export type VCenterHostRow = {
  moref: string;
  name: string;
  connectionState?: string;
  overallStatus?: string;
  cpuCores?: number;
  cpuMhzPerCore?: number;
  cpuUsageMHz?: number;
  cpuCapacityMHz?: number;
  cpuUsagePercent?: number;
  memoryTotalMB?: number;
  memoryUsageMB?: number;
  memoryUsagePercent?: number;
  uptimeSec?: number;
  esxiVersion?: string;
  vendor?: string;
  model?: string;
};

export type VCenterHostsResponse = { hosts: VCenterHostRow[] };

/** GET /api/vcenter/hosts/:moref 详情中的 hardware 字段（物理机 SMBIOS / CPU 插槽 / BIOS） */
export type VCenterHostHardwareDetail = {
  vendor?: string;
  model?: string;
  uuid?: string;
  serialNumber?: string;
  otherIdentifyingInfo?: { identifierType?: string; identifierValue?: string }[];
  cpuPackagesCount?: number;
  cpuCoresPhysical?: number;
  cpuThreads?: number;
  cpuHzPerCore?: number;
  cpuPackages?: {
    index: number;
    vendor?: string;
    description?: string;
    hz?: number;
    busHz?: number;
  }[];
  memorySizeBytes?: number;
  bios?: { biosVersion?: string; vendor?: string; releaseDate?: string };
  cpuModelSummary?: string;
};

export type VCenterHostDetailRow = VCenterHostRow & {
  hardwareDetail?: VCenterHostHardwareDetail | null;
};

export type VCenterHostDetailResponse = { host: VCenterHostDetailRow };

export type PerfPoint = { t: string; v: number };

/** GET /api/vcenter/vms/:moref/metrics?days=1..7 — vCenter 历史性能序列 */
export type VCenterVMPerfResponse = {
  moref: string;
  days: number;
  rangeFrom: string;
  rangeTo: string;
  intervalSec: number;
  note?: string;
  missing?: string[];
  series: {
    cpu?: PerfPoint[] | null;
    memory?: PerfPoint[] | null;
    diskRead?: PerfPoint[] | null;
    diskWrite?: PerfPoint[] | null;
    netRx?: PerfPoint[] | null;
    netTx?: PerfPoint[] | null;
  };
  units?: Partial<{
    cpu: string;
    memory: string;
    diskRead: string;
    diskWrite: string;
    netRx: string;
    netTx: string;
  }>;
  /** 宿主机磁盘/网络使用近 1 小时实时统计回退时返回 */
  diskNetRealtime?: {
    rangeFrom: string;
    rangeTo: string;
    intervalSec: number;
  };
};

export type VCenterVMGuestSummary = {
  ip?: string;
  hostname?: string;
  guestFullName?: string;
  toolsRunningStatus?: string;
  toolsVersionStatus?: string;
};

export type VCenterVMStorageSummary = {
  committedBytes?: number;
  uncommittedBytes?: number;
  unsharedBytes?: number;
};

export type VCenterVMNetRow = {
  network?: string;
  mac?: string;
  ips?: string[] | string;
};

/** POST /api/vcenter/vms/:moref/power — 异步返回 taskId，客户端轮询 GET /api/vcenter/tasks/:taskId */
export type VCenterPowerPostResponse = {
  ok?: boolean;
  action?: string;
  taskId?: string;
};

/** GET /api/vcenter/tasks/:taskId */
export type VCenterTaskStatusResponse = {
  state: string;
  progress?: number;
  description?: string;
  error?: string;
};

export type VCenterVMDiskRow = {
  key: number;
  label?: string;
  capacityKB: number;
  unitNumber?: number;
  controllerKey?: number;
  fileName?: string;
};

/** GET /api/vcenter/vms/:moref 常用字段 */
export type VCenterVMDetailResponse = {
  name?: string;
  powerState?: string;
  cpu?: number;
  memoryMB?: number;
  uuid?: string;
  template?: boolean;
  cpuHotAddEnabled?: boolean;
  memoryHotAddEnabled?: boolean;
  disks?: VCenterVMDiskRow[];
  guest?: VCenterVMGuestSummary;
  storage?: VCenterVMStorageSummary;
  networkInterfaces?: VCenterVMNetRow[];
};

export type VCenterWebmksResponse = {
  host: string;
  port: number;
  sslThumbprint?: string;
  ticket: string;
  cfgFile?: string;
  wssUrl: string;
  proxyPath: string;
  hint?: string;
};

/** 官方 webconsole.html 链接（govc vm.console -h5 同源） */
export type VCenterConsoleHtmlResponse = {
  url: string;
  /** 与浏览器地址栏一致；需已登录 vCenter SSO */
  vsphereClientUrl?: string;
  hint?: string;
};
