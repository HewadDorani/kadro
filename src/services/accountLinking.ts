import { User } from '@supabase/supabase-js';
import type { Language } from '@/i18n';

import { getDictionary } from '@/i18n/active';
import { clearAppleTokenPending, loadAppleReauthentication, loadAppleTokenPending, markAppleTokenPending, runAccountOperation } from '@/services/appleReauthentication';
import type { AppleAccountReference } from '@/services/appleReauthentication';
import {
  ensureSupabaseUser,
  enableCloudSyncAfterDeletion,
  isCloudSyncDisabledAfterDeletion,
  isSupabaseConfigured,
  rememberSupabaseUser,
  supabase,
} from '@/services/supabaseClient';

export type AccountLinkState =
  | { status: 'unavailable' }
  | { status: 'disabled' }
  | { status: 'anonymous'; userId: string }
  | { status: 'pending'; userId: string; email: string }
  | { status: 'linked'; userId: string; email: string | null; appleLinked: boolean; appleTokenPending?: boolean };

export type AppleAccountCredential = { token: string; nonce: string; authorizationCode: string; appleUserId: string };

export function appleReferenceFromUser(user: User | null): AppleAccountReference | null {
  const identity = user?.identities?.find(candidate => candidate.provider === 'apple');
  const appleUserId = identity?.identity_data?.sub ?? identity?.id;
  return user && typeof appleUserId === 'string' && appleUserId ? { userId: user.id, appleUserId } : null;
}

function stateFromUser(user: User | null): AccountLinkState {
  if (!user) return { status: 'unavailable' };
  const appleLinked = user.identities?.some(identity => identity.provider === 'apple') === true;
  // The verified identity is authoritative; Apple may omit the email on later logins.
  if (!user.is_anonymous && (user.email || appleLinked)) {
    return { status: 'linked', userId: user.id, email: user.email ?? null, appleLinked };
  }
  if (user.new_email) return { status: 'pending', userId: user.id, email: user.new_email };
  return { status: 'anonymous', userId: user.id };
}

function requireClient() {
  if (!supabase || !isSupabaseConfigured) throw new Error(getDictionary().errors.cloudNotConfigured);
  return supabase;
}

function normalizeEmail(email: string) {
  // Invariant, not locale-aware: an address is not German text.
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error(getDictionary().errors.invalidEmail);
  return normalized;
}

function assertSameUser(expectedUserId: string, user: User | null) {
  if (!user || user.id !== expectedUserId) {
    throw new Error(getDictionary().errors.linkingLostId);
  }
  rememberSupabaseUser(user);
  return user;
}

async function currentUser() {
  const client = requireClient();
  const sessionUser = await ensureSupabaseUser();
  if (!sessionUser) return null;
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const user = data.user ?? sessionUser;
  rememberSupabaseUser(user);
  return user;
}

export async function getAccountLinkState(): Promise<AccountLinkState> {
  if (!supabase || !isSupabaseConfigured) return { status: 'unavailable' };
  if (await isCloudSyncDisabledAfterDeletion()) return { status: 'disabled' };
  const state = stateFromUser(await currentUser());
  if (state.status === 'linked' && state.appleLinked) {
    return { ...state, appleTokenPending: (await loadAppleTokenPending())?.userId === state.userId };
  }
  return state;
}

/**
 * A fresh install that wants its existing account ("Schon ein Konto?") has no
 * session before setup: consent creates it. An empty guest session lets the
 * normal account switch load the Apple or email account; nothing is stored
 * under the guest.
 */
export async function getAccountLinkStateForSignIn(): Promise<AccountLinkState> {
  const state = await getAccountLinkState();
  if (state.status !== 'unavailable' || !supabase || !isSupabaseConfigured) return state;
  await ensureSupabaseUser();
  return getAccountLinkState();
}

export function enableNewCloudAccount(): Promise<AccountLinkState> {
  return runAccountOperation(() => enableNewCloudAccountUnlocked());
}

async function enableNewCloudAccountUnlocked(): Promise<AccountLinkState> {
  if (!supabase || !isSupabaseConfigured) return { status: 'unavailable' };
  await enableCloudSyncAfterDeletion();
  const user = await ensureSupabaseUser();
  return stateFromUser(user);
}

export function requestEmailLink(email: string, displayName: string, language: Language): Promise<AccountLinkState> {
  return runAccountOperation(() => requestEmailLinkUnlocked(email, displayName, language));
}

async function requestEmailLinkUnlocked(email: string, displayName: string, language: Language): Promise<AccountLinkState> {
  const client = requireClient();
  const user = await currentUser();
  if (!user) throw new Error(getDictionary().errors.sessionNotLoaded);
  if (!user.is_anonymous) return stateFromUser(user);

  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await client.auth.updateUser({
    email: normalizedEmail,
    data: {
      ...user.user_metadata,
      display_name: displayName.trim(),
      kandro_language: language,
    },
  });
  if (error) throw error;
  const updatedUser = assertSameUser(user.id, data.user);
  return { status: 'pending', userId: updatedUser.id, email: updatedUser.new_email ?? normalizedEmail };
}

export async function resendEmailLink(email: string) {
  const client = requireClient();
  const normalizedEmail = normalizeEmail(email);
  const { error } = await client.auth.resend({ type: 'email_change', email: normalizedEmail });
  if (error) throw error;
}

export function verifyEmailLink(email: string, token: string): Promise<AccountLinkState> {
  return runAccountOperation(() => verifyEmailLinkUnlocked(email, token));
}

async function verifyEmailLinkUnlocked(email: string, token: string): Promise<AccountLinkState> {
  const client = requireClient();
  const user = await currentUser();
  if (!user) throw new Error(getDictionary().errors.sessionNotLoaded);
  const normalizedToken = token.replace(/\s/g, '');
  if (!/^\d{6,8}$/.test(normalizedToken)) throw new Error(getDictionary().account.codeInvalid);

  const { data, error } = await client.auth.verifyOtp({
    email: normalizeEmail(email),
    token: normalizedToken,
    type: 'email_change',
  });
  if (error) throw error;
  return stateFromUser(assertSameUser(user.id, data.user));
}

export function refreshEmailLink(): Promise<AccountLinkState> {
  return runAccountOperation(() => refreshEmailLinkUnlocked());
}

async function refreshEmailLinkUnlocked(): Promise<AccountLinkState> {
  const client = requireClient();
  const user = await currentUser();
  if (!user) throw new Error(getDictionary().errors.sessionNotLoaded);
  const { data, error } = await client.auth.refreshSession();
  if (error) throw error;
  return stateFromUser(assertSameUser(user.id, data.user));
}

export function setAccountPassword(password: string): Promise<AccountLinkState> {
  return runAccountOperation(() => setAccountPasswordUnlocked(password));
}

async function setAccountPasswordUnlocked(password: string): Promise<AccountLinkState> {
  const client = requireClient();
  const user = await currentUser();
  if (!user || user.is_anonymous || !user.email) throw new Error(getDictionary().errors.confirmEmailFirst);
  if (password.length < 8) throw new Error(getDictionary().account.passwordInvalid);
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return stateFromUser(assertSameUser(user.id, data.user));
}

export function signInToExistingAccount(email: string, password: string): Promise<AccountLinkState> {
  return runAccountOperation(() => signInToExistingAccountUnlocked(email, password));
}

async function signInToExistingAccountUnlocked(email: string, password: string): Promise<AccountLinkState> {
  const client = requireClient();
  if (password.length < 8) throw new Error(getDictionary().account.passwordInvalid);
  const { data, error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password });
  if (error) throw error;
  if (!data.user || data.user.is_anonymous) throw new Error(getDictionary().errors.permanentAccountNotLoaded);
  rememberSupabaseUser(data.user);
  return stateFromUser(data.user);
}

/** Native Sign in with Apple. The nonce is hashed for Apple, raw for Supabase. */
export async function appleCredential() {
  const [Apple, Crypto] = await Promise.all([import('expo-apple-authentication'), import('expo-crypto')]);
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const credential = await Apple.signInAsync({
    requestedScopes: [Apple.AppleAuthenticationScope.EMAIL],
    nonce: hashedNonce,
  });
  if (!credential.identityToken || !credential.authorizationCode || !credential.user) throw new Error(getDictionary().errors.linkingFailed);
  // This fresh, single-use code is sent directly to our authenticated backend.
  // It is never written to storage, telemetry or the account state.
  return { token: credential.identityToken, nonce: rawNonce, authorizationCode: credential.authorizationCode, appleUserId: credential.user };
}

export function isAppleCancel(error: unknown) {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === 'ERR_REQUEST_CANCELED';
}

export function isAppleIdentityTaken(error: unknown) {
  if (error && typeof error === 'object' && (error as { code?: string }).code === 'identity_already_exists') return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('identity') && (message.includes('already') || message.includes('exists'));
}

async function storeAppleAccountToken(user: User, credential: AppleAccountCredential) {
  const reference = appleReferenceFromUser(user);
  if (!reference || reference.appleUserId !== credential.appleUserId) throw new Error(getDictionary().account.appleRecoveryWrong);
  try {
    await markAppleTokenPending(reference);
    const { data, error } = await requireClient().functions.invoke('apple-account-token', {
      body: { authorizationCode: credential.authorizationCode, nonce: credential.nonce },
    });
    if (error || data?.stored !== true) throw new Error('Apple token storage incomplete');
    await clearAppleTokenPending(user.id);
  } catch {
    // Transport errors can contain request details. Display only fixed copy.
    throw new Error(getDictionary().account.appleTokenRetry);
  }
}

/** Adds Apple to the current guest or email account without changing its ID. */
export function linkAppleAccount(credential: AppleAccountCredential): Promise<AccountLinkState> {
  return runAccountOperation(() => linkAppleAccountUnlocked(credential));
}

async function linkAppleAccountUnlocked(credential: AppleAccountCredential): Promise<AccountLinkState> {
  const client = requireClient();
  const user = await currentUser();
  if (!user) throw new Error(getDictionary().errors.sessionNotLoaded);
  const current = stateFromUser(user);
  if (current.status === 'linked' && current.appleLinked) {
    await storeAppleAccountToken(user, credential);
    return current;
  }
  const { data, error } = await client.auth.linkIdentity({ provider: 'apple', token: credential.token, nonce: credential.nonce });
  if (error) {
    // Another completed attempt may already have linked this same account.
    // Do not offer a destructive account switch for an identity we now own.
    if (isAppleIdentityTaken(error)) {
      const refreshed = await client.auth.getUser();
      if (!refreshed.error && refreshed.data.user?.id === user.id) {
        const latest = stateFromUser(assertSameUser(user.id, refreshed.data.user));
        if (latest.status === 'linked' && latest.appleLinked) {
          await storeAppleAccountToken(refreshed.data.user, credential);
          return latest;
        }
      }
    }
    throw error;
  }
  assertSameUser(user.id, data.user);
  // Native ID-token linking can return the pre-link identities list even
  // after the identity was committed. Read it back from Auth before deciding
  // whether linking failed or exchanging Apple's single-use authorization code.
  // Keep recovery available if this read is interrupted after the successful link.
  try {
    await markAppleTokenPending({ userId: user.id, appleUserId: credential.appleUserId });
  } catch {
    throw new Error(getDictionary().account.appleTokenRetry);
  }
  const verified = await client.auth.getUser();
  if (verified.error || !verified.data.user) throw new Error(getDictionary().account.appleTokenRetry);
  const linkedUser = assertSameUser(user.id, verified.data.user);
  const linked = stateFromUser(linkedUser);
  if (linked.status !== 'linked' || !linked.appleLinked) throw new Error(getDictionary().errors.linkingFailed);
  await storeAppleAccountToken(linkedUser, credential);
  return linked;
}

/** Loads an existing Apple-linked account (new phone). Caller handles the switch. */
export function signInWithApple(credential: AppleAccountCredential): Promise<AccountLinkState> {
  return runAccountOperation(() => signInWithAppleUnlocked(credential));
}

async function signInWithAppleUnlocked(credential: AppleAccountCredential): Promise<AccountLinkState> {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithIdToken({ provider: 'apple', token: credential.token, nonce: credential.nonce });
  if (error) throw error;
  if (!data.user || data.user.is_anonymous) throw new Error(getDictionary().errors.permanentAccountNotLoaded);
  rememberSupabaseUser(data.user);
  await storeAppleAccountToken(data.user, credential);
  return stateFromUser(data.user);
}

/** Re-authenticate only the identity whose local data is held behind recovery. */
export function recoverAppleSession(credential: AppleAccountCredential): Promise<AccountLinkState> {
  return runAccountOperation(() => recoverAppleSessionUnlocked(credential));
}

async function recoverAppleSessionUnlocked(credential: AppleAccountCredential): Promise<AccountLinkState> {
  const expected = await loadAppleReauthentication() ?? await loadAppleTokenPending();
  if (!expected || credential.appleUserId !== expected.appleUserId) throw new Error(getDictionary().account.appleRecoveryWrong);
  const client = requireClient();
  const { data, error } = await client.auth.signInWithIdToken({ provider: 'apple', token: credential.token, nonce: credential.nonce });
  if (error) throw new Error(getDictionary().account.appleRecoveryError);
  if (!data.user || data.user.id !== expected.userId || data.user.is_anonymous || appleReferenceFromUser(data.user)?.appleUserId !== expected.appleUserId) {
    rememberSupabaseUser(null);
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    throw new Error(getDictionary().account.appleRecoveryWrong);
  }
  await storeAppleAccountToken(data.user, credential);
  rememberSupabaseUser(data.user);
  return stateFromUser(data.user);
}

export function accountLinkErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && (error as { code?: string }).code === 'account_operation_stale') return getDictionary().errors.linkingFailed;
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLocaleLowerCase('en-US');
  if (normalized.includes('manual linking')) return getDictionary().errors.linkingNotEnabled;
  if (normalized.includes('already') || normalized.includes('registered')) return getDictionary().errors.emailAlreadyUsed;
  if (normalized.includes('rate') || normalized.includes('seconds')) return getDictionary().errors.tooManyEmails;
  if (normalized.includes('invalid login')) return getDictionary().errors.wrongCredentials;
  if (normalized.includes('token') || normalized.includes('otp')) return getDictionary().errors.codeExpired;
  return message || getDictionary().errors.linkingFailed;
}
