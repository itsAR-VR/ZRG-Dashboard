import "server-only";

import { runAppointmentReconciliation } from "@/lib/appointment-reconcile-runner";
import { APPOINTMENT_SOURCE } from "@/lib/meeting-lifecycle";

export type AppointmentReconcileOptions = {
  workspaceLimit: number;
  leadsPerWorkspace: number;
  staleDays: number;
  clientId?: string;
  dryRun: boolean;
};

export function buildAppointmentReconcileOptions(searchParams: URLSearchParams): AppointmentReconcileOptions {
  const workspaceLimit = Math.max(
    1,
    Number.parseInt(searchParams.get("workspaceLimit") || process.env.RECONCILE_WORKSPACE_LIMIT || "10", 10) || 10
  );
  const leadsPerWorkspace = Math.max(
    1,
    Number.parseInt(searchParams.get("leadsPerWorkspace") || process.env.RECONCILE_LEADS_PER_WORKSPACE || "50", 10) ||
      50
  );
  const staleDays = Math.max(
    1,
    Number.parseInt(searchParams.get("staleDays") || process.env.RECONCILE_STALE_DAYS || "7", 10) || 7
  );
  const clientId = searchParams.get("clientId") || undefined;
  const dryRun = searchParams.get("dryRun") === "true";

  return {
    workspaceLimit,
    leadsPerWorkspace,
    staleDays,
    clientId,
    dryRun,
  };
}

export async function runAppointmentReconcileCron(options: AppointmentReconcileOptions) {
  return runAppointmentReconciliation({
    ...options,
    source: APPOINTMENT_SOURCE.RECONCILE_CRON,
  });
}
