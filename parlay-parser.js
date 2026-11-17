(function (root) {
  "use strict";

  function parseOdds(line) {
    const patterns = [
      /(?:赔率|SP|@)\s*[:：]?\s*(\d{1,3}(?:\.\d{1,4})?)/i,
      /[胜平负]\s*[@]\s*(\d{1,3}(?:\.\d{1,4})?)/,
      /(?:赔率|SP)\s*(\d{1,3}(?:\.\d{1,4})?)/i
    ];
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function parseSelection(line) {
    const text = line.replace(/[“”"'`]/g, "");
    const basketballText = text.replace(/(?:赔率|SP|@)[^\s]*/ig, "");
    const footballResult = value => normalizeOutcomeSelection("match_result", value);
    let match = basketballText.match(/(?:竞彩篮球|篮球)\s*胜分差\s*[:：]?\s*(主胜|主队胜|客胜|客队胜)\s*(1-5|6-10|11-15|16-20|21-25|26\+|26分以上|26分及以上)\s*分?/);
    if (match) {
      const side = /客/.test(match[1]) ? "客胜" : "主胜";
      const band = match[2].startsWith("26") ? "26+" : match[2];
      return {market: "basketball_margin", selection: side + band + "分", sport: "basketball"};
    }
    match = basketballText.match(/(?:竞彩篮球|篮球)\s*(?:大小分|大小|总分)\s*[:：]?\s*(大|小)\s*([0-9]+(?:\.5)?)/);
    if (match) return {market: "basketball_total", selection: match[1], line: Number(match[2]), sport: "basketball"};
    match = basketballText.match(/(?:竞彩篮球|篮球)\s*让分(?:胜负)?[^\d+-]{0,12}([+-]?\d+(?:\.5)?)\s*(?:分)?[^\u3400-\u9fff]{0,4}(主队胜|客队胜|主胜|客胜|胜|负)/);
    if (match) return {market: "basketball_handicap", selection: normalizeOutcomeSelection("basketball_handicap", match[2]), handicap: Number(match[1]), sport: "basketball"};
    match = basketballText.match(/(?:竞彩篮球|篮球)\s*让分(?:胜负)?[^\u3400-\u9fff]{0,12}(主队胜|客队胜|主胜|客胜|胜|负)[^\d+-]{0,12}([+-]?\d+(?:\.5)?)/);
    if (match) return {market: "basketball_handicap", selection: normalizeOutcomeSelection("basketball_handicap", match[1]), handicap: Number(match[2]), sport: "basketball"};
    match = basketballText.match(/(?:竞彩篮球|篮球)\s*胜负\s*[:：]?\s*(主队胜|客队胜|主胜|客胜|胜|负)/);
    if (match) return {market: "basketball_result", selection: normalizeOutcomeSelection("basketball_result", match[1]), sport: "basketball"};
    match = text.match(/(?:半全场|半场全场|半全)\s*[:：]?\s*(胜胜|胜平|胜负|平胜|平平|平负|负胜|负平|负负)/);
    if (match) return {market: "half_full", selection: match[1]};
    match = text.match(/(?:比分|猜比分|正确比分)\s*[:：]?\s*(\d{1,2})\s*[:：-]\s*(\d{1,2})/);
    if (match) return {market: "correct_score", selection: match[1] + ":" + match[2]};
    match = text.match(/(?:总进球|进球数)\s*[:：]?\s*(7\+|[0-7])/);
    if (match) return {market: "total_goals", selection: match[1]};
    match = text.match(/(?:让球|让球胜平负)\s*([+-]?\d+)\s*(胜|平|负)/);
    if (match) return {market: "handicap", selection: match[2], handicap: Number(match[1])};
    match = text.match(/(?:主队胜|客队胜|主胜|客胜|主负|客负|胜|平局|平|负)/);
    if (!match) return null;
    const word = match[0];
    const selection = footballResult(word);
    return {market: "match_result", selection};
  }

  function parseMatchup(line) {
    const source = line
      .replace(/^\s*(?:[-*•]\s*)?(?:第\s*\d+\s*场|比赛\s*\d+|\d+\s*[.、)]\s*[:：]?)\s*/i, "")
      .replace(/\b周[一二三四五六日]\s*[A-Z]?\d{3,5}\b/gi, " ")
      .replace(/(?:主队|主隊)\s*[:：]?/g, "")
      .replace(/(?:客队|客隊)\s*[:：]?/g, "");
    const match = source.match(/^(.+?)\s*(?:\bvs\.?\b|\bvs\b|\bv\.?\b|对阵| VS | VS| vs | Vs )\s*(.+)$/i);
    if (!match) return null;
    const stop = /[,，。;；\n]|(?:竞彩篮球|篮球|胜分差|大小分|让分胜负|总进球|比分|让球|半全场|买|投注|选择|选项|玩法|赔率|SP|主胜|客胜|胜|平|负)/i;
    const clean = value => {
      const end = value.search(stop);
      return (end < 0 ? value : value.slice(0, end)).replace(/[·•：:|,，。;；]+$/g, "").trim();
    };
    const home = clean(match[1]);
    const away = clean(match[2]);
    if (!home || !away || home.length > 80 || away.length > 80) return null;
    return {home, away};
  }


  function parseParlayText(raw) {
    const text = String(raw || "").normalize("NFKC").replace(/\*\*/g, "");
    const passMatch = text.match(/(\d+)\s*(?:串|[x×*])\s*(\d+)/i);
    const multiplesMatch = text.match(/(\d+)\s*倍/);
    const totalMatch = text.match(/(?:合计|总金额|投注总额|投注金额|共计|总投注)[^\d]{0,16}(?:人民币|¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*元?/i);
    const payoutMatch = text.match(/(?:最高奖金|最高可中|最高可得|预计最高奖金|最高返奖)[^\d]{0,48}(?:人民币|¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*元?/i);
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const legs = [];
    for (const line of lines) {
      if (!/(?:\bvs\b|对阵|主队|第\s*\d+\s*场)/i.test(line)) continue;
      const matchup = parseMatchup(line);
      const pick = parseSelection(line);
      if (!matchup || !pick) continue;
      legs.push({...matchup, ...pick, odds: parseOdds(line), fixture_id: null, kickoff: null, league_name: null});
    }
    const warnings = [];
    if (!passMatch) warnings.push("未识别过关方式，请手动选择。");
    if (!legs.length) warnings.push("未识别到比赛腿；请按“第1场：主队 VS 客队，玩法选项，赔率SP”的格式补充。");
    if (legs.some(leg => !leg.odds)) warnings.push("有比赛腿缺少有效SP，请在表格中补录。");
    if (passMatch && Number(passMatch[1]) !== legs.length) warnings.push("过关方式场次数与识别的比赛腿数量不一致，请核对。");
    return {
      passType: passMatch ? `${Number(passMatch[1])}串${Number(passMatch[2])}` : null,
      multiples: multiplesMatch ? Number(multiplesMatch[1]) : null,
      total: totalMatch ? Number(totalMatch[1]) : null,
      payout: payoutMatch ? Number(payoutMatch[1]) : null,
      legs,
      warnings: warnings.map(value => value.trim())
    };
  }

  function combinationCount(total, size) {
    if (!Number.isInteger(total) || !Number.isInteger(size) || size < 1 || size > total) return null;
    let value = 1;
    for (let step = 1; step <= size; step++) value = value * (total - size + step) / step;
    return Math.round(value);
  }

  // Number of elementary bets in an "N串M" pass: every M-leg combination of the
  // ticket contributes one bet per combination of the selections printed on it.
  function combinationBets(legs, size) {
    let total = 0;
    const walk = (start, remaining, product) => {
      if (!remaining) { total += product; return; }
      for (let index = start; index <= legs.length - remaining; index++) {
        walk(index + 1, remaining - 1, product * (legs[index].selections.length || 1));
      }
    };
    walk(0, size, 1);
    return total || 1;
  }

  // OCR splits Chinese team names into separate words. Rows keep a space
  // between words so option labels stay readable, but a gap inside a team name
  // would turn "印第安纳步行者" into a name that no fixture search can match.
  const stripCjkSpaces = value => String(value || "").replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1");

  function receiptLines(words, height) {
    const valid = (words || []).filter(word => String(word?.text || "").trim()
      && Number(word.confidence ?? 100) >= 15);
    const box = word => {
      const b = word?.bbox || {};
      const left = Number(b.x0 ?? word?.left ?? 0), top = Number(b.y0 ?? word?.top ?? 0);
      const right = Number(b.x1 ?? (left + Number(word?.width || 0)));
      const bottom = Number(b.y1 ?? (top + Number(word?.height || 0)));
      return {left, top, right, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2};
    };
    const tolerance = Math.max(6, Number(height || 1) * 0.014);
    const rows = [];
    for (const word of valid.sort((a, b) => box(a).cy - box(b).cy || box(a).left - box(b).left)) {
      const b = box(word);
      let row = rows.find(item => Math.abs(item.cy - b.cy) <= tolerance);
      if (!row) { row = {items: [], cy: b.cy}; rows.push(row); }
      row.items.push({word, box: b});
      row.cy = row.items.reduce((sum, item) => sum + item.box.cy, 0) / row.items.length;
    }
    return rows.sort((a, b) => a.cy - b.cy).map(row => {
      const items = row.items.sort((a, b) => a.box.left - b.box.left);
      const spaced = items.map(item => String(item.word.text).normalize("NFKC").trim()).join(" ");
      const compact = spaced.replace(/[\s\u200b\ufeff]/g, "");
      return {text: spaced, compact, y: row.cy};
    }).filter(row => row.compact);
  }

  function receiptMatchup(line, sport) {
    const source = String(line || "")
      .normalize("NFKC")
      .replace(/周[一二三四五六日]\s*[A-Z]?\d{3,5}/gi, " ")
      .replace(/\b(?:NBA|WNBA)\b/gi, " ")
      .replace(/\b\d{1,2}:\d{2}\b/g, " ");
    const match = source.match(/(.+?)\s*(?:VS?\.?|对阵)\s*(.+)/i);
    if (!match) return null;
    const clean = value => value
      .replace(/[\[【(（]\s*主\s*[\]】)）]/g, "")
      .replace(/(?:竞彩足球|竞彩篮球|胜平负|胜分差|让分胜负|让球胜平负|总进球|大小分|比分|半全场|胜负).*$/i, "")
      .replace(/(?:场次|比赛|主队|客队)[:：]?/g, "")
      .replace(/[·.,;；]/g, "")
      .trim();
    const left = stripCjkSpaces(clean(match[1])), right = stripCjkSpaces(clean(match[2]));
    if (!left || !right || left.length > 50 || right.length > 50) return null;
    const homeMarked = value => /[\[【(（]\s*主\s*[\]】)）]|主队|主隊/.test(value);
    const awayMarked = value => /[\[【(（]\s*客\s*[\]】)）]|客队|客隊/.test(value);
    if (homeMarked(match[1]) && !homeMarked(match[2])) return {home: left, away: right, homeOrderKnown: true};
    if (homeMarked(match[2]) && !homeMarked(match[1])) return {home: right, away: left, homeOrderKnown: true};
    if (awayMarked(match[1]) && !awayMarked(match[2])) return {home: right, away: left, homeOrderKnown: true};
    if (awayMarked(match[2]) && !awayMarked(match[1])) return {home: left, away: right, homeOrderKnown: true};
    if (sport === "basketball") return {home: right, away: left, homeOrderKnown: false};
    return {home: left, away: right, homeOrderKnown: false};
  }

  function receiptMarket(block, sport) {
    if (sport === "basketball") {
      if (/胜分差/.test(block)) return "basketball_margin";
      if (/让分/.test(block)) return "basketball_handicap";
      if (/大小分|预设总分|总分/.test(block)) return "basketball_total";
      // 胜负 is printed without a line; only an explicit zero line may stand in
      // for it. Anything else would silently turn a 让分 leg into a money line.
      if (/(?:主队|客队)\s*[:：]?\s*[+-]?0(?:\.0)?(?![\d.])/.test(block)) return "basketball_result";
      if (/胜负/.test(block)) return "basketball_result";
      return null;
    }
    if (/半全场/.test(block)) return "half_full";
    if (/总进球/.test(block)) return "total_goals";
    if (/比分/.test(block)) return "correct_score";
    if (/让球胜平负|让球/.test(block)) return "handicap";
    if (/胜平负/.test(block)) return "match_result";
    return null;
  }

  function receiptSelections(blockText, market) {
    const raw = String(blockText || "").normalize("NFKC");
    // "胜平负" and "让分胜负" headings contain option words. Dropping them keeps a
    // heading from contributing a pick whose "SP" is the handicap line.
    // 半全场 keeps 胜负 because there it is a real option.
    const text = market === "half_full" ? raw : raw.replace(/胜平负|胜负/g, " ");
    const rows = [];
    const oddsAny = "(\\d{1,3}(?:\\.\\d{1,4})?)";
    const oddsDecimal = "(\\d{1,3}\\.\\d{1,4})";
    const add = (selection, odds, extra = {}) => {
      const value = Number(String(odds).replace(/[ОOQ]/g, "0"));
      if (!Number.isFinite(value) || value < 1) return;
      if (!rows.some(row => row.selection === selection && row.odds === value
        && row.handicap === (extra.handicap ?? null) && row.line === (extra.line ?? null))) {
        rows.push({market, selection, odds: value, handicap: extra.handicap ?? null, line: extra.line ?? null});
      }
    };

    // A Chinese lottery receipt prints the SP in three different layouts:
    // "主胜(2.45)", "（客11-15）@4.800元", and the bare "主胜 2.45" a screenshot
    // produces. Reading only the first one left legs with no selection, which
    // the review table then filled with the first option of the market.
    const scan = (labelSource, onMatch, bareOdds = oddsDecimal) => {
      const layouts = [
        new RegExp(`[（(\\[【]\\s*(${labelSource})\\s*[）)\\]】]\\s*[@＠]?\\s*${oddsAny}`, "g"),
        new RegExp(`(${labelSource})\\s*[（(\\[【]\\s*${oddsAny}`, "g"),
        new RegExp(`(${labelSource})\\s*[@＠]\\s*${oddsAny}`, "g"),
        new RegExp(`(${labelSource})\\s+${bareOdds}`, "g")
      ];
      for (const pattern of layouts) {
        let match;
        let guard = 0;
        while ((match = pattern.exec(text)) && guard++ < 400) onMatch(match[1], match[2], match.index);
      }
    };

    const stripParens = value => value.replace(/[(\[（]\s*\d{1,3}(?:\.\d{1,4})?\s*[)\]）]/g, " ");
    const resultLabel = "(?:主队胜|客队胜|主胜|客胜|主负|客负|胜|平|负)";
    let match;

    if (market === "match_result" || market === "basketball_result") {
      scan(resultLabel, (raw, odds) => add(normalizeOutcomeSelection(market, raw), odds));
    } else if (market === "total_goals") {
      scan("(?:7\\+|[0-7])", (raw, odds) => add(raw, odds));
    } else if (market === "correct_score") {
      scan("(?:(?:\\d{1,2}\\s*[:：]\\s*\\d{1,2})|(?:胜其他|平其他|负其他|胜其它|平其它|负其它))",
        (raw, odds) => add(raw.replace(/\s+/g, "").replace(/：/g, ":"), odds));
    } else if (market === "half_full") {
      scan("(?:胜胜|胜平|胜负|平胜|平平|平负|负胜|负平|负负)", (raw, odds) => add(raw, odds));
    } else if (market === "basketball_margin") {
      let side = null;
      scan("(?:(?:主队胜|客队胜|主胜|客胜|主|客)?\\s*(?:1-5|6-10|11-15|16-20|21-25|26\\+|26分以上|26分及以上)\\s*分?)",
        (raw, odds, index) => {
          const band = raw.match(/1-5|6-10|11-15|16-20|21-25|26\+|26分以上|26分及以上/);
          if (!band) return;
          const near = text.slice(Math.max(0, index - 16), index).match(/(主队胜|客队胜|主胜|客胜|主|客)\s*$/);
          if (/客/.test(raw) || near && /客/.test(near[1])) side = "客胜";
          else if (/主/.test(raw) || near && /主/.test(near[1])) side = "主胜";
          if (!side) return;
          add(side + (band[0].startsWith("26") ? "26+" : band[0]) + "分", odds);
        });
    } else if (market === "basketball_total") {
      const headerLineMatch = text.match(/(?:大小分|预设总分|总分)(?:[^\d\n]{0,12}\n)?\s*[:：\s]*(\d{2,3}(?:\.\d)?)/);
      const inlineLineMatch = text.match(/(?:大|小)分?\s*(\d{2,3}(?:\.\d)?)(?![\d.])/);
      const fallbackLineMatch = stripParens(text).match(/(?:^|\s)(\d{3}(?:\.\d)?)(?:\s|$)/);
      const defaultLine = headerLineMatch ? Number(headerLineMatch[1])
        : inlineLineMatch ? Number(inlineLineMatch[1])
        : fallbackLineMatch ? Number(fallbackLineMatch[1]) : null;
      const record = (selection, lineSource, odds) => add(selection, odds, {line: lineSource ? Number(lineSource) : defaultLine});

      const inlineParen = /(大|小)分?\s*(?:(\d{2,3}(?:\.\d)?))?\s*[（(\[【]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = inlineParen.exec(text))) record(match[1], match[2], match[3]);
      const inlineAt = /(大|小)分?\s*(\d{2,3}(?:\.\d)?)\s*[@＠]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = inlineAt.exec(text))) record(match[1], match[2], match[3]);
      const wrapped = /[（(\[【]\s*(大|小)\s*[）)\]】]\s*[@＠]?\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = wrapped.exec(text))) record(match[1], null, match[2]);
      const atSign = /(大|小)分?\s*[@＠]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = atSign.exec(text))) record(match[1], null, match[2]);
      const bare = /(?:^|[\s（(\[【:：])(大|小)分?\s+(\d{1,3}\.\d{1,4})/g;
      while ((match = bare.exec(text))) record(match[1], null, match[2]);
    } else if (market === "handicap" || market === "basketball_handicap") {
      const cleanForLine = stripParens(text);
      const lineMatch = cleanForLine.match(/(?:让球|让分|主队|客队)\s*(?:胜平负|胜负)?\s*([+-]?\d+(?:\.\d)?)/)
        || text.match(/(?:让球|让分|主队|客队)\s*(?:胜平负|胜负)?\s*[（(\[]\s*([+-]?\d+(?:\.\d)?)/)
        || cleanForLine.match(/(?:^|[\s（(\[])([+-]\d+(?:\.\d)?)(?=[\s）)\]]|$)/);
      const line = lineMatch ? Number(lineMatch[1]) : null;
      scan(resultLabel, (raw, odds) => add(normalizeOutcomeSelection(market, raw), odds, {handicap: line}));
    }
    return rows;
  }

  function isFooterLine(compactLine) {
    return /^\*?投注助手/.test(compactLine)
      || /^已选\d*$/.test(compactLine)
      || /^过关\d+关$/.test(compactLine)
      || /^\d+注\d+(?:\.\d{1,2})?元$/.test(compactLine)
      || /^预计(?:金额|奖金|返奖)/.test(compactLine)
      || /^(?:倍数|\d+倍)$/.test(compactLine);
  }

  function extractPayoutRange(compact) {
    const directRange = compact.match(/(?:预计金额|预计奖金|预计返奖|最高奖金|返奖)[^\d]{0,12}(\d+(?:\.\d{1,2})?)[-—–~](\d+(?:\.\d{1,2})?)元/);
    if (directRange) return [Number(directRange[1]), Number(directRange[2])];
    const afterBetRange = compact.match(/\d+注\d+(?:\.\d{1,2})?元(\d+(?:\.\d{1,2})?)[-—–~](\d+(?:\.\d{1,2})?)元/);
    if (afterBetRange) return [Number(afterBetRange[1]), Number(afterBetRange[2])];
    const anyRange = compact.match(/(\d+(?:\.\d{1,2})?)[-—–~](\d+(?:\.\d{1,2})?)元/);
    if (anyRange) return [Number(anyRange[1]), Number(anyRange[2])];
    const directSingle = compact.match(/(?:预计金额|预计奖金|预计返奖|最高奖金|返奖)[^\d]{0,12}(\d+(?:\.\d{1,2})?)元/);
    if (directSingle) return [Number(directSingle[1]), Number(directSingle[1])];
    const afterBetSingle = compact.match(/\d+注\d+(?:\.\d{1,2})?元(\d+(?:\.\d{1,2})?)元/);
    if (afterBetSingle) return [Number(afterBetSingle[1]), Number(afterBetSingle[1])];
    return null;
  }

  function parseParlayReceipt(words, width, height) {
    const lines = receiptLines(words, height);
    const compact = lines.map(line => line.compact).join("");
    const sport = /竞彩篮球|篮球过关|篮球|让分胜负|大小分|胜分差|\b(?:NBA|WNBA)\b/i.test(compact)
      ? "basketball"
      : "football";
    const fieldPass = compact.match(/(\d+)场[^\d]{0,8}(\d+)关/);
    const serialPass = compact.match(/(\d+)串(\d+)/);
    const loosePass = compact.match(/(?:已选(\d+)[^\d]{0,12})?(\d+)关/);
    const betMatch = compact.match(/(\d+)注(\d+(?:\.\d{1,2})?)元/);
    const multipleMatch = compact.match(/(\d+)倍/);
    const payoutRange = extractPayoutRange(compact);
    const declaredCount = fieldPass ? Number(fieldPass[1]) : loosePass?.[1] ? Number(loosePass[1]) : null;

    const eventIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (receiptMatchup(lines[i].text, sport)) eventIndices.push(i);
    }
    const hasPass = Boolean(fieldPass || serialPass || loosePass);
    const looksLikeParlay = Boolean(hasPass && betMatch && eventIndices.length >= 2);
    if (!looksLikeParlay) return {matched: false, candidate: Boolean(hasPass || eventIndices.length), legs: []};

    const legs = [];
    const warnings = [];
    for (let e = 0; e < eventIndices.length; e++) {
      const start = eventIndices[e];
      const rawEnd = eventIndices[e + 1] ?? lines.length;
      const sliceLines = lines.slice(start + 1, rawEnd).filter(line => !isFooterLine(line.compact));
      const blockText = sliceLines.map(line => line.text).join("\n");
      const blockCompact = sliceLines.map(line => line.compact).join("");
      const matchup = receiptMatchup(lines[start].text, sport);
      const market = receiptMarket(blockCompact, sport);
      const selections = market ? receiptSelections(blockText, market) : [];
      if (!matchup.homeOrderKnown) warnings.push(`第${e + 1}场主客顺序无法由“主”标记确认，请核对球队顺序。`);
      if (!market) warnings.push(`第${e + 1}场未识别玩法，请手动选择。`);
      if (!selections.length) warnings.push(`第${e + 1}场未识别到投注项或SP，请补录。`);
      legs.push({
        ...matchup,
        sport,
        league_code: sport === "basketball" ? "nba" : null,
        market: selections[0]?.market || market || (sport === "basketball" ? "basketball_result" : "match_result"),
        selection: selections[0]?.selection || "",
        odds: selections[0]?.odds ?? "",
        handicap: selections[0]?.handicap ?? null,
        line: selections[0]?.line ?? null,
        selections,
        fixture_id: null,
        kickoff: null,
        league_name: null,
      });
    }

    // "3场2关" names the leg count and the size of every elementary
    // combination; the app's pass type is "3串" plus the number of those
    // combinations (C(3,2)=3), never "3串1".
    const guan = fieldPass ? Number(fieldPass[2]) : loosePass ? Number(loosePass[2]) : null;
    const ticketLegs = declaredCount || legs.length;
    let passType = null;
    let comboSize = null;
    if (serialPass) {
      const count = Number(serialPass[1]), mode = Number(serialPass[2]);
      passType = `${count}串${mode}`;
      if (mode === 1) comboSize = count;
    } else if (guan) {
      const mode = combinationCount(ticketLegs, guan);
      if (mode) { passType = `${ticketLegs}串${mode}`; comboSize = guan; }
    }

    if (declaredCount && declaredCount !== legs.length) {
      warnings.push(`票面写明${declaredCount}场，但识别到${legs.length}场比赛，请核对。`);
    }
    if (!passType) warnings.push("未识别过关方式，请手动选择。");
    const picksPerLeg = legs.map(leg => leg.selections.length || 1);
    if (picksPerLeg.some(count => count > 1)) {
      warnings.push("有比赛腿识别到多个投注项，请确认是双选，或删除未选中的投注项。");
    }
    const productBets = picksPerLeg.reduce((product, n) => product * n, 1);
    const betCount = comboSize && comboSize <= legs.length ? combinationBets(legs, comboSize) : productBets;
    if (betMatch && Number(betMatch[1]) !== betCount) {
      warnings.push(`票面注数为${betMatch[1]}注，按识别选项计算为${betCount}注，请核对是否漏识别选项。`);
    }
    const total = betMatch ? Number(betMatch[2]) : null;
    let multiples = multipleMatch ? Number(multipleMatch[1]) : 1;
    if (!multipleMatch && total !== null && betCount > 0) {
      const inferred = total / (betCount * 2);
      if (Number.isInteger(inferred) && inferred > 0) multiples = inferred;
    }
    const expected = betCount * 2 * multiples;
    if (total !== null && Math.abs(total - expected) > 0.009) {
      warnings.push(`票面金额¥${total.toFixed(2)}与识别注数、倍数推算的¥${expected.toFixed(2)}不一致。`);
    }
    if (passType && passType !== `${legs.length}串1`) warnings.push(`当前识别过关方式为${passType}；请核对过关下拉框。`);

    return {
      matched: true,
      sport,
      passType,
      multiples,
      betCount,
      total,
      payoutRange,
      legs,
      warnings,
      width,
      height,
    };
  }

  function receiptToImportJson(receipt) {
    const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    return {
      schema_version: 1,
      type: "sportsmatch.parlay_receipt",
      sport: receipt.sport === "basketball" ? "basketball" : "football",
      pass_type: receipt.passType || null,
      multiples: Number.isInteger(receipt.multiples) && receipt.multiples > 0 ? receipt.multiples : 1,
      bet_count: Number.isFinite(receipt.betCount) ? receipt.betCount : null,
      total: Number.isFinite(receipt.total) ? receipt.total : null,
      payout_range: Array.isArray(receipt.payoutRange) ? receipt.payoutRange : null,
      legs: (receipt.legs || []).map((leg, index) => ({
        number: index + 1,
        home: String(leg.home || "").trim(),
        away: String(leg.away || "").trim(),
        sport: leg.sport === "basketball" || receipt.sport === "basketball" ? "basketball" : "football",
        ...(leg.league_code ? {league_code: leg.league_code} : {}),
        selections: (leg.selections || []).map(pick => ({
          market: pick.market,
          selection: normalizeOutcomeSelection(pick.market, pick.selection),
          odds: finite(pick.odds) ? Number(pick.odds) : null,
          handicap: finite(pick.handicap) ? Number(pick.handicap) : null,
          line: finite(pick.line) ? Number(pick.line) : null,
        })),
      })),
      warnings: (receipt.warnings || []).map(String),
    };
  }

  function normalizeOutcomeSelection(market, value) {
    const raw = String(value || "").trim();
    if (market === "match_result" || market === "handicap") {
      if (/^平(?:局)?$/.test(raw)) return "平";
      if (["客胜", "客队胜", "负", "主负"].includes(raw)) return "客胜";
      if (["主胜", "主队胜", "胜", "客负"].includes(raw)) return "主胜";
      return raw;
    }
    if (market === "basketball_result" || market === "basketball_handicap") {
      if (["客胜", "客队胜", "负", "主负"].includes(raw)) return "客胜";
      if (["主胜", "主队胜", "胜", "客负"].includes(raw)) return "主胜";
    }
    if (market === "basketball_total") {
      if (/^大/.test(raw)) return "大";
      if (/^小/.test(raw)) return "小";
    }
    return value;
  }

  function parseParlayImport(raw) {
    const source = String(raw || "").trim();
    if (!/^[{[]/.test(source)) return parseParlayText(source);
    const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    let data;
    try { data = JSON.parse(source); }
    catch { return {passType: null, multiples: null, total: null, payout: null, legs: [], warnings: ["JSON格式无效，请检查括号、引号和逗号。"]}; }
    if (!data || Array.isArray(data) || typeof data !== "object" || !Array.isArray(data.legs)) {
      return {passType: null, multiples: null, total: null, payout: null, legs: [], warnings: ["这不是过关票识别JSON，请粘贴弹窗生成的过关票JSON。"]};
    }
    const sport = data.sport === "basketball" ? "basketball" : "football";
    const warnings = Array.isArray(data.warnings) ? data.warnings.filter(item => typeof item === "string") : [];
    const legs = data.legs.map((leg, index) => {
      const legSport = leg?.sport === "basketball" || sport === "basketball" ? "basketball" : "football";
      const sourceSelections = Array.isArray(leg?.selections) ? leg.selections : [];
      const selections = sourceSelections.map(pick => ({
        market: String(pick?.market || leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")),
        selection: normalizeOutcomeSelection(String(pick?.market || leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")), String(pick?.selection || "")),
        odds: finite(pick?.odds) ? String(pick.odds) : "",
        handicap: finite(pick?.handicap) ? Number(pick.handicap) : null,
        line: finite(pick?.line) ? Number(pick.line) : null,
      }));
      if (!String(leg?.home || "").trim() || !String(leg?.away || "").trim()) warnings.push(`第${index + 1}场缺少主队或客队名称，请核对JSON。`);
      if (!selections.length) {
        const pick = {
          market: String(leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")),
          selection: normalizeOutcomeSelection(String(leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")), String(leg?.selection || "")),
          odds: finite(leg?.odds) ? String(leg.odds) : "",
          handicap: finite(leg?.handicap) ? Number(leg.handicap) : null,
          line: finite(leg?.line) ? Number(leg.line) : null,
        };
        if (pick.selection || pick.odds) selections.push(pick);
      }
      return {
        home: String(leg?.home || "").trim(),
        away: String(leg?.away || "").trim(),
        sport: legSport,
        ...(leg?.league_code ? {league_code: String(leg.league_code)} : {}),
        market: selections[0]?.market || String(leg?.market || (sport === "basketball" ? "basketball_result" : "match_result")),
        selection: selections[0]?.selection || normalizeOutcomeSelection(String(leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")), String(leg?.selection || "")),
        odds: selections[0]?.odds ?? (finite(leg?.odds) ? String(leg.odds) : ""),
        handicap: selections[0]?.handicap ?? (finite(leg?.handicap) ? Number(leg.handicap) : null),
        line: selections[0]?.line ?? (finite(leg?.line) ? Number(leg.line) : null),
        selections,
        fixture_id: null,
        kickoff: null,
        league_name: leg?.league_name || null,
      };
    });
    const payoutRange = Array.isArray(data.payout_range) ? data.payout_range : null;
    return {
      passType: typeof data.pass_type === "string" ? data.pass_type : null,
      multiples: Number.isInteger(data.multiples) && data.multiples > 0 ? data.multiples : null,
      total: finite(data.total) ? Number(data.total) : null,
      payout: payoutRange && finite(payoutRange[1]) ? Number(payoutRange[1])
        : finite(data.payout) ? Number(data.payout) : null,
      legs,
      warnings,
    };
  }

  root.MatchMonitorParlayParser = {parseParlayText, parseParlayReceipt, parseParlayImport, receiptToImportJson};
})(globalThis);
