'use strict';

/**
 * Split text into speakable sentence chunks.
 *
 * Kokoro sounds best (and starts fastest) on sentence-sized input, so the
 * player pipeline is: chunk -> synth chunk 0 -> start playing while chunk 1
 * synthesizes. The splitter is deliberately boring: sentence enders followed
 * by whitespace + a capital/opening quote/digit, with a guard list of common
 * abbreviations, and a hard cap so a 2,000-character run-on cannot stall the
 * first sound. Newlines are paragraph breaks. No NLP, no locale claims.
 *
 * Each chunk: { text, start, end } — offsets into the ORIGINAL string so the
 * reader can highlight exactly what is being spoken.
 */

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc',
  'ltd', 'co', 'corp', 'dept', 'est', 'fig', 'gen', 'gov', 'hon', 'jan',
  'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov',
  'dec', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'no', 'vol',
  'approx', 'appt', 'dept', 'min', 'max', 'misc', 'al', 'ave', 'blvd', 'rd',
  'u.s', 'u.k', 'a.m', 'p.m', 'e.g', 'i.e',
]);

const MAX_CHUNK = 400; // characters; beyond this we split at the best comma/space

function isEnder(c) {
  return c === '.' || c === '!' || c === '?';
}

/** Word immediately before position i (lowercased, dots kept for e.g/i.e). */
function wordBefore(text, i) {
  let end = i;
  let start = end;
  while (start > 0) {
    const c = text[start - 1];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '.' ) start--;
    else break;
  }
  let w = text.slice(start, end).toLowerCase();
  while (w.length && w[w.length - 1] === '.') w = w.slice(0, -1);
  return w;
}

/** True if the ender at index i really ends a sentence. */
function isBoundary(text, i) {
  const c = text[i];
  if (!isEnder(c)) return false;

  // Collapse runs of enders ("?!", "...") — boundary decided at the last one.
  if (i + 1 < text.length && isEnder(text[i + 1])) return false;

  // A dot needs more scrutiny than ! or ?
  if (c === '.') {
    const w = wordBefore(text, i);
    if (ABBREV.has(w)) return false;
    if (w.length === 1) return false;                  // initials: "J. Smith"
    if (/^\d+$/.test(w) && i + 1 < text.length && /\d/.test(text[i + 1])) {
      return false;                                    // 3.14
    }
  }

  // Trailing closers ride along: ." )" etc.
  let j = i + 1;
  while (j < text.length && (text[j] === '"' || text[j] === '”' || text[j] === "'" || text[j] === ')' || text[j] === ']')) j++;

  if (j >= text.length) return true;
  if (text[j] === '\n' || text[j] === '\r') return true;
  if (text[j] !== ' ' && text[j] !== '\t') return false;

  // Peek at the next non-space char: sentence starts look like starts.
  let k = j;
  while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
  if (k >= text.length) return true;
  const n = text[k];
  if (n >= 'a' && n <= 'z') return false; // "vs. the world" style false enders
  return true;
}

/** Find where the chunk ending at `i` actually finishes (absorb closers). */
function boundaryEnd(text, i) {
  let j = i + 1;
  while (j < text.length && (text[j] === '"' || text[j] === '”' || text[j] === "'" || text[j] === ')' || text[j] === ']')) j++;
  return j;
}

/** Split an over-long stretch at the friendliest interior point. */
function splitLong(text, start, end, out) {
  let s = start;
  while (end - s > MAX_CHUNK) {
    let cut = -1;
    // Prefer the last comma/semicolon/colon inside the window…
    for (let i = s + MAX_CHUNK; i > s + 40; i--) {
      const c = text[i];
      if (c === ',' || c === ';' || c === ':') { cut = i + 1; break; }
    }
    // …then the last space.
    if (cut < 0) {
      for (let i = s + MAX_CHUNK; i > s + 40; i--) {
        if (text[i] === ' ') { cut = i; break; }
      }
    }
    if (cut < 0) cut = s + MAX_CHUNK;
    pushChunk(text, s, cut, out);
    s = cut;
  }
  if (s < end) pushChunk(text, s, end, out);
}

function pushChunk(text, start, end, out) {
  while (start < end && (text[start] === ' ' || text[start] === '\t' || text[start] === '\n' || text[start] === '\r')) start++;
  let e = end;
  while (e > start && (text[e - 1] === ' ' || text[e - 1] === '\t' || text[e - 1] === '\n' || text[e - 1] === '\r')) e--;
  if (e <= start) return;
  out.push({ text: text.slice(start, e), start: start, end: e });
}

/**
 * @param {string} input
 * @returns {{text:string,start:number,end:number}[]}
 */
function chunk(input) {
  const text = String(input == null ? '' : input);
  const out = [];
  let s = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n' || c === '\r') {
      // Paragraph / line break is always a boundary.
      if (i > s) {
        if (i - s > MAX_CHUNK) splitLong(text, s, i, out);
        else pushChunk(text, s, i, out);
      }
      s = i + 1;
      i = s;
      continue;
    }
    if (isEnder(c) && isBoundary(text, i)) {
      const e = boundaryEnd(text, i);
      if (e - s > MAX_CHUNK) splitLong(text, s, e, out);
      else pushChunk(text, s, e, out);
      s = e;
      i = e;
      continue;
    }
    i++;
  }
  if (s < text.length) {
    if (text.length - s > MAX_CHUNK) splitLong(text, s, text.length, out);
    else pushChunk(text, s, text.length, out);
  }
  return out;
}

module.exports = { chunk, MAX_CHUNK };
