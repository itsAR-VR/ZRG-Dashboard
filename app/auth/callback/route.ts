import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  
  // Handle OAuth callback (has 'code' parameter)
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  
  // Handle email verification callback (has 'token_hash' and 'type' parameters)
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "signup" | "recovery" | "invite" | "email" | null;

  const supabase = await createClient();

  // OAuth flow
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(error.message)}`);
  }

  // Email verification flow
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });

    if (!error) {
      // Successfully verified - redirect to dashboard
      return NextResponse.redirect(`${origin}/`);
    }
    console.error("Email verification error:", error);
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(error.message)}`);
  }

  // Check for error params (Supabase redirects with errors in query params)
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  
  if (error) {
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(errorDescription || error)}`);
  }

  // No valid params - redirect to error
  return NextResponse.redirect(`${origin}/auth/error`);
}
