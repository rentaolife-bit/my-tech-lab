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
        children: [],
        dataset: {},
        style: {},
        classList: {
            add() {}, remove() {}, toggle() {}, contains() { return false; }
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
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] !== undefined ? this[k] : null; },
        removeAttribute(k) { delete this[k]; },
        hasAttribute(k) { return this[k] !== undefined; },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentElement = this; } },
        appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
        replaceChildren(...nodes) { this.children = nodes.slice(); },
        remove() {},
        focus() {},
        scrollIntoView() {},
        click() {},
        before() {},
        after() {},
        closest() { return null; },
        requestSubmit() {},
        querySelector(sel) { const e = makeElement(); e.parentElement = this; return e; },
        querySelectorAll() { return []; },
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
                const onAbort = () => reject(new Error("AbortError"));
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

// ---------- 5. 组装环境并加载真实脚本 ----------
function loadApi(options = {}) {
    const localStorage = options.localStorage || makeStorage(options.seed || {});
    const fetchMock = options.fetch || makeMockFetch();
    const document = makeDocument();
    const window = {
        setTimeout: () => 0,
        clearTimeout: () => {},
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
    toggleTask, deleteTask, startDailyFocus,
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
    getDailyPlanningPending: () => dailyPlanningAIRequestPending,
    getDailyPlanningController: () => dailyPlanningRequestController,
    getDailyPlanningAnalysis: () => dailyPlanningAnalysis,
    // --- AI：Task Organization ---
    organizeTasks, updateTaskOrganizationAccessUI, taskOrganizerInput, taskOrganizerStatus,
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
    aiWorkerEndpoint,
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
    await check("persistDailyFocus：启用时正常写入", () => {
        const api = loadReadyApi();
        const r = api.persistDailyFocus({ date: api.getDailyFocus().date, priorities: ["a", "", ""] });
        assert.strictEqual(r, true);
        const stored = JSON.parse(api._localStorage.getItem(KEYS.dailyFocus));
        assert.strictEqual(stored.records[api.getDailyFocus().date].priorities[0], "a");
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
