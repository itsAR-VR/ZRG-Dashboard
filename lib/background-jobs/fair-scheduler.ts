const MIN_WORKSPACE_QUOTA = 1;
const MAX_WORKSPACE_QUOTA = 100;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function clampWorkspaceQuota(value: number): number {
  return Math.max(MIN_WORKSPACE_QUOTA, Math.min(MAX_WORKSPACE_QUOTA, Math.floor(value)));
}

function parseLegacyHighQuotaClientIds(value: string | undefined): Set<string> {
  if (!value) return new Set<string>();
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

export type BackgroundWorkspaceQuotaConfig = {
  defaultQuota: number;
  highQuota: number;
  // Deprecated fallback during phase-172 cutover window.
  legacyHighQuotaClientIds: Set<string>;
};

export function getBackgroundWorkspaceQuotaConfig(
  env: NodeJS.ProcessEnv = process.env
): BackgroundWorkspaceQuotaConfig {
  const defaultQuota = clampWorkspaceQuota(parsePositiveInt(env.BACKGROUND_JOB_WORKSPACE_QUOTA_DEFAULT, 64));
  const highQuotaCandidate = clampWorkspaceQuota(
    parsePositiveInt(env.BACKGROUND_JOB_WORKSPACE_QUOTA_ENTERPRISE, 100)
  );

  return {
    defaultQuota,
    highQuota: Math.max(defaultQuota, highQuotaCandidate),
    legacyHighQuotaClientIds: parseLegacyHighQuotaClientIds(env.BACKGROUND_JOB_ENTERPRISE_CLIENT_IDS),
  };
}

export function isBackgroundWorkspaceHighQuotaEligible(
  clientId: string,
  dbHighQuotaEnabled: boolean,
  config: BackgroundWorkspaceQuotaConfig
): boolean {
  return dbHighQuotaEnabled || config.legacyHighQuotaClientIds.has(clientId);
}

export function resolveBackgroundWorkspaceQuota(
  quotaPromotionGranted: boolean,
  config: BackgroundWorkspaceQuotaConfig
): number {
  return quotaPromotionGranted ? config.highQuota : config.defaultQuota;
}

type ClientScopedJob = {
  clientId: string;
};

export function selectPartitionedWorkspaceJobs<TJob extends ClientScopedJob>(
  jobs: TJob[],
  maxJobs: number,
  perWorkspaceCap: number
): TJob[] {
  const targetCount = Math.max(1, Math.floor(maxJobs));
  const workspaceCap = Math.max(1, Math.floor(perWorkspaceCap));
  const selected: TJob[] = [];
  const selectedByClient = new Map<string, number>();

  for (const job of jobs) {
    if (selected.length >= targetCount) break;
    const currentCount = selectedByClient.get(job.clientId) ?? 0;
    if (currentCount >= workspaceCap) continue;
    selected.push(job);
    selectedByClient.set(job.clientId, currentCount + 1);
  }

  return selected;
}

export function buildFairWorkspaceQueue<TJob extends ClientScopedJob>(jobs: TJob[]): TJob[] {
  if (jobs.length <= 1) return jobs.slice();

  const queueByClient = new Map<string, TJob[]>();
  const clientOrder: string[] = [];

  for (const job of jobs) {
    const existing = queueByClient.get(job.clientId);
    if (!existing) {
      queueByClient.set(job.clientId, [job]);
      clientOrder.push(job.clientId);
      continue;
    }
    existing.push(job);
  }

  const fairQueue: TJob[] = [];
  while (fairQueue.length < jobs.length) {
    let advanced = false;

    for (const clientId of clientOrder) {
      const queue = queueByClient.get(clientId);
      if (!queue || queue.length === 0) continue;
      const next = queue.shift();
      if (next) {
        fairQueue.push(next);
        advanced = true;
      }
    }

    if (!advanced) break;
  }

  return fairQueue;
}

export function claimNextQuotaEligibleJob<TJob extends ClientScopedJob>(
  queue: TJob[],
  activeByClient: Map<string, number>,
  getWorkspaceQuota: (clientId: string) => number
): TJob | null {
  for (let index = 0; index < queue.length; index++) {
    const candidate = queue[index];
    const active = activeByClient.get(candidate.clientId) ?? 0;
    const quota = clampWorkspaceQuota(getWorkspaceQuota(candidate.clientId));
    if (active >= quota) continue;

    queue.splice(index, 1);
    activeByClient.set(candidate.clientId, active + 1);
    return candidate;
  }

  return null;
}
