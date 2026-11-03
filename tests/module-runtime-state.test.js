// My Tech Lab 统一模块状态判断机制（只读控制）隔离测试
// 使用内存模拟 localStorage，不触碰真实浏览器存储。
const fs = require("fs");
const assert = require("assert");

const path = require("path");
const HTML_PATH = process.env.MTL_HTML_PATH
    ? path.resolve(process.env.MTL_HTML_PATH)
    : path.resolve(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

const start = html.indexOf("const moduleRegistry = Object.freeze([");
const end = html.indexOf("// Projects is static presentation content");
if (start < 0 || end < 0) {
    throw new Error("无法定位模块代码块");
}
const extracted = html.slice(start, end);

function makeApi(initialStore = {}) {
    const store = new Map(Object.entries(initialStore));
    const mockLocalStorage = {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { store.delete(key); },
        _store: store
    };
    const code = extracted + `
; return {
    MODULE_READONLY_MESSAGE,
    getModuleById, protectedModuleIds,
    getModuleRuntimeState, isModuleReadOnly, canModulePerformAction,
    getModuleAccessStatus, setModuleEnabled, isModuleEffectivelyEnabled
};`;
    const fn = new Function("localStorage", "setModuleAccessMessage", code);
    const api = fn(mockLocalStorage, () => {});
    api._localStorage = mockLocalStorage;
    return api;
}

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

console.log("\n=== 1. 模块存在性 ===");
check("未知模块 → exists=false 且 readonly=true", () => {
    const api = makeApi();
    const s = api.getModuleRuntimeState("no-such-module");
    assert.strictEqual(s.exists, false);
    assert.strictEqual(s.readonly, true);
    assert.strictEqual(s.state, "unknown-module");
});

console.log("\n=== 2. 系统保护模块 ===");
check("Data Center / MMC 始终启用、非只读", () => {
    const api = makeApi();
    for (const id of ["data-center", "module-management-center"]) {
        const s = api.getModuleRuntimeState(id);
        assert.strictEqual(s.protected, true);
        assert.strictEqual(s.effectiveEnabled, true);
        assert.strictEqual(s.readonly, false);
        assert.strictEqual(s.state, "enabled");
        assert.strictEqual(api.isModuleReadOnly(id), false);
    }
});
check("保护模块无法停用", () => {
    const api = makeApi();
    const r = api.setModuleEnabled("data-center", false);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "protected-module");
});

console.log("\n=== 3. 普通模块启用/停用 ===");
check("默认启用 → 非只读", () => {
    const api = makeApi();
    const s = api.getModuleRuntimeState("quick-notes");
    assert.strictEqual(s.effectiveEnabled, true);
    assert.strictEqual(s.readonly, false);
    assert.strictEqual(s.state, "enabled");
});
check("停用后 → readonly=true，消息为统一只读文案", () => {
    const api = makeApi();
    api.setModuleEnabled("quick-notes", false);
    const s = api.getModuleRuntimeState("quick-notes");
    assert.strictEqual(s.readonly, true);
    assert.strictEqual(s.state, "disabled");
    assert.strictEqual(s.message, api.MODULE_READONLY_MESSAGE);
    assert.strictEqual(s.message, "该模块已停用，目前处于只读状态。重新启用后可恢复操作。");
});
check("isModuleReadOnly 区分启用/停用", () => {
    const api = makeApi();
    assert.strictEqual(api.isModuleReadOnly("task-manager"), false);
    api.setModuleEnabled("task-manager", false);
    assert.strictEqual(api.isModuleReadOnly("task-manager"), true);
});
check("canModulePerformAction 在停用时拒绝并给只读提示", () => {
    const api = makeApi();
    assert.strictEqual(api.canModulePerformAction("daily-focus").allowed, true);
    api.setModuleEnabled("daily-focus", false);
    const r = api.canModulePerformAction("daily-focus");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.message, api.MODULE_READONLY_MESSAGE);
});
check("重新启用后恢复非只读", () => {
    const api = makeApi();
    api.setModuleEnabled("quick-notes", false);
    api.setModuleEnabled("quick-notes", true);
    assert.strictEqual(api.isModuleReadOnly("quick-notes"), false);
});

console.log("\n=== 4. 父子级联 ===");
check("停用 ai-assistant → 子工作流 parent-disabled + readonly", () => {
    const api = makeApi();
    api.setModuleEnabled("ai-assistant", false);
    for (const id of ["daily-planning", "task-organization", "document-summary", "ideas-writing"]) {
        const s = api.getModuleRuntimeState(id);
        assert.strictEqual(s.readonly, true, `${id} 应为只读`);
        assert.strictEqual(s.state, "parent-disabled", `${id} 应为 parent-disabled`);
        assert.strictEqual(s.parentEnabled, false);
        assert.ok(s.message.includes("父模块"), `${id} 消息应提及父模块`);
    }
});
check("子工作流自身停用 → self disabled（父仍启用）", () => {
    const api = makeApi();
    api.setModuleEnabled("daily-planning", false);
    const s = api.getModuleRuntimeState("daily-planning");
    assert.strictEqual(s.readonly, true);
    assert.strictEqual(s.state, "disabled");
    assert.strictEqual(s.message, api.MODULE_READONLY_MESSAGE);
});

console.log("\n=== 5. getModuleAccessStatus 委托一致性 ===");
check("enabled 状态一致", () => {
    const api = makeApi();
    const a = api.getModuleAccessStatus("quick-notes");
    assert.deepStrictEqual(a, { enabled: true, state: "enabled", message: "" });
});
check("disabled 状态与只读消息一致", () => {
    const api = makeApi();
    api.setModuleEnabled("quick-notes", false);
    const a = api.getModuleAccessStatus("quick-notes");
    assert.strictEqual(a.enabled, false);
    assert.strictEqual(a.state, "disabled");
    assert.strictEqual(a.message, api.MODULE_READONLY_MESSAGE);
});

console.log("\n=== 6. 设置异常时 fail-closed ===");
check("损坏设置 → 普通模块 readonly（保护模块除外）", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": "{corrupt"
    });
    assert.strictEqual(api.isModuleReadOnly("quick-notes"), true);
    // 保护模块仍可用
    assert.strictEqual(api.isModuleReadOnly("data-center"), false);
});

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========\n`);
process.exit(failed > 0 ? 1 : 0);
