(function (root) {
  "use strict";

  const listedWins = ["1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0", "4:1", "4:2", "5:0", "5:1", "5:2"];
  const listedDraws = ["0:0", "1:1", "2:2", "3:3"];
  const listedLosses = listedWins.map((score) => score.split(":").reverse().join(":"));
  const listedScoreOptions = new Set([...listedWins, ...listedDraws, ...listedLosses]);
  const listedScoreOrder = [...listedWins, ...listedDraws, ...listedLosses];
  const scoreGridRows = [
    ["1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0"],
    ["4:1", "4:2", "5:0", "5:1", "5:2"],
    ["0:0", "1:1", "2:2", "3:3"],
    ["0:1", "0:2", "1:2", "0:3", "1:3", "2:3", "0:4"],
    ["1:4", "2:4", "0:5", "1:5", "2:5"],
  ];
  const scoreGridPosition = new Map(scoreGridRows.flatMap((row, rowIndex) =>
    row.map((score, columnIndex) => [score, { row: rowIndex, column: columnIndex }])));
  const scoreOptions = new Set([...listedScoreOptions,
    "胜其他", "平其他", "负其他", "胜其它", "平其它", "负其它"]);
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

  function verticalMarketHeadings(words, height) {
    const candidates = (words || []).map((word) => ({ word, box: getBox(word), text: normalize(word.text) }))
      .filter((item) => item.text.length <= 8 && /[比分总进球半全场让胜平负]/.test(item.text));
    const clusters = [];
    for (const item of candidates) {
      let cluster = clusters.find((entry) => Math.abs(entry.cx - item.box.cx)
        <= Math.max(10, Math.min(entry.maxWidth, item.box.width) * 0.7)
        && Math.abs(entry.lastCy - item.box.cy) <= Math.min(Number(height) * 0.22,
          Math.max(80, Math.max(entry.maxHeight, item.box.height) * 3)));
      if (!cluster) {
        cluster = { items: [], cx: item.box.cx, maxWidth: item.box.width, maxHeight: item.box.height, lastCy: item.box.cy };
        clusters.push(cluster);
      }
      cluster.items.push(item);
      cluster.cx = cluster.items.reduce((sum, entry) => sum + entry.box.cx, 0) / cluster.items.length;
      cluster.maxWidth = Math.max(cluster.maxWidth, item.box.width);
      cluster.maxHeight = Math.max(cluster.maxHeight, item.box.height);
      cluster.lastCy = item.box.cy;
    }
    return clusters.flatMap((cluster) => {
      if (cluster.items.length < 2) return [];
      const items = [...cluster.items].sort((a, b) => a.box.cy - b.box.cy);
      const market = marketForHeading(items.map((item) => item.text).join(""));
      if (!market) return [];
      const top = Math.min(...items.map((item) => item.box.top));
      const bottom = Math.max(...items.map((item) => item.box.bottom));
      const left = Math.min(...items.map((item) => item.box.left));
      const right = Math.max(...items.map((item) => item.box.right));
      if (bottom - top <= Math.max(24, (right - left) * 1.25)) return [];
      return [{ market, cy: top - Math.max(2, Number(height) * 0.05), bottom, left, right, vertical: true }];
    });
  }

  function makeHeadings(lines, words = [], height = 1) {
    const horizontal = lines.flatMap((line) => {
      const market = marketForHeading(line.text);
      if (!market) return [];
      const vertical = line.bottom - line.top > Math.max(24, (line.right - line.left) * 1.25);
      return [vertical
        ? { market, cy: line.top - Math.max(2, Number(height) * 0.05), bottom: line.bottom, left: line.left, right: line.right, vertical: true }
        : { market, cy: line.cy, bottom: line.bottom, left: line.left, right: line.right, vertical: false }];
    });
    const vertical = verticalMarketHeadings(words, height).filter((candidate) => !horizontal.some((heading) =>
      heading.vertical && heading.market === candidate.market && Math.abs(heading.bottom - candidate.bottom) < Math.max(20, Number(height) * 0.05)));
    return [...horizontal, ...vertical];
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
        } else if (/^\d+$/.test(current._text) && i + 2 < words.length && words[i + 1]._text === "." && /^\d+$/.test(words[i + 2]._text)) {
          const a = current._box, dot = words[i + 1]._box, b = words[i + 2]._box;
          if (dot.left - a.right <= gapLimit && b.left - dot.right <= gapLimit) {
            current = mergeWord([current, words[i + 1], words[i + 2]], current._text + "." + words[i + 2]._text);
            i += 2;
          }
        } else if (/^[胜平负]$/.test(current._text) && ["其他", "其它"].includes(words[i + 1]?._text) && words[i + 1]._box.left - current._box.right <= gapLimit * 5) {
          current = mergeWord([current, words[i + 1]], current._text + words[i + 1]._text);
          i += 1;
        } else if (/^[胜平负]$/.test(current._text) && words[i + 1]?._text === "其"
          && ["他", "它"].includes(words[i + 2]?._text)
          && words[i + 1]._box.left - current._box.right <= gapLimit * 5
          && words[i + 2]._box.left - words[i + 1]._box.right <= gapLimit * 5) {
          current = mergeWord([current, words[i + 1], words[i + 2]], current._text + "其" + words[i + 2]._text);
          i += 2;
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
    // SP change indicators are decorative. OCR sometimes glues the glyph to
    // the numeric odds (for example `13.5↓`), so strip only known arrow marks
    // before validating the actual number.
    const text = normalize(word.text)
      .replace(/[↑↓↗↘↖↙⬆⬇⬈⬉⬊⬋⇧⇩↥↧▲▼△▽]/g, "")
      .replace(/^\.+(?=\d)/, "")
      .replace(/[Oo]/g, "0");
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

  function parse(words, width, height, isHighlighted = () => false, forcedMarket = null) {
    const validWords = (words || []).filter((word) => normalize(word.text) && Number(word.confidence ?? 100) >= 20 && getBox(word).right > getBox(word).left);
    const lines = groupLines(validWords, height);
    const headings = makeHeadings(lines, validWords, height);
    const tokens = mergeFragments(lines, width);
    const candidates = tokens.flatMap((word) => {
      const market = forcedMarket || sectionAt(getBox(word).cy, headings, height);
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

  function listedScoresFromRows(rows) {
    const found = new Set((rows || []).flatMap((row) => {
      const score = normalize(row?.selection);
      const odds = row?.odds;
      return row?.market === "correct_score" && listedScoreOptions.has(score)
        && odds !== null && odds !== undefined && odds !== "" && Number.isFinite(Number(odds)) && Number(odds) >= 1
        ? [score] : [];
    }));
    return listedScoreOrder.filter((score) => found.has(score));
  }

  function median(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // The standard correct-score table uses the same 7-column, 5-row layout.
  // Use labels already recognized anywhere on the page to recover cell centers,
  // then OCR each predicted cell independently for its small SP text.
  function inferScoreGrid(rows, width, height) {
    const byScore = new Map();
    for (const row of rows || []) {
      const selection = normalize(row?.selection);
      const position = row?.position || {};
      const layout = scoreGridPosition.get(selection);
      const x = Number(position.x), y = Number(position.y);
      if (row?.market !== "correct_score" || !layout || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      const previous = byScore.get(selection);
      if (!previous || Number(row.confidence ?? 0) > Number(previous.confidence ?? 0)) byScore.set(selection, row);
    }
    const labels = [...byScore].map(([selection, candidate]) => ({
      selection,
      x: Number(candidate.position.x),
      y: Number(candidate.position.y),
      ...scoreGridPosition.get(selection),
      confidence: Number(candidate.confidence ?? 0),
    }));
    if (labels.length < 8) return null;

    const horizontalSteps = [];
    const verticalSteps = [];
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (a.row === b.row && a.column !== b.column) {
        const step = (b.x - a.x) / (b.column - a.column);
        if (step > 0) horizontalSteps.push(step);
      }
      if (a.row !== b.row) {
        const step = (b.y - a.y) / (b.row - a.row);
        if (step > 0) verticalSteps.push(step);
      }
    }
    const cellWidth = median(horizontalSteps);
    const rowHeight = median(verticalSteps);
    if (!cellWidth || !rowHeight || cellWidth < width * 0.025 || cellWidth > width * 0.35
      || rowHeight < height * 0.012 || rowHeight > height * 0.25) return null;

    const originX = median(labels.map((label) => label.x - label.column * cellWidth));
    const originY = median(labels.map((label) => label.y - label.row * rowHeight));
    const inliers = labels.filter((label) =>
      Math.abs(label.x - (originX + label.column * cellWidth)) <= cellWidth * 0.3
      && Math.abs(label.y - (originY + label.row * rowHeight)) <= rowHeight * 0.3);
    if (inliers.length < Math.max(8, Math.ceil(labels.length * 0.45))
      || new Set(inliers.map((label) => label.row)).size < 3
      || new Set(inliers.map((label) => label.column)).size < 4) return null;

    const cells = listedScoreOrder.map((selection) => {
      const layout = scoreGridPosition.get(selection);
      const center = { x: originX + layout.column * cellWidth, y: originY + layout.row * rowHeight };
      return {
        selection,
        ...layout,
        center,
        region: {
          x0: Math.max(0, Math.floor(center.x - cellWidth * 0.48)),
          y0: Math.max(0, Math.floor(center.y - rowHeight * 0.56)),
          x1: Math.min(width, Math.ceil(center.x + cellWidth * 0.48)),
          y1: Math.min(height, Math.ceil(center.y + rowHeight * 0.56)),
        },
      };
    });
    return { cells, cellWidth, rowHeight, origin: { x: originX, y: originY }, recognizedLabels: labels.length, inlierLabels: inliers.length };
  }

  function parseScoreGridCells(cells) {
    return (cells || []).map((cell) => {
      const cropWidth = Math.max(1, Number(cell.cropWidth) || Number(cell.region?.x1) - Number(cell.region?.x0) || 1);
      const cropHeight = Math.max(1, Number(cell.cropHeight) || Number(cell.region?.y1) - Number(cell.region?.y0) || 1);
      const validWords = (cell.words || []).filter((word) => normalize(word.text)
        && Number(word.confidence ?? 100) >= 20 && getBox(word).right > getBox(word).left);
      const tokens = mergeFragments(groupLines(validWords, cropHeight), cropWidth);
      const odds = tokens.map((word) => ({ word, odds: numericOdds(word), box: getBox(word) }))
        .filter((entry) => entry.odds !== null)
        .sort((a, b) => b.box.cy - a.box.cy || Number(b.word.confidence ?? 0) - Number(a.word.confidence ?? 0))[0] || null;
      const confidence = Math.round(Number(odds?.word.confidence ?? 0));
      return {
        market: "correct_score",
        selection: cell.selection,
        handicap: null,
        odds: odds?.odds ?? null,
        confidence,
        highlighted: Boolean(cell.highlighted),
        needsReview: !odds || confidence < 70,
        position: cell.center || { x: 0, y: 0 },
      };
    });
  }

  function preferScoreOdds(pageRow, gridRow, confidenceMargin = 8) {
    if (!gridRow || gridRow.odds === null || gridRow.odds === undefined) return pageRow;
    if (!pageRow || pageRow.odds === null || pageRow.odds === undefined) {
      return { ...pageRow, ...gridRow, highlighted: Boolean(pageRow?.highlighted || gridRow.highlighted) };
    }
    const pageValue = String(pageRow.odds), gridValue = String(gridRow.odds);
    const sameDigits = pageValue.replace(".", "") === gridValue.replace(".", "");
    const decimalDifference = sameDigits && pageValue.includes(".") !== gridValue.includes(".");
    const chooseGrid = decimalDifference
      ? gridValue.includes(".")
      : Number(gridRow.confidence || 0) >= Number(pageRow.confidence || 0) - confidenceMargin;
    const oddsRow = chooseGrid ? gridRow : pageRow;
    return {
      ...pageRow,
      ...oddsRow,
      highlighted: Boolean(pageRow.highlighted || gridRow.highlighted),
      needsReview: Boolean(pageRow.needsReview || gridRow.needsReview),
    };
  }

  function preprocessScoreOddsPixels(data, selected = false, threshold = 190, chromaThreshold = 24) {
    if (!data || typeof data.length !== "number") return data;
    const cutoff = Math.max(0, Math.min(255, Number(threshold) || 190));
    const chromaCutoff = Math.max(0, Math.min(255, Number(chromaThreshold) || 24));
    for (let offset = 0; offset + 3 < data.length; offset += 4) {
      const red = Number(data[offset]), green = Number(data[offset + 1]), blue = Number(data[offset + 2]);
      const luminance = (red * 3 + green * 5 + blue * 2) / 10;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      // Highlighted cells contain white text on a colored dark fill. Invert
      // those pixels to black-on-white. For ordinary cells, remove saturated
      // SP-change icons before binarizing the numeric text so an arrow cannot
      // become a trailing digit (e.g. 21↓ -> 214).
      const value = selected
        ? (luminance >= cutoff ? 0 : 255)
        : (chroma >= chromaCutoff ? 255 : (luminance >= cutoff ? 255 : 0));
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
    return data;
  }

  function parseListedScores(value) {
    const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
    const scores = [...new Set(raw.split(/[,，、;；\s]+/).map(normalize).filter(Boolean))];
    const invalid = scores.filter((score) => !listedScoreOptions.has(score));
    return { ok: invalid.length === 0, scores, invalid };
  }

  function isChromaticSelectionPixel(red, green, blue) {
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const luminance = (red * 3 + green * 5 + blue * 2) / 10;
    return high - low >= 24 && luminance >= 28 && luminance <= 128;
  }

  function isNeutralSelectionPixel(red, green, blue) {
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    return high <= 112 && high - low <= 24;
  }

  function selectedComponents(pixels, width, height, pixelMatches) {
    const size = width * height;
    const mask = new Uint8Array(size);
    for (let pixel = 0, offset = 0; pixel < size; pixel++, offset += 4) {
      mask[pixel] = pixelMatches(pixels[offset], pixels[offset + 1], pixels[offset + 2]) ? 1 : 0;
    }

    const visited = new Uint8Array(size);
    const queue = new Int32Array(size);
    const minArea = Math.max(24, Math.floor(size * 0.00035));
    const minWidth = Math.max(10, Math.ceil(width * 0.055));
    const minHeight = Math.max(5, Math.ceil(height * 0.014));
    const regions = [];
    for (let start = 0; start < size; start++) {
      if (!mask[start] || visited[start]) continue;
      let head = 0, tail = 0, minX = width, minY = height, maxX = -1, maxY = -1;
      visited[start] = 1;
      queue[tail++] = start;
      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const next = ny * width + nx;
            if (mask[next] && !visited[next]) {
              visited[next] = 1;
              queue[tail++] = next;
            }
          }
        }
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const fillRatio = tail / (boxWidth * boxHeight);
      if (tail < minArea || boxWidth < minWidth || boxHeight < minHeight || fillRatio < 0.36) continue;
      // A full-width bar near the bottom is usually a page button, not a selected betting cell.
      if (minX <= width * 0.05 && maxX >= width * 0.95 && minY >= height * 0.78) continue;
      regions.push({ x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 });
    }
    return regions;
  }

  function detectSelectedRegions(imageData, width, height) {
    const pixels = imageData?.data || imageData;
    const w = Math.floor(Number(width));
    const h = Math.floor(Number(height));
    if (!pixels || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || pixels.length < w * h * 4) return [];

    const regions = [
      ...selectedComponents(pixels, w, h, isChromaticSelectionPixel),
      ...selectedComponents(pixels, w, h, isNeutralSelectionPixel),
    ];
    return regions.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  }

  function containsSelectedRegion(bbox, regions) {
    if (!bbox) return false;
    const x0 = Number(bbox.x0 ?? bbox.left ?? 0);
    const y0 = Number(bbox.y0 ?? bbox.top ?? 0);
    const x1 = Number(bbox.x1 ?? (x0 + Number(bbox.width ?? 0)));
    const y1 = Number(bbox.y1 ?? (y0 + Number(bbox.height ?? 0)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return (regions || []).some((region) => cx >= region.x0 && cx <= region.x1 && cy >= region.y0 && cy <= region.y1);
  }

  function isSelectionLabel(text) {
    const value = normalize(text);
    return scoreOptions.has(value) || halfFullOptions.has(value) || totalGoalOptions.has(value)
      || resultOptions.has(value) || value === "主胜" || value === "客胜";
  }

  function repairSelectedScoreLabel(text) {
    const value = normalize(text).toUpperCase().replace(/[OQ]/g, "0").replace(/Z/g, "2");
    const match = value.match(/^([0-5])[:.]?([0-5])$/);
    if (!match) return null;
    const score = match[1] + ":" + match[2];
    return scoreOptions.has(score) ? score : null;
  }

  function hasSelectionLabel(words, width, height) {
    return selectionLabelConfidence(words, width, height) >= 0;
  }

  function selectionLabelForMarket(text, market) {
    const value = normalize(text);
    if (!market) return isSelectionLabel(value);
    if (market === "correct_score") return scoreOptions.has(value) || Boolean(repairSelectedScoreLabel(value));
    if (market === "half_full") return halfFullOptions.has(value);
    if (market === "total_goals") return totalGoalOptions.has(value);
    if (market === "match_result" || market === "handicap") {
      return ["胜", "平", "负", "主胜", "客胜"].includes(value);
    }
    return false;
  }

  function marketAt(y, words, height, x = null) {
    const validWords = (words || []).filter((word) => normalize(word.text)
      && Number(word.confidence ?? 100) >= 20 && getBox(word).right > getBox(word).left);
    const headings = makeHeadings(groupLines(validWords, height), validWords, height).sort((a, b) => a.cy - b.cy);
    const selectedY = Number(y);
    const vertical = headings.filter((heading) => heading.vertical && selectedY >= heading.cy
      && selectedY <= heading.bottom + height * 0.32);
    if (vertical.length) {
      const selectedX = x === null || x === undefined ? Number.NaN : Number(x);
      vertical.sort((a, b) => Number.isFinite(selectedX)
        ? Math.abs((a.left + a.right) / 2 - selectedX) - Math.abs((b.left + b.right) / 2 - selectedX)
        : Math.abs((a.cy + a.bottom) / 2 - selectedY) - Math.abs((b.cy + b.bottom) / 2 - selectedY));
      return vertical[0].market;
    }
    const priorIndex = headings.reduce((index, heading, current) => heading.cy < selectedY ? current : index, -1);
    if (priorIndex < 0) return headings.length === 1 ? headings[0].market : null;
    const prior = headings[priorIndex];
    const next = headings[priorIndex + 1];
    // A later market heading bounds the current section, so keep its context
    // even when a tall phone screenshot leaves a large gap above the options.
    if (next && selectedY < next.cy) return prior.market;
    if (selectedY - prior.bottom <= height * 0.32) return prior.market;
    return null;
  }

  function selectionLabelConfidence(words, width, height, market = null) {
    const validWords = (words || []).filter((word) => normalize(word.text)
      && Number(word.confidence ?? 100) >= 20 && getBox(word).right > getBox(word).left);
    const tokens = mergeFragments(groupLines(validWords, height), width);
    let best = -1;
    for (const word of tokens) {
      const confidence = Number(word.confidence ?? 50);
      if (selectionLabelForMarket(word.text, market)) {
        best = Math.max(best, confidence);
        continue;
      }
      // A selected-score crop contains only the option and SP. Keep repairs in
      // the upper part of the cell so a two-digit SP cannot become a score.
      if (market !== "half_full" && market !== "total_goals" && market !== "match_result" && market !== "handicap"
        && getBox(word).cy <= height * 0.5 && repairSelectedScoreLabel(word.text)) {
        best = Math.max(best, confidence * 0.85);
      }
    }
    return best;
  }

  function scoreSelectedCrop(item, pageWords, width, height, marketHint = null) {
    const region = item?.region || { x0: 0, y0: 0, x1: 0, y1: 0 };
    const contextualMarket = marketHint || marketAt((region.y0 + region.y1) / 2, pageWords, height, (region.x0 + region.x1) / 2);
    const cropWidth = Number(item?.cropWidth) || Math.max(1, region.x1 - region.x0);
    const cropHeight = Number(item?.cropHeight) || Math.max(1, region.y1 - region.y0);
    const inferredMarket = contextualMarket || inferSelectedMarket(item?.words || [], cropWidth, cropHeight);
    const labelConfidence = selectionLabelConfidence(item?.words || [], cropWidth, cropHeight, inferredMarket);
    if (labelConfidence < 0) return -10000;
    const row = parseSelectedRegions([item], pageWords, width, height)[0];
    return 1000 + labelConfidence
      + (row && !row.unrecognized ? 3000 : 0)
      + (row?.odds !== null && row?.odds !== undefined ? 1000 : 0)
      + (row && !row.needsReview ? 500 : 0);
  }

  function parseSelectedRegions(cropResults, pageWords, width, height) {
    const validPageWords = (pageWords || []).filter((word) => normalize(word.text)
      && Number(word.confidence ?? 100) >= 20 && getBox(word).right > getBox(word).left);

    return (cropResults || []).map((item, index) => {
      const region = item?.region || { x0: 0, y0: 0, x1: 0, y1: 0 };
      const regionWidth = Math.max(1, region.x1 - region.x0);
      const regionHeight = Math.max(1, region.y1 - region.y0);
      const scaleX = Number(item?.scaleX) > 0 ? Number(item.scaleX) : 1;
      const scaleY = Number(item?.scaleY) > 0 ? Number(item.scaleY) : 1;
      const cropWidth = Number(item?.cropWidth) || regionWidth * scaleX;
      const cropHeight = Number(item?.cropHeight) || regionHeight * scaleY;
      const offsetX = Number(item?.offsetX) || 0;
      const offsetY = Number(item?.offsetY) || 0;
      const cropWords = (item?.words || []).filter((word) => normalize(word.text)
        && Number(word.confidence ?? 100) >= 20 && getBox(word).right > getBox(word).left);
      const cropTokens = mergeFragments(groupLines(cropWords, cropHeight), cropWidth);
      const regionOdds = cropTokens.map((word) => ({ word, odds: numericOdds(word), box: getBox(word) }))
        .filter((entry) => entry.odds !== null && entry.box.cy >= cropHeight * 0.5)
        .sort((a, b) => b.box.cy - a.box.cy)[0] || null;
      const mappedTokens = cropTokens.map((word) => {
        const box = getBox(word);
        const repairedScore = box.cy <= cropHeight * 0.58 ? repairSelectedScoreLabel(word.text) : null;
        return {
          ...word,
          text: repairedScore || word.text,
          bbox: {
            x0: region.x0 + (box.left - offsetX) / scaleX,
            y0: region.y0 + (box.top - offsetY) / scaleY,
            x1: region.x0 + (box.right - offsetX) / scaleX,
            y1: region.y0 + (box.bottom - offsetY) / scaleY,
          },
        };
      });

      const contextualMarket = marketAt(region.y0 + regionHeight / 2, validPageWords, height, region.x0 + regionWidth / 2);
      const inferredMarket = contextualMarket || inferSelectedMarket(mappedTokens, width, height);
      const cropRows = inferredMarket
        ? parse(mappedTokens, width, height, () => true, inferredMarket)
        : [];
      const localPageRows = validPageWords.length
        ? parse(validPageWords, width, height,
          (bbox) => containsSelectedRegion(bbox, [region]), inferredMarket)
          .filter((row) => row.highlighted)
        : [];

      const bestCropRow = cropRows[0] || null;
      const bestPageRow = localPageRows[0] || null;
      // The crop is preferred when it supplies an option and SP; otherwise use
      // the existing full-page OCR only from inside this exact dark region.
      const row = bestCropRow && !bestCropRow.needsReview ? bestCropRow
        : bestPageRow && !bestPageRow.needsReview ? bestPageRow
          : bestCropRow || bestPageRow;
      if (row) {
        const odds = row.odds ?? regionOdds?.odds ?? null;
        const confidence = row.odds === null && regionOdds
          ? Math.round((Number(row.confidence ?? 0) + Number(regionOdds.word.confidence ?? 0)) / 2)
          : row.confidence;
        return {
          ...row,
          odds,
          confidence,
          needsReview: Boolean(row.needsReview || (row.odds === null && regionOdds)),
          highlighted: true,
          selectedRegion: index,
          unrecognized: false,
        };
      }

      const rawLabel = cropTokens.find((word) => getBox(word).cy <= cropHeight * 0.7
        && !numericOdds(word)) || cropTokens[0];
      const rawText = normalize(rawLabel?.text || "");
      const rawScore = rawLabel && getBox(rawLabel).cy <= cropHeight * 0.7
        ? repairSelectedScoreLabel(rawLabel.text) : null;
      const confidence = Math.round(regionOdds
        ? (Number(rawLabel?.confidence ?? 0) + Number(regionOdds.word.confidence ?? 0)) / 2
        : Number(rawLabel?.confidence ?? 0));
      return {
        market: inferredMarket || "correct_score",
        selection: rawScore || rawText,
        handicap: null,
        odds: regionOdds?.odds ?? null,
        confidence,
        highlighted: true,
        needsReview: true,
        unrecognized: true,
        selectedRegion: index,
        position: { x: Math.round(region.x0 + regionWidth / 2), y: Math.round(region.y0 + regionHeight / 2) },
      };
    });
  }

  function inferSelectedMarket(words, width, height) {
    const tokens = mergeFragments(groupLines(words || [], height), width);
    for (const word of tokens) {
      const text = normalize(word.text);
      if (scoreOptions.has(text) || repairSelectedScoreLabel(text)) return "correct_score";
      if (halfFullOptions.has(text)) return "half_full";
    }
    if (tokens.some((word) => totalGoalOptions.has(normalize(word.text)))) return "total_goals";
    if (tokens.some((word) => ["主胜", "客胜", "胜", "平", "负"].includes(normalize(word.text)))) return "match_result";
    return null;
  }

  function mergeSelectedRegionWords(pageWords, cropResults) {
    const replacements = (cropResults || []).filter((item) => {
      if (!item?.region || !Array.isArray(item.words) || !item.words.length) return false;
      const cropWidth = Number(item.cropWidth) || (item.region.x1 - item.region.x0) * (Number(item.scaleX) || 1);
      const cropHeight = Number(item.cropHeight) || (item.region.y1 - item.region.y0) * (Number(item.scaleY) || 1);
      return hasSelectionLabel(item.words, cropWidth, cropHeight);
    });
    const regions = replacements.map((item) => item.region);
    const retained = (pageWords || []).filter((word) => {
      const box = getBox(word);
      return !containsSelectedRegion({ x0: box.left, y0: box.top, x1: box.right, y1: box.bottom }, regions);
    });
    const enhanced = replacements.flatMap((item) => {
      const scaleX = Number(item.scaleX) > 0 ? Number(item.scaleX) : 1;
      const scaleY = Number(item.scaleY) > 0 ? Number(item.scaleY) : 1;
      const cropWidth = Number(item.cropWidth) || (item.region.x1 - item.region.x0) * scaleX;
      const cropHeight = Number(item.cropHeight) || (item.region.y1 - item.region.y0) * scaleY;
      const offsetX = Number(item.offsetX) || 0;
      const offsetY = Number(item.offsetY) || 0;
      const cropTokens = mergeFragments(groupLines(item.words, cropHeight), cropWidth);
      return cropTokens.map((word) => {
        const box = getBox(word);
        const repairedScore = box.cy <= cropHeight * 0.5 ? repairSelectedScoreLabel(word.text) : null;
        const bbox = {
          x0: item.region.x0 + (box.left - offsetX) / scaleX,
          y0: item.region.y0 + (box.top - offsetY) / scaleY,
          x1: item.region.x0 + (box.right - offsetX) / scaleX,
          y1: item.region.y0 + (box.bottom - offsetY) / scaleY,
        };
        return { ...word, text: repairedScore || word.text, bbox };
      });
    });
    return [...retained, ...enhanced];
  }

  function paddleWordsFromResult(result) {
    return (result?.items || []).flatMap((item) => {
      const polygon = Array.isArray(item?.poly) ? item.poly : [];
      const points = polygon.filter((point) => Array.isArray(point) && point.length >= 2)
        .map((point) => [Number(point[0]), Number(point[1])])
        .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
      if (!points.length || !normalize(item?.text)) return [];
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const score = Number(item.score);
      return [{
        text: String(item.text),
        confidence: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score * 100))) : 0,
        bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      }];
    });
  }

  function invertGrayPixels(data) {
    for (let offset = 0; offset < data.length; offset += 4) {
      // The selected-cell text is white; binarize it against a white background.
      const value = data[offset] >= 190 ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
    return data;
  }

  root.MatchMonitorOCR = { parse, parseSelectedRegions, parseScoreGridCells, preferScoreOdds, preprocessScoreOddsPixels, inferScoreGrid, scoreGridRows, scoreSelectedCrop, marketAt, validatePick, normalize, listedScoresFromRows, parseListedScores, detectSelectedRegions, containsSelectedRegion, hasSelectionLabel, selectionLabelConfidence, mergeSelectedRegionWords, invertGrayPixels, paddleWordsFromResult };
})(globalThis);
