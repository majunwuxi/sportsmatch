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

test('detects dark selected cells, filters a full-width button, and inverts white text for OCR', () => {
  const width = 240, height = 160;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 248;
    pixels[offset + 3] = 255;
  }
  const fill = (x0, y0, x1, y1, color) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2];
    }
  };
  fill(30, 40, 90, 66, [89, 96, 140]);
  fill(48, 47, 62, 58, [255, 255, 255]);
  fill(120, 40, 164, 66, [45, 45, 45]);
  fill(132, 47, 148, 58, [255, 255, 255]);
  fill(0, 145, width, 158, [245, 60, 65]);

  const regions = parser.detectSelectedRegions(pixels, width, height);
  assert.equal(regions.length, 2);
  assert.equal(parser.containsSelectedRegion({ x0: 50, y0: 48, x1: 60, y1: 56 }, regions), true);
  assert.equal(parser.containsSelectedRegion({ x0: 96, y0: 48, x1: 106, y1: 56 }, regions), false);
  assert.equal(parser.containsSelectedRegion({ x0: 115, y0: 147, x1: 125, y1: 155 }, regions), false);

  const gray = new Uint8ClampedArray([90, 90, 90, 255, 245, 245, 245, 255]);
  parser.invertGrayPixels(gray);
  assert.deepEqual([...gray], [255, 255, 255, 255, 0, 0, 0, 255]);
});

test('replaces whole-page text inside selected cells with upscaled cell OCR', () => {
  const regions = [
    { x0: 112, y0: 286, x1: 214, y1: 331 },
    { x0: 215, y0: 286, x1: 317, y1: 331 },
    { x0: 318, y0: 286, x1: 421, y1: 331 },
    { x0: 422, y0: 286, x1: 524, y1: 331 },
    { x0: 525, y0: 332, x1: 730, y1: 376 },
  ];
  const selections = [
    ['4:0', '17'], ['4:1', '23'], ['5:0', '29'], ['5:1', '31'], ['平其他', '37'],
  ];
  const pageWords = [word('比分', 340, 250), word('1:0', 25, 294), word('9', 30, 311)];
  for (const region of regions) {
    pageWords.push(word('1:0', region.x0 + 30, region.y0 + 6), word('9', region.x0 + 32, region.y0 + 23));
  }
  const cropResults = regions.map((region, index) => {
    const [selection, odds] = selections[index];
    return {
      region,
      words: [word(selection, 20, 30, 96, selection.length * 9), word(odds, 20, 95, 96, 18)],
      scaleX: 4,
      scaleY: 4,
      cropWidth: (region.x1 - region.x0) * 4,
      cropHeight: (region.y1 - region.y0) * 4,
    };
  });
  const enhancedWords = parser.mergeSelectedRegionWords(pageWords, cropResults);
  assert.equal(enhancedWords.some((item) => item.text === '1:0' && item.bbox.x0 > 110), false);
  assert.equal(enhancedWords.some((item) => item.text === '1:0' && item.bbox.x0 < 100), true);
  const rows = parser.parse(enhancedWords, 749, 902, (bbox) => parser.containsSelectedRegion(bbox, regions));
  const selected = rows.filter((row) => row.highlighted).map(({ selection, odds }) => [selection, odds]);
  assert.deepEqual(JSON.stringify(selected), JSON.stringify(selections.map(([selection, odds]) => [selection, Number(odds)])));
});

test('repairs a misread selected score label and maps a padded cell crop back to the screenshot', () => {
  const region = { x0: 100, y0: 200, x1: 200, y1: 250 };
  const cropWords = [word('1Z', 50, 40, 88, 20), word('17', 50, 110, 95, 18)];
  assert.equal(parser.hasSelectionLabel(cropWords, 400, 200), true);
  assert.equal(parser.selectionLabelConfidence(cropWords, 400, 200) > 0, true);
  assert.equal(parser.hasSelectionLabel([word('50', 50, 150)], 400, 200), false);
  const enhanced = parser.mergeSelectedRegionWords([], [{
    region,
    words: cropWords,
    scaleX: 4,
    scaleY: 4,
    cropWidth: 400,
    cropHeight: 200,
    offsetX: 40,
    offsetY: 40,
  }]);
  const rows = parser.parse([word('比分', 280, 160), ...enhanced], 400, 400,
    (bbox) => parser.containsSelectedRegion(bbox, [region]));
  assert.equal(rows.some((row) => row.selection === '1:2' && row.odds === 17 && row.highlighted), true);
});

test('matches every detected selection when a score label is OCR-split and an other-score label is Chinese', () => {
  const regions = [
    { x0: 40, y0: 100, x1: 140, y1: 150 },
    { x0: 145, y0: 100, x1: 245, y1: 150 },
    { x0: 250, y0: 100, x1: 350, y1: 150 },
    { x0: 355, y0: 100, x1: 455, y1: 150 },
  ];
  const synthetic = [
    ['1Z', '17', '1:2'], ['4:0', '23', '4:0'],
    ['4:1', '29', '4:1'], ['平其他', '37', '平其他'],
  ];
  const cropResults = regions.map((region, index) => ({
    region,
    words: [word(synthetic[index][0], 50, 35, 91), word(synthetic[index][1], 50, 110, 94)],
    scaleX: 4, scaleY: 4, cropWidth: 400, cropHeight: 200, offsetX: 40, offsetY: 40,
  }));
  const words = [word('比分', 300, 50), ...parser.mergeSelectedRegionWords([], cropResults)];
  const rows = parser.parse(words, 500, 300,
    (bbox) => parser.containsSelectedRegion(bbox, regions));
  assert.deepEqual(JSON.stringify(rows.filter((row) => row.highlighted).map(({ selection, odds }) => [selection, odds])),
    JSON.stringify(synthetic.map(([, odds, selection]) => [selection, Number(odds)])));
});

test('creates one selected pick per dark region without requiring a global-candidate match', () => {
  const regions = [
    { x0: 40, y0: 100, x1: 140, y1: 150 },
    { x0: 150, y0: 100, x1: 250, y1: 150 },
    { x0: 260, y0: 100, x1: 360, y1: 150 },
    { x0: 370, y0: 100, x1: 470, y1: 150 },
  ];
  const crops = [
    { words: [word('1:0', 50, 45), word('12', 50, 110)] },
    { words: [word('1Z', 50, 45, 88), word('17', 50, 110)] },
    { words: [word('??', 50, 45, 40)] },
    { words: [] },
  ].map((item, index) => ({
    ...item,
    region: regions[index],
    scaleX: 4,
    scaleY: 4,
    cropWidth: 400,
    cropHeight: 200,
    offsetX: 40,
    offsetY: 40,
  }));
  const pageWords = [
    word('比分', 250, 20),
    // This row is recovered only from full-page OCR words located inside region 3.
    word('2:1', 290, 106),
    word('23', 290, 123),
  ];

  const rows = parser.parseSelectedRegions(crops, pageWords, 500, 400);
  assert.equal(rows.length, 4);
  assert.equal(rows.every((row) => row.highlighted), true);
  assert.deepEqual(JSON.stringify(rows.slice(0, 3).map(({ selection, odds }) => [selection, odds])),
    JSON.stringify([['1:0', 12], ['1:2', 17], ['2:1', 23]]));
  assert.equal(rows[3].unrecognized, true);
  assert.equal(rows[3].needsReview, true);
});

test('root page and Sites Worker serve the same OCR assets without sending the image', async () => {
  assert.match(html, /<script src="\/ocr-parser\.js"><\/script>/);
  assert.match(html, /<script src="\/ocr-ui\.js"><\/script>/);
  const parserResponse = await worker.fetch(new Request('https://monitor.example/ocr-parser.js'), {});
  const uiResponse = await worker.fetch(new Request('https://monitor.example/ocr-ui.js'), {});
  assert.equal(await parserResponse.text(), source);
  assert.equal(await uiResponse.text(), uiSource);
  assert.match(uiSource, /worker\.recognize\(canvases\.ocr/);
  assert.match(uiSource, /recognizeSelectedRegions/);
  assert.match(uiSource, /mergeSelectedRegionWords/);
  assert.match(uiSource, /SINGLE_BLOCK/);
  assert.match(uiSource, /selectionWhitelist/);
  assert.match(uiSource, /selectionLabelConfidence/);
  assert.match(uiSource, /parseSelectedRegions/);
  assert.match(uiSource, /按选区建立/);
  assert.doesNotMatch(uiSource, /匹配到/);
  assert.match(uiSource, /\[colorCanvas, ocrCanvas\]/);
  assert.match(uiSource, /offsetX: paddingX/);
  assert.match(uiSource, /ocrConfirm/);
  assert.match(uiSource, /逐项核对/);
  assert.doesNotMatch(uiSource, /FormData|fetch\(screenshotFile/);
  const payloadCode = uiSource.slice(uiSource.indexOf('function buildOcrPayload'), uiSource.indexOf('function clearOcr'));
  assert.doesNotMatch(payloadCode, /screenshotFile|screenshotUrl|data:image/);
});
