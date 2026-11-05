import type { SupabaseClient } from "@supabase/supabase-js";

export const onboardingKey = "bandup_onboarding_seen_v1";

// Presentation preference only. Never use user-editable metadata for permissions.
export async function prepareOnboarding(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== userId || !data.user.email_confirmed_at) throw new Error("account");
  if (data.user.user_metadata?.[onboardingKey] === true) return false;
  const saved = await client.auth.updateUser({ data: { [onboardingKey]: true } });
  if (saved.error || saved.data.user?.id !== userId || saved.data.user.user_metadata?.[onboardingKey] !== true) throw new Error("persistence");
  return true;
}
