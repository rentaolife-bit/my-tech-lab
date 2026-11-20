# My Tech Lab 统一数据底座总体设计（初稿 V2）

> **文档性质**：设计初稿（V2 修正版），供评审用，非正式定稿。
> **状态**：`[待评审]`　**日期**：2026-11-08
> **依据**：`index.html` 实际代码（已逐段核对）+ `ARCHITECTURE.md` + `ROADMAP.md` + `docs/data-asset-inventory.md` + `docs/data-structure-evolution-risk-review.md` + `docs/information-architecture-blueprint.md`。
> **约束**：本文只做分析与设计；不修改 `index.html`、不修改现有架构文档、不开发 FastAPI、不安装 PostgreSQL、不触碰任何生产数据、不 Commit / Push。

---

## V2 修正说明（相对 V1）

**V2 修正了 V1 中「多设备历史数据迁移」的错误假设**，其余章节结论不变：

| 项 | V1（错误假设） | V2（修正） |
|---|---|---|
| 首次迁移数据源 | 隐含 Mac / iPhone / iPad 三设备历史数据需要汇集 | **iPhone 为唯一实际业务数据源**，以 iPhone Data Center 导出为准 |
| Mac / iPad 定位 | 视为有历史数据、需并入迁移 | **尚未正式投入使用**，无历史业务数据，不纳入首次迁移 |
| 设备接入时机 | 隐含三设备同时迁移 | Mac / iPad 在后端上线后**独立阶段接入**，首次登录直接读 PostgreSQL |
| 实施路线 | 「三设备历史数据汇集阶段」 | 「iPhone 唯一数据源盘点与迁移准备」+ 独立「Mac/iPad 接入」阶段 |
| 未来能力 | 未明确 | 保留**设备来源标识、legacy_id、幂等导入、冲突检测**，应对未来特殊导入 |

> **关键原则**：不把「三设备合并」机械保留为必经流程；首次迁移只针对 iPhone 一个真实数据源。

---

## 状态标记约定

全文统一使用三档标记，用于区分事实与主张：

| 标记 | 含义 |
|---|---|
| **[已确定]** | 由当前代码/文档可确认的现状事实，或已获认可的既定方向。 |
| **[建议]** | 本文提出的方案主张，需评审确认后才转为既定。 |
| **[待决策]** | 尚无可靠依据、留待后续阶段再定的开放问题。 |

> 涉及设备实际使用情况的事实，属于「用户提供信息」，本文统一标注为 **[已确定·待现场确认]**，即「以用户说明为准，但需在迁移前由用户实地核实」。

---

## 1. 当前架构现状

### 1.1 现状速览 **[已确定]**

| 维度 | 现状 |
|---|---|
| 前端 | GitHub Pages 静态单页；原生 HTML/CSS/JavaScript，全部逻辑集中于单文件 `index.html`（约 12k 行） |
| 数据存储 | 浏览器 `localStorage`（唯一持久化机制）；无 sessionStorage / IndexedDB / Cookie / 服务端数据库 |
| AI | 前端 → Cloudflare Worker（`https://my-tech-lab-api.rentao-life.workers.dev`）→ DeepSeek；Worker 为纯代理，不落业务数据 |
| 后端 | 无。已认可的未来方向为 Python + FastAPI + PostgreSQL（尚未启动） |
| 身份 | 无登录、无用户体系，单用户 |

### 1.2 设备实际使用情况 **[已确定·待现场确认]**

| 设备 | 当前状态 | 对迁移的意义 |
|---|---|---|
| **iPhone** | **唯一真正投入使用**，现有业务数据主要在 iPhone Safari 的 `localStorage` | **首次迁移的唯一权威数据源** |
| Mac | 尚未正式投入使用，无需要汇集的历史业务数据 | 不纳入首次迁移；后端上线后接入 |
| iPad | 尚未正式投入使用，无需要汇集的历史业务数据 | 不纳入首次迁移；后端上线后接入 |

> **[已确定]** 代码层面**不存在任何设备标识、设备来源、同步协议逻辑**（全项目搜索 `device`/`sync` 仅命中无关 UI 文案）；数据纯 `localStorage` 按 origin 隔离，各设备天然独立。
> **[待现场确认]** iPhone 实际数据量与内容完整性，AI 无法直接读取 iPhone Safari `localStorage`，须由用户在迁移前实地核对。

### 1.3 当前持久化全景（8 个 localStorage 键）**[已确定]**

**业务数据键（5 个，纳入 Data Center 备份）**：

| 键 | 模块 | 结构 |
|---|---|---|
| `my-tech-lab-notes` | quick-notes | `[{id,text,createdAt}]` 裸数组，无 schemaVersion |
| `my-tech-lab-tasks` | task-manager | `[Task]` 裸数组，无 schemaVersion |
| `my-tech-lab-daily-focus` | daily-focus | `{schemaVersion:1, activeDate, records:{date:{priorities:[3×string]}}}` |
| `my-tech-lab-ideas` | ideas-writing | `[{id,title,content,createdAt,updatedAt}]` 裸数组 |
| `my-tech-lab-document-summaries` | document-summary | `[DocumentRecord]` 裸数组 |

**系统键（3 个，独立于业务备份）**：

| 键 | 用途 |
|---|---|
| `my-tech-lab-module-settings` | 模块启停设置 `{schemaVersion:2, enabledById}` |
| `my-tech-lab-module-settings-recovery` | 损坏设置隔离记录 |
| `my-tech-lab-data-center-recovery-failed` | 恢复失败保护标记 |

### 1.4 模块与数据归属 **[已确定]**

Module Registry 登记 **10 个模块**，`dataOwnership` 分三档：`none` / `shared` / `own`。

| 模块 | 类型 | 数据归属 | 说明 |
|---|---|---|---|
| ai-assistant | standalone | none | 对话仅存内存，刷新即失 |
| daily-planning | embedded-workflow | shared | 只读 tasks + daily-focus |
| task-organization | embedded-workflow | shared | 写 task-manager |
| document-summary | embedded-workflow | own | 自有历史 |
| ideas-writing | embedded-workflow | own | 自有记录 |
| daily-focus | standalone | own | — |
| task-manager | standalone | own | — |
| quick-notes | standalone | own | — |
| data-center | system-management | none | 管理 5 业务键 + 系统键 |
| module-management-center | system-management | none | 管理模块设置 |

> `daily-planning`、`task-organization` 是「操作别人数据的 AI 能力」，**没有自己的数据表**；`document-summary`、`ideas-writing` 是「模块 + AI 能力」混合体，**有自有数据表**。Dashboard 无独立 id、无自有数据，是**只读聚合视图**。

### 1.5 模块间真实数据关联 **[已确定]**

```
Dashboard（只读聚合，不写回）
   ├─ 读 tasks / notes / daily-focus / document-summaries / ideas
   └─ 单向读，无写回

daily-planning ──读──▶ tasks + daily-focus（readDailyPlanningData）
task-organization ──写──▶ tasks（importOrganizedTasks → persistTasks）

quick-notes / ideas / document-summary：各自独立，仅被 Dashboard 读
```

**结论**：当前**无任何跨业务模块的外键**；唯一真实关联是两条 AI 工作流对 Tasks / Daily Focus 的读写。Data Center 是全量读写的系统级入口（备份/恢复/清空），不参与业务流转。

### 1.6 AI 调用现状（requestAI 契约）**[已确定]**

- 端点常量：`aiWorkerEndpoint = "https://my-tech-lab-api.rentao-life.workers.dev"`。
- 请求体：`{ messages }`；响应契约：`{ reply, model }`。
- 统一传输层 `requestAI` 处理：fetch 发送、90 秒超时、HTTP 状态检查、JSON 解析、`{reply,model}` 校验、错误分类（`TimeoutError`/`AbortError`/`NetworkError`/`HTTPError`/`InvalidResponseError`）、调用方 signal 桥接与迟到响应丢弃。
- 5 个工作流各持独立 `AbortController` 与 AccessVersion。
- **API Key 不在前端**；Worker 源码与线上配置不在仓库，无法确认。

### 1.7 现状关键结论（对迁移的影响）**[已确定 + 建议]**

1. **没有可直接落库的行级数据源**：数据是「整模块 JSON」，迁移需要一个转换层。
2. **字段命名与结构不统一**：`text`（Task/Note）vs `content`（Idea）vs `sourceText`（Document）；`updatedAt` 仅 Idea/Document 有；4 类裸数组无 schemaVersion。
3. **已知演进风险（P2/P3）**：Ideas/Document 编辑「重建对象」会丢失未来未知字段；Daily Focus clone/normalize 重建；备份版本/模块数严格校验导致旧备份不兼容。
4. **Data Center 的「模块定义 → 校验 → 版本 → 预览 → 预导入备份 → 回滚」是可复用骨架**，但粒度是整模块而非行级。
5. **AI 对话不持久化**，属产品决策，非技术缺陷。

---

## 2. 目标总体架构

### 2.1 目标架构图 **[建议]**

```text
┌─────────────────────────────────────────────────────────────┐
│  GitHub Pages（原生 HTML/CSS/JS，保留现状）                    │
│  ├─ 业务模块 UI（Task/Note/Daily Focus/Idea/Document…）        │
│  ├─ AI 工作流（保留现有 Prompt 与解析逻辑）                     │
│  └─ 数据访问层（DataService 抽象，替换 localStorage 为 API）     │
└───────────────┬──────────────────────────┬──────────────────┘
                │ HTTPS (Cloudflare Tunnel) │ AI（保留现 Worker）
                ▼                          ▼
┌────────────────────────────────┐  ┌─────────────────────────┐
│  FastAPI（模块化单体，迷你主机）  │  │ Cloudflare Worker        │
│  ├─ Auth（认证/授权）           │  │  → DeepSeek（不变）        │
│  ├─ 各模块 Router + Service     │  └─────────────────────────┘
│  ├─ 校验（Pydantic）           │
│  ├─ 备份/恢复/迁移             │
│  └─（可选）AI 代理衔接          │
└───────────────┬────────────────┘
                ▼
┌────────────────────────────────┐
│  PostgreSQL（持久化卷，独立于容器）│
│  users / tasks / notes / ideas… │
└────────────────────────────────┘
```

### 2.2 组件职责与「不变项」**[建议]**

- **前端**：保留原生技术栈与现有业务逻辑、AI 工作流的 Prompt 与解析、模块启停/读写守卫/AbortController 机制。**唯一替换点是数据读写层**（`persistX`/`loadX` → DataService）。
- **后端**：统一提供认证、模块 CRUD、校验、备份恢复；AI 继续走现有 Worker（不强制重建）。
- **数据库**：业务数据与系统配置分离，数据独立于容器生命周期。
- **Dashboard**：仍为只读聚合，**永远不成为重复存储层**。

### 2.3 与当前架构的差异 **[建议]**

| 维度 | 当前 | 目标 |
|---|---|---|
| 数据源 | localStorage（单设备） | PostgreSQL（服务端唯一事实源） |
| 数据读写 | `persistX`/`loadX` 直写 localStorage | DataService 抽象，内部走 REST API |
| 身份 | 无 | User ID 归属（单用户起步，表结构预留多用户） |
| AI | Worker 直连 | 保留 Worker；可选经 FastAPI 代理 |
| 部署 | 纯静态 | 静态前端 + 自托管后端 |

---

## 3. 用户身份与认证设计

> 以 `ARCHITECTURE.md` §13 为基线，不开发登录功能。

### 3.1 身份模型 **[已确定（沿用 §13）]**

| 概念 | 含义 | 归属决定权 |
|---|---|---|
| **User ID** | 系统内部唯一、稳定标识 | **数据归属唯一锚点**，不能用邮箱/用户名代替 |
| Username | 用户名，可改 | 不决定归属 |
| Display Name | 工作台展示名，可改 | 不决定归属 |
| Login Account | 登录身份（邮箱/第三方） | 仅用于 Authentication |
| Authentication | 验证「你是谁」 | — |
| Authorization | 决定「你能访问/操作什么」 | 与 Authentication 分层 |

### 3.2 User ID 的生成与管理 **[建议]**

- **生成方式**：服务端生成，推荐 **UUIDv4**（或 ULID），后端在建号时分配，**禁止**以邮箱、用户名或设备 ID 派生。
- **管理**：User ID 一经生成**永不变更**；改名、换邮箱均不迁移 User ID 及其关联数据。
- **当前单用户落地**：`users` 表从第一天带 `id`（UUID）主键；首个迁移用户即「所有者」，iPhone 数据迁入后统一挂到该 User ID 下。

### 3.3 单用户 → 多用户平滑过渡 **[建议]**

- 表结构从第一天带 `user_id`，业务上先跑单用户，避免「先建无归属表、后补 user_id」的破坏性重构。
- 第一阶段：`users` 表只有 1 行（所有者）；所有业务表 `user_id` 指向该行。
- 多用户时：新增 `users` 行即可，业务表无需改结构。
- **数据归属关系**：每条业务记录 `user_id` 外键 → `users.id`；查询一律按 `user_id` 过滤，API 层从认证上下文注入 `user_id`，**不接受客户端指定 user_id**。

### 3.4 未来认证机制接入 **[建议 / 待决策]**

- **[建议]** 优先采用**成熟身份认证服务或标准协议**，**不自行开发完整密码体系**。
- **[待决策]** 具体方案（Cloudflare Access、邮箱 OTP、单次令牌、OIDC 等）留待后端实施阶段，结合「迷你主机自托管 + GitHub Pages 公开前端」的拓扑再定。
- **[建议]** 认证产出**短期会话令牌**（JWT 或 opaque token），后端校验；前端**不保存长期 Secret**。

### 3.5 数据归属与权限边界 **[建议]**

- 普通个人工作台数据：以 `user_id` 为归属边界。
- 未来 Professional Applications：独立的 schema + 访问控制 + 审计，**不简单等同于**个人数据的 user 归属。
- **[待决策]** 医疗等敏感数据的加密、审计、访问控制细节，待专业应用真正建设时另行设计。

---

## 4. 统一数据模型

### 4.1 设计原则 **[建议]**

1. **基础字段统一，业务字段独立**：仅统一「身份 + 时间 + 主键 + 设备来源」等公共约定，**不做一张巨型通用实体表**。
2. **模块独立运行，数据有序关联**：各模块保留独立表；跨模块仅通过外键引用关联。
3. **不为了统一而破坏模块边界**：不能把 Tasks/Notes/Ideas 硬塞进同一张「条目表」。
4. **Dashboard 只读聚合**，不落库、不写回。

### 4.2 数据归类结论 **[已确定 + 建议]**

| 数据 | 处置 | 理由 |
|---|---|---|
| Tasks | **独立表** | 有明确业务语义与字段 |
| Quick Notes | **独立表** | capture 语义，未来可提升为 Knowledge Item（漏斗关系） |
| Daily Focus | **独立表（按日期拆行）** | 现有 `records[date]` 归档结构天然适合行化 |
| Ideas | **独立表** | 未来与 Documents 拆分，先保留 |
| Document Summary | **独立表** | `sourceText` 可能承载敏感资料，需独立边界 |
| 模块设置 | **独立表（用户偏好）** | 系统配置与业务数据分离 |
| AI 对话 | **不建表（暂）** | 属产品决策，待定是否持久化 |
| Dashboard | **不建表** | 纯聚合视图 |

### 4.3 关联关系（外键候选）**[建议 / 待决策]**

| 关联 | 现状 | 建议 |
|---|---|---|
| task → project | 无 | **[待决策]** 未来 `task.project_id` 可空外键 → projects（Tasks 保持独立，不强制归属） |
| note → knowledge_item | 无 | **[待决策]** 未来「捕获 → 沉淀」升级链路 |
| document_summary → knowledge_item | 无 | **[待决策]** 来源关联 |
| 当前各业务模块之间 | 无 | **[已确定]** 维持无外键，独立演进 |

### 4.4 公共基础实体（只抽象该抽象的）**[建议]**

仅抽象**公共列约定**（不抽象为独立「基础实体」表）：

- `id`：UUID 主键（新数据）；旧数据 ID 保留为 `legacy_id` 字段。
- `user_id`：归属外键。
- `source_device`：设备来源标识（可空，见 §5.1，用于未来特殊导入）。
- `created_at` / `updated_at`：统一 `timestamptz`。
- `schema_version` / 迁移：见 §5.5。

**明确不做**：不建「通用条目表（type 字段区分 Task/Note/Idea）」。

### 4.5 Schema Version 与新增字段演进 **[建议]**

1. **数据库层**：用 Alembic 迁移管理结构演进（加列、改类型等），每版可回滚。
2. **API 层**：接口版本化（如 `/api/v1/...`）；新增可选字段向后兼容。
3. **前端数据层**：迁移前为 4 类裸数组补 schemaVersion 包装（`{schemaVersion, items}`），作为迁移锚点。
4. **新增字段遵循「可选 + 缺省回填」**。
5. **先修两处「重建式写入」**（Ideas、Document 编辑改为 spread），否则未来新字段会在编辑时丢失（P2 风险 R1/R2）。

### 4.6 保护现有模块边界 **[建议]**

- **不合并表、不改模块 id、不重命名现有存储键**（除非有版本化迁移 + 兼容恢复路径）。
- 模块停用只读、读写守卫、AI 取消等机制**保持不动**；数据底座替换只发生在「数据读写层」。
- Data Center 的备份/恢复/清空语义在服务端化后**重新映射**，但用户可见的保护机制（备份、确认、回滚）不降级。

---

## 5. PostgreSQL 数据结构建议

> **原则**：不把 localStorage 数据机械地 1:1 转成表。先按业务语义行化，再定字段。

### 5.1 通用字段约定 **[建议]**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | 服务端生成；旧数据 `legacy_id` 存原 `Date.now()-random` 字符串 |
| `user_id` | UUID FK → users.id | 数据归属锚点，非空 |
| `source_device` | TEXT NULL | **设备来源标识**（如 `iphone`/`mac`/`ipad`），默认 NULL 或 `iphone`；为未来多设备独立数据导入预留 |
| `legacy_id` | TEXT NULL | 原 localStorage 记录的 `Date.now()-random` ID，用于幂等导入与溯源 |
| `created_at` | timestamptz NOT NULL | 默认 `now()` |
| `updated_at` | timestamptz NOT NULL | 更新时刷新 |
| `deleted_at` | timestamptz NULL | 软删除（可选，**[待决策]** 是否启用） |

> `source_device` + `legacy_id` 的引入**只为保留未来多设备迁移能力**，不影响当前单数据源迁移；当前 iPhone 迁移时 `source_device` 置 `iphone`，`legacy_id` 存原 ID。

### 5.2 表结构（分「已确定」与「待定」）

#### A. 可初步确定的表 **[建议]**

**`users`**
```text
id            UUID PK
username      TEXT（可空，可改）
display_name  TEXT（可空，可改）
created_at / updated_at
```

**`auth_identities`**（登录身份关联表）
```text
id             UUID PK
user_id        UUID FK → users.id
provider       TEXT（如 email / oidc / cloudflare-access）
provider_sub   TEXT（该 provider 下唯一标识）
created_at
UNIQUE (provider, provider_sub)
```

**`tasks`**
```text
id UUID PK · user_id FK · text TEXT · priority TEXT(high|medium|low)
completed BOOL · due_date DATE NULL · note TEXT
completed_at timestamptz NULL · created_at · updated_at
source_device TEXT NULL · legacy_id TEXT NULL
```

**`notes`**
```text
id UUID PK · user_id FK · text TEXT · created_at · updated_at
source_device TEXT NULL · legacy_id TEXT NULL
```

**`ideas`**
```text
id UUID PK · user_id FK · title TEXT · content TEXT · created_at · updated_at
source_device TEXT NULL · legacy_id TEXT NULL
```

**`document_summaries`**
```text
id UUID PK · user_id FK · title TEXT · source_text TEXT
summary JSONB（executive/keyPoints/important/actions/deepAnalysis）
analysis_mode TEXT NULL · model TEXT NULL · created_at · updated_at
source_device TEXT NULL · legacy_id TEXT NULL
```

**`daily_focus_entries`**（由归档结构行化）
```text
id UUID PK · user_id FK
focus_date DATE NOT NULL
priorities JSONB（或 TEXT[]，3 条）
created_at · updated_at
UNIQUE (user_id, focus_date)
```

**`user_preferences`**（承接模块设置）
```text
user_id PK/FK · enabled_by_id JSONB · schema_version INT · updated_at
```

#### B. 需结合实际业务再确定的表 **[待决策]**

| 表 | 说明 | 触发条件 |
|---|---|---|
| `projects` | 跨模块组织中心 | Projects 正式管理能力启动时 |
| `knowledge_items` / `knowledge_links` | 知识条目与来源关联 | Knowledge Base 建设（第三阶段） |
| `ai_conversations` / `ai_messages` | AI 对话持久化 | 若决策持久化 AI 对话 |
| `attachments` / `assets` | 附件与数字资产 | 附件存储能力启动时 |

### 5.3 localStorage → 表字段映射 **[建议]**

| 旧键 | 旧字段 | 新表.新字段 | 备注 |
|---|---|---|---|
| tasks | id / text / priority / completed / createdAt / completedAt / dueDate / note | tasks.id(legacy_id) / text / priority / completed / created_at / completed_at / due_date / note | 补 `updated_at` |
| notes | id / text / createdAt | notes.* | 补 `updated_at` |
| ideas | id / title / content / createdAt / updatedAt | ideas.* | 直接映射 |
| document-summaries | id / title / sourceText / summary.* / analysisMode / model / createdAt / updatedAt | document_summaries.* | summary 并 JSONB |
| daily-focus | records[date].priorities | daily_focus_entries(focus_date, priorities) | 归档 → 行 |
| module-settings | enabledById | user_preferences.enabled_by_id | 系统键 → 用户偏好 |

> 命名统一说明：`text`/`content`/`sourceText` 落库时**分别保留各自语义**，**不做强行同名**；仅统一**时间、ID 与设备来源约定**。

### 5.4 索引与查询需求 **[建议]**

- 所有业务表：`(user_id, created_at DESC)` 复合索引（列表查询主路径）。
- `tasks`：`(user_id, completed)` 或 `(user_id, completed, priority)`（Dashboard 待办排序）。
- `daily_focus_entries`：`UNIQUE(user_id, focus_date)`。
- `auth_identities`：`UNIQUE(provider, provider_sub)`。
- **[建议]** 业务表加 `UNIQUE(user_id, legacy_id)`（`legacy_id` 非空时），用于**幂等导入**。

### 5.5 版本与迁移机制 **[建议]**

- **[已确定方向]** 采用 **Alembic** 管理数据库结构迁移。
- 迁移纪律：**「先备份 → 迁移 → 校验 → 可回滚」**，与 Data Center 现有流程同构。
- 结构迁移（加列）用 Alembic；**数据迁移**（localStorage 导入、旧版升级）用独立、可重跑的迁移脚本。
- 版本以 Alembic 的 revision 为准。

### 5.6 备份与恢复策略 **[建议]**

- 逻辑备份：`pg_dump`（覆盖全部业务数据），定期自动执行。
- 备份独立存储：独立磁盘 / NAS / 对象存储，避免与数据同盘同损；重要备份保留异地副本。
- 恢复演练：定期执行 `pg_restore` 恢复演练。
- 详见 §10。

---

## 6. FastAPI 分层与 API 设计

### 6.1 形态：模块化单体 **[建议]**

采用 **Modular Monolith**，**不引入微服务**：单一 FastAPI 应用，按模块划分 router / service / repository。

### 6.2 分层结构 **[建议]**

```text
app/
  main.py                # 应用装配、中间件、异常处理
  api/                   # 路由层（HTTP 契约）
    v1/
      auth.py            # 认证相关
      tasks.py notes.py ideas.py documents.py daily_focus.py
      prefs.py           # 用户偏好/模块设置
      migration.py       # 迁移导入（受限权限，见 §8）
      health.py          # 健康检查
  services/              # 业务逻辑
  repositories/          # 数据访问（SQLAlchemy）
  models/                # ORM 模型
  schemas/               # Pydantic 请求/响应模型
  core/                  # 配置、依赖注入、认证依赖
  migrations/            # Alembic
```

### 6.3 后端职责清单 **[建议]**

| 职责 | 落点 |
|---|---|
| 用户身份认证 | `core/auth` + `api/v1/auth.py` |
| 用户数据访问 | 所有业务路由按 `user_id` 过滤 |
| 模块数据 CRUD | 各模块 router + service + repository |
| 数据校验 | Pydantic（入参）+ 服务层业务规则 |
| API 权限控制 | 认证依赖 +（未来）模块级授权依赖 |
| 数据备份与恢复 | 独立 service（`pg_dump` 编排 + 恢复接口，受限权限） |
| 数据迁移导入 | `api/v1/migration.py`（幂等导入 + 冲突检测，受限权限） |
| AI 请求代理/衔接 | 见 §6.6 |

### 6.4 API 分层与模块组织 **[建议]**

- **一层公共路由前缀**：`/api/v1/`。
- **每个业务模块一组端点**，保持与现有模块边界一一对应，**不强行抽象成通用 CRUD**。
- **通用约定**：所有响应带 `created_at`/`updated_at`；写操作返回完整资源；错误用统一错误体 `{error, code, detail}`。
- **Dashboard 数据**：由前端聚合多个只读 GET 返回，**不提供「Dashboard 落库」端点**。

### 6.5 API 端点草案 **[建议]**

```text
# 认证
POST   /api/v1/auth/token            # 换取/刷新会话令牌（方案待定）
GET    /api/v1/me                   # 当前用户信息

# 任务
GET    /api/v1/tasks                # 列表（含完成态过滤）
POST   /api/v1/tasks                # 新建
PATCH  /api/v1/tasks/{id}           # 更新
DELETE /api/v1/tasks/{id}

# 笔记 / 灵感 / 资料总结
GET/POST/PATCH/DELETE  /api/v1/notes[/{id}]
GET/POST/PATCH/DELETE  /api/v1/ideas[/{id}]
GET/POST/PATCH/DELETE  /api/v1/documents[/{id}]

# 每日重点
GET    /api/v1/daily-focus?date=YYYY-MM-DD
PUT    /api/v1/daily-focus/{date}    # 整体写当日 3 条

# 偏好/模块设置
GET/PUT /api/v1/preferences

# 迁移导入（受限，见 §8）
POST   /api/v1/migration/import       # 幂等导入 + 冲突检测
GET    /api/v1/migration/report       # 迁移报告

# 系统
GET    /api/v1/health
```

### 6.6 AI 请求衔接 **[建议 / 待决策]**

| 方案 | 说明 | 取舍 |
|---|---|---|
| **A. 前端直连现有 Worker（推荐初期）** | 前端 `requestAI` 继续指向 Worker | 零后端改动；Secret 仍在 Worker；后端不承担 AI |
| B. 经 FastAPI 代理 | 前端 → FastAPI → DeepSeek（或其他模型） | 统一 Secret 管理、多模型路由、审计，但需新建代理、迁移 5 个工作流调用端点 |

- **[建议]** 初期沿用方案 A，**不重建 AI 链路**；待需要多模型路由 / 统一密钥管理 / 服务端 RAG 时再评估方案 B。
- **[待决策]** 方案 B 的触发时机与模型适配器设计。

---

## 7. 多设备同步机制

### 7.1 目标与现状差距 **[已确定]**

- **现状**：数据全在 localStorage（按 origin 隔离）。**当前仅 iPhone 实际投入使用**；Mac、iPad 尚未正式投入使用、无历史业务数据。Cloudflare Worker 不落业务数据。
- **目标**：三设备登录同一身份后访问**同一份服务端数据**（PostgreSQL）。

### 7.2 同步模型：服务端为唯一事实源 **[建议]**

- **服务端 PostgreSQL 是唯一事实源**；前端不再以 localStorage 为长期数据源。
- 前端保留**内存态 + 可选本地缓存**，启动时从服务端拉取，写操作即时提交服务端。
- **用户身份 ≠ 设备身份**：数据归属 User ID，设备只是访问入口。

### 7.3 设备接入节奏（不再做「三设备历史数据汇集」）**[建议]**

| 步骤 | 内容 | 时机 |
|---|---|---|
| **首次迁移（iPhone）** | iPhone 为唯一数据源，完成服务端导入与验证 | 后端上线时 |
| **iPhone 切换** | iPhone 切换为读写服务端数据 | 迁移验证通过后 |
| **Mac 接入** | Mac 首次登录后**直接从 PostgreSQL 读取统一数据**，不导入本地（空白/测试）数据 | 服务端数据迁移成功后，独立阶段 |
| **iPad 接入** | 同 Mac | 服务端数据迁移成功后，独立阶段 |

> **关键**：Mac / iPad 各自 localStorage 里的空白或测试数据**不作为权威数据源**，不参与首次迁移；只有未来发现它们产生了有价值的独立业务数据，才走 §8.7 的单独导入与去重流程。

### 7.4 并发与冲突避免 **[建议]**

- 初期用**乐观并发**：写请求携带 `updated_at`（或版本号），服务端比对，不一致返回 409；前端提示刷新后重试。
- 用户是「个人单用户多设备」，多数冲突是「同一条目先后编辑」，**last-write-wins + 版本校验**足够；**暂不建 CRDT / 同步队列**。
- `daily_focus` 已在前端用 `expectedRawValue` 乐观锁，服务端沿用「按日 upsert + 版本校验」。

### 7.5 离线、异常与首次迁移保护 **[建议]**

- **网络异常/请求失败**：前端统一错误分类（沿用 `requestAI` 思路），写失败时**不静默丢弃**，提示重试。
- **首次迁移**：见 §8，核心是「iPhone 导出 → 服务端导入 → 校验 → 保留原始 JSON 备份 → 确认后才切换主数据源」，**迁移不丢数据**。
- **多设备同时修改**：见 §7.4，版本校验兜底。
- **[待决策]** 是否需要在服务端维护「同步队列」（P3 才需要）。

### 7.6 同步分阶段（不要求第一阶段做复杂离线同步）**[建议]**

| 阶段 | 能力 | 说明 |
|---|---|---|
| **P1** | 在线直读直写 | 前端读写走 REST API；localStorage 仅作迁移来源，之后不再作为主数据源。**无离线同步** |
| P2 | 本地缓存 + 离线只读 | 服务端数据缓存在本地，网络断开时降级为只读；恢复后重拉 |
| P3 | 离线写入 + 同步队列 + 冲突解决 | 需要时才做（复杂，暂缓） |

> **[建议]** 第一阶段只做 P1，离线同步留到有真实需求再评估。

---

## 8. localStorage 迁移方案（iPhone 唯一数据源）

> **原则**：增量迁移、可回滚、验证完整性；iPhone 为唯一实际业务数据源；不假设 Mac/iPad 有需汇集的数据。

### 8.1 数据源与导出 **[已确定 + 建议]**

- **[已确定]** 现有 Data Center 已能导出全量 JSON（`createDataCenterBackup`，覆盖 5 业务键 + 模块设置）。
- **[建议]** 首次迁移**以 iPhone Data Center 导出的完整备份为唯一主要来源**。
- **[建议]** 迁移前先在 iPhone 上核实实际数据（各模块记录数、关键内容）并确认备份文件完整性（可成功打开、JSON 结构正确、模块数完整）。
- **[待现场确认]** iPhone 实际数据量与内容，须由用户实地核对。

### 8.2 旧数据 → 新表映射 **[建议]**

按 §5.3 字段映射逐条转换：

1. 读取 iPhone 导出 JSON → 解析各模块数组/归档。
2. 每条记录分配新 `id`（UUID），原 `Date.now()-random` 存 `legacy_id`。
3. 补 `user_id`（首个所有者）、`source_device = 'iphone'`、`updated_at`（缺失时回填 `created_at`）。
4. Daily Focus 归档 `records[date]` → 按日拆行。
5. 模块设置 `enabledById` → `user_preferences`。

### 8.3 迁移完整性验证（数量 + 内容 + 回滚）**[建议]**

- **数量核对**：每个模块「源记录数 = 落库记录数」。
- **内容核对**：随机抽 N 条逐字段比对源 JSON 与落库值；Daily Focus 按日期逐日核对 priorities 三条内容。
- **关键字段校验**：`created_at` 保留原时间（不重写为迁移时刻）。
- **回滚验证**：迁移后实测一次「服务端数据 → 导出回本地」的逆向通道，确认数据可完整还原。
- 产出迁移报告：源计数、目标计数、差异、异常清单。

### 8.4 回滚能力 **[建议]**

- 迁移前**强制下载并保留 iPhone 原始 JSON 备份**（原始备份，非二次加工）。
- 迁移写入服务端**用事务**：全部成功才提交，失败回滚，不留半迁移数据。
- **切换主数据源前**，iPhone 本地 localStorage 原数据**不删除**（至少保留一个明确的手动清理步骤 + 二次确认）。
- 服务端迁移后提供「导出回本地」的逆向通道（重新生成 Data Center 兼容 JSON），保证随时可回退。

### 8.5 迁移流程（顺序）**[建议]**

```text
1. iPhone 实地核实数据 + 手动导出本地备份（下载 JSON）
2. 校验备份完整性（JSON 可解析、模块数完整、记录数正确）
3. 前端读取备份 → 补版本包装 → 上传服务端（迁移专用端点）
4. 服务端校验 + 预览（返回将写入的记录数/警告）
5. 用户确认 → 事务写入（幂等导入，见 §8.6）→ 返回迁移报告
6. 完整性验证（数量 + 内容 + 时间字段）+ 回滚验证
7. 验证通过后，用户确认切换为服务端主数据源
8. iPhone 本地数据保留，待用户手动确认后再清理
```

### 8.6 幂等导入与冲突检测 **[建议]**

- **幂等导入**：以 `(user_id, legacy_id)`（或 `(user_id, source_device, legacy_id)`）为幂等键；重复导入同一备份**不产生重复记录**，已存在则跳过或更新。
- **冲突检测**：导入时若发现 `legacy_id` 已存在但内容不一致，标记为「冲突」并纳入迁移报告，**不静默覆盖**。
- 迁移端点设计为**可重跑**：同一份备份可安全重复提交，结果一致。

### 8.7 未来设备独立数据导入（预留，非当前流程）**[建议]**

- 若未来 Mac / iPad 产生了有价值的独立业务数据，再**单独提供**导入机制：
  - 单独选择该设备的导出备份 → 上传 → `source_device = 'mac'` / `'ipad'` 标识。
  - **去重**：以 `legacy_id` + `source_device` 检测与既有数据的重叠。
  - **冲突处理**：同 `legacy_id` 内容不一致时，提示用户逐条选择「保留服务端 / 采用导入 / 合并」。
- **[明确]** 此能力**仅为未来预留**，不纳入首次迁移，也不作为当前必经流程。

---

## 9. 迷你主机部署方案

### 9.1 基本架构 **[建议]**

```text
迷你主机（Ubuntu Server LTS）
  ├─ Docker Engine + Docker Compose
  │    ├─ fastapi（容器）
  │    └─ postgres（容器，挂持久化卷/named volume）
  └─ Cloudflare Tunnel（对外固定入口）

GitHub Pages（前端，HTTPS）
        ──HTTPS──▶ Cloudflare Tunnel ──▶ FastAPI ──▶ PostgreSQL
```

- 应用与数据分离：PostgreSQL 数据在持久化卷，容器重建不丢数据。
- 代码、配置纳入 Git（私有仓库）；密钥经 `.env` 注入，仓库只保留 `.env.example`。
- 前端**不硬编码局域网 IP**，API 基址统一由配置/稳定入口提供。

### 9.2 GitHub Pages 安全访问后端 **[建议 / 待决策]**

- 通过 **Cloudflare Tunnel** 提供稳定 HTTPS 入口，前端经域名访问 API，避免暴露家庭公网 IP。
- CORS 白名单收紧为 GitHub Pages 域名；但**CORS 不是身份验证**，仍须配合认证令牌。
- **[待决策]** 认证方案（见 §3.4），影响隧道后端的访问控制配置。

### 9.3 HTTPS、认证、密钥与网络安全 **[建议]**

| 项 | 要求 |
|---|---|
| HTTPS | Cloudflare Tunnel 提供；内网 FastAPI 也建议仅监听本机/Docker 内网 |
| 认证 | 所有业务 API 必须带认证；无匿名写接口 |
| 密钥管理 | DB 密码、模型 API Key 等用环境变量/密钥管理注入，**不进仓库、不进前端** |
| 网络安全 | 最小端口暴露；不把 Postgres 暴露公网；隧道限定入口 |
| 备份 | 见 §10 |

---

## 10. 安全、备份与恢复

### 10.1 安全 **[建议]**

- API Key、DB 密码等 Secret **不进公开前端、不进公开仓库**。
- 业务 API 全量认证 + `user_id` 归属过滤；**不信任客户端传入的 user_id**。
- 敏感数据（如 Document Summary `source_text`、未来医疗数据）独立表/schema + 独立权限 + 审计。
- 删除/清空/重置遵循「先备份 → 再确认 → 后删除」，高风险操作二次确认。

### 10.2 备份 **[建议]**

- 定期 `pg_dump` 全量备份；备份独立于服务器磁盘（NAS/对象存储）+ 异地副本。
- 备份文件加密存储；保留多代（如近 N 天日备 + 周备）。
- 前端仍保留 Data Center 的本地导出能力，作为「服务端之外的第二份用户自持备份」。

### 10.3 恢复与演练 **[建议]**

- 恢复流程：`pg_restore`，配套文档化清单。
- **定期执行恢复演练**（实际恢复一次，非只备份不验证）。
- 灾难恢复验收（`ARCHITECTURE.md` §11.6）：在全新服务器从零重建运行环境 + 数据恢复 + 前端连通验证，作为后端可迁移性的验收标准。

---

## 11. 分阶段实施路线

> 以下为**依赖关系排序**，不含具体日期；每阶段独立可验收、可回滚。**Mac / iPad 接入是独立阶段，放在 iPhone 数据迁移成功之后。**

| 阶段 | 内容 | 交付/验证点 |
|---|---|---|
| **0. iPhone 唯一数据源盘点与迁移准备** | 核实 iPhone 实际数据与备份完整性；为 4 类裸数组补 schemaVersion；修复 Ideas/Document 重建式写入（P2 R1/R2）；统一时间/ID/设备来源约定 | 前端数据仍走 localStorage，行为不变；回归测试全绿；iPhone 备份可完整导出 |
| **1. 后端骨架** | FastAPI 模块化单体 + PostgreSQL + Alembic + 认证雏形（单用户）；健康检查 | 后端可启动、可建库、可 CRUD（用 mock 数据验证） |
| **2. 前端数据访问层** | 抽象 DataService，`persistX/loadX` 替换为 API 读写（保持业务逻辑不变） | 在线直读直写（§7.6 P1）；模块停用/守卫机制不变 |
| **3. iPhone 数据迁移与上线** | iPhone 导出 → 服务端导入（幂等）→ 数量/内容核对 → 回滚验证 → 切换主数据源（§8） | 迁移报告通过；iPhone 原始 JSON 备份保留可回滚 |
| **4. Mac / iPad 接入**（独立阶段） | Mac、iPad 首次登录后**直接从 PostgreSQL 读取统一数据**；乐观并发 | Mac/iPad 读到同一份服务端数据；冲突返回 409 可处理 |
| **5. 备份与灾难恢复** | pg_dump 定期备份 + 恢复演练 | 恢复演练通过（§10.3） |
| **6.（后续按需）** | 离线缓存、同步队列、AI 服务端代理、Knowledge Base / Projects 等；未来若 Mac/iPad 有独立数据再启用单独导入（§8.7） | 由真实需求触发，不提前做 |

**保护已验收模块**：阶段 0–2 都保持前端业务逻辑、模块启停、读写守卫、AI 取消机制**不降级**；唯一替换点是数据读写层。

---

## 12. 尚待决策的问题

1. **认证方案**：自托管 + GitHub Pages 拓扑下，选用何种成熟认证（Cloudflare Access / 邮箱 OTP / OIDC / 短期令牌）？（§3.4）
2. **AI 代理**：AI 是否经 FastAPI 代理（方案 B），触发时机？（§6.6）
3. **AI 对话持久化**：是否持久化 AI Assistant 对话？若持久化，隐私/保留/导出规则？（§4.2）
4. **软删除**：业务表是否启用 `deleted_at` 软删除？（§5.1）
5. **Document `source_text` 保留策略**：保留时长、是否可删、是否脱敏（敏感资料）？（§4.2）
6. **多用户/共享协作**：未来是否引入分享、协作，还是长期保持「个人单用户」？（影响授权模型）
7. **同步复杂度**：是否/何时进入 P2（离线缓存）、P3（离线写入 + 同步队列）？（§7.6）
8. **备份频率与异地目标**：具体备份周期、加密与异地存储位置，待部署阶段定。（§10.2）
9. **模块设置云端化**：`enabledById` 落库为 `user_preferences` 后，损坏隔离/恢复如何在服务端承接？（§5.2）
10. **iPhone 实际数据核实**：迁移前须由用户现场确认 iPhone 数据量与内容完整性（AI 无法直接读取 iPhone localStorage）。（§1.2、§8.1）

---

## 附：核心结论速览

- **现状**：单文件静态前端 + 8 个 localStorage 键（5 业务 + 3 系统）+ Worker 代理 AI；无后端、无用户体系；**仅 iPhone 实际投入使用**，数据是「整模块 JSON」，非行级。
- **目标**：保留原生前端与现有 Worker；新增 FastAPI 模块化单体 + PostgreSQL；前端仅替换数据读写层为 REST API；服务端为唯一事实源。
- **身份**：User ID 为归属锚点，表结构从第一天带 `user_id`，业务先跑单用户；认证用成熟方案，不自研密码体系。
- **数据模型**：各模块独立表，仅统一「ID + 时间 + 归属 + 设备来源」公共约定，不建巨型通用实体表；Dashboard 只读聚合不落库。
- **数据库**：users / auth_identities / tasks / notes / ideas / document_summaries / daily_focus_entries / user_preferences 可初步确定；projects / knowledge_items / ai_conversations 等待业务触发再定；Alembic 管理迁移，pg_dump 备份。
- **迁移**：**iPhone 为唯一实际业务数据源**，复用 Data Center 导出 → 映射落库 → 数量/内容核对 → 幂等导入 → 事务写入 → 保留原始 JSON 备份可回滚；不把 Mac/iPad 汇集作为首次迁移必要步骤。
- **设备接入**：Mac / iPad 在后端上线后独立接入，首次登录直接读 PostgreSQL；未来若有独立数据再走单独导入 + 去重 + 冲突处理（保留设备来源标识、legacy_id、幂等导入、冲突检测能力）。
- **同步**：分阶段（P1 在线直读写 → P2 离线只读 → P3 复杂离线），第一阶段不做复杂离线同步；乐观并发兜底冲突。
- **风险承接**：迁移前先修 Ideas/Document「重建式写入」丢字段（P2），并为裸数组补 schemaVersion，否则未来字段演进受限。

---

*本设计初稿 V2 基于 `index.html` 实际代码与现有架构文档生成，未修改任何代码、数据、配置或 Git 状态。*
