import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../parlay-parser.js', import.meta.url), 'utf8');
const context = {};
vm.runInNewContext(source, context);
const parser = context.MatchMonitorParlayParser;

const tokenWidth = (text) => [...text].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 16 : 8), 0);

// Each row is a list of OCR words; the parser receives only their boxes and text.
function words(rows) {
  const result = [];
  rows.forEach((tokens, row) => {
    let left = 20;
    for (const token of tokens) {
      const width = tokenWidth(token);
      result.push({
        text: token,
        confidence: 96,
        bbox: { x0: left, y0: 20 + row * 26, x1: left + width, y1: 36 + row * 26 },
      });
      left += width + 10;
    }
  });
  return result;
}

const row = (line) => line.split('|');
const parse = (rows) => parser.parseParlayReceipt(words(rows.map(row)), 900, 400);
const legs = (receipt) => JSON.parse(JSON.stringify(receipt.legs.map((leg) => ({
  home: leg.home,
  away: leg.away,
  selections: leg.selections.map((pick) => ({
    market: pick.market, selection: pick.selection, odds: pick.odds, handicap: pick.handicap, line: pick.line,
  })),
}))));

const footballTicket = (...legs) => [
  '竞彩足球|2场-2关|1倍|1注|2元',
  ...legs,
  '预计奖金|6.50-8.80元',
];
const basketballTicket = (...legs) => [
  '竞彩篮球|2场-2关|1倍|1注|2元',
  ...legs,
  '预计奖金|6.50-8.80元',
];

test('reads the SP whether it is parenthesized or printed bare next to the option', () => {
  const bare = parse(footballTicket(
    '周六001|曼城|VS|阿森纳', '胜平负|主胜|2.45',
    '周六002|利物浦|VS|切尔西', '胜平负|平|3.30',
  ));
  assert.equal(bare.matched, true);
  assert.deepEqual(legs(bare).map((leg) => leg.selections[0].selection), ['主胜', '平']);
  assert.deepEqual(legs(bare).map((leg) => leg.selections[0].odds), [2.45, 3.3]);

  const parenthesized = parse(footballTicket(
    '周六001|曼城|VS|阿森纳', '胜平负|客胜(2.45)',
    '周六002|利物浦|VS|切尔西', '胜平负|平（3.30）',
  ));
  assert.deepEqual(legs(parenthesized).map((leg) => leg.selections[0].selection), ['客胜', '平']);
  assert.deepEqual(legs(parenthesized).map((leg) => leg.selections[0].odds), [2.45, 3.3]);
});

test('never reads the SP as the handicap line, including a parenthesized line', () => {
  const receipt = parse(footballTicket(
    '周六001|曼城|VS|阿森纳', '让球胜平负|让球|-1|主胜|3.60',
    '周六002|利物浦|VS|切尔西', '让球胜平负(+1)|客胜|4.20',
  ));
  assert.deepEqual(legs(receipt).map((leg) => leg.selections[0]), [
    { market: 'handicap', selection: '主胜', odds: 3.6, handicap: -1, line: null },
    { market: 'handicap', selection: '客胜', odds: 4.2, handicap: 1, line: null },
  ]);

  const basketball = parse(basketballTicket(
    '周六301|客队：湖人|VS|主队：凯尔特人', '让分胜负(-5.5)|主胜|1.85',
    '周日302|客队：勇士|VS|主队：太阳', '让分胜负(4.5)|客胜|1.90',
  ));
  assert.deepEqual(legs(basketball).map((leg) => leg.selections[0]), [
    { market: 'basketball_handicap', selection: '主胜', odds: 1.85, handicap: -5.5, line: null },
    { market: 'basketball_handicap', selection: '客胜', odds: 1.9, handicap: 4.5, line: null },
  ]);
});

test('parses the printed （客11-15）@4.800元 winning-margin layout', () => {
  const receipt = parse(basketballTicket(
    '周六301|客队：布鲁克林|篮网|VS|主队：印第安纳|步行者', '胜分差|（客11-15）@4.800元',
    '周日302|客队：金州|勇士|VS|主队：菲尼克斯|太阳', '胜分差|（主6-10）@5.200元',
  ));
  assert.deepEqual(legs(receipt).map((leg) => leg.selections[0]), [
    { market: 'basketball_margin', selection: '客胜11-15分', odds: 4.8, handicap: null, line: null },
    { market: 'basketball_margin', selection: '主胜6-10分', odds: 5.2, handicap: null, line: null },
  ]);
});

test('parses score, total-goals and half/full-time legs in the wrapped receipt layout', () => {
  const receipt = parse(footballTicket(
    '周六001|曼城|VS|阿森纳', '比分|（2:0）13.00',
    '周六002|利物浦|VS|切尔西', '比分|（负其他）29.00',
  ));
  assert.deepEqual(legs(receipt).map((leg) => leg.selections[0].selection), ['2:0', '负其他']);
  assert.deepEqual(legs(receipt).map((leg) => leg.selections[0].market), ['correct_score', 'correct_score']);

  const goals = parse(footballTicket(
    '周六001|曼城|VS|阿森纳', '总进球|（3）3.60',
    '周六002|利物浦|VS|切尔西', '总进球|（7+）21.00',
  ));
  assert.deepEqual(legs(goals).map((leg) => leg.selections[0].selection), ['3', '7+']);

  const half = parse(footballTicket(
    '周六001|曼城|VS|阿森纳', '半全场|（胜胜）2.10',
    '周六002|利物浦|VS|切尔西', '半全场|（负平）15.00',
  ));
  assert.deepEqual(legs(half).map((leg) => leg.selections[0].selection), ['胜胜', '负平']);
});

test('reads the basketball total line from the header and from the option row', () => {
  const receipt = parse(basketballTicket(
    '周六301|客队：湖人|VS|主队：凯尔特人', '大小分|215.5|大|1.75',
    '周日302|客队：勇士|VS|主队：太阳', '大小分|228.5|小|1.90',
  ));
  assert.deepEqual(legs(receipt).map((leg) => leg.selections[0]), [
    { market: 'basketball_total', selection: '大', odds: 1.75, handicap: null, line: 215.5 },
    { market: 'basketball_total', selection: '小', odds: 1.9, handicap: null, line: 228.5 },
  ]);
});

test('takes the basketball home side from an explicit 主队/客队 label either way round', () => {
  const awayFirst = parse(basketballTicket(
    '周六301|客队：湖人|VS|主队：凯尔特人', '胜负|主胜|1.55',
    '周日302|客队：勇士|VS|主队：太阳', '胜负|客胜|1.62',
  ));
  assert.deepEqual(legs(awayFirst).map(({ home, away }) => [home, away]), [
    ['凯尔特人', '湖人'], ['太阳', '勇士'],
  ]);
  assert.equal(awayFirst.warnings.some((w) => /主客顺序/.test(w)), false);
  assert.deepEqual(legs(awayFirst).map((leg) => leg.selections[0].market), ['basketball_result', 'basketball_result']);

  const homeFirst = parse(basketballTicket(
    '周六301|主队：凯尔特人|VS|客队：湖人', '胜负|主胜|1.55',
    '周日302|主队：太阳|VS|客队：勇士', '胜负|客胜|1.62',
  ));
  assert.deepEqual(legs(homeFirst).map(({ home, away }) => [home, away]), [
    ['凯尔特人', '湖人'], ['太阳', '勇士'],
  ]);
});

test('keeps an OCR-split Chinese team name searchable', () => {
  const receipt = parse(basketballTicket(
    '周六301|客队：布鲁克林|篮网|VS|主队：印第安纳|步行者', '胜负|主胜|1.55',
    '周日302|客队：金州|勇士|VS|主队：菲尼克斯|太阳', '胜负|客胜|1.62',
  ));
  assert.deepEqual(legs(receipt).map(({ home, away }) => [home, away]), [
    ['印第安纳步行者', '布鲁克林篮网'], ['菲尼克斯太阳', '金州勇士'],
  ]);
});

test('refuses to guess a basketball market when the 让分 heading is unreadable', () => {
  const receipt = parse(basketballTicket(
    '周六301|客队：湖人|VS|主队：凯尔特人', '-5.5|主胜|1.85|客胜|1.95',
    '周日302|客队：勇士|VS|主队：太阳', '4.5|主胜|1.90|客胜|1.90',
  ));
  assert.ok(receipt.warnings.some((w) => w.includes('第1场未识别玩法')));
  assert.deepEqual(legs(receipt).map((leg) => leg.selections.length), [0, 0]);
});

test('counts a 3场2关 system pass as 3串3 with three elementary bets', () => {
  const receipt = parser.parseParlayReceipt(words([
    '竞彩足球|3场|过关2关|3注|6元',
    '周六001|曼城|VS|阿森纳', '胜平负|主胜|2.45',
    '周六002|利物浦|VS|切尔西', '胜平负|平|3.30',
    '周六003|热刺|VS|纽卡', '胜平负|客胜|2.80',
    '预计奖金|8.00-19.00元',
  ].map(row)), 900, 400);
  assert.equal(receipt.passType, '3串3');
  assert.equal(receipt.betCount, 3);
  assert.equal(receipt.total, 6);
  assert.equal(receipt.warnings.some((w) => /注数为3注/.test(w)), false);
  assert.equal(receipt.warnings.some((w) => /金额/.test(w)), false);
});

test('keeps a readable 2串1 pass and warns when a leg carries more than one pick', () => {
  const clean = parse(footballTicket(
    '周六001|曼城|VS|阿森纳', '胜平负|主胜|2.45',
    '周六002|利物浦|VS|切尔西', '胜平负|平|3.30',
  ));
  assert.equal(clean.passType, '2串1');
  assert.equal(clean.betCount, 1);
  assert.equal(clean.warnings.some((w) => /多个投注项|注数为|金额/.test(w)), false);

  const doubled = parse(basketballTicket(
    '周六301|客队：湖人|VS|主队：凯尔特人', '大小分|215.5', '大|1.75|小|1.95',
    '周日302|客队：勇士|VS|主队：太阳', '大小分|228.5', '大|1.80|小|1.90',
  ));
  assert.equal(doubled.legs[0].selections.length, 2);
  assert.equal(doubled.betCount, 4);
  assert.ok(doubled.warnings.some((w) => w.includes('多个投注项')));
  assert.ok(doubled.warnings.some((w) => w.includes('票面注数为1注')));
});

test('ignores footer lines so they cannot change the last leg', () => {
  const receipt = parser.parseParlayReceipt(words([
    '竞彩篮球|2场-2关|1倍|1注|2元',
    '周六301|客队：湖人|VS|主队：凯尔特人', '胜负|主胜|1.55',
    '周日302|客队：勇士|VS|主队：太阳', '胜负|客胜|1.62',
    '投注助手|已选2|过关2关', '1注2元', '预计奖金|4.20-5.20元', '2倍',
  ].map(row)), 900, 400);
  assert.equal(receipt.matched, true);
  assert.deepEqual(legs(receipt).map((leg) => leg.selections.map((pick) => `${pick.selection}@${pick.odds}`)), [
    ['主胜@1.55'], ['客胜@1.62'],
  ]);
});

test('builds import JSON with normalized selections for each recognized leg', () => {
  const receipt = parse(basketballTicket(
    '周六301|客队：湖人|VS|主队：凯尔特人', '胜分差|（客11-15）@4.800元',
    '周日302|客队：勇士|VS|主队：太阳', '胜分差|（主6-10）@5.200元',
  ));
  const json = JSON.parse(JSON.stringify(parser.receiptToImportJson(receipt)));
  assert.equal(json.type, 'sportsmatch.parlay_receipt');
  assert.equal(json.sport, 'basketball');
  assert.deepEqual(json.legs.map((leg) => leg.home), ['凯尔特人', '太阳']);
  assert.deepEqual(json.legs.map((leg) => leg.selections[0]), [
    { market: 'basketball_margin', selection: '客胜11-15分', odds: 4.8, handicap: null, line: null },
    { market: 'basketball_margin', selection: '主胜6-10分', odds: 5.2, handicap: null, line: null },
  ]);
});

test('does not claim a parlay from a single-game or unrelated screenshot', () => {
  const single = parser.parseParlayReceipt(words([
    ['竞彩篮球胜分差', '1场-单场固定', '1倍', '合计2元'],
    ['客队：印第安纳步行者', 'VS', '主队：布鲁克林篮网'],
    ['（客11-15）@4.800元'],
  ]), 600, 400);
  assert.equal(single.matched, false);

  const unrelated = parser.parseParlayReceipt(words([['比分', '2:0', '13']]), 400, 300);
  assert.equal(unrelated.matched, false);
});
