// My Tech Lab 模块设置隔离数据 → Data Center 备份集成 隔离测试
// 使用内存模拟 localStorage，不触碰真实浏览器存储。
const fs = require("fs");
const assert = require("assert");

const path = require("path");
const HTML_PATH = process.env.MTL_HTML_PATH
    ? path.resolve(process.env.MTL_HTML_PATH)
    : path.resolve(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

const RECOVERY_KEY = "my-tech-lab-module-settings-recovery";
const MAIN_KEY = "my-tech-lab-module-settings";

const start = html.indexOf("function isValidModuleSettingsRecoveryRecord(record) {");
const end = html.indexOf("function createDataCenterBackup() {");
if (start < 0 || end < 0) {
    throw new Error("无法定位隔离数据辅助函数");
}
const helpersCode = html.slice(start, end);

function makeApi(initialStore = {}) {
    const store = new Map(Object.entries(initialStore));
    const mockLocalStorage = {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { store.delete(key); },
        _store: store
    };
    const code = `
const moduleSettingsRecoveryStorageKey = "${RECOVERY_KEY}";
${helpersCode}
; return {
    isValidModuleSettingsRecoveryRecord, readModuleSettingsRecovery,
    getModuleSettingsRecoveryBackupValue, validateModuleSettingsRecoveryInBackup,
    writeModuleSettingsRecovery, restoreModuleSettingsRecovery,
    moduleSettingsRecoveryStorageKey
};`;
    const fn = new Function("localStorage", code);
    const api = fn(mockLocalStorage);
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

const sampleRecord = {
    quarantinedAt: "2026-11-03T04:00:00.000Z",
    sourceKey: MAIN_KEY,
    rawValue: "{corrupt original module settings"
};

console.log("\n=== 1. 导出：隔离数据纳入备份 ===");
check("无隔离数据 → 备份值为 null", () => {
    const api = makeApi();
    assert.strictEqual(api.getModuleSettingsRecoveryBackupValue(), null);
});
check("有隔离数据 → 返回完整记录（保留时间戳与来源）", () => {
    const api = makeApi({ [RECOVERY_KEY]: JSON.stringify(sampleRecord) });
    const value = api.getModuleSettingsRecoveryBackupValue();
    assert.deepStrictEqual(value, sampleRecord);
    assert.strictEqual(value.quarantinedAt, sampleRecord.quarantinedAt);
    assert.strictEqual(value.sourceKey, MAIN_KEY);
    assert.strictEqual(value.rawValue, sampleRecord.rawValue);
});
check("隔离数据损坏 → 原样保留为 {storageValue}", () => {
    const api = makeApi({ [RECOVERY_KEY]: "{not valid json" });
    const value = api.getModuleSettingsRecoveryBackupValue();
    assert.deepStrictEqual(value, { storageValue: "{not valid json" });
});

console.log("\n=== 2. 导入校验（旧版备份兼容）===");
check("旧版备份无该字段 → null（不报错）", () => {
    const api = makeApi();
    assert.strictEqual(api.validateModuleSettingsRecoveryInBackup(undefined), null);
    assert.strictEqual(api.validateModuleSettingsRecoveryInBackup(null), null);
});
check("字段为 null → null", () => {
    const api = makeApi();
    assert.strictEqual(api.validateModuleSettingsRecoveryInBackup(null), null);
});
check("合法记录 → 返回 {record}", () => {
    const api = makeApi();
    const r = api.validateModuleSettingsRecoveryInBackup(sampleRecord);
    assert.deepStrictEqual(r, { record: sampleRecord });
});
check("合法 raw 包装 → 返回 {storageValue}", () => {
    const api = makeApi();
    const r = api.validateModuleSettingsRecoveryInBackup({ storageValue: "raw!!!" });
    assert.deepStrictEqual(r, { storageValue: "raw!!!" });
});
check("非法字段 → 抛错", () => {
    const api = makeApi();
    assert.throws(() => api.validateModuleSettingsRecoveryInBackup({ foo: 1 }));
    assert.throws(() => api.validateModuleSettingsRecoveryInBackup({ quarantinedAt: "bad", sourceKey: "x", rawValue: "y" }));
    assert.throws(() => api.validateModuleSettingsRecoveryInBackup("string"));
});

console.log("\n=== 3. 导入写入：只写隔离键，不覆盖主设置 ===");
check("写入隔离数据不触碰主设置键", () => {
    const api = makeApi({
        [MAIN_KEY]: JSON.stringify({ schemaVersion: 2, enabledById: { "quick-notes": false } })
    });
    const mainBefore = api._localStorage.getItem(MAIN_KEY);
    api.writeModuleSettingsRecovery({ record: sampleRecord });
    assert.deepStrictEqual(
        JSON.parse(api._localStorage.getItem(RECOVERY_KEY)),
        sampleRecord
    );
    assert.strictEqual(api._localStorage.getItem(MAIN_KEY), mainBefore);
});
check("raw 包装写入原样保留", () => {
    const api = makeApi();
    api.writeModuleSettingsRecovery({ storageValue: "{corrupt raw" });
    assert.strictEqual(api._localStorage.getItem(RECOVERY_KEY), "{corrupt raw");
});
check("payload 为 null → 不写任何键", () => {
    const api = makeApi();
    api.writeModuleSettingsRecovery(null);
    assert.strictEqual(api._localStorage.getItem(RECOVERY_KEY), null);
});

console.log("\n=== 4. 回滚 ===");
check("回滚恢复已存在的隔离数据", () => {
    const api = makeApi({ [RECOVERY_KEY]: JSON.stringify(sampleRecord) });
    api.writeModuleSettingsRecovery({ storageValue: "overwritten" });
    api.restoreModuleSettingsRecovery({ raw: JSON.stringify(sampleRecord), present: true });
    assert.deepStrictEqual(JSON.parse(api._localStorage.getItem(RECOVERY_KEY)), sampleRecord);
});
check("回滚移除本不存在的隔离数据", () => {
    const api = makeApi();
    api.writeModuleSettingsRecovery({ storageValue: "something" });
    api.restoreModuleSettingsRecovery({ raw: null, present: false });
    assert.strictEqual(api._localStorage.getItem(RECOVERY_KEY), null);
});

console.log("\n=== 5. 完整往返：导出→校验→写入，时间戳与来源保留，主设置不变 ===");
check("往返后隔离记录与主设置均正确", () => {
    const api = makeApi({
        [RECOVERY_KEY]: JSON.stringify(sampleRecord),
        [MAIN_KEY]: JSON.stringify({ schemaVersion: 2, enabledById: { "task-manager": false } })
    });
    const backupValue = api.getModuleSettingsRecoveryBackupValue();
    const validated = api.validateModuleSettingsRecoveryInBackup(backupValue);
    api.writeModuleSettingsRecovery(validated);
    const restored = JSON.parse(api._localStorage.getItem(RECOVERY_KEY));
    assert.strictEqual(restored.quarantinedAt, sampleRecord.quarantinedAt);
    assert.strictEqual(restored.sourceKey, sampleRecord.sourceKey);
    assert.strictEqual(restored.rawValue, sampleRecord.rawValue);
    assert.strictEqual(
        api._localStorage.getItem(MAIN_KEY),
        JSON.stringify({ schemaVersion: 2, enabledById: { "task-manager": false } })
    );
});

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========\n`);
process.exit(failed > 0 ? 1 : 0);
