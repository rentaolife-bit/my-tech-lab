// My Tech Lab 第二阶段 — 模块停用只读机制 行为测试
// 隔离环境：mock DOM / mock localStorage / mock fetch，不触碰真实浏览器数据，不发真实 AI 请求。
// 运行：node tests/module-readonly-behavior.test.js
//
// 说明：本文件通过 new Function 把 index.html 中的真实脚本加载到沙箱里执行，
// 断言的是“真实函数调用的行为结果”，不是对源码做字符串匹配。

const fs = require("fs");
const assert = require("assert");
const path = require("path");

const HTML_PATH = process.env.MTL_HTML_PATH
    ? path.resolve(process.env.MTL_HTML_PATH)
    : path.resolve(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// ---------- 1. 抽取脚本主体，去掉末尾初始化块 ----------
const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.lastIndexOf("</script>");
let scriptBody = html.slice(scriptStart, scriptEnd);
const initMarker = "validateModuleRegistry();";
const initIdx = scriptBody.lastIndexOf(initMarker);
if (initIdx > 0) {
    scriptBody = scriptBody.slice(0, initIdx);
}

// ---------- 2. mock DOM ----------
function makeElement(tagName = "div") {
    const el = {
        tagName: String(tagName).toUpperCase(),
        type: "",
        className: "",
        children: [],
        dataset: {},
        style: {},
        classList: {
            _set: new Set(),
            add(...c) { c.forEach((x) => this._set.add(x)); },
            remove(...c) { c.forEach((x) => this._set.delete(x)); },
            toggle(c, force) { if (force === undefined ? !this._set.has(c) : force) this._set.add(c); else this._set.delete(c); },
            contains(c) { return this._set.has(c); }
        },
        textContent: "",
        value: "",
        checked: false,
        disabled: false,
        hidden: false,
        href: "",
        download: "",
        isConnected: true,
        parentElement: null,
        setAttribute(k, v) { this[k] = v; if (k === "class") { this.className = v; this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); } },
        getAttribute(k) { return this[k] !== undefined ? this[k] : null; },
        removeAttribute(k) { delete this[k]; },
        hasAttribute(k) { return this[k] !== undefined; },
        _listeners: {},
        addEventListener(type, handler) {
            if (typeof handler !== "function") return;
            (this._listeners[type] = this._listeners[type] || []).push(handler);
        },
        removeEventListener(type, handler) {
            const handlers = this._listeners[type];
            if (!handlers) return;
            const index = handlers.indexOf(handler);
            if (index >= 0) handlers.splice(index, 1);
        },
        dispatchEvent(event) {
            const type = typeof event === "string" ? event : event.type;
            const payload = typeof event === "string" ? { type } : event;
            if (!payload.target) payload.target = this;
            payload.currentTarget = this;
            (this._listeners[type] || []).slice().forEach((handler) => handler.call(this, payload));
            return true;
        },
        append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentElement = this; } },
        appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
        replaceChildren(...nodes) { this.children = nodes.slice(); for (const n of this.children) { n.parentElement = this; } },
        remove() {
            if (this.parentElement) {
                const i = this.parentElement.children.indexOf(this);
                if (i >= 0) this.parentElement.children.splice(i, 1);
                this.parentElement = null;
            }
        },
        focus() {},
        scrollIntoView() {},
        click() {},
        before() {},
        after() {},
        closest() { return null; },
        requestSubmit() {},
        _matches(sel) {
            if (sel.startsWith(".")) {
                const cls = sel.slice(1);
                return (this.className || "").split(/\s+/).includes(cls) || this.classList.contains(cls);
            }
            const typeMatch = sel.match(/^input\[type="([^"]+)"\]$/);
            if (typeMatch) return this.tagName === "INPUT" && this.type === typeMatch[1];
            return false;
        },
        querySelector(sel) {
            const stack = [...this.children];
            while (stack.length) {
                const node = stack.pop();
                if (node._matches(sel)) return node;
                stack.push(...node.children);
            }
            return null;
        },
        querySelectorAll(sel) {
            const out = [];
            const stack = [...this.children];
            while (stack.length) {
                const node = stack.pop();
                if (node._matches(sel)) out.push(node);
                stack.push(...node.children);
            }
            return out;
        },
    };
    return el;
}

function makeDocument() {
    const byId = new Map();
    const bySel = new Map();
    return {
        body: makeElement("body"),
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, makeElement("div"));
            return byId.get(id);
        },
        querySelector(sel) {
            if (!bySel.has(sel)) bySel.set(sel, makeElement("div"));
            return bySel.get(sel);
        },
        querySelectorAll() { return []; },
        createElement(tag) { return makeElement(tag); },
        createTextNode(text) {
            const node = makeElement("#text");
            node.textContent = String(text);
            return node;
        },
    };
}

// ---------- 3. mock localStorage ----------
function makeStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        _store: store,
    };
}

// ---------- 4. mock fetch（可控制 resolve/reject，可开关 abort 感知）----------
function makeMockFetch() {
    const pending = [];
    const fn = function mockFetch(url, opts) {
        return new Promise((resolve, reject) => {
            const entry = { url, opts, resolve, reject, signal: opts?.signal };
            pending.push(entry);
            if (opts?.signal && fn.rejectOnAbort !== false) {
                const onAbort = () => reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
                if (opts.signal.aborted) onAbort();
                else opts.signal.addEventListener("abort", onAbort, { once: true });
            }
        });
    };
    fn.pending = pending;
    fn.rejectOnAbort = true;
    fn.last = () => pending[pending.length - 1];
    return fn;
}

// ---------- 4.5 可捕获的定时器（测试可读取/手动触发 setTimeout 回调）----------
function makeTimers() {
    const map = new Map();
    return {
        setTimeout(fn, delay) {
            const id = map.size + 1;
            map.set(id, { fn, delay });
            return id;
        },
        clearTimeout(id) { map.delete(id); },
        _map: map,
    };
}

// ---------- 5. 组装环境并加载真实脚本 ----------
function loadApi(options = {}) {
    const localStorage = options.localStorage || makeStorage(options.seed || {});
    const fetchMock = options.fetch || makeMockFetch();
    const timers = options.timers || makeTimers();
    const document = makeDocument();
    const window = {
        setTimeout: (fn, delay) => timers.setTimeout(fn, delay),
        clearTimeout: (id) => timers.clearTimeout(id),
        setInterval: () => 0,
        clearInterval: () => {},
        confirm: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
    };

    const returnStmt = `
; return {
    // --- 状态机制 ---
    setModuleEnabled, getModuleRuntimeState, isModuleReadOnly,
    getModuleAccessStatus, requireModuleAccess, MODULE_READONLY_MESSAGE,
    // --- 持久化函数 ---
    persistNotes, persistTasks, persistDailyFocus, writeDailyFocusArchive,
    persistIdeas, persistDocumentHistory,
    toggleTask, deleteTask, changeTaskPriority, startDailyFocus,
    notesStorageKey, tasksStorageKey, dailyFocusStorageKey, ideasStorageKey, documentStorageKey,
    dailyFocusSchemaVersion,
    // --- 数据加载（用于构造真实内存态）---
    loadNotes, loadTasks, loadIdeas, loadDocumentHistory, loadDailyFocus,
    refreshDailyPlanning,
    getNotes: () => notes, getTasks: () => tasks, getIdeas: () => ideas,
    getDocumentHistory: () => documentHistory, getDailyFocus: () => dailyFocus,
    getReady: () => ({ notesStorageReady, tasksStorageReady, dailyFocusStorageReady, ideasStorageReady, dailyPlanningReady }),
    // --- AI：AI Assistant ---
    requestAssistantReply, updateAssistantAccessUI, updateModuleAccessUI, aiConversation,
    getAiRequestPending: () => aiRequestPending,
    getAiRequestController: () => aiRequestController,
    // --- AI：Daily Planning ---
    runDailyPlanningAnalysis, updateDailyPlanningAccessUI, planningAIStatus, planningAnalysisMode,
    confirmDailyPlan,
    getDailyPlanningPending: () => dailyPlanningAIRequestPending,
    getDailyPlanningController: () => dailyPlanningRequestController,
    getDailyPlanningAnalysis: () => dailyPlanningAnalysis,
    // --- AI：Task Organization ---
    organizeTasks, updateTaskOrganizationAccessUI, taskOrganizerInput, taskOrganizerStatus,
    updateTaskImportButton, updateTaskImportSelectionHint,
    taskPreviewList, taskImportButton, taskOrganizerPreview, taskOrganizerCopyButton,
    createTaskPreviewItem,
    setTaskOrganizerPreviewActive: (source) => {
        taskOrganizerPreviewVersion += 1;
        taskOrganizerImportedVersion = 0;
        taskOrganizerPreviewSource = source;
        taskOrganizerInput.value = source;
        taskOrganizerPreview.hidden = false;
    },
    getTaskOrganizerPreviewVersion: () => taskOrganizerPreviewVersion,
    getTaskOrganizerImportedVersion: () => taskOrganizerImportedVersion,
    getTaskOrganizerPending: () => taskOrganizerAIRequestPending,
    getTaskOrganizerController: () => taskOrganizerRequestController,
    // --- AI：Document Summary ---
    organizeCurrentDocument, updateDocumentSummaryAccessUI, documentSourceInput, documentInputStatus,
    getDocumentPending: () => documentAnalysisPending,
    getDocumentController: () => documentAnalysisController,
    // --- AI：Ideas & Writing ---
    requestIdeasAI, updateIdeasWritingAccessUI,
    getIdeasAIRequestPending: () => ideasAIRequestPending,
    getIdeasAIRequestController: () => ideasAIRequestController,
    // --- Data Center ---
    createDataCenterBackup, createDataCenterRecoverySnapshot, confirmDataCenterImport, confirmDataCenterClear, confirmDataCenterRecovery, applyDataCenterData, dataCenterModules,
    runDataCenterRecoveryTransaction,
    validateDataCenterBackup, validateModuleSettingsInBackup, validateModuleSettingsRawInBackup, importOrganizedTasks,
    setDataCenterPendingBackup: (v) => { dataCenterPendingBackup = v; },
    moduleSettingsStorageKey, moduleSettingsRecoveryStorageKey,
    getModuleSettings, readModuleSettings, writeModuleSettings,
    dataCenterPreviewList, previewDataCenterImport,
    isDataCenterRecoveryLocked, checkDataCenterRecoveryFailureOnStartup,
    lockDataCenterForRecoveryFailure, clearDataCenterRecoveryFailure,
    dataCenterRecoveryFailedKey,
    getRecoveryLocked: () => dataCenterRecoveryFailed,
    getRecoveryFailedKeys: () => dataCenterRecoveryFailedKeys,
    // --- Dashboard ---
    renderDashboard, updateDashboardStats, bindDashboardQuickActions,
    dashboardSortedPendingTasks, dashboardRecentNotes, dashboardTruncate,
    aiWorkerEndpoint, requestAI,
};`;

    const fn = new Function(
        "document", "localStorage", "window", "fetch", "AbortController", "URL",
        scriptBody + returnStmt
    );
    const api = fn(document, localStorage, window, fetchMock, AbortController, {
        createObjectURL: () => "blob:mock",
        revokeObjectURL: () => {},
    });
    api._localStorage = localStorage;
    api._fetch = fetchMock;
    api._document = document;
    api._window = window;
    api._timers = timers;
    return api;
}

// ---------- 6. 测试运行器 ----------
let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ✅ ${name}`);
    } catch (error) {
        failed += 1;
        failures.push({ name, message: error.message });
        console.log(`  ❌ ${name}\n     ${error.message}`);
    }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

// ---------- 7. 测试数据 ----------
const VALID_NOTE = { id: "n1", text: "hello", createdAt: "2026-01-01T00:00:00.000Z" };
const VALID_TASK = { id: "t1", text: "do", priority: "medium", completed: false, createdAt: "2026-01-01T00:00:00.000Z" };
const VALID_IDEA = { id: "i1", title: "t", content: "c", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const VALID_DOC = {
    id: "d1", title: "d", sourceText: "src",
    summary: { executive: "e", keyPoints: "k", important: "i", actions: "a", deepAnalysis: "" },
    analysisMode: "full", model: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
};

const KEYS = {
    notes: "my-tech-lab-notes",
    tasks: "my-tech-lab-tasks",
    ideas: "my-tech-lab-ideas",
    documents: "my-tech-lab-document-summaries",
    dailyFocus: "my-tech-lab-daily-focus",
    moduleSettings: "my-tech-lab-module-settings",
    moduleSettingsRecovery: "my-tech-lab-module-settings-recovery",
    recoveryFailed: "my-tech-lab-data-center-recovery-failed",
};

// 可注入读写故障的 localStorage（用于失败场景测试）
function makeFailingStorage(initial, failOp, failKey) {
    const base = makeStorage(initial);
    return {
        getItem(k) {
            if (failOp === "get" && k === failKey) throw new Error("mock get failure");
            return base.getItem(k);
        },
        setItem(k, v) {
            if (failOp === "set" && k === failKey) throw new Error("mock set failure");
            base.setItem(k, v);
        },
        removeItem(k) {
            if (failOp === "remove" && k === failKey) throw new Error("mock remove failure");
            base.removeItem(k);
        },
        _store: base._store,
    };
}

// 预置一份完整的本地数据，用于构造“真实内存态”（模拟用户已有历史数据）
function seededStore() {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return {
        [KEYS.notes]: JSON.stringify([VALID_NOTE]),
        [KEYS.tasks]: JSON.stringify([VALID_TASK]),
        [KEYS.ideas]: JSON.stringify([VALID_IDEA]),
        [KEYS.documents]: JSON.stringify([VALID_DOC]),
        [KEYS.dailyFocus]: JSON.stringify({
            schemaVersion: 1,
            activeDate: dateKey,
            records: { [dateKey]: { priorities: ["keep", "", ""] } },
        }),
    };
}

// 载入并完成真实的数据加载（相当于页面 init 中 load* 的部分）
function loadReadyApi(extraSeed = {}) {
    const api = loadApi({ seed: { ...seededStore(), ...extraSeed } });
    api.loadDailyFocus();
    api.loadNotes();
    api.loadIdeas();
    api.loadDocumentHistory();
    api.loadTasks();
    api.refreshDailyPlanning(false);
    return api;
}

async function main() {
    // ============================================================
    // Task 1：持久化写入拦截（真实函数调用 + 真实内存态）
    // ============================================================
    console.log("\n=== Task 1: 持久化写入拦截 ===");

    const persistCases = [
        {
            name: "persistNotes", moduleId: "quick-notes", key: KEYS.notes,
            getMem: (api) => api.getNotes(),
            next: () => [{ ...VALID_NOTE, id: "n2", text: "new" }],
            call: (api, data) => api.persistNotes(data),
        },
        {
            name: "persistTasks", moduleId: "task-manager", key: KEYS.tasks,
            getMem: (api) => api.getTasks(),
            next: () => [{ ...VALID_TASK, id: "t2", text: "new" }],
            call: (api, data) => api.persistTasks(data),
        },
        {
            name: "persistIdeas", moduleId: "ideas-writing", key: KEYS.ideas,
            getMem: (api) => api.getIdeas(),
            next: () => [{ ...VALID_IDEA, id: "i2", title: "new" }],
            call: (api, data) => api.persistIdeas(data),
        },
        {
            name: "persistDocumentHistory", moduleId: "document-summary", key: KEYS.documents,
            getMem: (api) => api.getDocumentHistory(),
            next: () => [{ ...VALID_DOC, id: "d2", title: "new" }],
            call: (api, data) => api.persistDocumentHistory(data),
        },
    ];

    for (const c of persistCases) {
        await check(`${c.name}：启用时正常写入（localStorage + 内存态）`, () => {
            const api = loadReadyApi();
            const next = c.next();
            const r = c.call(api, next);
            assert.strictEqual(r, true, "启用时应返回 true");
            assert.deepStrictEqual(JSON.parse(api._localStorage.getItem(c.key)), next);
            assert.deepStrictEqual(c.getMem(api), next, "内存态应同步更新");
        });

        await check(`${c.name}：停用时拒绝写入，localStorage 与内存态均不变`, () => {
            const api = loadReadyApi();
            const beforeRaw = api._localStorage.getItem(c.key);
            const beforeMem = JSON.parse(JSON.stringify(c.getMem(api)));
            api.setModuleEnabled(c.moduleId, false);
            const r = c.call(api, c.next());
            assert.strictEqual(r, false, "停用时应返回 false");
            assert.strictEqual(api._localStorage.getItem(c.key), beforeRaw, "localStorage 不得变化");
            assert.deepStrictEqual(c.getMem(api), beforeMem, "内存态不得变化");
        });

        await check(`${c.name}：停用时历史内容仍可读取（只读可查看）`, () => {
            const api = loadReadyApi();
            api.setModuleEnabled(c.moduleId, false);
            assert.ok(c.getMem(api).length >= 1, "停用后历史数据仍应可读");
            assert.deepStrictEqual(c.getMem(api), JSON.parse(api._localStorage.getItem(c.key)));
        });

        await check(`${c.name}：重新启用后恢复写入`, () => {
            const api = loadReadyApi();
            api.setModuleEnabled(c.moduleId, false);
            const blocked = c.call(api, c.next());
            assert.strictEqual(blocked, false);
            api.setModuleEnabled(c.moduleId, true);
            const next = c.next();
            const r = c.call(api, next);
            assert.strictEqual(r, true, "重新启用后应恢复写入");
            assert.deepStrictEqual(JSON.parse(api._localStorage.getItem(c.key)), next);
        });
    }

    // ---- persistDailyFocus（结构不同，单独覆盖）----
    await check("persistDailyFocus：启用时正常写入（完整归档字段）", () => {
        const api = loadReadyApi();
        const date = api.getDailyFocus().date;
        const priorities = ["首要任务", "第二重点", "第三重点"];
        const r = api.persistDailyFocus({ date, priorities });
        assert.strictEqual(r, true);
        const stored = JSON.parse(api._localStorage.getItem(KEYS.dailyFocus));

        // 1. schemaVersion 正确
        assert.strictEqual(stored.schemaVersion, api.dailyFocusSchemaVersion, "schemaVersion 应保持正确");
        // 2. activeDate 正确
        assert.strictEqual(stored.activeDate, date, "activeDate 应更新为保存日期");
        // 3. records 对象存在且非数组
        assert.ok(
            stored.records && typeof stored.records === "object" && !Array.isArray(stored.records),
            "records 应为对象"
        );
        // 4. 当前日期记录存在
        assert.ok(stored.records[date], "当前日期记录应存在");
        // 5. priorities 为长度 3 的数组
        assert.ok(Array.isArray(stored.records[date].priorities), "priorities 应为数组");
        assert.strictEqual(stored.records[date].priorities.length, 3, "priorities 长度应为 3");
        // 6. 三项内容均与输入一致
        assert.deepStrictEqual(
            stored.records[date].priorities,
            priorities,
            "三项 priorities 应与输入完全一致"
        );
        // 7. 顶层无意外多余字段（仅 schemaVersion/activeDate/records）
        assert.deepStrictEqual(
            Object.keys(stored).sort(),
            ["activeDate", "records", "schemaVersion"],
            "归档顶层不应出现意外字段"
        );
        // 8. 记录项无意外多余字段
        assert.deepStrictEqual(
            Object.keys(stored.records[date]).sort(),
            ["priorities"],
            "记录项不应出现意外字段"
        );
    });

    await check("persistDailyFocus：停用时拒绝写入，历史记录不变", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.dailyFocus);
        const date = api.getDailyFocus().date;
        api.setModuleEnabled("daily-focus", false);
        const r = api.persistDailyFocus({ date, priorities: ["changed", "", ""] });
        assert.strictEqual(r, false);
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), before);
    });

    await check("persistDailyFocus：停用时历史记录仍可读取", () => {
        const api = loadReadyApi();
        const date = api.getDailyFocus().date;
        api.setModuleEnabled("daily-focus", false);
        assert.deepStrictEqual(api.getDailyFocus().priorities, ["keep", "", ""]);
        const archive = JSON.parse(api._localStorage.getItem(KEYS.dailyFocus));
        assert.deepStrictEqual(archive.records[date].priorities, ["keep", "", ""]);
    });

    await check("persistDailyFocus：重新启用后恢复写入", () => {
        const api = loadReadyApi();
        const date = api.getDailyFocus().date;
        api.setModuleEnabled("daily-focus", false);
        assert.strictEqual(api.persistDailyFocus({ date, priorities: ["x", "", ""] }), false);
        api.setModuleEnabled("daily-focus", true);
        assert.strictEqual(api.persistDailyFocus({ date, priorities: ["y", "", ""] }), true);
        const archive = JSON.parse(api._localStorage.getItem(KEYS.dailyFocus));
        assert.strictEqual(archive.records[date].priorities[0], "y");
    });

    // ---- 隐式写入：底层写入函数 / 状态切换 ----
    await check("隐式写入：writeDailyFocusArchive 在停用时抛错且不写入", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.dailyFocus);
        const archive = JSON.parse(before);
        archive.records[api.getDailyFocus().date].priorities = ["hacked", "", ""];
        api.setModuleEnabled("daily-focus", false);
        assert.throws(() => api.writeDailyFocusArchive(archive, before));
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), before);
    });

    await check("隐式写入：toggleTask 在停用时被拦截，任务状态不变", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.tasks);
        api.setModuleEnabled("task-manager", false);
        api.toggleTask("t1");
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), before);
        assert.strictEqual(api.getTasks()[0].completed, false);
    });

    await check("隐式写入：deleteTask 在停用时被拦截，任务未被删除", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.tasks);
        api.setModuleEnabled("task-manager", false);
        api.deleteTask("t1");
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), before);
        assert.strictEqual(api.getTasks().length, 1);
    });

    await check("隐式写入：停用时切换日期（startDailyFocus）只读，不写 archive", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.dailyFocus);
        api.setModuleEnabled("daily-focus", false);
        const tomorrow = "2030-01-01";
        const ok = api.startDailyFocus(tomorrow);
        assert.strictEqual(ok, true, "只读下仍应允许切换查看");
        assert.strictEqual(api.getDailyFocus().date, tomorrow);
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), before, "不得写入 archive");
    });

    // ---- 父模块停用 → 子工作流写入受限 ----
    await check("父模块停用：persistIdeas 被拦截（ai-assistant 停用）", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.ideas);
        api.setModuleEnabled("ai-assistant", false);
        const r = api.persistIdeas([{ ...VALID_IDEA, id: "i9" }]);
        assert.strictEqual(r, false);
        assert.strictEqual(api._localStorage.getItem(KEYS.ideas), before);
    });

    await check("父模块停用：persistDocumentHistory 被拦截（ai-assistant 停用）", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.documents);
        api.setModuleEnabled("ai-assistant", false);
        const r = api.persistDocumentHistory([{ ...VALID_DOC, id: "d9" }]);
        assert.strictEqual(r, false);
        assert.strictEqual(api._localStorage.getItem(KEYS.documents), before);
    });

    // ============================================================
    // Task 2：AI 请求生命周期（5 条链路）
    // ============================================================
    console.log("\n=== Task 2: AI 请求生命周期 ===");

    // ---------- 2.1 AI Assistant ----------
    await check("AI Assistant：启用时可发起请求", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "hello" });
        const p = api.requestAssistantReply();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出 1 个请求");
        assert.strictEqual(api.getAiRequestPending(), true);
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "hi", model: "x" }) });
        await p;
        assert.ok(api.aiConversation.some((m) => m.role === "assistant" && m.content === "hi"));
        assert.strictEqual(api.getAiRequestPending(), false);
    });

    await check("AI Assistant：在途停用 → AbortController.abort() 触发且 loading 清理", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "again" });
        const p = api.requestAssistantReply();
        const entry = api._fetch.last();
        assert.strictEqual(entry.signal.aborted, false);
        api.setModuleEnabled("ai-assistant", false);
        api.updateAssistantAccessUI();
        assert.strictEqual(entry.signal.aborted, true, "fetch 的 signal 应被 abort");
        await p;
        assert.strictEqual(api.getAiRequestPending(), false, "loading 标志应清理");
        assert.strictEqual(api.getAiRequestController(), null, "controller 应释放");
    });

    await check("AI Assistant：迟到响应不覆盖界面", async () => {
        const api = loadReadyApi();
        api._fetch.rejectOnAbort = false;
        api.aiConversation.push({ role: "user", content: "late" });
        const p = api.requestAssistantReply();
        const before = api.aiConversation.filter((m) => m.role === "assistant").length;
        api.setModuleEnabled("ai-assistant", false);
        api.updateAssistantAccessUI();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "stale", model: "x" }) });
        await p;
        assert.strictEqual(
            api.aiConversation.filter((m) => m.role === "assistant").length,
            before,
            "迟到响应不得写入对话"
        );
        assert.strictEqual(api.getAiRequestPending(), false);
    });

    await check("AI Assistant：重新启用后可发起新请求", async () => {
        const api = loadReadyApi();
        api.setModuleEnabled("ai-assistant", false);
        api.setModuleEnabled("ai-assistant", true);
        api.aiConversation.push({ role: "user", content: "resume" });
        const p = api.requestAssistantReply();
        assert.strictEqual(api._fetch.pending.length, 1);
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "ok", model: "x" }) });
        await p;
        assert.ok(api.aiConversation.some((m) => m.role === "assistant" && m.content === "ok"));
    });

    // ---------- 2.2 Daily Planning ----------
    await check("Daily Planning：启用时可发起请求", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出请求");
        assert.strictEqual(api.getDailyPlanningPending(), true);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
        assert.strictEqual(api.getDailyPlanningPending(), false);
    });

    await check("Daily Planning：在途停用 → abort 触发且 loading 清理", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        const entry = api._fetch.last();
        api.setModuleEnabled("daily-planning", false);
        api.updateDailyPlanningAccessUI();
        assert.strictEqual(entry.signal.aborted, true);
        await p;
        assert.strictEqual(api.getDailyPlanningPending(), false);
        assert.strictEqual(api.getDailyPlanningController(), null);
    });

    await check("Daily Planning：迟到响应不写入结果", async () => {
        const api = loadReadyApi();
        api._fetch.rejectOnAbort = false;
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api.setModuleEnabled("daily-planning", false);
        api.updateDailyPlanningAccessUI();
        api._fetch.last().resolve({
            ok: true, status: 200,
            json: async () => ({
                reply: JSON.stringify({ priorities: ["stale-a", "stale-b", "stale-c"], notes: "stale" }),
                model: "x",
            }),
        });
        await p;
        assert.strictEqual(api.getDailyPlanningPending(), false);
        assert.strictEqual(api.getDailyPlanningAnalysis(), null, "迟到响应不得写入分析结果");
        assert.ok(!api.planningAIStatus.textContent.includes("stale"));
    });

    await check("Daily Planning：重新启用后可发起新请求", async () => {
        const api = loadReadyApi();
        api.setModuleEnabled("daily-planning", false);
        api.setModuleEnabled("daily-planning", true);
        const p = api.runDailyPlanningAnalysis();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
    });

    // ---------- 2.3 Task Organization ----------
    await check("Task Organization：启用时可发起请求", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "买牛奶（明天）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出请求");
        assert.strictEqual(api.getTaskOrganizerPending(), true);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
        assert.strictEqual(api.getTaskOrganizerPending(), false);
    });

    await check("Task Organization：在途停用 → abort 触发且 loading 清理", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        const entry = api._fetch.last();
        api.setModuleEnabled("task-organization", false);
        api.updateTaskOrganizationAccessUI();
        assert.strictEqual(entry.signal.aborted, true);
        await p;
        assert.strictEqual(api.getTaskOrganizerPending(), false);
        assert.strictEqual(api.getTaskOrganizerController(), null);
    });

    await check("Task Organization：迟到响应不写入预览", async () => {
        const api = loadReadyApi();
        api._fetch.rejectOnAbort = false;
        api.taskOrganizerInput.value = "整理发票（周一）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api.setModuleEnabled("task-organization", false);
        api.updateTaskOrganizationAccessUI();
        api._fetch.last().resolve({
            ok: true, status: 200,
            json: async () => ({ reply: JSON.stringify({ tasks: [{ title: "stale", priority: "high", confirmed: true }] }), model: "x" }),
        });
        await p;
        assert.strictEqual(api.getTaskOrganizerPending(), false);
        assert.ok(!api.taskOrganizerStatus.textContent.includes("已生成"), "迟到响应不得生成预览");
    });

    await check("Task Organization：重新启用后可发起新请求", async () => {
        const api = loadReadyApi();
        api.setModuleEnabled("task-organization", false);
        api.setModuleEnabled("task-organization", true);
        api.taskOrganizerInput.value = "重新整理（周三）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
    });

    // ---------- 2.4 Document Summary ----------
    await check("Document Summary：启用时可发起请求", async () => {
        const api = loadReadyApi();
        api.documentSourceInput.value = "这是一段需要整理的资料。";
        const p = api.organizeCurrentDocument();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出请求");
        assert.strictEqual(api.getDocumentPending(), true);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
        assert.strictEqual(api.getDocumentPending(), false);
    });

    await check("Document Summary：在途停用 → abort 触发且 loading 清理", async () => {
        const api = loadReadyApi();
        api.documentSourceInput.value = "待分析资料正文。";
        const p = api.organizeCurrentDocument();
        await flush();
        const entry = api._fetch.last();
        api.setModuleEnabled("document-summary", false);
        api.updateDocumentSummaryAccessUI();
        assert.strictEqual(entry.signal.aborted, true);
        await p;
        assert.strictEqual(api.getDocumentPending(), false);
        assert.strictEqual(api.getDocumentController(), null);
    });

    await check("Document Summary：迟到响应不写入结果", async () => {
        const api = loadReadyApi();
        api._fetch.rejectOnAbort = false;
        api.documentSourceInput.value = "迟延测试资料。";
        const p = api.organizeCurrentDocument();
        await flush();
        api.setModuleEnabled("document-summary", false);
        api.updateDocumentSummaryAccessUI();
        api._fetch.last().resolve({
            ok: true, status: 200,
            json: async () => ({ reply: "## 执行摘要\nstale", model: "x" }),
        });
        await p;
        assert.strictEqual(api.getDocumentPending(), false);
        assert.ok(!api.documentInputStatus.textContent.includes("AI 分析完成"), "迟到响应不得标记为完成");
    });

    await check("Document Summary：重新启用后可发起新请求", async () => {
        const api = loadReadyApi();
        api.setModuleEnabled("document-summary", false);
        api.setModuleEnabled("document-summary", true);
        api.documentSourceInput.value = "重新分析资料。";
        const p = api.organizeCurrentDocument();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
    });

    // ---------- 2.5 Ideas & Writing ----------
    await check("Ideas & Writing：启用时可发起请求", async () => {
        const api = loadReadyApi();
        const p = api.requestIdeasAI("prompt", makeElement(), makeElement(), "thinking");
        assert.strictEqual(api._fetch.pending.length, 1);
        assert.strictEqual(api.getIdeasAIRequestPending(), true);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
        assert.strictEqual(api.getIdeasAIRequestPending(), false);
    });

    await check("Ideas & Writing：在途停用 → abort 触发且 loading 清理", async () => {
        const api = loadReadyApi();
        const p = api.requestIdeasAI("prompt", makeElement(), makeElement(), "thinking");
        const entry = api._fetch.last();
        api.setModuleEnabled("ideas-writing", false);
        api.updateIdeasWritingAccessUI();
        assert.strictEqual(entry.signal.aborted, true);
        await p;
        assert.strictEqual(api.getIdeasAIRequestPending(), false);
        assert.strictEqual(api.getIdeasAIRequestController(), null);
    });

    await check("Ideas & Writing：迟到响应被丢弃（返回 null，不写入状态）", async () => {
        const api = loadReadyApi();
        api._fetch.rejectOnAbort = false;
        const status = makeElement();
        const p = api.requestIdeasAI("prompt", makeElement(), status, "thinking");
        api.setModuleEnabled("ideas-writing", false);
        api.updateIdeasWritingAccessUI();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "stale", model: "x" }) });
        const result = await p;
        assert.strictEqual(result, null, "迟到响应不得返回结果");
        assert.strictEqual(api.getIdeasAIRequestPending(), false);
        assert.ok(!status.textContent.includes("已收到 DeepSeek 结果"), "迟到响应不得更新状态文案");
    });

    await check("Ideas & Writing：重新启用后可发起新请求", async () => {
        const api = loadReadyApi();
        api.setModuleEnabled("ideas-writing", false);
        api.setModuleEnabled("ideas-writing", true);
        const p = api.requestIdeasAI("prompt", makeElement(), makeElement(), "thinking");
        assert.strictEqual(api._fetch.pending.length, 1);
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
    });

    // ---------- 2.6 父模块停用 → 四个子工作流在途请求全部中止 ----------
    await check("父停用 → 四个子工作流在途请求全部 abort（级联）", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "parent" });
        const assistantP = api.requestAssistantReply();
        const planningP = api.runDailyPlanningAnalysis();
        await flush();
        api.taskOrganizerInput.value = "父级级联测试（周四）";
        const organizerP = api.organizeTasks({ preventDefault() {} });
        await flush();
        api.documentSourceInput.value = "父级级联测试资料。";
        const documentP = api.organizeCurrentDocument();
        await flush();
        const ideasP = api.requestIdeasAI("prompt", makeElement(), makeElement(), "thinking");

        assert.ok(api._fetch.pending.length >= 5, "五条链路应各有在途请求");
        const signals = api._fetch.pending.map((e) => e.signal);
        assert.ok(signals.every((s) => s && s.aborted === false), "中止前均未 abort");

        api.setModuleEnabled("ai-assistant", false);
        api.updateModuleAccessUI();

        assert.ok(signals.every((s) => s.aborted === true), "父模块停用后所有在途请求都应被 abort");

        await Promise.all([assistantP, planningP, organizerP, documentP, ideasP]);
        assert.strictEqual(api.getAiRequestPending(), false);
        assert.strictEqual(api.getDailyPlanningPending(), false);
        assert.strictEqual(api.getTaskOrganizerPending(), false);
        assert.strictEqual(api.getDocumentPending(), false);
        assert.strictEqual(api.getIdeasAIRequestPending(), false);
    });

    await check("父停用 → 四个子工作流均为 parent-disabled（阻断新请求）", () => {
        const api = loadReadyApi();
        api.setModuleEnabled("ai-assistant", false);
        for (const id of ["daily-planning", "task-organization", "document-summary", "ideas-writing"]) {
            const a = api.getModuleAccessStatus(id);
            assert.strictEqual(a.enabled, false, `${id} 应被阻断`);
            assert.strictEqual(a.state, "parent-disabled", `${id} 应为 parent-disabled`);
        }
    });

    await check("父停用后直接调用子工作流函数也被拦截（不发请求）", async () => {
        const api = loadReadyApi();
        api.setModuleEnabled("ai-assistant", false);
        await api.requestIdeasAI("prompt", makeElement(), makeElement(), "thinking");
        api.taskOrganizerInput.value = "绕过尝试（周五）";
        await api.organizeTasks({ preventDefault() {} });
        api.documentSourceInput.value = "绕过尝试资料。";
        await api.organizeCurrentDocument();
        await api.runDailyPlanningAnalysis();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 0, "不得发出任何请求");
    });

    // ============================================================
    // Task 3：Data Center 导入边界
    // ============================================================
    console.log("\n=== Task 3: Data Center 导入边界 ===");

    await check("普通模块停用时，Data Center 全局恢复仍可执行", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        api.setModuleEnabled("quick-notes", false);
        api._localStorage.removeItem(KEYS.notes);
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.deepStrictEqual(JSON.parse(api._localStorage.getItem(KEYS.notes)), [VALID_NOTE]);
    });

    await check("全局恢复后，停用模块自身仍保持只读（不放宽限制）", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        api.setModuleEnabled("quick-notes", false);
        api._localStorage.removeItem(KEYS.notes);
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        // 数据已被恢复，但模块仍停用 → 写入仍应被拒绝
        assert.strictEqual(api.isModuleReadOnly("quick-notes"), true);
        const before = api._localStorage.getItem(KEYS.notes);
        const r = api.persistNotes([{ id: "n9", text: "should-fail", createdAt: "2026-01-01T00:00:00.000Z" }]);
        assert.strictEqual(r, false);
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), before);
    });

    await check("模块自身导入（Task Organization 导入）受停用限制", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.tasks);
        api.setModuleEnabled("task-manager", false);
        api.importOrganizedTasks();
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), before, "模块停用时不得导入任务");
        // 证明拦截来自模块守卫，而非“预览为空”分支
        assert.strictEqual(api.taskOrganizerStatus.dataset.moduleAccessBlocked, "disabled");
        assert.strictEqual(api.taskOrganizerStatus.textContent, api.MODULE_READONLY_MESSAGE);
    });

    await check("模块自身导入（停用 task-organization 而非 task-manager）同样受限", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.tasks);
        api.setModuleEnabled("task-organization", false);
        api.importOrganizedTasks();
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), before);
        assert.strictEqual(api.taskOrganizerStatus.dataset.moduleAccessBlocked, "disabled");
    });

    // ============================================================
    // Task 4：moduleSettings 备份与恢复
    // ============================================================
    console.log("\n=== Task 4: moduleSettings 备份与恢复 ===");

    await check("新版备份导出含 moduleSettings 字段", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        assert.ok("moduleSettings" in backup, "备份应包含 moduleSettings 字段");
        assert.strictEqual(backup.moduleSettings.schemaVersion, 2);
        assert.deepStrictEqual(backup.moduleSettings.enabledById, {});
    });

    await check("停用后导出备份，moduleSettings 记录停用项", () => {
        const api = loadReadyApi();
        api.setModuleEnabled("quick-notes", false);
        const backup = api.createDataCenterBackup();
        assert.deepStrictEqual(backup.moduleSettings.enabledById, { "quick-notes": false });
    });

    await check("旧版备份（无 moduleSettings 字段）导入保留当前配置", () => {
        const api = loadReadyApi();
        api.setModuleEnabled("quick-notes", false);
        const backup = api.createDataCenterBackup();
        delete backup.moduleSettings;
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.isModuleReadOnly("quick-notes"), true, "旧版备份不得清空停用配置");
    });

    await check("moduleSettings 为 null 时跳过恢复", () => {
        const api = loadReadyApi();
        api.setModuleEnabled("quick-notes", false);
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = null;
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.isModuleReadOnly("quick-notes"), true, "null 不得清空当前配置");
    });

    await check("非法配置（含受保护模块）拒绝导入且数据不动", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.notes);
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = { schemaVersion: 2, enabledById: { "data-center": false } };
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), before, "非法配置不得修改业务数据");
    });

    await check("非法配置（未知模块 ID）拒绝导入", () => {
        const api = loadReadyApi();
        const before = api._localStorage.getItem(KEYS.tasks);
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = { schemaVersion: 2, enabledById: { "no-such-module": false } };
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), before, "未知模块不得修改业务数据");
    });

    await check("正常配置恢复（备份停用 → 导入后停用）", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = { schemaVersion: 2, enabledById: { "quick-notes": false } };
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.isModuleReadOnly("quick-notes"), true, "备份中的停用应被恢复");
    });

    await check("合并语义：备份停用 + 当前停用 = 都停用（只收紧不放松）", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = { schemaVersion: 2, enabledById: { "task-manager": false } };
        api.setModuleEnabled("quick-notes", false);
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.isModuleReadOnly("quick-notes"), true, "当前停用应保留");
        assert.strictEqual(api.isModuleReadOnly("task-manager"), true, "备份停用应恢复");
    });

    await check("recovery 已有历史值 + 备份无 recovery → 不覆盖", () => {
        const api = loadReadyApi({
            [KEYS.moduleSettingsRecovery]: JSON.stringify({
                quarantinedAt: "2026-01-01T00:00:00.000Z",
                sourceKey: KEYS.moduleSettings,
                rawValue: "corrupt"
            })
        });
        const before = api._localStorage.getItem(KEYS.moduleSettingsRecovery);
        const backup = api.createDataCenterBackup();
        backup.moduleSettingsRecovery = null;
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api._localStorage.getItem(KEYS.moduleSettingsRecovery), before, "备份无 recovery 不得覆盖本地 recovery");
    });

    await check("moduleSettings 写入失败 → 回滚业务数据", () => {
        const storage = makeFailingStorage(seededStore(), "set", KEYS.moduleSettings);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = { schemaVersion: 2, enabledById: { "quick-notes": false } };
        storage.removeItem(KEYS.notes);
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(storage.getItem(KEYS.notes), null, "moduleSettings 写入失败应回滚业务数据");
    });

    await check("预导入备份生成失败 → 中止正式导入", () => {
        const normalApi = loadReadyApi();
        const backup = normalApi.createDataCenterBackup();
        const storage = makeFailingStorage(seededStore(), "get", KEYS.notes);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        const beforeTasks = storage.getItem(KEYS.tasks);
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(storage.getItem(KEYS.tasks), beforeTasks, "快照失败不得修改任何数据");
    });

    // ============================================================
    // Task 5：moduleSettingsRaw 原始数据存档
    // ============================================================
    console.log("\n=== Task 5: moduleSettingsRaw 原始数据存档 ===");

    await check("正常配置导出：raw 为 null，字段正确", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        assert.strictEqual(backup.moduleSettingsRaw, null);
        assert.strictEqual(backup.moduleSettings.schemaVersion, 2);
        assert.deepStrictEqual(backup.moduleSettings.enabledById, {});
    });

    await check("主键损坏导出：raw 原始字符串完整保留", () => {
        const corruptRaw = "{ not valid json";
        const api = loadReadyApi({ [KEYS.moduleSettings]: corruptRaw });
        const backup = api.createDataCenterBackup();
        assert.strictEqual(backup.moduleSettings, null);
        assert.strictEqual(backup.moduleSettingsRaw, corruptRaw);
    });

    await check("主键不存在：默认配置结构合法", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        assert.strictEqual(backup.moduleSettingsRaw, null);
        assert.strictEqual(backup.moduleSettings.schemaVersion, 2);
        assert.deepStrictEqual(backup.moduleSettings.enabledById, {});
    });

    await check("导出前后 localStorage 原始值完全一致（只读）", () => {
        const corruptRaw = "{ bad";
        const api = loadReadyApi({ [KEYS.moduleSettings]: corruptRaw });
        const before = api._localStorage.getItem(KEYS.moduleSettings);
        api.createDataCenterBackup();
        assert.strictEqual(api._localStorage.getItem(KEYS.moduleSettings), before, "导出不得修改 localStorage");
    });

    await check("旧版 v1 备份缺少 raw 字段仍可导入", () => {
        const api = loadReadyApi();
        api.setModuleEnabled("quick-notes", false);
        const backup = api.createDataCenterBackup();
        delete backup.moduleSettingsRaw;
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.isModuleReadOnly("quick-notes"), true);
    });

    await check("raw 为合法字符串时校验通过", () => {
        const api = loadReadyApi();
        assert.deepStrictEqual(api.validateModuleSettingsRawInBackup("{ broken"), { storageValue: "{ broken" });
    });

    await check("raw 为对象、数组或数字时拒绝", () => {
        const api = loadReadyApi();
        assert.throws(() => api.validateModuleSettingsRawInBackup({ foo: "bar" }));
        assert.throws(() => api.validateModuleSettingsRawInBackup(["x"]));
        assert.throws(() => api.validateModuleSettingsRawInBackup(123));
    });

    await check("超长 raw 字符串被拒绝", () => {
        const api = loadReadyApi();
        assert.throws(() => api.validateModuleSettingsRawInBackup("x".repeat(100001)));
    });

    await check("导入含 raw 的备份时，raw 不写入正常主键", () => {
        const corruptRaw = "{ bad raw";
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        backup.moduleSettingsRaw = corruptRaw;
        backup.moduleSettings = { schemaVersion: 2, enabledById: {} };
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        const stored = api._localStorage.getItem(KEYS.moduleSettings);
        assert.ok(stored !== corruptRaw, "raw 不得写入主键");
        assert.strictEqual(JSON.parse(stored).schemaVersion, 2, "主键应为合法配置");
    });

    await check("raw 不自动写入 recovery 键", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        backup.moduleSettingsRaw = "{ bad raw";
        backup.moduleSettingsRecovery = null;
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api._localStorage.getItem(KEYS.moduleSettingsRecovery), null, "raw 不得写入 recovery 键");
    });

    await check("预览明确显示原始数据存档提示", async () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        backup.moduleSettingsRaw = "{ bad raw";
        const fakeFile = { size: 100, text: async () => JSON.stringify(backup) };
        await api.previewDataCenterImport(fakeFile);
        const texts = api.dataCenterPreviewList.children.map((c) => c.textContent);
        assert.ok(texts.some((t) => t.includes("原始数据")), "预览应显示原始数据存档提示");
    });

    // ============================================================
    // Task 6：恢复失败锁定机制（第一阶段）
    // ============================================================
    console.log("\n=== Task 6: 恢复失败锁定机制 ===");

    const RECOVERY_MARK = (keys = []) => JSON.stringify({
        state: "recovery-required",
        createdAt: "2026-01-01T00:00:00.000Z",
        failedKeys: keys,
        backupFormat: "my-tech-lab-backup",
        backupVersion: 1
    });

    await check("正常启动无锁定标记 → 不锁定", () => {
        const api = loadReadyApi();
        api.checkDataCenterRecoveryFailureOnStartup();
        assert.strictEqual(api.getRecoveryLocked(), false);
        assert.strictEqual(api.isDataCenterRecoveryLocked(), false);
    });

    await check("启动发现有效锁定标记 → 锁定且 failedKeys 正确", () => {
        const api = loadReadyApi({ [KEYS.recoveryFailed]: RECOVERY_MARK(["模块设置"]) });
        api.checkDataCenterRecoveryFailureOnStartup();
        assert.strictEqual(api.getRecoveryLocked(), true);
        assert.deepStrictEqual(api.getRecoveryFailedKeys(), ["模块设置"]);
    });

    await check("锁定标记损坏 → fail-closed 锁定", () => {
        const api = loadReadyApi({ [KEYS.recoveryFailed]: "{ bad json" });
        api.checkDataCenterRecoveryFailureOnStartup();
        assert.strictEqual(api.isDataCenterRecoveryLocked(), true);
    });

    await check("锁定标记读取失败 → fail-closed 锁定", () => {
        const storage = makeFailingStorage(seededStore(), "get", KEYS.recoveryFailed);
        const api = loadApi({ localStorage: storage });
        api.checkDataCenterRecoveryFailureOnStartup();
        assert.strictEqual(api.isDataCenterRecoveryLocked(), true);
    });

    await check("锁定期间五个业务模块写入被拦截", () => {
        const api = loadReadyApi();
        api.lockDataCenterForRecoveryFailure(["test"]);
        assert.strictEqual(api.persistNotes([{ id: "n", text: "t", createdAt: "2026-01-01T00:00:00.000Z" }]), false);
        assert.strictEqual(api.persistTasks([{ id: "t", text: "x", priority: "medium", completed: false, createdAt: "2026-01-01T00:00:00.000Z" }]), false);
        assert.strictEqual(api.persistIdeas([{ id: "i", title: "t", content: "c", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]), false);
        assert.strictEqual(api.persistDocumentHistory([VALID_DOC]), false);
        assert.strictEqual(api.persistDailyFocus({ date: "2026-01-01", priorities: ["a", "", ""] }), false);
    });

    await check("锁定期间 Daily Focus 首次初始化不写入", () => {
        const seed = { ...seededStore() };
        delete seed[KEYS.dailyFocus];
        seed[KEYS.recoveryFailed] = RECOVERY_MARK([]);
        const api = loadApi({ seed });
        api.loadDailyFocus();
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), null, "锁定期间不得首次初始化写入");
    });

    await check("锁定期间 setModuleEnabled 被拦截", () => {
        const api = loadReadyApi();
        api.lockDataCenterForRecoveryFailure(["x"]);
        const before = api._localStorage.getItem(KEYS.moduleSettings);
        const result = api.setModuleEnabled("quick-notes", false);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.state, "recovery-locked");
        assert.strictEqual(api._localStorage.getItem(KEYS.moduleSettings), before, "锁定期间不得写 moduleSettings");
    });

    await check("锁定期间普通导入与清空被拦截", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        api.lockDataCenterForRecoveryFailure(["x"]);
        const beforeNotes = api._localStorage.getItem(KEYS.notes);
        api._localStorage.removeItem(KEYS.notes);
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), null, "锁定期间普通导入不得恢复数据");
        api._localStorage.setItem(KEYS.notes, beforeNotes);
        api.confirmDataCenterClear();
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), beforeNotes, "锁定期间不得清空");
    });

    await check("解锁后模块停用机制继续有效", () => {
        const api = loadReadyApi();
        api.setModuleEnabled("quick-notes", false);
        assert.strictEqual(api.persistNotes([{ id: "n", text: "t", createdAt: "2026-01-01T00:00:00.000Z" }]), false, "停用后写入应被拒");
        api.lockDataCenterForRecoveryFailure(["x"]);
        assert.strictEqual(api.clearDataCenterRecoveryFailure(), true);
        assert.strictEqual(api.persistNotes([{ id: "n", text: "t", createdAt: "2026-01-01T00:00:00.000Z" }]), false, "解锁后停用仍应生效");
    });

    await check("多标签页：标记键变化后 isDataCenterRecoveryLocked 重新读取", () => {
        const api = loadReadyApi();
        assert.strictEqual(api.isDataCenterRecoveryLocked(), false);
        api._localStorage.setItem(KEYS.recoveryFailed, RECOVERY_MARK(["a"]));
        assert.strictEqual(api.isDataCenterRecoveryLocked(), true, "他标签写入标记后应锁定");
        api._localStorage.removeItem(KEYS.recoveryFailed);
        assert.strictEqual(api.isDataCenterRecoveryLocked(), false, "他标签清除标记后应解锁");
    });

    await check("刷新后锁定状态仍然存在", () => {
        const api = loadReadyApi();
        api.lockDataCenterForRecoveryFailure(["x"]);
        const api2 = loadApi({ localStorage: api._localStorage });
        api2.checkDataCenterRecoveryFailureOnStartup();
        assert.strictEqual(api2.isDataCenterRecoveryLocked(), true, "持久化标记应在刷新后仍生效");
    });

    const dateKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    await check("lockDataCenterForRecoveryFailure setItem 失败 → 内存锁仍设置", () => {
        const storage = makeFailingStorage(seededStore(), "set", KEYS.recoveryFailed);
        const api = loadApi({ localStorage: storage });
        const result = api.lockDataCenterForRecoveryFailure(["x"]);
        assert.strictEqual(result, false, "setItem 失败应返回 false");
        assert.strictEqual(api.getRecoveryLocked(), true, "setItem 失败仍应设置内存锁");
    });

    await check("锁定期间 Daily Focus 旧格式迁移不写入", () => {
        const today = new Date();
        const legacy = JSON.stringify({ date: dateKeyOf(today), priorities: ["a", "b", "c"] });
        const seed = { ...seededStore() };
        seed[KEYS.dailyFocus] = legacy;
        seed[KEYS.recoveryFailed] = RECOVERY_MARK([]);
        const api = loadApi({ seed });
        api.loadDailyFocus();
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), legacy, "锁定期间不得迁移旧格式");
    });

    await check("锁定期间 Daily Focus 日期切换不写入", () => {
        const today = new Date();
        const yesterday = new Date(today.getTime() - 86400000);
        const todayKey = dateKeyOf(today);
        const yesterdayKey = dateKeyOf(yesterday);
        const archive = JSON.stringify({
            schemaVersion: 1,
            activeDate: yesterdayKey,
            records: { [yesterdayKey]: { priorities: ["old", "", ""] } }
        });
        const seed = { ...seededStore() };
        seed[KEYS.dailyFocus] = archive;
        seed[KEYS.recoveryFailed] = RECOVERY_MARK([]);
        const api = loadApi({ seed });
        api.startDailyFocus(todayKey);
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), archive, "锁定期间不得日期切换写入");
    });

    // ============================================================
    // Task 7：runDataCenterRecoveryTransaction 事务
    // ============================================================
    console.log("\n=== Task 7: runDataCenterRecoveryTransaction 事务 ===");

    await check("事务成功：数据恢复", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        const result = api.runDataCenterRecoveryTransaction(backup);
        assert.strictEqual(result.ok, true);
        assert.deepStrictEqual(JSON.parse(api._localStorage.getItem(KEYS.notes)), [VALID_NOTE]);
    });

    await check("事务校验失败：phase 为 validate", () => {
        const api = loadReadyApi();
        const result = api.runDataCenterRecoveryTransaction({ format: "bad", version: 1 });
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.phase, "validate");
    });

    await check("事务快照失败：phase 为 snapshot", () => {
        const normalApi = loadReadyApi();
        const backup = normalApi.createDataCenterBackup();
        const storage = makeFailingStorage(seededStore(), "get", KEYS.notes);
        const api = loadApi({ localStorage: storage });
        const result = api.runDataCenterRecoveryTransaction(backup);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.phase, "snapshot");
    });

    await check("事务写入失败 + 回滚成功", () => {
        const storage = makeFailingStorage(seededStore(), "set", KEYS.moduleSettings);
        const api = loadApi({ localStorage: storage });
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = { schemaVersion: 2, enabledById: { "quick-notes": false } };
        const result = api.runDataCenterRecoveryTransaction(backup);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.phase, "write");
        assert.strictEqual(result.rollbackErrors.length, 0, "回滚应成功");
    });

    await check("事务写入失败 + 回滚失败", () => {
        const storage = makeFailingStorage(seededStore(), "set", KEYS.notes);
        const api = loadApi({ localStorage: storage });
        const backup = api.createDataCenterBackup();
        const result = api.runDataCenterRecoveryTransaction(backup);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.phase, "write");
        assert.ok(result.rollbackErrors.length > 0, "回滚应失败并记录键");
    });

    await check("普通导入回滚成功不进入锁定", () => {
        const storage = makeFailingStorage(seededStore(), "set", KEYS.moduleSettings);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        const backup = api.createDataCenterBackup();
        backup.moduleSettings = { schemaVersion: 2, enabledById: { "quick-notes": false } };
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.getRecoveryLocked(), false, "回滚成功不得进入锁定");
        assert.strictEqual(api._localStorage.getItem(KEYS.recoveryFailed), null, "不得写锁定标记");
    });

    await check("普通导入回滚失败进入锁定且标记含失败信息", () => {
        const storage = makeFailingStorage(seededStore(), "set", KEYS.notes);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.getRecoveryLocked(), true, "回滚失败应进入锁定");
        assert.ok(api._localStorage.getItem(KEYS.recoveryFailed) !== null, "应写锁定标记");
        assert.ok(api.getRecoveryFailedKeys().some((k) => k.includes("Quick Notes")), "标记应包含失败键");
    });

    await check("锁定标记写入失败时当前会话仍锁定", () => {
        const base = makeStorage(seededStore());
        const storage = {
            getItem: (k) => base.getItem(k),
            removeItem: (k) => base.removeItem(k),
            setItem: (k, v) => {
                if (k === KEYS.notes || k === KEYS.recoveryFailed) throw new Error("mock set failure");
                base.setItem(k, v);
            },
            _store: base._store,
        };
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api.getRecoveryLocked(), true, "标记写入失败仍应保持内存锁");
    });

    // ============================================================
    // Task 8：confirmDataCenterRecovery 专用恢复入口
    // ============================================================
    console.log("\n=== Task 8: confirmDataCenterRecovery 专用恢复入口 ===");

    await check("未锁定时专用恢复被拒绝", () => {
        const api = loadReadyApi();
        const beforeNotes = api._localStorage.getItem(KEYS.notes);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), beforeNotes, "未锁定不得执行恢复");
        assert.strictEqual(api.getRecoveryLocked(), false);
    });

    await check("锁定时普通导入仍被拒绝", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const beforeNotes = api._localStorage.getItem(KEYS.notes);
        api._localStorage.removeItem(KEYS.notes);
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterImport();
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), null, "锁定不得普通导入");
    });

    await check("锁定时专用恢复成功并解锁", () => {
        const api = loadReadyApi();
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api.getRecoveryLocked(), false, "恢复成功应解锁");
        assert.strictEqual(api._localStorage.getItem(KEYS.recoveryFailed), null, "标记应被清除");
        assert.deepStrictEqual(JSON.parse(api._localStorage.getItem(KEYS.notes)), [VALID_NOTE], "数据应恢复");
    });

    await check("恢复事务失败保留原始 failedKeys 并追加本次失败", () => {
        const storage = makeFailingStorage(seededStore(), "set", KEYS.notes);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api.getRecoveryLocked(), true, "恢复失败应保持锁定");
        const keys = api.getRecoveryFailedKeys();
        assert.ok(keys.includes("原始失败"), "应保留原始失败键");
        assert.ok(keys.some((k) => k.includes("恢复失败")), "应记录本次恢复失败");
    });

    await check("恢复标记删除失败时保持锁定", () => {
        const storage = makeFailingStorage(seededStore(), "remove", KEYS.recoveryFailed);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api.getRecoveryLocked(), true, "标记删除失败应保持锁定");
    });

    await check("删除后再次读取仍有值时保持锁定", () => {
        const base = makeStorage(seededStore());
        const storage = {
            getItem: (k) => base.getItem(k),
            setItem: (k, v) => base.setItem(k, v),
            removeItem: (k) => { if (k !== KEYS.recoveryFailed) base.removeItem(k); },
            _store: base._store,
        };
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api.getRecoveryLocked(), true, "删除后仍有值应保持锁定");
    });

    await check("恢复快照格式被专用恢复拒绝", () => {
        const api = loadReadyApi();
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const backup = api.createDataCenterBackup();
        backup.format = "my-tech-lab-recovery-snapshot";
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api.getRecoveryLocked(), true, "快照格式不得作为恢复输入");
    });

    await check("恢复失败标记更新失败时当前会话仍锁定", () => {
        const base = makeStorage(seededStore());
        let recoverySetCount = 0;
        const storage = {
            getItem: (k) => base.getItem(k),
            removeItem: (k) => base.removeItem(k),
            setItem: (k, v) => {
                if (k === KEYS.notes) throw new Error("mock notes set failure");
                if (k === KEYS.recoveryFailed) {
                    recoverySetCount += 1;
                    if (recoverySetCount > 1) throw new Error("mock recovery set failure");
                }
                base.setItem(k, v);
            },
            _store: base._store,
        };
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api.getRecoveryLocked(), true, "标记更新失败应保持内存锁");
    });

    await check("标记清除后 getItem 抛异常时保持锁定", () => {
        const base = makeStorage(seededStore());
        let getThrows = false;
        const storage = {
            getItem: (k) => {
                if (getThrows && k === KEYS.recoveryFailed) throw new Error("mock get failure after remove");
                return base.getItem(k);
            },
            setItem: (k, v) => base.setItem(k, v),
            removeItem: (k) => base.removeItem(k),
            _store: base._store,
        };
        const api = loadApi({ localStorage: storage });
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        assert.strictEqual(api.getRecoveryLocked(), true, "前置锁定应生效");
        getThrows = true;
        const cleared = api.clearDataCenterRecoveryFailure();
        assert.strictEqual(cleared, false, "getItem 抛错应导致清除失败");
        assert.strictEqual(api.getRecoveryLocked(), true, "应保持锁定");
    });

    await check("恢复失败保留原始 createdAt 并更新 lastFailureAt", () => {
        const originalCreatedAt = "2026-01-01T00:00:00.000Z";
        const initial = {
            ...seededStore(),
            [KEYS.recoveryFailed]: JSON.stringify({
                state: "recovery-required",
                createdAt: originalCreatedAt,
                failedKeys: ["原始失败"],
                backupFormat: "my-tech-lab-backup",
                backupVersion: 1,
            }),
        };
        const storage = makeFailingStorage(initial, "set", KEYS.notes);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        const backup = api.createDataCenterBackup();
        api.setDataCenterPendingBackup(backup);
        api.confirmDataCenterRecovery();
        assert.strictEqual(api.getRecoveryLocked(), true, "恢复失败应保持锁定");
        const marker = JSON.parse(api._localStorage.getItem(KEYS.recoveryFailed));
        assert.strictEqual(marker.createdAt, originalCreatedAt, "原始 createdAt 应保持不变");
        assert.ok(typeof marker.lastFailureAt === "string" && marker.lastFailureAt.length > 0, "lastFailureAt 应存在");
        assert.notStrictEqual(marker.lastFailureAt, originalCreatedAt, "lastFailureAt 应为本次失败时间");
        const keys = api.getRecoveryFailedKeys();
        assert.ok(keys.includes("原始失败"), "原始 failedKeys 应保留");
        assert.ok(keys.some((k) => k.includes("恢复失败")), "应追加本次失败信息");
    });

    // ============================================================
    // Task 9：恢复快照（Recovery Snapshot）
    // ============================================================
    console.log("\n=== Task 9: 恢复快照 ===");

    await check("锁定状态下恢复快照使用独立 format 并保留各键原始字符串", () => {
        const api = loadReadyApi({ [KEYS.moduleSettings]: JSON.stringify({ schemaVersion: 2, enabledById: { "quick-notes": false } }) });
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const snapshot = api.createDataCenterRecoverySnapshot();
        assert.strictEqual(snapshot.format, "my-tech-lab-recovery-snapshot", "应使用独立快照格式");
        assert.strictEqual(snapshot.snapshotType, "recovery-snapshot");
        assert.strictEqual(snapshot.readStatus, "complete");
        // 五个业务模块原始字符串保留
        assert.strictEqual(snapshot.modules.length, 5);
        for (const module of api.dataCenterModules) {
            const entry = snapshot.modules.find((m) => m.moduleId === module.id);
            assert.ok(entry, `应包含模块 ${module.id}`);
            assert.strictEqual(entry.readStatus, "success");
            assert.strictEqual(entry.storageValue, api._localStorage.getItem(module.key), `${module.id} 原始字符串应保留`);
        }
        // moduleSettings 原始值保留（非规范化对象）
        assert.strictEqual(snapshot.moduleSettings.readStatus, "success");
        assert.strictEqual(snapshot.moduleSettings.storageValue, api._localStorage.getItem(KEYS.moduleSettings));
        // 恢复失败标记保留
        assert.strictEqual(snapshot.recoveryFailure.readStatus, "success");
        assert.strictEqual(snapshot.recoveryFailure.present, true);
        assert.ok(snapshot.recoveryFailure.storageValue, "应保留恢复失败标记原始内容");
    });

    await check("恢复快照中缺失键标记为 missing", () => {
        const api = loadReadyApi();
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const snapshot = api.createDataCenterRecoverySnapshot();
        assert.strictEqual(snapshot.moduleSettings.readStatus, "missing");
        assert.strictEqual(snapshot.moduleSettings.present, false);
        assert.strictEqual(snapshot.moduleSettingsRecovery.readStatus, "missing");
        assert.strictEqual(snapshot.moduleSettingsRecovery.present, false);
    });

    await check("恢复快照读取异常标记为 error 且 consistencyWarning 反映不完整", () => {
        const storage = makeFailingStorage(seededStore(), "get", KEYS.documents);
        const api = loadApi({ localStorage: storage });
        api.loadDailyFocus();
        api.loadNotes();
        api.loadIdeas();
        api.loadDocumentHistory();
        api.loadTasks();
        api.refreshDailyPlanning(false);
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const snapshot = api.createDataCenterRecoverySnapshot();
        const docEntry = snapshot.modules.find((m) => m.moduleId === "document-summaries");
        assert.strictEqual(docEntry.readStatus, "error", "读取异常应标记为 error");
        assert.strictEqual(docEntry.present, false);
        assert.strictEqual(docEntry.storageValue, null, "读取异常不得伪装成字符串");
        assert.strictEqual(snapshot.readStatus, "incomplete");
        assert.ok(snapshot.consistencyWarning.includes("读取失败"), "consistencyWarning 应反映不完整");
    });

    await check("恢复快照导出不改变 localStorage 与内存锁状态", () => {
        const api = loadReadyApi({ [KEYS.moduleSettings]: JSON.stringify({ schemaVersion: 2, enabledById: {} }) });
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const keys = api.dataCenterModules.map((m) => m.key).concat([KEYS.moduleSettings, KEYS.moduleSettingsRecovery, KEYS.recoveryFailed]);
        const before = {};
        for (const k of keys) before[k] = api._localStorage.getItem(k);
        const lockedBefore = api.getRecoveryLocked();
        api.createDataCenterRecoverySnapshot();
        for (const k of keys) {
            assert.strictEqual(api._localStorage.getItem(k), before[k], `导出不应改变 ${k}`);
        }
        assert.strictEqual(api.getRecoveryLocked(), lockedBefore, "导出不应改变内存锁状态");
    });

    await check("普通备份仍使用原格式", () => {
        const api = loadReadyApi();
        const backup = api.createDataCenterBackup();
        assert.strictEqual(backup.format, "my-tech-lab-backup", "普通备份格式不变");
    });

    await check("普通导入拒绝恢复快照", () => {
        const api = loadReadyApi();
        const snapshot = api.createDataCenterRecoverySnapshot();
        assert.throws(() => api.validateDataCenterBackup(snapshot), /格式或版本/, "校验器应拒绝快照格式");
        const beforeNotes = api._localStorage.getItem(KEYS.notes);
        api.setDataCenterPendingBackup(snapshot);
        api.confirmDataCenterImport();
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), beforeNotes, "普通导入不应执行快照");
    });

    await check("moduleSettingsRecovery 原始状态保留（损坏时 valid=false）", () => {
        const api = loadReadyApi({ [KEYS.moduleSettingsRecovery]: "{ bad json" });
        api.lockDataCenterForRecoveryFailure(["原始失败"]);
        const snapshot = api.createDataCenterRecoverySnapshot();
        assert.strictEqual(snapshot.moduleSettingsRecovery.readStatus, "success");
        assert.strictEqual(snapshot.moduleSettingsRecovery.present, true);
        assert.strictEqual(snapshot.moduleSettingsRecovery.valid, false, "损坏数据应标记 valid=false");
        assert.strictEqual(snapshot.moduleSettingsRecovery.storageValue, "{ bad json", "应保留原始字节");
    });

    // ============================================================
    // Task 10：AI 任务整理 — 选择性导入
    // ============================================================
    console.log("\n=== Task 10: AI 任务整理选择性导入 ===");

    function buildTaskOrganizerPreview(api, items) {
        const list = api.taskPreviewList;
        list.replaceChildren();
        const mkInput = (cls, type, value) => {
            const el = api._document.createElement("input");
            el.className = cls;
            if (type) el.type = type;
            el.value = value === undefined ? "" : value;
            return el;
        };
        for (const it of items) {
            const item = api._document.createElement("li");
            item.className = "task-preview-item";
            const checkbox = mkInput("task-preview-confirm-checkbox", "checkbox", "");
            checkbox.checked = !!it.checked;
            item.append(
                mkInput("task-preview-name", "text", it.title),
                mkInput("task-preview-content", "", it.content || ""),
                mkInput("task-preview-priority", "select", it.priority || "medium"),
                mkInput("task-preview-date", "date", it.date || ""),
                mkInput("task-preview-date", "time", it.time || ""),
                checkbox
            );
            list.appendChild(item);
        }
        return list;
    }

    await check("未勾选任何项时导入按钮禁用", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "[]" });
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A" }, { title: "B" }]);
        api.updateTaskImportButton();
        assert.strictEqual(api.taskImportButton.disabled, true, "未勾选应禁用按钮");
    });

    await check("勾选一项时按钮启用且仅导入该项", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "[]" });
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A", checked: true }, { title: "B" }]);
        api.updateTaskImportButton();
        assert.strictEqual(api.taskImportButton.disabled, false, "勾选一项应启用按钮");
        api.importOrganizedTasks();
        const tasks = JSON.parse(api._localStorage.getItem(KEYS.tasks));
        assert.strictEqual(tasks.length, 1, "应只导入 1 项");
        assert.ok(tasks[0].text.includes("A"), "导入项应为 A");
        assert.strictEqual(api.taskPreviewList.querySelectorAll(".task-preview-item").length, 1, "剩余 1 项");
    });

    await check("勾选两项只导入这两项，未勾选项不进入正式列表", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "[]" });
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A", checked: true }, { title: "B", checked: true }, { title: "C" }]);
        api.importOrganizedTasks();
        const tasks = JSON.parse(api._localStorage.getItem(KEYS.tasks));
        assert.strictEqual(tasks.length, 2, "应导入 2 项");
        assert.ok(tasks.some((t) => t.text.includes("A")) && tasks.some((t) => t.text.includes("B")));
        assert.ok(!tasks.some((t) => t.text.includes("C")), "未勾选项 C 不应写入");
        assert.strictEqual(api.taskPreviewList.querySelectorAll(".task-preview-item").length, 1, "剩余 C 项");
    });

    await check("剩余未勾选项可再次勾选并导入，全部导入后结束预览", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "[]" });
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A", checked: true }, { title: "B" }]);
        api.importOrganizedTasks();
        const remaining = api.taskPreviewList.querySelectorAll(".task-preview-item");
        assert.strictEqual(remaining.length, 1, "剩余 1 项 B");
        remaining[0].querySelector(".task-preview-confirm-checkbox").checked = true;
        api.updateTaskImportButton();
        assert.strictEqual(api.taskImportButton.disabled, false, "剩余项勾选后应启用按钮");
        api.importOrganizedTasks();
        const tasks = JSON.parse(api._localStorage.getItem(KEYS.tasks));
        assert.strictEqual(tasks.length, 2, "两次共导入 2 项");
        assert.strictEqual(api.taskPreviewList.querySelectorAll(".task-preview-item").length, 0, "全部导入后预览为空");
        assert.strictEqual(api.taskOrganizerPreview.hidden, true, "全部导入后预览结束");
    });

    await check("日期有值、时间为空仍可导入", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "[]" });
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A", checked: true, date: "2026-11-05", time: "" }]);
        api.updateTaskImportButton();
        assert.strictEqual(api.taskImportButton.disabled, false, "日期有值、时间为空不应禁用按钮");
        api.importOrganizedTasks();
        const tasks = JSON.parse(api._localStorage.getItem(KEYS.tasks));
        assert.strictEqual(tasks.length, 1);
        assert.ok(tasks[0].text.includes("截止: 2026-11-05"), "应含日期后缀且无时间");
    });

    await check("重复任务去重仍有效且不移除预览项", () => {
        const api = loadReadyApi({ [KEYS.tasks]: JSON.stringify([{ id: "t0", text: "A", priority: "medium", completed: false, createdAt: "2026-01-01T00:00:00.000Z" }]) });
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A", checked: true }]);
        api.importOrganizedTasks();
        const tasks = JSON.parse(api._localStorage.getItem(KEYS.tasks));
        assert.strictEqual(tasks.length, 1, "重复任务不应重复导入");
        assert.strictEqual(api.taskPreviewList.querySelectorAll(".task-preview-item").length, 1, "去重失败应保留预览项");
    });

    await check("保存失败时不丢失预览项", () => {
        const localStorage = makeFailingStorage({ [KEYS.tasks]: "[]" }, "set", KEYS.tasks);
        const api = loadApi({ localStorage });
        api.loadTasks();
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A", checked: true }, { title: "B" }]);
        api.importOrganizedTasks();
        assert.strictEqual(api.taskPreviewList.querySelectorAll(".task-preview-item").length, 2, "保存失败不应移除预览项");
        assert.strictEqual(api.taskImportButton.disabled, false, "失败后按钮恢复可点");
    });

    await check("勾选提示与按钮状态同步", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "[]" });
        api.setTaskOrganizerPreviewActive("abc");
        buildTaskOrganizerPreview(api, [{ title: "A" }, { title: "B" }]);
        api.updateTaskImportSelectionHint();
        assert.ok(api.taskOrganizerStatus.textContent.includes("请选择"), "未勾选应提示请选择");
        api.taskPreviewList.querySelectorAll(".task-preview-item")[0].querySelector(".task-preview-confirm-checkbox").checked = true;
        api.updateTaskImportSelectionHint();
        assert.ok(api.taskOrganizerStatus.textContent.includes("已选择 1 项"), "勾选 1 项应提示已选择 1 项");
    });

    // ============================================================
    // Task 10 补充：编辑预览项后自动取消确认
    // ============================================================
    console.log("\n=== Task 10 补充: 编辑预览项取消确认 ===");

    const previewTaskFixture = (overrides = {}) => ({
        title: "任务 A",
        content: "",
        priority: "medium",
        prioritySource: "default",
        priorityEvidence: "",
        category: "",
        dueDate: "",
        dueTime: "",
        dateEvidence: "",
        timeEvidence: "",
        sourceExcerpt: "任务 A",
        needsConfirmation: true,
        confirmationReason: "原文未明确优先级，按默认值预览",
        ...overrides
    });

    await check("编辑任一预览字段后自动取消该项确认，且不影响其他项", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "[]" });
        api.setTaskOrganizerPreviewActive("abc");
        const item1 = api.createTaskPreviewItem(previewTaskFixture(), 0);
        const item2 = api.createTaskPreviewItem(previewTaskFixture({ title: "任务 B", sourceExcerpt: "任务 B" }), 1);
        api.taskPreviewList.append(item1, item2);

        const checkbox1 = item1.querySelector(".task-preview-confirm-checkbox");
        const checkbox2 = item2.querySelector(".task-preview-confirm-checkbox");
        assert.strictEqual(checkbox1.checked, false, "真实预览项初始应为未勾选");
        assert.strictEqual(checkbox2.checked, false, "真实预览项初始应为未勾选");

        checkbox1.checked = true;
        checkbox2.checked = true;
        api.updateTaskImportButton();
        assert.strictEqual(api.taskImportButton.disabled, false, "两项勾选后应可导入");

        const editableSelectors = [
            ".task-preview-name",
            ".task-preview-content",
            ".task-preview-priority",
            ".task-preview-category",
            'input[type="date"]',
            'input[type="time"]'
        ];

        editableSelectors.forEach((selector) => {
            checkbox1.checked = true;
            item1.querySelector(selector).dispatchEvent({ type: "input" });
            assert.strictEqual(checkbox1.checked, false, `${selector} 编辑后应取消确认`);
            assert.strictEqual(checkbox2.checked, true, `${selector} 编辑不应影响未编辑的其他项`);
        });

        // 下拉框通过 change 事件触发，同样应取消确认
        checkbox1.checked = true;
        item1.querySelector(".task-preview-priority").dispatchEvent({ type: "change" });
        assert.strictEqual(checkbox1.checked, false, "优先级 change 后应取消确认");
        assert.strictEqual(checkbox2.checked, true, "change 不应影响其他项");

        // 重新勾选后仍可正常导入
        checkbox1.checked = true;
        api.updateTaskImportButton();
        assert.strictEqual(api.taskImportButton.disabled, false, "重新勾选后按钮应可用");
        api.importOrganizedTasks();
        const imported = JSON.parse(api._localStorage.getItem(KEYS.tasks));
        assert.strictEqual(imported.length, 2, "重新勾选后两项均应导入");
        assert.ok(imported.some((task) => task.text === "任务 A"), "应导入任务 A");
        assert.ok(imported.some((task) => task.text === "任务 B"), "应导入任务 B");
        assert.strictEqual(api.taskPreviewList.querySelectorAll(".task-preview-item").length, 0, "导入后预览应清空");
    });

    // ============================================================
    // Task 12：导入后刷新恢复 Pending 状态
    // ============================================================
    console.log("\n=== Task 12: 刷新后 Pending 恢复 ===");

    await check("导入任务写入存储，刷新重启后恢复为 Pending 且不重复、不影响 Completed", () => {
        const completedSeed = {
            id: "c1",
            text: "已完成的历史任务",
            priority: "low",
            completed: true,
            createdAt: "2026-01-01T00:00:00.000Z"
        };
        const api1 = loadReadyApi({ [KEYS.tasks]: JSON.stringify([completedSeed]) });
        api1.setTaskOrganizerPreviewActive("刷新测试输入");
        buildTaskOrganizerPreview(api1, [{ title: "导入任务 A", checked: true }]);
        api1.importOrganizedTasks();

        const storedRaw = api1._localStorage.getItem(KEYS.tasks);
        const storedTasks = JSON.parse(storedRaw);
        assert.strictEqual(storedTasks.length, 2, "存储中应为原 1 条 + 导入 1 条");
        const storedImported = storedTasks.find((task) => task.text.includes("导入任务 A"));
        assert.ok(storedImported, "导入任务应写入存储");
        assert.strictEqual(storedImported.completed, false, "导入任务应标记为未完成");
        assert.strictEqual(storedImported.priority, "medium", "导入任务优先级应保留");

        // 模拟页面刷新：新建独立环境，仅复用同一份存储内容，按页面真实初始化顺序重新加载
        const api2 = loadApi({ seed: { ...seededStore(), [KEYS.tasks]: storedRaw } });
        api2.loadDailyFocus();
        api2.loadNotes();
        api2.loadIdeas();
        api2.loadDocumentHistory();
        api2.loadTasks();
        api2.refreshDailyPlanning(false);
        const reloaded = api2.getTasks();
        assert.strictEqual(reloaded.length, 2, "刷新后任务数量应一致，不产生重复");
        const pending = reloaded.filter((task) => !task.completed);
        const completed = reloaded.filter((task) => task.completed);
        assert.strictEqual(pending.length, 1, "导入任务应出现在 Pending 列表");
        assert.ok(pending[0].text.includes("导入任务 A"), "Pending 列表应包含导入任务");
        assert.strictEqual(completed.length, 1, "原有 Completed 任务应保持完成状态");
        assert.strictEqual(completed[0].id, "c1", "Completed 任务不应被替换");
        const ids = reloaded.map((task) => task.id);
        assert.strictEqual(new Set(ids).size, ids.length, "任务 id 不应重复");

        // 再次执行 loadTasks 应保持幂等，不复制任务
        api2.loadTasks();
        assert.strictEqual(api2.getTasks().length, 2, "重复初始化不应产生重复任务");
    });

    // ============================================================
    // Task 11：Task Manager 优先级修改
    // ============================================================
    console.log("\n=== Task 11: Task Manager 优先级修改 ===");

    const priorityTaskSeed = [
        { id: "t1", text: "Task One", priority: "high", completed: false, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "t2", text: "Task Two", priority: "medium", completed: false, createdAt: "2026-01-02T00:00:00.000Z" },
        { id: "t3", text: "Task Three", priority: "low", completed: true, createdAt: "2026-01-03T00:00:00.000Z" },
    ];
    const priorityApi = (extraSeed = {}) => loadReadyApi({ [KEYS.tasks]: JSON.stringify(priorityTaskSeed), ...extraSeed });
    const getTask = (api, id) => JSON.parse(api._localStorage.getItem(KEYS.tasks)).find((t) => t.id === id);

    await check("High → Medium 只更新目标任务且字段完整保留", () => {
        const api = priorityApi();
        api.changeTaskPriority("t1", "medium");
        const t1 = getTask(api, "t1");
        assert.strictEqual(t1.priority, "medium");
        assert.strictEqual(t1.text, "Task One", "text 保留");
        assert.strictEqual(t1.completed, false, "completed 保留");
        assert.strictEqual(t1.createdAt, "2026-01-01T00:00:00.000Z", "createdAt 保留");
    });

    await check("Medium → Low", () => {
        const api = priorityApi();
        api.changeTaskPriority("t2", "low");
        assert.strictEqual(getTask(api, "t2").priority, "low");
    });

    await check("Low → High（Completed 任务）", () => {
        const api = priorityApi();
        api.changeTaskPriority("t3", "high");
        const t3 = getTask(api, "t3");
        assert.strictEqual(t3.priority, "high");
        assert.strictEqual(t3.completed, true, "completed 保留");
    });

    await check("只更新目标任务，其他任务不变", () => {
        const api = priorityApi();
        api.changeTaskPriority("t1", "low");
        const tasks = JSON.parse(api._localStorage.getItem(KEYS.tasks));
        assert.strictEqual(tasks.find((t) => t.id === "t2").priority, "medium", "t2 不变");
        assert.strictEqual(tasks.find((t) => t.id === "t3").priority, "low", "t3 不变");
        assert.strictEqual(tasks.length, 3, "任务数量不变");
    });

    await check("任务其他字段完整保留", () => {
        const api = priorityApi();
        const before = getTask(api, "t1");
        api.changeTaskPriority("t1", "medium");
        const after = getTask(api, "t1");
        assert.deepStrictEqual({ ...after, priority: before.priority }, before, "除 priority 外字段不变");
    });

    await check("优先级修改后持久化正确", () => {
        const api = priorityApi();
        api.changeTaskPriority("t1", "low");
        assert.strictEqual(getTask(api, "t1").priority, "low");
        const api2 = loadReadyApi({ [KEYS.tasks]: api._localStorage.getItem(KEYS.tasks) });
        assert.strictEqual(api2.getTasks().find((t) => t.id === "t1").priority, "low", "重新加载后仍为 low");
    });

    await check("非法优先级被拒绝", () => {
        const api = priorityApi();
        api.changeTaskPriority("t1", "urgent");
        assert.strictEqual(getTask(api, "t1").priority, "high", "非法值不应改变优先级");
    });

    await check("task-manager 停用时禁止修改", () => {
        const api = priorityApi();
        api.setModuleEnabled("task-manager", false);
        api.changeTaskPriority("t1", "low");
        assert.strictEqual(getTask(api, "t1").priority, "high", "停用时优先级不变");
    });

    await check("Data Center 恢复锁定时禁止修改", () => {
        const api = priorityApi();
        api.lockDataCenterForRecoveryFailure(["x"]);
        api.changeTaskPriority("t1", "low");
        assert.strictEqual(getTask(api, "t1").priority, "high", "恢复锁定时优先级不变");
    });

    await check("存储不可用时不能错误显示修改成功", () => {
        const localStorage = makeFailingStorage({ [KEYS.tasks]: JSON.stringify(priorityTaskSeed) }, "set", KEYS.tasks);
        const api = loadApi({ localStorage });
        api.loadTasks();
        api.changeTaskPriority("t1", "low");
        assert.strictEqual(api.getTasks().find((t) => t.id === "t1").priority, "high", "写入失败后内存态应保持原值");
    });

    // ============================================================
    // Task 13：Notes 标准化验证补充（第二模块）
    // ============================================================
    console.log("\n=== Task 13: Notes 标准化验证补充 ===");

    await check("Notes 损坏数据加载 fail-closed，不静默清空", () => {
        const corruptRaw = "{ not valid json";
        const api = loadReadyApi({ [KEYS.notes]: corruptRaw });
        assert.strictEqual(api.getReady().notesStorageReady, false, "损坏数据应使存储不可用");
        assert.strictEqual(api._document.getElementById("note-input").disabled, true, "输入框应被禁用");
        assert.ok(api._document.getElementById("notes-status").textContent.includes("Unable to load"), "应提示加载失败");
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), corruptRaw, "原始数据不得被清空");
    });

    await check("Notes 非法字段结构加载被拒绝", () => {
        const bad = JSON.stringify([{ id: "n1", text: 123, createdAt: "not-a-date" }]);
        const api = loadReadyApi({ [KEYS.notes]: bad });
        assert.strictEqual(api.getReady().notesStorageReady, false, "非法字段应使存储不可用");
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), bad, "原始数据不得被改写");
    });

    await check("Notes 持久化 setItem 失败返回 false 且内存态不变", () => {
        const storage = makeFailingStorage({ [KEYS.notes]: JSON.stringify([VALID_NOTE]) }, "set", KEYS.notes);
        const api = loadApi({ localStorage: storage });
        api.loadNotes();
        const beforeMem = api.getNotes();
        const beforeRaw = storage.getItem(KEYS.notes);
        const r = api.persistNotes([{ ...VALID_NOTE, id: "n2", text: "new" }]);
        assert.strictEqual(r, false, "写入失败应返回 false");
        assert.deepStrictEqual(api.getNotes(), beforeMem, "内存态不得变化");
        assert.strictEqual(storage.getItem(KEYS.notes), beforeRaw, "localStorage 不得变化");
    });

    await check("Notes 持久化后重新加载回读字段完整", () => {
        const api1 = loadReadyApi({ [KEYS.notes]: "[]" });
        const note = { id: "n1", text: "hello", createdAt: "2026-01-01T00:00:00.000Z" };
        assert.strictEqual(api1.persistNotes([note]), true);
        const storedRaw = api1._localStorage.getItem(KEYS.notes);
        const api2 = loadApi({ seed: { ...seededStore(), [KEYS.notes]: storedRaw } });
        api2.loadNotes();
        assert.deepStrictEqual(api2.getNotes(), [note], "重新加载后字段应完整一致");
    });

    // ============================================================
    // Task 14：Dashboard 统一总览
    // ============================================================
    console.log("\n=== Task 14: Dashboard 统一总览 ===");

    const localDateKey = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const focusArchive = (priorities) => JSON.stringify({
        schemaVersion: 1,
        activeDate: localDateKey(),
        records: { [localDateKey()]: { priorities } }
    });
    const dashFocusTexts = (api) => api._document.getElementById("dashboard-focus-list").children
        .map((item) => item.children[1].textContent);
    const dashTaskTexts = (api) => api._document.getElementById("dashboard-task-list").children
        .map((item) => item.children[1].textContent);
    const dashNoteTexts = (api) => api._document.getElementById("dashboard-notes-list").children
        .map((item) => item.children[0].textContent);
    const dashEl = (api, id) => api._document.getElementById(id);

    await check("今日重点正常展示（仅非空项）", () => {
        const api = loadReadyApi({ [KEYS.dailyFocus]: focusArchive(["AAA", "BBB", ""]) });
        api.renderDashboard();
        assert.deepStrictEqual(dashFocusTexts(api), ["AAA", "BBB"], "应只展示非空重点");
        assert.strictEqual(dashEl(api, "dashboard-focus-empty").hidden, true, "非空时不应显示空态");
    });

    await check("今日重点为空时显示空态", () => {
        const api = loadReadyApi({ [KEYS.dailyFocus]: focusArchive(["", "", ""]) });
        api.renderDashboard();
        assert.strictEqual(dashEl(api, "dashboard-focus-list").children.length, 0, "列表应为空");
        assert.strictEqual(dashEl(api, "dashboard-focus-empty").hidden, false, "空时应显示空态提示");
    });

    await check("Tasks 三类统计正确（高优待办只计未完成）", () => {
        const tasks = [
            { id: "a", text: "h1", priority: "high", completed: false, createdAt: "2026-11-01T00:00:00.000Z" },
            { id: "b", text: "h2", priority: "high", completed: false, createdAt: "2026-11-02T00:00:00.000Z" },
            { id: "c", text: "m1", priority: "medium", completed: false, createdAt: "2026-11-03T00:00:00.000Z" },
            { id: "d", text: "done-high", priority: "high", completed: true, createdAt: "2026-11-01T00:00:00.000Z" },
            { id: "e", text: "l1", priority: "low", completed: false, createdAt: "2026-11-04T00:00:00.000Z" }
        ];
        const api = loadReadyApi({ [KEYS.tasks]: JSON.stringify(tasks) });
        api.renderDashboard();
        assert.strictEqual(dashEl(api, "dashboard-pending-tasks").textContent, "4", "待办 4");
        assert.strictEqual(dashEl(api, "dashboard-completed-tasks").textContent, "1", "已完成 1");
        assert.strictEqual(dashEl(api, "dashboard-high-priority-tasks").textContent, "2", "高优待办 2（不含已完成）");
    });

    await check("未完成任务排序正确（high→medium→low，同优先级按创建时间降序）", () => {
        const tasks = [
            { id: "a", text: "high-old", priority: "high", completed: false, createdAt: "2026-11-01T00:00:00.000Z" },
            { id: "b", text: "medium", priority: "medium", completed: false, createdAt: "2026-11-02T00:00:00.000Z" },
            { id: "c", text: "high-new", priority: "high", completed: false, createdAt: "2026-11-03T00:00:00.000Z" },
            { id: "d", text: "low", priority: "low", completed: false, createdAt: "2026-11-04T00:00:00.000Z" }
        ];
        const api = loadReadyApi({ [KEYS.tasks]: JSON.stringify(tasks) });
        const sorted = api.dashboardSortedPendingTasks(10);
        assert.deepStrictEqual(sorted.map((t) => t.text), ["high-new", "high-old", "medium", "low"], "纯函数排序");
        api.renderDashboard();
        assert.deepStrictEqual(dashTaskTexts(api), ["high-new", "high-old", "medium", "low"], "渲染列表排序一致");
    });

    await check("最近 Notes 按创建时间降序", () => {
        const notes = [
            { id: "1", text: "one", createdAt: "2026-11-01T00:00:00.000Z" },
            { id: "2", text: "three", createdAt: "2026-11-03T00:00:00.000Z" },
            { id: "3", text: "two", createdAt: "2026-11-02T00:00:00.000Z" },
            { id: "4", text: "four", createdAt: "2026-11-04T00:00:00.000Z" }
        ];
        const api = loadReadyApi({ [KEYS.notes]: JSON.stringify(notes) });
        const recent = api.dashboardRecentNotes(3);
        assert.deepStrictEqual(recent.map((n) => n.text), ["four", "three", "two"], "纯函数排序");
        api.renderDashboard();
        assert.deepStrictEqual(dashNoteTexts(api), ["four", "three", "two"], "渲染列表仅最近 3 条");
    });

    await check("Notes 内容摘要截断正确", () => {
        const api = loadReadyApi();
        assert.strictEqual(api.dashboardTruncate("short text", 80), "short text", "短文本不截断");
        const truncated = api.dashboardTruncate("x".repeat(100), 80);
        assert.strictEqual(Array.from(truncated).length, 81, "80 字符 + 省略号");
        assert.ok(truncated.endsWith("…"), "应以省略号结尾");
    });

    await check("模块停用时保留历史数据并显示只读状态", () => {
        const tasks = [{ id: "a", text: "keep", priority: "high", completed: false, createdAt: "2026-11-01T00:00:00.000Z" }];
        const api = loadReadyApi({ [KEYS.tasks]: JSON.stringify(tasks) });
        api.setModuleEnabled("task-manager", false);
        api.loadTasks();
        api.renderDashboard();
        assert.strictEqual(dashEl(api, "dashboard-pending-tasks").textContent, "1", "停用后仍展示历史数据");
        assert.strictEqual(dashEl(api, "dashboard-tasks-readonly").hidden, false, "应显示只读徽标");
    });

    await check("数据损坏时显示不可用，不显示虚假零值", () => {
        const api = loadReadyApi({ [KEYS.tasks]: "{ bad json" });
        api.renderDashboard();
        assert.strictEqual(dashEl(api, "dashboard-pending-tasks").textContent, "", "不应显示 0");
        assert.strictEqual(dashEl(api, "dashboard-tasks-empty").hidden, false, "应显示不可用提示");
        assert.strictEqual(dashEl(api, "dashboard-tasks-empty").textContent, "数据不可用");
    });

    await check("单个模块异常不影响其他区域", () => {
        const notes = JSON.stringify([{ id: "n", text: "note", createdAt: "2026-11-01T00:00:00.000Z" }]);
        const api = loadReadyApi({ [KEYS.tasks]: "{ bad", [KEYS.notes]: notes, [KEYS.dailyFocus]: focusArchive(["F", "", ""]) });
        api.renderDashboard();
        assert.strictEqual(dashEl(api, "dashboard-tasks-empty").textContent, "数据不可用", "tasks 不可用");
        assert.deepStrictEqual(dashNoteTexts(api), ["note"], "notes 仍正常展示");
        assert.deepStrictEqual(dashFocusTexts(api), ["F"], "focus 仍正常展示");
    });

    await check("快捷入口绑定且重复绑定幂等", () => {
        const api = loadReadyApi();
        api.bindDashboardQuickActions();
        api.bindDashboardQuickActions();
        assert.strictEqual(dashEl(api, "dashboard-action-note")._listeners["click"].length, 1, "重复调用不应重复绑定");
        assert.strictEqual(dashEl(api, "dashboard-action-task")._listeners["click"].length, 1);
        assert.strictEqual(dashEl(api, "dashboard-action-ai")._listeners["click"].length, 1);
    });

    await check("快捷入口触发正确", () => {
        const api = loadReadyApi();
        api.bindDashboardQuickActions();
        let scrolled = false;
        let focused = false;
        dashEl(api, "quick-notes-section").scrollIntoView = () => { scrolled = true; };
        dashEl(api, "note-input").focus = () => { focused = true; };
        dashEl(api, "dashboard-action-note").dispatchEvent({ type: "click" });
        assert.ok(scrolled && focused, "记录笔记应滚动并聚焦输入框");

        let aiScrolled = false;
        let aiFocused = false;
        dashEl(api, "ai-assistant-title").scrollIntoView = () => { aiScrolled = true; };
        dashEl(api, "ai-assistant-prompt").focus = () => { aiFocused = true; };
        dashEl(api, "dashboard-action-ai").dispatchEvent({ type: "click" });
        assert.ok(aiScrolled && aiFocused, "AI Assistant 应进入主页面并聚焦输入框");
    });

    await check("Dashboard 不写入业务数据", () => {
        const tasks = JSON.stringify([{ id: "a", text: "t", priority: "high", completed: false, createdAt: "2026-11-01T00:00:00.000Z" }]);
        const api = loadReadyApi({ [KEYS.tasks]: tasks });
        const beforeTasks = api._localStorage.getItem(KEYS.tasks);
        const beforeNotes = api._localStorage.getItem(KEYS.notes);
        const beforeFocus = api._localStorage.getItem(KEYS.dailyFocus);
        api.renderDashboard();
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), beforeTasks, "tasks 不得变化");
        assert.strictEqual(api._localStorage.getItem(KEYS.notes), beforeNotes, "notes 不得变化");
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), beforeFocus, "dailyFocus 不得变化");
    });

    await check("恢复锁定期间 Dashboard 仍遵守只读原则", () => {
        const tasks = JSON.stringify([{ id: "a", text: "t", priority: "high", completed: false, createdAt: "2026-11-01T00:00:00.000Z" }]);
        const api = loadReadyApi({ [KEYS.tasks]: tasks });
        api.lockDataCenterForRecoveryFailure(["x"]);
        const before = api._localStorage.getItem(KEYS.tasks);
        api.renderDashboard();
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), before, "锁定期间不得写入");
        assert.strictEqual(dashEl(api, "dashboard-status").hidden, false, "应显示系统状态");
        assert.ok(dashEl(api, "dashboard-status").textContent.includes("恢复保护状态"), "状态应提示恢复保护");
    });

    // ============================================================
    // Task 9：AI Assistant 超时保护 + AI Request Runner 契约
    // ============================================================
    console.log("\n=== Task 9: AI Assistant 超时保护与 Request Runner 契约 ===");

    const snapshotTimers = (api) => [...api._timers._map.entries()];

    await check("AI Assistant：注册 90000ms 超时，触发后请求中止并清理状态", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "slow" });
        const timerBefore = snapshotTimers(api);
        const p = api.requestAssistantReply();
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added.length, 1, "应注册且仅注册 1 个超时定时器");
        assert.strictEqual(added[0][1].delay, 90000, "超时时长应为 90000ms，与其余四个工作流一致");
        assert.strictEqual(api._fetch.pending.length, 1);
        added[0][1].fn(); // 模拟 90 秒到期
        await p;
        assert.strictEqual(api.getAiRequestPending(), false, "pending 状态应清理");
        assert.strictEqual(api.getAiRequestController(), null, "controller 应释放");
        assert.strictEqual(api._timers._map.has(added[0][0]), false, "超时定时器应清理");
        const chat = api._document.getElementById("ai-chat-log");
        const texts = [];
        const walk = (node) => {
            node.children.forEach((child) => {
                if (child.tagName === "P") texts.push(String(child.textContent));
                walk(child);
            });
        };
        walk(chat);
        assert.ok(
            texts.some((text) => text.includes("AI 请求等待超时")),
            "应显示超时提示，实际：" + JSON.stringify(texts)
        );
        assert.ok(
            api.aiConversation.every((m) => m.role !== "assistant" || m.content !== undefined),
            "对话数组结构完整"
        );
        const assistantReplies = api.aiConversation.filter((m) => m.role === "assistant").length;
        assert.strictEqual(assistantReplies, 0, "超时失败不得写入 AI 回复");
    });

    await check("AI Assistant：超时不影响后续新请求", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "first" });
        const timerBefore = snapshotTimers(api);
        const p1 = api.requestAssistantReply();
        snapshotTimers(api).slice(timerBefore.length)[0][1].fn();
        await p1;
        api.aiConversation.push({ role: "user", content: "second" });
        const p2 = api.requestAssistantReply();
        assert.strictEqual(api._fetch.pending.length, 2, "超时后应可发起新请求");
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "recovered", model: "x" }) });
        await p2;
        assert.ok(api.aiConversation.some((m) => m.role === "assistant" && m.content === "recovered"), "新请求应正常完成");
    });

    await check("Runner：成功返回 {reply, model}，请求体仅含 messages，默认超时 90000ms", async () => {
        const api = loadReadyApi();
        const messages = [{ role: "user", content: "hi" }];
        const timerBefore = snapshotTimers(api);
        const p = api.requestAI({ messages });
        assert.strictEqual(api._fetch.pending.length, 1, "应发出 1 个请求");
        const entry = api._fetch.last();
        assert.strictEqual(entry.url, api.aiWorkerEndpoint, "应请求统一端点");
        assert.deepStrictEqual(JSON.parse(entry.opts.body), { messages }, "请求体应只含 messages 契约字段");
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added.length, 1, "Runner 应注册 1 个超时定时器");
        assert.strictEqual(added[0][1].delay, 90000, "默认超时应为 90000ms");
        entry.resolve({ ok: true, status: 200, json: async () => ({ reply: "ok", model: "m1" }) });
        const result = await p;
        assert.deepStrictEqual(result, { reply: "ok", model: "m1" });
        assert.strictEqual(api._timers._map.size, timerBefore.length, "完成后定时器应清理");
    });

    await check("Runner：支持调用方自定义超时时长，超时触发 → TimeoutError", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api);
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }], timeoutMs: 5000 });
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added[0][1].delay, 5000, "应使用调用方传入的超时时长");
        added[0][1].fn();
        await assert.rejects(p, (error) => error.name === "TimeoutError", "超时应抛 TimeoutError");
        assert.strictEqual(api._timers._map.size, timerBefore.length, "定时器应清理");
    });

    await check("Runner：调用方 signal 中止 → AbortError（不误报为超时）", async () => {
        const api = loadReadyApi();
        const caller = new AbortController();
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }], signal: caller.signal });
        assert.strictEqual(api._fetch.pending.length, 1);
        caller.abort();
        await assert.rejects(p, (error) => error.name === "AbortError");
    });

    await check("Runner：signal 已预先中止 → 直接 AbortError，不发出请求", async () => {
        const api = loadReadyApi();
        const caller = new AbortController();
        caller.abort();
        await assert.rejects(
            api.requestAI({ messages: [], signal: caller.signal }),
            (error) => error.name === "AbortError"
        );
        assert.strictEqual(api._fetch.pending.length, 0, "不应发出任何请求");
    });

    await check("Runner：迟到响应守卫 isAllowed()=false → AbortError，结果不外泄", async () => {
        const api = loadReadyApi();
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }], isAllowed: () => false });
        const entry = api._fetch.last();
        entry.resolve({ ok: true, status: 200, json: async () => ({ reply: "stale", model: "m" }) });
        await assert.rejects(p, (error) => error.name === "AbortError", "权限/版本失效应丢弃结果");
        const result = await p.catch(() => null);
        assert.strictEqual(result, null, "迟到结果不得返回给调用方");
    });

    await check("Runner：HTTP 非 2xx → HTTPError（含状态码）", async () => {
        const api = loadReadyApi();
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }] });
        api._fetch.last().resolve({ ok: false, status: 502, json: async () => ({}) });
        await assert.rejects(p, (error) => error.name === "HTTPError" && error.message.includes("502"));
    });

    await check("Runner：响应 JSON 无效 → InvalidResponseError", async () => {
        const api = loadReadyApi();
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }] });
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
        await assert.rejects(p, (error) => error.name === "InvalidResponseError");
    });

    await check("Runner：reply 缺失/为空 → InvalidResponseError", async () => {
        const api = loadReadyApi();
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }] });
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ model: "m" }) });
        await assert.rejects(p, (error) => error.name === "InvalidResponseError");
    });

    await check("Runner：网络异常（TypeError）→ NetworkError", async () => {
        const api = loadReadyApi();
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }] });
        api._fetch.last().reject(new TypeError("fetch failed"));
        await assert.rejects(p, (error) => error.name === "NetworkError");
    });

    await check("Runner：纯传输 —— 不写入任何业务存储键", async () => {
        const api = loadReadyApi();
        const before = [...api._localStorage._store.entries()].map(([k, v]) => `${k}:${v}`);
        const p = api.requestAI({ messages: [{ role: "user", content: "x" }] });
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "r", model: "m" }) });
        await p;
        const after = [...api._localStorage._store.entries()].map(([k, v]) => `${k}:${v}`);
        assert.deepStrictEqual(after, before, "Runner 不得写入业务数据");
    });

    // ============================================================
    // Task 11：Task Organization 迁移至统一 Request Runner
    // ============================================================
    console.log("\n=== Task 11: Task Organization → Request Runner 迁移 ===");

    const VALID_ORG_REPLY = () => ({
        reply: JSON.stringify({
            tasks: [{
                title: "买牛奶", content: "", priority: "medium", prioritySource: "default",
                priorityEvidence: "", category: "", dueDate: "", dueTime: "",
                dateEvidence: "", timeEvidence: "", sourceExcerpt: "买牛奶",
                needsConfirmation: true, confirmationReason: "原文未标优先级，使用默认中优先级"
            }],
            notes: ""
        }),
        model: "test-model"
    });

    await check("Task Org 迁移后：成功请求 → Prompt 契约、解析与预览均保持一致", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api).length;
        api.taskOrganizerInput.value = "买牛奶（明天）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出 1 个请求");
        const entry = api._fetch.last();
        assert.strictEqual(entry.url, api.aiWorkerEndpoint, "应请求统一端点");
        const body = JSON.parse(entry.opts.body);
        assert.strictEqual(body.messages.length, 1, "请求体应符合 messages 契约");
        const prompt = body.messages[0].content;
        assert.ok(prompt.includes("你是任务整理助手"), "Prompt 开场白应保持一致");
        assert.ok(prompt.includes("买牛奶（明天）"), "Prompt 应原样携带用户原文");
        assert.ok(prompt.includes("needsConfirmation") && prompt.includes("confirmationReason"), "Prompt 应保留待确认配对规则");
        assert.ok(prompt.includes('{"tasks":[{"title"'), "Prompt 应保留字段契约");
        assert.ok(prompt.includes("用户原文："), "Prompt 应保留原文分隔约定");
        entry.resolve({ ok: true, status: 200, json: VALID_ORG_REPLY });
        await p;
        assert.ok(
            api.taskOrganizerStatus.textContent.includes("已生成 1 项 AI 任务预览"),
            "成功响应应生成预览，实际：" + api.taskOrganizerStatus.textContent
        );
        assert.ok(api.taskOrganizerStatus.textContent.includes("test-model"), "应显示模型名");
        assert.ok(!api.taskOrganizerStatus.textContent.includes("失败"), "不应出现失败提示");
        assert.strictEqual(api.getTaskOrganizerPending(), false, "pending 应清理");
        assert.strictEqual(api.getTaskOrganizerController(), null, "controller 应释放");
        assert.strictEqual(snapshotTimers(api).length, timerBefore, "Runner 定时器应清理");
    });

    await check("Task Org 迁移后：HTTP 错误文案与迁移前逐字一致", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "AI 服务暂时不可用（HTTP 500），请稍后重试。",
            "HTTP 错误文案应保持迁移前原文"
        );
        assert.strictEqual(api.getTaskOrganizerPending(), false, "失败后 pending 应恢复");
    });

    await check("Task Org 迁移后：网络错误文案保持一致", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().reject(new TypeError("fetch failed"));
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "无法连接 AI 服务，请检查网络或稍后重试。",
            "网络错误文案应保持迁移前原文"
        );
    });

    await check("Task Org 迁移后：无效 JSON 响应文案保持一致", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "AI 服务返回了无效响应（HTTP 200）。",
            "无效 JSON 文案应保持迁移前原文"
        );
    });

    await check("Task Org 迁移后：reply 为空时文案保持一致", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ model: "x" }) });
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "AI 服务返回内容为空或格式不正确。",
            "空 reply 文案应保持迁移前原文"
        );
    });

    await check("Task Org 显式分支：JSON 无效与空 reply 文案不再依赖 Runner message", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().resolve({ ok: true, status: 502, json: async () => { throw new Error("bad json"); } });
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "AI 服务返回了无效响应（HTTP 502）。",
            "JSON 无效文案应来自 Task Organization 显式分支（含 Runner 传入的真实 status）"
        );
    });

    await check("Task Org 显式分支：解析阶段业务错误仍显示原始 message", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "这是一段非 JSON 的任务预览", model: "x" }) });
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "AI 返回的任务预览格式无法识别，请重新分析。",
            "解析阶段业务错误应显示业务层原始提示，而非 Runner 或兜底文案"
        );
    });

    await check("Task Org 显式分支：未知异常仍显示原始 message", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "写周报（周五）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().reject(Object.assign(new Error("自定义异常信息"), { name: "CustomError" }));
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "自定义异常信息",
            "未知异常应回显 error.message，不受新增显式分支影响"
        );
    });

    await check("Task Org 迁移后：90 秒超时 → 超时文案 + 资源清理", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api);
        api.taskOrganizerInput.value = "整理发票（周一）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added.length, 1, "Runner 应注册 1 个超时定时器");
        assert.strictEqual(added[0][1].delay, 90000, "超时应为 90000ms");
        added[0][1].fn(); // 模拟 90 秒到期
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "AI 请求等待超时。原文和 Task Manager 均未更改，请稍后重试。",
            "超时文案应保持迁移前原文"
        );
        assert.strictEqual(api.getTaskOrganizerPending(), false, "超时后 pending 应恢复");
        assert.strictEqual(api.getTaskOrganizerController(), null, "controller 应释放");
        assert.strictEqual(snapshotTimers(api).length, timerBefore.length, "定时器应清理");
    });

    await check("Task Org 迁移后：用户主动取消 → AbortError 文案 + 状态恢复", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "整理发票（周一）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api.getTaskOrganizerController().abort(); // 模拟用户主动取消（版本未变）
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "AI 请求等待超时。原文和 Task Manager 均未更改，请稍后重试。",
            "取消文案应与迁移前 AbortError 映射一致"
        );
        assert.strictEqual(api.getTaskOrganizerPending(), false, "取消后 pending 应恢复");
        assert.strictEqual(api.getTaskOrganizerController(), null, "controller 应释放");
    });

    await check("Task Org 迁移后：AI 总开关关闭 → 在途 abort 且不误报超时", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "整理发票（周一）";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        const entry = api._fetch.last();
        api.setModuleEnabled("ai-assistant", false);
        api.updateTaskOrganizationAccessUI();
        assert.strictEqual(entry.signal.aborted, true, "在途请求应被 abort");
        await p;
        assert.ok(
            !api.taskOrganizerStatus.textContent.includes("AI 请求等待超时"),
            "权限拦截不应显示超时文案，实际：" + api.taskOrganizerStatus.textContent
        );
        assert.strictEqual(api.getTaskOrganizerPending(), false, "pending 应清理");
        assert.strictEqual(api.getTaskOrganizerController(), null, "controller 应释放");
    });

    await check("Task Org 迁移后：请求失败后可立即重新发起并成功", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "任务甲";
        const p1 = api.organizeTasks({ preventDefault() {} });
        await flush();
        api._fetch.last().resolve({ ok: false, status: 503, json: async () => ({}) });
        await p1;
        assert.strictEqual(api.getTaskOrganizerPending(), false, "失败后 pending 应恢复");
        api.taskOrganizerInput.value = "任务乙";
        const p2 = api.organizeTasks({ preventDefault() {} });
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "应可立即发起新请求");
        const prompt2 = JSON.parse(api._fetch.last().opts.body).messages[0].content;
        assert.ok(prompt2.includes("任务乙") && !prompt2.includes("任务甲"), "新请求应携带新输入");
        api._fetch.last().resolve({ ok: true, status: 200, json: () => {
            const parsed = JSON.parse(VALID_ORG_REPLY().reply);
            parsed.tasks[0].sourceExcerpt = "任务乙";
            return Promise.resolve({ reply: JSON.stringify(parsed), model: "m" });
        } });
        await p2;
        assert.ok(api.taskOrganizerStatus.textContent.includes("已生成 1 项"), "第二次请求应成功");
    });

    await check("Task Org 迁移后：分析期间输入被修改 → 旧结果丢弃文案一致", async () => {
        const api = loadReadyApi();
        api.taskOrganizerInput.value = "原始输入";
        const p = api.organizeTasks({ preventDefault() {} });
        await flush();
        api.taskOrganizerInput.value = "输入已变化"; // 模拟分析期间用户改动
        api._fetch.last().resolve({ ok: true, status: 200, json: VALID_ORG_REPLY });
        await p;
        assert.strictEqual(
            api.taskOrganizerStatus.textContent,
            "分析期间原始输入发生变化；旧结果已丢弃，请重新分析。",
            "输入变化守卫文案应保持迁移前原文"
        );
    });

    // ============================================================
    // Task 14：Runner 资源清理专项（8 条路径监听器与定时器释放）
    // ============================================================
    console.log("\n=== Task 14: Runner 资源清理专项 ===");

    const makeSpySignal = () => ({
        aborted: false,
        listeners: [],
        addEventListener(type, fn) { this.listeners.push(fn); },
        removeEventListener(type, fn) {
            const index = this.listeners.indexOf(fn);
            if (index >= 0) this.listeners.splice(index, 1);
        },
    });
    const RUNNER_MSG = () => [{ role: "user", content: "x" }];

    await check("Runner 资源清理：8 条路径结束后监听器与定时器均释放", async () => {
        const paths = [
            ["正常完成", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy });
                api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "r", model: "m" }) });
                const result = await p;
                assert.deepStrictEqual(result, { reply: "r", model: "m" }, "正常完成应返回契约结果");
            }],
            ["用户主动取消", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy });
                spy.listeners[0](); // 调用方触发 abort
                await assert.rejects(p, (e) => e.name === "AbortError");
            }],
            ["请求超时", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy });
                [...api._timers._map.values()].slice(-1)[0].fn();
                await assert.rejects(p, (e) => e.name === "TimeoutError");
            }],
            ["网络异常", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy });
                api._fetch.last().reject(new TypeError("fetch failed"));
                await assert.rejects(p, (e) => e.name === "NetworkError");
            }],
            ["HTTP 异常", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy });
                api._fetch.last().resolve({ ok: false, status: 502, json: async () => ({}) });
                await assert.rejects(p, (e) => e.name === "HTTPError");
            }],
            ["无效 JSON", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy });
                api._fetch.last().resolve({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
                await assert.rejects(p, (e) => e.name === "InvalidResponseError");
            }],
            ["reply 为空", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy });
                api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ model: "m" }) });
                await assert.rejects(p, (e) => e.name === "InvalidResponseError");
            }],
            ["AccessVersion 变化（迟到守卫丢弃）", async (api, spy) => {
                const p = api.requestAI({ messages: RUNNER_MSG(), signal: spy, isAllowed: () => false });
                api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "stale", model: "m" }) });
                await assert.rejects(p, (e) => e.name === "AbortError");
            }],
        ];
        for (const [name, run] of paths) {
            const api = loadReadyApi();
            const baseTimers = snapshotTimers(api).length;
            const spy = makeSpySignal();
            await run(api, spy);
            assert.strictEqual(spy.listeners.length, 0, name + "：调用方 signal 监听器应全部移除");
            assert.strictEqual(snapshotTimers(api).length, baseTimers, name + "：超时定时器应清理");
        }
    });

    // ============================================================
    // Task 15：Daily Planning 迁移至统一 Request Runner + 跨模块安全
    // ============================================================
    console.log("\n=== Task 15: Daily Planning → Request Runner 迁移与跨模块安全 ===");

    const VALID_PLAN_REPLY = () => ({
        reply: JSON.stringify({
            overview: "今日共 1 项待办。",
            priorityTasks: [{ id: "t1", reason: "唯一待办任务" }],
            focusSuggestions: ["完成待办", "保持节奏", "留出缓冲"],
            priorityAdvice: "维持现有优先级。",
            scheduleAdvice: "上午集中处理。",
            watchouts: "任务没有明确截止日期。",
            rhythmAdvice: "先难后易。",
            rationale: "基于真实任务数据。"
        }),
        model: "plan-model"
    });
    const setupPlanningMode = (api) => {
        const modeEl = api._document.getElementById("planning-analysis-mode");
        modeEl.selectedOptions = [{ textContent: "智能规划" }];
        modeEl.value = "smart";
        return modeEl;
    };

    await check("Daily Planning 迁移后：成功请求 → Prompt 契约、结果结构与资源清理", async () => {
        const api = loadReadyApi();
        setupPlanningMode(api);
        const timerBefore = snapshotTimers(api).length;
        const tasksBefore = api._localStorage.getItem(KEYS.tasks);
        const focusBefore = api._localStorage.getItem(KEYS.dailyFocus);
        const p = api.runDailyPlanningAnalysis();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出 1 个请求");
        const entry = api._fetch.last();
        const prompt = JSON.parse(entry.opts.body).messages[0].content;
        assert.ok(prompt.includes("你是个人每日计划助手"), "Prompt 开场白应保持一致");
        assert.ok(prompt.includes("智能规划：概括今日工作"), "Prompt 应包含所选模式指令");
        assert.ok(prompt.includes("待分析数据 JSON："), "Prompt 应保留数据 JSON 约定");
        assert.ok(prompt.includes('"t1"'), "Prompt 应携带真实任务 id");
        assert.ok(prompt.includes('"id"') && prompt.includes('"completed"'), "Prompt 应保留任务事实字段契约");
        entry.resolve({ ok: true, status: 200, json: VALID_PLAN_REPLY });
        await p;
        assert.ok(api.planningAIStatus.textContent.includes("分析完成"), "应显示分析完成");
        assert.ok(api.planningAIStatus.textContent.includes("plan-model"), "应显示模型名");
        assert.ok(api.getDailyPlanningAnalysis(), "分析结果应保留原有结构");
        assert.strictEqual(api.getDailyPlanningPending(), false, "pending 应清理");
        assert.strictEqual(api.getDailyPlanningController(), null, "controller 应释放");
        assert.strictEqual(snapshotTimers(api).length, timerBefore, "Runner 定时器应清理");
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), tasksBefore, "分析不得写入 tasks");
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), focusBefore, "分析阶段不得直接写入 daily-focus");
    });

    await check("Daily Planning 迁移后：HTTP 错误文案与迁移前逐字一致", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) });
        await p;
        assert.strictEqual(api.planningAIStatus.textContent, "AI 服务暂时不可用（HTTP 500），请稍后重试。");
        assert.strictEqual(api.getDailyPlanningPending(), false, "失败后 pending 应恢复");
    });

    await check("Daily Planning 迁移后：网络错误文案保持一致", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().reject(new TypeError("fetch failed"));
        await p;
        assert.strictEqual(api.planningAIStatus.textContent, "无法连接 AI 服务，请检查网络或稍后重试。");
    });

    await check("Daily Planning 迁移后：无效 JSON 文案保持一致", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
        await p;
        assert.strictEqual(api.planningAIStatus.textContent, "AI 服务返回了无效响应（HTTP 200）。");
    });

    await check("Daily Planning 显式分支：json 分支透传真实 HTTP status", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().resolve({ ok: true, status: 502, json: async () => { throw new Error("bad json"); } });
        await p;
        assert.strictEqual(
            api.planningAIStatus.textContent,
            "AI 服务返回了无效响应（HTTP 502）。",
            "json 显式分支应使用 Runner 传入的真实 status，而非硬编码"
        );
    });

    await check("Daily Planning 显式分支：空 reply 文案逐字一致", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ model: "x" }) });
        await p;
        assert.strictEqual(
            api.planningAIStatus.textContent,
            "AI 服务返回内容为空或格式不正确。",
            "空 reply 文案应来自 Daily Planning 显式分支，与此前 Runner message 回显逐字一致"
        );
    });

    await check("Daily Planning 显式分支：解析阶段业务错误显示原始业务提示", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "这是一段非 JSON 的规划报告", model: "x" }) });
        await p;
        assert.strictEqual(
            api.planningAIStatus.textContent,
            "AI 返回的规划格式无法识别，请重新生成。",
            "解析阶段业务错误应显示业务层原始提示，不受显式分支影响"
        );
    });

    await check("Daily Planning 显式分支：未知异常仍显示原始 message", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().reject(Object.assign(new Error("自定义规划异常"), { name: "CustomError" }));
        await p;
        assert.strictEqual(
            api.planningAIStatus.textContent,
            "自定义规划异常",
            "未知异常应回显 error.message，兜底行为不变"
        );
    });

    await check("Daily Planning 迁移后：90 秒超时 → 超时文案 + 资源清理", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api);
        const p = api.runDailyPlanningAnalysis();
        await flush();
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added.length, 1, "Runner 应注册 1 个超时定时器");
        assert.strictEqual(added[0][1].delay, 90000, "超时应为 90000ms");
        added[0][1].fn();
        await p;
        assert.strictEqual(api.planningAIStatus.textContent, "规划请求等待超时。任务和每日重点未更改，请稍后重试。");
        assert.strictEqual(api.getDailyPlanningPending(), false, "超时后 pending 应恢复");
        assert.strictEqual(api.getDailyPlanningController(), null, "controller 应释放");
        assert.strictEqual(snapshotTimers(api).length, timerBefore.length, "定时器应清理");
    });

    await check("Daily Planning 迁移后：主动取消 → AbortError 文案 + 状态恢复", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        api.getDailyPlanningController().abort(); // 版本未变，模拟用户主动取消
        await p;
        assert.strictEqual(api.planningAIStatus.textContent, "规划请求等待超时。任务和每日重点未更改，请稍后重试。", "取消文案应与迁移前 AbortError 映射一致");
        assert.strictEqual(api.getDailyPlanningPending(), false);
        assert.strictEqual(api.getDailyPlanningController(), null);
    });

    await check("Daily Planning 迁移后：AI 总开关关闭 → 在途 abort 且不误报超时", async () => {
        const api = loadReadyApi();
        const p = api.runDailyPlanningAnalysis();
        await flush();
        const entry = api._fetch.last();
        api.setModuleEnabled("ai-assistant", false);
        api.updateDailyPlanningAccessUI();
        assert.strictEqual(entry.signal.aborted, true, "在途请求应被 abort");
        await p;
        assert.ok(!api.planningAIStatus.textContent.includes("超时"), "权限拦截不应显示超时文案");
        assert.strictEqual(api.getDailyPlanningPending(), false);
        assert.strictEqual(api.getDailyPlanningController(), null);
    });

    await check("Daily Planning 迁移后：请求失败后可立即重新请求并成功", async () => {
        const api = loadReadyApi();
        setupPlanningMode(api);
        const p1 = api.runDailyPlanningAnalysis();
        await flush();
        api._fetch.last().resolve({ ok: false, status: 503, json: async () => ({}) });
        await p1;
        assert.strictEqual(api.getDailyPlanningPending(), false, "失败后 pending 应恢复");
        const p2 = api.runDailyPlanningAnalysis();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "应可立即发起新请求");
        api._fetch.last().resolve({ ok: true, status: 200, json: VALID_PLAN_REPLY });
        await p2;
        assert.ok(api.planningAIStatus.textContent.includes("分析完成"), "第二次请求应成功");
    });

    await check("跨模块安全：Task Manager 停用不阻断无关 Notes 功能", () => {
        const api = loadReadyApi();
        api.setModuleEnabled("task-manager", false);
        const ok = api.persistNotes([{ ...VALID_NOTE, id: "n9", text: "notes ok" }]);
        assert.strictEqual(ok, true, "Task Manager 停用不应影响 Notes 写入");
        assert.deepStrictEqual(JSON.parse(api._localStorage.getItem(KEYS.notes))[0].text, "notes ok");
    });

    await check("跨模块安全：Task Manager 停用时 Daily Planning 只读分析、不写 tasks", async () => {
        const api = loadReadyApi();
        setupPlanningMode(api);
        api.setModuleEnabled("task-manager", false);
        const tasksBefore = api._localStorage.getItem(KEYS.tasks);
        const p = api.runDailyPlanningAnalysis();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "Task Manager 停用时数据仍可只读分析（与迁移前一致）");
        api._fetch.last().resolve({ ok: true, status: 200, json: VALID_PLAN_REPLY });
        await p;
        assert.strictEqual(api._localStorage.getItem(KEYS.tasks), tasksBefore, "分析全程不得写入 tasks");
    });

    await check("跨模块安全：daily-focus 停用时确认入口被守卫拦截", () => {
        const api = loadReadyApi();
        const focusBefore = api._localStorage.getItem(KEYS.dailyFocus);
        api.setModuleEnabled("daily-focus", false);
        api.confirmDailyPlan({ preventDefault() {} });
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), focusBefore, "停用时不得经确认入口写入 daily-focus");
    });

    await check("跨模块安全：Daily Planning 确认更新只经 persistDailyFocus 入口写入 daily-focus", () => {
        const api = loadReadyApi();
        const focusBefore = api._localStorage.getItem(KEYS.dailyFocus);
        api.confirmDailyPlan({ preventDefault() {} }); // 无分析结果 → 不得写入
        assert.strictEqual(api._localStorage.getItem(KEYS.dailyFocus), focusBefore, "无分析结果时确认不得写入");
    });

    await check("跨模块安全：Task Organization 取消/超时不影响在途 Daily Planning", async () => {
        const api = loadReadyApi();
        setupPlanningMode(api);
        api.taskOrganizerInput.value = "任务甲";
        const planP = api.runDailyPlanningAnalysis();
        await flush();
        const orgP = api.organizeTasks({ preventDefault() {} });
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "两个工作流应同时在途");
        const planEntry = api._fetch.pending[0];
        api.getTaskOrganizerController().abort(); // Task Organization 主动取消
        await orgP;
        assert.strictEqual(planEntry.signal.aborted, false, "取消 Task Organization 不得波及 Daily Planning");
        assert.strictEqual(api.getDailyPlanningPending(), true, "Daily Planning 应保持 pending");
        // Daily Planning 正常完成（注意：pending[1] 是已取消的 org 条目，须显式用 pending[0]）
        planEntry.resolve({ ok: true, status: 200, json: VALID_PLAN_REPLY });
        await planP;
        assert.ok(api.planningAIStatus.textContent.includes("分析完成"), "Daily Planning 应不受干扰地完成");
    });

    // ============================================================
    // Task 16：Document Summary → Request Runner 迁移
    // ============================================================
    console.log("\n=== Task 16: Document Summary → Request Runner 迁移 ===");

    const VALID_DOC_REPLY = () => ({
        reply: JSON.stringify({
            executive: "资料核心摘要。",
            keyPoints: "要点一。",
            important: "重要数据。",
            actions: "行动项。",
            deepAnalysis: "深度分析。"
        }),
        model: "doc-model"
    });

    await check("Doc Summary 迁移后：成功请求 → Prompt 契约、解析与资源清理", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api).length;
        const docsBefore = api._localStorage.getItem(KEYS.documents);
        api.documentSourceInput.value = "这是一段需要整理的资料。";
        const p = api.organizeCurrentDocument();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出 1 个请求");
        const entry = api._fetch.last();
        const prompt = JSON.parse(entry.opts.body).messages[0].content;
        assert.ok(prompt.includes("这是一段需要整理的资料。"), "Prompt 应原样携带用户原文");
        assert.ok(prompt.includes("executive") || prompt.includes("核心摘要"), "Prompt 应保留五部分字段契约");
        entry.resolve({ ok: true, status: 200, json: VALID_DOC_REPLY });
        const ok = await p;
        assert.strictEqual(ok, true, "成功分析应返回 true");
        assert.ok(api.documentInputStatus.textContent.includes("AI 分析完成"), "应显示分析完成");
        assert.ok(api.documentInputStatus.textContent.includes("核对原文"), "应保留核对提醒文案");
        assert.strictEqual(api.getDocumentPending(), false, "pending 应清理");
        assert.strictEqual(api.getDocumentController(), null, "controller 应释放");
        assert.strictEqual(snapshotTimers(api).length, timerBefore, "Runner 定时器应清理");
        assert.strictEqual(api._localStorage.getItem(KEYS.documents), docsBefore, "分析阶段不得直接写入历史");
    });

    await check("Doc Summary 迁移后：HTTP/网络/JSON/空 reply 文案与迁移前逐字一致", async () => {
        const cases = [
            ["HTTP 错误", (api) => api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) }),
                "AI 分析服务暂时不可用（HTTP 500）。请稍后重试。"],
            ["网络错误", (api) => api._fetch.last().reject(new TypeError("fetch failed")),
                "无法连接资料分析服务，请检查网络或稍后重试。"],
            ["无效 JSON", (api) => api._fetch.last().resolve({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }),
                "Worker 返回了无效的 JSON 响应（HTTP 200）。"],
            ["空 reply", (api) => api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ model: "x" }) }),
                "AI 分析服务返回的数据格式不正确。请稍后重试。"],
        ];
        for (const [name, act, expected] of cases) {
            const api = loadReadyApi();
            api.documentSourceInput.value = "格式校验资料。";
            const p = api.organizeCurrentDocument();
            await flush();
            act(api);
            await p;
            assert.strictEqual(api.documentInputStatus.textContent, expected, name + "：文案应与迁移前逐字一致");
            assert.strictEqual(api.getDocumentPending(), false, name + "：失败后 pending 应恢复");
        }
    });

    await check("Doc Summary 迁移后：90 秒超时 → 超时文案 + 资源清理", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api);
        api.documentSourceInput.value = "超时测试资料。";
        const p = api.organizeCurrentDocument();
        await flush();
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added.length, 1, "Runner 应注册 1 个超时定时器");
        assert.strictEqual(added[0][1].delay, 90000, "超时应为 90000ms");
        added[0][1].fn();
        assert.strictEqual(await p, false, "超时应返回 false");
        assert.strictEqual(api.documentInputStatus.textContent, "资料分析等待超时。原始资料未更改，请稍后重试或分段分析。");
        assert.strictEqual(api.getDocumentPending(), false);
        assert.strictEqual(api.getDocumentController(), null);
        assert.strictEqual(snapshotTimers(api).length, timerBefore.length, "定时器应清理");
    });

    await check("Doc Summary 迁移后：主动取消 → AbortError 文案 + 状态恢复", async () => {
        const api = loadReadyApi();
        api.documentSourceInput.value = "取消测试资料。";
        const p = api.organizeCurrentDocument();
        await flush();
        api.getDocumentController().abort();
        assert.strictEqual(await p, false);
        assert.strictEqual(api.documentInputStatus.textContent, "资料分析等待超时。原始资料未更改，请稍后重试或分段分析。", "取消文案应与迁移前 AbortError 映射一致");
        assert.strictEqual(api.getDocumentPending(), false);
        assert.strictEqual(api.getDocumentController(), null);
    });

    await check("Doc Summary 迁移后：AI 总开关关闭 → 在途 abort 且不误报超时", async () => {
        const api = loadReadyApi();
        api.documentSourceInput.value = "总开关测试资料。";
        const p = api.organizeCurrentDocument();
        await flush();
        const entry = api._fetch.last();
        api.setModuleEnabled("ai-assistant", false);
        api.updateDocumentSummaryAccessUI();
        assert.strictEqual(entry.signal.aborted, true, "在途请求应被 abort");
        await p;
        assert.ok(!api.documentInputStatus.textContent.includes("超时"), "权限拦截不应显示超时文案");
        assert.strictEqual(api.getDocumentPending(), false);
        assert.strictEqual(api.getDocumentController(), null);
    });

    await check("Doc Summary 迁移后：失败后可立即重新请求并成功", async () => {
        const api = loadReadyApi();
        api.documentSourceInput.value = "重试资料。";
        const p1 = api.organizeCurrentDocument();
        await flush();
        api._fetch.last().resolve({ ok: false, status: 503, json: async () => ({}) });
        assert.strictEqual(await p1, false);
        const p2 = api.organizeCurrentDocument();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "应可立即发起新请求");
        api._fetch.last().resolve({ ok: true, status: 200, json: VALID_DOC_REPLY });
        assert.strictEqual(await p2, true, "第二次请求应成功");
    });

    // ============================================================
    // Task 17：Ideas & Writing → Request Runner 迁移 + 跨工作流独立性
    // ============================================================
    console.log("\n=== Task 17: Ideas & Writing → Request Runner 迁移与跨工作流独立性 ===");

    await check("Ideas 迁移后：成功请求 → Prompt 契约、返回结构与资源清理", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api).length;
        const ideasBefore = api._localStorage.getItem(KEYS.ideas);
        const status = makeElement();
        const button = makeElement();
        const originalLabel = button.textContent;
        const p = api.requestIdeasAI("灵感整理提示词", button, status, "处理中……");
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "应发出 1 个请求");
        const entry = api._fetch.last();
        assert.strictEqual(JSON.parse(entry.opts.body).messages[0].content, "灵感整理提示词", "Prompt 应原样传递（构造在调用方）");
        entry.resolve({ ok: true, status: 200, json: async () => ({ reply: "AI 结果内容", model: "idea-model" }) });
        const result = await p;
        assert.deepStrictEqual(result, { reply: "AI 结果内容", model: "idea-model" }, "返回结构应保持 {reply, model}");
        assert.ok(status.textContent.includes("已收到 DeepSeek 结果（idea-model）"), "应显示成功状态与模型名");
        assert.strictEqual(button.textContent, originalLabel, "按钮文案应由 finally 恢复");
        assert.strictEqual(api.getIdeasAIRequestPending(), false, "pending 应清理");
        assert.strictEqual(api.getIdeasAIRequestController(), null, "controller 应释放");
        assert.strictEqual(snapshotTimers(api).length, timerBefore, "Runner 定时器应清理");
        assert.strictEqual(api._localStorage.getItem(KEYS.ideas), ideasBefore, "AI 请求阶段不得直接写入灵感数据");
    });

    await check("Ideas 迁移后：HTTP/网络/JSON/空 reply 文案与迁移前逐字一致", async () => {
        const cases = [
            ["HTTP 错误", (api) => api._fetch.last().resolve({ ok: false, status: 500, json: async () => ({}) }),
                "AI 服务暂时不可用（HTTP 500），请稍后重试。"],
            ["网络错误", (api) => api._fetch.last().reject(new TypeError("fetch failed")),
                "无法连接 AI 服务，请检查网络或稍后重试。"],
            ["无效 JSON", (api) => api._fetch.last().resolve({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }),
                "AI 服务返回了无效响应（HTTP 200）。"],
            ["空 reply", (api) => api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ model: "x" }) }),
                "AI 服务返回内容为空或格式不正确，请稍后重试。"],
        ];
        for (const [name, act, expected] of cases) {
            const api = loadReadyApi();
            const status = makeElement();
            const p = api.requestIdeasAI("prompt", makeElement(), status, "处理中……");
            await flush();
            act(api);
            const result = await p;
            assert.strictEqual(result, null, name + "：失败应返回 null");
            assert.strictEqual(status.textContent, expected, name + "：文案应与迁移前逐字一致");
            assert.strictEqual(api.getIdeasAIRequestPending(), false, name + "：失败后 pending 应恢复");
        }
    });

    await check("Ideas 迁移后：90 秒超时 → 超时文案 + 资源清理", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api);
        const status = makeElement();
        const p = api.requestIdeasAI("prompt", makeElement(), status, "处理中……");
        await flush();
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added.length, 1, "Runner 应注册 1 个超时定时器");
        assert.strictEqual(added[0][1].delay, 90000, "超时应为 90000ms");
        added[0][1].fn();
        assert.strictEqual(await p, null, "超时应返回 null");
        assert.strictEqual(status.textContent, "请求等待超时。输入内容未更改，请稍后重试。");
        assert.strictEqual(api.getIdeasAIRequestPending(), false);
        assert.strictEqual(api.getIdeasAIRequestController(), null);
        assert.strictEqual(snapshotTimers(api).length, timerBefore.length, "定时器应清理");
    });

    await check("Ideas 迁移后：主动取消 → AbortError 文案 + 状态恢复", async () => {
        const api = loadReadyApi();
        const status = makeElement();
        const p = api.requestIdeasAI("prompt", makeElement(), status, "处理中……");
        await flush();
        api.getIdeasAIRequestController().abort();
        assert.strictEqual(await p, null);
        assert.strictEqual(status.textContent, "请求等待超时。输入内容未更改，请稍后重试。", "取消文案应与迁移前 AbortError 映射一致");
        assert.strictEqual(api.getIdeasAIRequestPending(), false);
        assert.strictEqual(api.getIdeasAIRequestController(), null);
    });

    await check("Ideas 迁移后：AI 总开关关闭 → 在途 abort 且不误报超时", async () => {
        const api = loadReadyApi();
        const status = makeElement();
        const p = api.requestIdeasAI("prompt", makeElement(), status, "处理中……");
        await flush();
        const entry = api._fetch.last();
        api.setModuleEnabled("ai-assistant", false);
        api.updateIdeasWritingAccessUI();
        assert.strictEqual(entry.signal.aborted, true, "在途请求应被 abort");
        assert.strictEqual(await p, null);
        assert.ok(!status.textContent.includes("超时"), "权限拦截不应显示超时文案");
        assert.strictEqual(api.getIdeasAIRequestPending(), false);
        assert.strictEqual(api.getIdeasAIRequestController(), null);
    });

    await check("Ideas 迁移后：失败后可立即重新请求并成功", async () => {
        const api = loadReadyApi();
        const p1 = api.requestIdeasAI("prompt1", makeElement(), makeElement(), "处理中……");
        await flush();
        api._fetch.last().resolve({ ok: false, status: 503, json: async () => ({}) });
        assert.strictEqual(await p1, null);
        const status = makeElement();
        const p2 = api.requestIdeasAI("prompt2", makeElement(), status, "处理中……");
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "应可立即发起新请求");
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "ok", model: "m" }) });
        const result = await p2;
        assert.deepStrictEqual(result, { reply: "ok", model: "m" }, "第二次请求应成功");
    });

    await check("跨工作流独立性：Document 取消不影响在途 Ideas", async () => {
        const api = loadReadyApi();
        api.documentSourceInput.value = "独立性资料。";
        const docP = api.organizeCurrentDocument();
        await flush();
        const ideasStatus = makeElement();
        const ideasP = api.requestIdeasAI("prompt", makeElement(), ideasStatus, "处理中……");
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "两个工作流应同时在途");
        const ideasEntry = api._fetch.pending[1];
        api.getDocumentController().abort(); // Document 主动取消
        await docP;
        assert.strictEqual(ideasEntry.signal.aborted, false, "取消 Document 不得波及 Ideas");
        ideasEntry.resolve({ ok: true, status: 200, json: async () => ({ reply: "ok", model: "m" }) });
        const result = await ideasP;
        assert.deepStrictEqual(result, { reply: "ok", model: "m" }, "Ideas 应不受干扰地完成");
    });

    await check("跨工作流独立性：Ideas 超时不影响在途 Document", async () => {
        const api = loadReadyApi();
        const timerBefore = snapshotTimers(api).length;
        api.documentSourceInput.value = "超时独立性资料。";
        const docP = api.organizeCurrentDocument();
        await flush();
        const ideasP = api.requestIdeasAI("prompt", makeElement(), makeElement(), "处理中……");
        await flush();
        const added = snapshotTimers(api).slice(timerBefore.length);
        assert.strictEqual(added.length, 2, "两个工作流各自注册定时器");
        added[1][1].fn(); // 触发 Ideas 的超时定时器
        assert.strictEqual(await ideasP, null, "Ideas 应超时失败");
        assert.strictEqual(api.getDocumentPending(), true, "Document 应保持 pending 不受影响");
        api._fetch.pending[0].resolve({ ok: true, status: 200, json: VALID_DOC_REPLY });
        assert.strictEqual(await docP, true, "Document 应不受干扰地完成");
    });

    await check("跨工作流独立性：document-summary 停用不误阻断 Ideas 与 Notes", async () => {
        const api = loadReadyApi();
        api.setModuleEnabled("document-summary", false);
        const notesOk = api.persistNotes([{ ...VALID_NOTE, id: "n10", text: "notes fine" }]);
        assert.strictEqual(notesOk, true, "Notes 不应受 document-summary 停用影响");
        const status = makeElement();
        const p = api.requestIdeasAI("prompt", makeElement(), status, "处理中……");
        await flush();
        assert.strictEqual(api._fetch.pending.length, 1, "Ideas 应可正常发起请求");
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "ok", model: "m" }) });
        assert.deepStrictEqual(await p, { reply: "ok", model: "m" }, "Ideas 应正常完成");
    });

    // ============================================================
    // Task 18：AI Assistant 迁移至统一 Request Runner（聊天/错误文案/重试专项）
    // ============================================================
    console.log("\n=== Task 18: AI Assistant → Request Runner 迁移 ===");

    const chatTexts = (api) => {
        const chat = api._document.getElementById("ai-chat-log");
        const texts = [];
        const walk = (node) => {
            node.children.forEach((child) => {
                if (child.tagName === "P") texts.push(String(child.textContent));
                walk(child);
            });
        };
        walk(chat);
        return texts;
    };
    const findRetryButtons = (api) => {
        const chat = api._document.getElementById("ai-chat-log");
        const buttons = [];
        const walk = (node) => {
            node.children.forEach((child) => {
                if (child.tagName === "BUTTON" && String(child.className).includes("ai-chat-retry")) {
                    buttons.push(child);
                }
                walk(child);
            });
        };
        walk(chat);
        return buttons;
    };

    await check("Assistant 迁移：首次请求成功 + 历史传递 + 消息无重复", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "第一问" });
        const p1 = api.requestAssistantReply();
        assert.strictEqual(api._fetch.pending.length, 1);
        assert.deepStrictEqual(
            JSON.parse(api._fetch.last().opts.body).messages,
            [{ role: "user", content: "第一问" }],
            "请求体应为完整对话历史（messages 契约）"
        );
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "第一答", model: "m1" }) });
        await p1;
        assert.deepStrictEqual(
            api.aiConversation,
            [{ role: "user", content: "第一问" }, { role: "assistant", content: "第一答" }],
            "成功后应恰好追加一条 assistant 消息"
        );
        assert.strictEqual(chatTexts(api).filter((t) => t === "第一答").length, 1, "AI 回复不得重复显示");
        assert.strictEqual(api.getAiRequestPending(), false);
        assert.strictEqual(api.getAiRequestController(), null, "controller 应释放");

        // 连续对话：第二轮请求应携带完整上下文
        api.aiConversation.push({ role: "user", content: "第二问" });
        const p2 = api.requestAssistantReply();
        assert.deepStrictEqual(
            JSON.parse(api._fetch.last().opts.body).messages,
            [
                { role: "user", content: "第一问" },
                { role: "assistant", content: "第一答" },
                { role: "user", content: "第二问" }
            ],
            "连续对话应传递完整历史上下文"
        );
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "第二答", model: "m1" }) });
        await p2;
        assert.strictEqual(api.aiConversation.filter((m) => m.role === "user").length, 2, "用户消息不得重复追加");
        assert.strictEqual(api.aiConversation.length, 4, "对话长度应为 4");
    });

    await check("Assistant 迁移：HTTP 异常文案逐字一致", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "http" });
        const p = api.requestAssistantReply();
        api._fetch.last().resolve({ ok: false, status: 503, json: async () => ({}) });
        await p;
        assert.ok(
            chatTexts(api).includes("AI 服务暂时不可用（HTTP 503）。请稍后重试。"),
            "HTTP 文案应逐字一致，实际：" + JSON.stringify(chatTexts(api))
        );
        assert.strictEqual(findRetryButtons(api).length, 1, "失败消息应带重试入口");
        assert.strictEqual(api.getAiRequestPending(), false, "失败后 pending 应恢复");
    });

    await check("Assistant 迁移：网络异常文案逐字一致（句号变体）", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "net" });
        const p = api.requestAssistantReply();
        api._fetch.last().reject(new TypeError("Failed to fetch"));
        await p;
        assert.ok(
            chatTexts(api).includes("无法连接 AI 服务。请检查网络或稍后重试。"),
            "网络文案应保持 Assistant 原句号变体，实际：" + JSON.stringify(chatTexts(api))
        );
    });

    await check("Assistant 迁移：无效 JSON 与空 reply 文案分别逐字一致", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "badjson" });
        const p1 = api.requestAssistantReply();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
        await p1;
        assert.ok(
            chatTexts(api).includes("Worker 返回了无效的 JSON 响应（HTTP 200）。"),
            "无效 JSON 文案应逐字一致，实际：" + JSON.stringify(chatTexts(api))
        );

        api.aiConversation.push({ role: "user", content: "empty" });
        const p2 = api.requestAssistantReply();
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ model: "m1" }) });
        await p2;
        assert.ok(
            chatTexts(api).includes("AI 服务返回的数据格式不正确。请稍后重试。"),
            "空 reply 文案应逐字一致，实际：" + JSON.stringify(chatTexts(api))
        );
        assert.strictEqual(api.aiConversation.filter((m) => m.role === "assistant").length, 0, "两类失败均不得写入 AI 回复");
    });

    await check("Assistant 重试：失败 → 点击重试 → 成功，历史正确且无重复请求", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "重试问题" });
        const p1 = api.requestAssistantReply();
        api._fetch.pending[0].resolve({ ok: false, status: 500, json: async () => ({}) });
        await p1;
        const retryButtons = findRetryButtons(api);
        assert.strictEqual(retryButtons.length, 1, "失败后应出现一个重试按钮");
        assert.strictEqual(api.getAiRequestPending(), false, "失败后 pending 应恢复，允许重试");

        // 重试发起 1 个新请求；在途时再次发起应受互斥保护（不产生第 3 个请求）
        const guardP = api.requestAssistantReply();
        const guardExtra = api.requestAssistantReply();
        await guardExtra;
        assert.strictEqual(api._fetch.pending.length, 2, "互斥保护：在途时再次发起不得产生重复请求");

        api._fetch.pending[1].resolve({ ok: true, status: 200, json: async () => ({ reply: "重试成功", model: "m1" }) });
        await guardP;
        assert.deepStrictEqual(
            JSON.parse(api._fetch.pending[1].opts.body).messages,
            [{ role: "user", content: "重试问题" }],
            "重试应使用原有对话历史（用户消息不重复 push）"
        );
        assert.deepStrictEqual(
            api.aiConversation,
            [{ role: "user", content: "重试问题" }, { role: "assistant", content: "重试成功" }],
            "重试成功后对话应为 1 问 1 答"
        );
        assert.strictEqual(chatTexts(api).filter((t) => t === "重试成功").length, 1, "回复不得重复显示");
    });

    await check("Assistant 重试：连续失败可再次重试，重试按钮语义保持", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "再试一次" });
        const p1 = api.requestAssistantReply();
        api._fetch.pending[0].reject(new TypeError("down"));
        await p1;
        // 第一次重试
        const p2 = api.requestAssistantReply();
        api._fetch.pending[1].resolve({ ok: true, status: 200, json: async () => { throw new Error("bad"); } });
        await p2;
        // 第二次重试
        const p3 = api.requestAssistantReply();
        api._fetch.pending[2].resolve({ ok: true, status: 200, json: async () => ({ reply: "终于成功", model: "m" }) });
        await p3;
        assert.ok(api.aiConversation.some((m) => m.role === "assistant" && m.content === "终于成功"), "连续失败后仍可重试成功");
        assert.strictEqual(api.aiConversation.filter((m) => m.role === "user").length, 1, "全程用户消息只入列一次");
        // retry 按钮点击应真正绑定到 requestAssistantReply
        const buttons = findRetryButtons(api);
        assert.ok(buttons.length >= 1, "失败消息应保留重试入口");
        assert.ok(buttons[0]._listeners.click && buttons[0]._listeners.click.length >= 1, "重试按钮应绑定 click 处理函数");
    });

    await check("Assistant 重试：retry 按钮点击链路真实生效", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "按钮链路" });
        const p1 = api.requestAssistantReply();
        api._fetch.pending[0].resolve({ ok: false, status: 500, json: async () => ({}) });
        await p1;
        const button = findRetryButtons(api)[0];
        const p2 = button._listeners.click[0]();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "点击重试按钮应重新发起请求");
        api._fetch.pending[1].resolve({ ok: true, status: 200, json: async () => ({ reply: "按钮重试成功", model: "m" }) });
        await p2;
        assert.ok(api.aiConversation.some((m) => m.role === "assistant" && m.content === "按钮重试成功"), "按钮重试应成功");
    });

    await check("Assistant 迁移：在途停用静默丢弃（不误报超时、不写对话）", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "停用中" });
        const p = api.requestAssistantReply();
        api.setModuleEnabled("ai-assistant", false);
        api.updateAssistantAccessUI();
        const textsBefore = chatTexts(api).length;
        api._fetch.last().resolve({ ok: true, status: 200, json: async () => ({ reply: "不应出现", model: "m" }) });
        await p;
        const textsAfter = chatTexts(api);
        assert.ok(
            !textsAfter.some((t) => t.includes("AI 请求等待超时")),
            "停用导致的 abort 不得误报超时文案"
        );
        assert.ok(
            !textsAfter.slice(textsBefore).some((t) => t === "不应出现"),
            "迟到响应不得写入聊天"
        );
        assert.strictEqual(api.aiConversation.filter((m) => m.role === "assistant").length, 0, "停用后不得写入对话历史");
        assert.strictEqual(api.getAiRequestPending(), false);
    });

    await check("Assistant 迁移：与其他工作流经同一 Runner 互不污染", async () => {
        const api = loadReadyApi();
        api.aiConversation.push({ role: "user", content: "共存" });
        const assistantP = api.requestAssistantReply();
        const planningP = api.runDailyPlanningAnalysis();
        await flush();
        assert.strictEqual(api._fetch.pending.length, 2, "两条链路应各有一个在途请求");
        const entries = api._fetch.pending.slice();
        entries[0].resolve({ ok: true, status: 200, json: async () => ({ reply: "答", model: "m" }) });
        entries[1].resolve({ ok: true, status: 200, json: async () => ({ reply: "", model: "" }) });
        await assistantP;
        assert.ok(api.aiConversation.some((m) => m.role === "assistant" && m.content === "答"), "Assistant 应正常完成");
        assert.strictEqual(api.getAiRequestController(), null, "Assistant controller 应独立释放");
        assert.strictEqual(
            JSON.parse(entries[1].opts.body).messages.some((m) => m.content === "共存"),
            false,
            "Planning 请求不得混入 Assistant 对话内容"
        );
        await planningP;
        assert.strictEqual(api.getDailyPlanningPending(), false, "Planning 结束后应清理自身状态");
        assert.strictEqual(api.getDailyPlanningController(), null, "Planning controller 应独立释放");
    });

    // ============================================================
    // 汇总
    // ============================================================
    console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========\n`);
    if (failed > 0) {
        console.log("失败明细：");
        for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    }
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error("测试运行异常：", error);
    process.exit(1);
});
