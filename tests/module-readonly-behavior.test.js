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
    createDataCenterBackup, confirmDataCenterImport, applyDataCenterData, dataCenterModules,
    validateDataCenterBackup, importOrganizedTasks,
    setDataCenterPendingBackup: (v) => { dataCenterPendingBackup = v; },
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
};

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
