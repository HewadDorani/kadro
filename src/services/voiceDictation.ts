/**
 * Dictation state for the describe sheet's microphone, kept free of React and
 * of the native module so it can be validated with a mocked recognizer
 * (scripts/validate-voice-input.mjs).
 *
 * Listeners are registered with `native.addListener(...)`, called as a method
 * of the native module. The package's `addSpeechRecognitionListener` export is
 * the same function detached from the module: called on the package exports,
 * the native EventEmitter registered the listeners on the wrong object, so no
 * result, end or error ever arrived (TestFlight build 47: speaking entered
 * nothing).
 */

export type VoiceErrorKind = 'denied' | 'unavailable' | 'network' | 'noSpeech' | 'generic';

export type VoiceResultEvent = { isFinal?: boolean; results?: { transcript?: string }[] };
export type VoiceErrorEvent = { error?: string; message?: string };

export interface VoiceSubscription { remove(): void }

/** The subset of ExpoSpeechRecognitionModule the dictation uses. */
export interface VoiceNative {
  addListener(eventName: 'result' | 'end' | 'error' | 'start', listener: (event: never) => void): VoiceSubscription;
  start(options: object): void;
  stop(): void;
  abort(): void;
}

export type VoiceHandlers = {
  /** The full field text: what was there before plus everything dictated. */
  onText: (text: string) => void;
  onListening: (listening: boolean) => void;
  onError: (kind: VoiceErrorKind) => void;
};

export type Dictation = {
  /** Starts a session that appends to `base`. Returns false if it could not start. */
  start: (base: string, options: object) => boolean;
  /** Asks iOS to finish. Results keep being applied until "end" (or the abort fallback). */
  stop: () => void;
  /** Called by the stop timer. Aborts only if iOS has not reported "end"; the last transcript stays. */
  abortFallback: () => void;
  dispose: () => void;
};

export const VOICE_TEXT_LIMIT = 500;
/** How long a stopped session may still deliver its last words before it is aborted. */
export const VOICE_STOP_GRACE_MS = 1500;

/** Joins text pieces with exactly one space between them. */
export function joinSpeech(...parts: string[]) {
  return parts.map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
}

/** Maps expo-speech-recognition error codes to what the user is told; null means nothing to say. */
export function voiceErrorKind(code: string | undefined): VoiceErrorKind | null {
  switch (code) {
    case 'aborted': return null;
    case 'not-allowed': return 'denied';
    case 'language-not-supported':
    case 'service-not-allowed': return 'unavailable';
    case 'network': return 'network';
    case 'no-speech':
    case 'speech-timeout': return 'noSpeech';
    default: return 'generic';
  }
}

export function createDictation(native: VoiceNative, handlers: VoiceHandlers): Dictation {
  let committed = '';
  let interim = '';
  let lastFinal = '';
  let heard = false;
  /** Results are applied from start until "end" or the abort fallback. */
  let active = false;
  let stopping = false;
  /** iOS has not reported "end" for the last started session yet. */
  let endPending = false;
  /** "end" events still owed by sessions that were replaced by a quick restart. */
  let staleEnds = 0;

  const text = () => joinSpeech(committed, interim).slice(0, VOICE_TEXT_LIMIT);
  const settle = () => {
    if (interim) committed = joinSpeech(committed, interim);
    interim = '';
    active = false;
  };

  const onResult = (event: VoiceResultEvent) => {
    if (!active) return;
    let transcript = joinSpeech(event?.results?.[0]?.transcript ?? '');
    // iOS 18 reports a pause as final and continues with only the new words;
    // older iOS repeats everything. Either way nothing is doubled.
    if (lastFinal && (transcript === lastFinal || transcript.startsWith(`${lastFinal} `))) {
      transcript = transcript.slice(lastFinal.length).trim();
    }
    // An empty result never erases what was already heard.
    if (!transcript) return;
    heard = true;
    if (event.isFinal) {
      committed = joinSpeech(committed, transcript);
      lastFinal = transcript;
      interim = '';
    } else {
      interim = transcript;
    }
    handlers.onText(text());
  };

  const onEnd = () => {
    if (staleEnds > 0) { staleEnds -= 1; return; }
    endPending = false;
    settle();
    stopping = false;
    handlers.onListening(false);
  };

  const onError = (event: VoiceErrorEvent) => {
    const kind = voiceErrorKind(event?.error);
    // An abort (ours, or a replaced session) is not a failure.
    if (!kind) return;
    const quietAfterStop = stopping && heard;
    settle();
    handlers.onListening(false);
    if (!quietAfterStop) handlers.onError(kind);
  };

  const subscriptions = [
    native.addListener('result', onResult as (event: never) => void),
    native.addListener('end', onEnd),
    native.addListener('error', onError as (event: never) => void),
    // A new session has really begun: any older session has ended by now.
    native.addListener('start', () => { staleEnds = 0; }),
  ];

  return {
    start(base, options) {
      if (endPending) staleEnds += 1;
      committed = joinSpeech(base);
      interim = '';
      lastFinal = '';
      heard = false;
      stopping = false;
      active = true;
      endPending = true;
      try {
        native.start(options);
      } catch {
        active = false;
        endPending = false;
        if (staleEnds > 0) staleEnds -= 1;
        handlers.onListening(false);
        handlers.onError('unavailable');
        return false;
      }
      handlers.onListening(true);
      return true;
    },
    stop() {
      if (!active) return;
      stopping = true;
      // The button switches at once; the last words still arrive afterwards.
      handlers.onListening(false);
      try { native.stop(); } catch { /* the abort fallback finishes it */ }
    },
    abortFallback() {
      if (!endPending) return;
      settle();
      try { native.abort(); } catch { /* nothing left to stop */ }
    },
    dispose() {
      subscriptions.forEach(subscription => subscription.remove());
      if (endPending) { try { native.abort(); } catch { /* already gone */ } }
      active = false;
      endPending = false;
    },
  };
}
