# My Tech Lab 模块开发规范

> **文档性质**：正式规范（模块级开发标准）。
> **规范状态**：[正式标准 · v1.0]　**定版日期**：2026-11-04
> **上游依据**：[MODULE_STANDARDIZATION_PLAN.md](MODULE_STANDARDIZATION_PLAN.md)（规划）；[ARCHITECTURE.md](../ARCHITECTURE.md)（架构与机制）；[DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md)（开发与数据安全纪律）；[ROADMAP.md](../ROADMAP.md)（进度）。
> **下游引用**：[MODULE_ACCEPTANCE_CHECKLIST.md](MODULE_ACCEPTANCE_CHECKLIST.md)（验收清单）、[MODULE_TEMPLATE.md](MODULE_TEMPLATE.md)（模块模板）。
> **约束**：本规范只做"模块级可执行标准"，**不重新定义**运行时语义、数据契约、数据安全细则或工程纪律；这些以权威文档为准。冲突时以权威文档为准。

---

## 0. 规范状态标记说明

全文统一使用三种标记，任何条目必须显式归类，不得省略：

| 标记 | 含义 | 约束 |
|---|---|---|
| 【已验证】 | 已在 Task Manager 与 Notes 两个模块中实现、通过自动化测试、并经 iPhone / iPad / Mac 人工验收的实践 | 可强制要求 |
| 【推荐实践】 | 建议新模块采用，但允许根据模块特征调整 | 默认采用，偏离需说明理由 |
| 【待验证】 | 尚未在实际模块中验证的抽象能力或阈值（如统一 AI Service、桌面列宽阈值等） | 仅作方向，不得写成既定事实 |

> 当前事实基线：Task Manager 样板验证与 Notes 第二模块验证均已通过人工验收；自动化测试 **187 passed / 0 failed**；HEAD `70145e8`；`v1.3.0` 已发布；Task Manager 后续增强与 Notes 新增测试**尚未提交、尚未纳入 v1.3.0**；三份规范已定型为 v1.0。

---

## 1. 适用范围、术语与规范状态

### 1.1 适用范围

- 适用于 My Tech Lab 单文件静态单页应用内**新增功能模块**的建设与**现有模块的渐进改造**。
- 不适用于：系统管理模块（Data Center、Module Management Center）的受保护机制重定义；Cloudflare Worker / 后端；知识库内容分类（Knowledge Taxonomy，与 Module Category 相互独立）。
- 不要求现有模块立即全面重构；按 [ROADMAP.md](../ROADMAP.md) 与标准化规划渐进推广。

### 1.2 术语（引用权威定义，不另行定义）

| 术语 | 权威定义位置 |
|---|---|
| 模块（Module）/ 模块类型 / 模块分类 | [ARCHITECTURE.md](../ARCHITECTURE.md) §5.1–§5.3 |
| 导航分组 ≠ Registry category ≠ parentId | [ARCHITECTURE.md](../ARCHITECTURE.md) §5.5 |
| 运行时状态 / 只读 / 停用语义 / 受保护模块 | [ARCHITECTURE.md](../ARCHITECTURE.md) §6 |
| 模块设置数据契约（schema v2） | [ARCHITECTURE.md](../ARCHITECTURE.md) §7 |
| 数据不变量 / 数据键 | [ARCHITECTURE.md](../ARCHITECTURE.md) §8 |
| AI 架构边界 | [ARCHITECTURE.md](../ARCHITECTURE.md) §9 |
| 数据安全细则（先备份、再确认、后删除） | [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §七 |
| 增量开发模式 / 工程纪律 / Git 工作流 | [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §四、§五、§九 |
| 测试体系 | [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §十 |

### 1.3 规范状态

- 本文件为**正式标准 v1.0**，已通过 Task Manager（样板）与 Notes（第二模块）两个不同业务模块的实际验证。
- 后续修订只通过"样板/模块验证 → 修订 → 重新发布"进行（见 §9）。

---

## 2. 模块基础结构与 Registry 注册

### 2.1 模块身份（【已验证】）

- 【已验证】每个模块必须有稳定、唯一的 `id`（kebab-case，如 `task-manager`），发布后不因显示名或分类变化而改变。
- 【已验证】`type` 三选一：`standalone` / `embedded-workflow` / `system-management`；`status` 三选一：`implemented` / `partial` / `planned`；`dataOwnership` 三选一：`own` / `shared` / `none`。
- 【已验证】`category` 只用于 Module Management Center 展示分组，不参与停用级联、读写守卫、AI 取消等运行逻辑。
- 【已验证】`parentId` 才是运行维度：决定停用级联（`isModuleEffectivelyEnabled` 沿父链判断）与 `parent-disabled` 状态。

### 2.2 Registry 注册项（【已验证】）

每个模块的 Registry 条目至少包含：

| 字段 | 说明 |
|---|---|
| `id` | 稳定唯一标识 |
| `name` / `description` | 展示名与说明 |
| `category` | 功能分类（work-knowledge / ai-intelligence / system） |
| `type` | 模块类型 |
| `parentId` | 父模块 id（无则 `null`） |
| `status` | 实现状态 |
| `dataOwnership` | 数据归属 |
| `entry` | `targetSelector` / `navigationSelector` / `shortcutSelector`（无则 `null`） |

- 【已验证】Registry 需被 `validateModuleRegistry` 校验（id 格式、枚举、父子关系、DOM 入口存在性），页面加载时执行。
- 【推荐实践】`entry` 的三种选择器与 DOM 结构一一对应（见 §3.1），避免入口失配。

### 2.3 模块入口一致性（【待验证】）

- 【待验证】"导航入口、快捷入口与目标区块三者一致、所有可到达路径均可达"作为独立验收项，尚未在第二模块验证其通用写法，仅列为待验证方向。

---

## 3. 模块生命周期与运行时状态

- 【已验证】统一以 `getModuleRuntimeState(moduleId)` 为状态单一事实来源；派生入口 `isModuleReadOnly`、`canModulePerformAction`、`getModuleAccessStatus`、`requireModuleAccess`、`isModuleEffectivelyEnabled`。
- 【已验证】所有写入路径与 UI 复用同一份状态，避免"UI 层禁用"与"数据层守卫"不一致。
- 【已验证】停用语义（保留数据、只读查看、禁增删改、禁模块内导入、禁 AI、在途中止、迟到丢弃、级联、重启恢复）以 [ARCHITECTURE.md](../ARCHITECTURE.md) §6.3 为准，不在本文件重定义。
- 【已验证】受保护模块（`data-center`、`module-management-center`）恒启用、非只读，Registry 校验拒绝写入其停用状态。
- 【推荐实践】模块的启用/停用开关只由 Module Management Center 承载，业务模块自身不提供"删除自身"入口。

---

## 4. 数据管理、存储与 Data Center 接入

### 4.1 数据键与结构（【已验证】）

- 【已验证】每个有自有数据的模块（`dataOwnership="own"`）使用唯一 `localStorage` 键（如 `my-tech-lab-tasks`），结构字段固定且类型可校验。
- 【已验证】不得与系统键混用：模块设置用 `my-tech-lab-module-settings` / `-recovery`，恢复失败锁用 `my-tech-lab-data-center-recovery-failed`。
- 业务模块存储键的完整清单以 [ARCHITECTURE.md](../ARCHITECTURE.md) §8.1 为准，本文件不重复维护一份可能过期的键清单。
- 【推荐实践】新数据格式应有 schema 版本；变更必须有版本化迁移与兼容恢复路径（[ARCHITECTURE.md](../ARCHITECTURE.md) §8.2）。

### 4.2 加载校验（【已验证】）

- 【已验证】提供 `loadX()`：读取 → JSON 解析 → 逐字段类型/枚举/日期校验 → 通过才写入内存态并渲染；失败走 `setXUnavailable`（禁用表单、显示错误、fail-closed）。
- 【推荐实践】校验失败时**不静默清空**用户数据，只标记不可用并提示。

### 4.3 持久化入口（【已验证】）

- 【已验证】单一 `persistX(nextData)` 作为唯一写入口：入口处 `requireModuleAccess(moduleId)` 守卫 → `setItem` → 写后回读（或捕获异常）→ 成功才更新内存态并重渲染 → 失败提示且不改内存态。
- 【已验证】隐式写入（勾选完成、删除、改优先级、批量导入等）均复用同一 `persistX`，不另建写路径。

### 4.4 Data Center 注册（【已验证】）

- 【已验证】有自有数据的模块在 `dataCenterModules` 中登记：`id`、`name`、`key`、`emptyValue()`、`validate(data)`、`count(data)`、`latest(data)`。
- 【已验证】`validate` 的字段约束与 `loadX` 保持一致，避免"加载能过、备份校验不能过"的偏差。

### 4.5 迁移、备份、恢复（【已验证】）

- 【已验证】迁移、隔离恢复、备份字段兼容、恢复失败锁定是 **Data Center 层面的统一数据保护机制**，已在 Task Manager 与 Notes 双模块验证，且现有五个业务模块（Quick Notes、Task Manager、Daily Focus、Ideas & Writing、Document Summary）的锁定拦截均有自动化测试证据（`锁定期间五个业务模块写入被拦截` 用例）。
- 【已验证】新模块接入时**复用**统一机制而非自建：写入仍走受守卫的 `persistX`（`requireModuleAccess` 先查 `isDataCenterRecoveryLocked()`），恢复仍走既有恢复事务（详见 [ARCHITECTURE.md](../ARCHITECTURE.md) §7）。**不要求**每个模块自行实现一套恢复锁。
- 【待验证】尚未验证的特殊数据场景（如非 `localStorage` 的未来存储、跨设备同步）不在此定型范围内。

---

## 5. 权限守卫、模块停用与数据安全

- 【已验证】**双重守卫**：UI 层禁用 + 真实写入函数入口 `requireModuleAccess(moduleId, statusElement)`，不能只在 UI 层拦截。
- 【已验证】`requireModuleAccess` 先查 `isDataCenterRecoveryLocked()`，再查模块状态；恢复锁定时 fail-closed 拒绝写入。
- 【已验证】持久化失败时**回滚 UI、不误报成功**（如优先级修改失败回退显示、导入失败保留预览项）。
- 【已验证】数据安全细则（先备份、再确认、后删除、删除范围一致、不可逆操作二次确认等）以 [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §七为准，本文件不重定义，仅要求新模块**接入统一数据中心能力、不得另建绕过安全原则的删除路径**。

---

## 6. AI 能力接入及请求生命周期

> 仅适用于带 AI 工作流的模块（`embedded-workflow` 或横向 AI 能力）；无 AI 模块跳过本节。

> 当前实现形态（【已验证】事实）：五个 AI 工作流（AI Assistant、Daily Planning、Task Organization、Document Summary、Ideas & Writing）**各自维护**独立的请求控制器、AccessVersion 与权限检查逻辑，是**独立实现，尚未形成统一可复用的 AI Service**。本节只记录已验证的"独立取消 + 版本丢弃"事实，不暗示存在统一 AI 请求接入函数；无 AI 能力的模块（如 Notes）**不需要**接入 AI 控制器。

- 【已验证】每个 AI 工作流持独立 `AbortController` 与 `AccessVersion`（如 Task Organization 的 `taskOrganizerRequestController` / `taskOrganizerAccessVersion`），实现：停用 `abort()`、迟到响应按版本丢弃。
- 【已验证】入口校验访问状态：停用 / 父停用 / 数据未就绪时拒绝发起新请求。
- 【已验证】请求落地前二次校验（版本未变、输入未变、模块未停用）再写入预览或结果。
- 【已验证】AI 结果落库仍走受守卫的 `persistX`（如 `importOrganizedTasks` → `persistTasks`），不直接写 `localStorage`。
- 【已验证】API Key / Secret 不得进入前端代码或公开仓库（[ARCHITECTURE.md](../ARCHITECTURE.md) §9.2）。
- 【推荐实践】提示词与解析校验**契约一致**（字段说明、JSON 示例、校验逻辑三方对齐，如 `confirmationReason` 与 `needsConfirmation` 配对规则）。
- 【待验证】统一 AI Service / 多模型适配器（[ARCHITECTURE.md](../ARCHITECTURE.md) §9.2）为未来规划，不作为当前模块强制要求。

---

## 7. UI 设计与响应式要求

### 7.1 通用响应式基础（【已验证】）

- 【已验证】工作区网格：基础单列，`≥900px` 双列；窄屏卡片按内容自然撑高，不做异常拉伸（`min-height` 仅在宽屏生效）。
- 【已验证】手机横屏短视口（`min-width:601px 且 max-height:500px`）切单列，避免横向拥挤。
- 【已验证】**内容收缩链**：grid/flex 子项 `min-width:0` 逐层允许收缩，控件 `width:100%` + `max-width:100%` + `box-sizing:border-box`；不靠隐藏 `overflow-x` 掩盖溢出。
- 【已验证】窄屏下移除 iOS 原生 date/time/select 固有外观（`-webkit-appearance:none`）以真正收缩；Mac 桌面保留原生外观。
- 【推荐实践】根据实际内容调整布局，而不是机械套用断点；具体断点值（如 `≥900px`、`max-height:500px`）以当前 `index.html` 的共享规则为准，新模块优先复用而非另起一套。

### 7.2 任务类预览布局（【推荐实践】）

- 【推荐实践】以下布局**来自 Task Manager 任务预览的实际实现**，仅供"含多字段 + 日期/时间"的预览类界面参考，**不代表所有模块必须照搬**：桌面多列；`≤1279px` 降为两列、日期/时间上下堆叠；`≤600px` 单列。
- 【推荐实践】控件高度统一（如标题框与优先级框等高），避免原生控件高度差异。
- 【推荐实践】验证方法：实测"卡片右边界 / 子元素右边界 / 控件实际宽度"差值，确认无子元素超出父容器；不能只看 CSS。
- 【待验证】桌面宽屏下标题列等具体列宽的"可读性阈值"（如 ≥1280px 标题列不应过窄）尚未形成定值，待 Notes 及更多视口验证。

---

## 8. 自动化测试与人工验收

- 【已验证】统一命令 `node tests/run-all.js`；测试用 mock localStorage / DOM / fetch，不触碰真实用户数据、不发真实 AI 请求。
- 【已验证】测试断言真实函数调用行为，不靠字符串匹配；保留 `MTL_HTML_PATH` 反向验证（移除守卫/取消逻辑应导致对应用例失败）。
- 【已验证】拥有独立业务数据的模块，以下三类基础测试为**基础验收要求（必检）**：
  1. 模块停用后的写入拦截（启用 / 停用 / 重新启用）；
  2. 持久化后回读及字段完整性；
  3. 存储异常、失败处理及数据保护（如 setItem 失败回滚、损坏数据 fail-closed）。
  必须根据模块实际数据结构与功能设计测试；无独立业务数据的模块可说明理由后标记 N/A；不得仅因测试困难而把适用项标记为 N/A。
- 【推荐实践】带 AI 工作流的模块，在三类基础上再加：停用 abort、迟到响应丢弃、结果落库守卫。
- 【已验证】报告必须区分：自动化测试 / 静态代码检查 / 真实浏览器人工验证（[DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §十）。
- 【推荐实践】人工验收记录设备 / 视口 / 结论 / 日期，形成书面记录（见验收清单）。

---

## 9. 开发交付与规范演进机制

- 【已验证】交付闭环：开发 → `node tests/run-all.js` 全绿 → 自查完整 diff → 真实浏览器人工验证 → 仅暂存明确文件并 commit（Conventional Commits）→ 授权后 push（[DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §八、§九）。
- 【已验证】禁止破坏性 Git 操作（reset / clean / checkout -- / 改写历史）。
- 【推荐实践】一个任务不混入多个独立需求；修改前查 Git 状态、修改后 `git diff --check`。
- 【推荐实践】本规范的演进只通过"样板验证 → 修订 → 重新发布"进行，不因单个模块的特殊需求临时放宽；确需偏离时在模块文档中记录例外与理由。

---

## 10. 附录：与权威文档的引用关系

| 本规范章节 | 引用权威文档 | 引用方式 |
|---|---|---|
| §2 基础结构 / §3 生命周期 | [ARCHITECTURE.md](../ARCHITECTURE.md) §5–§6 | 引用，不重定义 |
| §4 数据管理 | [ARCHITECTURE.md](../ARCHITECTURE.md) §7–§8 | 引用，不重定义 |
| §5 权限与安全 | [ARCHITECTURE.md](../ARCHITECTURE.md) §6 + [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §七 | 引用，不重定义 |
| §8 测试 / §9 交付 | [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §十 / §八 / §九 | 引用，不重定义 |
