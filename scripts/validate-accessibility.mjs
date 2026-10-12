/**
 * Every control a screen reader can reach has to say what it is.
 *
 * The two settings switches carried no label at all: VoiceOver announced
 * "switch, off" and nothing else, because the row's text sits in a sibling
 * view and is not read as part of the control. App Review checks this.
 */
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir, extensions = ['.tsx']) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

const files = [
  ...await walk(resolve(projectRoot, 'src/app')),
  ...await walk(resolve(projectRoot, 'src/components')),
];

const failures = [];

/** Returns each JSX element of the given name, with its attributes. */
function elements(source, name) {
  const found = [];
  const opening = new RegExp(`<${name}(\\s|>|/)`, 'g');
  for (const match of source.matchAll(opening)) {
    let depth = 0;
    let index = match.index;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    found.push({ text: source.slice(match.index, index + 1), line: source.slice(0, match.index).split('\n').length });
  }
  return found;
}

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const label = relative(projectRoot, file);

  // A switch is invisible to a screen reader without its own label.
  for (const element of elements(source, 'Switch')) {
    if (!/accessibilityLabel=/.test(element.text)) {
      failures.push(`${label}:${element.line} a Switch has no accessibilityLabel`);
    }
  }

  // A text field must announce what it collects.
  for (const element of elements(source, 'TextInput')) {
    if (!/accessibilityLabel=/.test(element.text)) {
      failures.push(`${label}:${element.line} a TextInput has no accessibilityLabel`);
    }
  }

  // An icon-only button says nothing on its own.
  for (const element of elements(source, 'Pressable')) {
    const iconOnly = /<Ionicons/.test(element.text);
    if (iconOnly && !/accessibilityLabel=/.test(element.text)) {
      failures.push(`${label}:${element.line} an icon-only Pressable has no accessibilityLabel`);
    }

    // A radio needs a checked state. `selected` may render the visual state on
    // native, but React Native Web does not expose it as aria-checked, leaving
    // assistive technology unable to tell which mutually exclusive option won.
    if (/accessibilityRole=["']radio["']/.test(element.text)) {
      if (!/accessibilityState=\{\{[\s\S]*?checked\s*:/.test(element.text)) {
        failures.push(`${label}:${element.line} a radio has no checked accessibilityState`);
      }
      if (!/aria-checked=/.test(element.text)) {
        failures.push(`${label}:${element.line} a radio has no aria-checked web state`);
      }
      if (/accessibilityState=\{\{[\s\S]*?selected\s*:/.test(element.text)) {
        failures.push(`${label}:${element.line} a radio uses selected instead of checked`);
      }
    }
  }
}

// Typography floor: nothing rendered in the app is smaller than 12 pt.
// Captions at 9-11 pt were unreadable over the camera and on the paywall.
const FONT_FLOOR = 12;
const themeSource = await readFile(resolve(projectRoot, 'src/constants/theme.ts'), 'utf8');
const typeScaleBody = themeSource.match(/export const typeScale = \{([\s\S]*?)\n\} as const/)?.[1] ?? '';
const typeScale = Object.fromEntries([...typeScaleBody.matchAll(/^\s*(\w+): \{([^}]*)\}/gm)].map(([, name, body]) => [name, {
  fontSize: Number(body.match(/fontSize: (\d+(?:\.\d+)?)/)?.[1]),
  lineHeight: Number(body.match(/lineHeight: (\d+(?:\.\d+)?)/)?.[1]),
  letterSpacing: body.match(/letterSpacing: (-?\d+(?:\.\d+)?)/)?.[1],
}]));
assert.ok(Object.keys(typeScale).length >= 10, 'theme.ts defines the typeScale text styles');
for (const [name, token] of Object.entries(typeScale)) {
  if (!(token.fontSize >= FONT_FLOOR)) failures.push(`typeScale.${name} is ${token.fontSize} pt, below the ${FONT_FLOOR} pt floor`);
  // A token without a line box is how paragraphs ended up cramped: every step
  // carries its own lineHeight, 1.15-1.25x for headings and 1.3-1.45x for text.
  const ratio = token.lineHeight / token.fontSize;
  if (!(ratio >= 1.15 && ratio <= 1.5)) failures.push(`typeScale.${name} needs an explicit lineHeight of 1.15-1.5x its size (has ${token.lineHeight})`);
  if (token.letterSpacing === undefined) failures.push(`typeScale.${name} needs an explicit letterSpacing`);
}
for (const name of ['display', 'title1', 'title2', 'headline', 'body', 'callout', 'subhead', 'footnote', 'caption', 'eyebrow']) {
  if (!typeScale[name]) failures.push(`typeScale.${name} is missing`);
}
for (const name of ['display', 'title1', 'title2']) {
  if (typeScale[name] && !(Number(typeScale[name].letterSpacing) < 0)) failures.push(`typeScale.${name} headings track slightly tighter (negative letterSpacing)`);
}
const sourceFiles = await walk(resolve(projectRoot, 'src'), ['.ts', '.tsx']);
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  const label = relative(projectRoot, file);
  for (const match of source.matchAll(/fontSize\s*(?::|=)\s*\{?\s*["']?(\d+(?:\.\d+)?|typeScale\.\w+)/g)) {
    const raw = match[1];
    const size = raw.startsWith('typeScale.') ? typeScale[raw.slice('typeScale.'.length)]?.fontSize : Number(raw);
    if (!(size >= FONT_FLOOR)) {
      failures.push(`${label}:${source.slice(0, match.index).split('\n').length} fontSize ${raw} is below the ${FONT_FLOOR} pt floor`);
    }
  }
  // The light amber is 2.5:1 on white: fine for fills and borders, not for
  // words or meaningful icons. Those use attentionText. Macro colours are for
  // bars and dots only; their labels stay ink or muted.
  for (const match of source.matchAll(/(?<![A-Za-z])color\s*(?::|=)\s*\{?\s*colors\.(attention|macroCarbs|macroProtein|macroFat)\b(?!Text|Soft)/g)) {
    failures.push(`${label}:${source.slice(0, match.index).split('\n').length} colors.${match[1]} is used as a text/icon colour; use attentionText, text or muted`);
  }
}

// Line boxes: every text style that sets a fontSize also sets a lineHeight, or
// takes both from a typeScale step. Without one, multi-line copy sat on the
// font's default line box and read as squeezed on a real iPhone. Styles that
// belong to a TextInput are exempt: iOS misplaces single-line input text when
// a lineHeight is set.
let textStyles = 0;
for (const file of sourceFiles.filter((path) => path.endsWith('.tsx'))) {
  const source = await readFile(file, 'utf8');
  const label = relative(projectRoot, file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inputStyleNames = new Set();
  const inputObjects = new Set();
  const collectInputs = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /TextInput$/.test(node.tagName.getText(sf))) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(sf) !== 'style' || !attribute.initializer) continue;
        const walkStyle = (child) => {
          if (ts.isPropertyAccessExpression(child) && child.expression.getText(sf) === 'styles') inputStyleNames.add(child.name.text);
          if (ts.isObjectLiteralExpression(child)) inputObjects.add(child.pos);
          ts.forEachChild(child, walkStyle);
        };
        walkStyle(attribute.initializer);
      }
    }
    ts.forEachChild(node, collectInputs);
  };
  collectInputs(sf);
  const check = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map((property) => property.name?.getText(sf));
      const tokens = node.properties.filter(ts.isSpreadAssignment).map((spread) => spread.expression.getText(sf)).filter((text) => text.startsWith('typeScale.'));
      for (const token of tokens) {
        if (!typeScale[token.slice('typeScale.'.length)]) failures.push(`${label}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${token} is not a typeScale step`);
      }
      if (names.includes('fontSize') || tokens.length) textStyles += 1;
      const key = ts.isPropertyAssignment(node.parent) ? node.parent.name.getText(sf) : null;
      const input = (key && inputStyleNames.has(key)) || inputObjects.has(node.pos);
      if (names.includes('fontSize') && !names.includes('lineHeight') && !tokens.length && !input) {
        failures.push(`${label}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${key ?? 'inline style'} sets fontSize without a lineHeight; spread a typeScale step`);
      }
    }
    ts.forEachChild(node, check);
  };
  check(sf);
}
assert.ok(textStyles > 300, `expected the app's text styles to be found (saw ${textStyles})`);

if (failures.length) {
  throw new Error(`Accessibility validation failed:\n- ${failures.join('\n- ')}`);
}

console.log(`Validated ${files.length} screens: controls announce labels, every radio exposes its checked state, no text is below ${FONT_FLOOR} pt, ${textStyles} text styles carry a line height and amber text meets contrast.`);
