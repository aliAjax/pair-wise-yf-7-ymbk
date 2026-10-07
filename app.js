const storageKey = "zfl16-movable-type-workshop";

const starterInventory = [
  { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
  { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
  { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
  { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
];

const defaultState = {
  inventory: starterInventory,
  selectedTypeId: starterInventory[0].id,
  placements: [],
  drafts: [],
  conflict: null,
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

let state = loadState();
let lastSavedJson = localStorage.getItem(storageKey);
let noticeTimer = null;

const els = {
  paperSize: document.querySelector("#paperSize"),
  flowMode: document.querySelector("#flowMode"),
  gridGap: document.querySelector("#gridGap"),
  workTitle: document.querySelector("#workTitle"),
  stage: document.querySelector("#stage"),
  typeList: document.querySelector("#typeList"),
  typeForm: document.querySelector("#typeForm"),
  charInput: document.querySelector("#charInput"),
  styleInput: document.querySelector("#styleInput"),
  sizeInput: document.querySelector("#sizeInput"),
  quantityInput: document.querySelector("#quantityInput"),
  wearInput: document.querySelector("#wearInput"),
  inventorySearch: document.querySelector("#inventorySearch"),
  styleFilter: document.querySelector("#styleFilter"),
  selectedTypeLabel: document.querySelector("#selectedTypeLabel"),
  shortageBadge: document.querySelector("#shortageBadge"),
  usageList: document.querySelector("#usageList"),
  noticeBar: document.querySelector("#noticeBar"),
  conflictBox: document.querySelector("#conflictBox"),
  draftList: document.querySelector("#draftList"),
  placedCount: document.querySelector("#placedCount"),
  inventoryCount: document.querySelector("#inventoryCount"),
  saveDraftBtn: document.querySelector("#saveDraftBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  clearBoardBtn: document.querySelector("#clearBoardBtn")
};

function normalizeDraft(draft) {
  return {
    id: draft.id || crypto.randomUUID(),
    title: draft.title || "未命名作品",
    settings: draft.settings || structuredClone(defaultState.settings),
    placements: Array.isArray(draft.placements) ? draft.placements : [],
    types: draft.types && typeof draft.types === "object" ? draft.types : {},
    savedAt: draft.savedAt || new Date().toISOString()
  };
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts.map(normalizeDraft) : [],
      settings: { ...defaultState.settings, ...parsed.settings }
    };
  } catch {
    return structuredClone(defaultState);
  }
}

// 另一个窗口保存过时，把对方的字模和草稿按 id 并进来，两边已保存的结果都保留
function mergeSharedState(other) {
  if (!other || typeof other !== "object") return false;
  const incomingDrafts = (Array.isArray(other.drafts) ? other.drafts : []).map(normalizeDraft);
  const knownDraftIds = new Set(state.drafts.map((draft) => draft.id));
  const freshDrafts = incomingDrafts.filter((draft) => !knownDraftIds.has(draft.id));
  const knownTypeIds = new Set(state.inventory.map((item) => item.id));
  const freshTypes = (Array.isArray(other.inventory) ? other.inventory : []).filter(
    (item) => item && item.id && !knownTypeIds.has(item.id)
  );
  if (!freshDrafts.length && !freshTypes.length) return false;
  state.inventory = [...state.inventory, ...freshTypes];
  state.drafts = [...state.drafts, ...freshDrafts].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  const otherDraftIds = new Set(incomingDrafts.map((draft) => draft.id));
  const diverged = freshDrafts.length > 0 && state.drafts.some((draft) => !otherDraftIds.has(draft.id));
  if (diverged) state.conflict = { detectedAt: new Date().toISOString() };
  return true;
}

function saveState() {
  const raw = localStorage.getItem(storageKey);
  if (raw && raw !== lastSavedJson) {
    try {
      mergeSharedState(JSON.parse(raw));
    } catch {
      // 存档损坏时以本窗口为准
    }
  }
  const json = JSON.stringify(state);
  if (json === raw) {
    lastSavedJson = json;
    return;
  }
  localStorage.setItem(storageKey, json);
  lastSavedJson = json;
}

function getGrid() {
  const size = state.settings.paperSize;
  if (size === "bookmark") return { cols: 7, rows: 18 };
  if (size === "square") return { cols: 12, rows: 12 };
  return { cols: 16, rows: 10 };
}

function placementKey(row, col) {
  return `${row}:${col}`;
}

function getSelectedType() {
  return state.inventory.find((item) => item.id === state.selectedTypeId) || null;
}

function getUsage(placements = state.placements) {
  return placements.reduce((acc, placement) => {
    acc[placement.typeId] = (acc[placement.typeId] || 0) + 1;
    return acc;
  }, {});
}

function getShortages(placements = state.placements) {
  const usage = getUsage(placements);
  return state.inventory
    .map((item) => ({ item, used: usage[item.id] || 0 }))
    .filter((entry) => entry.used > entry.item.quantity)
    .map((entry) => ({ ...entry, missing: entry.used - entry.item.quantity }));
}

// 按阅读顺序把字模逐枚分给落字，分不到的格子就是缺口
function getBoardAllocation() {
  const vertical = state.settings.flowMode === "vertical";
  const ordered = [...state.placements].sort((a, b) =>
    vertical ? b.col - a.col || a.row - b.row : a.row - b.row || a.col - b.col
  );
  const remaining = new Map(state.inventory.map((item) => [item.id, item.quantity]));
  const shortKeys = new Set();
  ordered.forEach((placement) => {
    const left = remaining.get(placement.typeId) ?? 0;
    if (left > 0) remaining.set(placement.typeId, left - 1);
    else shortKeys.add(placementKey(placement.row, placement.col));
  });
  return shortKeys;
}

function getTypeName(typeId, draft) {
  const item = state.inventory.find((entry) => entry.id === typeId);
  if (item) return `${item.char}·${item.style}`;
  const snapshot = draft && draft.types ? draft.types[typeId] : null;
  return snapshot ? `${snapshot.char}·${snapshot.style}` : "未知字模";
}

function getDraftGaps(draft) {
  const usage = getUsage(draft.placements);
  return Object.entries(usage)
    .map(([typeId, needed]) => {
      const item = state.inventory.find((entry) => entry.id === typeId);
      const available = item ? item.quantity : 0;
      return { name: getTypeName(typeId, draft), needed, available, missing: needed - available };
    })
    .filter((entry) => entry.missing > 0);
}

function renderSettings() {
  els.paperSize.value = state.settings.paperSize;
  els.flowMode.value = state.settings.flowMode;
  els.gridGap.value = state.settings.gridGap;
  els.workTitle.value = state.settings.workTitle;
}

function renderStyleFilter() {
  const current = els.styleFilter.value || "all";
  const styles = [...new Set(state.inventory.map((item) => item.style))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.styleFilter.innerHTML = `<option value="all">全部风格</option>${styles
    .map((style) => `<option value="${escapeHtml(style)}">${escapeHtml(style)}</option>`)
    .join("")}`;
  els.styleFilter.value = styles.includes(current) ? current : "all";
}

function renderInventory() {
  const keyword = els.inventorySearch.value.trim();
  const style = els.styleFilter.value;
  const usage = getUsage();
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length}枚字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = usage[item.id] || 0;
      const remaining = item.quantity - used;
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      const shortage = remaining < 0 ? "shortage" : "";
      const qtyLabel = remaining >= 0 ? `可用${remaining}/${item.quantity}枚` : `超用${-remaining}枚（共${item.quantity}枚）`;
      return `
        <article class="type-card ${selected} ${shortage}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 已用${used}枚</span>
            <div class="qty-row">
              <button class="mini-btn" type="button" data-qty-dec="${item.id}" aria-label="减少可用枚数">−</button>
              <span class="qty-label ${remaining < 0 ? "warn-text" : ""}">${qtyLabel}</span>
              <button class="mini-btn" type="button" data-qty-inc="${item.id}" aria-label="增加可用枚数">＋</button>
            </div>
          </div>
          <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
        </article>
      `;
    })
    .join("");
}

function renderStage() {
  const { cols, rows } = getGrid();
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  const shortKeys = getBoardAllocation();
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key = placementKey(row, col);
      const placement = map.get(key);
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const short = placement && shortKeys.has(key);
      cells.push(`
        <button class="cell ${placement ? "used" : ""} ${short ? "short" : ""} ${vertical}" data-row="${row}" data-col="${col}" type="button" ${short ? 'title="字模不足，此格为缺口"' : ""} aria-label="第${row + 1}行第${col + 1}列">
          ${type ? escapeHtml(type.char) : ""}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  const usage = getUsage();
  const entries = state.inventory.filter((item) => usage[item.id]);
  els.placedCount.textContent = `${state.placements.length}个落字`;

  const shortages = getShortages();
  const totalMissing = shortages.reduce((sum, entry) => sum + entry.missing, 0);
  els.shortageBadge.textContent = shortages.length ? `还差${totalMissing}枚` : "数量充足";
  els.shortageBadge.className = `badge ${shortages.length ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  if (selectedType) {
    const remaining = selectedType.quantity - (usage[selectedType.id] || 0);
    els.selectedTypeLabel.textContent = `当前：${selectedType.char} · ${selectedType.style}（可用${remaining}枚）`;
  } else {
    els.selectedTypeLabel.textContent = "未选择字模";
  }

  els.usageList.innerHTML =
    entries
      .map((item) => {
        const used = usage[item.id];
        const missing = used - item.quantity;
        const warn = missing > 0 ? "warn" : "";
        return `
          <div class="usage-item ${warn}">
            <strong>${escapeHtml(item.char)} ${escapeHtml(item.style)}</strong>
            <span>${used}/${item.quantity}${missing > 0 ? ` · 还差${missing}枚` : ""}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.conflictBox.innerHTML = state.conflict
    ? `
      <div class="conflict-banner">
        <strong>检测到并行保存的冲突</strong>
        <span>两边已保存的草稿都保留在下方列表里，核对后删除多余草稿，再点「已处理」。</span>
        <button type="button" data-dismiss-conflict>已处理</button>
      </div>
    `
    : "";

  els.draftList.innerHTML =
    state.drafts
      .map((draft) => {
        const usage = getUsage(draft.placements);
        const occupation = Object.entries(usage)
          .map(([typeId, count]) => `${getTypeName(typeId, draft)}×${count}`)
          .join("、");
        const gaps = getDraftGaps(draft);
        const gapText = gaps
          .map((gap) => `${gap.name}还差${gap.missing}枚（需${gap.needed}枚/库${gap.available}枚）`)
          .join("；");
        return `
          <article class="draft-item ${gaps.length ? "has-gap" : ""}">
            <strong>${escapeHtml(draft.title)}</strong>
            <span>${draft.placements.length}个落字 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}</span>
            <span class="draft-usage">占用：${escapeHtml(occupation || "无")}</span>
            ${gaps.length ? `<span class="draft-gap">缺口：${escapeHtml(gapText)}</span>` : ""}
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

function refreshViews() {
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
}

function renderAll() {
  saveState();
  refreshViews();
}

function showNotice(message, kind = "ok") {
  els.noticeBar.textContent = message;
  els.noticeBar.className = `notice ${kind}`;
  els.noticeBar.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    els.noticeBar.hidden = true;
  }, 6000);
}

// 落字、换字、清空都走这里，按字模库的可用枚数核对，不够就写明还差几枚
function tryCommitPlacements(nextPlacements, actionLabel) {
  const shortage = getShortages(nextPlacements)[0];
  if (shortage) {
    showNotice(
      `${actionLabel}被拦下：「${shortage.item.char}·${shortage.item.style}」需要${shortage.used}枚，字模库只有${shortage.item.quantity}枚，还差${shortage.missing}枚。`,
      "warn"
    );
    return false;
  }
  state.placements = nextPlacements;
  renderAll();
  return true;
}

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) {
    showNotice("请先在字模库选中一枚字模再落字。", "warn");
    return;
  }
  const type = state.inventory.find((item) => item.id === typeId);
  if (!type) {
    showNotice("这枚字模已不在字模库，请重新选择。", "warn");
    return;
  }
  const existingIndex = state.placements.findIndex((item) => item.row === row && item.col === col);
  if (existingIndex >= 0 && state.placements[existingIndex].typeId === typeId) {
    const next = state.placements.filter((_, index) => index !== existingIndex);
    if (tryCommitPlacements(next, "收回字模")) showNotice(`已收回1枚「${type.char}」。`, "ok");
    return;
  }
  const next = [...state.placements];
  const actionLabel = existingIndex >= 0 ? "换字" : "落字";
  if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], typeId };
  else next.push({ row, col, typeId });
  tryCommitPlacements(next, actionLabel);
}

function addType(event) {
  event.preventDefault();
  const item = {
    id: crypto.randomUUID(),
    char: els.charInput.value.trim(),
    style: els.styleInput.value.trim(),
    size: Number(els.sizeInput.value),
    quantity: Number(els.quantityInput.value),
    wear: els.wearInput.value
  };
  if (!item.char || !item.style) return;
  state.inventory.unshift(item);
  state.selectedTypeId = item.id;
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  renderAll();
  showNotice(`「${item.char}·${item.style}」已入字模库，可用${item.quantity}枚。`, "ok");
}

function saveDraft() {
  const title = state.settings.workTitle.trim() || "未命名作品";
  const types = {};
  Object.keys(getUsage()).forEach((typeId) => {
    const item = state.inventory.find((entry) => entry.id === typeId);
    if (item) types[typeId] = { char: item.char, style: item.style };
  });
  state.drafts.unshift({
    id: crypto.randomUUID(),
    title,
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    types,
    savedAt: new Date().toISOString()
  });
  // 冲突没处理前不裁剪，两边已保存的草稿都留着
  if (!state.conflict) state.drafts = state.drafts.slice(0, 8);
  renderAll();
  showNotice(`草稿「${title}」已保存。`, "ok");
}

function exportPreview() {
  const { cols, rows } = getGrid();
  const cell = state.settings.paperSize === "bookmark" ? 44 : 56;
  const gap = state.settings.gridGap;
  const margin = 48;
  const width = cols * cell + (cols - 1) * gap + margin * 2;
  const height = rows * cell + (rows - 1) * gap + margin * 2 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf1";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#2f2921";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = "#22201c";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(state.settings.workTitle || "未命名作品", margin, 50);
  const shortKeys = getBoardAllocation();
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    const x = margin + placement.col * (cell + gap);
    const y = margin + 45 + placement.row * (cell + gap);
    if (!type || shortKeys.has(placementKey(placement.row, placement.col))) {
      ctx.save();
      ctx.strokeStyle = "#a64037";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(x, y, cell, cell);
      ctx.setLineDash([]);
      ctx.fillStyle = "#a64037";
      ctx.font = `700 ${Math.floor(cell / 3)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("缺", x + cell / 2, y + cell / 2);
      ctx.restore();
      return;
    }
    ctx.fillStyle = "#2f2921";
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = "#fff5df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.min(type.size + 8, 42)}px serif`;
    ctx.fillText(type.char, x + cell / 2, y + cell / 2);
  });
  const shortages = getShortages();
  if (shortages.length) {
    ctx.fillStyle = "#a64037";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const text = shortages.map((entry) => `「${entry.item.char}」还差${entry.missing}枚`).join("，");
    ctx.fillText(`缺口：${text}`, margin, height - 32);
  }
  const link = document.createElement("a");
  link.download = `${state.settings.workTitle || "movable-type"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  if (shortages.length) showNotice("预览图已按重算后的版面绘制，缺口位置以红色虚线标出。", "warn");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.paperSize.addEventListener("change", () => {
  state.settings.paperSize = els.paperSize.value;
  const { cols, rows } = getGrid();
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  renderAll();
});

els.flowMode.addEventListener("change", () => {
  state.settings.flowMode = els.flowMode.value;
  renderAll();
});

els.gridGap.addEventListener("input", () => {
  state.settings.gridGap = Number(els.gridGap.value);
  renderAll();
});

els.workTitle.addEventListener("input", () => {
  state.settings.workTitle = els.workTitle.value;
  saveState();
});

els.typeForm.addEventListener("submit", addType);
els.inventorySearch.addEventListener("input", renderInventory);
els.styleFilter.addEventListener("change", renderInventory);
els.saveDraftBtn.addEventListener("click", saveDraft);
els.exportBtn.addEventListener("click", exportPreview);
els.clearBoardBtn.addEventListener("click", () => {
  const count = state.placements.length;
  if (!count) {
    showNotice("版面已经是空的。", "ok");
    return;
  }
  if (tryCommitPlacements([], "清空版面")) showNotice(`已清空版面，${count}枚字模全部收回字模库。`, "ok");
});

els.typeList.addEventListener("click", (event) => {
  const qtyButton = event.target.closest("[data-qty-dec], [data-qty-inc]");
  if (qtyButton) {
    const typeId = qtyButton.dataset.qtyDec || qtyButton.dataset.qtyInc;
    const item = state.inventory.find((entry) => entry.id === typeId);
    if (!item) return;
    const delta = qtyButton.dataset.qtyInc ? 1 : -1;
    item.quantity = Math.min(99, Math.max(0, item.quantity + delta));
    renderAll();
    const shortage = getShortages().find((entry) => entry.item.id === typeId);
    if (shortage) {
      showNotice(
        `字模库已更新：「${item.char}·${item.style}」版面需要${shortage.used}枚，还差${shortage.missing}枚，缺口已在版面与草稿中标出。`,
        "warn"
      );
    }
    return;
  }
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    const typeId = deleteButton.dataset.deleteType;
    const type = state.inventory.find((item) => item.id === typeId);
    const removed = state.placements.filter((item) => item.typeId === typeId).length;
    state.inventory = state.inventory.filter((item) => item.id !== typeId);
    state.placements = state.placements.filter((item) => item.typeId !== typeId);
    if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
    renderAll();
    showNotice(
      removed
        ? `已删除「${type ? type.char : "字模"}」，版面收回${removed}枚；引用它的草稿已标出缺口。`
        : `已删除「${type ? type.char : "字模"}」。`,
      "ok"
    );
    return;
  }
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  state.selectedTypeId = card.dataset.typeId;
  renderAll();
});

els.typeList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.typeId);
});

els.stage.addEventListener("dragover", (event) => {
  if (event.target.closest(".cell")) event.preventDefault();
});

els.stage.addEventListener("drop", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  event.preventDefault();
  placeType(Number(cell.dataset.row), Number(cell.dataset.col), event.dataTransfer.getData("text/plain"));
});

els.stage.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  placeType(Number(cell.dataset.row), Number(cell.dataset.col));
});

els.draftList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (loadButton) {
    const draft = state.drafts.find((item) => item.id === loadButton.dataset.loadDraft);
    if (!draft) return;
    state.settings = structuredClone(draft.settings);
    state.placements = structuredClone(draft.placements);
    renderAll();
    const gaps = getDraftGaps(draft);
    if (gaps.length) {
      showNotice(
        `草稿已载入，但字模不足：${gaps.map((gap) => `${gap.name}还差${gap.missing}枚`).join("；")}，缺口已在版面标出。`,
        "warn"
      );
    }
  }
  if (deleteButton) {
    state.drafts = state.drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
    renderAll();
  }
});

els.conflictBox.addEventListener("click", (event) => {
  if (!event.target.closest("[data-dismiss-conflict]")) return;
  state.conflict = null;
  state.drafts = state.drafts.slice(0, 8);
  renderAll();
  showNotice("冲突已处理，草稿恢复按最近8份保留。", "ok");
});

window.addEventListener("storage", (event) => {
  if (event.key !== storageKey || !event.newValue || event.newValue === lastSavedJson) return;
  let merged = false;
  try {
    merged = mergeSharedState(JSON.parse(event.newValue));
  } catch {
    return;
  }
  if (!merged) return;
  // 只刷新界面不落盘，避免两个窗口互相触发保存
  refreshViews();
  showNotice(
    state.conflict
      ? "检测到并行保存的冲突：两边已保存的草稿都保留在列表里，处理完再点「已处理」。"
      : "另一窗口更新了字模库或草稿，已合并到本窗口。",
    state.conflict ? "warn" : "ok"
  );
});

renderAll();
