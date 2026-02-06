// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isProduction = process.env.NODE_ENV === "production";

Sentry.init({
  // Keep DSNs out of source control. This must be set as a public env var for the client bundle.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Define how likely traces are sampled. Tune in production.
  tracesSampleRate: isProduction ? 0.1 : 1.0,

  // Default to not sending PII in this app.
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
