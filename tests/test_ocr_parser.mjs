import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../ocr-parser.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../ocr-ui.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../site/worker/index.js', import.meta.url), 'utf8');
const context = {};
vm.runInNewContext(source, context);
const parser = context.MatchMonitorOCR;
const worker = (await import('data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64'))).default;

const word = (text, x, y, confidence = 96, width = Math.max(14, String(text).length * 9)) => ({
  text,
  confidence,
  bbox: { x0: x, y0: y, x1: x + width, y1: y + 16 },
});

test('parses selected correct-score cells and their SP values', () => {
  const words = [word('比分', 340, 20), word('2:0', 80, 90), word('13', 80, 112)];
  const rows = parser.parse(words, 742, 912, (bbox) => bbox.x0 === 80);
  assert.equal(rows.length, 1);
  assert.deepEqual({ market: rows[0].market, selection: rows[0].selection, odds: rows[0].odds, highlighted: rows[0].highlighted }, {
    market: 'correct_score', selection: '2:0', odds: 13, highlighted: true,
  });
});

test('classifies all supported markets and infers handicap rows', () => {
  const words = [
    word('比分', 335, 15), word('胜其他', 80, 70), word('23', 80, 91),
    word('总进球', 325, 180), word('7+', 80, 230), word('21', 80, 251),
    word('半全场', 325, 360), word('负平', 80, 410), word('14', 80, 431),
    word('让球胜平负', 300, 550), word('让球', 8, 600), word('-1', 10, 620), word('主胜', 105, 600), word('5.05', 105, 622),
    word('胜平负', 330, 700), word('客胜', 105, 750), word('2.45', 105, 772),
  ];
  const rows = parser.parse(words, 742, 912);
  assert.equal(JSON.stringify(rows.map(({ market, selection, handicap, odds }) => ({ market, selection, handicap, odds }))), JSON.stringify([
    { market: 'correct_score', selection: '胜其他', handicap: null, odds: 23 },
    { market: 'total_goals', selection: '7+', handicap: null, odds: 21 },
    { market: 'half_full', selection: '负平', handicap: null, odds: 14 },
    { market: 'handicap', selection: '胜', handicap: -1, odds: 5.05 },
    { market: 'match_result', selection: '负', handicap: null, odds: 2.45 },
  ]));
});

test('normalizes full-width screenshot text and rejects invalid SP/selection combinations', () => {
  assert.equal(parser.normalize('２：０'), '2:0');
  assert.equal(JSON.stringify(parser.validatePick({ market: 'correct_score', selection: '2:0', odds: '9.5' })), JSON.stringify({ ok: true, reason: '有效' }));
  assert.equal(parser.validatePick({ market: 'total_goals', selection: '8', odds: 3 }).ok, false);
  assert.equal(parser.validatePick({ market: 'match_result', selection: '胜', odds: 0.8 }).ok, false);
  assert.equal(parser.validatePick({ market: 'handicap', selection: '平', odds: 2 }).ok, false);
  assert.equal(parser.validatePick({ market: 'handicap', selection: '平', handicap: 0, odds: 2 }).ok, true);
  assert.equal(parser.validatePick({ market: 'handicap', selection: '平', handicap: 10, odds: 2 }).ok, false);
});

test('root page and Sites Worker serve the same OCR assets without sending the image', async () => {
  assert.match(html, /<script src="\/ocr-parser\.js"><\/script>/);
  assert.match(html, /<script src="\/ocr-ui\.js"><\/script>/);
  const parserResponse = await worker.fetch(new Request('https://monitor.example/ocr-parser.js'), {});
  const uiResponse = await worker.fetch(new Request('https://monitor.example/ocr-ui.js'), {});
  assert.equal(await parserResponse.text(), source);
  assert.equal(await uiResponse.text(), uiSource);
  assert.match(uiSource, /worker\.recognize\(canvases\.ocr/);
  assert.match(uiSource, /ocrConfirm/);
  assert.match(uiSource, /逐项核对/);
  assert.doesNotMatch(uiSource, /FormData|fetch\(screenshotFile/);
  const payloadCode = uiSource.slice(uiSource.indexOf('function buildOcrPayload'), uiSource.indexOf('function clearOcr'));
  assert.doesNotMatch(payloadCode, /screenshotFile|screenshotUrl|data:image/);
});
