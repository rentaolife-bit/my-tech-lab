// My Tech Lab 模块设置 schemaVersion 2 迁移/校验/恢复 隔离测试
// 测试使用内存模拟 localStorage，不触碰真实浏览器存储。
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
    throw new Error("无法定位模块设置代码块");
}
const extracted = html.slice(start, end);

// 构建可执行函数，注入 mock localStorage 与 stub setModuleAccessMessage
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
    moduleSettingsStorageKey, moduleSettingsSchemaVersion,
    legacyModuleSettingsSchemaVersion, moduleSettingsRecoveryStorageKey,
    protectedModuleIds, getModuleById,
    freezeModuleSettings, validateModuleSettings, parseModuleSettings,
    readModuleSettings, writeModuleSettings, migrateModuleSettings,
    recoverModuleSettings, getModuleSettings, getUserModuleEnabledState,
    isModuleEffectivelyEnabled, setModuleEnabled, getModuleSettingsStatus,
    getModuleAccessStatus
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

console.log("\n=== 1. 空存储 / v2 直接读取 ===");
check("空存储 → available 且 schemaVersion=2", () => {
    const api = makeApi();
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.state, "available");
    assert.strictEqual(r.settings.schemaVersion, 2);
    assert.deepStrictEqual(r.settings.enabledById, {});
    assert.strictEqual(r.needsMigration, false);
});
check("v2 数据直接读取不迁移", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 2, enabledById: { "quick-notes": false } })
    });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.needsMigration, false);
    assert.strictEqual(r.settings.enabledById["quick-notes"], false);
});

console.log("\n=== 2. schemaVersion 1 → 2 迁移 ===");
check("v1 读取标记 needsMigration 且内容保留", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 1, enabledById: { "task-manager": false } })
    });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.state, "legacy");
    assert.strictEqual(r.needsMigration, true);
    assert.strictEqual(r.settings.enabledById["task-manager"], false);
});
check("migrateModuleSettings 将 v1 写成 v2，内容不变", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 1, enabledById: { "quick-notes": false } })
    });
    const m = api.migrateModuleSettings();
    assert.strictEqual(m.ok, true);
    assert.strictEqual(m.state, "migrated");
    const raw = api._localStorage.getItem("my-tech-lab-module-settings");
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.schemaVersion, 2);
    assert.deepStrictEqual(parsed.enabledById, { "quick-notes": false });
});
check("migrate 后再次读取 needsMigration=false", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 1, enabledById: {} })
    });
    api.migrateModuleSettings();
    const r = api.readModuleSettings();
    assert.strictEqual(r.needsMigration, false);
    assert.strictEqual(r.settings.schemaVersion, 2);
});

console.log("\n=== 3. 损坏 / 异常数据检测 ===");
check("JSON 损坏 → corrupt", () => {
    const api = makeApi({ "my-tech-lab-module-settings": "{not valid json" });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "corrupt");
});
check("未知版本 → unsupported-version", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 99, enabledById: {} })
    });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "unsupported-version");
});
check("顶层非对象 → invalid", () => {
    const api = makeApi({ "my-tech-lab-module-settings": JSON.stringify([1, 2, 3]) });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "invalid");
});
check("enabledById 非对象 → invalid", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 2, enabledById: "oops" })
    });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "invalid");
});
check("未知模块 ID → invalid", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 2, enabledById: { "nope-module": false } })
    });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "invalid");
});
check("受保护模块被停用 → invalid", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 2, enabledById: { "data-center": false } })
    });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "invalid");
});
check("多余字段 → invalid", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 2, enabledById: {}, extra: 1 })
    });
    const r = api.readModuleSettings();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "invalid");
});

console.log("\n=== 4. 迁移失败保护（不覆盖/删除原数据）===");
check("setItem 抛错 → 迁移失败且原 v1 数据不变", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 1, enabledById: { "quick-notes": false } })
    });
    const originalRaw = api._localStorage.getItem("my-tech-lab-module-settings");
    // 让后续 setItem 全部失败
    api._localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
    const m = api.migrateModuleSettings();
    assert.strictEqual(m.ok, false);
    assert.strictEqual(api._localStorage.getItem("my-tech-lab-module-settings"), originalRaw);
});
check("并发修改（expectedRaw 不匹配）→ 不覆盖", () => {
    const api = makeApi({
        "my-tech-lab-module-settings": JSON.stringify({ schemaVersion: 1, enabledById: {} })
    });
    // 直接改成另一个值，模拟另一标签页已写入
    api._localStorage.setItem("my-tech-lab-module-settings", JSON.stringify({ schemaVersion: 2, enabledById: { "quick-notes": false } }));
    const w = api.writeModuleSettings(
        { schemaVersion: 2, enabledById: {} },
        JSON.stringify({ schemaVersion: 1, enabledById: {} })
    );
    assert.strictEqual(w.ok, false);
    assert.strictEqual(w.state, "concurrent-modification");
});

console.log("\n=== 5. 恢复机制 ===");
check("corrupt 数据恢复 → 隔离保存 + 重置为默认", () => {
    const api = makeApi({ "my-tech-lab-module-settings": "{corrupt!!!" });
    const badRaw = api._localStorage.getItem("my-tech-lab-module-settings");
    const res = api.recoverModuleSettings();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.state, "recovered");
    // 主键被重置为合法 v2 空设置
    const main = JSON.parse(api._localStorage.getItem("my-tech-lab-module-settings"));
    assert.deepStrictEqual(main, { schemaVersion: 2, enabledById: {} });
    // 隔离键保存了原始损坏内容
    const quarantine = JSON.parse(api._localStorage.getItem("my-tech-lab-module-settings-recovery"));
    assert.strictEqual(quarantine.rawValue, badRaw);
    assert.strictEqual(quarantine.sourceKey, "my-tech-lab-module-settings");
});
check("主键为空时恢复 → already-clean 且不写隔离键", () => {
    const api = makeApi();
    const res = api.recoverModuleSettings();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.state, "already-clean");
    assert.strictEqual(api._localStorage.getItem("my-tech-lab-module-settings-recovery"), null);
});
check("恢复时隔离写入失败 → 中止且原数据不变", () => {
    const api = makeApi({ "my-tech-lab-module-settings": "{corrupt!!!" });
    const originalRaw = api._localStorage.getItem("my-tech-lab-module-settings");
    api._localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
    const res = api.recoverModuleSettings();
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.state, "quarantine-failed");
    assert.strictEqual(api._localStorage.getItem("my-tech-lab-module-settings"), originalRaw);
});

console.log("\n=== 6. 启停写入与保护 ===");
check("setModuleEnabled 停用写入 v2", () => {
    const api = makeApi();
    const r = api.setModuleEnabled("quick-notes", false);
    assert.strictEqual(r.ok, true);
    const raw = JSON.parse(api._localStorage.getItem("my-tech-lab-module-settings"));
    assert.strictEqual(raw.schemaVersion, 2);
    assert.deepStrictEqual(raw.enabledById, { "quick-notes": false });
});
check("setModuleEnabled 重新启用删除对应键", () => {
    const api = makeApi();
    api.setModuleEnabled("quick-notes", false);
    const r = api.setModuleEnabled("quick-notes", true);
    assert.strictEqual(r.ok, true);
    const raw = JSON.parse(api._localStorage.getItem("my-tech-lab-module-settings"));
    assert.deepStrictEqual(raw.enabledById, {});
});
check("受保护模块不能停用", () => {
    const api = makeApi();
    const r = api.setModuleEnabled("data-center", false);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.state, "protected-module");
});

console.log("\n=== 7. 有效启用判定（父子级联）===");
check("停用 ai-assistant 后子工作流视为不可用", () => {
    const api = makeApi();
    api.setModuleEnabled("ai-assistant", false);
    assert.strictEqual(api.isModuleEffectivelyEnabled("ai-assistant"), false);
    assert.strictEqual(api.isModuleEffectivelyEnabled("daily-planning"), false);
    assert.strictEqual(api.isModuleEffectivelyEnabled("task-organization"), false);
});
check("未停用任何模块时全部有效", () => {
    const api = makeApi();
    assert.strictEqual(api.isModuleEffectivelyEnabled("ai-assistant"), true);
    assert.strictEqual(api.isModuleEffectivelyEnabled("quick-notes"), true);
    assert.strictEqual(api.isModuleEffectivelyEnabled("data-center"), true);
});

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========\n`);
process.exit(failed > 0 ? 1 : 0);
