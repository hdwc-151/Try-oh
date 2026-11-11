import { createClient } from '@supabase/supabase-js';

import { authStorage } from './auth-storage';

const configuredSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const configuredSupabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const validSupabaseUrl = Boolean(
  configuredSupabaseUrl
  && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(configuredSupabaseUrl)
  && !/placeholder|your_project/i.test(configuredSupabaseUrl),
);
const validSupabaseKey = Boolean(
  configuredSupabaseKey
  && configuredSupabaseKey.startsWith('sb_publishable_')
  && configuredSupabaseKey.length > 30
  && !/xxx|placeholder/i.test(configuredSupabaseKey),
);

const supabaseUrl = validSupabaseUrl ? configuredSupabaseUrl! : 'https://placeholder.supabase.co';
const supabaseKey = validSupabaseKey ? configuredSupabaseKey! : 'placeholder-key';

export const authConfigurationError =
  validSupabaseUrl && validSupabaseKey
    ? null
    : 'Ứng dụng chưa được cấu hình kết nối tài khoản. Vui lòng cài bản cập nhật mới.';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

export class AuthSessionTimeoutError extends Error {
  constructor() {
    super('Khôi phục phiên đăng nhập quá thời gian.');
    this.name = 'AuthSessionTimeoutError';
  }
}

export async function getSessionWithTimeout(timeoutMs = 10_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new AuthSessionTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
