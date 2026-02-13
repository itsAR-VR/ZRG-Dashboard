"use server";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthError } from "@/lib/supabase/error-utils";
import { redirect } from "next/navigation";

export interface UserData {
  id: string;
  email: string | undefined;
  fullName: string;
  avatarUrl: string | null;
}

const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  "Authentication service is temporarily unavailable. Please try again in a minute.";

function isAuthTransportFailure(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";

  if (!message) return false;
  const normalized = message.toLowerCase();

  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("network error") ||
    normalized.includes("networkerror") ||
    normalized.includes("upstream connect error") ||
    normalized.includes("timed out")
  );
}

export async function signInWithEmailPassword(input: {
  email: string;
  password: string;
}): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const password = input.password;

  if (!normalizedEmail || !password) {
    return { success: false, error: "Email and password are required." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      if (isAuthTransportFailure(error.message)) {
        return { success: false, error: AUTH_SERVICE_UNAVAILABLE_MESSAGE };
      }

      return { success: false, error: error.message || "Failed to sign in." };
    }

    return { success: true };
  } catch (error) {
    if (isAuthTransportFailure(error)) {
      return { success: false, error: AUTH_SERVICE_UNAVAILABLE_MESSAGE };
    }

    if (error instanceof Error && error.message) {
      return { success: false, error: error.message };
    }

    console.error("Failed to sign in:", error);
    return { success: false, error: "Failed to sign in." };
  }
}

/**
 * Get the current logged-in user
 */
export async function getCurrentUser(): Promise<{
  success: boolean;
  user?: UserData;
  error?: string;
}> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return { success: false, error: "Not authenticated" };
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
        avatarUrl: user.user_metadata?.avatar_url || null,
      },
    };
  } catch (error) {
    // Expected when cookies are missing/expired; treat as signed-out without noisy server logs.
    if (isSupabaseAuthError(error)) {
      return { success: false, error: "Not authenticated" };
    }

    console.error("Failed to get current user:", error);
    return { success: false, error: "Failed to get current user" };
  }
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}
