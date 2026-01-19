export const EMAIL_CAMPAIGNS_SYNCED_EVENT = "zrg:email-campaigns-synced";

export type EmailCampaignsSyncedDetail = {
  clientId: string;
  provider?: string;
  synced?: number;
};

export function dispatchEmailCampaignsSynced(detail: EmailCampaignsSyncedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EmailCampaignsSyncedDetail>(EMAIL_CAMPAIGNS_SYNCED_EVENT, { detail }));
}

