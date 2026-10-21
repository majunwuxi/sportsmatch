(() => {
  const $ = (id) => document.getElementById(id);
  const selectedMarkets = Object.keys(MARKETS);
  let screenshotFile = null;
  let screenshotUrl = null;
  let parsedPicks = null;

  function setOcrStatus(message, error = false) {
    const node = $("ocrStatus");
    node.textContent = message;
    node.className = error ? "errors ocr-status" : "notice ocr-status";
  }

  function clearOcrConfirmation() {
    if ($("ocrConfirm")) $("ocrConfirm").checked = false;
  }

  function isHighlighted(canvas, bbox) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const cx = (bbox.x0 + bbox.x1) / 2;
    const x0 = Math.max(0, Math.floor(cx - Math.max(32, (bbox.x1 - bbox.x0) * 1.2)));
    const x1 = Math.min(canvas.width, Math.ceil(cx + Math.max(32, (bbox.x1 - bbox.x0) * 1.2)));
    const y0 = Math.max(0, Math.floor(bbox.y0 - 3));
    const y1 = Math.min(canvas.height, Math.ceil(bbox.y1 + Math.max(25, (bbox.y1 - bbox.y0) * 1.6)));
    if (x1 <= x0 || y1 <= y0) return false;
    const pixels = context.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let colored = 0, sampled = 0;
    for (let i = 0; i < pixels.length; i += 4 * 3) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      const luminance = (r * 3 + g * 5 + b * 2) / 10;
      if (high - low > 32 && luminance > 35 && luminance < 205) colored++;
      sampled++;
    }
    return sampled > 0 && colored / sampled >= 0.24;
  }

  function selectedPicks() {
    return (parsedPicks || []).filter((pick) => pick.enabled);
  }

  function validateRow(pick) {
    const checked = MatchMonitorOCR.validatePick({
      market: pick.market,
      selection: pick.selection,
      handicap: pick.handicap,
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
    const totalStake = selectedPicks().reduce((sum, item) => sum + Number(item.stake || 0), 0);
    for (const [index, pick] of parsedPicks.entries()) {
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
      if (pick.market === "handicap") {
        const handicap = document.createElement("input");
        handicap.type = "number";
        handicap.min = "-9";
        handicap.max = "9";
        handicap.step = "1";
        handicap.value = pick.handicap ?? "";
        handicap.placeholder = "让球数";
        handicap.setAttribute("aria-label", "第" + (index + 1) + "项主队让球数");
        handicap.oninput = () => { pick.handicap = handicap.value === "" ? null : Number(handicap.value); clearOcrConfirmation(); updateOcrRowState(tr, pick); };
        handicapCell.append(handicap);
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
      confidenceCell.textContent = (pick.highlighted ? "识别到选中底色 · " : "待勾选 · ") + "OCR " + pick.confidence + "%";
      if (pick.needsReview) confidenceCell.classList.add("bad");
      tr.append(checkCell, marketCell, selectionCell, handicapCell, oddsCell, stakeCell, resultCell, confidenceCell);
      body.append(tr);
    }
    updateOcrTotals();
  }

  function updateOcrRowState(tr, pick) {
    const state = validateRow(pick);
    tr.classList.toggle("ocr-invalid", !state.ok);
    const resultCell = tr.children[6];
    const returnAmount = Number(pick.stake || 0) * Number(pick.odds || 0);
    const total = selectedPicks().reduce((sum, item) => sum + Number(item.stake || 0), 0);
    resultCell.textContent = state.ok
      ? "返 " + money(returnAmount) + " · 净 " + (returnAmount - total >= 0 ? "+" : "") + money(returnAmount - total)
      : state.reason;
    resultCell.className = state.ok ? "good" : "bad";
    updateOcrTotals();
  }

  function updateOcrTotals() {
    if (!parsedPicks) return;
    const picks = selectedPicks();
    const total = picks.reduce((sum, item) => sum + Number(item.stake || 0), 0);
    for (const row of parsedPicks) row.totalStake = total;
    const valid = picks.filter((pick) => validateRow(pick).ok && Number(pick.stake) >= 2);
    const minimum = valid.length ? Math.min(...valid.map((pick) => Number(pick.stake) * Number(pick.odds) - total)) : null;
    $("ocrCount").textContent = "识别到 " + parsedPicks.length + " 项 · 已选择 " + picks.length + " 项 · 当前投入 " + money(total);
    $("ocrProfit").textContent = minimum === null
      ? "请选择项目、核对SP并分配金额。"
      : "单项命中时净利润区间：" + money(minimum) + " 至 " + money(Math.max(...valid.map((pick) => Number(pick.stake) * Number(pick.odds) - total))) + "。跨玩法同时命中时返奖会叠加。";
  }

  function balanceOcrPicks() {
    const picks = selectedPicks();
    const budget = Number($("budget").value);
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
      ...(pick.market === "handicap" ? { handicap: Number(pick.handicap) } : {}),
    }));
    const total = tickets.reduce((sum, ticket) => sum + ticket.stake, 0);
    return {
      schema_version: 1,
      fixture_id: selected?.id ?? null,
      home: selected?.home ?? null,
      away: selected?.away ?? null,
      kickoff: selected?.kickoff ?? null,
      netease_betting_assistant_url: $("bettingLink").value.trim() || null,
      screenshot_ocr: "browser_local_reviewed",
      budget: total,
      tickets,
    };
  }

  function clearOcr() {
    parsedPicks = null;
    clearOcrConfirmation();
    $("ocrReview").hidden = true;
    $("ocrRows").replaceChildren();
    setOcrStatus("图片仅在本机浏览器识别，不会上传到 Match Monitor 后台。请上传投注页面截图。" );
    $("ocrPreview").hidden = true;
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    screenshotUrl = null;
    screenshotFile = null;
    $("betScreenshot").value = "";
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

  $("betScreenshot").onchange = () => {
    const file = $("betScreenshot").files?.[0];
    parsedPicks = null;
    clearOcrConfirmation();
    $("ocrReview").hidden = true;
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    screenshotFile = null;
    screenshotUrl = null;
    if (!file) return;
    if (!file.type.startsWith("image/")) return setOcrStatus("请选择PNG、JPG或WEBP图片。", true);
    if (file.size > 15 * 1024 * 1024) return setOcrStatus("图片大于15MB，请先压缩或裁剪后再上传。", true);
    screenshotFile = file;
    screenshotUrl = URL.createObjectURL(file);
    $("ocrPreview").src = screenshotUrl;
    $("ocrPreview").hidden = false;
    setOcrStatus("已载入截图。点击“开始识别”；识别在当前浏览器本地运行，图片不会发送到服务器。" );
  };

  $("runOcr").onclick = async () => {
    if (!screenshotFile) return setOcrStatus("请先选择投注页面截图。", true);
    $("runOcr").disabled = true;
    $("ocrReview").hidden = true;
    try {
      setOcrStatus("正在载入中文识别引擎（首次使用需联网下载并缓存）…");
      await loadTesseract();
      const canvases = await imageCanvases(screenshotFile);
      const worker = await Tesseract.createWorker(["chi_sim", "eng"], 1, {
        logger: (event) => {
          if (event.status) setOcrStatus("截图识别中：" + event.status + (event.progress ? " " + Math.round(event.progress * 100) + "%" : ""));
        },
      });
      try {
        const result = await worker.recognize(canvases.ocr, {}, { blocks: true });
        parsedPicks = MatchMonitorOCR.parse(flattenOcrWords(result.data), canvases.width, canvases.height, (bbox) => isHighlighted(canvases.color, bbox))
          .map((row) => ({ ...row, enabled: row.highlighted, stake: 0 }));
      } finally {
        await worker.terminate();
      }
      $("ocrReview").hidden = false;
      clearOcrConfirmation();
      renderOcrRows();
      const highlighted = parsedPicks.filter((row) => row.highlighted).length;
      setOcrStatus(parsedPicks.length
        ? "识别出 " + parsedPicks.length + " 个候选项，其中 " + highlighted + " 个识别到选中底色。请逐项核对；颜色和OCR都可能误判。"
        : "没有识别到可用投注项。请换一张包含玩法标题、选项和SP的清晰截图，或手动填写模拟器。", !parsedPicks.length);
    } catch (error) {
      setOcrStatus(error?.message || "截图识别失败。请手动选择玩法和填写SP。", true);
    } finally {
      $("runOcr").disabled = false;
    }
  };

  $("clearOcr").onclick = clearOcr;
  $("balanceOcr").onclick = () => {
    try { balanceOcrPicks(); }
    catch (error) { setOcrStatus(error.message, true); }
  };

  const manualPayload = buildPayload;
  buildPayload = function () { return parsedPicks ? buildOcrPayload() : manualPayload(); };
  const manualBalance = $("autoBalance").onclick;
  $("autoBalance").onclick = () => {
    if (!parsedPicks) return manualBalance();
    try { balanceOcrPicks(); }
    catch (error) { setOcrStatus(error.message, true); }
  };
  setOcrStatus("图片仅在本机浏览器识别，不会上传到 Match Monitor 后台。请上传投注页面截图。" );
})();
