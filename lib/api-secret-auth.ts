import crypto from "node:crypto";
import type { NextRequest } from "next/server";

type VerifyRouteSecretParams = {
  request: NextRequest;
  expectedSecret: string | null | undefined;
  allowQuerySecret?: boolean;
  misconfiguredError?: string;
  headerNames?: string[];
};

const DEFAULT_HEADER_NAMES = [
  "x-workspace-provisioning-secret",
  "x-admin-secret",
  "x-cron-secret",
  "x-api-key",
];

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token.trim() || null;
}

function getHeaderSecret(request: NextRequest, headerNames: string[]): string | null {
  for (const headerName of headerNames) {
    const raw = request.headers.get(headerName);
    const trimmed = (raw || "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function getQuerySecret(request: NextRequest): string | null {
  const raw = new URL(request.url).searchParams.get("secret");
  const trimmed = (raw || "").trim();
  return trimmed || null;
}

function getProvidedSecret(request: NextRequest, opts?: { allowQuerySecret?: boolean; headerNames?: string[] }): string | null {
  const bearer = getBearerToken(request);
  if (bearer) return bearer;

  const headerSecret = getHeaderSecret(request, opts?.headerNames ?? DEFAULT_HEADER_NAMES);
  if (headerSecret) return headerSecret;

  if (opts?.allowQuerySecret) return getQuerySecret(request);
  return null;
}

export function verifyRouteSecret(
  params: VerifyRouteSecretParams
): { ok: true } | { ok: false; status: 401 | 500; error: string } {
  const expectedSecret = (params.expectedSecret || "").trim();
  if (!expectedSecret) {
    return {
      ok: false,
      status: 500,
      error: params.misconfiguredError || "Server misconfigured: secret not configured",
    };
  }

  const providedSecret = getProvidedSecret(params.request, {
    allowQuerySecret: params.allowQuerySecret,
    headerNames: params.headerNames,
  });

  if (!providedSecret || !timingSafeEqualUtf8(expectedSecret, providedSecret)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
