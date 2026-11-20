# My Tech Lab 统一数据底座总体设计（V4）

> **文档性质**：总体设计（V4），供评审用，是指导后续 FastAPI + PostgreSQL 实施的方案基线。
> **状态**：`[待评审]`　**日期**：2026-11-08
> **依据**：`index.html` 实际代码（已逐段核对）+ `ARCHITECTURE.md` + `ROADMAP.md` + `docs/information-architecture-blueprint.md` + `docs/data-asset-inventory.md` + `docs/data-structure-evolution-risk-review.md`。
> **约束**：本文只做分析与设计；不修改 `index.html`、不修改测试文件、不修改现有架构文档、不开发 FastAPI、不安装 PostgreSQL、不触碰任何用户数据、不 Commit / Push。

---

## 版本修订记录

| 版本 | 日期 | 主要变更 |
|---|---|---|
| V1 | 2026-11-08 | 初稿：现状盘点 + 目标架构 + 六大方面分析 |
| V2 | 2026-11-08 | 修正多设备迁移假设：iPhone 为唯一实际数据源，Mac/iPad 后续接入 |
| **V3** | 2026-11-08 | 第二轮架构审查修订：保留数据结构演进已完成的成果并明确能力边界、区分设备身份与数据来源、补全认证流程与 API 安全、区分三层版本与 Record Version 乐观并发、补充 DataService 异步适配、补充 AI 数据流安全、细化迁移规则与回滚、调整为九阶段实施路线 |
| **V4** | 2026-11-08 | 第三轮审查修订：区分用户身份/认证/授权/用户管理四概念并确定单用户 Owner 原则、新增统一系统管理中心规划、明确 DataService 与 API Adapter 分层、补充数据库安全隔离（RLS/最小权限/隔离测试）、强化迁移可靠性（幂等/冻结窗口/中断重试/异常核对）、文档内部一致性修正、调整为七阶段实施路线 |

---

## 状态标记约定

全文统一使用四档标记，用于区分事实、已完成成果与主张：

| 标记 | 含义 |
|---|---|
| **[已确定]** | 由当前代码/文档可确认的现状事实，或已获认可的既定方向（如 FastAPI + PostgreSQL 技术路线）。 |
| **[已完成]** | 已落地并经提交确认的建设成果（如 Ideas/Document 字段保留修复）。 |
| **[建议]** | 本文提出的方案主张，需评审确认后才转为既定。 |
| **[待决策]** | 尚无可靠依据、留待后续阶段再定的开放问题。 |

> 涉及设备实际使用情况的事实，属「用户提供信息」，统一标注为 **[已确定·待现场确认]**。

---

## 1. 当前架构现状

### 1.1 现状速览 **[已确定]**

| 维度 | 现状 |
|---|---|
| 前端 | GitHub Pages 静态单页；原生 HTML/CSS/JavaScript，全部逻辑集中于单文件 `index.html` |
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

**结论**：当前**无任何跨业务模块的外键**；唯一真实关联是两条 AI 工作流对 Tasks / Daily Focus 的读写。

### 1.6 AI 调用现状（requestAI 契约）**[已确定]**

- 端点常量：`aiWorkerEndpoint = "https://my-tech-lab-api.rentao-life.workers.dev"`。
- 请求体：`{ messages }`；响应契约：`{ reply, model }`。
- 统一传输层 `requestAI` 处理：fetch 发送、90 秒超时、HTTP 状态检查、JSON 解析、`{reply,model}` 校验、错误分类（`TimeoutError`/`AbortError`/`NetworkError`/`HTTPError`/`InvalidResponseError`）、调用方 signal 桥接与迟到响应丢弃。
- 5 个工作流各持独立 `AbortController` 与 AccessVersion。
- **API Key 不在前端**；Worker 源码与线上配置不在仓库，无法确认。

### 1.7 现状关键结论（对迁移的影响）**[已确定 + 建议]**

1. **没有可直接落库的行级数据源**：数据是「整模块 JSON」，迁移需要一个转换层。
2. **字段命名与结构不统一**：`text`（Task/Note）vs `content`（Idea）vs `sourceText`（Document）；`updatedAt` 仅 Idea/Document 有；4 类裸数组无 schemaVersion。
3. **数据结构演进已完成部分基础兼容能力**（见 §4.5），但仍有明确边界。
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
│  └─ DataService 适配层（异步封装，替换 localStorage 直读写）     │
└───────────────┬──────────────────────────┬──────────────────┘
                │ HTTPS (Cloudflare Tunnel) │ AI（保留现 Worker）
                ▼                          ▼
┌────────────────────────────────┐  ┌─────────────────────────┐
│  FastAPI（模块化单体，迷你主机）  │  │ Cloudflare Worker        │
│  ├─ Auth（认证/授权）           │  │  → DeepSeek（不变）        │
│  ├─ 各模块 Router + Service     │  └─────────────────────────┘
│  ├─ 校验（Pydantic）           │
│  ├─ Record Version 乐观并发     │
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
- **后端**：统一提供认证、模块 CRUD、校验、乐观并发、备份恢复；AI 继续走现有 Worker（不强制重建）。
- **数据库**：业务数据与系统配置分离，数据独立于容器生命周期。
- **Dashboard**：仍为只读聚合，**永远不成为重复存储层**。

### 2.3 与当前架构的差异 **[建议]**

| 维度 | 当前 | 目标 |
|---|---|---|
| 数据源 | localStorage（单设备） | PostgreSQL（服务端唯一事实源） |
| 数据读写 | `persistX`/`loadX` 同步直写 localStorage | DataService 异步适配，内部走 REST API |
| 身份 | 无 | User ID 归属（单用户起步，表结构预留多用户） |
| AI | Worker 直连 | 保留 Worker；可选经 FastAPI 代理 |
| 部署 | 纯静态 | 静态前端 + 自托管后端 |

### 2.4 统一系统管理中心（System Administration）总体规划 **[建议]**

> 面向未来的统一管理能力规划；**只规划基础能力，不要求当前增加导航入口或开发界面**。现有 **Data Center** 与 **Module Management Center** 继续独立运行。

统一系统管理中心未来涵盖：

| 能力域 | 说明 | 状态 |
|---|---|---|
| 用户与身份管理 | 用户身份、账号状态、会话管理（未来按需，当前仅单用户 Owner） | [未来规划] |
| Data Center | 数据导出/导入/备份/恢复/清空（现有，保留） | [已实现·前端] |
| Module Management | 模块启停/详情/恢复（现有，保留） | [已实现·前端] |
| 系统配置 | 用户偏好、模块设置、系统参数 | [建议] |
| 数据库状态与健康检查 | 后端健康、数据库连通、迁移版本 | [建议] |
| 备份与恢复 | 定时 `pg_dump`、恢复演练 | [建议] |
| 系统日志与安全审计 | 登录、数据访问、异常、AI 请求审计（敏感场景） | [未来规划] |
| API 与服务状态 | 服务可用性、版本、限流状态 | [建议] |

- **边界**：上述为**能力清单**，不代表现在都要实现；后端建设阶段按 §11 阶段逐步落地。
- **不改变**现有五大工作区结构与 Module Management Center 的既有职责。

---

## 3. 用户身份与认证设计

> 以 `ARCHITECTURE.md` §13 为基线，不开发登录功能。

### 3.1 身份模型 **[已确定（沿用 §13.1）]**

| 概念 | 含义 | 归属决定权 |
|---|---|---|
| **User ID** | 系统内部唯一、稳定标识 | **数据归属唯一锚点**，不能用邮箱/用户名代替 |
| Username | 用户名，可改 | 不决定归属 |
| Display Name | 工作台展示名，可改 | 不决定归属 |
| Login Account | 登录身份（邮箱/第三方） | 仅用于 Authentication |
| Authentication | 验证「你是谁」 | — |
| Authorization | 决定「你能访问/操作什么」 | 与 Authentication 分层 |

#### 四个概念的区分 **[已确定（沿用 §13）+ 建议]**

| 概念 | 含义 | 本文定位 |
|---|---|---|
| **User Identity（用户身份）** | 用户是谁（`users` 表 + UUID User ID） | 数据归属主体 |
| **Authentication（用户认证）** | 验证「你是谁」 | 身份证明机制 |
| **Authorization（用户授权）** | 决定「你能访问/操作什么」 | 访问控制 |
| **User Management（用户管理）** | 用户资料、账号状态、角色权限等管理 | 未来按需建设 |

#### 确定原则 **[建议]**

1. **第一阶段必须建立 `users` 表及稳定的 UUID User ID**。
2. **所有业务数据必须具有 `user_id` 归属**。
3. **第一阶段采用单用户 Owner 模式**（`users` 表仅 1 行所有者）。
4. **不开放公开注册**。
5. **不开发完整用户管理界面**。
6. **认证和基础授权必须在真实业务数据接入前完成**（认证先于业务数据迁移）。
7. **预留未来扩展**：多用户、用户资料、账号状态、会话管理、角色权限。
8. **不允许客户端自行指定 `user_id`**（由认证上下文注入）。
9. **用户身份与设备身份分离**（见 §5.2）。

### 3.2 User ID 的生成与管理 **[建议]**

- **生成方式**：服务端生成，推荐 **UUIDv4**（或 ULID），后端在建号时分配，**禁止**以邮箱、用户名或设备 ID 派生。
- **管理**：User ID 一经生成**永不变更**；改名、换邮箱均不迁移 User ID 及其关联数据。
- **当前单用户落地**：`users` 表从第一天带 `id`（UUID）主键；首个迁移用户即「所有者」，iPhone 数据迁入后统一挂到该 User ID 下。

### 3.3 单用户 → 多用户平滑过渡 **[建议]**

- 表结构从第一天带 `user_id`，业务上先跑单用户，避免「先建无归属表、后补 user_id」的破坏性重构。
- 第一阶段：`users` 表只有 1 行（所有者）；所有业务表 `user_id` 指向该行。
- 多用户时：新增 `users` 行即可，业务表无需改结构。
- **数据归属关系**：每条业务记录 `user_id` 外键 → `users.id`；查询一律按 `user_id` 过滤，API 层从认证上下文注入 `user_id`，**不接受客户端指定 user_id**。

### 3.4 未来认证流程（补全）**[建议]**

> 以下为后端实施阶段需覆盖的完整认证生命周期，当前不开发。

```text
1. 首次登录        用户发起登录，重定向/调用身份提供方或输入凭据
2. 身份验证        后端验证凭据或第三方令牌真实性
3. 会话/令牌签发    签发短期会话令牌（JWT 或 opaque token）
4. API 请求认证    前端携带令牌请求；后端校验令牌并注入 user_id
5. 会话刷新        令牌过期前通过刷新机制延长会话
6. 退出登录        前端清除本地令牌/会话
7. 会话撤销        服务端使令牌/会话失效（登出、改密、异常时）
8. 数据归属验证    每次数据访问按 user_id 过滤，拒绝越权访问
```

#### 首个 Owner 的安全初始化 **[建议]**

- 首个 Owner（所有者）通过**一次性初始化流程**创建：部署后由运维者在受控环境（本机/内网）执行初始化，生成 Owner 的 `users` 记录与登录身份，**不通过公开端点创建**。
- 初始化凭据（如初始令牌/一次性链接）**不入仓库、不入前端**，初始化完成后立即失效或轮换。
- 初始化必须幂等：重复执行不产生第二个 Owner。

#### 会话生命周期设计 **[建议]**

| 环节 | 要求 |
|---|---|
| 登录 | 校验凭据/第三方令牌 → 签发短期 access token（+ 可选 refresh token） |
| 令牌刷新 | access token 过期前通过 refresh token 延长；refresh token 单独管理、可撤销 |
| 会话过期 | access token 设短有效期（如 15–60 分钟）；过期后需刷新或重新登录 |
| 注销 | 前端清除本地令牌；服务端使 refresh token 失效 |
| 会话撤销 | 服务端维护可撤销会话（登出、改密、异常检测时强制失效），撤销后立即拒绝后续请求 |

- **[建议]** 认证产出**短期会话令牌**，后端校验；前端**不保存长期 Secret**。
- **[待决策]** 具体认证供应商/协议（Cloudflare Access、邮箱 OTP、OIDC、短期令牌）留待后端实施阶段，结合「迷你主机自托管 + GitHub Pages 公开前端」拓扑再定，**当前不锁定供应商**。

### 3.5 认证相关三要素区分 + CORS 澄清 **[已确定 / 建议]**

| 概念 | 含义 | 边界 |
|---|---|---|
| **Cloudflare Tunnel** | 网络访问通道 | 只解决「前端如何到达后端」，**不解决身份** |
| **Authentication** | 身份认证 | 验证「你是谁」 |
| **Authorization** | 业务授权 | 决定「你能访问/操作什么」，与 Authentication 分层 |

- **[已确定]** **CORS 不等于身份认证**：CORS 只是浏览器跨域资源访问策略，不能防止未授权访问，须配合认证令牌（与 `ARCHITECTURE.md` §14 一致）。
- **[建议]** 若采用 **Cookie 会话**，需额外考虑：**CSRF 防护**、**SameSite 属性**、**跨域凭据配置**（`credentials` + CORS 白名单）。因前端（GitHub Pages）与后端（迷你主机）跨域，优先评估 **Authorization 头 + Bearer 令牌**，可规避 Cookie 跨域与 CSRF 的复杂性。

### 3.6 数据归属与权限边界 **[建议]**

- 普通个人工作台数据：以 `user_id` 为归属边界。
- 未来 Professional Applications：独立的 schema + 访问控制 + 审计，**不简单等同于**个人数据的 user 归属。
- **[待决策]** 医疗等敏感数据的加密、审计、访问控制细节，待专业应用真正建设时另行设计。

---

## 4. 统一数据模型

### 4.1 设计原则 **[建议]**

1. **基础字段统一，业务字段独立**：仅统一「身份 + 时间 + 主键 + 版本」等公共约定，**不做一张巨型通用实体表**。
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
- `version`：Record Version 整数（乐观并发，见 §5.6）。
- `created_at` / `updated_at`：统一 `timestamptz`。

**明确不做**：不建「通用条目表（type 字段区分 Task/Note/Idea）」。

### 4.5 数据结构演进：保留已完成成果与能力边界

#### 已完成的基础兼容能力 **[已完成]**

| 成果 | 事实 |
|---|---|
| Ideas 编辑保留顶层未知字段 | `nextIdea`（`index.html:11843`）已加 `...existing`，编辑时保留顶层未知字段 |
| Document Summary 更新保留顶层未知字段 | `nextRecord`（`index.html:11407`）已加 `...existing`，更新时保留顶层未知字段 |
| 字段保留测试 | `tests/module-readonly-behavior.test.js` Task 19 新增 4 项测试（Ideas 编辑/新建、Document 更新/新建） |
| 完整测试 | 曾达到 **304 通过、0 失败** |
| 提交与推送 | commit `d52abbb`「feat: preserve data fields and plan user identity architecture」，已推送（`HEAD` = `origin/main` = `d52abbb`） |

#### 能力边界（重要）**[已确定]**

> **以上修复不等于「全系统已完成字段演进」。**

- 修复**只针对两个模块的顶层对象字段**（Ideas 顶层、Document Summary 顶层）。
- **不代表所有模块、所有嵌套对象都具备完整字段演进能力**。
- **Document Summary 的 `summary` 嵌套对象仍有独立问题**：`nextRecord` 的 `summary: getDocumentSummaryValues()` 是**重建对象**，未 spread `existing.summary`，`summary` 内新增字段仍会丢失。
- **Daily Focus 的固定字段重建仍需评估**：`cloneDailyFocusArchive` / `normalizeDataCenterDailyFocus` 按固定字段重建（格式标准化），未来为归档或单日记录新增字段时需同步更新字段白名单（P2 风险 R3）。
- **Module Settings 严格白名单**：新增字段须同步改校验 + 升版本（P2 风险 R4，刻意设计，非缺陷）。

#### 后续字段演进规划 **[建议]**

| 项 | 方案 |
|---|---|
| 新增字段默认值策略 | 新字段一律**可选 + 缺省回填默认值** |
| 旧数据读取兼容 | 采用「字段存在才校验」策略（如 `isValidTask` 的 `dueDate !== undefined && ...`），旧数据缺新字段按默认值处理不报错 |
| 数据校验 | 宽松校验：**不拒绝未知字段**（保留 forward-compat）；仅对必要结构做严格校验 |
| Schema Version 适用范围 | 见 §4.6，**分层区分**，不把所有裸数组立即改造成 schemaVersion 结构 |
| 数据迁移 | 见 §5.5、§8；数据库结构用 Alembic，业务数据用独立迁移脚本 |
| 字段演进测试 | 每新增字段，补充「旧数据读取 + 编辑后字段保留 + 备份往返」测试，防回归 |

> **[建议]** 不把所有裸数组**立即**改造成带 schemaVersion 的结构；仅在首次真正需要新增字段时，才为该数据引入版本包装并配套迁移，避免提前重构。

### 4.6 三个数据格式层次（区分清楚）**[已确定 + 建议]**

| 层次 | 载体 | 版本锚点 | 说明 |
|---|---|---|---|
| **前端当前数据格式** | `localStorage` JSON | 部分有 `schemaVersion`（daily-focus v1、module-settings v2），4 类裸数组无 | 当前运行态 |
| **迁移数据包格式** | Data Center 备份 JSON | `dataCenterFormat` + `dataCenterVersion` | 迁移/备份的传输格式 |
| **PostgreSQL 数据库结构版本** | 数据库 | Alembic Revision | 服务端结构演进 |

> 三者**独立演进、不可混淆**：前端数据格式版本 ≠ 迁移包版本 ≠ 数据库结构版本。迁移脚本负责在前端格式与数据库结构之间转换。

### 4.7 保护现有模块边界 **[建议]**

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
| `legacy_id` | TEXT NULL | 原 localStorage 记录的 ID，用于**迁移溯源与幂等导入** |
| `version` | INT NOT NULL DEFAULT 1 | **Record Version**，乐观并发（见 §5.6） |
| `created_at` | timestamptz NOT NULL | 默认 `now()` |
| `updated_at` | timestamptz NOT NULL | 更新时刷新 |
| `deleted_at` | timestamptz NULL | 软删除（可选，**[待决策]** 是否启用） |

### 5.2 设备身份与数据来源（区分四个概念）**[建议 / 待决策]**

| 概念 | 含义 | 是否实现 |
|---|---|---|
| **User ID** | 用户身份 | **[建议]** 实现（`user_id` 字段，数据归属锚点） |
| **Device ID** | 设备身份 | **[待决策]** 暂不实现；无实际审计需求时不必引入 |
| **Migration Batch** | 数据迁移批次 | **[建议]** 实现（`migration_batches` 表记录每次迁移批次，见 §8） |
| **Created By Device / Updated By Device** | 可选审计信息 | **[待决策]** 暂不实现；有审计需求再加字段 |

- **[建议]** **不要求每条业务记录强制增加设备来源字段**；当前阶段无审计需求，**暂不实现设备级追踪**。
- **[建议]** 迁移溯源靠 **`legacy_id` + 迁移批次标识（Migration Batch）** 承载，而非在每条记录上挂设备字段。
- **[已确定]** `legacy_id` 的迁移溯源价值保留（用于幂等导入、去重、冲突检测与溯源）。

### 5.3 表结构（分「已确定」与「待定」）

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
legacy_id TEXT NULL · version INT DEFAULT 1
```

**`notes`**
```text
id UUID PK · user_id FK · text TEXT · created_at · updated_at
legacy_id TEXT NULL · version INT DEFAULT 1
```

**`ideas`**
```text
id UUID PK · user_id FK · title TEXT · content TEXT · created_at · updated_at
legacy_id TEXT NULL · version INT DEFAULT 1
```

**`document_summaries`**
```text
id UUID PK · user_id FK · title TEXT · source_text TEXT
summary JSONB（executive/keyPoints/important/actions/deepAnalysis）
analysis_mode TEXT NULL · model TEXT NULL · created_at · updated_at
legacy_id TEXT NULL · version INT DEFAULT 1
```
> `summary` 用 JSONB 保留现有多字段结构；`source_text` 因可能承载敏感资料，**独立表 + 未来独立权限**。

**`daily_focus_entries`**（由归档结构行化）
```text
id UUID PK · user_id FK
focus_date DATE NOT NULL
priorities JSONB（或 TEXT[]，3 条）
created_at · updated_at · version INT DEFAULT 1
UNIQUE (user_id, focus_date)
```

**`user_preferences`**（承接模块设置）
```text
user_id PK/FK · enabled_by_id JSONB · schema_version INT · updated_at
```

**`migration_batches`**（迁移批次，见 §8）
```text
id UUID PK · user_id FK · source_device TEXT · started_at · finished_at
status TEXT · source_count INT · imported_count INT · skipped_count INT · conflict_count INT
report JSONB（统计、异常、日志）
```

**`legacy_id` 适用范围说明**：仅**有原始 ID 的记录**（`tasks` / `notes` / `ideas` / `document_summaries`）保留 `legacy_id`，用 `UNIQUE(user_id, legacy_id)` 幂等。**`daily_focus_entries` 无原始逐条 ID**，以 `UNIQUE(user_id, focus_date)` 为幂等键，不加 `legacy_id`。**`user_preferences` 为单行配置**，无需 `legacy_id`。

#### B. 需结合实际业务再确定的表 **[待决策]**

| 表 | 说明 | 触发条件 |
|---|---|---|
| `projects` | 跨模块组织中心 | Projects 正式管理能力启动时 |
| `knowledge_items` / `knowledge_links` | 知识条目与来源关联 | Knowledge Base 建设（第三阶段） |
| `ai_conversations` / `ai_messages` | AI 对话持久化 | 若决策持久化 AI 对话 |
| `attachments` / `assets` | 附件与数字资产 | 附件存储能力启动时 |

### 5.4 localStorage → 表字段映射 **[建议]**

| 旧键 | 旧字段 | 新表.新字段 | 备注 |
|---|---|---|---|
| tasks | id / text / priority / completed / createdAt / completedAt / dueDate / note | tasks.id(legacy_id) / text / priority / completed / created_at / completed_at / due_date / note | 补 `updated_at` |
| notes | id / text / createdAt | notes.* | 补 `updated_at` |
| ideas | id / title / content / createdAt / updatedAt | ideas.* | 直接映射 |
| document-summaries | id / title / sourceText / summary.* / analysisMode / model / createdAt / updatedAt | document_summaries.* | summary 并 JSONB |
| daily-focus | records[date].priorities | daily_focus_entries(focus_date, priorities) | 归档 → 行 |
| module-settings | enabledById | user_preferences.enabled_by_id | 系统键 → 用户偏好 |

> 命名统一说明：`text`/`content`/`sourceText` 落库时**分别保留各自语义**，**不做强行同名**；仅统一**时间、ID 与版本约定**。

### 5.5 三个版本层次与迁移机制 **[建议]**

| 层次 | 载体 | 工具/机制 |
|---|---|---|
| **Alembic Revision**（数据库结构版本） | 数据库结构 | Alembic 迁移脚本，可回滚 |
| **API Version**（接口版本） | REST 接口 | 版本化前缀（如 `/api/v1/`），新增字段向后兼容 |
| **Record Version**（业务记录版本） | 每条记录 `version` 整数 | 乐观并发（见 §5.6） |

- 结构迁移（加列）用 Alembic；**数据迁移**（localStorage 导入、旧版升级）用独立、可重跑的迁移脚本。
- 迁移纪律：**「先备份 → 迁移 → 校验 → 可回滚」**，与 Data Center 现有流程同构。
- 版本以 Alembic 的 revision 为准，不引入「数据库内 schema 版本号表」作为业务开关。

### 5.6 Record Version 乐观并发控制 **[建议]**

业务记录使用**整数 `version`** 做乐观并发，流程：

```text
1. 客户端提交当前版本（随写请求带上 version）
2. 服务端校验版本
3. 版本一致才允许更新
4. 更新成功后版本递增（version + 1）
5. 版本不一致返回 HTTP 409
6. 前端提示用户刷新并重新编辑
```

- **[建议]** **不机械地所有表都加 `version`**，按实际编辑模式判断：
  - `tasks` / `notes` / `ideas` / `document_summaries`：**单条编辑频率高**，需要 `version`。
  - `daily_focus_entries`：按日 upsert，可由 `UNIQUE(user_id, focus_date)` + 整体替换承载，`version` 可选。
  - `user_preferences`：单行配置，简单 upsert，无需 `version`。
- 冲突时**不自动静默覆盖**（见 §7.4）。

### 5.7 索引与查询需求 **[建议]**

- 所有业务表：`(user_id, created_at DESC)` 复合索引（列表查询主路径）。
- `tasks`：`(user_id, completed)` 或 `(user_id, completed, priority)`（Dashboard 待办排序）。
- `daily_focus_entries`：`UNIQUE(user_id, focus_date)`。
- `auth_identities`：`UNIQUE(provider, provider_sub)`。
- **[建议]** 业务表加 `UNIQUE(user_id, legacy_id)`（`legacy_id` 非空时），用于**幂等导入**。

### 5.8 备份与恢复策略 **[建议]**

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
| Record Version 并发 | 服务层校验 `version`，不一致返回 409 |
| 数据备份与恢复 | 独立 service（`pg_dump` 编排 + 恢复接口，受限权限） |
| 数据迁移导入 | `api/v1/migration.py`（幂等导入 + 冲突检测，受限权限） |
| AI 请求代理/衔接 | 见 §6.7 |

### 6.4 API 分层与模块组织 **[建议]**

- **一层公共路由前缀**：`/api/v1/`。
- **每个业务模块一组端点**，保持与现有模块边界一一对应，**不强行抽象成通用 CRUD**。
- **通用约定**：所有响应带 `created_at`/`updated_at`/`version`；写操作返回完整资源；错误用统一错误体 `{error, code, detail}`。
- **Dashboard 数据**：由前端聚合多个只读 GET 返回，**不提供「Dashboard 落库」端点**。

### 6.5 API 端点草案 **[建议]**

```text
# 认证
POST   /api/v1/auth/login           # 登录，签发 access token（+ refresh token）
POST   /api/v1/auth/refresh         # 刷新 access token
POST   /api/v1/auth/logout          # 注销，使 refresh token 失效
POST   /api/v1/auth/revoke          # 会话撤销（服务端强制失效）
GET    /api/v1/me                   # 当前用户信息（按认证上下文返回 user_id）

# 任务（PATCH 需携带 version，用于乐观并发）
GET    /api/v1/tasks                # 列表（含完成态过滤）
POST   /api/v1/tasks                # 新建
PATCH  /api/v1/tasks/{id}           # 更新（携带 version，冲突返回 409）
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

### 6.6 DataService 异步适配 **[建议]**

**DataService 分层定位**：业务模块通过**统一 DataService** 访问数据，**模块业务逻辑与后端具体实现解耦**；`API Adapter` 负责 HTTP 通信，统一处理**认证状态、网络错误、数据校验、并发冲突**；**各模块保持独立数据契约**。此分层**不得借此重构现有业务模块**，只为后端迁移、部署位置变化预留替换能力。

**现状差异**：当前 `loadX`/`persistX` 是**同步**读写 `localStorage`；未来 API 是**异步** `fetch`。**不能简单把 `localStorage.getItem()` 替换成 `fetch`**，否则会破坏「部分模块依赖同步读取」的既有逻辑。

**需设计的点**：

| 点 | 说明 |
|---|---|
| 应用启动加载状态 | 增加「加载中 / 就绪 / 失败」三态；数据就绪前 UI 显示占位，不渲染空数据 |
| 异步数据加载 | `loadX` 改为 async，返回 Promise；渲染在数据到达后触发 |
| 保存成功后的 UI 更新 | `persistX` 返回成功后，以服务端返回的资源为准刷新界面 |
| 请求失败处理 | 失败不静默丢弃，提示重试；保持本地输入不丢 |
| 连续编辑与旧请求覆盖 | 用请求序号/时间戳丢弃迟到响应（沿用 `AccessVersion` 思路），避免旧响应覆盖新状态 |
| 模块切换时的异步竞态 | 切换模块时中止/忽略上一模块的在途请求（复用 `AbortController` 模式） |
| DataService 适配层 | 统一封装「读/写/错误/并发」，业务层只依赖接口，不感知 localStorage 还是 API |
| 并存期数据来源优先级 | localStorage 与 API 并存期间，明确**服务端为权威**，localStorage 仅作迁移来源/只读缓存 |

- **[建议]** **渐进式适配**：先选一个模块（建议 Quick Notes，见 §11）纵向打通，验证适配层后再推广到其余模块；**不要求一次性重写全部模块**。

### 6.7 AI 请求衔接 **[建议 / 待决策]**

| 方案 | 说明 | 取舍 |
|---|---|---|
| **A. 前端直连现有 Worker（推荐初期）** | 前端 `requestAI` 继续指向 Worker | 零后端改动；Secret 仍在 Worker；后端不承担 AI |
| B. 经 FastAPI 代理 | 前端 → FastAPI → DeepSeek（或其他模型） | 统一 Secret 管理、多模型路由、审计，但需新建代理、迁移 5 个工作流调用端点 |

- **[建议]** 初期沿用方案 A，**不重建 AI 链路**；待需要多模型路由 / 统一密钥管理 / 服务端 RAG 时再评估方案 B。
- **[待决策]** 方案 B 的触发时机与模型适配器设计。
- AI 数据流安全边界见 §10.2。

---

## 7. 多设备同步机制

### 7.1 目标与现状差距 **[已确定]**

- **现状**：数据全在 localStorage（按 origin 隔离）。**当前仅 iPhone 实际投入使用**；Mac、iPad 尚未正式投入使用、无历史业务数据。Cloudflare Worker 不落业务数据。
- **目标**：三设备登录同一身份后访问**同一份服务端数据**（PostgreSQL）。

### 7.2 同步模型：服务端为唯一事实源 **[建议]**

- **PostgreSQL 是统一数据源**；前端不再以 localStorage 为长期数据源。
- **前端本地缓存不是长期权威数据源**：仅在 P2 离线阶段作只读缓存，恢复后以服务端为准。
- 前端保留**内存态**，启动时从服务端拉取，写操作即时提交服务端。
- **用户身份 ≠ 设备身份**：数据归属 User ID，设备只是访问入口。

### 7.3 设备接入节奏（不做「三设备历史数据汇集」）**[建议]**

| 步骤 | 内容 | 时机 |
|---|---|---|
| **首次迁移（iPhone）** | iPhone 为唯一数据源，完成服务端导入与验证 | 后端上线时 |
| **iPhone 切换** | iPhone 切换为读写服务端数据 | 迁移验证通过后 |
| **Mac 接入** | Mac 首次登录后**直接从 PostgreSQL 读取统一数据**，不导入本地（空白/测试）数据 | 服务端数据迁移成功后，独立阶段 |
| **iPad 接入** | 同 Mac | 服务端数据迁移成功后，独立阶段 |

> Mac / iPad 各自 localStorage 里的空白或测试数据**不作为权威数据源**；只有未来发现它们产生了有价值的独立业务数据，才走 §8.8 的单独导入与去重流程。

### 7.4 并发与冲突避免 **[建议]**

- 用 **Record Version**（整数 `version`，§5.6）检测并发修改。
- **冲突时不自动静默覆盖**：版本不一致返回 409，前端提示用户刷新后重新编辑。
- 用户是「个人单用户多设备」，多数冲突是「同一条目先后编辑」，**last-write-wins + 版本校验**足够；**暂不建 CRDT / 同步队列**。
- `daily_focus` 已在前端用 `expectedRawValue` 乐观锁，服务端沿用「按日 upsert + 版本校验」。

### 7.5 离线、异常与首次迁移保护 **[建议]**

- **网络异常/请求失败**：前端统一错误分类（沿用 `requestAI` 思路），写失败时**不静默丢弃**，提示重试。
- **首次迁移**：见 §8，核心是「iPhone 导出 → 服务端导入 → 校验 → 保留原始 JSON 备份 → 确认后才切换主数据源」，**迁移不丢数据**。
- **多设备同时修改**：见 §7.4，Record Version 兜底。
- **[待决策]** 是否需要在服务端维护「同步队列」（P3 才需要）。

### 7.6 同步分阶段（第一阶段不做复杂离线同步）**[建议]**

| 阶段 | 能力 | 说明 |
|---|---|---|
| **P1** | 在线直读直写 | 前端读写走 REST API；localStorage 仅作迁移来源，之后不再作为主数据源。**无离线同步** |
| P2 | 本地缓存 + 离线只读 | 服务端数据缓存在本地，网络断开时降级为只读；恢复后重拉 |
| P3 | 离线写入 + 同步队列 + 冲突解决 | 需要时才做（复杂，暂缓） |

> **[建议]** 第一阶段只做 P1，离线同步留到有真实需求再评估。**初期不做复杂离线写入和 CRDT**。

---

## 8. localStorage 迁移方案（iPhone 唯一数据源）

> **原则**：增量迁移、可回滚、验证完整性；iPhone 为唯一实际业务数据源；不假设 Mac/iPad 有需汇集的数据。

### 8.1 数据源与导出 **[已确定 + 建议]**

- **[已确定]** 现有 Data Center 已能导出全量 JSON（`createDataCenterBackup`，覆盖 5 业务键 + 模块设置）。
- **[建议]** 首次迁移**以 iPhone Data Center 导出的完整备份为唯一主要来源**。
- **[建议]** 迁移前先在 iPhone 上核实实际数据（各模块记录数、关键内容）并确认备份文件完整性（可成功打开、JSON 结构正确、模块数完整）。
- **[待现场确认]** iPhone 实际数据量与内容，须由用户实地核对。

### 8.2 旧数据 → 新表映射 **[建议]**

按 §5.4 字段映射逐条转换：

1. 读取 iPhone 导出 JSON → 解析各模块数组/归档。
2. 每条记录分配新 `id`（UUID），原 `Date.now()-random` 存 `legacy_id`。
3. 补 `user_id`（首个所有者）、`version = 1`、`updated_at`（缺失时回填 `created_at`）。
4. Daily Focus 归档 `records[date]` → 按日拆行。
5. 模块设置 `enabledById` → `user_preferences`。
6. 本次迁移记录到 `migration_batches`（批次标识、来源设备、时间、统计）。

### 8.3 迁移规则（幂等 + 冲突）**[建议]**

**迁移脚本必须幂等**：同一脚本对同一数据重复执行，结果一致、不产生重复记录。

以 `legacy_id`（`daily_focus_entries` 以 `focus_date`）为幂等键，规则如下：

| 情况 | 处理 |
|---|---|
| **相同 ID、相同内容** | **跳过**（不重复写入） |
| **相同 ID、不同内容** | **报告冲突，不自动覆盖**（纳入冲突清单，用户决策） |
| **新 ID** | **新增** |
| **每次迁移** | 具有**独立批次标识**（`migration_batches` 记录） |
| **迁移日志** | 保留**迁移日志、异常和统计结果**（`report` JSONB） |

### 8.4 迁移完整性验证（数量 + 内容 + 回滚）**[建议]**

- **数量核对**：每个模块「源记录数 = 落库记录数」。
- **内容核对**：随机抽 N 条逐字段比对源 JSON 与落库值；Daily Focus 按日期逐日核对 priorities 三条内容。
- **关键字段校验**：`created_at` 保留原时间（不重写为迁移时刻）。
- **异常记录核对**：核对迁移中产生的异常记录、冲突记录、跳过记录，逐条确认。
- **回滚验证**：迁移后实测一次「服务端数据 → 导出回本地」的逆向通道，确认数据可完整还原。
- 产出迁移报告：源计数、目标计数、跳过数、冲突数、异常清单。

### 8.5 回滚能力（切换后仍可回退）**[建议]**

- 迁移前**强制下载并保留 iPhone 原始 JSON 备份**（原始 Data Center 备份，非二次加工）。
- 迁移写入服务端**用事务**：全部成功才提交，失败回滚，不留半迁移数据。
- **设置明确的数据源切换开关**：切换前后端可配置「服务端 / localStorage」数据源，便于回退。
- **切换主数据源后，旧数据备份仍保留**。
- **若新系统已产生新数据，回滚前必须先导出 PostgreSQL 最新数据**；**不允许直接恢复旧 localStorage 而丢失切换后的新记录**。

### 8.6 迁移流程（顺序）**[建议]**

```text
0. 正式迁移前：设置数据写入冻结 / 维护窗口（暂停前端写操作，避免迁移期间产生新数据不一致）
1. iPhone 实地核实数据 + 手动导出本地备份（下载 JSON）
2. 校验备份完整性（JSON 可解析、模块数完整、记录数正确）
3. 前端读取备份 → 补版本包装 → 上传服务端（迁移专用端点）
4. 服务端校验 + 预览（返回将写入的记录数/警告）
5. 用户确认 → 事务写入（幂等导入，见 §8.3）→ 返回迁移报告
6. 完整性验证（数量 + 内容 + 时间字段 + 异常记录）+ 回滚验证
7. 验证通过后，用户确认切换为服务端主数据源
8. 解除写入冻结；iPhone 本地数据保留，待用户手动确认后再清理
```

**中断与重试**：迁移脚本幂等（§8.3），**迁移中断后支持安全重试**——重新执行同一脚本，已导入记录被跳过、未导入记录继续导入，不产生重复。

### 8.7 幂等导入与冲突检测 **[建议]**

- **幂等导入**：以 `(user_id, legacy_id)` 为幂等键；重复导入同一备份**不产生重复记录**。
- **冲突检测**：导入时若发现 `legacy_id` 已存在但内容不一致，标记为「冲突」并纳入迁移报告，**不静默覆盖**。
- 迁移端点设计为**可重跑**：同一份备份可安全重复提交，结果一致。

### 8.8 未来设备独立数据导入（预留，非当前流程）**[建议]**

- 若未来 Mac / iPad 产生了有价值的独立业务数据，再**单独提供**导入机制：
  - 单独选择该设备的导出备份 → 上传 → `migration_batches.source_device` 标识来源。
  - **去重**：以 `legacy_id` + 迁移批次检测与既有数据的重叠。
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
- **Cloudflare Tunnel 只是网络访问通道，不等于身份认证**（见 §3.5）；仍须配合认证令牌。
- CORS 白名单收紧为 GitHub Pages 域名；但**CORS 不是身份验证**。
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
- **CORS ≠ 身份认证**（见 §3.5）。

#### 数据库安全隔离 **[建议]**

- **所有数据查询必须根据认证上下文确定 `user_id`**：查询条件由后端从令牌上下文注入，**禁止信任客户端传入的 `user_id`**。
- **增加跨用户数据访问隔离测试**：自动化测试验证用户 A 无法读取/修改用户 B 的数据。
- **评估 PostgreSQL RLS（Row-Level Security）作为纵深防御**：即使应用层出现遗漏，RLS 仍能在数据库层兜底拦截跨用户访问（[待决策] 是否启用，需评估性能与复杂度）。
- **数据库应用账号采用最小权限**：业务 API 使用**受限应用账号**，仅授予所需表的 DML 权限。
- **数据库超级用户（superuser）不得用于业务 API**：超级用户仅用于运维、迁移与维护。
- 未来 Professional Applications 的敏感数据**另行制定**安全与审计设计（不混入普通个人数据，见 §3.6、§12.5）。

### 10.2 AI 数据流安全 **[建议]**

> **数据库存储安全 ≠ AI 请求安全。** 二者是不同环节，须分别评估。

- **[已确定]** 保留现有 Cloudflare Worker + `requestAI` 架构，**当前不重建 AI 链路**。
- **Worker 接收到的业务数据可能包含敏感内容**：前端把任务、笔记、资料原文等作为 `messages` 发送给 Worker → DeepSeek。
- **[建议]** 应**评估发送给第三方模型服务的数据范围**：明确哪些内容允许进入 AI 工作流、哪些需要脱敏或禁止发送。
- **未来专业应用（尤其医疗）需独立的数据访问与 AI 数据传输策略**：独立授权 + 独立传输边界 + 独立审计。
- **[已确定]** **不得默认医疗业务数据可以直接进入普通 AI 工作流**（与 `ARCHITECTURE.md` §12.5、§14 一致）。
- **[待决策]** 敏感数据的脱敏规则、AI 请求审计日志、第三方模型的数据保留条款核查。

### 10.3 备份 **[建议]**

- 定期 `pg_dump` 全量备份；备份独立于服务器磁盘（NAS/对象存储）+ 异地副本。
- 备份文件加密存储；保留多代（如近 N 天日备 + 周备）。
- 前端仍保留 Data Center 的本地导出能力，作为「服务端之外的第二份用户自持备份」。

### 10.4 恢复与演练 **[建议]**

- 恢复流程：`pg_restore`，配套文档化清单。
- **定期执行恢复演练**（实际恢复一次，非只备份不验证）。
- 灾难恢复验收（`ARCHITECTURE.md` §11.6）：在全新服务器从零重建运行环境 + 数据恢复 + 前端连通验证，作为后端可迁移性的验收标准。

---

## 11. 分阶段实施路线

> 以下为**依赖关系排序**，不含具体日期；每阶段独立可验收、可回滚。**Mac / iPad 接入是独立阶段，放在 iPhone 数据迁移成功之后。**

| 阶段 | 内容 | 交付/验证点 |
|---|---|---|
| **0. 数据契约准备** | 统一时间/ID/version 约定；梳理各模块字段契约；**不改变现有数据存储方式**（仍走 localStorage，不立即改裸数组为 schemaVersion） | 数据契约清单确认；现有测试全绿 |
| **1. FastAPI + PostgreSQL 基础建设** | 迷你主机环境 + FastAPI 模块化单体 + 建表（Alembic）+ **单用户身份（users 表 + UUID User ID）+ 认证（Owner 初始化/登录/令牌）+ 基础授权 + 数据库 + 健康检查** | 后端可启动、可建库、可 CRUD；认证闭环可用；未授权访问被拒 |
| **2. DataService 与前端 API 接入** | 前端 DataService 适配（API Adapter）+ 各模块 API 读写闭环（§6.6）；先单模块试点（建议 Quick Notes）再推广 | 各模块异步读写稳定；守卫/停用机制不变 |
| **3. localStorage 数据迁移** | iPhone 导出 → 幂等导入 → 数量/内容/时间/异常核对 → 回滚验证 → 切换主数据源（§8） | 迁移报告通过；原始 JSON 备份保留可回滚 |
| **4. Mac、iPhone、iPad 多设备统一数据访问** | 三设备登录同一身份，统一读写 PostgreSQL；Record Version 并发 | 跨设备数据一致；冲突返回 409 可处理 |
| **5. 自动备份、恢复和灾难恢复演练** | pg_dump 自动备份 + 恢复演练 + 安全审查 | 恢复演练通过；安全项关闭 |
| **6. 按真实需求扩展** | 知识库、Projects、离线能力、多用户及专业应用（按实际需求逐步启动） | 由真实需求触发，不提前做 |

**试点模块说明**：Quick Notes 只是**建议的首个试点模块**（结构最简单、无跨模块关联），最终仍需结合实际代码复杂度确认。

**本阶段不提前开发**：完整用户管理界面、多用户注册、复杂离线同步、医疗专业模块。

**保护已验收模块**：阶段 0–2 都保持前端业务逻辑、模块启停、读写守卫、AI 取消机制**不降级**；唯一替换点是数据读写层。

---

## 12. 尚待决策的问题

1. **认证方案**：自托管 + GitHub Pages 拓扑下，选用何种成熟认证（Cloudflare Access / 邮箱 OTP / OIDC / Bearer 令牌）？（§3.4）
2. **会话形态**：Cookie 会话（需 CSRF/SameSite/跨域配置）还是 Authorization Bearer 令牌？（§3.5）
3. **AI 代理**：AI 是否经 FastAPI 代理（方案 B），触发时机？（§6.7）
4. **AI 数据流安全**：敏感数据脱敏规则、AI 请求审计、第三方模型数据保留条款核查？（§10.2）
5. **AI 对话持久化**：是否持久化 AI Assistant 对话？隐私/保留/导出规则？（§4.2）
6. **软删除**：业务表是否启用 `deleted_at` 软删除？（§5.1）
7. **设备级追踪**：是否引入 Device ID / Created By Device / Updated By Device 审计？（当前无需求，§5.2）
8. **Document `source_text` 保留策略**：保留时长、是否可删、是否脱敏？（§4.2）
9. **多用户/共享协作**：未来是否引入分享、协作，还是长期保持「个人单用户」？（影响授权模型）
10. **同步复杂度**：是否/何时进入 P2（离线缓存）、P3（离线写入 + 同步队列）？（§7.6）
11. **备份频率与异地目标**：具体备份周期、加密与异地存储位置，待部署阶段定。（§10.3）
12. **模块设置云端化**：`enabledById` 落库为 `user_preferences` 后，损坏隔离/恢复如何在服务端承接？（§5.3）
13. **Daily Focus 字段演进**：`clone/normalize` 固定字段重建，未来为归档新增字段时如何演进（需同步更新白名单）？（§4.5）
14. **iPhone 实际数据核实**：迁移前须由用户现场确认 iPhone 数据量与内容完整性（AI 无法直接读取 iPhone localStorage）。（§1.2、§8.1）
15. **PostgreSQL RLS**：是否启用行级安全作为纵深防御（需评估性能与复杂度）？（§10.1）
16. **首个 Owner 初始化方式**：Owner 的一次性初始化流程（本机/内网引导）具体实现方式？（§3.4）

---

## 附：核心结论速览

- **现状**：单文件静态前端 + 8 个 localStorage 键（5 业务 + 3 系统）+ Worker 代理 AI；无后端、无用户体系；**仅 iPhone 实际投入使用**，数据是「整模块 JSON」，非行级。
- **目标**：保留原生前端与现有 Worker；新增 FastAPI 模块化单体 + PostgreSQL；前端仅替换数据读写层为 DataService（异步适配）；服务端为唯一事实源。
- **身份**：区分 User Identity / Authentication / Authorization / User Management 四概念；第一阶段建立 `users` 表 + 稳定 UUID User ID，单用户 Owner 模式、不开放注册、不开发用户管理界面、认证先于业务数据接入、客户端不得指定 `user_id`；**Cloudflare Tunnel / Authentication / Authorization 三要素区分，CORS ≠ 身份认证**。
- **数据结构演进**：**已完成** Ideas/Document 顶层字段保留修复（`...existing`）+ 4 项测试 + 304 通过 + commit `d52abbb` 已推送；**但能力有边界**（summary 嵌套对象、Daily Focus 固定重建仍需评估），不代表全系统完成字段演进。
- **数据模型**：各模块独立表，仅统一「ID + 时间 + 归属 + version」公共约定，不建巨型通用实体表；Dashboard 只读聚合不落库；区分「前端数据格式 / 迁移数据包格式 / PG 结构版本」三个层次；`legacy_id` 仅用于有原始 ID 的记录，`daily_focus_entries` 以 `focus_date` 为幂等键。
- **并发控制**：Alembic Revision / API Version / Record Version 三层区分；业务记录用整数 `version` 乐观并发，不机械所有表都加；冲突返回 409，不静默覆盖。
- **迁移**：**iPhone 为唯一实际业务数据源**，迁移脚本**必须幂等**（`user_id` + `legacy_id` / `focus_date` 幂等键）；迁移前设写入冻结/维护窗口、中断可安全重试、核对数量/内容/时间/异常记录；回滚保留原始 JSON、切换开关、切换后新数据先导出，不允许丢新记录，不删除原始 localStorage。
- **设备接入**：Mac / iPad 后端上线后独立接入，首次登录直接读 PostgreSQL；未来若有独立数据再走单独导入 + 去重 + 冲突处理（保留 legacy_id 溯源，不强制每条记录加设备字段）。
- **同步**：分阶段（P1 在线直读写 → P2 离线只读 → P3 复杂离线），第一阶段不做复杂离线同步。
- **风险承接**：数据结构演进已有部分基础能力，但须持续补齐「新增字段默认值、旧数据兼容、校验、Schema Version 适用范围、迁移、字段演进测试」机制。
- **系统管理**：统一 System Administration 为能力清单规划（用户/身份、Data Center、Module Management、系统配置、健康检查、备份恢复、日志审计、API 状态），现有 Data Center 与 Module Management Center 继续独立运行，不新增导航入口。
- **数据库安全**：查询按认证上下文确定 `user_id`、禁止信任客户端 `user_id`、增加跨用户隔离测试、评估 RLS 纵深防御、应用账号最小权限、超级用户不用于业务 API。

---

*本设计 V4 基于 `index.html` 实际代码与现有架构文档生成，未修改任何代码、数据、配置或 Git 状态。*
