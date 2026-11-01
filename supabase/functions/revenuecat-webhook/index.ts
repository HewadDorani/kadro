import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

import {
  fetchRevenueCatEntitlement,
  validateRevenueCatEvent,
  verifyRevenueCatWebhook,
} from '../_shared/revenuecat.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const projectId = Deno.env.get('REVENUECAT_PROJECT_ID') ?? '';
const appId = Deno.env.get('REVENUECAT_APP_ID') ?? '';
const entitlementResourceId = Deno.env.get('REVENUECAT_ENTITLEMENT_RESOURCE_ID') ?? '';
const iosProductResourceIds = (Deno.env.get('REVENUECAT_IOS_PRODUCT_RESOURCE_IDS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const secretApiKey = Deno.env.get('REVENUECAT_SECRET_API_KEY') ?? '';
const webhookAuthorization = Deno.env.get('REVENUECAT_WEBHOOK_AUTHORIZATION') ?? '';
const webhookSignatureSecret = Deno.env.get('REVENUECAT_WEBHOOK_SIGNATURE_SECRET') ?? '';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

function configured() {
  return Boolean(
    projectId
    && appId
    && entitlementResourceId
    && iosProductResourceIds.length > 0
    && secretApiKey
    && webhookAuthorization
    && webhookSignatureSecret,
  );
}

function safeFailureCode(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return /^revenuecat_(?:not_configured|unavailable|response_invalid|rate_limited|database_unavailable|http_\d{3})$/.test(code)
    ? code
    : 'revenuecat_webhook_unexpected';
}

async function reserveRevenueCatProviderRequests(requestUnits: number) {
  const { data, error } = await admin.rpc('consume_revenuecat_provider_quota', {
    p_user_id: null,
    p_network_hash: null,
    p_request_units: requestUnits,
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error('revenuecat_database_unavailable');
  }
  if (data.status === 'rate_limited') throw new Error('revenuecat_rate_limited');
  if (data.status !== 'allowed') throw new Error('revenuecat_database_unavailable');
}

async function readBodyLimited(request: Request) {
  if (!request.body) return { bytes: new Uint8Array(), text: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return null;
  }
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ code: 'method_not_allowed' }, 405);
  if (!configured()) return json({ code: 'server_not_configured' }, 503);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ code: 'payload_too_large' }, 413);
  }

  const body = await readBodyLimited(request);
  if (!body) return json({ code: 'payload_too_large' }, 413);
  const verification = await verifyRevenueCatWebhook({
    rawBody: body.bytes,
    authorization: request.headers.get('authorization') ?? '',
    signature: request.headers.get('x-revenuecat-webhook-signature') ?? '',
    expectedAuthorization: webhookAuthorization,
    signingSecret: webhookSignatureSecret,
  });
  if (!verification.ok) return json({ code: verification.code }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return json({ code: 'event_invalid' }, 400);
  }
  const validated = validateRevenueCatEvent(payload, appId);
  if (!validated.ok) return json({ code: validated.code }, 400);
  if (!validated.relevant) return json({ status: 'ignored' });

  // The signed event is a trigger, not the source of truth. Querying the
  // project-scoped v2 endpoint makes duplicate/out-of-order expiration,
  // renewal and refund events converge on RevenueCat's current state.
  // Capture the observation time before the network call. SQL refuses to
  // overwrite an entitlement observation that completed more recently.
  const checkedAt = new Date().toISOString();
  // TRANSFER can affect every UUID in transferred_from/transferred_to plus the
  // common original/alias fields. Resolve every current state before making a
  // database change, so an upstream failure cannot apply only half a transfer.
  // Reserve all project-wide RevenueCat request units in one SQL transaction.
  // If fewer than N units remain, no alias fetch starts and the webhook retry
  // cannot amplify a partly completed provider batch.
  await reserveRevenueCatProviderRequests(validated.event.userIds.length);
  let reservedRequestTickets = validated.event.userIds.length;
  const claimReservedRequest = async () => {
    if (reservedRequestTickets < 1) throw new Error('revenuecat_rate_limited');
    reservedRequestTickets -= 1;
  };
  const observations = await Promise.all(validated.event.userIds.map(async (userId) => ({
    userId,
    entitlement: await fetchRevenueCatEntitlement({
      projectId,
      userId,
      entitlementResourceId,
      iosAppId: appId,
      productResourceIds: iosProductResourceIds,
      secretApiKey,
      claimRequest: claimReservedRequest,
    }),
  })));
  // One batch RPC is one PostgreSQL transaction. Dedupe rows and entitlement
  // state for every alias/TRANSFER side therefore commit together or all roll
  // back; a database failure cannot leave a half-applied ownership transfer.
  const { data: applied, error } = await admin.rpc('apply_revenuecat_entitlement_batch', {
    p_event_id: validated.event.eventId,
    p_event_type: validated.event.eventType,
    p_environment: validated.event.environment,
    p_event_timestamp_ms: validated.event.eventTimestampMs,
    p_user_ids: observations.map((observation) => observation.userId),
    p_active: observations.map((observation) => observation.entitlement.active),
    p_expires_at: observations.map((observation) => observation.entitlement.expiresAt),
    p_checked_at: checkedAt,
  });
  if (error || !['applied', 'duplicate', 'stale', 'ignored_user'].includes(applied?.status)) {
    throw new Error('revenuecat_database_unavailable');
  }
  // Why a trial ended is measurement: a failure here must not cost the event.
  const { error: factsError } = await admin.from('revenuecat_webhook_events').update({
    period_type: validated.event.periodType,
    product_id: validated.event.productId,
    cancel_reason: validated.event.cancelReason,
  }).eq('event_id', validated.event.eventId);
  if (factsError) console.error('revenuecat webhook failure', 'revenuecat_facts_not_saved');
  return json({ status: applied.status });
}

export default {
  fetch(request: Request) {
    return handle(request).catch((error: unknown) => {
      // Never log the body, customer UUID, Authorization header or signature.
      console.error('revenuecat webhook failure', safeFailureCode(error));
      return json({ code: 'temporarily_unavailable' }, 503);
    });
  },
};
