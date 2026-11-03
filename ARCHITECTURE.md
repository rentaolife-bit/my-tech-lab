# My Tech Lab 2.0 总体架构设计

> 本文描述当前代码可确认的架构现状，以及 My Tech Lab 2.0 的渐进式目标。所有能力均以 `[已实现]`、`[正在推进]` 或 `[未来规划]` 标记；规划内容不代表功能已经上线。实施状态应结合代码、测试和部署情况持续更新。
>
> 本文的定位是描述**系统是什么**（当前架构、核心机制、数据契约）与**未来目标结构**；**怎么干活**见 `DEVELOPMENT_RULES.md`，**往哪走 / 进度**见 `ROADMAP.md`。三者单向交叉引用，不互相重复维护同一份细则。

## 1. 项目定位与设计目标

My Tech Lab 以个人使用为起点，长期演进为由用户自主掌握数据的个人数字工作平台。架构应支持功能逐步独立、公共服务复用、AI 模型与基础设施可替换，同时避免过早建设复杂系统。

- 当前保持轻量、低成本，优先使用项目实际需要的能力。
- 保持现有业务功能和用户数据稳定，按阶段推进模块化。
- 业务数据属于用户，应可导出、恢复并为未来迁移留出空间。
- AI 模型、托管平台和后端基础设施通过清晰边界保持可替换。
- 为后续扩展预留接口，但不为了抽象而引入不必要的框架、数据库或付费服务。

## 2. 架构状态约定

- **[已实现]**：当前仓库代码中存在，并可由代码或配置直接确认。
- **[正在推进]**：路线图或当前开发阶段明确在推进；若代码已部分落地，应说明尚待验收或完善之处。
- **[未来规划]**：目标架构或尚未实现的能力，不得描述为当前能力。

部署端点可从前端代码确认，但线上 Worker 配置、Secret、访问控制、限流、运行状态和实际部署版本不能仅凭本仓库确认。

## 3. 当前系统概览

### 3.1 项目结构

**[已实现]** 当前仓库是静态单页项目，主要文件如下：

| 路径 | 当前职责 |
|---|---|
| `index.html` | 主入口；集中承载 HTML、CSS、JavaScript、模块界面、导航、业务逻辑和本地数据访问 |
| `apple-tech-icon.png` | 页面 Apple touch icon 资源 |
| `README.md` | 简短项目介绍 |
| `ARCHITECTURE.md` | 本文；描述当前架构、核心机制与数据契约 |
| `DEVELOPMENT_RULES.md` | 开发规范（人机协同、工程纪律、数据安全、测试、Git 工作流） |
| `ROADMAP.md` | 项目进度与未来实施顺序的唯一来源 |
| `.github/copilot-instructions.md` | GitHub Copilot 项目指令（数据安全摘要，引用 `DEVELOPMENT_RULES.md`） |
| `tests/` | 自动化测试套件与一键运行入口（`node tests/run-all.js`） |

**[已实现]** 仓库中没有独立的前端构建系统、模块源码目录、Cloudflare Worker 源码或 Worker 部署配置。页面使用原生 HTML/CSS/JavaScript。

### 3.2 当前业务功能

**[已实现]** 下列功能的实现目前集中于 `index.html`：

- AI Assistant（含 Daily Planning、Task Organization、Document Summary、Ideas & Writing 四个子工作流）
- Daily Focus（今日重点和历史查看）
- Task Manager
- Quick Notes
- Data Center
- Module Management Center

**[已实现]** 顶部导航使用页面内锚点；AI 工作流通过 AI Assistant 中的快捷入口打开、滚动或触发。部分工作区使用 `hidden` 控制显示。

**[已实现]** My Tech Lab v1.2.0 已发布，发布基准为 `493c29315be527450080be211a71ab83a8d2a03b`，`v1.2.0` 标签指向该提交。该版本包含 Daily Focus History View；本架构文档以该发布基准及后续提交中的代码作为当前功能依据。

## 4. 五层逻辑架构

以下五层是**职责划分**，不要求现阶段拆成五个程序、服务或部署单元。当前单页应用可继续承载多层实现，待需求和稳定性需要时再逐步拆分。

| 层 | 职责 | 当前状态 |
|---|---|---|
| 1. 用户交互层 | Dashboard、统一导航、工作区入口、响应式界面、交互状态与反馈 | **[已实现]** 当前为单页中的顶部导航、AI 快捷入口、工作区和统计摘要；**[未来规划]** 独立 Dashboard 与分层工作区 |
| 2. 功能模块层 | 承载 AI Assistant、任务、重点、笔记、资料总结及其他业务流程 | **[已实现]** 功能区存在于 `index.html`，但尚未拆成独立模块文件 |
| 3. 公共服务层 | 统一 AI 请求、本地存储、数据校验与迁移、模块注册与导航、导入导出、通知等共用能力 | **[已实现]** Data Center 已提供集中式数据模块定义及备份恢复流程，Module Registry 已作为模块元数据单一事实来源；其余业务逻辑仍直接位于页面脚本中。**[未来规划]** 形成明确的共享服务接口 |
| 4. 数据层 | 业务数据、AI 数据、系统配置、格式版本、迁移和数据保留策略 | **[已实现]** 五类持久化业务数据保存在浏览器 `localStorage`；模块设置与隔离记录各占一个独立系统键；对话及部分临时结果仅在页面内存中。**[未来规划]** 独立系统配置和可迁移存储 |
| 5. 基础设施层 | 前端托管、后端代理、模型 API、未来可替换的部署环境 | **[已实现（前端调用关系）]** 页面调用 Cloudflare Worker，再由其连接 DeepSeek 的架构已体现在前端端点与请求代码中。Worker 实现和线上配置不在仓库，无法在此确认。**[未来规划]** 可替换托管、后端和模型服务 |

层与层之间应通过清晰的调用方向协作：交互层调用功能模块，模块依赖公共服务，公共服务处理数据和外部接口，基础设施提供运行环境。业务模块不应直接掌握 Secret，也不应因页面结构变化而隐式删除持久化数据。

## 5. 模块架构与注册

### 5.1 Module Registry

**[已实现]** `index.html` 中存在静态、只读（冻结）的 Module Registry，作为当前功能模块元数据及入口关系的单一事实来源；当前登记 **10 个模块**。注册项包含：

- 稳定且唯一的模块 `id`；发布后不因显示名称或分类变化而改变。
- 名称、说明、分类（`category`）和模块类型（`type`）。
- 入口标识（`entry`：`targetSelector` / `navigationSelector` / `shortcutSelector`）及父子模块关系（`parentId`）。
- 实现状态（`status`）和数据归属（`dataOwnership`）；实现状态不代表远程服务健康状态。

**[已实现]** Registry 校验模块 ID 格式、分类/类型/状态/数据归属枚举、父子关系和声明的 DOM 入口（`validateModuleRegistry`，页面加载时执行）。Module Management Center 通过查询接口消费 Registry，提供概览、分类/状态筛选、模块详情查看，以及模块启用/停用开关（见 §6）。

### 5.2 功能模块分类与知识库内容分类

**Module Category ≠ Knowledge Category。** 功能模块分类（Module Category）与知识库内容分类（Knowledge Taxonomy）是两套独立体系，不共用分类枚举、分类配置或存储结构。

**[已实现]** Module Registry 当前使用以下三个一级功能模块分类，仅用于组织 My Tech Lab 的功能模块：

| Category ID | 显示名称 | 用途 |
|---|---|---|
| `work-knowledge` | Work & Knowledge（工作与知识） | 工作、效率及知识相关功能模块 |
| `ai-intelligence` | AI & Intelligence（AI 与智能） | AI 助手及其工作流模块 |
| `system` | System（系统管理） | 模块管理和数据管理等系统功能 |

**[已实现]** 当前各模块的实际分类归属（以 Registry 代码为准）：

- `work-knowledge`：Task Manager、Daily Focus、Quick Notes
- `ai-intelligence`：AI Assistant、Daily Planning、Task Organization、Document Summary、Ideas & Writing
- `system`：Module Management Center、Data Center

**[未来规划]** Knowledge Base 应拥有独立的数据模型和内容分类体系，至少为以下能力留出设计空间；这不代表现在已经创建了这些分类、数据库或知识库功能：

1. 知识领域，例如医学、AI 技术、管理、个人成长和生活。
2. 资料类型，例如文章、书籍、笔记、文献、网页和文件。
3. 支持多标签的标签系统。
4. 来源信息及资料之间的关联关系。
5. 全文搜索、筛选及未来 AI 检索能力。

两套体系的边界如下：

- Module Category 组织功能模块，不管理知识内容；Knowledge Taxonomy 管理知识内容，不决定功能模块归属。
- Knowledge Base 可以属于 `work-knowledge` 模块分类，但其领域、资料类型、标签和关系由自己的内容模型管理。
- 未来知识库可以通过模块接口与 AI Assistant、Quick Notes、Document Summary 等功能协作；这种集成不要求共享分类枚举。
- 知识库即使独立部署或迁移到其他平台，也不应依赖 My Tech Lab 的 Module Category。
- 两套体系不得共用 localStorage 分类键、分类配置或分类枚举；任何持久化设计均应各自版本化并明确归属。

### 5.3 模块类型

**[已实现]** Registry 已通过 `type` 字段区分三种模块类型，并纳入注册校验（`standalone` / `embedded-workflow` / `system-management`）：

1. **独立模块（standalone）**：有清晰的功能入口和主要操作界面，例如 Quick Notes、Task Manager、Daily Focus、AI Assistant。
2. **嵌入式工作流（embedded-workflow）**：依附于父模块或工作区的子功能，例如 AI Assistant 中的 Daily Planning、Task Organization、Document Summary 和 Ideas & Writing。停用子工作流不应意外关闭父模块或影响共享界面。
3. **系统管理模块（system-management）**：管理数据、模块或系统偏好的功能，例如 Data Center 和 Module Management Center。

类型只表达信息架构和生命周期关系，不要求立即拆分 HTML 或 JavaScript。

### 5.4 停用与数据边界

- 模块停用应控制入口和功能可用性，不是删除代码、卸载数据或重置配置。
- 模块隐藏、排序或搬迁不能删除、覆盖或迁移用户业务数据。
- 移除模块及其数据属于不同操作；任何数据删除必须遵循“先备份，再确认，后删除”及人工确认原则（细则见 `DEVELOPMENT_RULES.md`）。
- Data Center 的**备份数据注册表**与功能模块的 **Module Registry** 必须分离。两者目的、标识和生命周期不同；备份定义不能替代模块定义，模块注册也不能未经设计自动扩大备份或清理范围。

## 6. 模块运行时行为（启用与停用 · 第二阶段已实现）

本节描述模块启用/停用的运行时语义。状态判断以 `getModuleRuntimeState(moduleId)` 为单一事实来源，所有写入路径与 UI 都复用同一份状态，避免「UI 层禁用」与「数据层守卫」不一致。

### 6.1 状态模型

`getModuleRuntimeState(moduleId)` 返回：

- `exists`：模块是否存在于 Registry。
- `protected`：是否为受保护模块（Data Center、Module Management Center）。
- `selfEnabled` / `parentEnabled` / `effectiveEnabled`：自身启用、父链启用、最终有效启用。
- `readonly`：是否只读（`!effectiveEnabled`，设置异常时 fail-closed 为只读）。
- `state`：枚举 `enabled` / `disabled` / `parent-disabled` / `unknown-module` / 设置异常态（`corrupt`、`invalid`、`unsupported-version`、`storage-unavailable` 等）。
- `message`：面向用户的说明文案。

派生访问入口：`isModuleReadOnly`、`canModulePerformAction`、`getModuleAccessStatus`、`requireModuleAccess`、`isModuleEffectivelyEnabled`。其中 `requireModuleAccess(moduleId, statusElement)` 是所有数据写入守卫的公共入口。

### 6.2 启用与停用的含义

- **启用（默认）**：模块正常可操作，数据可新增、编辑、删除（在各自业务语义内），可发起 AI 请求。
- **停用**：模块进入只读状态，具体规则见 §6.3。

### 6.3 停用后的行为

停用模块后（无论停用的是模块自身还是其父模块）：

1. **保留历史数据**：不删除、不重置任何已保存数据。
2. **允许只读查看**：界面仍可查看已保存内容。
3. **禁止新增 / 编辑 / 删除**：写入函数在入口处校验 `requireModuleAccess`，未通过即拒绝并返回，不触碰 `localStorage`。
4. **禁止模块自身导入**：停用模块的数据不得通过模块自身的导入入口写入。
5. **禁止发起 AI 请求**：各 AI 工作流入口校验访问状态，停用后拒绝发起新请求。
6. **在途 AI 请求执行前端取消**：停用触发对应 `AbortController.abort()`，前端中止在途请求。
7. **迟到响应不得覆盖页面状态**：通过 AccessVersion 计数丢弃迟到响应，避免停用后的旧响应回写界面。
8. **AI Assistant 停用时四个子工作流级联停用**：Daily Planning、Task Organization、Document Summary、Ideas & Writing 的 `parentId` 均为 `ai-assistant`，父模块停用使子模块进入 `parent-disabled` 只读态；同样地，重新启用父模块即恢复子模块。
9. **重新启用后恢复正常操作**：再次启用模块即解除只读，历史数据不变。

### 6.4 受保护模块

**[已实现]** Data Center（`data-center`）与 Module Management Center（`module-management-center`）为**受保护模块**，恒为启用且非只读：Registry 校验拒绝为它们写入停用状态，运行时状态判定也直接返回 `enabled`。它们在 Module Management Center 中显示「系统保护」徽章，不提供启停开关。

### 6.5 写入守卫的覆盖范围

**[已实现]** 五类业务数据写入均在函数首行守卫：

| 数据 | 写入函数 | 守卫模块 |
|---|---|---|
| Quick Notes | `persistNotes` | `quick-notes` |
| Task Manager | `persistTasks` | `task-manager` |
| Daily Focus | `persistDailyFocus` / `writeDailyFocusArchive` | `daily-focus` |
| Ideas & Writing | `persistIdeas` | `ideas-writing` |
| Document Summary 历史 | `persistDocumentHistory` | `document-summary` |

隐式写入路径（Daily Focus 输入自动保存、清空按钮、`startDailyFocus`、`toggleTask`/`deleteTask`、`importOrganizedTasks`）同样经过上述守卫。AI 的五个工作流（AI Assistant、Daily Planning、Task Organization、Document Summary、Ideas & Writing）各持有独立 `AbortController` 与 AccessVersion，入口校验访问状态、停用时中止在途请求并丢弃迟到响应。

**已知边界（设计使然）**：Data Center 的全局导入恢复（`applyDataCenterData`）直接写 `localStorage`，**不经过**上述守卫，因此即使模块被停用，用户仍可通过 Data Center 执行全局恢复；恢复完成后被停用模块依旧保持只读。这是「数据恢复优先于模块停用」的刻意设计，而非缺陷。

## 7. 模块设置数据契约（schema v2 · 第二阶段已实现）

### 7.1 存储键与结构

| 键 | 用途 |
|---|---|
| `my-tech-lab-module-settings` | 模块启停设置（有效数据） |
| `my-tech-lab-module-settings-recovery` | 损坏设置的隔离记录（恢复隔离区） |

模块设置结构为 `{ schemaVersion, enabledById }`：

- `schemaVersion`：当前为 `2`，兼容读取 `1`（`legacyModuleSettingsSchemaVersion = 1`）。
- `enabledById`：`{ [moduleId]: false }`，**仅保存显式停用的模块**；启用状态通过「键不存在」隐式表达。受保护模块不允许出现在该映射中。

### 7.2 校验与迁移

- `validateModuleSettings`：校验结构、版本、字段白名单、模块 ID 是否存在、布尔类型，并拒绝受保护模块被停用。
- `parseModuleSettings` / `readModuleSettings`：读取并解析，返回状态 `available` / `legacy` / `corrupt` / `invalid` / `unsupported-version` / `storage-unavailable`。
- `migrateModuleSettings`：v1 → v2 仅重写 `schemaVersion`（两版结构一致），写入前校验、写后回读、失败回滚，原始数据不受影响。
- `writeModuleSettings`：采用乐观锁（`expectedRawValue`）防止跨标签页并发覆盖；写后回读校验，失败回滚。

### 7.3 损坏检测与恢复

- `recoverModuleSettings`：当设置损坏（`corrupt` / `invalid` / `unsupported-version`）时，先把原始字符串完整隔离到 `my-tech-lab-module-settings-recovery`（记录 `{ quarantinedAt, sourceKey, rawValue }`），再写入默认启用状态；隔离失败则中止，原数据不动。
- 设置异常时所有受影响模块 fail-closed 为只读，Module Management Center 显示「恢复」面板，允许用户手动恢复到默认启用状态。

### 7.4 Data Center 备份中的可选字段

- Data Center 备份在顶层新增**可选字段** `moduleSettingsRecovery`：无隔离记录时为 `null`；有有效记录时保存记录对象；记录损坏但存在时原样保留为 `{ storageValue }`。
- `dataCenterVersion` 仍为 `1`、`dataCenterModules` 仍为 5 项，旧版与新版本备份**双向兼容**：无 `moduleSettingsRecovery` 字段的旧备份仍可导入。
- 导入时 `validateModuleSettingsRecoveryInBackup` 校验该字段，恢复隔离记录，但**不覆盖当前有效模块设置**；校验失败则中止导入并回滚。

## 8. 数据架构

### 8.1 当前持久化范围

**[已实现]** 业务数据直接保存在浏览器 `localStorage`，当前 Data Center 使用的五个业务键如下：

| 数据类型 | 现有键 | 当前用途 |
|---|---|---|
| Quick Notes | `my-tech-lab-notes` | 已保存的笔记 |
| Task Manager | `my-tech-lab-tasks` | 任务及优先级、完成状态等 |
| Daily Focus | `my-tech-lab-daily-focus` | 当前每日重点及按日期归档 |
| Ideas & Writing | `my-tech-lab-ideas` | 已保存的灵感记录 |
| Document Summary 历史 | `my-tech-lab-document-summaries` | 已保存资料及总结历史 |

除上述五类业务键外，另有 §7 所述的两个模块设置系统键（`my-tech-lab-module-settings` 与其 `-recovery` 隔离键），系统配置与业务数据分开管理。

AI Assistant 对话和部分尚未保存的分析、草稿、预览是临时页面状态，不属于上述持久化备份范围。Data Center 当前的五类键是代码确认的备份范围，不应据此推断其他临时数据已经备份。

### 8.2 数据不变量

1. 业务数据与系统配置必须分开管理；模块启停设置不得占用或改写上述业务键。
2. 保留现有键名和数据格式，除非有经过审查的版本化迁移方案及兼容恢复路径。
3. 新数据格式应有 schema 版本；迁移必须先验证并保证失败时旧数据仍可恢复。
4. 隐藏界面、停用模块、调整分类或入口均不应删除数据。
5. 数据归用户所有，功能应逐步支持完整导出、导入、备份和恢复。
6. Data Center 的格式校验、导入预览、用户确认、导入前备份、失败回滚和受限清理范围是重要安全边界；扩展备份范围时必须同步更新校验、版本兼容和回滚设计。
7. 未来云同步或数据库迁移需另行设计冲突处理、离线行为、身份访问、保留和删除策略，不能假设当前 `localStorage` 已具备跨设备同步能力。

## 9. AI 架构

### 9.1 当前实现

- **[已实现]** 前端多个 AI 工作流把请求发送到 Cloudflare Worker 地址；代码中使用 `messages` 请求结构，并依赖 `{ reply, model }` 成功响应。
- **[已实现（前端可确认范围）]** 当前主要模型服务为 DeepSeek，Worker 是前端与模型 API 之间的代理层。
- **[已实现]** 工作流提示词、输入校验和结果处理分别位于各业务工作流代码中。
- **[已实现]** 五个 AI 工作流各持独立 `AbortController` 与 AccessVersion，用于模块停用时中止在途请求并丢弃迟到响应（见 §6.3）。
- **[无法从仓库确认]** Worker 源码、线上 Secret 配置、模型参数、请求限额及实际部署版本。

### 9.2 目标边界

**[未来规划]** 逐步建立统一 AI Service，并按需提供可替换的模型适配器，例如 DeepSeek、OpenAI、Claude 和 Gemini。

- 业务模块依赖项目内统一请求契约，不长期直接绑定某供应商的 URL、认证协议或响应格式。
- 模型选择、供应商配置和 Secret 管理集中在受控边界。
- 各业务工作流保留独立提示词、领域校验和业务决策，不将领域逻辑塞入通用适配器。
- 当前不要求自动模型路由；只有在成本、质量、隐私和故障策略明确后才考虑。
- API Key 和其他 Secret 不得放入公开前端 JavaScript、静态配置或公开仓库。
- 迁移接口时保持既有五个 AI 工作流的输入/输出兼容，并使用 mock 或测试环境验证，不以真实 API 消费作为唯一验证手段。

## 10. 部署与基础设施

### 10.1 当前调用链

**[已实现（前端代码所示）]**

```text
浏览器（GitHub Pages 前端）
        → Cloudflare Worker
        → DeepSeek API
```

仓库可确认前端调用 Worker 的方式和端点常量；没有 Worker 源码或部署配置，因此无法从项目代码确认 Worker 内部实现、线上安全设置、可用性或 Cloudflare 套餐能力。

### 10.2 可替换性目标

**[未来规划]** GitHub Pages、Cloudflare Worker 和 DeepSeek 是当前架构中的具体实现选择，不是领域逻辑必须绑定的永久核心依赖。未来可评估替换前端托管、后端服务和模型供应商。

替换时应：

- 通过接口边界隔离部署供应商细节。
- 分别验证目标环境的运行限制、安全控制、成本、可用性和隐私要求。
- 保持前端业务功能和数据可迁移。
- 不在没有迁移方案、测试和回滚方式时移除现有服务。

## 11. 安全、隐私与成本

### 当前边界

- **[已实现]** 项目开发规范要求保护现有数据；Data Center 对导入和批量清空提供备份、确认、数据校验和失败保护逻辑。
- **[已实现]** AI 请求由前端经 Worker 转发；API Key 不应置于公开前端。
- **[无法从仓库确认]** 线上 Worker 是否配置身份验证、限流、每日额度、超时、错误脱敏或其他访问控制。
- **[未来规划]** 按实际使用和威胁模型逐步建设身份验证、调用限额、用量监控、数据保护和云服务成本控制；不将其误报为当前已实现功能。

### 长期约束

- 涉及数据覆盖、迁移、删除、清空或重置的操作必须先说明范围并取得明确确认；高风险批量操作遵循“先备份，再确认，后删除”。
- AI 请求不得暴露 API Key；CORS 或来源检查不能被当作身份验证的替代品。
- 公开托管的静态前端不具备安全存放秘密的能力。
- 涉及患者或其他敏感个人信息时，必须在输入和服务选择前评估隐私与合规要求；不得把可识别患者信息提交到公开网页或未经批准的第三方服务。
- 新服务和基础设施应评估费用上限、滥用风险、故障影响及退出方式。

## 12. 长期演进原则

1. 渐进式开发，不一次性大重构。
2. 优先保持现有功能稳定。
3. 每次新增功能前确认其架构归属和数据影响。
4. 公共能力尽量复用，避免重复实现。
5. 数据属于用户，保持可导出、可恢复和可迁移。
6. 接口开放，避免绑定单一模型和部署平台。
7. 不为了架构而架构，不提前引入不必要的数据库、框架和付费服务。
8. 每个阶段完成后进行针对性及回归测试，并为有风险的迁移准备回滚方案。
9. 统计和服务状态必须有真实来源；无法确认时明确标注未知。
10. 保持 iPhone、iPad 和 Mac 上的可用性与响应式体验。

具体的阶段顺序与当前进度见 `ROADMAP.md`（进度与实施顺序的唯一来源）。

## 13. 后续需要明确的架构决策

以下事项在相关阶段开始前再确定，当前不预设唯一方案：

- Module Registry 是静态代码定义、数据文件，还是未来由管理功能维护；应如何校验其 ID 稳定性。
- 模块启停和排序偏好是否持久化、使用何种独立配置键，以及是否纳入 Data Center 备份（启停已落 `my-tech-lab-module-settings`；排序偏好尚未引入）。
- Module Management Center 如何处理父子模块、共享工作区和禁用中模块正在进行的操作（停用只读机制已实现，见 §6）。
- AI Assistant 对话和其他临时 AI 结果是否需要持久化及纳入备份；若需要，需明确隐私、保留和导出规则。
- Data Center 的备份格式如何演进以容纳未来的系统配置，同时保持旧版备份兼容。
- 云同步是否属于近期需求；若启动，如何处理多设备冲突、认证、加密、离线写入和删除传播。
- Worker 的身份验证、限流、额度和可观测性如何实现，以及对应部署平台和成本。
- 模块版本及“运行状态”如何定义、从何处读取，避免静态代码无法证明的健康状态。

这些决策应在实现需要它们的阶段，结合真实使用场景、安全约束和成本再作决定。
