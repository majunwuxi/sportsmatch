(function (root) {
  "use strict";

  const listedWins = ["1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0", "4:1", "4:2", "5:0", "5:1", "5:2"];
  const listedDraws = ["0:0", "1:1", "2:2", "3:3"];
  const listedLosses = listedWins.map((score) => score.split(":").reverse().join(":"));
  const scoreOptions = new Set([...listedWins, ...listedDraws, ...listedLosses, "胜其他", "平其他", "负其他"]);
  const resultOptions = new Set(["胜", "平", "负"]);
  const halfFullOptions = new Set(["胜胜", "胜平", "胜负", "平胜", "平平", "平负", "负胜", "负平", "负负"]);
  const totalGoalOptions = new Set(["0", "1", "2", "3", "4", "5", "6", "7+"]);

  function normalize(value) {
    return String(value ?? "")
      .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
      .replace(/[：﹕]/g, ":")
      .replace(/[．。]/g, ".")
      .replace(/[＋]/g, "+")
      .replace(/[，,]/g, ".")
      .replace(/[\s\u200b\ufeff]/g, "")
      .trim();
  }

  function getBox(word) {
    const b = word?.bbox || {};
    const left = Number(b.x0 ?? word?.left ?? 0);
    const top = Number(b.y0 ?? word?.top ?? 0);
    const right = Number(b.x1 ?? (left + Number(word?.width ?? 0)));
    const bottom = Number(b.y1 ?? (top + Number(word?.height ?? 0)));
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top), cx: (left + right) / 2, cy: (top + bottom) / 2 };
  }

  function groupLines(words, height) {
    const tolerance = Math.max(8, height * 0.012);
    const sorted = [...words].sort((a, b) => getBox(a).cy - getBox(b).cy || getBox(a).left - getBox(b).left);
    const lines = [];
    for (const word of sorted) {
      const box = getBox(word);
      let line = lines.find((item) => Math.abs(item.cy - box.cy) <= tolerance);
      if (!line) {
        line = { words: [], cy: box.cy, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        lines.push(line);
      }
      line.words.push(word);
      line.cy = line.words.reduce((sum, item) => sum + getBox(item).cy, 0) / line.words.length;
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.bottom);
      line.left = Math.min(line.left, box.left);
      line.right = Math.max(line.right, box.right);
    }
    for (const line of lines) {
      line.words.sort((a, b) => getBox(a).left - getBox(b).left);
      line.text = line.words.map((word) => normalize(word.text)).join("");
    }
    return lines.sort((a, b) => a.cy - b.cy);
  }

  function marketForHeading(text) {
    if (/总进球/.test(text)) return "total_goals";
    if (/半全场/.test(text)) return "half_full";
    if (/让球.*胜平负|胜平负.*让球|让球/.test(text)) return "handicap";
    if (/比分/.test(text)) return "correct_score";
    if (/胜平负/.test(text)) return "match_result";
    return null;
  }

  function makeHeadings(lines) {
    return lines.flatMap((line) => {
      const market = marketForHeading(line.text);
      return market ? [{ market, cy: line.cy, bottom: line.bottom }] : [];
    });
  }

  function sectionAt(y, headings, height) {
    const prior = headings.filter((heading) => heading.cy < y).sort((a, b) => b.cy - a.cy)[0];
    if (!prior || y - prior.bottom > height * 0.32) return null;
    return prior.market;
  }

  function mergeFragments(lines, width) {
    const gapLimit = Math.max(5, width * 0.012);
    const result = [];
    for (const line of lines) {
      const words = line.words.map((word) => ({ ...word, _box: getBox(word), _text: normalize(word.text) }));
      const out = [];
      for (let i = 0; i < words.length; i++) {
        let current = words[i];
        if (/^\d+$/.test(current._text) && i + 2 < words.length && words[i + 1]._text === ":" && /^\d+$/.test(words[i + 2]._text)) {
          const a = current._box, b = words[i + 2]._box;
          if (words[i + 1]._box.left - a.right <= gapLimit * 2 && b.left - words[i + 1]._box.right <= gapLimit * 2) {
            current = mergeWord([current, words[i + 1], words[i + 2]], current._text + ":" + words[i + 2]._text);
            i += 2;
          }
        } else if (/^[胜平负]$/.test(current._text) && words[i + 1]?._text === "其他" && words[i + 1]._box.left - current._box.right <= gapLimit * 5) {
          current = mergeWord([current, words[i + 1]], current._text + "其他");
          i += 1;
        } else if (/^7$/.test(current._text) && words[i + 1]?._text === "+" && words[i + 1]._box.left - current._box.right <= gapLimit * 3) {
          current = mergeWord([current, words[i + 1]], "7+");
          i += 1;
        } else if (/^\d+\.?$/.test(current._text) && /^\d+$/.test(words[i + 1]?._text) && current._text.endsWith(".") && words[i + 1]._box.left - current._box.right <= gapLimit) {
          current = mergeWord([current, words[i + 1]], current._text + words[i + 1]._text);
          i += 1;
        }
        current.text = current._text || normalize(current.text);
        current.bbox = { x0: current._box?.left ?? getBox(current).left, y0: current._box?.top ?? getBox(current).top, x1: current._box?.right ?? getBox(current).right, y1: current._box?.bottom ?? getBox(current).bottom };
        delete current._box;
        delete current._text;
        out.push(current);
      }
      result.push(...out);
    }
    return result;
  }

  function mergeWord(words, text) {
    const boxes = words.map((word) => word._box || getBox(word));
    const box = {
      left: Math.min(...boxes.map((item) => item.left)), top: Math.min(...boxes.map((item) => item.top)),
      right: Math.max(...boxes.map((item) => item.right)), bottom: Math.max(...boxes.map((item) => item.bottom)),
    };
    return { text, confidence: Math.min(...words.map((word) => Number(word.confidence ?? 100))), bbox: { x0: box.left, y0: box.top, x1: box.right, y1: box.bottom }, _box: { ...box, width: box.right - box.left, height: box.bottom - box.top, cx: (box.left + box.right) / 2, cy: (box.top + box.bottom) / 2 }, _text: text };
  }

  function numericOdds(word) {
    const text = normalize(word.text).replace(/[Oo]/g, "0");
    if (!/^\d{1,5}(?:\.\d{1,4})?$/.test(text)) return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 1 ? value : null;
  }

  function inferHandicap(label, words, height) {
    const box = getBox(label);
    const nearbyMarkers = words.filter((word) => /让球/.test(normalize(word.text)) && Math.abs(getBox(word).cy - box.cy) <= Math.max(24, height * 0.045));
    const inline = nearbyMarkers.map((word) => normalize(word.text).match(/让球([+-]?\d{1,2})/)).find(Boolean);
    if (inline) {
      const value = Number(inline[1]);
      if (Number.isInteger(value) && value >= -9 && value <= 9) return value;
    }
    const leftNumbers = words.flatMap((word) => {
      const text = normalize(word.text);
      if (!/^[+-]?\d{1,2}$/.test(text)) return [];
      const candidate = getBox(word);
      const value = Number(text);
      if (!Number.isInteger(value) || value < -9 || value > 9 || candidate.cx >= box.cx || Math.abs(candidate.cy - box.cy) > Math.max(28, height * 0.05)) return [];
      if (nearbyMarkers.length && !nearbyMarkers.some((marker) => Math.abs(getBox(marker).cy - candidate.cy) <= Math.max(30, height * 0.05))) return [];
      return [{ value, distance: Math.abs(candidate.cy - box.cy) + Math.abs(candidate.cx - box.cx) * 0.08 }];
    }).sort((a, b) => a.distance - b.distance);
    return leftNumbers[0]?.value ?? null;
  }

  function classify(label, section, words, height) {
    const text = normalize(label.text);
    if (scoreOptions.has(text)) return { market: "correct_score", selection: text, handicap: null };
    if (halfFullOptions.has(text)) return { market: "half_full", selection: text, handicap: null };
    if (section === "total_goals" && totalGoalOptions.has(text)) return { market: "total_goals", selection: text, handicap: null };
    if (["主胜", "客胜", "胜", "平", "负"].includes(text)) {
      const localLines = groupLines(words, height).filter((line) => Math.abs(line.cy - getBox(label).cy) < Math.max(22, height * 0.04));
      const hasHandicapMarker = localLines.some((line) => /让球/.test(line.text));
      const market = section === "handicap" || hasHandicapMarker ? "handicap" : section === "match_result" ? "match_result" : null;
      if (!market) return null;
      const selection = text === "主胜" ? "胜" : text === "客胜" ? "负" : text;
      return { market, selection, handicap: market === "handicap" ? inferHandicap(label, words, height) : null };
    }
    return null;
  }

  function parse(words, width, height, isHighlighted = () => false) {
    const validWords = (words || []).filter((word) => normalize(word.text) && Number(word.confidence ?? 100) >= 20 && getBox(word).right > getBox(word).left);
    const lines = groupLines(validWords, height);
    const headings = makeHeadings(lines);
    const tokens = mergeFragments(lines, width);
    const candidates = tokens.flatMap((word) => {
      const market = sectionAt(getBox(word).cy, headings, height);
      const classified = classify(word, market, validWords, height);
      return classified ? [{ word, classified, market }] : [];
    });
    const oddsWords = tokens.map((word) => ({ word, odds: numericOdds(word) })).filter((item) => item.odds !== null);
    const maxVerticalGap = Math.max(40, height * 0.07);
    const maxHorizontalGap = Math.max(26, width * 0.055);
    const usedOdds = new Set();
    const rows = [];
    for (const candidate of candidates) {
      const box = getBox(candidate.word);
      const match = oddsWords.map((item, index) => {
        const oddsBox = getBox(item.word);
        const dx = Math.abs(oddsBox.cx - box.cx);
        const dy = oddsBox.cy - box.bottom;
        if (usedOdds.has(index) || dx > maxHorizontalGap || dy < -3 || dy > maxVerticalGap) return null;
        const intervening = candidates.some((other) => {
          if (other === candidate) return false;
          const otherBox = getBox(other.word);
          return Math.abs(otherBox.cx - box.cx) <= maxHorizontalGap && otherBox.cy > box.cy && otherBox.cy < oddsBox.cy;
        });
        if (intervening) return null;
        return { ...item, index, score: dy + dx * 2.5 };
      }).filter(Boolean).sort((a, b) => a.score - b.score)[0];
      if (match) usedOdds.add(match.index);
      const confidence = Math.round((Number(candidate.word.confidence ?? 100) + Number(match?.word.confidence ?? 0)) / (match ? 2 : 1));
      rows.push({
        market: candidate.classified.market,
        selection: candidate.classified.selection,
        handicap: candidate.classified.handicap,
        odds: match?.odds ?? null,
        confidence,
        highlighted: Boolean(isHighlighted(candidate.word.bbox || box)),
        needsReview: !match || confidence < 70 || (candidate.classified.market === "handicap" && candidate.classified.handicap === null),
        position: { x: Math.round(box.cx), y: Math.round(box.cy) },
      });
    }
    const unique = new Map();
    for (const row of rows.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)) {
      const key = [row.market, row.handicap, row.selection, row.odds, row.position.x, row.position.y].join("|");
      unique.set(key, row);
    }
    return [...unique.values()];
  }

  function validatePick(pick) {
    const selection = normalize(pick?.selection);
    const market = pick?.market;
    const allowed = market === "correct_score" ? scoreOptions
      : market === "match_result" || market === "handicap" ? resultOptions
      : market === "total_goals" ? totalGoalOptions
      : market === "half_full" ? halfFullOptions : null;
    if (!allowed) return { ok: false, reason: "无法识别玩法" };
    if (!allowed.has(selection)) return { ok: false, reason: "投注选项不属于该玩法" };
    const odds = Number(pick?.odds);
    if (!Number.isFinite(odds) || odds < 1) return { ok: false, reason: "SP须为大于或等于1的数字" };
    if (market === "handicap" && (pick?.handicap === null || pick?.handicap === undefined || pick?.handicap === "" || !Number.isInteger(Number(pick.handicap)) || Number(pick.handicap) < -9 || Number(pick.handicap) > 9)) return { ok: false, reason: "让球数须为-9到9的整数" };
    return { ok: true, reason: "有效" };
  }

  root.MatchMonitorOCR = { parse, validatePick, normalize };
})(globalThis);
