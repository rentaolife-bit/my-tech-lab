// My Tech Lab 阶段1 — Task 通用字段增强（dueDate / completedAt / note）测试
// 隔离环境：mock DOM / mock localStorage，不触碰真实浏览器数据，不发真实 AI 请求。
// 运行：node tests/task-fields.test.js

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
        closest() { return null; },
        _matches(sel) {
            if (sel.startsWith(".")) {
                const cls = sel.slice(1);
                return (this.className || "").split(/\s+/).includes(cls) || this.classList.contains(cls);
            }
            return false;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
    };
    return el;
}

function makeDocument() {
    const byId = new Map();
    return {
        body: makeElement("body"),
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, makeElement("div"));
            return byId.get(id);
        },
        querySelector() { return makeElement("div"); },
        querySelectorAll() { return []; },
        createElement(tag) { return makeElement(tag); },
        createTextNode(text) { const node = makeElement("#text"); node.textContent = String(text); return node; },
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

// ---------- 4. 可捕获定时器 ----------
function makeTimers() {
    const map = new Map();
    return {
        setTimeout(fn, delay) { const id = map.size + 1; map.set(id, { fn, delay }); return id; },
        clearTimeout(id) { map.delete(id); },
        _map: map,
    };
}

// ---------- 5. 组装环境并加载真实脚本 ----------
function loadApi(options = {}) {
    const localStorage = options.localStorage || makeStorage(options.seed || {});
    const timers = makeTimers();
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
    isValidTask, isValidTaskDate, isDueDateOverdue,
    loadTasks, loadDailyFocus, persistTasks, toggleTask, changeTaskPriority, deleteTask,
    startEditTask, cancelEditTask, resetTaskForm,
    getTasks: () => tasks,
    getEditingTaskId: () => editingTaskId,
    tasksStorageKey, dataCenterModules,
    createDataCenterBackup, validateDataCenterBackup,
    taskForm, taskInput, taskPriority, taskDueDate, taskNoteInput, taskAdd, taskCancelEdit, taskFieldLabel, tasksStatus
};`;

    const fn = new Function(
        "document", "localStorage", "window", "fetch", "AbortController", "URL",
        scriptBody + returnStmt
    );
    const api = fn(
        document,
        localStorage,
        window,
        () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
        AbortController,
        { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} }
    );
    api._localStorage = localStorage;
    api._document = document;
    // 预加载 Daily Focus，避免 renderTasks 触发 refreshDailyPlanning 时因数据未就绪而打印错误日志
    try { api.loadDailyFocus(); } catch (error) { /* 忽略：仅用于减少 mock 环境噪音 */ }
    return api;
}

// ---------- 6. 测试运行器 ----------
// 静默预期错误路径的 console.error（如非法数据被拒）；断言失败仍通过 throw 捕获并报告
console.error = () => {};

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ✅ ${name}`);
    } catch (error) {
        failed += 1;
        console.log(`  ❌ ${name}\n     ${error.message}`);
    }
}

const TASKS_KEY = "my-tech-lab-tasks";
const OLD_TASK = { id: "t1", text: "do", priority: "medium", completed: false, createdAt: "2026-01-01T00:00:00.000Z" };
const NEW_TASK = {
    id: "t2", text: "learn", priority: "high", completed: true,
    createdAt: "2026-01-02T00:00:00.000Z",
    completedAt: "2026-01-02T03:00:00.000Z",
    dueDate: "2026-11-20",
    note: "watch video"
};

function submitTaskForm(api) {
    api.taskForm.dispatchEvent({ type: "submit", preventDefault() {} });
}

console.log("\n=== 1. isValidTaskDate 日期格式校验 ===");
check("合法 YYYY-MM-DD → true", () => {
    assert.strictEqual(loadApi().isValidTaskDate("2026-11-20"), true);
});
check("非法格式 → false", () => {
    assert.strictEqual(loadApi().isValidTaskDate("11/20/2026"), false);
});
check("非法日期值（2月30日）→ false", () => {
    assert.strictEqual(loadApi().isValidTaskDate("2026-02-30"), false);
});
check("非字符串 → false", () => {
    assert.strictEqual(loadApi().isValidTaskDate(20261120), false);
});

console.log("\n=== 2. isValidTask 老数据与新增字段校验 ===");
check("老任务（无新增字段）→ true", () => {
    assert.strictEqual(loadApi().isValidTask(OLD_TASK), true);
});
check("含全部新增字段 → true", () => {
    assert.strictEqual(loadApi().isValidTask(NEW_TASK), true);
});
check("空可选字段（dueDate=\"\" completedAt=null note=\"\"）→ true", () => {
    const t = { ...OLD_TASK, completedAt: null, dueDate: "", note: "" };
    assert.strictEqual(loadApi().isValidTask(t), true);
});
check("非法 dueDate → false", () => {
    assert.strictEqual(loadApi().isValidTask({ ...OLD_TASK, dueDate: "bad-date" }), false);
});
check("非法 completedAt → false", () => {
    assert.strictEqual(loadApi().isValidTask({ ...OLD_TASK, completedAt: 12345 }), false);
});
check("非法 note 类型 → false", () => {
    assert.strictEqual(loadApi().isValidTask({ ...OLD_TASK, note: 42 }), false);
});
check("缺失必需字段 → false", () => {
    assert.strictEqual(loadApi().isValidTask({ id: "x", text: "y", priority: "medium", completed: false }), false);
});

console.log("\n=== 2.5 isDueDateOverdue 逾期判断 ===");
check("过去日期（相对固定参考日）→ true", () => {
    assert.strictEqual(loadApi().isDueDateOverdue("2026-11-01", new Date(2026, 10, 7)), true);
});
check("未来日期 → false", () => {
    assert.strictEqual(loadApi().isDueDateOverdue("2026-11-20", new Date(2026, 10, 7)), false);
});
check("当天日期 → false（当天不算逾期）", () => {
    assert.strictEqual(loadApi().isDueDateOverdue("2026-11-07", new Date(2026, 10, 7)), false);
});
check("空值 / 非法值 → false", () => {
    assert.strictEqual(loadApi().isDueDateOverdue(""), false);
    assert.strictEqual(loadApi().isDueDateOverdue("bad-date"), false);
    assert.strictEqual(loadApi().isDueDateOverdue(undefined), false);
});
check("跨年边界：12-31 相对次年 1-1 → true", () => {
    assert.strictEqual(loadApi().isDueDateOverdue("2026-12-31", new Date(2027, 0, 1)), true);
});

console.log("\n=== 3. loadTasks 兼容老数据与新数据 ===");
check("老数据加载成功", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([OLD_TASK]) } });
    api.loadTasks();
    assert.strictEqual(api.getTasks().length, 1);
    assert.strictEqual(api.getTasks()[0].text, "do");
});
check("新数据加载成功且字段保留", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([NEW_TASK]) } });
    api.loadTasks();
    const t = api.getTasks()[0];
    assert.strictEqual(t.dueDate, "2026-11-20");
    assert.strictEqual(t.completedAt, "2026-01-02T03:00:00.000Z");
    assert.strictEqual(t.note, "watch video");
});
check("非法新数据加载失败（不静默丢弃）", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([{ ...OLD_TASK, dueDate: "oops" }]) } });
    api.loadTasks();
    assert.strictEqual(api.getTasks().length, 0);
});

console.log("\n=== 4. toggleTask 完成 / 取消完成的时间记录 ===");
check("完成时自动记录 completedAt", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([OLD_TASK]) } });
    api.loadTasks();
    api.toggleTask("t1");
    const t = api.getTasks()[0];
    assert.strictEqual(t.completed, true);
    assert.strictEqual(typeof t.completedAt, "string");
    assert.ok(!Number.isNaN(Date.parse(t.completedAt)));
});
check("取消完成时 completedAt 清空为 null", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([NEW_TASK]) } });
    api.loadTasks();
    api.toggleTask("t2");
    const t = api.getTasks()[0];
    assert.strictEqual(t.completed, false);
    assert.strictEqual(t.completedAt, null);
});

console.log("\n=== 5. persistTasks 保存新增字段 ===");
check("含新增字段的任务持久化到 localStorage", () => {
    const api = loadApi();
    api.loadTasks();
    api.persistTasks([NEW_TASK]);
    const raw = JSON.parse(api._localStorage.getItem(TASKS_KEY));
    assert.strictEqual(raw[0].dueDate, "2026-11-20");
    assert.strictEqual(raw[0].note, "watch video");
    assert.strictEqual(raw[0].completedAt, "2026-01-02T03:00:00.000Z");
});

console.log("\n=== 6. 编辑流程 ===");
check("startEditTask 回填表单并进入编辑态", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([NEW_TASK]) } });
    api.loadTasks();
    api.startEditTask("t2");
    assert.strictEqual(api.taskInput.value, "learn");
    assert.strictEqual(api.taskPriority.value, "high");
    assert.strictEqual(api.taskDueDate.value, "2026-11-20");
    assert.strictEqual(api.taskNoteInput.value, "watch video");
    assert.strictEqual(api.taskAdd.textContent, "Save changes");
    assert.strictEqual(api.taskCancelEdit.hidden, false);
    assert.strictEqual(api.taskFieldLabel.textContent, "Edit task");
});
check("cancelEditTask 清空表单并退出编辑态", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([NEW_TASK]) } });
    api.loadTasks();
    api.startEditTask("t2");
    api.cancelEditTask();
    assert.strictEqual(api.getEditingTaskId(), null);
    assert.strictEqual(api.taskInput.value, "");
    assert.strictEqual(api.taskAdd.textContent, "Add task");
    assert.strictEqual(api.taskCancelEdit.hidden, true);
});
check("编辑保存后数据正确更新且表单重置", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([NEW_TASK]) } });
    api.loadTasks();
    api.startEditTask("t2");
    api.taskInput.value = "updated text";
    api.taskDueDate.value = "2026-11-28";
    api.taskNoteInput.value = "new note";
    submitTaskForm(api);
    const t = api.getTasks()[0];
    assert.strictEqual(t.text, "updated text");
    assert.strictEqual(t.dueDate, "2026-11-28");
    assert.strictEqual(t.note, "new note");
    assert.strictEqual(api.getEditingTaskId(), null);
    assert.strictEqual(api.taskAdd.textContent, "Add task");
});

console.log("\n=== 7. Data Center 备份校验兼容新增字段 ===");
check("task-manager 校验：老数据 → 通过", () => {
    const api = loadApi();
    const taskModule = api.dataCenterModules.find((m) => m.id === "task-manager");
    assert.strictEqual(taskModule.validate([OLD_TASK]), true);
});
check("task-manager 校验：含新增字段 → 通过", () => {
    const api = loadApi();
    const taskModule = api.dataCenterModules.find((m) => m.id === "task-manager");
    assert.strictEqual(taskModule.validate([NEW_TASK]), true);
});
check("task-manager 校验：非法字段 → 拒绝", () => {
    const api = loadApi();
    const taskModule = api.dataCenterModules.find((m) => m.id === "task-manager");
    assert.strictEqual(taskModule.validate([{ ...OLD_TASK, note: 1 }]), false);
});
check("导出备份再校验：含新增字段任务往返通过", () => {
    const api = loadApi({ seed: { [TASKS_KEY]: JSON.stringify([NEW_TASK]) } });
    api.loadTasks();
    const backup = api.createDataCenterBackup();
    // 校验不抛错
    assert.doesNotThrow(() => api.validateDataCenterBackup(backup));
    // 备份中的 tasks 数据含新增字段
    const taskEntry = backup.modules.find((m) => m.id === "task-manager");
    assert.strictEqual(taskEntry.data[0].dueDate, "2026-11-20");
    assert.strictEqual(taskEntry.data[0].note, "watch video");
});

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========\n`);
process.exit(failed > 0 ? 1 : 0);
