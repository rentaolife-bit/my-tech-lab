# My Tech Lab 现有数据资产盘点报告

> 版本：v1（第一阶段）　日期：2026-11-08
> 性质：只读现状调查，未修改任何代码、数据或配置。
> 依据：`index.html`（当前工作区实际代码），辅以 `ARCHITECTURE.md` / `ROADMAP.md`。
> 状态标记约定：**[已实现]** / **[部分实现]** / **[未来规划]** / **[无法确认]**。

---

## 1. 项目当前数据架构概况

- 当前为 **GitHub Pages 静态单页应用**（原生 HTML/CSS/JS，`index.html` 单文件承载全部逻辑）。
- **唯一持久化机制是浏览器 `localStorage`**；代码中**不存在** `sessionStorage`、`IndexedDB`、Cookie 或任何服务端数据库。
- **不存在 `localStorage.clear()`**——所有删除均为按 key 精确删除（`removeItem`）。
- AI 请求经 **Cloudflare Worker** 转发至 DeepSeek（`requestAI`，index.html:5152）；Worker 是**纯代理层**，不承担任何业务数据持久化。
- 共发现 **8 个 localStorage Key**：5 个业务数据键 + 3 个系统键。
- 当前所有数据均为**单用户、单设备、浏览器本地**；无多设备同步、无远程持久化。

---

## 2. 已实现模块及数据归属清单

| 模块（Registry id） | 类型 | 数据归属 | 持久化 | 状态 |
|---|---|---|---|---|
| Dashboard（无独立 id，聚合展示） | 聚合视图 | 无自有数据 | 无 | **[已实现]** 只读聚合 |
| `task-manager`（Task Manager） | standalone | own | `my-tech-lab-tasks` | **[已实现]** |
| `quick-notes`（Quick Notes） | standalone | own | `my-tech-lab-notes` | **[已实现]** |
| `daily-focus`（Daily Focus） | standalone | own | `my-tech-lab-daily-focus` | **[已实现]** |
| `ai-assistant`（AI Assistant） | standalone | none | 无（对话仅内存） | **[已实现]** 临时数据 |
| `daily-planning`（Daily Planning） | embedded-workflow | shared | 无（读 tasks+daily-focus） | **[已实现]** 无自有数据 |
| `task-organization`（Task Organization） | embedded-workflow | shared | 无（写 task-manager） | **[已实现]** 无自有数据 |
| `document-summary`（Document Summary） | embedded-workflow | own | `my-tech-lab-document-summaries` | **[已实现]** |
| `ideas-writing`（Ideas & Writing） | embedded-workflow | own | `my-tech-lab-ideas` | **[已实现]** |
| `data-center`（Data Center） | system-management | none | 管理 5 业务键 + 系统键 | **[已实现]** |
| `module-management-center`（Module Management） | system-management | none | 管理 `my-tech-lab-module-settings` | **[已实现]** |
| Projects（静态展示区） | — | none | 无 | **[仅界面]** 无业务流程、无数据 |
| Knowledge Base / Professional Applications | — | — | — | **[未来规划]** 未实现 |

**关键区分**：
- **AI Assistant 对话**：仅存页面内存，刷新即失，**不在备份范围**（ARCHITECTURE.md §8.1）。
- **Daily Planning / Task Organization**：`dataOwnership = "shared"`，**无自有数据**，分别读取/写入 Tasks 与 Daily Focus。
- **Projects**：当前是**纯静态展示**，无任何数据模型或持久化。
- **Document Summary / Ideas & Writing**：`own` 型，有自有数据 + 自有 AI 工作流。

---

## 3. Storage Key 完整清单

### 3.1 业务数据键（5 个，纳入 Data Center 备份）

| # | Storage Key | 模块 | 用途 | 数据类型 | 初始化/默认值 | 写入位置 | 读取位置 |
|---|---|---|---|---|---|---|---|
| 1 | `my-tech-lab-notes` | quick-notes | 快速笔记 | `[{id,text,createdAt}]` | `[]`（空数组） | `persistNotes` (:10328) | `loadNotes` (:10360) |
| 2 | `my-tech-lab-tasks` | task-manager | 任务 | `[Task]`（见 §4.1） | `[]` | `persistTasks` | `loadTasks` (:10639) |
| 3 | `my-tech-lab-daily-focus` | daily-focus | 今日重点+历史归档 | `{schemaVersion,activeDate,records}`（见 §4.3） | 空归档 | `persistDailyFocus`/`writeDailyFocusArchive` (:10004) | `readDailyFocusArchive` (:9963) |
| 4 | `my-tech-lab-ideas` | ideas-writing | 灵感记录 | `[{id,title,content,createdAt,updatedAt}]` | `[]` | `persistIdeas` (:11516) | `loadIdeas` |
| 5 | `my-tech-lab-document-summaries` | document-summary | 资料总结历史 | `[DocumentRecord]`（见 §4.5） | `[]` | `persistDocumentHistory` (:11165) | `loadDocumentHistory` (:11185) |

### 3.2 系统键（3 个，独立于业务备份）

| # | Storage Key | 用途 | 结构 | 写入 | 读取 |
|---|---|---|---|---|---|
| 6 | `my-tech-lab-module-settings` | 模块启停设置 | `{schemaVersion:2, enabledById:{moduleId:false}}` | `writeModuleSettings` | `readModuleSettings` (:5532) |
| 7 | `my-tech-lab-module-settings-recovery` | 损坏设置隔离记录 | `{quarantinedAt, sourceKey, rawValue}` | `recoverModuleSettings` | `readModuleSettingsRecovery` (:6798) |
| 8 | `my-tech-lab-data-center-recovery-failed` | 恢复失败保护标记 | `{state,createdAt,lastFailureAt,failedKeys,backupFormat,backupVersion}` | `lockDataCenterForRecoveryFailure` (:5536) | `isDataCenterRecoveryLocked` |

### 3.3 非存储键的格式标签（出现在备份 JSON 内部，不是独立 key）

| 标签 | 用途 | 位置 |
|---|---|---|
| `my-tech-lab-backup` | 正式备份格式标识（`dataCenterFormat`） | :6374 |
| `my-tech-lab-raw-safety-backup` | 原始安全备份格式 | :6979 |
| `my-tech-lab-recovery-snapshot` | 恢复快照格式 | :7080 |

**确认**：以上 8 个 key 为全量（通过全项目 `"my-tech-lab-` 字符串搜索确认，无遗漏的硬编码 key）。

---

## 4. 核心业务数据结构与字段清单

### 4.1 Task（`my-tech-lab-tasks`）

| 字段 | 类型 | 必填 | 默认值 | 含义 |
|---|---|---|---|---|
| `id` | string | ✅ | `Date.now()-random` | 任务唯一 ID |
| `text` | string | ✅ | — | 任务标题 |
| `priority` | enum | ✅ | `medium` | `high`/`medium`/`low` |
| `completed` | boolean | ✅ | `false` | 完成状态 |
| `createdAt` | ISO string | ✅ | 当前时间 | 创建时间 |
| `completedAt` | ISO string \| null | 可选 | `null` | 完成时间（勾选时写、取消时清空） |
| `dueDate` | `YYYY-MM-DD` \| `""` | 可选 | `""` | 截止日期 |
| `note` | string | 可选 | `""` | 用户备注 |

- 校验：`isValidTask`（:10598）、`isValidTaskDate`；老数据（无新字段）向后兼容。
- **无 `updatedAt` 字段**；无排序、分类、外键字段。

### 4.2 Quick Note（`my-tech-lab-notes`）

| 字段 | 类型 | 必填 | 默认值 | 含义 |
|---|---|---|---|---|
| `id` | string | ✅ | `Date.now()-random` | 笔记 ID |
| `text` | string | ✅ | — | 笔记内容 |
| `createdAt` | ISO string | ✅ | 当前时间 | 创建时间 |

- **单一 text 字段**，无标题/正文分离、无 `updatedAt`、无标签/分类。

### 4.3 Daily Focus（`my-tech-lab-daily-focus`）

```
{ schemaVersion: 1, activeDate: "YYYY-MM-DD", records: { "YYYY-MM-DD": { priorities: ["","",""] } } }
```

| 字段 | 类型 | 含义 |
|---|---|---|
| `schemaVersion` | number(1) | 结构版本 |
| `activeDate` | `YYYY-MM-DD` | 当前激活日期 |
| `records[date].priorities` | string[3] | 每日 3 条重点（字符串） |

- **存在旧版格式** `{date, priorities}`（无 `schemaVersion`/`records`），由 `isLegacyDataCenterDailyFocus` 识别并 `normalizeDataCenterDailyFocus` 迁移（:6656、:6669）。

### 4.4 Idea（`my-tech-lab-ideas`）

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `id` | string | ✅ | 灵感 ID |
| `title` | string | ✅ | 标题 |
| `content` | string | ✅ | 正文 |
| `createdAt` | ISO string | ✅ | 创建时间 |
| `updatedAt` | ISO string | ✅ | 更新时间 |

### 4.5 Document Summary 记录（`my-tech-lab-document-summaries`）

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `id` | string | ✅ | 记录 ID |
| `title` | string | ✅ | 资料标题 |
| `sourceText` | string | ✅ | 原始资料文本 |
| `summary.executive` | string | ✅ | 摘要 |
| `summary.keyPoints` | string | ✅ | 要点 |
| `summary.important` | string | ✅ | 重要事项 |
| `summary.actions` | string | ✅ | 行动项 |
| `summary.deepAnalysis` | string | 可选 | 深度分析（旧记录无则补默认文案） |
| `analysisMode` | enum | 可选 | `full`/`quick`/`key-points`/`deep` |
| `model` | string | 可选 | 所用模型 |
| `createdAt` | ISO string | ✅ | 创建时间 |
| `updatedAt` | ISO string | ✅ | 更新时间 |

### 4.6 系统数据结构

- **模块设置**（§3.2 #6）：`{schemaVersion:2, enabledById}`；`enabledById` 仅存显式停用项，启用靠「键不存在」隐式表达；v1→v2 仅重写版本号。
- **模块设置恢复隔离**（#7）：`{quarantinedAt, sourceKey, rawValue}`。
- **恢复失败标记**（#8）：`{state:"recovery-required", createdAt, lastFailureAt, failedKeys, backupFormat, backupVersion}`。

---

## 5. 模块间数据关联图及说明

```
                    ┌─────────────── Dashboard（只读聚合）───────────────┐
                    │ 读 tasks（待办数/优先级排序）                       │
                    │ 读 notes（最近笔记）                               │
                    │ 读 daily-focus（今日重点）                         │
                    │ 读 document-summaries / ideas（统计计数）          │
                    └──────────────┬────────────────────────────────────┘
                                   │（单向读，无写回）
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
  ┌─────▼─────┐            ┌───────▼───────┐          ┌───────▼───────┐
  │ Task      │◄──写────────│ Daily Planning │          │ Daily Focus   │
  │ Manager   │            │（shared 无数据）│──读──────▶│（归档）       │
  └─────▲─────┘            └───────────────┘          └───────────────┘
        │
  ┌─────┴─────┐
  │ Task      │（shared 无数据）写任务：`importOrganizedTasks` → `persistTasks`
  │ Organize  │
  └───────────┘

  Quick Notes / Ideas / Document Summary：各自独立，无跨模块写；仅被 Dashboard 读。
  Data Center：读/写全部 5 业务键 + 3 系统键（备份/恢复/清空）。
```

**真实数据关联 vs 界面展示关联**：

| 关联 | 性质 | 说明 |
|---|---|---|
| Dashboard ↔ 各模块 | **界面聚合**（单向读） | 读 `tasks`/`notes`/`daily-focus`/`document-summaries`/`ideas` 内存态渲染，不写回 |
| Task Organization → Tasks | **真实写** | `importOrganizedTasks` 经 `persistTasks` 写入 task-manager |
| Daily Planning → Tasks + Daily Focus | **真实读** | `readDailyPlanningData` (:9388) 读两个键，仅用于生成 AI 计划建议 |
| Quick Notes ↔ 其他 | **无关联** | 独立 |
| Daily Focus ↔ 其他 | **仅被读** | 被 daily-planning 读 |

**是否存在重复存储/副本**：未发现业务数据重复存储；Data Center 的「预导入备份」「原始安全备份」「恢复快照」是**备份副本**（临时），非业务数据的重复持久化。

---

## 6. 数据备份与恢复能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 完整数据导出 | ✅ **[已实现]** | `createDataCenterBackup` (:6926) 导出 5 业务模块 + 模块设置 + 恢复隔离 + 恢复标记 |
| 完整数据导入 | ✅ **[已实现]** | `validateDataCenterBackup` + `applyDataCenterData`，导入前校验、预览、确认、预导入备份、失败回滚 |
| JSON 备份 | ✅ | 备份为 JSON 文件（Blob 下载） |
| 数据恢复 | ✅ | 全局恢复 + 模块设置损坏隔离恢复 |
| 数据格式校验 | ✅ | 各模块 `validate` + `isValidTask` 等 |
| 版本兼容 | ⚠️ **[部分实现]** | daily-focus（v1+legacy）、module-settings（v2+legacy v1）有版本；**Tasks/Notes/Ideas/Documents 无 schema 版本字段** |
| 重复数据识别 | ⚠️ **[部分实现]** | 仅 Task Organization 导入时按 `text` 去重；无全局去重 |
| 数据损坏处理 | ✅ **[部分实现]** | 模块设置损坏隔离+恢复；业务数据损坏则整键判定为不可用并提示，不静默覆盖 |

**迁移价值评估**：Data Center 的「集中式模块定义（`dataCenterModules`）→ 校验 → 版本兼容 → 导入预览 → 预导入备份 → 回滚」是未来 localStorage→PostgreSQL 迁移的**可复用骨架**；但其备份是「整模块 JSON」而非「逐条记录」，与关系数据库的行级迁移仍有距离。

---

## 7. 多设备数据一致性现状

| 问题 | 结论 |
|---|---|
| 为什么不同设备数据不能自动同步 | 数据全部在**浏览器 localStorage**（按 origin 隔离），无服务端存储、无同步协议、无账号体系 |
| 哪些数据完全保存在浏览器本地 | 全部 8 个 key（5 业务 + 3 系统） |
| 是否有任何远程持久化数据 | **无**。Cloudflare Worker 仅代理 AI 请求（`requestAI` 返回 `{reply,model}` 即丢弃，不落库） |
| AI API 是否承担数据持久化 | **不承担**。AI 只是输入→输出，结果由前端写入 localStorage |
| 引入统一 API 后哪些模块需改造 | 所有 5 个业务模块的 `persistX`/`loadX` 都需改造为 API 读写；模块设置/Data Center 需适配服务端配置与备份 |
| 哪些模块可保持不变 | 纯前端 UI/渲染逻辑、AI 工作流的 Prompt 与解析逻辑可基本不变（仅数据读写层替换） |

---

## 8. FastAPI + PostgreSQL 迁移适配性分析

### 8.1 适合设计为独立数据表的数据

| 现有数据 | 建议表 | 备注 |
|---|---|---|
| Tasks | `tasks` | 含 priority/completed/dueDate/completedAt |
| Quick Notes | `notes` | |
| Daily Focus | `daily_focus`（或 `daily_focus_records`） | 归档结构适合拆主表 + 子表 |
| Ideas | `ideas` | |
| Document Summary | `document_summaries` | `summary` 建议拆列或 JSONB |
| Module Settings | `module_settings` | `enabled_by_id` 可 JSONB 或行表 |

### 8.2 逻辑关联（外键候选）

- `task.project_id`（未来）→ projects
- `note → knowledge_item`（未来，「捕获→沉淀」链路）
- `document_summary` → 未来 Knowledge Base 条目（来源关联）
- 当前**无跨业务模块的外键**（各模块独立）。

### 8.3 字段命名与结构不一致（需统一）

| 问题 | 详情 |
|---|---|
| 「正文」字段名不统一 | Task/Note 用 `text`、Idea 用 `content`、Document 用 `sourceText` |
| 更新时间字段不一致 | 仅 Idea/Document 有 `updatedAt`；Task/Note 无 |
| 完成时间 | 仅 Task 有 `completedAt` |
| schema 版本 | 仅 daily-focus、module-settings 有；4 个数组型数据无版本号 |
| ID 格式 | 均为 `Date.now()-random` 字符串，未统一 |

### 8.4 用户级隔离与敏感数据

- 当前**单用户**，无 `user_id`；未来多用户需在全部表加用户隔离字段。
- **Document Summary 的 `sourceText`** 可能承载敏感资料（未来医疗场景尤其），需**独立权限、审计、加密**设计。
- 未来 Professional Applications（医疗助手、科室管理、安宁疗护）涉及患者级数据，需**独立 schema + 访问控制 + 审计**（已写入 ARCHITECTURE.md §12.5）。

---

## 9. 当前数据架构存在的问题

1. **无 schema 版本字段**（Tasks/Notes/Ideas/Documents 为裸数组），未来结构演进缺少迁移锚点。
2. **AI Assistant 对话不持久化**，用户对话历史无法备份/跨设备。
3. **多设备无法同步**（架构性限制，非 bug）。
4. **字段命名不统一**（`text`/`content`/`sourceText`、`updatedAt` 缺失）。
5. **无全局去重**，仅 Task Organization 导入时按 text 去重。
6. **备份为整模块 JSON**，非行级，迁移到关系库需额外转换层。
7. **Document Summary 存储原始文本**，敏感数据无隔离/加密。

---

## 10. 数据结构可演进性评估

> 本报告仅记录当前实际数据结构，不代表字段冻结或业务功能定型。以下基于当前 `index.html` 实际读写/校验/导入/导出逻辑，评估未来增量迭代时新增字段的兼容性。

### 10.1 各数据结构字段兼容性实测

| 数据 | 读取校验是否拒绝未知字段 | 编辑/更新是否保留未知字段 | 备份/导入是否保留未知字段 | 扩展能力 |
|---|---|---|---|---|
| Task | 否（宽松，`isValidTask` 只校验已知字段） | ✅ 编辑用 `{...task, ...}` spread | ✅ 整数组写入、整数组备份 | **好** |
| Quick Note | 否（宽松） | ✅ 编辑用 `{...note, text}` spread | ✅ 整数组 | **好** |
| Idea | 否（宽松） | ❌ 编辑重建 `nextIdea`（不 spread `existing`，:11719） | ⚠️ 备份整数组保留，但编辑会丢未知字段 | **中** |
| Document Summary | 否（宽松） | ✅ `{...record, ...}` spread（:11209） | ✅ spread | **好** |
| Daily Focus | 严格结构校验 | ❌ `cloneDailyFocusArchive`/`normalizeDataCenterDailyFocus` 重建（:9991、:6669） | ❌ normalize 重建，丢未知字段 | **弱** |
| Module Settings | ✅ **严格白名单**（拒绝未知字段，:5442） | — | 严格校验 | **无**（需显式改 validate + 升版本） |

### 10.2 六项评估结论

**1. 是否具有扩展能力** — 分模块：Tasks / Quick Notes / Document Summary 具备良好扩展能力（spread 保留未知字段）；Ideas 中等（编辑重建会丢字段）；Daily Focus 弱（多处重建）；Module Settings 无（严格白名单，新增字段必须同步改校验与版本）。

**2. 新增字段时旧数据是否兼容** — 大部分可兼容：校验采用「字段存在才校验」策略（`isValidTask` 的 `dueDate !== undefined && ...`、`note !== undefined && ...`），旧数据缺新字段时按 `undefined` 处理不报错。但 **Ideas / Daily Focus 的重建逻辑会把新增字段丢弃**，兼容性受限。

**3. 是否存在依赖固定字段集合的逻辑** — 存在，共 4 处：
- `validateModuleSettings`（:5442）：严格白名单，拒绝 `schemaVersion`/`enabledById` 之外的字段。
- `validateDataCenterBackup`（:7125）：严格要求 `format`、`version`、`modules.length === dataCenterModules.length`，未来新增模块或改版本会被拒。
- `cloneDailyFocusArchive` / `normalizeDataCenterDailyFocus`：按固定字段重建。
- `nextIdea`（Ideas 编辑，:11719）：按固定字段重建。

**4. 新增字段后是否可能旧数据丢失/覆盖** — 有两类风险：
- **Data Center 导入整键替换**：`applyDataCenterData` 用 `notes = imported.get(...)` 整体替换。若导入的是旧备份（缺新字段），会覆盖当前含新字段的数据。
- **重建式写入丢字段**：Ideas 编辑、Daily Focus 备份/导入会重建对象，丢失不在白名单内的新增字段。

**5. 备份恢复能否保留未来新增字段** — 部分能：Tasks/Notes/Documents 可（wholesale/spread）；Daily Focus 不能（normalize 重建）；且备份版本严格校验（`version !== dataCenterVersion` 即拒），未来版本备份需同步升级 `dataCenterVersion` 与兼容逻辑，否则无法导入。

**6. 未来如何用 Schema Version 与 Migration 管理演进** — 见 §10.3。

### 10.3 数据结构演进建议

遵循原则：**不冻结现有结构、允许已验收模块增量迭代、新增字段向后兼容、避免破坏性修改、旧数据有明确升级策略、不立即引入复杂框架、为 FastAPI+PostgreSQL 预留规范化迁移机制。**

1. **为 4 类裸数组数据补充版本标识**：Tasks / Quick Notes / Ideas / Document Summary 目前是无版本裸数组，建议未来演进为 `{ schemaVersion, items: [...] }` 包装（或增加独立的版本键），为迁移提供锚点——**当前不必做，仅在首次需要新增字段时一并引入**。
2. **修正「重建式写入」为「spread 式写入」**：Ideas 的 `nextIdea`、Daily Focus 的 `cloneDailyFocusArchive`/`normalizeDataCenterDailyFocus` 应在保留已知字段的同时 spread 原对象，避免丢未知字段（`{ ...existing, ...knownUpdates }`）。
3. **新增字段遵循「可选 + 缺省回填」**：新字段一律可选、提供默认值；读取时对缺失字段回填默认值，写回时补齐——保持旧数据可读、可升级。
4. **Module Settings 的演进**：因严格白名单，新增字段必须同时更新 `validateModuleSettings` + 提升 `moduleSettingsSchemaVersion`，并在 `migrateModuleSettings` 中新增「旧版本 → 新版本」的兼容迁移（现有 v1→v2 迁移模式可复用）。
5. **Data Center 备份版本兼容**：`validateDataCenterBackup` 的严格版本校验，未来需改为「支持读取 N-1 版本 + 迁移到当前版本」，并保留旧备份导入路径（现有 daily-focus legacy 识别是良好范例）。
6. **规范化迁移流程**：任何结构演进遵循「先备份 → 迁移 → 校验 → 可回滚」，与 Data Center 现有「预导入备份 + 失败回滚」一致；未来后端用 Alembic 承接数据库迁移（已在 ARCHITECTURE.md §11 技术路线中规划）。

## 11. 后续统一数据底座建设建议

> 均为**建议方向**，不代表立即实施；遵循「适度设计、增量扩展」。

1. **建立统一数据契约层**：抽象 `persistX`/`loadX` 为统一 DataService 接口，前端业务只依赖接口，为「localStorage → REST API」替换做准备（与 ROADMAP §4「统一数据模型与 DataService/API」一致）。
2. **为裸数组数据补充 schemaVersion**：在迁移前为 Tasks/Notes/Ideas/Documents 增加版本字段（版本化迁移，保持旧数据兼容）。
3. **统一 ID/时间/状态字段**：定义全局 `id`（UUID）、`createdAt`/`updatedAt`、`status` 约定，减少表间不一致。
4. **AI 对话持久化决策**：明确是否持久化 AI Assistant 对话（隐私、保留、导出规则需先行确认）。
5. **敏感数据分级**：Document Summary 与未来专业应用数据独立 schema + 权限 + 审计。
6. **复用 Data Center 骨架**：把「模块定义 → 校验 → 版本 → 预览 → 预导入备份 → 回滚」固化为迁移与恢复的标准流程。

---

## 12. 尚未确认或需要进一步检查的事项

- **[无法确认]** Cloudflare Worker 线上配置、Secret、限流、日志（Worker 源码不在仓库）。
- **[无法确认]** 线上实际部署版本与本地 HEAD 的差异。
- **[待确认]** AI Assistant 对话是否需纳入未来持久化与备份。
- **[待确认]** 未来多用户模式下，现有单用户数据如何归属与隔离。
- **[待确认]** `sourceText` 原始文本的保留策略（保留时长、是否可删、是否脱敏）。

---

*本报告基于当前工作区 `index.html` 实际代码生成，未修改任何文件、数据或配置。*
