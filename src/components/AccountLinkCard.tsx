import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, PrimaryButton } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import {
  AccountLinkState,
  accountLinkErrorMessage,
  enableNewCloudAccount,
  appleCredential,
  getAccountLinkState,
  isAppleCancel,
  isAppleIdentityTaken,
  linkAppleAccount,
  requestEmailLink,
  resendEmailLink,
  setAccountPassword,
  verifyEmailLink,
} from '@/services/accountLinking';
import { useLanguage } from '@/i18n/LanguageProvider';

type ViewMode = 'upgrade' | 'sign-in';
// Profile and paywall account-help may both remain mounted in the native stack.
// Only one card may mutate authentication at a time, including the Apple sheet.
let accountActionInFlight = false;

export function AccountLinkCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { loadAppleAccount, loadExistingAccount, refreshCloudState, userName } = useApp();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [account, setAccount] = useState<AccountLinkState | null>(null);
  const [mode, setMode] = useState<ViewMode>('upgrade');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { language, t } = useLanguage();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const beginAction = () => {
    if (busyRef.current || !mounted.current) return false;
    if (accountActionInFlight) {
      setMessage(t.account.actionInProgress);
      return false;
    }
    accountActionInFlight = true;
    busyRef.current = true;
    setBusy(true); setError(null); setMessage(null);
    return true;
  };
  const endAction = () => {
    accountActionInFlight = false;
    busyRef.current = false;
    if (mounted.current) setBusy(false);
  };

  useEffect(() => {
    let active = true;
    // Only builds signed with the Sign in with Apple entitlement show the button.
    if (Constants.expoConfig?.ios?.usesAppleSignIn !== true) return () => { active = false; };
    void AppleAuthentication.isAvailableAsync().then(value => { if (active) setAppleAvailable(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  // Keep this account and add Apple as its login. If this
  // Apple ID already owns a Kandro account (new phone), offer to load it.
  const continueWithApple = async (existing: boolean) => {
    if (!beginAction()) return;
    try {
      const credential = await appleCredential();
      if (!mounted.current) return;
      if (existing) {
        const next = await loadAppleAccount(credential);
        if (!mounted.current) return;
        setAccount(next);
        setMessage(t.account.loadedMessage);
        return;
      }
      const next = await linkAppleAccount(credential);
      if (!mounted.current) return;
      setAccount(next);
      try {
        await refreshCloudState();
      } catch {
        // Linking and secure token storage already succeeded. A later sync
        // failure must not invite another link or conceal the saved identity.
        if (mounted.current) setError(t.account.appleSyncRetry);
        return;
      }
      if (mounted.current) setMessage(t.account.appleLinked);
    } catch (failure) {
      if (!mounted.current || isAppleCancel(failure)) return;
      if (!existing && isAppleIdentityTaken(failure)) {
        Alert.alert(t.account.appleTakenTitle, t.account.appleTakenBody, [
          { text: t.common.cancel, style: 'cancel' },
          { text: t.account.replaceAction, onPress: () => { void continueWithApple(true); } },
        ]);
        return;
      }
      // Linking may already have succeeded while server token storage failed.
      // Keep a fresh native retry visible without linking a second identity.
      if (!existing) {
        const current = await getAccountLinkState().catch(() => null);
        if (mounted.current && current) setAccount(current);
      }
      if (mounted.current) setError(accountLinkErrorMessage(failure));
    } finally {
      endAction();
    }
  };
  const confirmAppleAccountLoad = () => {
    if (busyRef.current) return;
    Alert.alert(t.account.replaceTitle, t.account.replaceText, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.account.replaceAction, onPress: () => { void continueWithApple(true); } },
    ]);
  };
  const appleButton = (existing: boolean) => appleAvailable ? (
    <AppleAuthentication.AppleAuthenticationButton
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      buttonType={existing ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      cornerRadius={999}
      accessibilityState={{ disabled: busy, busy }}
      pointerEvents={busy ? 'none' : 'auto'}
      onPress={() => existing ? confirmAppleAccountLoad() : void continueWithApple(false)}
      style={styles.appleButton}
    />
  ) : null;

  useEffect(() => {
    let active = true;
    void getAccountLinkState()
      .then((next) => {
        if (!active) return;
        setAccount(next);
        if ((next.status === 'pending' || next.status === 'linked') && next.email) setEmail(next.email);
      })
      .catch((failure) => {
        if (active) setError(accountLinkErrorMessage(failure));
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (action: () => Promise<AccountLinkState>, success: string, refresh = false) => {
    if (!beginAction()) return;
    try {
      const next = await action();
      if (!mounted.current) return;
      setAccount(next);
      if ((next.status === 'pending' || next.status === 'linked') && next.email) setEmail(next.email);
      if (next.status === 'linked') setShowPassword(true);
      if (refresh) await refreshCloudState();
      if (mounted.current) setMessage(success);
    } catch (failure) {
      if (mounted.current) setError(accountLinkErrorMessage(failure));
    } finally {
      endAction();
    }
  };

  const resend = async () => {
    if (!beginAction()) return;
    try {
      await resendEmailLink(email);
      if (mounted.current) setMessage(t.account.resent);
    } catch (failure) {
      if (mounted.current) setError(accountLinkErrorMessage(failure));
    } finally {
      endAction();
    }
  };

  const confirmExistingAccountLoad = () => {
    if (busyRef.current) return;
    Alert.alert(
      t.account.replaceTitle,
      t.account.replaceText,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.account.replaceAction,
          onPress: () => void run(
            () => loadExistingAccount(email, password),
            t.account.loadedMessage,
          ),
        },
      ],
    );
  };

  if (!account) {
    return (
      <Card style={styles.card}>
        <ActivityIndicator color={colors.accentText} />
        <Text style={styles.loadingText}>{t.account.loading}</Text>
      </Card>
    );
  }

  if (account.status === 'unavailable') {
    return (
      <Card style={styles.card}>
        <AccountHeader icon="cloud-offline-outline" title={t.account.unavailableTitle} />
        <Text style={styles.body}>{t.account.unavailableText}</Text>
      </Card>
    );
  }

  if (account.status === 'disabled') {
    return (
      <Card style={styles.card}>
        <AccountHeader icon="cloud-offline-outline" title={t.account.disabledTitle} />
        <Text style={styles.body}>{t.account.disabledText}</Text>
        <PrimaryButton
          disabled={busy}
          icon="cloud-upload-outline"
          label={busy ? t.account.enablingCloud : t.account.enableCloud}
          onPress={() => void run(enableNewCloudAccount, t.account.enabledMessage, true)}
          variant="secondary"
        />
        <Feedback error={error} message={message} />
      </Card>
    );
  }

  if (account.status === 'linked') {
    return (
      <Card style={[styles.card, styles.linkedCard]}>
        <AccountHeader icon="shield-checkmark" title={t.account.linkedTitle} />
        <Text style={styles.body}>{t.account.linkedText}</Text>
        <View style={styles.emailPill}>
          <Ionicons color={colors.accentText} name={account.email ? 'mail-outline' : 'logo-apple'} size={16} />
          <Text style={styles.emailText}>{account.email ?? t.account.appleId}</Text>
        </View>
        {account.appleLinked && !account.appleTokenPending ? <>
          <Text style={styles.body}>{t.account.appleConnected}</Text>
          {appleAvailable ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void continueWithApple(false)} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>{t.account.appleRecoveryTitle}</Text>
          </Pressable> : null}
        </> : appleAvailable ? <>
          <Text style={styles.body}>{account.appleTokenPending ? t.account.appleTokenRetry : t.account.addAppleText}</Text>
          {appleButton(false)}
        </> : null}
        {account.email ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPassword }} onPress={() => setShowPassword((current) => !current)} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>{showPassword ? t.account.closePassword : t.account.setPassword}</Text>
          <Ionicons color={colors.accentText} name={showPassword ? 'chevron-up' : 'chevron-down'} size={17} />
        </Pressable> : null}
        {showPassword && account.email ? (
          <View style={styles.form}>
            <AccountInput
              autoComplete="new-password"
              onChangeText={setPassword}
              placeholder={t.account.passwordPlaceholder}
              secureTextEntry
              value={password}
            />
            <PrimaryButton
              disabled={busy || password.length < 8}
              icon="key-outline"
              label={busy ? t.common.saving : t.account.savePassword}
              onPress={() => void run(() => setAccountPassword(password), t.account.passwordSaved)}
            />
          </View>
        ) : null}
        <Feedback error={error} message={message} />
      </Card>
    );
  }

  if (mode === 'sign-in') {
    return (
      <Card style={styles.card}>
        <AccountHeader icon="log-in-outline" title={t.account.signInTitle} />
        <Text style={styles.body}>{t.account.signInText}</Text>
        {appleButton(true)}
        {appleAvailable ? <Text style={styles.orText}>{t.account.orEmail}</Text> : null}
        <View style={styles.form}>
          <AccountInput autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder={t.account.email} value={email} />
          <AccountInput autoComplete="current-password" onChangeText={setPassword} placeholder={t.account.password} secureTextEntry value={password} />
          <PrimaryButton
            disabled={busy || !email.trim() || password.length < 8}
            icon="log-in-outline"
            label={busy ? t.account.loadingAccount : t.account.loadAccount}
            onPress={confirmExistingAccountLoad}
          />
        </View>
        <Pressable accessibilityRole="button" onPress={() => { setMode('upgrade'); setError(null); setMessage(null); }} style={styles.centerButton}>
          <Text style={styles.textButtonLabel}>{t.account.backToSecure}</Text>
        </Pressable>
        <Feedback error={error} message={message} />
      </Card>
    );
  }

  if (account.status === 'pending') {
    return (
      <Card style={styles.card}>
        <AccountHeader icon="mail-unread-outline" title={t.account.pendingTitle} />
        <Text style={styles.body}>{t.account.pendingText(account.email)}</Text>
        <View style={styles.form}>
          <AccountInput keyboardType="number-pad" maxLength={8} onChangeText={setCode} placeholder={t.account.codePlaceholder} value={code} />
          <PrimaryButton
            disabled={busy || !/^\d{6,8}$/.test(code)}
            icon="checkmark-circle-outline"
            label={busy ? t.account.checkingCode : t.account.confirmCode}
            onPress={() => void run(() => verifyEmailLink(account.email, code), t.account.emailConfirmed)}
          />
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void resend()} style={styles.centerButton}>
          <Text style={styles.textButtonLabel}>{t.account.resend}</Text>
        </Pressable>
        <Feedback error={error} message={message} />
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <AccountHeader icon="shield-outline" title={t.account.secureTitle} />
      <Text style={styles.body}>{appleAvailable ? t.account.secureTextApple : t.account.secureText}</Text>
      {appleButton(false)}
      {appleAvailable ? <Text style={styles.orText}>{t.account.orEmail}</Text> : null}
      <View style={styles.form}>
        <AccountInput autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder={t.account.email} value={email} />
        <PrimaryButton
          disabled={busy || !email.trim()}
          icon="mail-outline"
          label={busy ? t.account.sendingEmail : t.account.sendEmail}
          onPress={() => void run(() => requestEmailLink(email, userName, language), t.account.checkInbox)}
        />
      </View>
      <Pressable accessibilityRole="button" onPress={() => { setMode('sign-in'); setError(null); setMessage(null); }} style={styles.centerButton}>
        <Text style={styles.textButtonLabel}>{t.account.signInTitle}</Text>
      </Pressable>
      <Feedback error={error} message={message} />
    </Card>
  );
}

function AccountHeader({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <View style={styles.icon}><Ionicons color={colors.onAccent} name={icon} size={22} /></View>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

function AccountInput({
  autoComplete,
  keyboardType = 'default',
  maxLength,
  onChangeText,
  placeholder,
  secureTextEntry,
  value,
}: {
  autoComplete?: 'current-password' | 'email' | 'new-password';
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  maxLength?: number;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  value: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TextInput
      autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
      autoComplete={autoComplete}
      autoCorrect={false}
      accessibilityLabel={placeholder}
      keyboardType={keyboardType}
      maxLength={maxLength}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      secureTextEntry={secureTextEntry}
      style={styles.input}
      value={value}
    />
  );
}

function Feedback({ error, message }: { error: string | null; message: string | null }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!error && !message) return null;
  return (
    <View accessibilityLiveRegion={error ? 'assertive' : 'polite'} style={[styles.feedback, error ? styles.errorFeedback : styles.successFeedback]}>
      <Ionicons color={error ? colors.attentionText : colors.success} name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={17} />
      <Text style={[styles.feedbackText, error ? styles.errorText : styles.successText]}>{error ?? message}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  appleButton: { width: '100%', height: 54 },
  orText: { ...typeScale.footnote, color: colors.muted, fontWeight: '600', textAlign: 'center' },
  card: { gap: 14 },
  linkedCard: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  loadingText: { ...typeScale.caption, color: colors.muted, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 42, height: 42, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  title: { ...typeScale.headline, flex: 1, color: colors.text, fontWeight: '700' },
  body: { ...typeScale.footnote, color: colors.muted },
  form: { gap: 10 },
  input: { minHeight: 52, borderRadius: radii.button, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 15, paddingHorizontal: 15 },
  emailPill: { minHeight: 42, borderRadius: radii.pill, backgroundColor: colors.surface, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emailText: { ...typeScale.caption, flex: 1, color: colors.text, fontWeight: '600' },
  textButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  centerButton: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { ...typeScale.caption, color: colors.accentText, fontWeight: '700' },
  feedback: { borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorFeedback: { backgroundColor: colors.attentionSoft },
  successFeedback: { backgroundColor: colors.accentSoft },
  feedbackText: { ...typeScale.caption, flex: 1 },
  errorText: { color: colors.attentionText },
  successText: { color: colors.success },
});
