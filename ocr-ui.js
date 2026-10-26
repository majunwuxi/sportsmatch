(() => {
  const $ = (id) => document.getElementById(id);
  const selectedMarkets = Object.keys(MARKETS);
  let screenshotFile = null;
  let screenshotUrl = null;
  let parsedPicks = null;
  let showAllCandidates = false;
  let selectionRegionCount = 0;
  const oddsWhitelist = "0123456789.OQ↑↓↗↘↖↙⬆⬇⬈⬉⬊⬋⇧⇩↥↧▲▼△▽";

  function setOcrStatus(message, error = false) {
    const node = $("ocrStatus");
    node.textContent = message;
    node.className = error ? "errors ocr-status" : "notice ocr-status";
  }

  function clearOcrConfirmation() {
    if ($("ocrConfirm")) $("ocrConfirm").checked = false;
    if ($("verifyListedScores")) $("verifyListedScores").checked = false;
  }

  function detectSelectedRegions(colorCanvas, ocrCanvas) {
    const scale = Math.min(1, 900 / Math.max(colorCanvas.width, colorCanvas.height));
    const sample = document.createElement("canvas");
    sample.width = Math.max(1, Math.round(colorCanvas.width * scale));
    sample.height = Math.max(1, Math.round(colorCanvas.height * scale));
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(colorCanvas, 0, 0, sample.width, sample.height);
    const regions = MatchMonitorOCR.detectSelectedRegions(
      sampleContext.getImageData(0, 0, sample.width, sample.height).data,
      sample.width,
      sample.height,
    ).map((region) => {
      const sx = colorCanvas.width / sample.width;
      const sy = colorCanvas.height / sample.height;
      return {
        x0: Math.max(0, Math.floor(region.x0 * sx)),
        y0: Math.max(0, Math.floor(region.y0 * sy)),
        x1: Math.min(colorCanvas.width, Math.ceil(region.x1 * sx)),
        y1: Math.min(colorCanvas.height, Math.ceil(region.y1 * sy)),
      };
    });
    const context = ocrCanvas.getContext("2d", { willReadFrequently: true });
    for (const region of regions) {
      const x = region.x0, y = region.y0;
      const width = Math.max(0, region.x1 - x), height = Math.max(0, region.y1 - y);
      if (!width || !height) continue;
      const frame = context.getImageData(x, y, width, height);
      MatchMonitorOCR.invertGrayPixels(frame.data);
      context.putImageData(frame, x, y);
    }
    return regions;
  }

  function updateCandidateToggle() {
    const button = $("toggleOcrCandidates");
    if (!button || !parsedPicks) return;
    const remaining = parsedPicks.filter((pick) => !pick.highlighted && !pick.enabled).length;
    button.hidden = remaining === 0;
    button.textContent = showAllCandidates
      ? "收起未选候选项（" + remaining + "）"
      : "显示其他未选候选项（" + remaining + "）";
  }

  function selectedPicks() {
    return (parsedPicks || []).filter((pick) => pick.enabled);
  }

  function validateRow(pick) {
    const checked = MatchMonitorOCR.validatePick({
      market: pick.market,
      selection: pick.selection,
      handicap: pick.handicap,
      line: pick.line,
      odds: pick.odds,
    });
    if (!checked.ok) return checked;
    const stake = Number(pick.stake || 0);
    if (!Number.isInteger(stake) || stake < 0 || stake % 2 !== 0) return { ok: false, reason: "金额须为0或正的2元整数倍" };
    return checked;
  }

  function money(value) {
    return "¥" + Number(value || 0).toFixed(2);
  }

  function renderOcrRows() {
    const body = $("ocrRows");
    body.replaceChildren();
    if (!parsedPicks) return;
    const stakesByMarket = new Map();
    for (const item of selectedPicks()) stakesByMarket.set(item.market, (stakesByMarket.get(item.market) || 0) + Number(item.stake || 0));
    const visiblePicks = parsedPicks.filter((pick) => pick.highlighted || pick.enabled || showAllCandidates);
    if (!visiblePicks.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.textContent = "未检测到高亮底选项。请核对截图，或展开未选候选项后手动勾选。";
      row.append(cell);
      body.append(row);
    }
    for (const pick of visiblePicks) {
      const totalStake = stakesByMarket.get(pick.market) || 0;
      const index = parsedPicks.indexOf(pick);
      const tr = document.createElement("tr");
      const checkCell = document.createElement("td");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = pick.enabled;
      check.setAttribute("aria-label", "选择识别项 " + (index + 1));
      check.onchange = () => { pick.enabled = check.checked; clearOcrConfirmation(); renderOcrRows(); };
      checkCell.append(check);

      const marketCell = document.createElement("td");
      const market = document.createElement("select");
      for (const key of selectedMarkets) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = MARKETS[key];
        market.append(option);
      }
      market.value = pick.market;
      market.setAttribute("aria-label", "第" + (index + 1) + "项玩法");
      market.onchange = () => { pick.market = market.value; clearOcrConfirmation(); renderOcrRows(); };
      marketCell.append(market);

      const selectionCell = document.createElement("td");
      const selection = document.createElement("input");
      selection.type = "text";
      selection.value = pick.selection;
      selection.setAttribute("aria-label", "第" + (index + 1) + "项选项");
      selection.oninput = () => { pick.selection = selection.value.trim(); clearOcrConfirmation(); updateOcrRowState(tr, pick); };
      selectionCell.append(selection);

      const handicapCell = document.createElement("td");
      if (["handicap", "basketball_handicap"].includes(pick.market)) {
        const handicap = document.createElement("input");
        handicap.type = "number";
        handicap.min = pick.market === "handicap" ? "-9" : "-50";
        handicap.max = pick.market === "handicap" ? "9" : "50";
        handicap.step = pick.market === "handicap" ? "1" : "0.5";
        handicap.value = pick.handicap ?? "";
        handicap.placeholder = pick.market === "handicap" ? "让球数" : "让分值";
        handicap.setAttribute("aria-label", "第" + (index + 1) + "项主队让球数");
        handicap.oninput = () => { pick.handicap = handicap.value === "" ? null : Number(handicap.value); clearOcrConfirmation(); updateOcrRowState(tr, pick); };
        handicapCell.append(handicap);
      } else if (pick.market === "basketball_total") {
        const line = document.createElement("input");
        line.type = "number";
        line.min = "0";
        line.step = "0.5";
        line.value = pick.line ?? "";
        line.placeholder = "总分线";
        line.setAttribute("aria-label", "第" + (index + 1) + "项竞彩篮球大小分总分线");
        line.oninput = () => { pick.line = line.value === "" ? null : Number(line.value); clearOcrConfirmation(); updateOcrRowState(tr, pick); };
        handicapCell.append(line);
      } else handicapCell.textContent = "—";

      const oddsCell = document.createElement("td");
      const odds = document.createElement("input");
      odds.type = "number";
      odds.min = "1";
      odds.step = "0.01";
      odds.value = pick.odds ?? "";
      odds.placeholder = "核对SP";
      odds.setAttribute("aria-label", "第" + (index + 1) + "项SP");
      odds.oninput = () => { pick.odds = odds.value === "" ? null : Number(odds.value); clearOcrConfirmation(); updateOcrRowState(tr, pick); };
      oddsCell.append(odds);

      const stakeCell = document.createElement("td");
      const stake = document.createElement("input");
      stake.type = "number";
      stake.min = "0";
      stake.step = "2";
      stake.value = pick.stake || 0;
      stake.setAttribute("aria-label", "第" + (index + 1) + "项金额");
      stake.oninput = () => { pick.stake = Number(stake.value); clearOcrConfirmation(); updateOcrRowState(tr, pick); };
      stakeCell.append(stake);

      const resultCell = document.createElement("td");
      const state = validateRow(pick);
      const returnAmount = Number(pick.stake || 0) * Number(pick.odds || 0);
      resultCell.textContent = state.ok
        ? "返 " + money(returnAmount) + " · 净 " + (returnAmount - totalStake >= 0 ? "+" : "") + money(returnAmount - totalStake)
        : state.reason;
      resultCell.className = state.ok ? "good" : "bad";

      const confidenceCell = document.createElement("td");
      confidenceCell.textContent = pick.unrecognized
        ? "已按选区建行 · 请手动校对"
        : (pick.source === "basketball_ticket" ? "篮球纸质票识别 · " : pick.highlighted ? "选区内容识别 · " : "待勾选 · ") + "OCR " + pick.confidence + "%";
      if (pick.needsReview) confidenceCell.classList.add("bad");
      tr.append(checkCell, marketCell, selectionCell, handicapCell, oddsCell, stakeCell, resultCell, confidenceCell);
      body.append(tr);
    }
    updateCandidateToggle();
    updateOcrTotals();
  }

  function updateOcrRowState(tr, pick) {
    const state = validateRow(pick);
    tr.classList.toggle("ocr-invalid", !state.ok);
    const resultCell = tr.children[6];
    const returnAmount = Number(pick.stake || 0) * Number(pick.odds || 0);
    const total = selectedPicks().filter((item) => item.market === pick.market)
      .reduce((sum, item) => sum + Number(item.stake || 0), 0);
    const net = returnAmount - total;
    resultCell.textContent = state.ok
      ? "返 " + money(returnAmount) + " · 净 " + signedProfit(net)
      : state.reason;
    resultCell.className = state.ok ? (net >= 0 ? "good" : "bad") : "bad";
    updateOcrTotals();
  }

  function signedProfit(value) {
    return (value >= 0 ? "+" : "-") + money(Math.abs(value));
  }

  function updateOcrTotals() {
    if (!parsedPicks) return;
    const picks = selectedPicks();
    const total = picks.reduce((sum, item) => sum + Number(item.stake || 0), 0);
    const groups = new Map();
    for (const pick of picks) {
      if (!groups.has(pick.market)) groups.set(pick.market, { picks: [], total: 0 });
      const group = groups.get(pick.market);
      group.picks.push(pick);
      group.total += Number(pick.stake || 0);
    }
    for (const row of parsedPicks) row.totalStake = groups.get(row.market)?.total || 0;
    const highlighted = parsedPicks.filter((pick) => pick.highlighted).length;
    $("ocrSelectedCount").textContent = "已选 " + picks.length + " 项";
    $("ocrSelectedTotal").textContent = money(total);
    $("ocrCount").textContent = "候选 " + parsedPicks.length + " 项 · 检测选区 " + selectionRegionCount + " 块 · 按选区建单 " + highlighted + " 项 · 当前勾选 " + picks.length + " 项 · 投入 " + money(total);
    const marketSummaries = [...groups.entries()].map(([market, group]) => {
      const valid = group.picks.filter((pick) => validateRow(pick).ok && Number(pick.stake) >= 2);
      if (!valid.length) return (MARKETS[market] || "未知玩法") + "投注额 " + money(group.total) + "，待补充有效SP和金额";
      const profits = valid.map((pick) => Number(pick.stake) * Number(pick.odds) - group.total);
      return (MARKETS[market] || "未知玩法") + "投注额 " + money(group.total) + "，单项命中净利润 " +
        signedProfit(Math.min(...profits)) + " 至 " + signedProfit(Math.max(...profits));
    });
    $("ocrProfit").textContent = marketSummaries.length
      ? marketSummaries.join("；") + "。各玩法分别核算，跨玩法同时命中时返奖和净利润相加。"
      : "尚无已勾选的投注项。";
  }

  function balanceOcrPicks() {
    const picks = selectedPicks();
    const budget = Number($("ocrBudget").value);
    if (!Number.isInteger(budget) || budget < 2 || budget % 2) throw Error("预算必须是2元的正整数倍。");
    if (!picks.length) throw Error("请先勾选至少一个识别出的投注项。");
    if (picks.length > budget / 2) throw Error("预算不足以给每个选中项目至少分配2元。");
    for (const pick of picks) {
      const check = MatchMonitorOCR.validatePick(pick);
      if (!check.ok) throw Error("请先修正“" + pick.selection + "”：" + check.reason);
    }
    const stakes = picks.map(() => 0);
    const odds = picks.map((pick) => Number(pick.odds));
    for (let unit = 0; unit < budget / 2; unit++) {
      let target = 0;
      for (let i = 1; i < picks.length; i++) {
        if (stakes[i] * 2 * odds[i] < stakes[target] * 2 * odds[target]) target = i;
      }
      stakes[target]++;
    }
    picks.forEach((pick, index) => { pick.stake = stakes[index] * 2; });
    clearOcrConfirmation();
    renderOcrRows();
    setOcrStatus("已按2元一注均衡分配。请再次核对每条玩法、选项和SP，再复制 JSON。",
      picks.some((pick) => pick.needsReview || pick.confidence < 70));
  }

  function buildOcrPayload() {
    const picks = selectedPicks();
    if (!picks.length) throw Error("请勾选至少一个识别出的投注项。");
    if (!$('ocrConfirm').checked) throw Error("请先逐项核对，并勾选确认框后再导出。");
    for (const pick of picks) {
      const check = validateRow(pick);
      if (!check.ok || Number(pick.stake) < 2) throw Error("请先修正“" + pick.selection + "”：" + (check.ok ? "投注金额须至少为2元" : check.reason));
    }
    const tickets = picks.map((pick) => ({
      market: pick.market,
      selection: pick.selection,
      stake: Number(pick.stake),
      odds: Number(pick.odds),
      ...(["handicap", "basketball_handicap"].includes(pick.market) ? { handicap: Number(pick.handicap) } : {}),
      ...(pick.market === "basketball_total" ? { line: Number(pick.line) } : {}),
    }));
    const listedScoreResult = MatchMonitorOCR.parseListedScores($("listedScores").value);
    if (!listedScoreResult.ok) throw Error("截图精确比分清单中有无效选项：" + listedScoreResult.invalid.join("、"));
    const usesOther = tickets.some((ticket) => ticket.market === "correct_score"
      && ["胜其他", "平其他", "负其他"].includes(MatchMonitorOCR.normalize(ticket.selection).replace("其它", "其他")));
    if (usesOther && (!listedScoreResult.scores.length || !$("verifyListedScores").checked)) {
      throw Error("投注含‘胜其它/负其它’：请先补全截图中全部带SP的精确比分清单，并勾选清单确认。");
    }
    const total = tickets.reduce((sum, ticket) => sum + ticket.stake, 0);
    const isBasketball = tickets.some((ticket) => String(ticket.market || "").startsWith("basketball_"));
    return {
      schema_version: 2,
      sport: selected?.sport || (isBasketball ? "basketball" : "football"),
      fixture_id: selected?.id ?? null,
      home: selected?.home ?? null,
      away: selected?.away ?? null,
      league_name: selected?.league_name ?? null,
      kickoff: selected?.kickoff ?? null,
      screenshot_ocr: "browser_local_reviewed",
      budget: total,
      ...(!isBasketball ? {
        listed_scores: listedScoreResult.scores,
        listed_scores_verified: $("verifyListedScores").checked,
      } : {}),
      tickets,
    };
  }

  function clearOcr() {
    parsedPicks = null;
    showAllCandidates = false;
    selectionRegionCount = 0;
    clearOcrConfirmation();
    $("ocrReview").hidden = true;
    $("simulatorManual").hidden = true;
    $("ocrRows").replaceChildren();
    $("ocrSelectedCount").textContent = "已选 0 项";
    $("ocrSelectedTotal").textContent = money(0);
    $("listedScores").value = "";
    $("toggleOcrCandidates").hidden = true;
    setOcrStatus("图片仅在本机浏览器识别，不会上传到 Match Monitor 后台。请上传投注页面截图。" );
    $("ocrPreview").hidden = true;
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    screenshotUrl = null;
    screenshotFile = null;
    $("betScreenshot").value = "";
    $("ocrFileName").textContent = "尚未选择图片";
    $("ocrDropzone").classList.remove("drag-over");
  }

  async function loadTesseract() {
    if (globalThis.Tesseract?.createWorker) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = () => reject(new Error("OCR引擎无法加载，请检查网络，或直接使用手动选择方式。"));
      document.head.append(script);
    });
  }

  const paddleOcrOptions = {
    lang: "ch",
    ocrVersion: "PP-OCRv5",
    worker: true,
    ortOptions: {
      backend: "wasm",
      wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/",
      numThreads: 1,
      simd: true,
    },
  };

  function paddleResultsToWords(result) {
    return MatchMonitorOCR.paddleWordsFromResult(result);
  }

  async function createTesseractWorker() {
    await loadTesseract();
    return Tesseract.createWorker(["chi_sim", "eng"], 1, {
      logger: (event) => {
        if (event.status) setOcrStatus("截图识别中（备用引擎）: " + event.status + (event.progress ? " " + Math.round(event.progress * 100) + "%" : ""));
      },
    });
  }

  async function createOcrWorker() {
    let PaddleOCR;
    let paddle = null;
    let tesseract = null;
    let engine = "paddle-worker";
    let fallbackNotice = "";
    const createPaddle = async (worker) => PaddleOCR.create({ ...paddleOcrOptions, worker });
    const getTesseract = async (reason) => {
      if (!tesseract) {
        fallbackNotice = reason ? String(reason.message || reason).slice(0, 180) : "PaddleOCR.js不可用";
        setOcrStatus("PaddleOCR.js不可用，正在切换 Tesseract.js 备用识别…");
        tesseract = await createTesseractWorker();
      }
      engine = "tesseract";
      return tesseract;
    };

    try {
      setOcrStatus("正在载入 PaddleOCR.js（PP-OCRv5）…首次使用需要联网下载模型。");
      ({ PaddleOCR } = await import("https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/index.mjs"));
      try {
        paddle = await createPaddle(true);
      } catch (workerError) {
        setOcrStatus("正在切换 PaddleOCR.js 浏览器主线程模式…");
        paddle = await createPaddle(false);
        engine = "paddle-main";
      }
    } catch (error) {
      await getTesseract(error);
    }

    async function runPaddle(images) {
      try {
        return await paddle.predict(images);
      } catch (workerError) {
        if (engine === "paddle-worker") {
          try {
            await paddle.dispose();
            paddle = await createPaddle(false);
            engine = "paddle-main";
            setOcrStatus("PaddleOCR.js已切换到浏览器主线程，继续本地识别…");
            return await paddle.predict(images);
          } catch (mainThreadError) {
            await getTesseract(mainThreadError);
          }
        } else {
          await getTesseract(workerError);
        }
        return null;
      }
    }

    return {
      get engineName() {
        return engine === "paddle-worker" ? "PaddleOCR.js（PP-OCRv5）"
          : engine === "paddle-main" ? "PaddleOCR.js（PP-OCRv5，主线程）"
            : "Tesseract.js（备用）";
      },
      get fallbackNotice() { return fallbackNotice; },
      setParameters: async (parameters) => {
        if (engine === "tesseract") await tesseract.setParameters(parameters);
      },
      recognize: async (image, ...args) => {
        if (engine === "tesseract") return tesseract.recognize(image, ...args);
        const results = await runPaddle([image]);
        return results ? { data: { words: paddleResultsToWords(results[0]) } } : tesseract.recognize(image, ...args);
      },
      recognizeBatch: async (images) => {
        const recognizeTesseractBatch = async () => {
          const groups = [];
          for (const image of images) groups.push(flattenOcrWords((await tesseract.recognize(image, {}, { blocks: true })).data));
          return groups;
        };
        if (engine === "tesseract") return recognizeTesseractBatch();
        const results = await runPaddle(images);
        return results ? results.map(paddleResultsToWords)
          : recognizeTesseractBatch();
      },
      terminate: async () => {
        if (paddle?.dispose) await paddle.dispose();
        if (tesseract?.terminate) await tesseract.terminate();
      },
    };
  }

  function createBandCanvas(crop, top, bottom) {
    const y0 = Math.max(0, Math.floor(top));
    const y1 = Math.min(crop.height, Math.max(y0 + 1, Math.ceil(bottom)));
    const band = document.createElement("canvas");
    band.width = crop.width;
    band.height = y1 - y0;
    band.getContext("2d").drawImage(crop, 0, y0, crop.width, band.height, 0, 0, crop.width, band.height);
    return { canvas: band, offsetY: y0 };
  }

  function flattenOcrWords(data) {
    if (Array.isArray(data?.words) && data.words.length) return data.words;
    const words = [];
    for (const block of data?.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) words.push(...(line.words || []));
      }
    }
    return words;
  }

  function shiftOcrWords(words, offsetY = 0) {
    return words.map((word) => {
      const box = word.bbox || {};
      const top = Number(box.y0 ?? word.top ?? 0);
      const bottom = Number(box.y1 ?? (top + Number(word.height ?? 0)));
      return { ...word, bbox: { ...box, y0: top + offsetY, y1: bottom + offsetY } };
    });
  }

  async function recognizeBand(worker, crop, top, bottom, psmMode, whitelist) {
    const { canvas: band, offsetY } = createBandCanvas(crop, top, bottom);
    await worker.setParameters({ tessedit_pageseg_mode: psmMode, tessedit_char_whitelist: whitelist });
    const result = await worker.recognize(band, {}, { blocks: true });
    return shiftOcrWords(flattenOcrWords(result.data), offsetY);
  }

  async function recognizeSelectedRegions(worker, colorCanvas, ocrCanvas, regions, pageWords, pageWidth, pageHeight) {
    if (!regions.length) return [];
    const cropResults = [];
    const psm = globalThis.Tesseract?.PSM || {};
    const selectionWhitelist = "0123456789:.+OQZz胜平负其他其它主客";
    try {
      for (let index = 0; index < regions.length; index++) {
        const region = regions[index];
        const sourceWidth = Math.max(1, region.x1 - region.x0);
        const sourceHeight = Math.max(1, region.y1 - region.y0);
        const upscale = Math.max(1, Math.min(4, 3000 / Math.max(sourceWidth, sourceHeight), Math.sqrt(4_000_000 / (sourceWidth * sourceHeight))));
        const contentWidth = Math.max(sourceWidth, Math.floor(sourceWidth * upscale));
        const contentHeight = Math.max(sourceHeight, Math.floor(sourceHeight * upscale));
        const paddingX = Math.max(24, Math.round(Math.min(sourceWidth * 0.16, 32) * upscale));
        const paddingY = Math.max(24, Math.round(Math.min(sourceHeight * 0.20, 24) * upscale));
        const base = {
          region,
          scaleX: contentWidth / sourceWidth,
          scaleY: contentHeight / sourceHeight,
          cropWidth: contentWidth + paddingX * 2,
          cropHeight: contentHeight + paddingY * 2,
          offsetX: paddingX,
          offsetY: paddingY,
        };
        const variants = [colorCanvas, ocrCanvas];
        const crops = [];
        for (let variant = 0; variant < variants.length; variant++) {
          const crop = document.createElement("canvas");
          crop.width = base.cropWidth;
          crop.height = base.cropHeight;
          const context = crop.getContext("2d", { willReadFrequently: true });
          context.fillStyle = "#fff";
          context.fillRect(0, 0, crop.width, crop.height);
          context.imageSmoothingEnabled = true;
          context.drawImage(variants[variant], region.x0, region.y0, sourceWidth, sourceHeight,
            paddingX, paddingY, contentWidth, contentHeight);
          crops.push(crop);
        }

        const labelWhitelist = "0123456789:.+OQZz胜平负其他其它主客";
        // Keep option and SP recognition bands close to their visual rows.
        // The previous broad overlap let small odds such as 18 leak into the
        // option pass and made partial labels look competitive with real ones.
        const labelEnd = Math.min(base.cropHeight, paddingY + contentHeight * 0.58);
        const oddsStart = Math.max(0, paddingY + contentHeight * 0.54);
        const labelPasses = [];
        const oddsPasses = [];
        const candidates = [];

        // Keep the original whole-cell read as a fallback, while separately
        // reading the label and SP lines from both original and binarized pixels.
        setOcrStatus("正在分行识别选区选项与SP：" + (index + 1) + "/" + regions.length + "…");
        if (worker.engineName.startsWith("PaddleOCR.js") && typeof worker.recognizeBatch === "function") {
          const bands = crops.map((crop) => ({
            label: createBandCanvas(crop, 0, labelEnd),
            odds: createBandCanvas(crop, oddsStart, base.cropHeight),
          }));
          const inputs = [crops[0], ...bands.flatMap((item) => [item.label.canvas, item.odds.canvas])];
          const words = await worker.recognizeBatch(inputs);
          candidates.push({ ...base, words: words[0] || [], recognition: "whole-cell" });
          bands.forEach((item, cropIndex) => {
            const start = 1 + cropIndex * 2;
            labelPasses.push(words[start] || []);
            oddsPasses.push(shiftOcrWords(words[start + 1] || [], item.odds.offsetY));
          });
        } else {
          await worker.setParameters({ tessedit_pageseg_mode: psm.SINGLE_BLOCK || "6", tessedit_char_whitelist: selectionWhitelist });
          const fullResult = await worker.recognize(crops[0], {}, { blocks: true });
          candidates.push({ ...base, words: flattenOcrWords(fullResult.data), recognition: "whole-cell" });
          for (const crop of crops) {
            labelPasses.push(await recognizeBand(worker, crop, 0, labelEnd, psm.SINGLE_LINE || "7", labelWhitelist));
            oddsPasses.push(await recognizeBand(worker, crop, oddsStart, base.cropHeight, psm.SINGLE_LINE || "7", oddsWhitelist));
          }
        }
        // Pair the clearest label pass with each SP pass. This lets Chinese or
        // score text and the smaller numeric odds use different preprocessing.
        for (const labelWords of labelPasses) {
          for (const oddsWords of oddsPasses) {
            candidates.push({ ...base, words: [...labelWords, ...oddsWords], recognition: "split-label-and-odds" });
          }
        }
        const marketHint = MatchMonitorOCR.marketAt((region.y0 + region.y1) / 2, pageWords, pageHeight);
        let bestResult = candidates[0];
        let bestQuality = -Infinity;
        for (const candidate of candidates) {
          const quality = MatchMonitorOCR.scoreSelectedCrop(candidate, pageWords, pageWidth, pageHeight, marketHint);
          if (quality > bestQuality) {
            bestResult = candidate;
            bestQuality = quality;
          }
        }
        // Keep one OCR record per dark selection even when neither crop variant
        // recognizes a supported label. The selection itself still creates a row.
        cropResults[index] = bestResult || { ...base, words: [] };
      }
    } finally {
      await worker.setParameters({
        tessedit_pageseg_mode: psm.AUTO || "3",
        tessedit_char_whitelist: "",
      });
    }
    return cropResults;
  }

  async function recognizeScoreGridCells(worker, sourceCanvas, grid, passName, selectionRegions = [], threshold = 190) {
    if (!grid?.cells?.length) return [];
    const psm = globalThis.Tesseract?.PSM || {};
    const prepared = [];
    for (const cell of grid.cells) {
      const region = cell.region;
      const sourceWidth = Math.max(1, region.x1 - region.x0);
      const sourceHeight = Math.max(1, region.y1 - region.y0);
      const upscale = Math.max(1, Math.min(3, 2200 / Math.max(sourceWidth, sourceHeight), Math.sqrt(1_800_000 / (sourceWidth * sourceHeight))));
      const contentWidth = Math.max(sourceWidth, Math.floor(sourceWidth * upscale));
      const contentHeight = Math.max(sourceHeight, Math.floor(sourceHeight * upscale));
      const paddingX = Math.max(16, Math.round(Math.min(sourceWidth * 0.12, 24) * upscale));
      const paddingY = Math.max(16, Math.round(Math.min(sourceHeight * 0.10, 18) * upscale));
      const crop = document.createElement("canvas");
      crop.width = contentWidth + paddingX * 2;
      crop.height = contentHeight + paddingY * 2;
      const context = crop.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, crop.width, crop.height);
      context.imageSmoothingEnabled = true;
      context.drawImage(sourceCanvas, region.x0, region.y0, sourceWidth, sourceHeight,
        paddingX, paddingY, contentWidth, contentHeight);

      const center = cell.center || { x: (region.x0 + region.x1) / 2, y: (region.y0 + region.y1) / 2 };
      const selected = (selectionRegions || []).some((item) =>
        center.x >= item.x0 && center.x <= item.x1 && center.y >= item.y0 && center.y <= item.y1);
      const pixels = context.getImageData(0, 0, crop.width, crop.height);
      MatchMonitorOCR.preprocessScoreOddsPixels(pixels.data, selected, threshold);
      context.putImageData(pixels, 0, 0);

      // The grid fit gives the score label center. The SP is the second line,
      // below it; crop only that band so a missing decimal or nearby score
      // digits cannot be mistaken for the odds.
      const oddsStart = Math.min(crop.height - 1, paddingY + contentHeight * 0.66);
      const band = createBandCanvas(crop, oddsStart, crop.height);
      prepared.push({ cell, crop, band });
    }
    setOcrStatus("正在逐格识别比分 SP：" + prepared.length + " 项（" + passName + "）…");
    if (worker.engineName.startsWith("PaddleOCR.js") && typeof worker.recognizeBatch === "function") {
      const wordGroups = await worker.recognizeBatch(prepared.map((item) => item.band.canvas));
      return prepared.map((item, index) => ({
        ...item.cell,
        words: shiftOcrWords(wordGroups[index] || [], item.band.offsetY),
        cropWidth: item.crop.width,
        cropHeight: item.crop.height,
      }));
    }
    const results = [];
    for (const item of prepared) {
      await worker.setParameters({ tessedit_pageseg_mode: psm.SINGLE_LINE || "7", tessedit_char_whitelist: oddsWhitelist });
      const read = await worker.recognize(item.band.canvas, {}, { blocks: true });
      results.push({
        ...item.cell,
        words: shiftOcrWords(flattenOcrWords(read.data), item.band.offsetY),
        cropWidth: item.crop.width,
        cropHeight: item.crop.height,
      });
    }
    return results;
  }

  function preferScoreGridRead(first, second) {
    if (!first?.odds) return second || first;
    if (!second?.odds) return first;
    const a = String(first.odds), b = String(second.odds);
    if (a.replace(".", "") === b.replace(".", "") && a.includes(".") !== b.includes(".")) {
      return a.includes(".") ? first : second;
    }
    return Number(second.confidence || 0) > Number(first.confidence || 0) ? second : first;
  }

  async function imageCanvases(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(2, 2600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const color = document.createElement("canvas");
    color.width = width;
    color.height = height;
    color.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, width, height);
    const ocr = document.createElement("canvas");
    ocr.width = width;
    ocr.height = height;
    const ctx = ocr.getContext("2d", { willReadFrequently: true });
    ctx.filter = "grayscale(1) contrast(1.2)";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return { color, ocr, width, height };
  }

  function basketballReceiptCrop(source) {
    // Printed tickets are usually photographed against a busy background and
    // occupy the center/lower part of the frame. A local enlarged crop gives
    // PaddleOCR a cleaner second pass without uploading the image.
    const x0 = Math.round(source.width * 0.035);
    const y0 = Math.round(source.height * 0.14);
    const sourceWidth = Math.max(1, Math.round(source.width * 0.93));
    const sourceHeight = Math.max(1, Math.round(source.height * 0.82));
    const scale = Math.max(1, Math.min(3, 3000 / Math.max(sourceWidth, sourceHeight),
      Math.sqrt(5_000_000 / (sourceWidth * sourceHeight))));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = "grayscale(1) contrast(1.35)";
    context.imageSmoothingEnabled = true;
    context.drawImage(source, x0, y0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function basketballTicketQuality(ticket) {
    if (!ticket?.matched) return -1;
    const picks = ticket.picks || [];
    return 100 + (ticket.market ? 30 : 0) + picks.length * 20
      + picks.filter((pick) => Number.isFinite(Number(pick.odds)) && Number(pick.odds) >= 1).length * 15
      + (ticket.fixture ? 5 : 0) + (Number.isFinite(ticket.totalStake) ? 5 : 0)
      + (Number.isFinite(ticket.maxPayout) ? 5 : 0);
  }

  function selectScreenshotFile(file) {
    parsedPicks = null;
    showAllCandidates = false;
    selectionRegionCount = 0;
    clearOcrConfirmation();
    $("ocrReview").hidden = true;
    $("simulatorManual").hidden = true;
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    screenshotFile = null;
    screenshotUrl = null;
    $("ocrPreview").hidden = true;
    $("ocrFileName").textContent = "尚未选择图片";
    if (!file) return false;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setOcrStatus("请选择PNG、JPG或WEBP图片。", true);
      return false;
    }
    if (file.size > 15 * 1024 * 1024) {
      setOcrStatus("图片大于15MB，请先压缩或裁剪后再上传。", true);
      return false;
    }
    screenshotFile = file;
    screenshotUrl = URL.createObjectURL(file);
    $("ocrPreview").src = screenshotUrl;
    $("ocrPreview").hidden = false;
    $("ocrFileName").textContent = file.name || "已选择截图";
    setOcrStatus("已载入截图。点击“开始识别”；识别在当前浏览器本地运行，图片不会发送到服务器。" );
    return true;
  }

  function bindScreenshotDropzone(dropzone, onFile, onInvalidDrop) {
    let dragDepth = 0;
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
    dropzone.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      dropzone.classList.add("drag-over");
    });
    dropzone.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      dropzone.classList.add("drag-over");
    });
    dropzone.addEventListener("dragleave", (event) => {
      if (!hasFiles(event)) return;
      if (dragDepth > 0) dragDepth -= 1;
      if (dragDepth === 0 || !dropzone.contains(event.relatedTarget)) dropzone.classList.remove("drag-over");
    });
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      dropzone.classList.remove("drag-over");
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length !== 1) return onInvalidDrop("请一次拖入一张投注截图。" );
      onFile(files[0]);
    });
  }

  $("betScreenshot").onchange = () => selectScreenshotFile($("betScreenshot").files?.[0] || null);
  bindScreenshotDropzone($("ocrDropzone"), selectScreenshotFile, (message) => setOcrStatus(message, true));

  function pasteScreenshot(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const imageItem = Array.from(clipboard.items || []).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const file = imageItem?.getAsFile() || Array.from(clipboard.files || []).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    const loaded = selectScreenshotFile(file);
    $("ocrDropzone").scrollIntoView({ behavior: "smooth", block: "center" });
    $("createError").textContent = loaded
      ? "已载入粘贴的票面图片。请在下方点击“开始识别”，核对识别结果后再填入投注。"
      : "粘贴的图片未载入，请确认格式为 PNG、JPG 或 WebP 且小于 15 MB。";
  }

  $("tickets").addEventListener("paste", pasteScreenshot);
  $("ocrDropzone").addEventListener("paste", pasteScreenshot);

  $("runOcr").onclick = async () => {
    if (!screenshotFile) return setOcrStatus("请先选择投注页面截图。", true);
    $("runOcr").disabled = true;
    $("ocrReview").hidden = true;
    $("simulatorManual").hidden = true;
    parsedPicks = null;
    showAllCandidates = false;
    selectionRegionCount = 0;
    let scoreGrid = null;
    let scoreGridRows = [];
    let scoreListRows = [];
    let basketballTicket = null;
    try {
      setOcrStatus("正在载入 PaddleOCR.js（首次使用需联网下载并缓存模型）…");
      const canvases = await imageCanvases(screenshotFile);
      const selectionRegions = detectSelectedRegions(canvases.color, canvases.ocr);
      selectionRegionCount = selectionRegions.length;
      const worker = await createOcrWorker();
      try {
        setOcrStatus("正在识别截图，当前引擎：" + worker.engineName + "…");
        const result = await worker.recognize(canvases.ocr, {}, { blocks: true });
        let pageWords = flattenOcrWords(result.data);
        basketballTicket = MatchMonitorOCR.parseBasketballTicket(pageWords, canvases.width, canvases.height);
        const likelyReceiptPhoto = Boolean(basketballTicket.matched || basketballTicket.candidate || basketballTicket.receiptOnly)
          || (canvases.height > canvases.width * 1.15 && selectionRegions.length >= 10);
        if (likelyReceiptPhoto && (!basketballTicket.matched || !basketballTicket.picks?.length
          || basketballTicket.picks.some((pick) => pick.odds === null || pick.odds === undefined))) {
          setOcrStatus("纸票文字较小，正在本机放大票面区域复核…");
          const focusedCanvas = basketballReceiptCrop(canvases.ocr);
          const focusedResult = await worker.recognize(focusedCanvas, {}, { blocks: true });
          const focusedWords = flattenOcrWords(focusedResult.data);
          const focusedTicket = MatchMonitorOCR.parseBasketballTicket(focusedWords, focusedCanvas.width, focusedCanvas.height);
          if (basketballTicketQuality(focusedTicket) > basketballTicketQuality(basketballTicket)) {
            basketballTicket = focusedTicket;
            pageWords = focusedWords;
          }
        }
        if (basketballTicket.matched) {
          parsedPicks = basketballTicket.picks.map((pick) => ({ ...pick, source: "basketball_ticket" }));
          selectionRegionCount = 0;
          $("listedScores").value = "";
          if (Number.isFinite(basketballTicket.totalStake)) $("ocrBudget").value = String(basketballTicket.totalStake);
        } else {
        const cropResults = await recognizeSelectedRegions(
          worker,
          canvases.color,
          canvases.ocr,
          selectionRegions,
          pageWords,
          canvases.width,
          canvases.height,
        );
        const enhancedWords = MatchMonitorOCR.mergeSelectedRegionWords(pageWords, cropResults);
        const pageCandidates = MatchMonitorOCR.parse(enhancedWords, canvases.width, canvases.height,
          (bbox) => MatchMonitorOCR.containsSelectedRegion(bbox, selectionRegions));
        let selectedRows = MatchMonitorOCR.parseSelectedRegions(cropResults, pageWords, canvases.width, canvases.height);
        scoreGrid = MatchMonitorOCR.inferScoreGrid(pageCandidates, canvases.width, canvases.height);
        if (scoreGrid) {
          const firstRead = MatchMonitorOCR.parseScoreGridCells(
            await recognizeScoreGridCells(worker, canvases.color, scoreGrid, "去箭头" , selectionRegions, 190));
          const sourceRows = [...pageCandidates, ...selectedRows];
          const sourceOdds = new Map(sourceRows.filter((row) => row.market === "correct_score")
            .map((row) => [row.selection, row.odds]));
          const retryScores = new Set(firstRead.filter((row) => {
            const known = sourceOdds.get(row.selection);
            return row.odds === null || row.confidence < 75 || Number.isInteger(row.odds) && row.odds >= 100
              || known !== undefined && known !== null && Number(known) !== Number(row.odds);
          }).map((row) => row.selection));
          if (retryScores.size) {
            const retryGrid = { ...scoreGrid, cells: scoreGrid.cells.filter((cell) => retryScores.has(cell.selection)) };
            const secondRead = MatchMonitorOCR.parseScoreGridCells(
              await recognizeScoreGridCells(worker, canvases.color, retryGrid, "阈值复核", selectionRegions, 210));
            const retryByScore = new Map(secondRead.map((row) => [row.selection, row]));
            scoreGridRows = firstRead.map((row) => preferScoreGridRead(row, retryByScore.get(row.selection)));
          } else scoreGridRows = firstRead;
        }
        const gridByScore = new Map(scoreGridRows.map((row) => [row.selection, row]));
        const applyGridOdds = (row) => {
          const gridRow = row.market === "correct_score" ? gridByScore.get(row.selection) : null;
          return gridRow ? MatchMonitorOCR.preferScoreOdds(row, gridRow) : row;
        };
        selectedRows = selectedRows.map(applyGridOdds);
        const pageCandidatesWithGrid = pageCandidates.map(applyGridOdds);
        const presentScores = new Set(pageCandidatesWithGrid
          .filter((row) => row.market === "correct_score").map((row) => row.selection));
        const recoveredScores = scoreGridRows.filter((row) => !presentScores.has(row.selection))
          .map((row) => ({ ...row, highlighted: MatchMonitorOCR.containsSelectedRegion(
            scoreGrid.cells.find((cell) => cell.selection === row.selection)?.region, selectionRegions) }));
        const selectedKeys = new Set(selectedRows.filter((row) => row.selection)
          .map((row) => [row.market, row.handicap, row.selection].join("|")));
        const otherCandidates = [...pageCandidatesWithGrid, ...recoveredScores].filter((row) => !row.highlighted
          && !selectedKeys.has([row.market, row.handicap, row.selection].join("|")));
        parsedPicks = [...otherCandidates, ...selectedRows]
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
          .map((row) => ({ ...row, enabled: row.highlighted, stake: 0 }));
        scoreListRows = [...parsedPicks, ...pageCandidatesWithGrid, ...selectedRows, ...scoreGridRows];
        $("listedScores").value = MatchMonitorOCR.listedScoresFromRows(scoreListRows).join(", ");
        }
      } finally {
        await worker.terminate();
      }
      $("ocrReview").hidden = false;
      clearOcrConfirmation();
      renderOcrRows();
      if (parsedPicks.length) {
        $("market").value = (parsedPicks.find((row) => row.highlighted) || parsedPicks[0]).market;
        renderRows();
      }
      const hasRecognizedSelections = parsedPicks.some((row) => row.highlighted && row.selection && !row.unrecognized);
      $("simulatorManual").hidden = hasRecognizedSelections;
      const highlighted = parsedPicks.filter((row) => row.highlighted).length;
      const recognizedLabels = parsedPicks.filter((row) => row.highlighted && row.selection && !row.unrecognized).length;
      const recognizedOdds = parsedPicks.filter((row) => row.highlighted && row.odds !== null).length;
      const listedScoreCount = MatchMonitorOCR.listedScoresFromRows(scoreListRows).length;
      const gridScoreCount = scoreGridRows.filter((row) => row.odds !== null).length;
      const gridStatus = scoreGrid
        ? "逐格识别 SP " + gridScoreCount + "/28；缺失SP的标准比分仍列入候选项，可展开补录"
        : "未能自动定位比分表格";
      const engineStatus = "识别引擎：" + worker.engineName + (worker.fallbackNotice ? "（" + worker.fallbackNotice + "）" : "") + "。";
      if (basketballTicket?.matched) {
        const fixtureText = basketballTicket.fixture
          ? "票面比赛：" + basketballTicket.fixture.away + " VS " + basketballTicket.fixture.home + "。"
          : "";
        const amountText = Number.isFinite(basketballTicket.totalStake)
          ? "票面合计 " + money(basketballTicket.totalStake) + "，已按识别项目分配金额。"
          : "未识别到票面合计金额，请手动填写金额。";
        const payoutText = Number.isFinite(basketballTicket.maxPayout)
          ? "票面最高可能返奖 " + money(basketballTicket.maxPayout) + "。"
          : "";
        const issueText = (basketballTicket.issueNumber ? "第" + basketballTicket.issueNumber + "期。" : "")
          + (basketballTicket.issue ? basketballTicket.issue + "。" : "");
        const ticketTypeText = basketballTicket.receiptOnly ? "检测到体育彩票纸质票面。" : "识别到竞彩篮球纸质票。";
        setOcrStatus(engineStatus + ticketTypeText + (parsedPicks.length ? issueText + fixtureText : "")
          + (parsedPicks.length
            ? "识别到 " + parsedPicks.length + " 项 " + (MARKETS[basketballTicket.market] || "篮球投注") + "；"
              + amountText + payoutText + "请对照纸票核对球队、选项、SP和金额。"
            : issueText + amountText + "尚未识别到可用选项。" + (basketballTicket.issue || "")
              + "请核对票面格式，或手动录入投注。"), !parsedPicks.length);
      } else setOcrStatus(engineStatus + (parsedPicks.length
        ? highlighted
          ? "识别出 " + parsedPicks.length + " 个候选项，检测到 " + selectionRegionCount + " 块高亮选区，并按选区建立 " + highlighted + " 条投注项（选项识别 " + recognizedLabels + "/" + selectionRegionCount + "，SP识别 " + recognizedOdds + "/" + selectionRegionCount + "）。" + gridStatus + "；精确比分清单当前有 " + listedScoreCount + "/28 项，请对照截图核对。"
          : selectionRegionCount
            ? "检测到 " + selectionRegionCount + " 块高亮选区，但未能建立选区记录。" + gridStatus + "；精确比分清单当前有 " + listedScoreCount + "/28 项，请核对清单。"
            : "识别到 " + parsedPicks.length + " 个候选项，但没有检测到高亮底选项，因此没有自动勾选。" + gridStatus + "；精确比分清单当前有 " + listedScoreCount + "/28 项，请核对清单。"
        : "没有识别到可用投注项。请换一张包含玩法标题、选项和SP的清晰截图，或手动填写模拟器。"), !parsedPicks.length);
    } catch (error) {
      $("simulatorManual").hidden = false;
      setOcrStatus(error?.message || "截图识别失败。请手动选择玩法和填写SP。", true);
    } finally {
      $("runOcr").disabled = false;
    }
  };

  $("clearOcr").onclick = clearOcr;
  $("listedScores").oninput = () => clearOcrConfirmation();
  $("toggleOcrCandidates").onclick = () => { showAllCandidates = !showAllCandidates; renderOcrRows(); };
  $("manualMode").onclick = () => { $("simulatorManual").hidden = false; $("market").focus(); };
  $("balanceOcr").onclick = () => {
    try { balanceOcrPicks(); }
    catch (error) { setOcrStatus(error.message, true); }
  };
  $("exportOcrJson").onclick = async () => {
    try {
      const payload = buildOcrPayload();
      await window.copyMatchMonitorText(JSON.stringify(payload, null, 2));
      setOcrStatus("所选投注 JSON 已复制到本地剪贴板，可粘贴到监测任务投注框。请再次核对投注项和SP。" );
    } catch (error) { setOcrStatus(error.message, true); }
  };
  $("applyOcrJson").onclick = () => {
    try {
      const payload = buildOcrPayload();
      $("tickets").value = JSON.stringify(payload, null, 2);
      if (payload.fixture_id) $("selected").textContent = payload.home + " vs " + payload.away + " · " + leagueLabel(payload.league_name) + " · 北京时间 " + formatKickoffBeijing(payload.kickoff) + " · ID " + payload.fixture_id;
      $("tickets").scrollIntoView({ behavior: "smooth", block: "center" });
      $("createError").textContent = "投注 JSON 已填入。请确认比赛、开始时间和监测间隔。";
    } catch (error) { setOcrStatus(error.message, true); }
  };

  const manualPayload = buildPayload;
  buildPayload = function () { return parsedPicks?.length ? buildOcrPayload() : manualPayload(); };
  const manualBalance = $("autoBalance").onclick;
  $("autoBalance").onclick = () => {
    if (!parsedPicks?.length) return manualBalance();
    try { balanceOcrPicks(); }
    catch (error) { setOcrStatus(error.message, true); }
  };
  setOcrStatus("图片仅在本机浏览器识别，不会上传到 Match Monitor 后台。请上传投注页面截图。" );
})();
