/**
 * The describe sheet's microphone (TestFlight build 47: speaking entered
 * nothing). The listeners were added through the package's detached
 * `addSpeechRecognitionListener`, so the native EventEmitter stored them on the
 * package exports instead of the module and no event ever arrived.
 *
 * The mocked recognizer below behaves like expo-modules-core's EventEmitter:
 * listeners live on `this`, so a detached call registers nothing that fires.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(resolve(projectRoot, relative), 'utf8');

const { outputText } = ts.transpileModule(await read('src/services/voiceDictation.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const voice = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`);

const listenersOf = new WeakMap();
function createNativeMock() {
  const calls = [];
  const native = {
    addListener(eventName, listener) {
      // Like the JSI EventEmitter: the registry belongs to `this`.
      assert.ok(this === native, `addListener('${eventName}') must be called on the native module, not detached`);
      const registry = listenersOf.get(this) ?? new Map();
      listenersOf.set(this, registry);
      registry.set(eventName, [...(registry.get(eventName) ?? []), listener]);
      return { remove: () => registry.set(eventName, registry.get(eventName).filter((entry) => entry !== listener)) };
    },
    start(options) { calls.push(['start', options]); },
    stop() { calls.push(['stop']); },
    abort() { calls.push(['abort']); },
  };
  const emit = (eventName, payload) => (listenersOf.get(native)?.get(eventName) ?? []).forEach((listener) => listener(payload));
  return { native, calls, emit };
}

function session(base = '') {
  const mock = createNativeMock();
  const state = { text: base, listening: false, errors: [] };
  const dictation = voice.createDictation(mock.native, {
    onText: (text) => { state.text = text; },
    onListening: (listening) => { state.listening = listening; },
    onError: (kind) => { state.errors.push(kind); },
  });
  const result = (transcript, isFinal = false) => mock.emit('result', { isFinal, results: [{ transcript }] });
  return { ...mock, state, dictation, result };
}

// Interim words appear live and are appended to typed text with one space.
{
  const s = session('Haferflocken');
  assert.equal(s.dictation.start(s.state.text, { lang: 'de-DE' }), true);
  assert.equal(s.state.listening, true);
  s.result('mit');
  assert.equal(s.state.text, 'Haferflocken mit', 'the first interim word must appear in the field at once');
  s.result('mit Banane');
  assert.equal(s.state.text, 'Haferflocken mit Banane', 'interim results replace each other, not stack');
}

// Stop switches the button at once; the final result after stop is kept.
{
  const s = session('');
  s.dictation.start('', {});
  s.result('zwei Eier');
  s.dictation.stop();
  assert.equal(s.state.listening, false, 'the button must switch immediately on stop');
  assert.deepEqual(s.calls.at(-1), ['stop']);
  s.result('zwei Eier und Toast', true);
  assert.equal(s.state.text, 'zwei Eier und Toast', 'a final result arriving after stop must still be written');
  s.emit('end');
  s.dictation.abortFallback();
  assert.ok(!s.calls.some(([name]) => name === 'abort'), 'no abort once iOS reported end');
  assert.equal(s.state.text, 'zwei Eier und Toast');
}

// The abort fallback keeps the last transcript and never erases text.
{
  const s = session('Skyr');
  s.dictation.start('Skyr', {});
  s.result('mit Beeren');
  s.dictation.stop();
  s.dictation.abortFallback();
  assert.deepEqual(s.calls.at(-1), ['abort'], 'without end within the grace period the session is aborted');
  assert.equal(s.state.text, 'Skyr mit Beeren');
  s.result('', true);
  s.emit('error', { error: 'aborted' });
  s.emit('end');
  assert.equal(s.state.text, 'Skyr mit Beeren', 'events after the abort must not erase the dictated text');
  assert.deepEqual(s.state.errors, [], 'our own abort is not an error');
  assert.equal(voice.VOICE_STOP_GRACE_MS, 1500);
}

// iOS 18 continues after a pause with only the new words; nothing is doubled.
{
  const s = session('');
  s.dictation.start('', {});
  s.result('Hähnchenbrust', true);
  s.result('mit Reis');
  assert.equal(s.state.text, 'Hähnchenbrust mit Reis');
  s.result('mit Reis', true);
  s.result('mit Reis', true);
  assert.equal(s.state.text, 'Hähnchenbrust mit Reis', 'a repeated final result is not appended twice');
  s.result('mit Reis und Brokkoli');
  assert.equal(s.state.text, 'Hähnchenbrust mit Reis und Brokkoli', 'a cumulative transcript after a final is not doubled');
}

// Errors show a message instead of silently doing nothing.
for (const [code, kind] of [['not-allowed', 'denied'], ['language-not-supported', 'unavailable'], ['service-not-allowed', 'unavailable'], ['network', 'network'], ['no-speech', 'noSpeech'], ['audio-capture', 'generic']]) {
  const s = session('');
  s.dictation.start('', {});
  s.emit('error', { error: code, message: 'native' });
  assert.deepEqual(s.state.errors, [kind], `${code} must be reported as ${kind}`);
  assert.equal(s.state.listening, false);
}
{
  const s = session('');
  s.native.start = () => { throw new Error('unavailable'); };
  assert.equal(s.dictation.start('', {}), false);
  assert.deepEqual(s.state.errors, ['unavailable'], 'a start that throws must show a message');
  assert.equal(s.state.listening, false);
}

// A quick restart is not cut off by the replaced session's late end.
{
  const s = session('');
  s.dictation.start('', {});
  s.result('Apfel', true);
  s.dictation.stop();
  s.dictation.start(s.state.text, {});
  assert.equal(s.state.listening, true);
  s.emit('end');
  assert.equal(s.state.listening, true, 'the old session’s end must not stop the new one');
  s.result('und Nüsse');
  assert.equal(s.state.text, 'Apfel und Nüsse');
}

// Unmounting aborts a running session and removes every listener.
{
  const s = session('');
  s.dictation.start('', {});
  s.dictation.dispose();
  assert.deepEqual(s.calls.at(-1), ['abort']);
  s.result('zu spät');
  assert.equal(s.state.text, '');
}

assert.equal(voice.joinSpeech(' Haferflocken  ', '', ' mit Milch '), 'Haferflocken mit Milch');

// The component wires the real native module, keeps the instant stop and shows errors.
const button = await read('src/components/VoiceInputButton.tsx');
assert.doesNotMatch(button, /addSpeechRecognitionListener/, 'the detached listener export registers nothing on iOS');
assert.match(button, /createDictation\(speech\.ExpoSpeechRecognitionModule/, 'listeners must be added on ExpoSpeechRecognitionModule');
assert.match(button, /stopTimer\.current = setTimeout\(\(\) => \{[^}]*abortFallback\(\)/, 'stop keeps the abort fallback timer');
assert.match(button, /onChangeRef\.current\(text\)/, 'results reach the current field setter');
assert.match(button, /t\.scan\.voiceErrors\[error\]/, 'recognition errors are shown');
assert.match(button, /accessibilityLiveRegion="polite"/);

for (const file of ['src/i18n/de.ts', 'src/i18n/en.ts']) {
  const source = await read(file);
  for (const key of ['denied', 'unavailable', 'network', 'noSpeech', 'generic']) {
    assert.match(source, new RegExp(`voiceErrors: \\{[\\s\\S]*?${key}: '`), `${file} needs voiceErrors.${key}`);
  }
}

const appJson = JSON.parse(await read('app.json'));
const speechPlugin = appJson.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-speech-recognition');
assert.ok(speechPlugin?.[1]?.microphonePermission && speechPlugin[1].speechRecognitionPermission, 'the speech plugin must declare both purposes');
for (const key of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']) {
  assert.ok(appJson.expo.ios.infoPlist[key]?.length > 15, `ios.infoPlist.${key} is required for dictation`);
}
assert.equal(appJson.expo.ios.infoPlist.NSSpeechRecognitionUsageDescription, speechPlugin[1].speechRecognitionPermission,
  'plugin and Info.plist must declare the same speech purpose');

console.log('Validated voice input: live interim text, final result after stop kept, abort fallback keeps text, visible errors, native listener binding and permission strings.');
