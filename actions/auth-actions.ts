"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface UserData {
  id: string;
  email: string | undefined;
  fullName: string;
  avatarUrl: string | null;
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







