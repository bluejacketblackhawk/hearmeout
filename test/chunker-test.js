'use strict';

const assert = require('assert');
const { chunk, MAX_CHUNK } = require('../src/main/tts/chunker');

function texts(cs) { return cs.map(function (c) { return c.text; }); }

// Plain sentences split cleanly.
let r = chunk('Hello there. This is a test! Is it working? Yes.');
assert.deepStrictEqual(texts(r), ['Hello there.', 'This is a test!', 'Is it working?', 'Yes.']);

// Offsets point at the original string exactly.
const src = 'One two. Three four.';
r = chunk(src);
assert.strictEqual(src.slice(r[0].start, r[0].end), 'One two.');
assert.strictEqual(src.slice(r[1].start, r[1].end), 'Three four.');

// Abbreviations and initials do not split.
r = chunk('Dr. Smith met Mr. J. Jones at 3 p.m. yesterday. They talked.');
assert.strictEqual(r.length, 2);
assert.ok(r[0].text.indexOf('Dr. Smith') === 0);

// Decimals do not split.
r = chunk('Pi is 3.14 exactly. Almost.');
assert.deepStrictEqual(texts(r), ['Pi is 3.14 exactly.', 'Almost.']);

// Ellipses and stacked enders collapse to one boundary.
r = chunk('Wait... what?! Really.');
assert.deepStrictEqual(texts(r), ['Wait... what?!', 'Really.']);

// Closing quotes ride with their sentence.
r = chunk('She said "stop." Then left.');
assert.deepStrictEqual(texts(r), ['She said "stop."', 'Then left.']);

// Newlines are boundaries.
r = chunk('line one\nline two\n\nline three');
assert.deepStrictEqual(texts(r), ['line one', 'line two', 'line three']);

// Lowercase after a dot is not a boundary ("vs. the world").
r = chunk('It was us vs. them again. Fine.');
assert.strictEqual(r.length, 2);

// A run-on longer than MAX_CHUNK gets split, and no chunk exceeds the cap.
let long = '';
while (long.length < MAX_CHUNK * 3) long += 'word and more words, ';
r = chunk(long);
assert.ok(r.length >= 3);
for (let i = 0; i < r.length; i++) assert.ok(r[i].text.length <= MAX_CHUNK, 'chunk ' + i + ' too long');

// Empty and whitespace input yield nothing.
assert.deepStrictEqual(chunk(''), []);
assert.deepStrictEqual(chunk('   \n\n  '), []);

// Offsets reconstruct highlightable spans even after long-splits.
const doc = 'Intro sentence. ' + long + ' Outro sentence.';
r = chunk(doc);
for (let i = 0; i < r.length; i++) {
  assert.strictEqual(doc.slice(r[i].start, r[i].end), r[i].text);
}

console.log('[chunker-test] ok (' + r.length + ' chunks in the mixed doc)');
