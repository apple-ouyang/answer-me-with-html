// The writing check follows the language of the draft (#84). Chinese and English keep their lexical rules. A declared language selects
// the rule family: declared English turns the Chinese vocabulary rules off. Sentence and paragraph length are unrestricted across all languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';

const warn = (lang, body) => renderDoc(`${lang === undefined ? '' : `---\nlang: ${lang}\n---\n`}## A Section\n${body}\n`).warnings;
const rules = (warnings) => warnings.map((w) => w.rule);
const words = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');

test('writing check: English rules still flag passive steps and wordy words in an English draft', () => {
  assert.ok(rules(warn('en', '1. The valve was closed by the operator.')).includes('passive'));
  assert.ok(rules(warn('en', 'Please utilize the valve.')).includes('word'));
  assert.ok(rules(warn(undefined, '1. The valve was closed by the operator and the line stays open for now.')).includes('passive'));
});

test('writing check: a language without rules gets no English passive-voice, word-list or length warnings', () => {
  for (const lang of ['fr', 'es', 'ko', 'pt-BR', 'th', 'lo', 'km', 'my']) {
    const w = warn(lang, `1. The valve was closed by the operator. Please utilize the valve. ${words(40)}.`);
    assert.deepEqual(rules(w), [], lang);
  }
});

test('writing check: long paragraphs and long CJK or Cyrillic sentences are not flagged for length', () => {
  const seven = Array.from({ length: 8 }, (_, i) => `Phrase ${i}.`).join(' ');
  assert.deepEqual(rules(warn('fr', seven)), []);
  assert.deepEqual(rules(warn(undefined, `${words(30, 'слово')}.`)), []);
  const longZhHant = '這個句子用來測試繁體中文在取消句長硬上限之後不再誤報長度警告，讓複雜推導和機制解釋能夠完整展開。'; // lang-ok: draft text under test
  assert.deepEqual(rules(warn('zh-Hant', longZhHant)), []);
});

test('writing check: a declared English draft does not get Chinese vocabulary warnings; an undeclared Chinese one does', () => {
  const body = '我们对系统进行优化。'; // lang-ok: draft text under test
  assert.deepEqual(rules(warn('en', body)), []);
  assert.ok(warn(undefined, body).some((w) => w.rule === 'word' && /light verb/.test(w.message)));
  assert.ok(warn('zh', body).some((w) => /light verb/.test(w.message)));
});

test('writing check: Japanese gets no Chinese vocabulary or length warnings', () => {
  assert.deepEqual(warn('ja', '基本的には具体的で効果的な手順を長く丁寧に説明します。'), []); // lang-ok: draft text under test
});
