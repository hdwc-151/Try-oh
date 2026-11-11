import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { type ComponentRef, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  type TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { FitsyMark, FitsyWordmark } from '@/components/fitsy-mark';
import { Notice } from '@/components/notice';
import { SegmentedControl } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest } from '@/services/api-client';
import { colors, radius, shadows, spacing } from '@/theme';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const contentByMode: Record<AuthMode, { eyebrow: string; title?: string; description?: string }> = {
  login: {
    eyebrow: 'Chào mừng trở lại',
  },
  register: {
    eyebrow: 'Tạo tài khoản mới',
  },
  forgot: {
    eyebrow: 'Khôi phục tài khoản',
    title: 'Quên mật khẩu?',
    description: 'Nhập email đăng ký, chúng tôi sẽ gửi cho bạn liên kết đặt lại mật khẩu.',
  },
  reset: {
    eyebrow: 'Bảo mật tài khoản',
    title: 'Đặt mật khẩu mới',
    description: 'Chọn mật khẩu mới có ít nhất 8 ký tự.',
  },
};

export function AuthScreen({ initialMode = 'login' }: { initialMode?: AuthMode }) {
  const auth = useAuth();
  const [selectedMode, setSelectedMode] = useState<AuthMode>(
    initialMode === 'reset' || auth.recoveryMode ? 'reset' : initialMode,
  );
  const mode = auth.recoveryMode ? 'reset' : selectedMode;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Máy chủ quyết định có nút Google hay không (cần GOOGLE_CLIENT_ID/SECRET).
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => apiRequest<{ google: boolean }>('/api/auth/providers'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [resending, setResending] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(auth.configurationError);
  const [notice, setNotice] = useState<string | null>(null);
  const visibleError = error ?? auth.linkError;
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);

  if (auth.session && mode !== 'reset' && !auth.recoveryMode) {
    return <Redirect href="/(tabs)/home" />;
  }

  const changeMode = (nextMode: AuthMode) => {
    setSelectedMode(nextMode);
    setError(null);
    setNotice(null);
    setAwaitingConfirmation(false);
    setPassword('');
    setConfirmPassword('');
  };

  const leaveRecovery = async (nextMode: 'login' | 'forgot') => {
    if (mode === 'reset' && auth.session) {
      try {
        await auth.signOut();
      } catch {
        // The recovery screen still needs to close even if remote sign-out is unavailable.
      }
    }
    auth.finishRecovery();
    changeMode(nextMode);
  };

  const validate = () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail && mode !== 'reset') return 'Vui lòng nhập email.';
    if (mode !== 'reset' && (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254)) {
      return 'Email không hợp lệ.';
    }
    if (mode === 'forgot') return null;
    if (!password) return 'Vui lòng nhập mật khẩu.';
    if ((mode === 'register' || mode === 'reset') && (password.length < 8 || password.length > 128)) {
      return 'Mật khẩu phải từ 8 đến 128 ký tự.';
    }
    if ((mode === 'register' || mode === 'reset') && password !== confirmPassword) {
      return 'Mật khẩu nhập lại chưa khớp.';
    }
    if (mode === 'register' && (name.trim().length < 2 || name.trim().length > 50)) {
      return 'Tên hiển thị phải từ 2 đến 50 ký tự.';
    }
    if (mode === 'reset' && (!auth.session || auth.linkError)) {
      return 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.';
    }
    return null;
  };

  const submit = async () => {
    if (busy || auth.configurationError) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') {
        await auth.signIn(email, password);
      } else if (mode === 'register') {
        const result = await auth.signUp(name, email, password);
        if (result === 'confirmation-required') {
          setAwaitingConfirmation(true);
          setNotice('Tài khoản đã được tạo. Hãy kiểm tra email để xác minh trước khi đăng nhập.');
        }
      } else if (mode === 'forgot') {
        await auth.requestPasswordReset(email);
        setNotice('Nếu email tồn tại, bạn sẽ nhận được liên kết đặt lại mật khẩu trong ít phút.');
      } else {
        await auth.resetPassword(password);
        auth.finishRecovery();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không thể xác thực tài khoản.';
      if (/xác minh email|email chưa được xác minh/i.test(message)) {
        setAwaitingConfirmation(true);
        setNotice(message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    if (googleBusy || busy) return;
    setGoogleBusy(true);
    setError(null);
    setNotice(null);
    try {
      await auth.signInWithGoogle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập bằng Google.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!email.trim() || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await auth.resendConfirmation(email);
      setNotice('Đã gửi lại email xác minh. Hãy kiểm tra hộp thư và thư rác.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể gửi lại email xác minh.');
    } finally {
      setResending(false);
    }
  };

  const content = contentByMode[mode];
  const submitLabel = mode === 'login'
    ? 'Đăng nhập'
    : mode === 'register'
      ? 'Tạo tài khoản'
      : mode === 'forgot'
        ? 'Gửi liên kết đặt lại'
        : 'Lưu mật khẩu mới';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xl,
          backgroundColor: colors.background,
        }}>
        <View style={{ width: '100%', maxWidth: 520, gap: spacing.lg }}>
          <Animated.View entering={FadeInDown.duration(380)} style={{ alignItems: 'center', gap: spacing.md }}>
            <FitsyMark size={64} />
            <FitsyWordmark size={32} />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(380).delay(80)} layout={LinearTransition.duration(220)} style={{
            gap: spacing.md,
            padding: spacing.lg,
            borderWidth: 1,
            borderColor: colors.separator,
            borderRadius: radius.xl,
            borderCurve: 'continuous',
            backgroundColor: colors.surface,
            boxShadow: shadows.raised,
          }}>
            {(mode === 'login' || mode === 'register') && (
              <SegmentedControl
                options={[{ value: 'login', label: 'Đăng nhập' }, { value: 'register', label: 'Đăng ký' }]}
                value={mode}
                onChange={changeMode}
                stretch
                trackColor={colors.groupedBackground}
                indicatorColor={colors.surface}
                activeColor={colors.label}
                inactiveColor={colors.secondaryLabel}
                indicatorStyle={{ boxShadow: '0 1px 4px rgba(20, 26, 60, 0.12)' }}
              />
            )}

            {(mode === 'forgot' || mode === 'reset') && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void leaveRecovery('login')}
                style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}>
                <AppText variant="subhead" style={{ color: colors.label, fontWeight: '700' }}>
                  ← Quay lại đăng nhập
                </AppText>
              </Pressable>
            )}

            <Animated.View key={mode} entering={FadeIn.duration(220)} style={{ gap: spacing.md }}>
            <View style={{ gap: spacing.xs }}>
              <AppText variant="caption" style={{ color: colors.success, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.4 }}>
                {content.eyebrow}
              </AppText>
              {content.title ? <AppText variant="title">{content.title}</AppText> : null}
              {content.description ? <AppText variant="subhead">{content.description}</AppText> : null}
            </View>

            {mode === 'register' && (
              <TextField
                label="Tên hiển thị"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                placeholder="Tên của bạn"
                maxLength={50}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            )}

            {mode !== 'reset' && (
              <TextField
                ref={emailRef}
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                placeholder="email@example.com"
                maxLength={254}
                returnKeyType={mode === 'forgot' ? 'send' : 'next'}
                submitBehavior={mode === 'forgot' ? 'blurAndSubmit' : 'submit'}
                onSubmitEditing={() => { if (mode === 'forgot') void submit(); else passwordRef.current?.focus(); }}
              />
            )}

            {mode !== 'forgot' && (
              <TextField
                ref={passwordRef}
                label={mode === 'reset' ? 'Mật khẩu mới' : 'Mật khẩu'}
                value={password}
                onChangeText={setPassword}
                passwordVisible={showPassword}
                onTogglePasswordVisible={() => setShowPassword((current) => !current)}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={128}
                placeholder="Tối thiểu 8 ký tự"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                textContentType={mode === 'login' ? 'password' : 'newPassword'}
                returnKeyType={mode === 'login' ? 'go' : 'next'}
                submitBehavior={mode === 'login' ? 'blurAndSubmit' : 'submit'}
                onSubmitEditing={() => { if (mode === 'login') void submit(); else confirmRef.current?.focus(); }}
              />
            )}

            {mode === 'login' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void leaveRecovery('forgot')}
                style={({ pressed }) => ({ alignSelf: 'flex-end', opacity: pressed ? 0.6 : 1 })}>
                <AppText variant="subhead" style={{ color: colors.success, fontWeight: '700' }}>
                  Quên mật khẩu?
                </AppText>
              </Pressable>
            )}

            {(mode === 'register' || mode === 'reset') && (
              <TextField
                ref={confirmRef}
                label="Nhập lại mật khẩu"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                passwordVisible={showPassword}
                onTogglePasswordVisible={() => setShowPassword((current) => !current)}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={128}
                placeholder="Tối thiểu 8 ký tự"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                submitBehavior="blurAndSubmit"
                onSubmitEditing={() => void submit()}
              />
            )}
            </Animated.View>

            {visibleError && <Notice tone="error" text={visibleError} />}
            {notice && <Notice tone="success" text={notice} />}

            <AppButton
              title={submitLabel}
              loading={busy}
              disabled={Boolean(auth.configurationError)}
              onPress={() => void submit()}
            />

            {providers.data?.google && (mode === 'login' || mode === 'register') && <>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.separator }}/>
                <AppText variant="caption">hoặc</AppText>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.separator }}/>
              </View>
              <AppButton
                title="Tiếp tục với Google"
                variant="secondary"
                loading={googleBusy}
                loadingTitle="Đang mở Google…"
                disabled={busy || Boolean(auth.configurationError)}
                onPress={() => void continueWithGoogle()}
              />
            </>}

            {awaitingConfirmation && (
              <AppButton
                title="Gửi lại email xác minh"
                loading={resending}
                variant="secondary"
                onPress={() => void resendConfirmation()}
              />
            )}

            {mode === 'reset' && (!auth.session || auth.linkError) && (
              <Pressable
                accessibilityRole="button"
                onPress={() => changeMode('forgot')}
                style={({ pressed }) => ({ alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
                <AppText variant="subhead" style={{ color: colors.success, fontWeight: '700' }}>
                  Yêu cầu liên kết mới
                </AppText>
              </Pressable>
            )}
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
