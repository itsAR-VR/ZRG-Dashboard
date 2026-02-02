"use client";

import { cn } from "@/lib/utils";

interface LeadScoreBadgeProps {
  score: number | null | undefined;
  size?: "sm" | "md";
  showTooltip?: boolean;
  scoredAt?: Date | string | null;
}

/**
 * Display badge for lead scores (1-4 scale).
 * - null/undefined: Unscored (shows "-")
 * - 1-4: Scored (shows number with color)
 */
export function LeadScoreBadge({
  score,
  size = "sm",
  showTooltip = false,
  scoredAt,
}: LeadScoreBadgeProps) {
  // Normalize legacy values (some older rows used 0 for disqualified; treat as 1).
  const normalizedScore = score === 0 ? 1 : score;

  const isUnscored = normalizedScore === null || normalizedScore === undefined;
  const displayValue = isUnscored ? "-" : String(normalizedScore);

  const colorClasses = getScoreColorClasses(normalizedScore);
  const sizeClasses = size === "sm" ? "text-xs px-1.5 py-0.5 min-w-[20px]" : "text-sm px-2 py-1 min-w-[24px]";
  const tooltipContent = showTooltip ? getTooltipContent(normalizedScore, scoredAt) : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center font-medium rounded",
        colorClasses,
        sizeClasses
      )}
      title={tooltipContent}
    >
      {displayValue}
    </span>
  );
}

function getScoreColorClasses(score: number | null | undefined): string {
  if (score === null || score === undefined) {
    // Unscored - neutral gray
    return "bg-muted text-muted-foreground";
  }

  switch (score) {
    case 1:
      // Low score - red
      return "bg-[color:var(--score-1-bg)] text-[color:var(--score-1)]";
    case 2:
      // Medium-low score - yellow/amber
      return "bg-[color:var(--score-2-bg)] text-[color:var(--score-2)]";
    case 3:
      // Medium-high score - green
      return "bg-[color:var(--score-3-bg)] text-[color:var(--score-3)]";
    case 4:
      // High score - bright green/emerald
      return "bg-[color:var(--score-4-bg)] text-[color:var(--score-4)] font-semibold";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getTooltipContent(score: number | null | undefined, scoredAt?: Date | string | null): string {
  if (score === null || score === undefined) {
    return "Not scored yet";
  }

  const labels: Record<number, string> = {
    1: "Low priority",
    2: "Medium-low priority",
    3: "Medium-high priority",
    4: "High priority",
  };

  let content = labels[score] || `Score: ${score}`;

  if (scoredAt) {
    const date = typeof scoredAt === "string" ? new Date(scoredAt) : scoredAt;
    const relative = getRelativeTime(date);
    content += ` (${relative})`;
  }

  return content;
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
