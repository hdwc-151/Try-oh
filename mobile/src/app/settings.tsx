import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Notice } from '@/components/notice';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest } from '@/services/api-client';
import { supabase } from '@/services/supabase';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialSnapshot } from '@/types/api';

type Feedback = { tone: 'error' | 'success'; text: string } | null;
type InvitePolicy = SocialSnapshot['me']['invitePolicy'];
type Visibility = SocialSnapshot['me']['defaultVisibility'];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SettingsRoute() {
  const social = useQuery({
    queryKey: ['social'],
    queryFn: () => apiRequest<SocialSnapshot>('/api/social'),
  });
  if (social.error) return <ScreenError message={errorMessage(social.error, 'Không thể tải cài đặt.')} onRetry={() => void social.refetch()}/>;
  if (social.data === undefined) return <ScreenLoading variant="cards" label="Đang tải cài đặt…"/>;
  return <SettingsContent snapshot={social.data}/>;
}

function SettingsContent({ snapshot }: { snapshot: SocialSnapshot }) {
  const auth = useAuth();
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const metadata = auth.user?.user_metadata ?? {};
  const [displayName, setDisplayName] = useState(String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? snapshot.me.name ?? ''));
  // Tài khoản chỉ đăng nhập bằng Google chưa có mật khẩu, nên không đổi email/mật khẩu bằng "mật khẩu hiện tại" được.
  const providers: unknown = auth.user?.app_metadata.providers ?? [auth.user?.app_metadata.provider];
  const hasPassword = Array.isArray(providers) && providers.includes('email');
  const [username, setUsername] = useState(snapshot.me.username);
  const [birthDate, setBirthDate] = useState(snapshot.me.birthDate ?? '');
  const [invitePolicy, setInvitePolicy] = useState<InvitePolicy>(snapshot.me.invitePolicy);
  const [defaultVisibility, setDefaultVisibility] = useState<Visibility>(snapshot.me.defaultVisibility);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountFeedback, setAccountFeedback] = useState<Feedback>(null);
  const [emailFeedback, setEmailFeedback] = useState<Feedback>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [privacyFeedback, setPrivacyFeedback] = useState<Feedback>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const syncSocialFields = (next: SocialSnapshot) => {
    setUsername(next.me.username);
    setBirthDate(next.me.birthDate ?? '');
    setInvitePolicy(next.me.invitePolicy);
    setDefaultVisibility(next.me.defaultVisibility);
  };

  const updateName = useMutation({
    mutationFn: () => apiRequest('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: displayName.trim() }),
    }),
    onSuccess: async () => {
      await supabase.auth.refreshSession();
      setAccountFeedback({ tone: 'success', text: 'Đã cập nhật tên hiển thị.' });
      void queryClient.invalidateQueries({ queryKey: ['social'] });
    },
    onError: (error) => setAccountFeedback({ tone: 'error', text: errorMessage(error, 'Không thể cập nhật tên.') }),
  });

  const saveSocialProfile = useMutation({
    mutationFn: () => apiRequest<SocialSnapshot>('/api/social/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.trim().toLowerCase(),
        birthDate: snapshot.me.birthDate ?? (birthDate || null),
        invitePolicy,
        defaultVisibility,
      }),
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(['social'], next);
      syncSocialFields(next);
      setAccountFeedback({ tone: 'success', text: 'Đã lưu thông tin cá nhân.' });
    },
    onError: (error) => setAccountFeedback({ tone: 'error', text: errorMessage(error, 'Không thể lưu thông tin.') }),
  });

  const changeEmail = useMutation({
    mutationFn: () => apiRequest('/api/auth/change-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newEmail: newEmail.trim(), password: emailPassword }),
    }),
    onSuccess: async () => {
      await supabase.auth.refreshSession();
      setNewEmail('');
      setEmailPassword('');
      setEmailFeedback({ tone: 'success', text: 'Yêu cầu đổi email đã được ghi nhận. Hãy xác minh email mới nếu được yêu cầu.' });
    },
    onError: (error) => setEmailFeedback({ tone: 'error', text: errorMessage(error, 'Không thể đổi email.') }),
  });

  const changePassword = useMutation({
    mutationFn: () => apiRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback({ tone: 'success', text: 'Đổi mật khẩu thành công.' });
    },
    onError: (error) => setPasswordFeedback({ tone: 'error', text: errorMessage(error, 'Không thể đổi mật khẩu.') }),
  });

  const deleteAccount = useMutation({
    mutationFn: () => apiRequest('/api/auth/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }),
    onSuccess: async () => {
      await supabase.auth.signOut({ scope: 'local' });
    },
    onError: (error) => setAccountFeedback({ tone: 'error', text: errorMessage(error, 'Không thể xóa tài khoản.') }),
  });

  const savePrivacy = useMutation({
    mutationFn: () => apiRequest<SocialSnapshot>('/api/social/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: snapshot.me.username,
        birthDate: snapshot.me.birthDate,
        invitePolicy,
        defaultVisibility,
      }),
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(['social'], next);
      syncSocialFields(next);
      setPrivacyFeedback({ tone: 'success', text: 'Đã lưu quyền riêng tư.' });
    },
    onError: (error) => setPrivacyFeedback({ tone: 'error', text: errorMessage(error, 'Không thể lưu quyền riêng tư.') }),
  });

  const unblock = useMutation({
    mutationFn: (targetId: string) => apiRequest<SocialSnapshot>('/api/social/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId }),
    }),
    onSuccess: (snapshot) => queryClient.setQueryData(['social'], snapshot),
    onError: (error) => setPrivacyFeedback({ tone: 'error', text: errorMessage(error, 'Không thể bỏ chặn.') }),
  });

  const nameValid = displayName.trim().length >= 2 && displayName.trim().length <= 50;
  const socialValid = /^[a-z0-9_]{3,40}$/.test(username.trim().toLowerCase());
  const emailValid = emailPattern.test(newEmail.trim()) && newEmail.trim().length <= 254 && emailPassword.length > 0;
  const passwordValid = currentPassword.length > 0 && newPassword.length >= 8 && newPassword.length <= 128 && newPassword === confirmPassword;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md, backgroundColor: colors.background }}>
      <SettingsCard title="Hồ sơ">
        <TextField label="Tên hiển thị" value={displayName} onChangeText={setDisplayName} maxLength={50} autoCapitalize="words"/>
        <AppButton title="Lưu tên" loading={updateName.isPending} disabled={!nameValid} onPress={() => {
          setAccountFeedback(null);
          updateName.mutate();
        }}/>
        <View style={{ height: 1, backgroundColor: colors.separator }}/>
        <TextField label="Username" value={username} onChangeText={setUsername} maxLength={40} autoCapitalize="none" autoCorrect={false}/>
        <TextField
          label="Ngày sinh (YYYY-MM-DD)"
          value={birthDate}
          onChangeText={setBirthDate}
          maxLength={10}
          editable={!snapshot.me.birthDate}
          placeholder="2000-01-31"
        />
        <AppButton title="Lưu thông tin" variant="secondary" loading={saveSocialProfile.isPending} disabled={!socialValid} onPress={() => {
          setAccountFeedback(null);
          saveSocialProfile.mutate();
        }}/>
        <Message feedback={accountFeedback} onDismiss={() => setAccountFeedback(null)}/>
      </SettingsCard>

      {!hasPassword && <SettingsCard title="Đăng nhập bằng Google">
        <AppText variant="subhead">Tài khoản {auth.user?.email} đăng nhập bằng Google nên không có mật khẩu Fitsy. Email và mật khẩu được quản lý trong tài khoản Google của bạn.</AppText>
      </SettingsCard>}

      {hasPassword && <SettingsCard title="Địa chỉ email">
        <AppText variant="subhead">{auth.user?.email}</AppText>
        <TextField label="Email mới" value={newEmail} onChangeText={setNewEmail} maxLength={254} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}/>
        <TextField label="Mật khẩu hiện tại" value={emailPassword} onChangeText={setEmailPassword} maxLength={128} secureTextEntry autoCapitalize="none" autoComplete="current-password"/>
        <AppButton title="Đổi email" loading={changeEmail.isPending} disabled={!emailValid} onPress={() => {
          setEmailFeedback(null);
          changeEmail.mutate();
        }}/>
        <Message feedback={emailFeedback} onDismiss={() => setEmailFeedback(null)}/>
      </SettingsCard>}

      {hasPassword && <SettingsCard title="Mật khẩu">
        <TextField label="Mật khẩu hiện tại" value={currentPassword} onChangeText={setCurrentPassword} maxLength={128} passwordVisible={showPasswords} onTogglePasswordVisible={() => setShowPasswords((value) => !value)} autoCapitalize="none" autoComplete="current-password"/>
        <TextField label="Mật khẩu mới" value={newPassword} onChangeText={setNewPassword} maxLength={128} passwordVisible={showPasswords} autoCapitalize="none" autoComplete="new-password" placeholder="Tối thiểu 8 ký tự"/>
        <TextField label="Nhập lại mật khẩu" value={confirmPassword} onChangeText={setConfirmPassword} maxLength={128} passwordVisible={showPasswords} autoCapitalize="none" autoComplete="new-password" error={confirmPassword.length > 0 && confirmPassword !== newPassword}/>
        {confirmPassword.length > 0 && confirmPassword !== newPassword && <AppText variant="caption" style={{ color: colors.destructive }}>Mật khẩu nhập lại chưa khớp.</AppText>}
        <AppButton title="Lưu mật khẩu" loading={changePassword.isPending} disabled={!passwordValid} onPress={() => {
          setPasswordFeedback(null);
          changePassword.mutate();
        }}/>
        <Message feedback={passwordFeedback} onDismiss={() => setPasswordFeedback(null)}/>
      </SettingsCard>}

      <SettingsCard title="Quyền riêng tư">
        <AppText variant="caption" style={{ color: colors.label, fontWeight: '700' }}>Ai được gửi lời mời?</AppText>
        <ChoiceRow
          value={invitePolicy}
          onChange={setInvitePolicy}
          choices={[
            ['known', 'Bạn chung / mã mời'],
            ['code', 'Chỉ mã mời'],
            ['everyone', 'Mọi người'],
          ]}
        />
        <AppText variant="caption" style={{ color: colors.label, fontWeight: '700' }}>Quyền xem outfit mặc định</AppText>
        <ChoiceRow
          value={defaultVisibility}
          onChange={setDefaultVisibility}
          choices={[
            ['private', 'Chỉ mình tôi'],
            ['friends', 'Bạn bè'],
          ]}
        />
        <AppButton title="Lưu quyền riêng tư" loading={savePrivacy.isPending} onPress={() => {
          setPrivacyFeedback(null);
          savePrivacy.mutate();
        }}/>
        <Message feedback={privacyFeedback} onDismiss={() => setPrivacyFeedback(null)}/>
      </SettingsCard>

      <SettingsCard title="Danh sách đã chặn">
        {snapshot.blocked.length === 0
          ? <AppText variant="subhead">Chưa chặn ai.</AppText>
          : snapshot.blocked.map((person) => (
            <View key={person.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{person.name}</AppText>
                <AppText variant="caption">@{person.username}</AppText>
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={'Bỏ chặn ' + person.name}
                disabled={unblock.isPending}
                onPress={() => unblock.mutate(person.id)}
                scaleTo={0.94}
                style={{
                  minWidth: 84,
                  minHeight: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: spacing.md,
                  borderWidth: 1,
                  borderColor: colors.separator,
                  borderRadius: radius.full,
                  backgroundColor: colors.surface,
                  opacity: unblock.isPending && unblock.variables !== person.id ? 0.5 : 1,
                }}>
                {unblock.isPending && unblock.variables === person.id
                  ? <ActivityIndicator size="small" color={brand.primary}/>
                  : <AppText selectable={false} variant="caption" style={{ color: brand.primary, fontWeight: '800' }}>Bỏ chặn</AppText>}
              </PressableScale>
            </View>
          ))}
      </SettingsCard>

      <SettingsCard title="Xóa tài khoản">
        <AppText variant="subhead">Xóa hồ sơ, ảnh, tủ đồ, outfit và nội dung đã đăng. Hành động này không thể hoàn tác.</AppText>
        <AppButton
          title="Xóa vĩnh viễn tài khoản"
          variant="destructive"
          loading={deleteAccount.isPending}
          onPress={() => Alert.alert(
            'Xóa vĩnh viễn tài khoản?',
            'Dữ liệu cá nhân và nội dung đã đăng sẽ bị xóa. Giao dịch bắt buộc lưu sẽ được ẩn danh.',
            [
              { text: 'Hủy', style: 'cancel' },
              { text: 'Xóa tài khoản', style: 'destructive', onPress: () => deleteAccount.mutate() },
            ],
          )}
        />
      </SettingsCard>
    </ScrollView>
  );
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface }}>
      <AppText variant="headline">{title}</AppText>
      {children}
    </View>
  );
}

function ChoiceRow<T extends string>({
  value,
  choices,
  onChange,
}: {
  value: T;
  choices: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {choices.map(([choice, label]) => {
        const selected = value === choice;
        return (
          <PressableScale
            key={choice}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(choice)}
            scaleTo={0.95}
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: selected ? colors.label : colors.separator,
              borderRadius: radius.full,
              backgroundColor: selected ? colors.label : colors.surface,
            }}>
            <AppText selectable={false} variant="caption" style={{ color: selected ? colors.onBrand : colors.label, fontWeight: '700' }}>{label}</AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

function Message({ feedback, onDismiss }: { feedback: Feedback; onDismiss: () => void }) {
  if (!feedback) return null;
  return <Notice key={feedback.text} tone={feedback.tone} text={feedback.text} onDismiss={feedback.tone === 'success' ? onDismiss : undefined} autoHideMs={feedback.tone === 'success' ? 4000 : undefined}/>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
