export class WebhookEventTerminalError extends Error {
  readonly nonRetryable = true;

  constructor(message: string) {
    super(message);
    this.name = "WebhookEventTerminalError";
  }
}

export function isWebhookEventTerminalError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { nonRetryable?: unknown }).nonRetryable === true) return true;
  return error instanceof WebhookEventTerminalError;
}
