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
    let match = text.match(/(?:半全场|半场全场|半全)\s*[:：]?\s*(胜胜|胜平|胜负|平胜|平平|平负|负胜|负平|负负)/);
    if (match) return {market: "half_full", selection: match[1]};
    match = text.match(/(?:比分|猜比分|正确比分)\s*[:：]?\s*(\d{1,2})\s*[:：-]\s*(\d{1,2})/);
    if (match) return {market: "correct_score", selection: match[1] + ":" + match[2]};
    match = text.match(/(?:总进球|进球数)\s*[:：]?\s*(7\+|[0-7])/);
    if (match) return {market: "total_goals", selection: match[1]};
    match = text.match(/(?:让球|让球胜平负)\s*([+-]?\d+)\s*(胜|平|负)/);
    if (match) return {market: "handicap", selection: match[2], handicap: Number(match[1])};
    match = text.match(/(?:主胜|主队胜|客胜|客队胜|胜|平局|平|负|客负)/);
    if (!match) return null;
    const word = match[0];
    const selection = /主胜|主队胜|(?<!客)胜/.test(word) ? "胜" : /平/.test(word) ? "平" : "负";
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
    const stop = /[,，。;；\n]|(?:买|投注|选择|选项|玩法|赔率|SP|主胜|客胜|胜|平|负|总进球|比分|让球|半全场)/i;
    const clean = value => {const end=value.search(stop);return (end<0?value:value.slice(0,end)).replace(/[：:|]+$/g, "").trim()};
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

  root.MatchMonitorParlayParser = {parseParlayText};
})(globalThis);
