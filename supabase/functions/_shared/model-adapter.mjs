import { detectionSchema, validateDetection } from './detection.mjs';

export const GEMINI_MODEL = 'google/gemini-3.8-flash';
export const GEMINI_ROUTE = 'google-vertex/global';
export const GEMINI_CONSENT_VERSION = '2026-10-01-gemini-candidate-v1';
// Deliberately false until route terms, account ZDR and the A/B/C comparison
// are evidenced. Neither a model env var nor a client build enables this path.
export const GEMINI_RELEASE_APPROVED = false;

/**
 * The premium photo model (owner decision 08.11.2026 after an 11-photo
 * comparison): Claude Sonnet 5.5 on Amazon Bedrock only, ZDR, no data
 * collection, no provider fallback. Photos only; a failure retries on the
 * disclosed Azure model.
 */
export const CLAUDE_VISION_MODEL = 'anthropic/claude-sonnet-5.5';
export const CLAUDE_ROUTE = 'amazon-bedrock';

/**
 * OpenAI models that OpenRouter serves from Azure. Only these may run on the
 * disclosed path (Azure only, ZDR, no data collection, no provider fallback),
 * so a misconfigured secret can never route meal photos somewhere else.
 */
export const AZURE_OPENAI_MODELS = Object.freeze(['openai/gpt-4.1-mini', 'openai/gpt-4.1-nano', 'openai/gpt-4o-mini']);
const DIRECT_OPENAI_MODELS = Object.freeze(['gpt-4.1-mini']);

/**
 * Twelve items at roughly 110 tokens each plus the envelope stay below 1,400
 * tokens. The cap only bounds a runaway answer; a truncated one is retried.
 */
export const DETECTION_MAX_OUTPUT_TOKENS = 1500;

export class ModelError extends Error {
  constructor(code, status = 502, retryAfter = undefined) {
    super(code); this.code=code; this.status=status; this.retryAfter=retryAfter;
  }
}

/**
 * The optional VISION_FALLBACK_MODEL secret. Anything outside the Azure list
 * (Gemini included) is ignored rather than trusted: unset or invalid both mean
 * "retry on the primary model".
 */
export function resolveFallbackModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return AZURE_OPENAI_MODELS.includes(model) ? model : null;
}

export function modelRequest({content, model='openai/gpt-4.1-mini', provider='openrouter', reasoning='low', schema=detectionSchema, name='kandro_meal_detection', maxOutputTokens=DETECTION_MAX_OUTPUT_TOKENS}) {
  const gemini=model===GEMINI_MODEL;
  const claude=model===CLAUDE_VISION_MODEL;
  if (!['openrouter','openai'].includes(provider) || ((gemini||claude) && provider!=='openrouter')) throw new ModelError('ai_provider_invalid',503);
  if (gemini && !['low','medium'].includes(reasoning)) throw new ModelError('ai_provider_invalid',503);
  if (!gemini && !claude && !(provider==='openrouter' ? AZURE_OPENAI_MODELS : DIRECT_OPENAI_MODELS).includes(model)) throw new ModelError('ai_provider_invalid',503);
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens<256 || maxOutputTokens>4000) throw new ModelError('ai_provider_invalid',503);
  const policy={data_collection:'deny',only:[gemini?GEMINI_ROUTE:claude?CLAUDE_ROUTE:'azure'],allow_fallbacks:false,zdr:true,...(gemini?{require_parameters:true}:{})};
  // The long instruction text is identical for every photo; marking it lets
  // the provider cache it, so only the image and the answer are paid in full.
  if (claude) return {
    url:'https://openrouter.ai/api/v1/chat/completions',
    body:{model,max_tokens:Math.max(maxOutputTokens,2500),provider:policy,
      messages:[{role:'user',content:content.map((part,index)=>part.type==='input_image'
        ? {type:'image_url',image_url:{url:part.image_url}}
        : {type:'text',text:part.text,...(index===0?{cache_control:{type:'ephemeral'}}:{})})}],
      response_format:{type:'json_schema',json_schema:{name,strict:true,schema}}},
  };
  if (gemini) return {
    url:'https://openrouter.ai/api/v1/chat/completions',
    body:{model,store:false,max_tokens:8192,reasoning:{effort:reasoning,exclude:true},provider:policy,
      messages:[{role:'user',content:content.map(part=>part.type==='input_image'
        ? {type:'image_url',image_url:{url:part.image_url}} : {type:'text',text:part.text})}],
      response_format:{type:'json_schema',json_schema:{name,strict:true,schema}}},
  };
  return {url:provider==='openrouter'?'https://openrouter.ai/api/v1/responses':'https://api.openai.com/v1/responses',
    body:{model,store:false,max_output_tokens:maxOutputTokens,...(provider==='openrouter'?{provider:policy}:{}),
      input:[{role:'user',content}],text:{format:{type:'json_schema',name,strict:true,schema}}}};
}

/** Index just past the balanced JSON object or array starting at `start`, or -1. */
function balancedEnd(text, start) {
  const stack=[];let inString=false,escaped=false;
  for (let i=start;i<text.length;i++) {
    const c=text[i];
    if (inString) { if (escaped) escaped=false; else if (c==='\\') escaped=true; else if (c==='"') inString=false; continue; }
    if (c==='"') inString=true;
    else if (c==='{'||c==='[') stack.push(c==='{'?'}':']');
    else if (c==='}'||c===']') { if (stack.pop()!==c) return -1; if (!stack.length) return i+1; }
  }
  return -1;
}

/** Drops a comma directly before } or ], outside strings only. */
function withoutTrailingCommas(text) {
  let out='',inString=false,escaped=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (inString) { out+=c; if (escaped) escaped=false; else if (c==='\\') escaped=true; else if (c==='"') inString=false; continue; }
    if (c==='"') { inString=true; out+=c; continue; }
    if (c===',') { let j=i+1; while (j<text.length && /\s/.test(text[j])) j++; if (text[j]==='}'||text[j]===']') continue; }
    out+=c;
  }
  return out;
}

/**
 * Structured output occasionally arrives wrapped in a Markdown fence, followed
 * by a sentence, or with a trailing comma. Those are framing slips, not a
 * different answer, so they are repaired here. Anything else (missing braces,
 * truncated values, wrong fields) still fails: the schema validator decides
 * what the content may be, and this function never invents a value.
 */
export function parseModelJson(text) {
  if (typeof text!=='string') throw new ModelError('provider_response_invalid');
  const trimmed=text.replace(/^﻿/,'').trim();
  try { return JSON.parse(trimmed); } catch { /* fall through to framing repair */ }
  const fenced=trimmed.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```/);
  const body=fenced ? fenced[1].trim() : trimmed;
  const start=body.search(/[{[]/);
  if (start<0 || start>200) throw new ModelError('provider_response_invalid');
  const end=balancedEnd(body,start);
  if (end<0) throw new ModelError('provider_response_invalid');
  const candidate=body.slice(start,end);
  for (const attempt of [candidate, withoutTrailingCommas(candidate)]) {
    try { return JSON.parse(attempt); } catch { /* try the next repair */ }
  }
  throw new ModelError('provider_response_invalid');
}

export function parseStructuredResponse(payload, gemini=false) {
  let text;
  if (!payload || typeof payload!=='object' || payload.error) throw new ModelError('provider_response_invalid');
  if (gemini) {
    const choice=payload.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason==='content_filter') throw new ModelError('model_refused',422);
    if (choice?.finish_reason==='length') throw new ModelError('model_truncated');
    if (choice?.finish_reason!=='stop' || payload.choices.length!==1) throw new ModelError('provider_response_invalid');
    text=choice.message?.content;
  } else {
    if (payload.status==='incomplete' || payload.incomplete_details) throw new ModelError('model_truncated');
    if (payload.status && payload.status!=='completed') throw new ModelError('provider_response_invalid');
    const parts=(Array.isArray(payload.output)?payload.output:[]).flatMap(row=>Array.isArray(row.content)?row.content:[]);
    if (parts.some(part=>part.type==='refusal')) throw new ModelError('model_refused',422);
    text=payload.output_text ?? parts.filter(part=>part.type==='output_text').map(part=>part.text).join('');
  }
  if (typeof text!=='string' || !text.trim() || text.length>100_000) throw new ModelError('provider_response_invalid');
  return parseModelJson(text);
}

/** One request, bounded through body consumption; no automatic provider retry. */
export async function requestStructured({apiKey, fetchImpl=fetch, signal, timeoutMs=45_000, validate=validateDetection, routeAuthorized=false, ...options}) {
  if (!apiKey) throw new ModelError('ai_key_missing',503);
  if (options.model===GEMINI_MODEL && !routeAuthorized) throw new ModelError('ai_route_not_approved',503);
  const request=modelRequest(options);
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  if (signal?.aborted) controller.abort();
  let timer;
  try {
    return await Promise.race([
      (async()=>{
        const response=await fetchImpl(request.url,{method:'POST',signal:controller.signal,
          headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','X-Title':'Kandro'},body:JSON.stringify(request.body)});
        if (!response.ok) throw new ModelError(response.status===429?'provider_rate_limited':'provider_error',response.status===429?429:502,response.headers?.get('retry-after'));
        let payload; try { payload=await response.json(); } catch { throw new ModelError('provider_response_invalid'); }
        try { return validate(parseStructuredResponse(payload,options.model===GEMINI_MODEL||options.model===CLAUDE_VISION_MODEL)); }
        catch (error) { if (error instanceof ModelError) throw error; throw new ModelError('provider_response_invalid'); }
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ModelError('provider_timeout',504));},timeoutMs);}),
    ]);
  } catch(error) {
    if(error instanceof ModelError)throw error;
    if(controller.signal.aborted)throw new ModelError('provider_timeout',504);
    throw new ModelError('provider_error');
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

/**
 * Transient failures worth one more attempt. A refusal, a missing key or a
 * blocked route would fail the same way again and is never retried. A 429 is
 * retried only on a different model: the same Azure deployment would answer
 * with the same limit.
 */
export function isRetryableModelError(error, differentModel = false) {
  if (!(error instanceof ModelError)) return false;
  if (error.code==='provider_rate_limited') return differentModel;
  return ['provider_timeout','provider_error','provider_response_invalid','model_truncated'].includes(error.code);
}

/** A retry with less time than this cannot return a useful answer. */
const MIN_RETRY_MS = 4000;

/**
 * At most two attempts inside ONE paid analysis request. The caller has
 * already reserved and charged the user's allowance once; this function never
 * touches it. `beforeRetry` must claim the service-wide cost breaker for the
 * extra provider call and return false to skip the retry.
 *
 * `onAttempt` receives fixed codes and durations only (never content).
 */
export async function requestStructuredWithRetry({primary, retry, beforeRetry=async()=>true, onAttempt=()=>{}, signal, now=Date.now, deadline}) {
  const run=async(options,attempt)=>{
    const started=now();
    try {
      const value=await requestStructured({...options,signal});
      onAttempt({attempt,model:options.model,outcome:'ok',ms:now()-started});
      return value;
    } catch (error) {
      onAttempt({attempt,model:options.model,outcome:error instanceof ModelError?error.code:'provider_error',ms:now()-started});
      throw error;
    }
  };
  try {
    return await run(primary,1);
  } catch (error) {
    if (!retry || signal?.aborted || !isRetryableModelError(error, retry.model!==primary.model)) throw error;
    const remaining=deadline===undefined ? Infinity : deadline-now();
    // Too little time left for a useful second answer: report the first error.
    if (!(remaining>=MIN_RETRY_MS)) throw error;
    // A failing breaker check counts as "no capacity": report the first error.
    if (!await Promise.resolve().then(()=>beforeRetry(error)).catch(()=>false)) throw error;
    return run({...retry,timeoutMs:Math.min(retry.timeoutMs ?? 45_000,remaining)},2);
  }
}
