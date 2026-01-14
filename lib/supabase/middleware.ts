import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Middleware runs for every request matched by `middleware.ts`. Avoid doing network work
  // for API routes (webhooks/cron), which can be hot paths and don't need browser session refresh.
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

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
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;
  } catch (error) {
    console.warn("[middleware] supabase.auth.getUser failed:", error instanceof Error ? error.message : error);
    // Fail open at the middleware layer (no redirects). Server-side auth checks still apply.
    return supabaseResponse;
  }

  // Protected routes - redirect to login if not authenticated
  const isAuthPage = request.nextUrl.pathname.startsWith("/auth");
  const isApiRoute = request.nextUrl.pathname.startsWith("/api");
  const isPublicRoute = isAuthPage || isApiRoute;
  const isAuthCallbackRoute = request.nextUrl.pathname === "/auth/callback";
  const isResetPasswordRoute = request.nextUrl.pathname === "/auth/reset-password";

  if (!user && !isPublicRoute) {
    // No user, redirect to login
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage && !isAuthCallbackRoute && !isResetPasswordRoute) {
    // User is logged in but trying to access auth pages, redirect to home
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}





