import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAbortError, isSupabaseAuthError, isSupabaseInvalidOrMissingSessionError } from "@/lib/supabase/error-utils";

function getDefaultSupabaseStorageKey(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;

  try {
    const hostname = new URL(url).hostname;
    const projectRef = hostname.split(".")[0];
    if (!projectRef) return null;
    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  const baseName = getDefaultSupabaseStorageKey();
  if (!baseName) return false;

  return request.cookies
    .getAll()
    .some(({ name }) => name === baseName || name.startsWith(`${baseName}.`));
}

function getSupabaseAuthCookieNames(request: NextRequest): string[] {
  const baseName = getDefaultSupabaseStorageKey();
  if (!baseName) return [];
  return request.cookies
    .getAll()
    .map(({ name }) => name)
    .filter((name) => name === baseName || name.startsWith(`${baseName}.`));
}

export async function updateSession(request: NextRequest) {
  // Middleware runs for every request matched by `middleware.ts`. Avoid doing network work
  // for API routes (webhooks/cron), which can be hot paths and don't need browser session refresh.
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  // Fast-path: if there is no Supabase auth cookie, skip creating a client and any network calls.
  // This avoids noisy auth refresh attempts for signed-out users (e.g. refresh_token_not_found).
  const isAuthPage = request.nextUrl.pathname.startsWith("/auth");
  const isApiRoute = request.nextUrl.pathname.startsWith("/api");
  const isPublicRoute = isAuthPage || isApiRoute;
  const isAuthCallbackRoute = request.nextUrl.pathname === "/auth/callback";
  const isResetPasswordRoute = request.nextUrl.pathname === "/auth/reset-password";

  if (!hasSupabaseAuthCookie(request)) {
    if (!isPublicRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  }

  // If we detect stale/invalid auth cookies, clear them on whichever response we ultimately return.
  const authCookieNamesToClear = new Set<string>();
  const markSupabaseAuthCookiesForClearing = () => {
    for (const name of getSupabaseAuthCookieNames(request)) {
      authCookieNamesToClear.add(name);
      // Also clear from the in-flight request cookie jar to avoid further refresh attempts in this request.
      request.cookies.set(name, "");
    }
  };
  const applySupabaseAuthCookieClears = (response: NextResponse): NextResponse => {
    if (authCookieNamesToClear.size === 0) return response;
    for (const name of authCookieNamesToClear) {
      response.cookies.set(name, "", { path: "/", maxAge: 0, expires: new Date(0) });
    }
    return response;
  };

  const timeoutMs = Math.max(
    500,
    Number.parseInt(process.env.SUPABASE_MIDDLEWARE_TIMEOUT_MS || "8000", 10) || 8_000
  );

  const fetchWithTimeout: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, { ...(init || {}), signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  let user: unknown = null;
  try {
    const { data, error } = await supabase.auth.getUser();

    // Treat auth failures as a signed-out state; only fail-open on non-auth unexpected errors.
    if (error) {
      if (isSupabaseInvalidOrMissingSessionError(error)) {
        markSupabaseAuthCookiesForClearing();
      }
      if (!isSupabaseAuthError(error)) {
        console.warn(
          "[middleware] supabase.auth.getUser error:",
          error instanceof Error ? error.message : error
        );
        return applySupabaseAuthCookieClears(supabaseResponse);
      }
    } else {
      user = data.user;
    }
  } catch (error) {
    // refresh_token_not_found and similar session errors are expected when cookies are stale/missing.
    // AbortError is expected when our middleware timeout triggers.
    if (isAbortError(error)) {
      return applySupabaseAuthCookieClears(supabaseResponse);
    }
    if (isSupabaseInvalidOrMissingSessionError(error)) {
      markSupabaseAuthCookiesForClearing();
    } else {
      console.warn(
        "[middleware] supabase.auth.getUser threw:",
        error instanceof Error ? error.message : error
      );
      // Fail open at the middleware layer (no redirects). Server-side auth checks still apply.
      return applySupabaseAuthCookieClears(supabaseResponse);
    }
  }

  if (!user && !isPublicRoute) {
    // No user, redirect to login
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return applySupabaseAuthCookieClears(NextResponse.redirect(url));
  }

  if (user && isAuthPage && !isAuthCallbackRoute && !isResetPasswordRoute) {
    // User is logged in but trying to access auth pages, redirect to home
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return applySupabaseAuthCookieClears(NextResponse.redirect(url));
  }

  return applySupabaseAuthCookieClears(supabaseResponse);
}


