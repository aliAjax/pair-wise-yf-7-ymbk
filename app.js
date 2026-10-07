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
  boardBase: null,
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

let state = loadState();

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
  draftList: document.querySelector("#draftList"),
  placedCount: document.querySelector("#placedCount"),
  inventoryCount: document.querySelector("#inventoryCount"),
  saveDraftBtn: document.querySelector("#saveDraftBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  clearBoardBtn: document.querySelector("#clearBoardBtn"),
  notice: document.querySelector("#notice")
};

let noticeTimer = null;
let editingQtyId = null;

/* ---------- 存档 ---------- */

function hashPlacements(placements) {
  return placements.map((p) => `${p.row}:${p.col}:${p.typeId}`).sort().join("|");
}

function migrateState(parsed) {
  const merged = {
    ...structuredClone(defaultState),
    ...parsed,
    settings: { ...defaultState.settings, ...(parsed.settings || {}) }
  };
  merged.boardBase = parsed.boardBase || null;
  merged.drafts = (parsed.drafts || []).map((d) => ({
    id: d.id || crypto.randomUUID(),
    title: d.title || "未命名作品",
    settings: d.settings ? { ...defaultState.settings, ...d.settings } : { ...defaultState.settings },
    placements: Array.isArray(d.placements) ? d.placements : [],
    savedAt: d.savedAt || new Date(0).toISOString(),
    version: d.version || 1,
    parentId: d.parentId || null,
    hash: d.hash || hashPlacements(d.placements || []),
    conflict: !!d.conflict,
    gapCount: d.gapCount || 0,
    shortages: d.shortages || []
  }));
  return merged;
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    return migrateState(JSON.parse(saved));
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

/* ---------- 口径：可用枚数只从字模库出 ---------- */

function countUsage(placements, typeId) {
  return placements.reduce((acc, p) => acc + (p.typeId === typeId ? 1 : 0), 0);
}

function countUsageAll(placements) {
  return placements.reduce((acc, p) => {
    acc[p.typeId] = (acc[p.typeId] || 0) + 1;
    return acc;
  }, {});
}

function getAvailable(typeId, placements = state.placements) {
  const item = state.inventory.find((i) => i.id === typeId);
  if (!item) return 0;
  return item.quantity - countUsage(placements, typeId);
}

/* 重算某份版面：标出每种字模超出库存的落字（缺口格） */
function computeGaps(placements) {
  const usage = countUsageAll(placements);
  const gapKeys = new Set();
  const shortages = [];
  state.inventory.forEach((item) => {
    const used = usage[item.id] || 0;
    if (used > item.quantity) {
      shortages.push({ typeId: item.id, char: item.char, need: used - item.quantity });
      const indices = [];
      placements.forEach((p, idx) => {
        if (p.typeId === item.id) indices.push(idx);
      });
      indices.slice(item.quantity).forEach((idx) => {
        gapKeys.add(placementKey(placements[idx].row, placements[idx].col));
      });
    }
  });
  placements.forEach((p) => {
    if (!state.inventory.some((i) => i.id === p.typeId)) {
      gapKeys.add(placementKey(p.row, p.col));
    }
  });
  return { gapCount: gapKeys.size, shortages, gapKeys };
}

/* 字模库更新后，重算每份草稿的占用与缺口 */
function recalcAllDrafts() {
  state.drafts.forEach((d) => {
    const { gapCount, shortages } = computeGaps(d.placements);
    d.gapCount = gapCount;
    d.shortages = shortages;
  });
}

/* 冲突检测：同一父草稿分出的两个不同版本，即冲突；两版都保留 */
function recomputeConflicts() {
  const groups = {};
  state.drafts.forEach((d) => {
    if (!d.parentId) return;
    (groups[d.parentId] = groups[d.parentId] || []).push(d);
  });
  Object.values(groups).forEach((group) => {
    const hashes = new Set(group.map((d) => d.hash));
    const conflicted = group.length > 1 && hashes.size > 1;
    group.forEach((d) => {
      d.conflict = conflicted;
    });
  });
}

function nextVersion(parentId) {
  const siblings = state.drafts.filter((d) => d.parentId === parentId);
  if (!siblings.length) return 1;
  return Math.max(...siblings.map((d) => d.version || 0)) + 1;
}

/* ---------- 提示条 ---------- */

function showNotice(text, kind = "ok") {
  els.notice.textContent = text;
  els.notice.className = `notice show ${kind}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    els.notice.className = "notice";
  }, 3200);
}

/* ---------- 网格 ---------- */

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

/* ---------- 渲染 ---------- */

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
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length} 种字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = countUsage(state.placements, item.id);
      const available = item.quantity - used;
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      if (editingQtyId === item.id) {
        return `
          <article class="type-card ${selected}" data-type-id="${item.id}">
            <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
            <div class="type-meta">
              <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
              <div class="qty-editor">
                <label>总量
                  <input type="number" min="0" max="99" value="${item.quantity}" data-qty-input />
                </label>
                <button type="button" data-save-qty="${item.id}">保存</button>
                <button type="button" data-cancel-qty>取消</button>
              </div>
            </div>
          </article>
        `;
      }
      return `
        <article class="type-card ${selected}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 已用 ${used} · <em class="${available <= 0 ? "qty-out" : ""}">可用 ${available}</em> / 总量 ${item.quantity}</span>
          </div>
          <div class="type-card-actions">
            <button class="mini-btn" title="修改总量" data-edit-qty="${item.id}" type="button">量</button>
            <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderStage() {
  const { cols, rows } = getGrid();
  const { gapKeys } = computeGaps(state.placements);
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const placement = map.get(placementKey(row, col));
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const isGap = placement && gapKeys.has(placementKey(row, col));
      const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
      let content = "";
      if (isGap) {
        content = `<span class="gap-tag">缺</span>`;
      } else if (type) {
        content = escapeHtml(type.char);
      }
      cells.push(`
        <button class="cell ${type ? "used" : ""} ${isGap ? "gap" : ""} ${vertical}" data-row="${row}" data-col="${col}" type="button" aria-label="第${row + 1}行第${col + 1}列" title="${isGap && type ? `缺字：${type.char}` : ""}">
          ${content}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  const usage = countUsageAll(state.placements);
  const { gapCount, shortages } = computeGaps(state.placements);
  const entries = state.inventory.filter((item) => usage[item.id]);
  els.placedCount.textContent = `${state.placements.length} 个落字`;

  els.shortageBadge.textContent = gapCount ? `当前版面 ${gapCount} 处缺口` : "数量充足";
  els.shortageBadge.className = `badge ${gapCount ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType ? `当前：${selectedType.char} · ${selectedType.style}` : "未选择字模";

  els.usageList.innerHTML =
    entries
      .map((item) => {
        const used = usage[item.id];
        const available = item.quantity - used;
        const warn = used > item.quantity ? "warn" : "";
        return `
          <div class="usage-item ${warn}">
            <strong>${escapeHtml(item.char)} ${escapeHtml(item.style)}</strong>
            <span>已用 ${used} · 可用 ${available} / 总量 ${item.quantity}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.draftList.innerHTML =
    state.drafts
      .map((draft) => {
        const conflictBadge = draft.conflict ? `<span class="badge warn">冲突 · 两版均保留</span>` : "";
        const gapBadge = draft.gapCount
          ? `<span class="badge warn">缺口 ${draft.gapCount}</span>`
          : `<span class="badge ok">可用</span>`;
        const shortages = draft.shortages.map((s) => `还差 ${s.char} ×${s.need}`).join("，");
        return `
          <article class="draft-item ${draft.conflict ? "conflict" : ""}">
            <div class="draft-head">
              <strong>${escapeHtml(draft.title)}</strong>
              <span class="draft-badges">${conflictBadge}${gapBadge}</span>
            </div>
            <span>${draft.placements.length} 个落字 · v${draft.version} · ${new Date(draft.savedAt).toLocaleString("zh-CN")}</span>
            ${draft.gapCount ? `<span class="draft-shortages">${shortages}</span>` : ""}
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              ${draft.conflict ? `<button type="button" data-resolve-draft="${draft.id}">解决冲突</button>` : ""}
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

function renderAll() {
  recomputeConflicts();
  recalcAllDrafts();
  saveState();
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
}

/* ---------- 落字 / 换字 / 清空 ---------- */

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) return;
  const item = state.inventory.find((i) => i.id === typeId);
  if (!item) return;

  const existingIndex = state.placements.findIndex((p) => p.row === row && p.col === col);
  const existing = existingIndex >= 0 ? state.placements[existingIndex] : null;
  const usedOfType = countUsage(state.placements, typeId);

  if (existing) {
    if (existing.typeId === typeId) {
      // 同一格同字：取下，归还 1 枚
      state.placements.splice(existingIndex, 1);
      showNotice(`已取下「${item.char}」，归还 1 枚`, "ok");
    } else {
      // 换字：旧字归还，新字要再占 1 枚
      const need = usedOfType + 1 - item.quantity;
      if (need > 0) {
        showNotice(`「${item.char}」可用不足，还差 ${need} 枚`, "err");
        return;
      }
      state.placements[existingIndex].typeId = typeId;
      showNotice(`已换字为「${item.char}」`, "ok");
    }
  } else {
    // 落字：新占 1 枚
    const need = usedOfType + 1 - item.quantity;
    if (need > 0) {
      showNotice(`「${item.char}」可用不足，还差 ${need} 枚`, "err");
      return;
    }
    state.placements.push({ row, col, typeId });
    showNotice(`已落字「${item.char}」`, "ok");
  }
  renderAll();
}

function clearBoard() {
  const returned = state.placements.length;
  state.placements = [];
  showNotice(`已清空版面，归还 ${returned} 枚字模`, "ok");
  renderAll();
}

/* ---------- 字模库变动 ---------- */

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
  if (!item.char || !item.style) {
    showNotice("请填写字与风格", "err");
    return;
  }
  state.inventory.unshift(item);
  state.selectedTypeId = item.id;
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  showNotice(`已加入「${item.char} ${item.style}」，总量 ${item.quantity} 枚`, "ok");
  afterInventoryChange();
}

function deleteType(typeId) {
  const item = state.inventory.find((i) => i.id === typeId);
  state.inventory = state.inventory.filter((i) => i.id !== typeId);
  state.placements = state.placements.filter((p) => p.typeId !== typeId);
  if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
  showNotice(`已删除「${item ? item.char : ""}」，相关落字已移除`, "ok");
  afterInventoryChange();
}

function afterInventoryChange() {
  editingQtyId = null;
  renderAll();
}

/* ---------- 草稿 ---------- */

function saveDraft() {
  const title = state.settings.workTitle.trim() || "未命名作品";
  const parentId = state.boardBase?.draftId || null;
  const version = nextVersion(parentId);
  const draft = {
    id: crypto.randomUUID(),
    title,
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    savedAt: new Date().toISOString(),
    version,
    parentId,
    hash: hashPlacements(state.placements),
    conflict: false,
    gapCount: 0,
    shortages: []
  };
  state.drafts.unshift(draft);
  state.drafts = state.drafts.slice(0, 8);
  state.boardBase = { draftId: draft.id, version, hash: draft.hash };
  recomputeConflicts();
  const conflicted = state.drafts.some((d) => d.conflict);
  showNotice(
    conflicted
      ? `已保存草稿 v${version}，检测到分支冲突，两版均保留`
      : `已保存草稿 v${version}${parentId ? "（基于上一版）" : ""}`,
    "ok"
  );
  renderAll();
}

function loadDraft(draftId) {
  const draft = state.drafts.find((d) => d.id === draftId);
  if (!draft) return;
  state.settings = structuredClone(draft.settings);
  state.placements = structuredClone(draft.placements);
  state.boardBase = { draftId: draft.id, version: draft.version, hash: draft.hash };
  showNotice(`已载入草稿 v${draft.version}`, "ok");
  renderAll();
}

function deleteDraft(draftId) {
  state.drafts = state.drafts.filter((d) => d.id !== draftId);
  if (state.boardBase?.draftId === draftId) state.boardBase = null;
  renderAll();
}

function resolveConflict(draftId) {
  const draft = state.drafts.find((d) => d.id === draftId);
  if (!draft) return;
  state.drafts.forEach((d) => {
    if (d.parentId === draft.parentId) d.conflict = false;
  });
  showNotice("已标记冲突解决，两版草稿均保留", "ok");
  renderAll();
}

/* ---------- 导出预览（按重算后的版面画，缺口留空） ---------- */

function exportPreview() {
  const { cols, rows } = getGrid();
  const { gapKeys } = computeGaps(state.placements);
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
  ctx.fillText(state.settings.workTitle || "未命名作品", margin, 50);
  ctx.font = "bold 30px serif";
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    const x = margin + placement.col * (cell + gap);
    const y = margin + 45 + placement.row * (cell + gap);
    if (gapKeys.has(placementKey(placement.row, placement.col))) {
      ctx.save();
      ctx.strokeStyle = "#a64037";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = "#a64037";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("缺", x + cell / 2, y + cell / 2);
      ctx.restore();
    } else if (type) {
      ctx.fillStyle = "#2f2921";
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = "#fff5df";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${Math.min(type.size + 8, 42)}px serif`;
      ctx.fillText(type.char, x + cell / 2, y + cell / 2);
    }
  });
  const link = document.createElement("a");
  link.download = `${state.settings.workTitle || "movable-type"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/* ---------- 其他 ---------- */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- 事件 ---------- */

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
els.clearBoardBtn.addEventListener("click", clearBoard);

els.typeList.addEventListener("click", (event) => {
  const saveQtyBtn = event.target.closest("[data-save-qty]");
  if (saveQtyBtn) {
    const card = saveQtyBtn.closest(".type-card");
    const input = card.querySelector("[data-qty-input]");
    const item = state.inventory.find((i) => i.id === saveQtyBtn.dataset.saveQty);
    const next = Math.max(0, Math.min(99, Number(input.value) || 0));
    if (item) item.quantity = next;
    showNotice(`已调整「${item ? item.char : ""}」总量为 ${next} 枚`, "ok");
    afterInventoryChange();
    return;
  }
  const cancelQtyBtn = event.target.closest("[data-cancel-qty]");
  if (cancelQtyBtn) {
    editingQtyId = null;
    renderAll();
    return;
  }
  const editQtyBtn = event.target.closest("[data-edit-qty]");
  if (editQtyBtn) {
    editingQtyId = editQtyBtn.dataset.editQty;
    renderInventory();
    return;
  }
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    deleteType(deleteButton.dataset.deleteType);
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
  const resolveButton = event.target.closest("[data-resolve-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (loadButton) {
    loadDraft(loadButton.dataset.loadDraft);
    return;
  }
  if (resolveButton) {
    resolveConflict(resolveButton.dataset.resolveDraft);
    return;
  }
  if (deleteButton) {
    deleteDraft(deleteButton.dataset.deleteDraft);
    return;
  }
});

/* 跨标签页：另一页保存后，合并草稿并重算冲突，两版都保留 */
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey || !event.newValue) return;
  try {
    const incoming = JSON.parse(event.newValue);
    if (!Array.isArray(incoming.drafts)) return;
    const byId = new Map();
    incoming.drafts.forEach((d) => byId.set(d.id, d));
    state.drafts.forEach((d) => {
      if (!byId.has(d.id)) byId.set(d.id, d);
    });
    state.drafts = [...byId.values()];
    renderAll();
  } catch {
    /* 忽略损坏的存档 */
  }
});

renderAll();
