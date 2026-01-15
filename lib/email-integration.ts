import { EmailIntegrationProvider } from "@prisma/client";

type MaybeString = string | null | undefined;

export type EmailIntegrationSnapshot = {
  emailProvider?: EmailIntegrationProvider | null;
  emailBisonApiKey?: MaybeString;
  emailBisonWorkspaceId?: MaybeString;
  smartLeadApiKey?: MaybeString;
  smartLeadWebhookSecret?: MaybeString;
  instantlyApiKey?: MaybeString;
  instantlyWebhookSecret?: MaybeString;
};

function hasValue(value: MaybeString): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveEmailIntegrationProvider(client: EmailIntegrationSnapshot): EmailIntegrationProvider | null {
  const explicit = client.emailProvider ?? undefined;
  if (
    explicit === EmailIntegrationProvider.EMAILBISON ||
    explicit === EmailIntegrationProvider.SMARTLEAD ||
    explicit === EmailIntegrationProvider.INSTANTLY
  ) {
    return explicit;
  }

  const configured: EmailIntegrationProvider[] = [];
  if (hasValue(client.emailBisonApiKey) || hasValue(client.emailBisonWorkspaceId)) {
    configured.push(EmailIntegrationProvider.EMAILBISON);
  }
  if (hasValue(client.smartLeadApiKey) || hasValue(client.smartLeadWebhookSecret)) {
    configured.push(EmailIntegrationProvider.SMARTLEAD);
  }
  if (hasValue(client.instantlyApiKey) || hasValue(client.instantlyWebhookSecret)) {
    configured.push(EmailIntegrationProvider.INSTANTLY);
  }

  if (configured.length === 0) return null;
  if (configured.length === 1) return configured[0];

  throw new Error(
    "Multiple email providers are configured for this workspace. Select exactly one (EmailBison, SmartLead, Instantly)."
  );
}

