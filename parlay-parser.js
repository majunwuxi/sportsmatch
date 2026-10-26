(function (root) {
  "use strict";

  function parseOdds(line) {
    const patterns = [
      /(?:赔率|SP|@)\s*[:：]?\s*(\d{1,3}(?:\.\d{1,4})?)/i,
      /[胜平负]\s*[@＠]\s*(\d{1,3}(?:\.\d{1,4})?)/,
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
    const basketballText=text.replace(/(?:赔率|SP|@)[^\s]*/ig,"");
    const footballResult = value => normalizeFootballSelection("match_result",value);
    let match=basketballText.match(/(?:竞彩篮球|篮球)\s*胜分差\s*[:：]?\s*(主胜|主队胜|客胜|客队胜)\s*(1-5|6-10|11-15|16-20|21-25|26\+|26分以上|26分及以上)\s*分?/);
    if(match){const side=/客/.test(match[1])?"客胜":"主胜",band=match[2].startsWith("26")?"26+":match[2];return{market:"basketball_margin",selection:side+band+"分",sport:"basketball"}}
    match=basketballText.match(/(?:竞彩篮球|篮球)\s*(?:大小分|大小|总分)\s*[:：]?\s*(大|小)\s*([0-9]+(?:\.5)?)/);
    if(match)return{market:"basketball_total",selection:match[1],line:Number(match[2]),sport:"basketball"};
    match=basketballText.match(/(?:竞彩篮球|篮球)\s*让分(?:胜负)?[^\d+-]{0,12}([+-]?\d+(?:\.5)?)\s*(?:分)?[^\u3400-\u9fff]{0,4}(主队胜|客队胜|主胜|客胜|胜|负)/);
    if(match)return{market:"basketball_handicap",selection:/客/.test(match[2])?"负":/主/.test(match[2])?"胜":match[2],handicap:Number(match[1]),sport:"basketball"};
    match=basketballText.match(/(?:竞彩篮球|篮球)\s*让分(?:胜负)?[^\u3400-\u9fff]{0,12}(主队胜|客队胜|主胜|客胜|胜|负)[^\d+-]{0,12}([+-]?\d+(?:\.5)?)/);
    if(match)return{market:"basketball_handicap",selection:/客/.test(match[1])?"负":/主/.test(match[1])?"胜":match[1],handicap:Number(match[2]),sport:"basketball"};
    match=basketballText.match(/(?:竞彩篮球|篮球)\s*胜负\s*[:：]?\s*(主队胜|客队胜|主胜|客胜|胜|负)/);
    if(match)return{market:"basketball_result",selection:/客/.test(match[1])?"负":/主/.test(match[1])?"胜":match[1],sport:"basketball"};
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
      .replace(/^\s*(?:[-*•]\s*)?(?:第\s*\d+\s*场|比赛\s*\d+|\d+\s*[.、])\s*[:：]?\s*/i, "")
      .replace(/\b周[一二三四五六日]\s*[A-Z]?\d{3,5}\b/gi, " ")
      .replace(/(?:主队|主隊)\s*[:：]?/g, "")
      .replace(/(?:客队|客隊)\s*[:：]?/g, "");
    const match = source.match(/^(.+?)\s*(?:\bvs\.?\b|\bvs\b|\bv\.?\b|对阵| VS | VS| vs | Vs )\s*(.+)$/i);
    if (!match) return null;
    const stop = /[,，。;；\n]|(?:竞彩篮球|篮球|胜分差|大小分|让分胜负|总进球|比分|让球|半全场|买|投注|选择|选项|玩法|赔率|SP|主胜|客胜|胜|平|负)/i;
    const clean = value => {const end=value.search(stop);return (end<0?value:value.slice(0,end)).replace(/[·・：:|,，。;；]+$/g, "").trim()};
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
    if (!passMatch) warnings.push("未识别过关方式，请手动选择。 ");
    if (!legs.length) warnings.push("未识别到比赛腿；请按“第1场：主队 VS 客队，玩法选项，赔率SP”的格式补充。 ");
    if (legs.some(leg => !leg.odds)) warnings.push("有比赛腿缺少有效SP，请在表格中补录。 ");
    if (passMatch && Number(passMatch[1]) !== legs.length) warnings.push("过关方式场次数与识别的比赛腿数量不一致，请核对。 ");
    return {
      passType: passMatch ? `${Number(passMatch[1])}串${Number(passMatch[2])}` : null,
      multiples: multiplesMatch ? Number(multiplesMatch[1]) : null,
      total: totalMatch ? Number(totalMatch[1]) : null,
      payout: payoutMatch ? Number(payoutMatch[1]) : null,
      legs,
      warnings: warnings.map(value => value.trim())
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
        ...(leg.league_code ? {league_code:leg.league_code} : {}),
        selections: (leg.selections || []).map(pick => ({
          market: pick.market,
          selection: normalizeFootballSelection(pick.market,pick.selection),
          odds: finite(pick.odds) ? Number(pick.odds) : null,
          handicap: finite(pick.handicap) ? Number(pick.handicap) : null,
          line: finite(pick.line) ? Number(pick.line) : null,
        })),
      })),
      warnings: (receipt.warnings || []).map(String),
    };
  }

  function normalizeFootballSelection(market, value) {
    if (market !== "match_result" && market !== "handicap") return value;
    const raw = String(value || "").trim();
    if (/^平(?:局)?$/.test(raw)) return "平";
    if (["客胜","客队胜","负","主负"].includes(raw)) return "客胜";
    if (["主胜","主队胜","胜","客负"].includes(raw)) return "主胜";
    return raw;
  }

  function parseParlayImport(raw) {
    const source = String(raw || "").trim();
    if (!/^[{[]/.test(source)) return parseParlayText(source);
    const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    let data;
    try { data = JSON.parse(source); }
    catch { return {passType:null,multiples:null,total:null,payout:null,legs:[],warnings:["JSON格式无效，请检查括号、引号和逗号。"]}; }
    if (!data || Array.isArray(data) || typeof data !== "object" || !Array.isArray(data.legs)) {
      return {passType:null,multiples:null,total:null,payout:null,legs:[],warnings:["这不是过关票识别JSON，请粘贴弹窗生成的过关票JSON。"]};
    }
    const sport = data.sport === "basketball" ? "basketball" : "football";
    const warnings = Array.isArray(data.warnings) ? data.warnings.filter(item => typeof item === "string") : [];
    const legs = data.legs.map((leg, index) => {
      const legSport = leg?.sport === "basketball" || sport === "basketball" ? "basketball" : "football";
      const sourceSelections = Array.isArray(leg?.selections) ? leg.selections : [];
      const selections = sourceSelections.map(pick => ({
        market:String(pick?.market || leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")),
        selection:normalizeFootballSelection(String(pick?.market || leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")),String(pick?.selection || "")),
        odds:finite(pick?.odds) ? String(pick.odds) : "",
        handicap:finite(pick?.handicap) ? Number(pick.handicap) : null,
        line:finite(pick?.line) ? Number(pick.line) : null,
      }));
      if (!String(leg?.home || "").trim() || !String(leg?.away || "").trim()) warnings.push(`第${index + 1}场缺少主队或客队名称，请核对JSON。`);
      if (!selections.length) {
        const pick = {
          market:String(leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")),
          selection:normalizeFootballSelection(String(leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")),String(leg?.selection || "")),
          odds:finite(leg?.odds) ? String(leg.odds) : "",
          handicap:finite(leg?.handicap) ? Number(leg.handicap) : null,
          line:finite(leg?.line) ? Number(leg.line) : null,
        };
        if (pick.selection || pick.odds) selections.push(pick);
      }
      return {
        home:String(leg?.home || "").trim(), away:String(leg?.away || "").trim(),
        sport:legSport,
        ...(leg?.league_code ? {league_code:String(leg.league_code)} : {}),
        market:selections[0]?.market || String(leg?.market || (sport === "basketball" ? "basketball_result" : "match_result")),
        selection:selections[0]?.selection || normalizeFootballSelection(String(leg?.market || (legSport === "basketball" ? "basketball_result" : "match_result")),String(leg?.selection || "")),
        odds:selections[0]?.odds ?? (finite(leg?.odds) ? String(leg.odds) : ""),
        handicap:selections[0]?.handicap ?? (finite(leg?.handicap) ? Number(leg.handicap) : null),
        line:selections[0]?.line ?? (finite(leg?.line) ? Number(leg.line) : null),
        selections, fixture_id:null, kickoff:null, league_name:leg?.league_name || null,
      };
    });
    const payoutRange = Array.isArray(data.payout_range) ? data.payout_range : null;
    return {
      passType:typeof data.pass_type === "string" ? data.pass_type : null,
      multiples:Number.isInteger(data.multiples) && data.multiples > 0 ? data.multiples : null,
      total:finite(data.total) ? Number(data.total) : null,
      payout:payoutRange && finite(payoutRange[1]) ? Number(payoutRange[1])
        : finite(data.payout) ? Number(data.payout) : null,
      legs, warnings,
    };
  }

  function receiptLines(words, height) {
    const valid = (words || []).filter(word => String(word?.text || "").trim()
      && Number(word.confidence ?? 100) >= 15);
    const box = word => {
      const b = word?.bbox || {};
      const left = Number(b.x0 ?? word?.left ?? 0), top = Number(b.y0 ?? word?.top ?? 0);
      const right = Number(b.x1 ?? (left + Number(word?.width || 0)));
      const bottom = Number(b.y1 ?? (top + Number(word?.height || 0)));
      return {left, top, right, bottom, cx:(left + right) / 2, cy:(top + bottom) / 2};
    };
    const tolerance = Math.max(6, Number(height || 1) * 0.014);
    const rows = [];
    for (const word of valid.sort((a,b) => box(a).cy - box(b).cy || box(a).left - box(b).left)) {
      const b = box(word);
      let row = rows.find(item => Math.abs(item.cy - b.cy) <= tolerance);
      if (!row) { row = {items:[], cy:b.cy}; rows.push(row); }
      row.items.push({word, box:b});
      row.cy = row.items.reduce((sum,item) => sum + item.box.cy, 0) / row.items.length;
    }
    return rows.sort((a,b) => a.cy - b.cy).map(row => {
      const items = row.items.sort((a,b) => a.box.left - b.box.left);
      const text = items.map(item => String(item.word.text).normalize("NFKC").trim()).join("");
      return {text, compact:text.replace(/[\s\u200b\ufeff]/g, ""), y:row.cy};
    }).filter(row => row.text);
  }

  function receiptMatchup(line) {
    const source = String(line || "").normalize("NFKC").replace(/周[一二三四五六日]\s*\d{3,5}/g, " ");
    const match = source.match(/(.+?)\s*(?:VS?\.?|对阵)\s*(.+)/i);
    if (!match) return null;
    const mark = value => /[\[【（(]\s*主\s*[\]】）)]/.test(value);
    const leftMarked = mark(match[1]), rightMarked = mark(match[2]);
    const clean = value => value
      .replace(/[\[【（(]\s*主\s*[\]】）)]/g, "")
      .replace(/(?:竞彩足球|竞彩篮球|胜平负|胜分差|让分胜负|让球胜平负|总进球|大小分|比分|半全场|胜负).*$/i, "")
      .replace(/(?:场次|比赛|主队|客队)[:：]?/g, "")
      .replace(/[·・,，;；]/g, "")
      .trim();
    const left = clean(match[1]), right = clean(match[2]);
    if (!left || !right || left.length > 50 || right.length > 50) return null;
    if (leftMarked && !rightMarked) return {home:left, away:right, homeOrderKnown:true};
    if (rightMarked && !leftMarked) return {home:right, away:left, homeOrderKnown:true};
    return {home:left, away:right, homeOrderKnown:false};
  }

  function receiptMarket(block, sport) {
    if (sport === "basketball") {
      if (/胜分差/.test(block)) return "basketball_margin";
      if (/让分胜负/.test(block)) return "basketball_handicap";
      if (/大小分|总分/.test(block)) return "basketball_total";
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

  function receiptSelections(block, market) {
    const rows = [];
    const add = (selection, odds, extra={}) => {
      const value = Number(String(odds).replace(/[ＯＯ]/g, "0"));
      if (!Number.isFinite(value) || value < 1) return;
      if (!rows.some(row => row.selection === selection && row.odds === value
        && row.handicap === (extra.handicap ?? null) && row.line === (extra.line ?? null))) {
        rows.push({market, selection, odds:value, handicap:extra.handicap ?? null, line:extra.line ?? null});
      }
    };
    let match;
    if (market === "match_result" || market === "basketball_result") {
      const pattern = /(?:主队胜|客队胜|主胜|客胜|主负|客负|胜|平|负)\s*[（(]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = pattern.exec(block))) {
        const raw = match[0].match(/主队胜|客队胜|主胜|客胜|主负|客负|胜|平|负/)[0];
        const selection = market === "match_result" ? normalizeFootballSelection(market,raw)
          : /平/.test(raw) ? "平" : /客/.test(raw) || /主负/.test(raw) ? "负" : "胜";
        add(selection, match[1]);
      }
    } else if (market === "total_goals") {
      const pattern = /(^|[^\d])((?:7\+|[0-7]))\s*[（(]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = pattern.exec(block))) add(match[2], match[3]);
    } else if (market === "correct_score") {
      const pattern = /(\d{1,2})\s*[:：]\s*(\d{1,2})\s*[（(]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = pattern.exec(block))) add(match[1] + ":" + match[2], match[3]);
    } else if (market === "half_full") {
      const pattern = /(胜胜|胜平|胜负|平胜|平平|平负|负胜|负平|负负)\s*[（(]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = pattern.exec(block))) add(match[1], match[2]);
    } else if (market === "basketball_margin") {
      const pattern = /(主队胜|客队胜|主胜|客胜|主|客)?\s*(1-5|6-10|11-15|16-20|21-25|26\+|26分以上|26分及以上)\s*分?\s*[（(]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      let side = null;
      while ((match = pattern.exec(block))) {
        if (match[1]) side = /客/.test(match[1]) ? "客胜" : "主胜";
        if (side) add(side + (match[2].startsWith("26") ? "26+" : match[2]) + "分", match[3]);
      }
    } else if (market === "basketball_total") {
      const pattern = /(大|小)\s*(\d{2,3}(?:\.\d)?)\s*[（(]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = pattern.exec(block))) add(match[1], match[3], {line:Number(match[2])});
    } else if (market === "handicap" || market === "basketball_handicap") {
      const lineMatch = block.match(/(?:让球|让分)(?:胜平负|胜负)?\s*[（(]?\s*([+-]?\d+(?:\.\d)?)/);
      const line = lineMatch ? Number(lineMatch[1]) : null;
      const pattern = /(主队胜|客队胜|主胜|客胜|主负|客负|胜|平|负)\s*[（(]\s*(\d{1,3}(?:\.\d{1,4})?)/g;
      while ((match = pattern.exec(block))) {
        const raw = match[1], selection = market === "handicap" ? normalizeFootballSelection(market,raw)
          : /平/.test(raw) ? "平" : /客/.test(raw) || /主负/.test(raw) ? "负" : "胜";
        add(selection, match[2], market === "basketball_handicap" ? {handicap:line} : {handicap:line});
      }
    }
    return rows;
  }

  function parseParlayReceipt(words, width, height) {
    const lines = receiptLines(words, height);
    const compact = lines.map(line => line.compact).join("");
    const sport = /竞彩篮球|篮球过关|篮球/.test(compact) ? "basketball" : "football";
    const passMatch = compact.match(/(\d+)场[-－–—]?\s*(\d+)关/)
      || compact.match(/(\d+)串(\d+)/);
    const betMatch = compact.match(/(\d+)注\s*(\d+(?:\.\d{1,2})?)元/);
    const multipleMatch = compact.match(/(\d+)倍/);
    const payoutMatch = compact.match(/(?:预计金额|预计奖金|预计返奖|返奖)[^\d]*(\d+(?:\.\d{1,2})?)[-－–—~～](\d+(?:\.\d{1,2})?)元/);
    const eventIndices = [];
    for (let i = 0; i < lines.length; i++) if (receiptMatchup(lines[i].text)) eventIndices.push(i);
    const looksLikeParlay = Boolean(passMatch && betMatch && eventIndices.length >= 2);
    if (!looksLikeParlay) return {matched:false, candidate:Boolean(passMatch || eventIndices.length), legs:[]};

    const legs = [];
    const warnings = [];
    for (let e = 0; e < eventIndices.length; e++) {
      const start = eventIndices[e], end = eventIndices[e + 1] ?? lines.length;
      const matchup = receiptMatchup(lines[start].text);
      const block = lines.slice(start + 1, end).map(line => line.compact).join("");
      const market = receiptMarket(block, sport);
      const selections = market ? receiptSelections(block, market) : [];
      if (!matchup.homeOrderKnown) warnings.push(`第${e + 1}场主客顺序无法由“主”标记确认，请核对球队顺序。`);
      if (!market) warnings.push(`第${e + 1}场未识别玩法，请手动选择。`);
      if (!selections.length) warnings.push(`第${e + 1}场未识别到投注项或SP，请补录。`);
      legs.push({
        ...matchup, sport, league_code:sport === "basketball" ? "nba" : null,
        market:selections[0]?.market || market || (sport === "basketball" ? "basketball_result" : "match_result"),
        selection:selections[0]?.selection || "", odds:selections[0]?.odds ?? "",
        handicap:selections[0]?.handicap ?? null, line:selections[0]?.line ?? null,
        selections, fixture_id:null, kickoff:null, league_name:null,
      });
    }
    const count = Number(passMatch[1]);
    const passType = passMatch[0].includes("场")
      ? (count === 2 ? "2串1" : `${count}串1`)
      : `${Number(passMatch[1])}串${Number(passMatch[2])}`;
    if (count !== legs.length) warnings.push(`票面写明${count}场，但识别到${legs.length}场比赛，请核对。`);
    const picksPerLeg = legs.map(leg => leg.selections.length || 1);
    const betCount = picksPerLeg.reduce((product,n) => product * n, 1);
    if (betMatch && Number(betMatch[1]) !== betCount) warnings.push(`票面注数为${betMatch[1]}注，按识别选项计算为${betCount}注，请核对是否漏识别选项。`);
    const total = betMatch ? Number(betMatch[2]) : null;
    const expected = betCount * 2 * (multipleMatch ? Number(multipleMatch[1]) : 1);
    if (total !== null && Math.abs(total - expected) > 0.009) warnings.push(`票面金额¥${total.toFixed(2)}与识别注数、倍数推算的¥${expected.toFixed(2)}不一致。`);
    if (passType !== `${legs.length}串1`) warnings.push(`当前识别过关方式为${passType}；请核对过关下拉框。`);
    return {
      matched:true, sport, passType, multiples:multipleMatch ? Number(multipleMatch[1]) : 1,
      betCount, total, payoutRange:payoutMatch ? [Number(payoutMatch[1]), Number(payoutMatch[2])] : null,
      legs, warnings, width, height,
    };
  }

  root.MatchMonitorParlayParser = {parseParlayText, parseParlayReceipt, parseParlayImport, receiptToImportJson};
})(globalThis);
