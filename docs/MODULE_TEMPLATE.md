# My Tech Lab 模块建设模板

> **文档性质**：正式模块建设模板。
> **规范状态**：[正式 · v1.0]　**定版日期**：2026-11-04
> **上游依据**：[MODULE_DEVELOPMENT_STANDARD.md](MODULE_DEVELOPMENT_STANDARD.md)（规范，**安全与运行时语义以该文档及 [ARCHITECTURE.md](../ARCHITECTURE.md) 为准**）。
> **重要声明**：本模板只提供**结构与示意代码**，用于提示"新模块需要补齐哪些接入点"，**不是可直接运行的完整模块**，也未复制 Task Manager 的具体业务逻辑。所有示意代码在使用前必须按目标模块改造，并通过验收清单验证。

---

## 1. 模块基本信息（先填写）

| 项 | 值 |
|---|---|
| 模块 id（kebab-case） | `my-module` |
| 展示名 / 说明 | … |
| 类型 type | `standalone` / `embedded-workflow` / `system-management` |
| 分类 category | `work-knowledge` / `ai-intelligence` / `system` |
| 父模块 parentId | `null` 或父模块 id |
| 数据归属 dataOwnership | `own` / `shared` / `none` |
| 是否有自有数据键 | 是 / 否 |
| 是否带 AI 工作流 | 是 / 否 |

---

## 2. Registry 注册模板（示意）

```js
// 参考：docs/MODULE_DEVELOPMENT_STANDARD.md §2
{
    id: "my-module",               // 稳定唯一，发布后不改
    name: "My Module",
    description: "……",
    category: "work-knowledge",    // 仅展示分组，不参与运行逻辑
    type: "standalone",            // standalone | embedded-workflow | system-management
    entry: {
        targetSelector: "#my-module-section",
        navigationSelector: '.site-nav a[href="#my-module-section"]',
        shortcutSelector: null     // 无快捷入口时置 null
    },
    parentId: null,                // 运行维度：决定停用级联
    status: "implemented",         // implemented | partial | planned
    dataOwnership: "own"           // own | shared | none
}
```

> 注册后由 `validateModuleRegistry` 校验 id 格式、枚举、父子关系与 DOM 入口；缺失入口会被拦截。

---

## 3. DOM 结构模板（示意）

```html
<section class="module-section" id="my-module-section" aria-labelledby="my-module-title">
    <h2 class="module-heading" id="my-module-title">My Module</h2>
    <p class="module-description">……</p>

    <!-- 写入表单：提交统一走受守卫的 persistMyModule -->
    <form id="my-module-form">
        <input id="my-module-input" type="text" />
        <button id="my-module-add" type="submit">添加</button>
    </form>

    <!-- 状态提示：读写守卫把只读/错误文案写到这里 -->
    <p class="module-status" id="my-module-status" role="status" aria-live="polite"></p>

    <!-- 数据列表 -->
    <ul class="module-list" id="my-module-list"></ul>
    <p class="module-empty" id="my-module-empty" hidden>暂无数据</p>
</section>
```

> 接入点对应关系：`targetSelector` → `#my-module-section`；`navigationSelector` → 导航锚点；`shortcutSelector` → 可选快捷入口。状态元素供 `updateModuleAccessUI` 统一写只读/错误文案。

---

## 4. 模块状态与访问控制接入点（示意）

> 完整语义见 [ARCHITECTURE.md](../ARCHITECTURE.md) §6 与 [MODULE_DEVELOPMENT_STANDARD.md](MODULE_DEVELOPMENT_STANDARD.md) §3/§5。以下仅示意"接入点"，**不重新定义安全语义**。

```js
// 状态单一事实来源：getModuleRuntimeState("my-module")
// 写入守卫统一入口：requireModuleAccess("my-module", myModuleStatus)
// UI 统一刷新：updateModuleAccessUI() 中登记该模块

function updateMyModuleControls() {
    const access = getModuleAccessStatus("my-module");
    const ready = myModuleStorageReady;
    myModuleInput.disabled = !access.enabled || !ready;
    myModuleAdd.disabled = !access.enabled || !ready;
    // 列表内控件（删除、勾选、下拉等）同样按 access.enabled + ready 禁用
}
```

- 启用/停用开关由 Module Management Center 承载，业务模块不提供"删除自身"。
- 任何写入函数**首行**调用 `requireModuleAccess`，不得只在 UI 层禁用。

---

## 5. 数据加载与持久化模板（示意）

```js
// 加载：严格校验，失败 fail-closed，不静默清空
function loadMyModule() {
    try {
        const saved = localStorage.getItem(myModuleStorageKey);
        if (saved !== null) {
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed) || parsed.some(item =>
                !item || typeof item.id !== "string" ||
                typeof item.text !== "string" ||
                typeof item.createdAt !== "string" ||
                Number.isNaN(Date.parse(item.createdAt))
            )) throw new Error("Stored my-module data has an invalid format.");
            myModuleItems = parsed;
        }
        myModuleStorageReady = true;
        renderMyModule();
    } catch (error) {
        setMyModuleUnavailable("……", error); // 禁用表单 + 提示，不清空数据
    }
}

// 持久化：唯一写入口，入口守卫 + 成功才更新内存态
function persistMyModule(nextItems) {
    if (!requireModuleAccess("my-module", myModuleStatus)) return false;
    try {
        localStorage.setItem(myModuleStorageKey, JSON.stringify(nextItems));
        myModuleItems = nextItems;
        renderMyModule();
        return true;
    } catch (error) {
        myModuleStatus.textContent = "保存失败……";
        console.error("My Module could not save:", error);
        return false; // 调用方据此回滚 UI
    }
}
```

> 隐式写入（删除、勾选、改状态、批量导入）一律复用 `persistMyModule`，不另建写路径。
> 数据类型说明：本示例假设模块数据为「记录数组」（`id` / `text` / `createdAt`…）。若模块为对象型数据（如 Daily Focus 的 `{schemaVersion, records}`），需相应调整 `load` / `persist` 的校验与内存态表示，不要机械套用数组结构。

---

## 6. Data Center 接入检查项（示意）

```js
// 有自有数据的模块，在 dataCenterModules 中登记四件套
{
    id: "my-module",
    name: "My Module",
    key: myModuleStorageKey,
    emptyValue: () => [],
    validate: (data) => Array.isArray(data) && data.every(item =>
        item && typeof item.id === "string" &&
        typeof item.text === "string" &&
        typeof item.createdAt === "string" &&
        !Number.isNaN(Date.parse(item.createdAt))
    ),
    count: (data) => data.length,
    latest: (data) => latestDataCenterDate(data.map(item => item.createdAt))
}
```

> `validate` 字段约束必须与 `loadMyModule` 保持一致；`emptyValue` 表示"空数据"的合法形态。备份/导入/恢复流程本身复用现有 Data Center，不另建。
> 接口说明：`emptyValue` / `validate` / `count` / `latest` 均为示例接口，字段与判断逻辑须按模块实际数据结构调整；对象型数据（如 Daily Focus）不适用 `Array.isArray` 写法，需改用对应的对象校验。

---

## 7. CSS 响应式结构模板（示意）

```css
/* 基础：单列，内容按需撑高 */
.module-panel { /* … */ }

/* 工作区网格：宽屏双列，窄屏单列（断点以现有 workspace-grid 为准） */
@media (min-width: 900px) {
    .workspace-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* 列表项网格：桌面多列，窄屏降列，子项允许收缩 */
.module-item { display: grid; grid-template-columns: minmax(0, 1fr) 120px; }
.module-item > * { min-width: 0; }

/* 窄屏（≤1279px）预览类控件：日期/时间上下堆叠，移除 iOS 原生外观 */
@media (max-width: 1279px) {
    .module-item { grid-template-columns: minmax(0, 1fr); }
    input[type="date"], input[type="time"], select {
        max-width: 100%;
        -webkit-appearance: none;
        appearance: none;
    }
}

/* 手机横屏：短视口切单列（与现有规则一致） */
@media (min-width: 601px) and (max-height: 500px) {
    .workspace-grid { grid-template-columns: minmax(0, 1fr); }
}
```

> 断点、收缩链、无溢出判定的完整要求见 [MODULE_DEVELOPMENT_STANDARD.md](MODULE_DEVELOPMENT_STANDARD.md) §7；此处仅示意结构，实际断点须对齐现有 `index.html` 的规则。

---

## 8. 自动化测试模板（示意）

```js
// tests/ 下按模块新增用例；接入现有 mock 环境（document/localStorage/fetch）
// 三类基础用例（拥有独立业务数据的模块为必检，见规范 §8）：
//   1. 停用禁写：setModuleEnabled("my-module", false) 后 persistMyModule 被拒、localStorage 不变
//   2. 持久化回读：persistMyModule 后重新 loadMyModule，字段完整一致
//   3. 异常回滚：注入 setItem 失败，内存态不变、不误报成功
// 带 AI 模块追加：停用 abort、迟到响应丢弃、结果落库守卫
// 无独立业务数据的模块可说明理由后标记 N/A，不得因测试困难而跳过适用项
```

> 测试要求（mock 数据、断言真实函数行为、报告区分自动化/静态/真机）见 [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §十。示意用例需按模块实际字段改写，并通过 `MTL_HTML_PATH` 反向验证。

---

## 9. 文档与验收记录模板（示意）

新模块落地时同步产出：

- 模块 README 片段：`id`、`type`、`category`、`parentId`、`dataOwnership`、持久化键、是否带 AI。
- 验收记录：填写 [MODULE_ACCEPTANCE_CHECKLIST.md](MODULE_ACCEPTANCE_CHECKLIST.md)，逐项记录方法、证据、结果与日期。

```text
模块：my-module
HEAD：________   自动化测试：____ passed / 0 failed
验收人：________  日期：________
设备矩阵：iPhone 竖/横（）、iPad 竖/横（）、Mac（）
备注：
```

---

## 10. 使用说明与免责

1. 本模板所有代码均为**示意骨架**，含占位符（`my-module` 等），不可直接运行，需按目标模块重命名并补全业务逻辑。
2. 安全与运行时语义**不在此定义**；实现时必须回到 [MODULE_DEVELOPMENT_STANDARD.md](MODULE_DEVELOPMENT_STANDARD.md) 与 [ARCHITECTURE.md](../ARCHITECTURE.md) §6–§7 对齐。
3. 未经验证的条目保持【待验证】，不得按强制要求落地。
4. 完成后必须走完 [MODULE_ACCEPTANCE_CHECKLIST.md](MODULE_ACCEPTANCE_CHECKLIST.md) 全部适用项，才能进入规范推广。
