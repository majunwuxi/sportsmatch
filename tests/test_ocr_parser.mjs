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
    { market: 'handicap', selection: '主胜', handicap: -1, odds: 5.05 },
    { market: 'match_result', selection: '客胜', handicap: null, odds: 2.45 },
  ]));
});

test('parses a photographed Chinese basketball winning-margin receipt locally', () => {
  const words = [
    word('第2610252期', 20, 40),
    word('竞彩篮球胜分差', 20, 80),
    word('1场-单场固定 1倍 合计2元', 20, 120),
    word('客队：印第安纳步行者 VS 主队：布鲁克林篮网', 20, 160),
    word('（客11-15）@4.800元', 20, 200),
    word('本票最高可能固定奖金：9.60元', 20, 240),
  ];
  const result = parser.parseBasketballTicket(words, 600, 400);
  assert.equal(result.matched, true);
  assert.equal(result.market, 'basketball_margin');
  assert.equal(result.issueNumber, '2610252');
  assert.deepEqual(JSON.parse(JSON.stringify(result.fixture)), {
    away: '印第安纳步行者', home: '布鲁克林篮网',
  });
  assert.equal(result.totalStake, 2);
  assert.equal(result.maxPayout, 9.6);
  assert.deepEqual(JSON.parse(JSON.stringify(result.picks.map(({ market, selection, odds, stake, enabled }) => ({ market, selection, odds, stake, enabled })))), [{
    market: 'basketball_margin', selection: '客胜11-15分', odds: 4.8, stake: 2, enabled: true,
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(parser.validatePick(result.picks[0]))), { ok: true, reason: '有效' });
  assert.match(uiSource, /basketballTicket\.fixture\.away/);
  assert.match(uiSource, /basketballTicket\.maxPayout/);
  assert.match(uiSource, /篮球纸质票识别/);
  assert.doesNotMatch(uiSource, /FormData|fetch\(screenshotFile/);
});

test('recognizes split 负其它 text as a valid correct-score selection', () => {
  const words = [
    word('比分', 150, 20),
    word('负', 90, 100, 94, 14),
    word('其', 104, 100, 94, 14),
    word('它', 118, 100, 94, 14),
    word('6.5', 90, 122, 94, 28),
  ];
  const row = parser.parse(words, 320, 300)[0];
  assert.equal(row.selection, '负其它');
  assert.equal(row.market, 'correct_score');
  assert.equal(row.odds, 6.5);
  assert.equal(parser.validatePick({ market: row.market, selection: row.selection, odds: row.odds }).ok, true);
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

test('builds the other-score exclusion set from every recognized exact score with SP', () => {
  const rows = [
    { market: 'correct_score', selection: '5:2', odds: 18, highlighted: false },
    { market: 'correct_score', selection: '5:2', odds: 18, highlighted: true },
    { market: 'correct_score', selection: '0:1', odds: 7.5, highlighted: true },
    { market: 'correct_score', selection: '负其它', odds: 29, highlighted: true },
    { market: 'correct_score', selection: '4:1', odds: null, highlighted: false },
    { market: 'match_result', selection: '胜', odds: 2.3, highlighted: false },
  ];
  assert.deepEqual(JSON.stringify(parser.listedScoresFromRows(rows)), JSON.stringify(['5:2', '0:1']));
  assert.deepEqual(JSON.stringify(parser.parseListedScores('5：2、0:1, 5:2\n2:0')), JSON.stringify({
    ok: true, scores: ['5:2', '0:1', '2:0'], invalid: [],
  }));
  const invalid = parser.parseListedScores('5:2,负其它');
  assert.equal(invalid.ok, false);
  assert.deepEqual(JSON.stringify(invalid.invalid), JSON.stringify(['负其它']));
});

test('includes exact-score SPs when OCR attaches upward or downward change arrows', () => {
  const exactScores = [
    '1:0', '2:0', '2:1', '3:0', '3:1', '3:2', '4:0', '4:1', '4:2', '5:0', '5:1', '5:2',
    '0:0', '1:1', '2:2', '3:3',
    '0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4', '1:4', '2:4', '0:5', '1:5', '2:5',
  ];
  const words = [word('比分', 420, 10)];
  exactScores.forEach((selection, index) => {
    const x = 40 + (index % 6) * 125;
    const y = 60 + Math.floor(index / 6) * 38;
    words.push(word(selection, x, y, 96, 36));
    if (selection === '1:1') {
      words.push(word('6', x, y + 19, 93, 10), word('.', x + 11, y + 19, 93, 4), word('5', x + 16, y + 19, 93, 10));
      return;
    }
    const odds = index === 4 ? '13.5' : index % 2 ? '18' : String(9 + index);
    words.push(word(odds + (index % 2 ? '↑' : ''), x, y + 19, 93, 30));
    if (index % 2 === 0) words.push(word('↓', x + 31, y + 19, 90, 10));
  });

  const rows = parser.parse(words, 800, 400);
  assert.equal(rows.length, exactScores.length);
  assert.deepEqual(JSON.stringify(parser.listedScoresFromRows(rows)), JSON.stringify(exactScores));
  assert.equal(rows.find((row) => row.selection === '3:1').odds, 13.5);
  assert.equal(rows.find((row) => row.selection === '1:1').odds, 6.5);
  assert.match(uiSource, /oddsWhitelist = "[^"]*↑↓/);
});

test('reconstructs the 28-cell correct-score grid from a sparse set of page labels', () => {
  const seen = ['1:0', '2:0', '3:1', '0:0', '1:1', '3:3', '0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4', '1:4', '2:4', '0:5', '2:5'];
  const positions = new Map([
    ...['1:0', '2:0', '2:1', '3:0', '3:1', '3:2', '4:0'].map((score, column) => [score, { row: 0, column }]),
    ...['4:1', '4:2', '5:0', '5:1', '5:2'].map((score, index) => [score, { row: 1, column: index }]),
    ...['0:0', '1:1', '2:2', '3:3'].map((score, column) => [score, { row: 2, column }]),
    ...['0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4'].map((score, column) => [score, { row: 3, column }]),
    ...['1:4', '2:4', '0:5', '1:5', '2:5'].map((score, index) => [score, { row: 4, column: index }]),
  ]);
  const pageRows = seen.map((selection) => ({
    market: 'correct_score', selection, confidence: 90,
    position: { x: 70 + positions.get(selection).column * 110, y: 100 + positions.get(selection).row * 50 },
  }));
  const grid = parser.inferScoreGrid(pageRows, 900, 420);
  assert.ok(grid);
  assert.equal(grid.recognizedLabels, seen.length);
  assert.equal(grid.cells.length, 28);
  assert.deepEqual(JSON.stringify(grid.cells.map((cell) => cell.selection)), JSON.stringify([
    '1:0', '2:0', '2:1', '3:0', '3:1', '3:2', '4:0', '4:1', '4:2', '5:0', '5:1', '5:2',
    '0:0', '1:1', '2:2', '3:3',
    '0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4', '1:4', '2:4', '0:5', '1:5', '2:5',
  ]));
  assert.ok(Math.abs(grid.cells.find((cell) => cell.selection === '5:1').center.x - (70 + 3 * 110)) < 1);
  assert.ok(Math.abs(grid.cells.find((cell) => cell.selection === '5:1').center.y - (100 + 50)) < 1);
});

test('extracts every grid-cell SP from a dedicated odds-band OCR pass', () => {
  const selections = [
    '1:0', '2:0', '2:1', '3:0', '3:1', '3:2', '4:0', '4:1', '4:2', '5:0', '5:1', '5:2',
    '0:0', '1:1', '2:2', '3:3',
    '0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4', '1:4', '2:4', '0:5', '1:5', '2:5',
  ];
  const cells = selections.map((selection, index) => {
    if (selection === '1:1') return {
      selection, cropWidth: 100, cropHeight: 50,
      words: [word('6', 30, 30, 94, 10), word('.', 41, 30, 90, 4), word('5', 46, 30, 94, 10)],
    };
    const odds = index === 4 ? '13.5↓' : String(9 + index) + (index % 2 ? '↑' : '↓');
    return { selection, cropWidth: 100, cropHeight: 50, words: [word(odds, 30, 30, 94, 35)] };
  });
  const rows = parser.parseScoreGridCells(cells);
  assert.equal(rows.length, 28);
  assert.deepEqual(JSON.stringify(parser.listedScoresFromRows(rows)), JSON.stringify(selections));
  assert.equal(rows.find((row) => row.selection === '3:1').odds, 13.5);
  assert.equal(rows.find((row) => row.selection === '1:1').odds, 6.5);
});

test('keeps all 28 table options available when an individual SP cannot be read', () => {
  const cells = parser.scoreGridRows.flat().map((selection) => ({
    selection,
    cropWidth: 100,
    cropHeight: 50,
    words: selection === '1:4' ? [] : [word('50', 30, 30, 94, 20)],
  }));
  const rows = parser.parseScoreGridCells(cells);
  assert.equal(rows.length, 28);
  assert.equal(rows.find((row) => row.selection === '1:4').odds, null);
  assert.equal(rows.find((row) => row.selection === '1:4').needsReview, true);
  assert.equal(parser.listedScoresFromRows(rows).length, 27);
  assert.match(uiSource, /const recoveredScores = scoreGridRows\.filter\(\(row\) => !presentScores\.has/);
  assert.match(uiSource, /缺失SP的标准比分仍列入候选项/);
});

test('adds a selected-region SP to the screenshot list when its score-grid cell read is missing', () => {
  const rows = parser.scoreGridRows.flat().map((selection) => ({
    market: 'correct_score', selection, odds: selection === '2:1' ? null : 10,
  }));
  const selectedRegion = { market: 'correct_score', selection: '2:1', odds: 7 };
  const combined = [...rows, selectedRegion];
  assert.equal(parser.listedScoresFromRows(rows).length, 27);
  assert.equal(parser.listedScoresFromRows(combined).length, 28);
  assert.match(uiSource, /scoreListRows = \[\.\.\.parsedPicks, \.\.\.pageCandidatesWithGrid, \.\.\.selectedRows, \.\.\.scoreGridRows\]/);
  assert.match(uiSource, /listedScoresFromRows\(scoreListRows\)/);
});

test('merges whole-page and per-cell SP reads without losing decimals or lower-confidence values', () => {
  const correctedDecimal = parser.preferScoreOdds(
    { market: 'correct_score', selection: '3:1', odds: 135, confidence: 91, highlighted: true },
    { market: 'correct_score', selection: '3:1', odds: 13.5, confidence: 72, highlighted: false },
  );
  assert.equal(correctedDecimal.odds, 13.5);
  assert.equal(correctedDecimal.highlighted, true);

  const correctedArrow = parser.preferScoreOdds(
    { market: 'correct_score', selection: '3:0', odds: 214, confidence: 84 },
    { market: 'correct_score', selection: '3:0', odds: 21, confidence: 80 },
  );
  assert.equal(correctedArrow.odds, 21);

  const retainsStrongerPageRead = parser.preferScoreOdds(
    { market: 'correct_score', selection: '3:2', odds: 18, confidence: 92 },
    { market: 'correct_score', selection: '3:2', odds: 16, confidence: 60 },
  );
  assert.equal(retainsStrongerPageRead.odds, 18);
  assert.match(uiSource, /preferScoreOdds\(row, gridRow\)/);
});

test('removes colored SP-change arrows and normalizes white-on-dark selected cells', () => {
  const ordinary = new Uint8ClampedArray([
    24, 24, 24, 255,       // black SP digits
    235, 235, 235, 255,    // pale cell background
    30, 165, 75, 255,      // green down arrow
    205, 52, 62, 255,      // red up arrow
  ]);
  parser.preprocessScoreOddsPixels(ordinary, false, 190, 24);
  assert.deepEqual([...ordinary], [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);

  const selected = new Uint8ClampedArray([
    82, 91, 133, 255,      // dark selected fill
    248, 248, 248, 255,    // white SP digits
    24, 165, 75, 255,      // colored arrow on selected fill
  ]);
  parser.preprocessScoreOddsPixels(selected, true, 190, 24);
  assert.deepEqual([...selected], [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  const noisyDecimal = parser.parseScoreGridCells([{
    selection: '2:0', cropWidth: 200, cropHeight: 60,
    words: [word('.12.5', 70, 30, 88, 40)],
  }]);
  assert.equal(noisyDecimal[0].odds, 12.5);
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

test('detects red selected cells separately and ignores the adjacent green market label', () => {
  const width = 320, height = 180;
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
  fill(10, 15, 50, 165, [100, 183, 127]); // vertical green “总进球” heading
  fill(50, 70, 120, 125, [208, 1, 27]);
  fill(120, 70, 124, 125, [90, 90, 90]); // dark cell divider must not join the picks
  fill(124, 70, 194, 125, [208, 1, 27]);
  fill(235, 20, 305, 75, [208, 1, 27]);

  const regions = parser.detectSelectedRegions(pixels, width, height);
  assert.equal(regions.length, 3);
  assert.deepEqual(JSON.stringify(regions), JSON.stringify([
    { x0: 235, y0: 20, x1: 305, y1: 75 },
    { x0: 50, y0: 70, x1: 120, y1: 125 },
    { x0: 124, y0: 70, x1: 194, y1: 125 },
  ]));
});

test('uses a vertically written 总进球 heading to classify selected number and SP crops', () => {
  const pageWords = [word('总', 24, 175, 94, 18), word('进', 24, 250, 94, 18), word('球', 24, 325, 94, 18)];
  const regions = [
    { x0: 800, y0: 100, x1: 900, y1: 200 },
    { x0: 500, y0: 320, x1: 600, y1: 420 },
  ];
  const cropResults = regions.map((region, index) => ({
    region,
    cropWidth: 100,
    cropHeight: 100,
    words: [word(index ? '5' : '3', 30, 8, 96, 14), word(index ? '6.00' : '3.65', 30, 55, 96, 34)],
  }));

  assert.equal(parser.marketAt(150, pageWords, 589, 850), 'total_goals');
  assert.equal(parser.marketAt(370, pageWords, 589, 550), 'total_goals');
  const rows = parser.parseSelectedRegions(cropResults, pageWords, 1536, 589);
  assert.deepEqual(JSON.stringify(rows.map(({ market, selection, odds, highlighted, unrecognized }) =>
    ({ market, selection, odds, highlighted, unrecognized }))), JSON.stringify([
    { market: 'total_goals', selection: '3', odds: 3.65, highlighted: true, unrecognized: false },
    { market: 'total_goals', selection: '5', odds: 6, highlighted: true, unrecognized: false },
  ]));
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

test('scores crop OCR using the page market and preserves SP when its option label is uncertain', () => {
  const region = { x0: 100, y0: 100, x1: 200, y1: 150 };
  const metadata = { region, scaleX: 4, scaleY: 4, cropWidth: 480, cropHeight: 280, offsetX: 40, offsetY: 40 };
  const pageWords = [word('比分', 180, 20)];
  const incomplete = { ...metadata, words: [word('负', 180, 60, 93), word('29', 180, 160, 95)] };
  const complete = { ...metadata, words: [word('负其他', 165, 60, 90, 46), word('29', 180, 160, 95)] };

  assert.equal(parser.marketAt(125, pageWords, 400), 'correct_score');
  assert.equal(parser.marketAt(520, [word('比分', 180, 20), word('总进球', 180, 650)], 1000), 'correct_score');
  assert.equal(parser.selectionLabelConfidence(incomplete.words, 480, 280, 'correct_score'), -1);
  assert.ok(parser.scoreSelectedCrop(complete, pageWords, 400, 400) > parser.scoreSelectedCrop(incomplete, pageWords, 400, 400));

  const incompleteRow = parser.parseSelectedRegions([incomplete], pageWords, 400, 400)[0];
  assert.equal(incompleteRow.unrecognized, true);
  assert.equal(incompleteRow.odds, 29);
  const completeRow = parser.parseSelectedRegions([complete], pageWords, 400, 400)[0];
  assert.equal(completeRow.market, 'correct_score');
  assert.equal(completeRow.selection, '负其他');
  assert.equal(completeRow.odds, 29);
  assert.equal(completeRow.unrecognized, false);
});

test('uses correct-score context to prefer complete score labels over clipped score and result text', () => {
  const region = { x0: 100, y0: 100, x1: 200, y1: 150 };
  const metadata = { region, scaleX: 4, scaleY: 4, cropWidth: 480, cropHeight: 280, offsetX: 40, offsetY: 40 };
  const pageWords = [word('比分', 180, 20)];
  const cases = [
    { partial: [word('2', 180, 60, 94), word('13', 180, 160, 96)], complete: [word('2:0', 165, 60, 90, 44), word('13', 180, 160, 96)] },
    { partial: [word('0', 180, 60, 94), word('31', 180, 160, 96)], complete: [word('0:3', 165, 60, 90, 44), word('31', 180, 160, 96)] },
    { partial: [word('负', 180, 60, 94), word('50', 180, 160, 96)], complete: [word('负其他', 160, 60, 90, 56), word('50', 180, 160, 96)] },
  ];
  for (const { partial, complete } of cases) {
    const incomplete = { ...metadata, words: partial };
    const recovered = { ...metadata, words: complete };
    assert.ok(parser.scoreSelectedCrop(recovered, pageWords, 400, 400) > parser.scoreSelectedCrop(incomplete, pageWords, 400, 400));
    const row = parser.parseSelectedRegions([recovered], pageWords, 400, 400)[0];
    assert.equal(row.unrecognized, false);
    assert.equal(parser.validatePick({ market: row.market, selection: row.selection, odds: row.odds }).ok, true);
  }
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
  assert.match(uiSource, /recognizeSelectedRegions\([\s\S]*?selectionRegions,[\s\S]*?pageWords,[\s\S]*?canvases\.width,[\s\S]*?canvases\.height/);
  assert.match(uiSource, /mergeSelectedRegionWords/);
  assert.match(uiSource, /SINGLE_BLOCK/);
  assert.match(uiSource, /selectionWhitelist/);
  assert.match(uiSource, /scoreSelectedCrop/);
  assert.match(uiSource, /recognizeBand/);
  assert.match(uiSource, /preprocessScoreOddsPixels/);
  assert.match(uiSource, /recognizeScoreGridCells\(worker, canvases\.color, scoreGrid/);
  assert.match(uiSource, /阈值复核/);
  assert.match(uiSource, /contentHeight \* 0\.58/);
  assert.match(uiSource, /contentHeight \* 0\.54/);
  assert.match(uiSource, /SINGLE_LINE/);
  assert.match(uiSource, /selectionWhitelist = "[^"]*它[^"]*"/);
  assert.match(uiSource, /labelWhitelist = "[^"]*它[^"]*"/);
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

test('adapts PaddleOCR polygon results into parser word boxes with confidence', () => {
  const words = parser.paddleWordsFromResult({ items: [
    { text: '12.5', score: 0.987, poly: [[10, 20], [48, 18], [50, 38], [12, 40]] },
    { text: '', score: 0.9, poly: [[1, 1], [2, 1], [2, 2]] },
    { text: 'bad-box', score: 0.8, poly: [] },
  ] });
  assert.equal(words.length, 1);
  assert.equal(words[0].text, '12.5');
  assert.equal(words[0].confidence, 99);
  assert.deepEqual(JSON.parse(JSON.stringify(words[0].bbox)), { x0: 10, y0: 18, x1: 50, y1: 40 });
});

test('uses pinned PaddleOCR.js PP-OCRv5 in the browser with Tesseract fallback', () => {
  assert.match(html, /<script type="importmap">/);
  assert.match(uiSource, /@paddleocr\/paddleocr-js@0\.4\.2\/dist\/index\.mjs/);
  assert.match(uiSource, /ocrVersion: "PP-OCRv5"/);
  assert.match(uiSource, /backend: "wasm"/);
  assert.match(uiSource, /PaddleOCR\.create/);
  assert.match(uiSource, /worker: false/);
  assert.match(uiSource, /createPaddle = async \(\) => PaddleOCR\.create\(\{ \.\.\.paddleOcrOptions, worker: false \}\)/);
  assert.doesNotMatch(uiSource, /createPaddle\(true\)/);
  assert.match(uiSource, /createTesseractWorker/);
  assert.match(uiSource, /recognizeBatch/);
  assert.match(uiSource, /图片仅在本机浏览器识别/);
});
