// STE controlled-writing check (only constrains the explanatory text in drafts).
// The goal is clear text with no filler; ASD-STE100 is the idea behind it, not a rigid length cap.
// Rules: non-approved words (English and Chinese), English passive voice in steps, Chinese light verbs / `的` chains / clichés and filler. Sentence and paragraph length are unrestricted so explanations can expand when needed. All findings are warnings; strictness comes from style.
// Japanese with kana and languages other than Chinese and English get no English or Chinese vocabulary warnings: Japanese `的` is a suffix (`基本的`, `具体的`), not the Chinese structural particle.
// Image captions (the alt text) are checked like any other text.
// Skipped: code and inline code, quotations, math ($…$ and $$ blocks), ~~strikethrough~~ (counter-examples), table rows with a no status, headings, components other than callout.
// A quotation is someone else's words: a draft that quotes a reviewer, a log line or a spec does not have to rewrite it.

import { EN_WORDS } from './wordlist.en.js';
import { ZH_LIGHT_VERBS, ZH_CLICHES, ZH_WORDS } from './wordlist.zh.js';
import { isCJK, isJapanese } from '../svg/text.js';
import { COMPONENTS } from '../components/index.js';
import { stripMath, opensDisplay, closesDisplay, isDisplayLine } from '../math.js';

const ABBR = /\b(e\.g|i\.e|etc|vs|cf|approx|Fig|No)\./gi;
const PASSIVE = /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+ed|known|done|made|given|taken|seen|written|built|shown|sent|kept|held|found|set|put|run|begun|chosen|driven|broken)\b/i;
const EN_RE = Object.entries(EN_WORDS)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([word, suggestion]) => ({ re: new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`, 'gi'), word, suggestion }));

export function splitSentences(text) {
  const masked = text.replace(ABBR, (m) => m.replace(/\./g, '\u0000'));
  const parts = masked.match(/[^。！？；!?;]+?(?:[。！？；!?;]+|\.(?=\s|$)|$)|[^.]+?\.(?=\s|$)/g) ?? [];
  return parts.map((s) => s.replace(/\u0000/g, '.').trim()).filter(Boolean);
}

export function sentenceLength(sentence) {
  const cjk = [...sentence].filter(isCJK).filter((c) => !/[，。！？；：、（）「」『』“”‘’《》]/.test(c)).length;
  const words = sentence.match(/[A-Za-z0-9][\w'’-]*/g)?.length ?? 0;
  return cjk >= 4 || cjk > words ? { lang: 'zh', count: cjk + words } : { lang: 'en', count: words };
}

// The rule family of a draft. Chinese, English and Japanese drafts follow their text, as they always did ('auto'); a declared language
// selects its own family; any other language, declared or detected, gets 'neutral' (no language-specific lexical warnings). No language given is 'auto'.
const RULE_LANGUAGES = new Set(['zh', 'en', 'ja']);
function ruleFamily(language) {
  if (!language) return 'auto';
  const base = language.tag.split('-')[0];
  if (!RULE_LANGUAGES.has(base)) return 'neutral';
  return language.declared ? base : 'auto';
}

export function formatWarning(w) {
  return `L${w.line} [${w.rule}] ${w.message}${w.suggestion ? ` → ${w.suggestion}` : ''}`;
}

// language: the resolved language of the draft (optional); it selects the rule family.
export function lintDoc(doc, language) {
  const warnings = [];
  const family = ruleFamily(language);
  const blocks = [...doc.intro, ...doc.panels.flatMap((p) => p.blocks)];
  for (const b of blocks) {
    if (b.type === 'md') lintMarkdown(b.text, b.line, warnings, family);
    else if (b.lang === 'callout') lintMarkdown(b.text, b.line + 1, warnings, family);
    else if (COMPONENTS.get(b.lang)?.lint) lintMarkdown(COMPONENTS.get(b.lang).lint(b.text), b.line + 1, warnings, family);
  }
  return warnings;
}

// A quoted span is evidence, not the draft's own prose: drop it before the rules run. Single quotes stay, because they are usually apostrophes.
// A span never runs past a second opening mark, so an unbalanced opening quote does not swallow the prose before a later pair.
const QUOTED = /"[^"\n]*"|“[^“”\n]*”|「[^「」\n]*」|『[^『』\n]*』|«[^«»\n]*»|„[^„“\n]*“/g;

function clean(text) {
  // Inline code goes first, so a quote mark inside code never pairs with one in the prose.
  return stripMath(text.replace(/~~[^~]*~~/g, '').replace(/`[^`]*`/g, '').replace(QUOTED, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_]{1,3}/g, '');
}

function lintMarkdown(text, startLine, out, family) {
  let inHtml = false;
  let inMath = false;
  text.split('\n').forEach((raw, i) => {
    const line = startLine + i;
    const t = raw.trim();
    if (/^<(div|svg|table|details|figure)/i.test(t)) inHtml = true;
    if (inHtml) {
      if (/<\/(div|svg|table|details|figure)>\s*$/i.test(t)) inHtml = false;
      return;
    }
    // The TeX of a $$ block is not text: it gives no words and no sentences.
    if (inMath) {
      if (!t || closesDisplay(t)) inMath = false;
      return;
    }
    if (opensDisplay(raw) || isDisplayLine(raw)) {
      inMath = opensDisplay(raw);
      return;
    }
    if (!t || /^#{1,6}\s/.test(t) || /^[-*_]{3,}$/.test(t)) return;
    if (t.startsWith('|')) {
      if (/^\|?[\s:|-]+\|?$/.test(t)) return;
      const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.some((c) => /^(no|✗|✘)(\s|$)/.test(c))) return;
      cells.forEach((c) => checkUnit(clean(c.replace(/^(ok|warn|✓|✔|⚠)(\s|$)/, '')), line, 'descriptive', out, family));
      return;
    }
    const list = t.match(/^(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (list) {
      checkUnit(clean(list[3]), line, list[2] ? 'procedural' : 'descriptive', out, family);
      return;
    }
    const body = clean(t.replace(/^>\s*/, ''));
    checkUnit(body, line, 'descriptive', out, family);
  });
}

// Check one piece of text (a list item / cell / one paragraph line); returns the sentence count.
function checkUnit(text, line, kind, out, family) {
  const sentences = splitSentences(text);
  const zhFamily = family === 'auto' || family === 'zh';
  const ja = family === 'ja' || (zhFamily && isJapanese(text));
  const chineseRules = zhFamily && !ja;
  const englishRules = family !== 'neutral';
  for (const s of sentences) {
    const { lang } = sentenceLength(s);
    // ASD-STE100 allows the passive in descriptions, so only steps are checked.
    if (englishRules && kind === 'procedural' && lang === 'en' && PASSIVE.test(s)) {
      out.push({ line, rule: 'passive', message: `possible passive voice: "${s.match(PASSIVE)[0]}"`, suggestion: 'use active voice' });
    }
  }
  const lexical = [
    ...(englishRules ? EN_RE : []).flatMap(({ re, suggestion }) => [...text.matchAll(re)].map((m) => ({ index: m.index, rule: 'word', message: `not recommended: "${m[0]}"`, suggestion }))),
    ...(chineseRules ? ZH_LIGHT_VERBS : []).flatMap(({ re, label }) => [...text.matchAll(re)].map((m) => ({ index: m.index, rule: 'word', message: `light verb "${m[0]}" (${label})`, suggestion: `use "${m[1]}"` }))),
    ...(chineseRules ? ZH_WORDS : []).flatMap(({ re, suggestion }) => [...text.matchAll(re)].map((m) => ({ index: m.index, rule: 'word', message: `not recommended: "${m[0]}"`, suggestion }))),
  ];
  out.push(...lexical.sort((a, b) => a.index - b.index).map(({ index, ...w }) => ({ line, ...w })));
  for (const s of sentences) {
    if (!zhFamily || isJapanese(s)) continue;
    if ((s.match(/的/g) ?? []).length >= 3) out.push({ line, rule: 'de-chain', message: `chained "的": ${s}`, suggestion: 'split the sentence or remove extra "的"' });
  }
  for (const c of chineseRules ? ZH_CLICHES : []) {
    if (text.includes(c)) out.push({ line, rule: 'cliche', message: `cliché "${c}"`, suggestion: 'delete it or state a concrete fact' });
  }
  return sentences.length;
}
