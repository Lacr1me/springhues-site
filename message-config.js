export const MESSAGE_CONFIG = Object.freeze({
  apiBaseUrl: "https://etkjbxfdwmhqmuyzpttq.supabase.co/functions/v1",
  turnstileSiteKey: "0x4AAAAAAEaAYxUF2T8CqG3K",
  supabaseUrl: "https://etkjbxfdwmhqmuyzpttq.supabase.co",
  supabasePublishableKey: "sb_publishable_lycEJ0vJfLZlB_J2uXYDpg_GdixNTJF"
});

export function messageServiceConfigured(config = MESSAGE_CONFIG) {
  return /^https:\/\/[^/]+\/functions\/v1$/u.test(config.apiBaseUrl) && Boolean(config.turnstileSiteKey);
}

export function adminServiceConfigured(config = MESSAGE_CONFIG) {
  return messageServiceConfigured(config)
    && /^https:\/\/[^/]+\.supabase\.co$/u.test(config.supabaseUrl || "")
    && Boolean(config.supabasePublishableKey);
}
