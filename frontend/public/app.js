"use strict";

const elements = {
  loginPanel: document.querySelector("#login-panel"),
  dashboardPanel: document.querySelector("#dashboard-panel"),
  tracePanel: document.querySelector("#public-trace-panel"),
  loginForm: document.querySelector("#login-form"),
  loginError: document.querySelector("#login-error"),
  userLabel: document.querySelector("#user-label"),
  logoutButton: document.querySelector("#logout-button"),
  connectionDot: document.querySelector("#connection-dot"),
  connectionLabel: document.querySelector("#connection-label"),
  viewContainer: document.querySelector("#view-container"),
  notice: document.querySelector("#notice"),
  publicTraceForm: document.querySelector("#public-trace-form"),
  publicTraceResult: document.querySelector("#public-trace-result")
};

const operationDefinitions = [
  {
    name: "harvest",
    roles: ["harvest_operator"],
    title: "Tạo lô khai thác",
    description: "Ghi nhận lô nguyên liệu mới trực tiếp lên Fabric.",
    fields: [
      { name: "batchId", label: "Mã lô", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "species", label: "Loài yến", required: true },
      { name: "harvestLocation", label: "Địa điểm khai thác", required: true },
      { name: "harvestedAt", label: "Thời gian khai thác", type: "datetime-local", required: true },
      { name: "quantity", label: "Số lượng", type: "number", min: "0.001", step: "any", required: true },
      { name: "unit", label: "Đơn vị", type: "select", options: ["g", "kg", "piece"], required: true }
    ]
  },
  {
    name: "handover",
    roles: ["harvest_operator"],
    title: "Bàn giao lô hàng",
    description: "Chuyển quyền sở hữu lô hàng cho tổ chức chế biến.",
    fields: [
      { name: "batchId", label: "Mã lô", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true }
    ]
  },
  {
    name: "accept-transfer",
    roles: ["processing_operator"],
    title: "Tiếp nhận bàn giao",
    description: "Xác nhận tiếp nhận lô hàng từ tổ chức khai thác.",
    fields: [
      { name: "transferId", label: "Mã lô bàn giao", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true }
    ]
  },
  {
    name: "processing",
    roles: ["processing_operator"],
    title: "Ghi nhận chế biến",
    description: "Ghi nhận quy trình chế biến và lượng nguyên liệu sử dụng.",
    fields: [
      { name: "batchId", label: "Mã lô nguyên liệu", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "recordId", label: "Mã bản ghi", required: true },
      { name: "outputBatchId", label: "Mã lô thành phẩm", required: true },
      { name: "quantityUsed", label: "Lượng sử dụng", type: "number", min: "0.001", step: "any", required: true },
      { name: "unit", label: "Đơn vị", type: "select", options: ["g", "kg", "piece"], required: true },
      { name: "processType", label: "Loại quy trình", required: true },
      { name: "facilityId", label: "Mã cơ sở", required: true },
      { name: "notes", label: "Ghi chú", type: "textarea" }
    ]
  },
  {
    name: "derived",
    roles: ["processing_operator"],
    title: "Tạo lô thành phẩm",
    description: "Tạo lô dẫn xuất và liên kết với lô nguyên liệu cha.",
    fields: [
      { name: "parentBatchId", label: "Mã lô nguyên liệu", required: true },
      { name: "batchId", label: "Mã lô thành phẩm", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "quantityUsed", label: "Lượng nguyên liệu đã dùng", type: "number", min: "0.001", step: "any", required: true },
      { name: "quantity", label: "Số lượng thành phẩm", type: "number", min: "0.001", step: "any", required: true },
      { name: "unit", label: "Đơn vị", type: "select", options: ["g", "kg", "piece"], required: true }
    ]
  },
  {
    name: "quality",
    roles: ["quality_inspector"],
    title: "Kiểm tra chất lượng",
    description: "Ghi kết quả kiểm định chất lượng lên ledger.",
    fields: [
      { name: "batchId", label: "Mã lô", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "qualityId", label: "Mã lần kiểm tra", required: true },
      { name: "result", label: "Kết quả", type: "select", options: ["PASS", "FAIL"], required: true },
      { name: "standardCode", label: "Mã tiêu chuẩn", required: true },
      { name: "certificateHash", label: "SHA-256 chứng nhận" },
      { name: "documentRef", label: "Tham chiếu tài liệu" }
    ]
  },
  {
    name: "package",
    roles: ["processing_operator"],
    title: "Đóng gói sản phẩm",
    description: "Đóng gói lô và neo hash chứng nhận lên Fabric.",
    fields: [
      { name: "batchId", label: "Mã lô", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "certificateHash", label: "SHA-256 chứng nhận", required: true }
    ]
  },
  {
    name: "shipment",
    roles: ["processing_operator"],
    title: "Tạo chuyến hàng",
    description: "Bàn giao một hoặc nhiều lô cho tổ chức phân phối.",
    fields: [
      { name: "shipmentId", label: "Mã chuyến hàng", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "batchIds", label: "Mã lô (phân cách bằng dấu phẩy)", required: true }
    ]
  },
  {
    name: "accept-shipment",
    roles: ["distributor"],
    title: "Tiếp nhận chuyến hàng",
    description: "Xác nhận tổ chức phân phối đã tiếp nhận chuyến hàng.",
    fields: [
      { name: "shipmentId", label: "Mã chuyến hàng", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true }
    ]
  },
  {
    name: "distribution",
    roles: ["distributor"],
    title: "Ghi nhận phân phối",
    description: "Ghi nhận lô hàng đã được phân phối.",
    fields: [
      { name: "shipmentId", label: "Mã chuyến hàng", required: true },
      { name: "batchId", label: "Mã lô", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "distributionId", label: "Mã bản ghi phân phối", required: true },
      { name: "location", label: "Địa điểm phân phối", required: true }
    ]
  },
  {
    name: "private-terms",
    roles: ["harvest_operator", "processing_operator"],
    title: "Lưu điều khoản thương mại riêng tư",
    description: "Điều khoản chỉ gửi qua transient data và không xuất hiện trong giao dịch công khai.",
    fields: [
      { name: "batchId", label: "Mã lô", required: true },
      { name: "eventId", label: "Mã sự kiện", required: true },
      { name: "commercialPrice", label: "Giá thương mại", type: "number", min: "0.001", step: "any" },
      { name: "contractReference", label: "Mã hợp đồng" },
      { name: "supplierNotes", label: "Ghi chú riêng tư", type: "textarea" }
    ]
  }
];

const IDENTIFIER_FIELD_NAMES = new Set([
  "batchId",
  "distributionId",
  "eventId",
  "outputBatchId",
  "parentBatchId",
  "qualityId",
  "recordId",
  "shipmentId",
  "storageId",
  "transferId"
]);

let accessToken = null;
let currentUser = null;
let currentScreen = "login";
let previousScreen = "login";
let currentView = "overview";
let batches = [];
let noticeTimer;
let securityRefreshTimer;

function node(tagName, text, className) {
  const element = document.createElement(tagName);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function append(parent, ...children) {
  for (const child of children) {
    if (child) parent.append(child);
  }
  return parent;
}

function createEventId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function showNotice(message, isError = false) {
  window.clearTimeout(noticeTimer);
  elements.notice.textContent = message;
  elements.notice.classList.toggle("notice--error", isError);
  elements.notice.hidden = false;
  noticeTimer = window.setTimeout(() => {
    elements.notice.hidden = true;
  }, 4500);
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error && payload.error.message
      ? payload.error.message
      : `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = payload.error && payload.error.code;
    throw error;
  }
  return payload;
}

async function refreshConnectionStatus() {
  try {
    const response = await fetch("/ready");
    const payload = await response.json();
    const ready = response.ok && payload.status === "ready";
    elements.connectionDot.className = `status-dot ${ready ? "status-dot--ready" : "status-dot--error"}`;
    elements.connectionLabel.textContent = ready ? "Backend và Fabric sẵn sàng" : "Một dịch vụ chưa sẵn sàng";
  } catch {
    elements.connectionDot.className = "status-dot status-dot--error";
    elements.connectionLabel.textContent = "Không kết nối được backend";
  }
}

function setScreen(screen) {
  currentScreen = screen;
  elements.loginPanel.hidden = screen !== "login";
  elements.dashboardPanel.hidden = screen !== "dashboard";
  elements.tracePanel.hidden = screen !== "trace";
  if (screen === "dashboard") renderCurrentView();
}

function roleLabel(role) {
  const labels = {
    harvest_operator: "Tổ chức khai thác",
    processing_operator: "Tổ chức chế biến",
    quality_inspector: "Kiểm định chất lượng",
    distributor: "Tổ chức phân phối",
    auditor: "Kiểm toán",
    consumer: "Người tiêu dùng",
    security_admin: "Quản trị security lab",
    system_admin: "Quản trị hệ thống"
  };
  return labels[role] || role;
}

function setAuthenticatedSession(session) {
  accessToken = session.accessToken;
  currentUser = session.user;
  if (currentUser.role !== "security_admin" && currentView === "security") currentView = "overview";
  elements.userLabel.textContent = `${session.user.displayName} · ${roleLabel(session.user.role)}`;
  elements.userLabel.hidden = false;
  elements.logoutButton.hidden = false;
  document.querySelector('.tab[data-view="security"]').hidden = session.user.role !== "security_admin";
  setScreen("dashboard");
  refreshDashboardData();
}

async function signOut(revoke = true) {
  if (revoke && accessToken) {
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
    } catch {
      showNotice("Không thể xác nhận đăng xuất trên máy chủ. Phiên trên trình duyệt đã được xóa.", true);
    }
  }
  accessToken = null;
  currentUser = null;
  batches = [];
  elements.userLabel.hidden = true;
  elements.logoutButton.hidden = true;
  setScreen("login");
}

async function refreshDashboardData() {
  await Promise.all([refreshConnectionStatus(), loadBatches()]);
  renderCurrentView();
}

async function loadBatches() {
  if (currentScreen === "dashboard" && ["overview", "batches"].includes(currentView)) {
    elements.viewContainer.replaceChildren(node("p", "Đang tải dữ liệu lô từ Fabric…", "muted"));
  }
  try {
    const result = await api("/api/v1/batches");
    batches = Array.isArray(result.batches) ? result.batches : [];
  } catch (error) {
    batches = [];
    if (error.status !== 403) showNotice(error.message, true);
  }
}

function makeStat(label, value) {
  const card = node("article", undefined, "stat-card");
  append(card, node("span", label), node("strong", value));
  return card;
}

function makeBatchCard(batch, onClick) {
  const button = node("button", undefined, "batch-card");
  button.type = "button";
  button.addEventListener("click", onClick);
  const identity = node("span");
  append(identity, node("strong", batch.batchId), node("small", batch.species || batch.batchType || "Sản phẩm yến"));
  const status = node("span", batch.status || "UNKNOWN", "status-badge");
  const quantity = node("span", `${batch.quantity ?? "—"} ${batch.unit || ""}`, "batch-meta");
  const owner = node("span", batch.currentOwnerMsp || "—", "batch-meta");
  const open = node("span", "Chi tiết", "batch-meta");
  append(button, identity, status, quantity, owner, open);
  return button;
}

function makeEmptyState(title, message) {
  const empty = node("div", undefined, "empty-state");
  append(empty, node("strong", title), node("span", message));
  return empty;
}

async function loadRecentEvents(container, sourceBatches) {
  if (sourceBatches.length === 0) {
    container.replaceChildren(makeEmptyState("Chưa có sự kiện", "Sự kiện mới sẽ xuất hiện khi có lô hàng."));
    return;
  }
  try {
    const histories = await Promise.all(sourceBatches.map((batch) => (
      api(`/api/v1/batches/${encodeURIComponent(batch.batchId)}/history`)
    )));
    if (!container.isConnected) return;
    const events = histories.flatMap((result) => result.history || [])
      .sort((left, right) => (
        new Date(right.transactionTimestamp || 0).getTime()
        - new Date(left.transactionTimestamp || 0).getTime()
      ))
      .slice(0, 6);
    container.replaceChildren();
    if (events.length === 0) {
      container.append(makeEmptyState("Chưa có sự kiện", "Sự kiện mới sẽ xuất hiện khi có lô hàng."));
      return;
    }
    const timeline = node("ol", undefined, "timeline");
    for (const event of events) {
      const item = node("li");
      append(
        item,
        node("strong", `${event.eventType || "Sự kiện"} · ${event.batchId || "—"}`),
        node("small", `${event.transactionTimestamp || "Thời gian Fabric"} · ${event.actorMsp || "Tổ chức thành viên"}`)
      );
      timeline.append(item);
    }
    container.append(timeline);
  } catch (error) {
    if (!container.isConnected) return;
    container.replaceChildren(makeEmptyState("Không thể tải sự kiện gần đây", error.message));
  }
}

function renderOverview() {
  const container = node("section");
  const statuses = batches.reduce((counts, batch) => {
    counts[batch.status || "UNKNOWN"] = (counts[batch.status || "UNKNOWN"] || 0) + 1;
    return counts;
  }, {});
  const stats = node("div", undefined, "stat-grid");
  append(
    stats,
    makeStat("Tổng số lô", batches.length),
    makeStat("Đang chế biến", statuses.PROCESSING || 0),
    makeStat("Đã phân phối", statuses.DISTRIBUTED || 0),
    makeStat("Đã kiểm định", statuses.QUALITY_CHECKED || 0)
  );
  const heading = node("div", undefined, "section-heading");
  append(
    heading,
    node("div"),
    node("button", "Mở danh sách lô", "button button--secondary")
  );
  const latest = node("div", undefined, "batch-list");
  const recentEvents = node("div", undefined, "content-card");
  recentEvents.append(node("p", "Đang tải sự kiện gần đây từ Fabric…", "muted"));
  for (const batch of batches.slice(0, 5)) {
    latest.append(makeBatchCard(batch, () => showBatchDetails(batch.batchId)));
  }
  if (batches.length === 0) {
    latest.append(makeEmptyState("Chưa có lô hàng", "Tạo lô khai thác hoặc tra cứu một mã lô công khai."));
  }
  heading.children[0].append(node("h2", "Lô hàng gần đây"));
  heading.children[0].append(node("p", "Trạng thái được đọc trực tiếp từ Hyperledger Fabric."));
  heading.children[1].addEventListener("click", () => selectView("batches"));
  const eventsHeading = node("div", undefined, "section-heading");
  eventsHeading.append(node("div"));
  eventsHeading.children[0].append(node("h2", "Sự kiện gần đây"));
  eventsHeading.children[0].append(node("p", "Lịch sử truy vấn từ các lô gần nhất."));
  append(container, stats, heading, latest, eventsHeading, recentEvents);
  loadRecentEvents(recentEvents, batches.slice(0, 5));
  return container;
}

function renderBatches() {
  const container = node("section");
  const toolbar = node("div", undefined, "batch-toolbar");
  const search = node("label", undefined, "field field--grow");
  append(search, node("span", "Tìm theo mã, loài hoặc tổ chức"));
  const searchInput = node("input");
  searchInput.type = "search";
  searchInput.placeholder = "Nhập từ khóa";
  searchInput.setAttribute("aria-label", "Tìm kiếm lô hàng");
  search.append(searchInput);
  const statusLabel = node("label", undefined, "field");
  append(statusLabel, node("span", "Trạng thái"));
  const statusSelect = node("select");
  const allStatuses = node("option", "Tất cả");
  allStatuses.value = "";
  statusSelect.append(allStatuses);
  for (const status of [...new Set(batches.map((batch) => batch.status).filter(Boolean))].sort()) {
    const option = node("option", status);
    option.value = status;
    statusSelect.append(option);
  }
  statusLabel.append(statusSelect);
  append(toolbar, search, statusLabel);
  const list = node("div", undefined, "batch-list");

  function applyFilters() {
    list.replaceChildren();
    const query = searchInput.value.trim().toLowerCase();
    const status = statusSelect.value;
    const filtered = batches.filter((batch) => {
      const searchable = [
        batch.batchId,
        batch.species,
        batch.batchType,
        batch.status,
        batch.currentOwnerMsp
      ].join(" ").toLowerCase();
      return searchable.includes(query) && (!status || batch.status === status);
    });
    if (filtered.length === 0) {
      list.append(makeEmptyState("Không tìm thấy lô phù hợp", "Thử từ khóa hoặc trạng thái khác."));
      return;
    }
    for (const batch of filtered) {
      list.append(makeBatchCard(batch, () => showBatchDetails(batch.batchId)));
    }
  }

  searchInput.addEventListener("input", applyFilters);
  statusSelect.addEventListener("change", applyFilters);
  applyFilters();
  append(container, toolbar, list);
  return container;
}

function detailList(entries) {
  const list = node("dl", undefined, "detail-list");
  for (const [label, value] of entries) {
    const item = node("div");
    append(item, node("dt", label), node("dd", value ?? "—"));
    list.append(item);
  }
  return list;
}

async function showBatchDetails(batchId) {
  elements.viewContainer.replaceChildren(node("p", "Đang lấy chi tiết từ Fabric…", "muted"));
  try {
    const id = encodeURIComponent(batchId);
    const [detail, history, lineage] = await Promise.all([
      api(`/api/v1/batches/${id}`),
      api(`/api/v1/batches/${id}/history`),
      api(`/api/v1/batches/${id}/lineage`)
    ]);
    const batch = detail.batch;
    const page = node("section");
    const back = node("button", "Quay lại danh sách", "button button--secondary");
    back.type = "button";
    back.addEventListener("click", () => selectView("batches"));
    const heading = node("div", undefined, "section-heading");
    append(heading, node("div"), back);
    heading.children[0].append(node("h2", batch.batchId));
    heading.children[0].append(node("p", "Chi tiết và lịch sử được đọc từ ledger Fabric."));
    const summary = node("article", undefined, "content-card");
    append(summary, node("h2", "Thông tin lô"));
    summary.append(detailList([
      ["Loài / loại", batch.species || batch.batchType],
      ["Trạng thái", batch.status],
      ["Chủ sở hữu hiện tại", batch.currentOwnerMsp],
      ["Số lượng hiện có", `${batch.availableQuantity ?? batch.quantity} ${batch.unit || ""}`],
      ["Mã tổ chức khai thác", batch.ownerMsp],
      ["Hash tài liệu trên Fabric", `${(batch.documentHashes || []).length} hash đã neo`]
    ]));
    const lineageCard = node("article", undefined, "content-card");
    append(lineageCard, node("h2", "Quan hệ nguồn gốc"));
    const batchIds = (lineage.lineage.batches || []).map((item) => item.batchId);
    const lineageEdges = lineage.lineage.edges || [];
    if (lineageEdges.length) {
      const edgeList = node("ul", undefined, "timeline");
      for (const edge of lineageEdges) edgeList.append(node("li", edge));
      lineageCard.append(edgeList);
    } else {
      lineageCard.append(node("p", batchIds.length ? `${batchIds[0]} (gốc)` : "Không có dữ liệu lineage.", "muted"));
    }
    const historyCard = node("article", undefined, "content-card");
    append(historyCard, node("h2", "Lịch sử sự kiện"));
    const timeline = node("ol", undefined, "timeline");
    for (const event of history.history || []) {
      const item = node("li");
      append(
        item,
        node("strong", event.eventType || event.type || "Sự kiện"),
        node("small", `${event.transactionTimestamp || event.createdAt || event.timestamp || "Thời gian Fabric"} · ${event.actorMsp || event.organization || "Tổ chức thành viên"}`)
      );
      timeline.append(item);
    }
    if (timeline.childElementCount === 0) timeline.append(node("li", "Chưa có sự kiện lịch sử."));
    historyCard.append(timeline);
    const actionCard = node("article", undefined, "content-card");
    append(actionCard, node("h2", "Thao tác phù hợp với trạng thái"));
    const actions = permittedBatchActions(batch, history.history || []);
    if (actions.length === 0) {
      actionCard.append(node("p", "Không có thao tác nào được bật cho vai trò và trạng thái hiện tại.", "muted"));
    } else {
      const actionList = node("div", undefined, "action-list");
      for (const action of actions) {
        const button = node("button", action.label, "button button--primary");
        button.type = "button";
        button.addEventListener("click", () => openOperationWithDefaults(action.operation, action.values));
        actionList.append(button);
      }
      actionCard.append(actionList);
    }
    const grid = node("div", undefined, "content-grid");
    append(grid, lineageCard, historyCard);
    append(page, heading, summary, actionCard, grid);
    elements.viewContainer.replaceChildren(page);
  } catch (error) {
    elements.viewContainer.replaceChildren(makeEmptyState("Không thể đọc lô hàng", error.message));
  }
}

function permittedBatchActions(batch, history) {
  const role = currentUser && currentUser.role;
  const actions = [];
  const owner = batch.currentOwnerMsp;
  const processingOwner = owner === "OrgProcessingMSP";

  if (role === "harvest_operator" && owner === "OrgHarvestMSP" && batch.status === "HARVESTED") {
    actions.push({
      label: "Bàn giao cho chế biến",
      operation: "handover",
      values: { batchId: batch.batchId }
    });
  }
  if (role === "processing_operator" && batch.status === "HANDED_OVER") {
    actions.push({
      label: "Tiếp nhận bàn giao",
      operation: "accept-transfer",
      values: { transferId: batch.batchId }
    });
  }
  if (role === "processing_operator" && processingOwner && ["RECEIVED", "PROCESSING"].includes(batch.status)) {
    actions.push(
      { label: "Ghi nhận chế biến", operation: "processing", values: { batchId: batch.batchId } },
      { label: "Tạo lô dẫn xuất", operation: "derived", values: { parentBatchId: batch.batchId } }
    );
  }
  if (role === "quality_inspector" && processingOwner && ["PROCESSING", "QUALITY_CHECKED"].includes(batch.status)) {
    actions.push({
      label: "Ghi nhận kiểm định",
      operation: "quality",
      values: { batchId: batch.batchId }
    });
  }
  if (role === "processing_operator" && processingOwner && batch.status === "QUALITY_CHECKED") {
    actions.push({
      label: "Đóng gói lô hàng",
      operation: "package",
      values: {
        batchId: batch.batchId,
        certificateHash: (batch.documentHashes || [])[0] || ""
      }
    });
  }
  if (role === "processing_operator" && processingOwner && batch.status === "PACKAGED") {
    actions.push({
      label: "Tạo chuyến hàng",
      operation: "shipment",
      values: { batchIds: batch.batchId }
    });
  }
  if (role === "distributor" && batch.status === "IN_TRANSIT" && batch.pendingShipmentId) {
    actions.push({
      label: "Xác nhận nhận chuyến hàng",
      operation: "accept-shipment",
      values: { shipmentId: batch.pendingShipmentId }
    });
  }
  if (role === "distributor" && batch.status === "RECEIVED") {
    const acceptedShipment = history.find((event) => (
      event.eventType === "ShipmentAccepted" && event.details?.shipmentId
    ));
    if (acceptedShipment) {
      actions.push({
        label: "Ghi nhận phân phối",
        operation: "distribution",
        values: { batchId: batch.batchId, shipmentId: acceptedShipment.details.shipmentId }
      });
    }
  }
  if (
    ["harvest_operator", "processing_operator"].includes(role)
    && currentUser.organizationMsp === owner
  ) {
    actions.push({
      label: "Lưu điều khoản thương mại riêng tư",
      operation: "private-terms",
      values: { batchId: batch.batchId }
    });
  }
  return actions;
}

function openOperationWithDefaults(operation, values) {
  selectView("operations");
  const form = document.querySelector(`#operation-${operation}`);
  if (!form) {
    showNotice("Thao tác này không khả dụng cho vai trò hiện tại.", true);
    return;
  }
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (field) field.value = value;
  }
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function createField(spec, formId) {
  if (spec.name === "eventId") {
    const eventId = node("input");
    eventId.type = "hidden";
    eventId.name = spec.name;
    eventId.id = `${formId}-${spec.name}`;
    eventId.value = createEventId();
    eventId.maxLength = 64;
    return eventId;
  }
  const label = node("label", undefined, "field");
  append(label, node("span", spec.label));
  let input;
  if (spec.type === "select") {
    input = node("select");
    for (const value of spec.options || []) {
      const option = node("option", value);
      option.value = value;
      input.append(option);
    }
  } else if (spec.type === "textarea") {
    input = node("textarea");
    input.rows = 2;
  } else {
    input = node("input");
    input.type = spec.type || "text";
  }
  input.name = spec.name;
  input.id = `${formId}-${spec.name}`;
  input.required = Boolean(spec.required);
  if (spec.min) input.min = spec.min;
  if (spec.max) input.max = spec.max;
  if (spec.step) input.step = spec.step;
  input.maxLength = IDENTIFIER_FIELD_NAMES.has(spec.name) ? 64 : (spec.maxLength || 256);
  if (spec.type === "datetime-local") input.value = new Date().toISOString().slice(0, 16);
  label.append(input);
  return label;
}

function makeOperationCard(definition) {
  const card = node("article", undefined, "operation-card");
  const formId = `operation-${definition.name}`;
  append(card, node("h2", definition.title), node("p", definition.description));
  const form = node("form", undefined, "operation-form");
  form.id = formId;
  form.dataset.operation = definition.name;
  for (const spec of definition.fields) {
    form.append(createField(spec, formId));
  }
  const submit = node("button", "Gửi giao dịch", "button button--primary");
  submit.type = "submit";
  form.append(submit);
  card.append(form);
  return card;
}

function makeDocumentCard({ allowUpload = true } = {}) {
  const card = node("article", undefined, "operation-card");
  append(
    card,
    node("h2", "Tải chứng từ và kiểm tra hash"),
    node("p", allowUpload
      ? "PDF, PNG hoặc JPEG; tối đa 10 MiB. Tệp được lưu riêng; hash chỉ xác minh thành công sau khi được neo trên Fabric."
      : "Auditor có thể xác minh hash của tài liệu được cấp quyền bằng mã tài liệu.")
  );
  if (allowUpload) {
    const form = node("form", undefined, "operation-form");
    form.dataset.operation = "document";
    form.enctype = "multipart/form-data";
    form.append(createField({ name: "batchId", label: "Mã lô", required: true }, "document"));
    const fileLabel = node("label", undefined, "field");
    append(fileLabel, node("span", "Tệp chứng từ"));
    const file = node("input");
    file.type = "file";
    file.name = "file";
    file.accept = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
    file.required = true;
    fileLabel.append(file);
    form.append(fileLabel);
    const submit = node("button", "Tải lên tài liệu", "button button--primary");
    submit.type = "submit";
    form.append(submit);
    const result = node("p", undefined, "muted");
    result.dataset.documentResult = "true";
    result.hidden = true;
    form.append(result);
    card.append(form);
  }

  const verifyForm = node("form", undefined, "operation-form");
  verifyForm.dataset.operation = "verify-document";
  verifyForm.append(createField({ name: "storageId", label: "Mã tài liệu đã tải lên", required: true }, "verify-document"));
  const verifyButton = node("button", "Xác minh hash trên Fabric", "button button--secondary");
  verifyButton.type = "submit";
  verifyForm.append(verifyButton);
  card.append(verifyForm);
  return card;
}

function renderOperations() {
  const container = node("section");
  const intro = node("p", `Các thao tác khả dụng cho vai trò ${roleLabel(currentUser.role)}. Quyền thực thi luôn được kiểm tra lại tại API và chaincode.`, "muted");
  const grid = node("div", undefined, "operation-grid");
  const available = operationDefinitions.filter((definition) => definition.roles.includes(currentUser.role));
  for (const definition of available) {
    grid.append(makeOperationCard(definition));
  }
  if (["harvest_operator", "processing_operator", "quality_inspector", "distributor", "auditor"].includes(currentUser.role)) {
    grid.append(makeDocumentCard({ allowUpload: currentUser.role !== "auditor" }));
  }
  if (available.length === 0 && !["harvest_operator", "processing_operator", "quality_inspector", "distributor", "auditor"].includes(currentUser.role)) {
    grid.append(makeEmptyState("Không có thao tác ghi", "Vai trò hiện tại có thể sử dụng chức năng tra cứu được cấp quyền."));
  }
  append(container, intro, grid);
  return container;
}

function securityStatusLabel(status) {
  const labels = {
    NOT_RUN: "Chưa chạy",
    RUNNING: "Đang chạy",
    PASS: "Đạt",
    FAIL: "Không đạt",
    ERROR: "Thiếu điều kiện"
  };
  return labels[status] || status;
}

function renderSecurityRun(run) {
  const summary = node("section", undefined, "security-run-summary");
  if (!run) {
    summary.append(node("p", "Chưa có kết quả kiểm thử.", "muted"));
    return summary;
  }
  append(
    summary,
    node("p", `${run.profile || "lab-current"} · ${run.startedAt || "—"} · ${run.durationMs ?? 0} ms`, "muted"),
    node("p", run.summary || run.actual || "Chưa có tóm tắt.")
  );
  if (run.finding) {
    append(
      summary,
      node("p", `Finding · ${run.finding.severity}: ${run.finding.impact}`),
      node("p", `Khắc phục: ${run.finding.remediation} · Retest: ${run.finding.retestResult}`, "muted")
    );
  }
  if (run.evidence && run.evidence.length > 0) {
    const details = node("details", undefined, "security-evidence");
    const heading = node("summary", "Xem bằng chứng");
    const content = node("pre");
    content.textContent = "Chọn để tải bằng chứng…";
    details.append(heading, content);
    details.addEventListener("toggle", async () => {
      if (!details.open || content.dataset.loaded === "true") return;
      try {
        const evidence = await api(run.evidence[0]);
        content.textContent = JSON.stringify(evidence, null, 2);
      } catch (error) {
        content.textContent = `Không thể tải bằng chứng: ${error.message}`;
      }
      content.dataset.loaded = "true";
    });
    summary.append(details);
  }
  return summary;
}

function renderSecurityComparisons(comparisons) {
  const card = node("article", undefined, "content-card security-comparisons");
  append(
    card,
    node("h2", "So sánh baseline / hardened"),
    node("p", "So sánh chỉ xuất hiện khi có báo cáo được gắn đúng hồ sơ.", "muted")
  );
  const available = (comparisons || []).filter((comparison) => comparison.baseline || comparison.hardened);
  if (available.length === 0) {
    card.append(node("p", "Chưa có báo cáo baseline/hardened để so sánh.", "muted"));
    return card;
  }
  const table = node("table", undefined, "security-comparison-table");
  const head = node("thead");
  const header = node("tr");
  for (const label of ["Kiểm thử", "Baseline", "Hardened"]) header.append(node("th", label));
  head.append(header);
  const body = node("tbody");
  for (const comparison of available) {
    const row = node("tr");
    row.append(node("th", comparison.testId));
    row.append(node("td", comparison.baseline?.status || "—"));
    row.append(node("td", comparison.hardened?.status || "—"));
    body.append(row);
  }
  table.append(head, body);
  card.append(table);
  return card;
}

function makeSecurityTestCard(testCase) {
  const card = node("article", undefined, "content-card security-test-card");
  const latest = testCase.latestRun;
  const status = latest?.status || "NOT_RUN";
  const header = node("div", undefined, "security-test-heading");
  const identity = node("div");
  append(identity, node("p", testCase.testId, "eyebrow"), node("h2", testCase.name));
  const badge = node("span", securityStatusLabel(status), `status-badge security-status security-status--${status.toLowerCase()}`);
  append(header, identity, badge);
  const metadata = node("dl", undefined, "security-test-metadata");
  for (const [label, value] of [
    ["Danh mục", testCase.category],
    ["Rủi ro", testCase.risk],
    ["Mục tiêu", testCase.objective],
    ["Phạm vi đích", testCase.target],
    ["Điều kiện", testCase.precondition],
    ["Giới hạn an toàn", testCase.safeExecutionLimit]
  ]) {
    const row = node("div");
    append(row, node("dt", label), node("dd", value));
    metadata.append(row);
  }
  const runButton = node("button", "Chạy kiểm thử", "button button--secondary");
  runButton.type = "button";
  runButton.disabled = !testCase.runnable || status === "RUNNING";
  runButton.setAttribute("aria-label", `Chạy ${testCase.testId}`);
  runButton.addEventListener("click", async () => {
    runButton.disabled = true;
    runButton.textContent = "Đang khởi chạy…";
    try {
      await api(`/api/v1/security/tests/${encodeURIComponent(testCase.testId)}/run`, {
        method: "POST",
        body: "{}"
      });
      showNotice(`${testCase.testId}: kiểm thử đã bắt đầu.`);
      await loadSecurityDashboard();
      window.clearTimeout(securityRefreshTimer);
      securityRefreshTimer = window.setTimeout(() => {
        if (currentScreen === "dashboard" && currentView === "security") loadSecurityDashboard();
      }, 1200);
    } catch (error) {
      showNotice(error.message, true);
      runButton.disabled = false;
      runButton.textContent = "Chạy kiểm thử";
    }
  });
  append(card, header, metadata, runButton, renderSecurityRun(latest));
  return card;
}

async function loadSecurityDashboard(container = elements.viewContainer) {
  if (!currentUser || currentUser.role !== "security_admin") return;
  try {
    const overview = await api("/api/v1/security/overview");
    const content = node("section", undefined, "security-dashboard");
    const intro = node("article", undefined, "content-card security-warning");
    append(
      intro,
      node("h2", "Security testing dashboard"),
      node("p", "Các kiểm thử chỉ kết nối tới dịch vụ loopback đã định sẵn. Không có URL, lệnh, tệp đích hoặc khối lượng tùy chỉnh.", "muted"),
      node("p", "Một số kiểm thử cần Fabric hoặc dữ liệu demo cục bộ; thiếu điều kiện sẽ hiển thị ERROR. Không chạy kiểm thử tải hay thao tác phá hủy.", "muted")
    );
    const grid = node("div", undefined, "security-test-grid");
    for (const testCase of overview.tests || []) grid.append(makeSecurityTestCard(testCase));
    append(content, intro, renderSecurityComparisons(overview.comparisons), grid);
    if (currentScreen !== "dashboard" || currentView !== "security") return;
    container.replaceChildren(content);
    if ((overview.tests || []).some((testCase) => testCase.latestRun?.status === "RUNNING")) {
      window.clearTimeout(securityRefreshTimer);
      securityRefreshTimer = window.setTimeout(() => {
        if (currentScreen === "dashboard" && currentView === "security") loadSecurityDashboard();
      }, 1200);
    }
  } catch (error) {
    if (currentScreen !== "dashboard" || currentView !== "security") return;
    container.replaceChildren(makeEmptyState("Không thể tải kiểm thử bảo mật", error.message));
  }
}

function renderSecurityDashboard() {
  const container = node("section", "Đang tải danh mục kiểm thử bảo mật…", "muted");
  if (currentUser?.role === "security_admin") loadSecurityDashboard(container);
  else container.textContent = "Chỉ security_admin được xem và chạy kiểm thử.";
  return container;
}

function renderCurrentView() {
  if (currentScreen !== "dashboard") return;
  const renderers = {
    overview: renderOverview,
    batches: renderBatches,
    operations: renderOperations,
    security: renderSecurityDashboard
  };
  elements.viewContainer.replaceChildren((renderers[currentView] || renderOverview)());
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === currentView);
  });
}

function selectView(view) {
  if (view === "security" && currentUser?.role !== "security_admin") {
    showNotice("Chỉ tài khoản security_admin được dùng bảng kiểm thử.", true);
    return;
  }
  if (view === "trace") {
    openPublicTrace();
    return;
  }
  currentView = view;
  renderCurrentView();
}

function toNumber(value) {
  return value === "" ? undefined : Number(value);
}

function operationPayload(operation, values) {
  const eventId = values.eventId;
  switch (operation) {
    case "harvest":
      return {
        url: "/api/v1/batches/harvest",
        body: {
          batchId: values.batchId,
          eventId,
          species: values.species,
          harvestLocation: values.harvestLocation,
          harvestedAt: new Date(values.harvestedAt).toISOString(),
          quantity: toNumber(values.quantity),
          unit: values.unit
        }
      };
    case "handover":
      return {
        url: `/api/v1/batches/${encodeURIComponent(values.batchId)}/handover`,
        body: { eventId, recipientMsp: "OrgProcessingMSP" }
      };
    case "accept-transfer":
      return {
        url: `/api/v1/transfers/${encodeURIComponent(values.transferId)}/accept`,
        body: { eventId }
      };
    case "processing":
      return {
        url: `/api/v1/batches/${encodeURIComponent(values.batchId)}/processing`,
        body: {
          eventId,
          recordId: values.recordId,
          outputBatchId: values.outputBatchId,
          inputBatches: [{
            batchId: values.batchId,
            quantityUsed: toNumber(values.quantityUsed),
            unit: values.unit
          }],
          processType: values.processType,
          facilityId: values.facilityId,
          notes: values.notes || undefined
        }
      };
    case "derived":
      return {
        url: `/api/v1/batches/${encodeURIComponent(values.parentBatchId)}/derived`,
        body: {
          batchId: values.batchId,
          eventId,
          quantity: toNumber(values.quantity),
          unit: values.unit,
          inputBatches: [{
            batchId: values.parentBatchId,
            quantityUsed: toNumber(values.quantityUsed),
            unit: values.unit
          }]
        }
      };
    case "quality":
      return {
        url: `/api/v1/batches/${encodeURIComponent(values.batchId)}/quality`,
        body: {
          eventId,
          qualityId: values.qualityId,
          result: values.result,
          standardCode: values.standardCode,
          certificateHash: values.certificateHash || undefined,
          documentRef: values.documentRef || undefined
        }
      };
    case "package":
      return {
        url: `/api/v1/batches/${encodeURIComponent(values.batchId)}/package`,
        body: { eventId, certificateHash: values.certificateHash }
      };
    case "shipment":
      return {
        url: "/api/v1/shipments",
        body: {
          eventId,
          shipmentId: values.shipmentId,
          batchIds: values.batchIds.split(",").map((id) => id.trim()).filter(Boolean),
          toMsp: "OrgDistributionMSP"
        }
      };
    case "accept-shipment":
      return {
        url: `/api/v1/shipments/${encodeURIComponent(values.shipmentId)}/accept`,
        body: { eventId }
      };
    case "distribution":
      return {
        url: `/api/v1/shipments/${encodeURIComponent(values.shipmentId)}/distribute`,
        body: {
          batchId: values.batchId,
          shipmentId: values.shipmentId,
          eventId,
          distributionId: values.distributionId,
          location: values.location
        }
      };
    case "private-terms":
      return {
        url: `/api/v1/batches/${encodeURIComponent(values.batchId)}/private-terms`,
        body: {
          eventId,
          privateTerms: {
            commercialPrice: toNumber(values.commercialPrice),
            contractReference: values.contractReference || undefined,
            supplierNotes: values.supplierNotes || undefined
          }
        }
      };
    default:
      throw new Error("Nghiệp vụ không được hỗ trợ.");
  }
}

async function submitOperation(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  const operation = form.dataset.operation;
  try {
    if (operation === "document") {
      const formData = new FormData(form);
      const upload = await api("/api/v1/documents", { method: "POST", body: formData });
      const verification = await api(
        `/api/v1/documents/${encodeURIComponent(upload.document.storageId)}/verify`,
        { method: "POST" }
      );
      const result = form.querySelector("[data-document-result]");
      const verificationText = verification.verifiedOnLedger
        ? "Hash khớp với dữ liệu trên Fabric."
        : "Hash chưa được neo trên Fabric. Sau khi ghi nhận trong kiểm định hoặc đóng gói, hãy xác minh lại.";
      result.textContent = `${verificationText} Mã tài liệu: ${upload.document.storageId}. SHA-256: ${verification.sha256}`;
      result.hidden = false;
      const verifyForm = form.closest(".operation-card").querySelector('[data-operation="verify-document"]');
      verifyForm.elements.namedItem("storageId").value = upload.document.storageId;
      showNotice("Tệp đã tải lên; mã tài liệu và SHA-256 hiển thị trong biểu mẫu.");
      form.reset();
      return;
    }
    if (operation === "verify-document") {
      const values = Object.fromEntries(new FormData(form).entries());
      const verification = await api(
        `/api/v1/documents/${encodeURIComponent(values.storageId)}/verify`,
        { method: "POST" }
      );
      showNotice(verification.verifiedOnLedger
        ? `Hash khớp trên Fabric: ${verification.sha256}`
        : `Hash không được neo trên Fabric: ${verification.sha256}`, !verification.verifiedOnLedger);
      return;
    }

    const values = Object.fromEntries(new FormData(form).entries());
    const request = operationPayload(operation, values);
    await api(request.url, {
      method: "POST",
      body: JSON.stringify(request.body)
    });
    showNotice(operation === "private-terms"
      ? "Điều khoản đã được gửi qua Fabric transient data."
      : "Giao dịch đã được ghi nhận trên Fabric.");
    form.reset();
    const eventId = form.elements.namedItem("eventId");
    if (eventId) eventId.value = createEventId();
    await loadBatches();
    renderCurrentView();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

function appendTraceSummary(parent, batch) {
  const details = detailList([
    ["Mã lô", batch.batchId],
    ["Loài / loại", batch.species || batch.batchType],
    ["Trạng thái", batch.status],
    ["Số lượng", `${batch.quantity ?? "—"} ${batch.unit || ""}`],
    ["Tổ chức khai thác", batch.ownerMsp],
    ["Chủ sở hữu hiện tại", batch.currentOwnerMsp]
  ]);
  parent.append(details);
}

function renderPublicTrace(result) {
  const card = node("article", undefined, "trace-card");
  const batch = result.batch || {};
  append(card, node("p", "Dữ liệu công khai trên Fabric", "eyebrow"), node("h2", batch.batchId || "Lô hàng"));
  appendTraceSummary(card, batch);
  const historyTitle = node("div", undefined, "section-heading");
  append(historyTitle, node("div"));
  historyTitle.children[0].append(node("h2", "Hành trình sản phẩm"));
  const history = node("ol", undefined, "timeline");
  for (const event of result.history || []) {
    const item = node("li");
    append(
      item,
      node("strong", event.eventType || event.type || "Sự kiện chuỗi cung ứng"),
      node("small", `${event.transactionTimestamp || event.createdAt || event.timestamp || "Thời gian ghi trên Fabric"} · ${event.actorMsp || event.organization || "Tổ chức thành viên"}`)
    );
    history.append(item);
  }
  if (history.childElementCount === 0) history.append(node("li", "Chưa có sự kiện công khai."));
  const copy = node("button", "Sao chép liên kết tra cứu", "button button--secondary");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/trace/${encodeURIComponent(batch.batchId)}`);
      showNotice("Đã sao chép liên kết tra cứu công khai.");
    } catch {
      showNotice("Trình duyệt không cho phép sao chép liên kết.", true);
    }
  });
  const qr = node("img", undefined, "trace-qr");
  qr.src = `/api/v1/trace/${encodeURIComponent(batch.batchId)}/qr`;
  qr.alt = `Mã QR tra cứu lô ${batch.batchId}`;
  qr.width = 192;
  qr.height = 192;
  const downloadQr = node("a", "Tải mã QR PNG", "button button--secondary");
  downloadQr.href = `${qr.src}?download=1`;
  downloadQr.download = `${batch.batchId}-trace.png`;
  append(card, historyTitle, history, qr, downloadQr, copy);
  return card;
}

function openPublicTrace() {
  previousScreen = currentScreen;
  setScreen("trace");
}

async function runPublicTrace(batchId) {
  elements.publicTraceResult.replaceChildren(node("p", "Đang truy vấn dữ liệu công khai trên Fabric…", "muted"));
  try {
    const result = await api(`/api/v1/trace/${encodeURIComponent(batchId)}`);
    elements.publicTraceResult.replaceChildren(renderPublicTrace(result));
  } catch (error) {
    elements.publicTraceResult.replaceChildren(makeEmptyState("Không tìm thấy dữ liệu công khai", error.message));
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.hidden = true;
  const submit = elements.loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(elements.loginForm).entries());
    const session = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(values)
    });
    elements.loginForm.reset();
    setAuthenticatedSession(session);
  } catch (error) {
    elements.loginError.textContent = error.message;
    elements.loginError.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

elements.logoutButton.addEventListener("click", () => signOut());
document.querySelector("#refresh-button").addEventListener("click", refreshDashboardData);
document.querySelector("#public-trace-button").addEventListener("click", openPublicTrace);
document.querySelector("#back-button").addEventListener("click", () => setScreen(previousScreen));

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => selectView(tab.dataset.view));
});

elements.viewContainer.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-operation]");
  if (!form) return;
  event.preventDefault();
  submitOperation(form);
});

elements.publicTraceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const batchId = new FormData(elements.publicTraceForm).get("batchId").toString().trim();
  if (batchId) runPublicTrace(batchId);
});

const traceFromUrl = new URLSearchParams(location.search).get("trace")
  || (location.pathname.startsWith("/trace/") ? location.pathname.slice("/trace/".length) : null);
if (traceFromUrl) {
  let decodedTraceId = traceFromUrl;
  try {
    decodedTraceId = decodeURIComponent(traceFromUrl);
  } catch {
    decodedTraceId = "";
  }
  elements.publicTraceForm.elements.batchId.value = decodedTraceId;
  openPublicTrace();
  if (decodedTraceId) runPublicTrace(decodedTraceId);
}
refreshConnectionStatus();
