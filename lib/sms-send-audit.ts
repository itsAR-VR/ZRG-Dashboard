export type SmsSendAuditSnapshot = {
  smsLastBlockedAt?: Date | string | null;
  smsLastBlockedReason?: string | null;
  smsConsecutiveBlockedCount?: number | null;
  smsLastSuccessAt?: Date | string | null;
};

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function isSmsSendBlocked(snapshot: SmsSendAuditSnapshot): boolean {
  const blockedAt = toDateOrNull(snapshot.smsLastBlockedAt);
  if (!blockedAt) return false;

  const successAt = toDateOrNull(snapshot.smsLastSuccessAt);
  if (!successAt) return true;

  return blockedAt.getTime() > successAt.getTime();
}

export function applySmsBlockedAudit(
  snapshot: SmsSendAuditSnapshot,
  opts: { at?: Date; reason: string }
): Required<SmsSendAuditSnapshot> {
  return {
    smsLastBlockedAt: opts.at ?? new Date(),
    smsLastBlockedReason: opts.reason,
    smsConsecutiveBlockedCount: Math.max(0, snapshot.smsConsecutiveBlockedCount ?? 0) + 1,
    smsLastSuccessAt: toDateOrNull(snapshot.smsLastSuccessAt),
  };
}

export function applySmsSuccessAudit(
  snapshot: SmsSendAuditSnapshot,
  opts?: { at?: Date }
): Required<SmsSendAuditSnapshot> {
  return {
    smsLastBlockedAt: toDateOrNull(snapshot.smsLastBlockedAt),
    smsLastBlockedReason: null,
    smsConsecutiveBlockedCount: 0,
    smsLastSuccessAt: opts?.at ?? new Date(),
  };
}
