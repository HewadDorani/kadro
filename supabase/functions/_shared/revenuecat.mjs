const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

export const REVENUECAT_ENTITLEMENT_LOOKUP_KEY = 'kandro_pro';
const UNCERTAIN_ACCESS_RECHECK_MS = 15 * 60 * 1000;

export function isAnalysisRequestId(value) {
  return typeof value === 'string' && UUID.test(value);
}

function constantTimeTextEqual(left, right) {
  const a = encoder.encode(String(left ?? ''));
  const b = encoder.encode(String(right ?? ''));
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function hexToBytes(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * RevenueCat signs exactly `${timestamp}.` followed by the raw body bytes.
 * Verify those bytes before UTF-8 decoding/JSON parsing; re-serialising the
 * JSON changes the signature.
 */
export async function verifyRevenueCatWebhook({
  rawBody,
  authorization,
  signature,
  expectedAuthorization,
  signingSecret,
  nowMs = Date.now(),
  toleranceSeconds = 300,
}) {
  if (!expectedAuthorization || !signingSecret) return { ok: false, code: 'webhook_not_configured' };
  if (!constantTimeTextEqual(authorization, expectedAuthorization)) return { ok: false, code: 'authorization_invalid' };

  const parts = Object.fromEntries(String(signature ?? '').split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator > 0 ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()] : ['', ''];
  }));
  const timestamp = parts.t;
  const received = parts.v1;
  if (!/^\d{10}$/.test(timestamp ?? '') || !/^[0-9a-f]{64}$/i.test(received ?? '')) {
    return { ok: false, code: 'signature_invalid' };
  }
  if (Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) > toleranceSeconds) {
    return { ok: false, code: 'signature_stale' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const prefix = encoder.encode(`${timestamp}.`);
  const body = rawBody instanceof Uint8Array ? rawBody : encoder.encode(String(rawBody ?? ''));
  const signedPayload = new Uint8Array(prefix.byteLength + body.byteLength);
  signedPayload.set(prefix, 0);
  signedPayload.set(body, prefix.byteLength);
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    hexToBytes(received),
    signedPayload,
  );
  return verified
    ? { ok: true }
    : { ok: false, code: 'signature_invalid' };
}

const MAX_EVENT_USER_IDS = 8;

function uuidValues(values) {
  return values
    .filter(isAnalysisRequestId)
    .map((value) => value.toLowerCase());
}

function eventUserIds(event, transfer) {
  const common = uuidValues([
    event?.app_user_id,
    event?.original_app_user_id,
    ...(Array.isArray(event?.aliases) ? event.aliases : []),
  ]);
  const transferredFrom = transfer
    ? uuidValues(Array.isArray(event?.transferred_from) ? event.transferred_from : [])
    : [];
  const transferredTo = transfer
    ? uuidValues(Array.isArray(event?.transferred_to) ? event.transferred_to : [])
    : [];
  return [...new Set([...transferredFrom, ...transferredTo, ...common])];
}

const PERIOD_TYPES = new Set(['TRIAL', 'INTRO', 'NORMAL', 'PROMOTIONAL', 'PREPAID']);
const CANCEL_REASONS = new Set(['UNSUBSCRIBE', 'BILLING_ERROR', 'DEVELOPER_INITIATED', 'PRICE_INCREASE', 'CUSTOMER_SUPPORT', 'UNKNOWN']);

/**
 * Measurement only: unknown values become null, so a new RevenueCat term can
 * never fail a webhook. Access is still decided by the REST lookup alone.
 */
export function revenueCatEventFacts(event) {
  const productId = typeof event?.product_id === 'string' ? event.product_id.trim() : '';
  return {
    periodType: PERIOD_TYPES.has(event?.period_type) ? event.period_type : null,
    productId: productId && productId.length <= 120 ? productId : null,
    cancelReason: CANCEL_REASONS.has(event?.cancel_reason) ? event.cancel_reason : null,
  };
}

/** Validate only stable, security-relevant webhook fields. */
export function validateRevenueCatEvent(payload, expectedAppId) {
  if (!payload || payload.api_version !== '1.0' || !payload.event || typeof payload.event !== 'object') {
    return { ok: false, code: 'event_invalid' };
  }
  const event = payload.event;
  if (event.app_id !== expectedAppId) return { ok: false, code: 'app_invalid' };

  const eventType = typeof event.type === 'string' ? event.type.trim() : '';
  const transfer = eventType === 'TRANSFER';

  const eventId = typeof event.id === 'string' ? event.id.trim() : '';
  // RevenueCat documents environment as optional for TRANSFER. It is audit
  // metadata only; access is decided by the project-scoped REST lookup.
  const environment = ['SANDBOX', 'PRODUCTION'].includes(event.environment)
    ? event.environment
    : transfer
      ? 'UNKNOWN'
      : null;
  const eventTimestampMs = Number(event.event_timestamp_ms);
  const userIds = eventUserIds(event, transfer);
  if (
    !eventId || eventId.length > 255
    || !eventType || eventType.length > 80
    || !environment
    || !Number.isSafeInteger(eventTimestampMs) || eventTimestampMs <= 0
    || (transfer && (!Array.isArray(event.transferred_from) || !Array.isArray(event.transferred_to)))
    || userIds.length < 1 || userIds.length > MAX_EVENT_USER_IDS
  ) {
    return { ok: false, code: 'event_invalid' };
  }
  // A TRANSFER has no entitlement_ids. It can remove Pro from one customer and
  // add it to another, so every Kandro UUID on both sides must be refreshed.
  // Validate the common envelope above before acknowledging other-product
  // events; malformed signed input must never bypass the contract checks.
  const entitlements = Array.isArray(event.entitlement_ids) ? event.entitlement_ids : [];
  if (!transfer && !entitlements.includes(REVENUECAT_ENTITLEMENT_LOOKUP_KEY)) {
    return { ok: true, relevant: false };
  }
  if (!transfer && event.store !== 'APP_STORE') {
    return { ok: true, relevant: false };
  }
  return {
    ok: true,
    relevant: true,
    event: { eventId, eventType, environment, eventTimestampMs, userIds, ...revenueCatEventFacts(event) },
  };
}

/**
 * An active entitlement alone is not enough: RevenueCat Test Store purchases
 * can grant it too. Access requires an Apple App Store subscription whose app,
 * product and entitlement resource ids match the server allowlist. Apple
 * sandbox remains valid because TestFlight and App Review use it; requiring
 * store=app_store keeps RevenueCat's own Test Store out.
 */
export function activeIosSubscriptionFromV2(payload, {
  entitlementResourceId,
  iosAppId,
  productResourceIds,
  nowMs = Date.now(),
}) {
  if (
    !payload || payload.object !== 'list' || !Array.isArray(payload.items)
    || !entitlementResourceId || !iosAppId
    || !Array.isArray(productResourceIds) || productResourceIds.length < 1
  ) {
    throw new Error('revenuecat_response_invalid');
  }
  const allowedProducts = new Set(productResourceIds);
  const candidates = payload.items.flatMap((item) => {
    if (
      !['production', 'sandbox'].includes(item?.environment)
      || item?.store !== 'app_store'
      || item?.gives_access !== true
      || !allowedProducts.has(item?.product_id)
    ) return [];

    const entitlement = item?.entitlements?.items?.find((entry) => (
      entry?.id === entitlementResourceId && entry?.state === 'active'
    ));
    if (!entitlement) return [];
    // Customer/subscriptions returns unexpanded entitlement resources: the
    // nested `products` list shown in the API's fully expanded schema is not
    // sent in actual responses. The exact RevenueCat product resource IDs
    // above are server-configured for this iOS app, not device-supplied store
    // names. Together with APP_STORE and the entitlement ID they establish
    // access without another provider call. Never require the optional list.
    // If expansion is present, reject contradictory product/app metadata.
    if (entitlement.products !== undefined) {
      const product = entitlement.products?.items?.find((entry) => (
        entry?.id === item.product_id
        && entry?.app_id === iosAppId
        && entry?.state === 'active'
      ));
      if (!product) return [];
    }

    const futureExpiries = [item.current_period_ends_at, item.ends_at]
      .filter((value) => value != null)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > nowMs);
    let expiresAtMs = futureExpiries.length > 0 ? Math.max(...futureExpiries) : null;
    if (expiresAtMs === null) {
      // RevenueCat documents gives_access as the authoritative access decision
      // and may add status values. If access survives the visible period (for
      // example grace or an unknown/new state), cache it only briefly rather
      // than turning a future status into a false denial.
      expiresAtMs = nowMs + UNCERTAIN_ACCESS_RECHECK_MS;
    }
    return [{ expiresAtMs }];
  });
  const active = candidates.sort(
    (left, right) => (right.expiresAtMs ?? Number.MAX_SAFE_INTEGER) - (left.expiresAtMs ?? Number.MAX_SAFE_INTEGER),
  )[0];
  return active
    ? { active: true, expiresAt: active.expiresAtMs === null ? null : new Date(active.expiresAtMs).toISOString() }
    : { active: false, expiresAt: null };
}

export async function fetchRevenueCatEntitlement({
  projectId,
  userId,
  entitlementResourceId,
  iosAppId,
  productResourceIds,
  secretApiKey,
  claimRequest,
  fetchImpl = fetch,
  timeoutMs = 5000,
}) {
  if (
    !projectId || !entitlementResourceId || !iosAppId || !secretApiKey
    || !Array.isArray(productResourceIds) || productResourceIds.length < 1
    || !isAnalysisRequestId(userId)
    || typeof claimRequest !== 'function'
  ) {
    throw new Error('revenuecat_not_configured');
  }
  // Keep the claim inside the provider helper and immediately adjacent to the
  // fetch. A new caller therefore cannot accidentally bypass the project-wide
  // RevenueCat circuit breaker. Claim errors deliberately keep their type.
  await claimRequest();
  let response;
  try {
    response = await fetchImpl(
      `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(userId)}/subscriptions?limit=100`,
      {
        headers: { Authorization: `Bearer ${secretApiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch {
    throw new Error('revenuecat_unavailable');
  }
  // A customer who never purchased may not exist in RevenueCat yet. That is a
  // definitive inactive result, not a provider outage and not a reason to
  // grant access.
  if (response.status === 404) return { active: false, expiresAt: null };
  if (!response.ok) throw new Error(`revenuecat_http_${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('revenuecat_response_invalid');
  }
  // Refuse an unexpectedly paginated response instead of treating an unseen
  // page as active or inactive. Ordinary subscription histories fit in 100;
  // an exceptional account can be handled explicitly without weakening the
  // App Store/app/product/entitlement decision.
  if (payload?.next_page) throw new Error('revenuecat_response_invalid');
  return activeIosSubscriptionFromV2(payload, {
    entitlementResourceId,
    iosAppId,
    productResourceIds,
  });
}
