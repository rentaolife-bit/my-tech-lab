# My Tech Lab 顶层信息架构设计方案

> **文档性质**：评审草稿（非正式文档）。本文是"顶层信息架构重新设计"的研究与设计成果，供共同评审用。
> **状态**：[待评审]　**日期**：2026-11-03
> **约束**：本文不修改 `index.html` 与任何业务代码；不修改 `ARCHITECTURE.md` / `DEVELOPMENT_RULES.md` / `ROADMAP.md`；不涉及数据库、Flask 或详细 SQL 设计；不 Commit / Push。评审确认后再决定是否并入正式文档。

---

## 一、当前 10 个模块的职责、边界与相互关系

以下基于 Registry 代码事实（模块 id、类型 `type`、数据归属 `dataOwnership`、父模块 `parentId`、持久化键）：

| 模块 | 类型 | 数据归属 | 持久化键 | 父模块 | 实际职责 | 与其他模块的关系 |
|---|---|---|---|---|---|---|
| `ai-assistant` | standalone | none | 无（对话仅存内存） | — | 通用 AI 对话入口 + 4 个子工作流的承载区 | 4 个子工作流的父模块 |
| `daily-planning` | embedded-workflow | shared | 无 | ai-assistant | 依据任务 + 今日重点生成每日计划建议 | 读 task-manager、daily-focus 数据 |
| `task-organization` | embedded-workflow | shared | 无 | ai-assistant | 分析任务描述，确认后写入 Task Manager | 写 task-manager 数据 |
| `document-summary` | embedded-workflow | own | `my-tech-lab-document-summaries` | ai-assistant | 资料总结 + 管理总结历史 | 自持数据 |
| `ideas-writing` | embedded-workflow | own | `my-tech-lab-ideas` | ai-assistant | 灵感记录 + 文章起草/润色/表达转换 | 自持数据 |
| `daily-focus` | standalone | own | `my-tech-lab-daily-focus` | — | 今日三重点 + 按日期历史归档 | 被 daily-planning 读取 |
| `task-manager` | standalone | own | `my-tech-lab-tasks` | — | 任务 + 优先级 + 完成状态 | 被 task-organization 写、daily-planning 读 |
| `quick-notes` | standalone | own | `my-tech-lab-notes` | — | 快速笔记 | 无 |
| `data-center` | system-management | none | （管理 5 键 + 模块设置） | — | 导出/导入/备份/清空 | 管理全部业务键 |
| `module-management-center` | system-management | none | （管理模块设置） | — | 模块启停/详情/恢复 | 管理模块设置 |

**关键观察（这是理解整个问题的钥匙）**：

1. `ai-intelligence` 分类里的 5 个模块，本质是**两种完全不同的东西**混在一起：
   - `daily-planning`、`task-organization`：`dataOwnership = "shared"`，**没有自己的数据**，它们是"操作 Task Manager / Daily Focus 数据的 AI 能力"。
   - `document-summary`、`ideas-writing`：`dataOwnership = "own"`，**有自己的数据 + 自己的 AI 工作流**，是"模块 + AI 能力"的混合体。
2. `category` 字段**只用于 Module Management Center 的展示分组**，不参与停用级联、读写守卫、AI 取消等任何运行逻辑。
3. `parentId` 字段**才是运行维度**：它决定停用级联（`isModuleEffectivelyEnabled` 沿父链检查）、只读状态（`parent-disabled`）。

**这个事实直接决定了后面的演进策略**：改 `category` 是零风险的纯展示调整；改 `parentId` 才会牵动级联、守卫、取消机制。

---

## 二、逐模块目标归属

| 现有模块 | 处置 | 目标归属 | 说明 |
|---|---|---|---|
| `task-manager` | **保留** | Productivity & Knowledge → Tasks | 职责不变，改名任务管理 |
| `daily-focus` | **保留** | Productivity & Knowledge → Daily Focus | 职责不变 |
| `quick-notes` | **保留** | Productivity & Knowledge → Notes | 短期保留，长期与 KB 打通 |
| `data-center` | **保留** | System | 不变 |
| `module-management-center` | **保留** | System | 不变 |
| `ai-assistant` | **调整归属** | 横向 AI 能力 + 全局对话入口（非分类） | 见第四节 |
| `daily-planning` | **调整归属**（中期） | Tasks 的"计划"AI 能力 | shared，无自有数据 |
| `task-organization` | **调整归属**（中期） | Tasks 的"整理"AI 能力 | shared，无自有数据 |
| `document-summary` | **拆分**（长期） | 总结能力→Documents；历史→Knowledge Base | own，需拆数据与能力 |
| `ideas-writing` | **拆分**（长期） | 创作能力→Documents & Writing | own，需拆数据与能力 |
| — | **未来新增（暂缓）** | Calendar、Knowledge Base、Projects、Research | 见第七节，克制不展开 |

**核心原则**：现有 10 个模块**一个都不删**。本次只做"分类重映射 + 导航重组"，运行机制（parentId/级联/守卫/取消）保持不动，或仅在最必要处做可回滚的小步调整。

---

## 三、重点模块关系分析

### 3.1 Tasks / Daily Focus / Notes —— 三个独立的"个人效率"数据，互不隶属

- **Tasks**（任务）：有优先级、完成态，是"待办事务"。
- **Daily Focus**（今日重点）：每天 3 条，是"今天最重要的几件事"，有历史归档。
- **Notes**（快速笔记）：无结构的随手记。

三者是**平行数据**，不是父子关系。它们唯一的交集是 `daily-planning` 会同时读 Tasks 和 Daily Focus 来生成计划。因此三者都应平铺在 Productivity & Knowledge 下，**不应谁挂在谁下面**。

### 3.2 Tasks vs Projects —— "轻任务" 与 "有产出的项目"

- **Tasks**：无项目上下文的轻任务（当前形态）。
- **Projects**（未来）：有明确产出、跨任务、跨文档的项目容器。

关系是**单向引用**：`task.project_id` 让任务可归属项目，但 Tasks 模块本身独立存在，不强制所有任务都要有项目。这是避免"为了上 Projects 而把 Tasks 推倒"的关键——**Tasks 永远可用，Projects 是可选的上层组织**。

### 3.3 Notes vs Knowledge Base —— capture vs curate（核心边界）

| | Notes（捕获） | Knowledge Base（沉淀） |
|---|---|---|
| 生命周期 | 短、临时 | 长期、结构化 |
| 结构 | 纯文本 | Markdown + 分类 + 标签 + 来源 |
| 检索 | 无 | 全文搜索 + AI 问答 |
| 关联 | 无 | 关联 Tasks / Projects / 来源 |

**唯一连接**：提供"Note 提升为 Knowledge Item"的升级链路，让两者是**漏斗关系**（先捕获、再沉淀），而不是两个孤立数据岛。

### 3.4 Documents & Writing / Research / Knowledge Base —— 产出、过程、沉淀

- **Documents & Writing**（产出）：成文的文档、写作、灵感创作（含现有 ideas-writing 的创作部分）。
- **Research**（过程，未来）：围绕一个主题的调研，产出材料、笔记、结论。
- **Knowledge Base**（沉淀）：可长期检索、引用的知识条目。

三者是"创作产出 → 调研过程 → 知识沉淀"的**生命周期关系**，Research 的成果可沉淀进 KB，Documents 可关联 KB 条目作为来源。

### 3.5 AI Assistant —— 横向能力 + 全局入口

AI Assistant 不应该是任何一个业务模块的子集，也不应该是一个"分类"。它是**所有模块都能就地唤起的横向能力**，同时保留一个常驻的通用对话入口。详见第四节。

---

## 四、AI Assistant 四个子工作流的处理方式（重点分析）

### 4.1 先厘清现状机制

现在的 4 个子工作流（`daily-planning`、`task-organization`、`document-summary`、`ideas-writing`）都是 `parentId = "ai-assistant"` 的子模块，且**各自独立拥有**：

- **独立读写守卫**：`persistDocumentHistory` 守卫 `document-summary`，`persistIdeas` 守卫 `ideas-writing`；`task-organization`/`daily-planning` 的 AI 入口守卫各自的模块 id，但它们真正写数据走的是 `persistTasks`/`persistDailyFocus`（守卫 task-manager/daily-focus）——**即 shared 子工作流存在"两层守卫"**。
- **独立 AbortController**：`aiRequestController`、`dailyPlanningRequestController`、`taskOrganizerRequestController`、`documentAnalysisController`、`ideasAIRequestController`，共 5 个。
- **独立 access 更新函数**：`updateAssistantAccessUI` 及 4 个 `update*AccessUI`。

**级联的实际实现**：停用 `ai-assistant` → `updateModuleAccessUI()` → 每个 `update*AccessUI` 各自调用 `getModuleAccessStatus(自己id)`，通过 `isModuleEffectivelyEnabled` 沿 parentId 链发现父模块停用 → 各自 abort + 置只读。**级联不是父模块"广播"，而是每个子模块独立沿链判断**。

### 4.2 拆分子工作流对运行机制的影响（逐项）

假设把某个子工作流的 `parentId` 从 `ai-assistant` 改到别的业务模块（或设为独立）：

| 机制 | 影响 | 风险等级 |
|---|---|---|
| **Module Registry** | 改 `parentId`（或改 id）；`category` 另议 | 低 |
| **parentId 级联** | 停用 `ai-assistant` **不再**级联停用该子工作流；改为停用新父模块才停用 | 中（语义变化，需重定义"停用能力 vs 停用模块"） |
| **权限控制** | `requireModuleAccess(子工作流id)` 逻辑不变，但"谁能停用它"变了 | 低 |
| **读写守卫** | `own` 型子工作流（document-summary、ideas-writing）的 persist 守卫绑定模块 id，**若改 id 则守卫指向失效** | 高（若改 id） |
| **AI 请求取消** | `update*AccessUI` 里的 `.abort()` 绑定各自的 controller，改 parentId 不影响 controller 本身，但要重新梳理"谁停用谁 abort" | 中 |

**结论**：真正高风险的只有"改模块 id"（会打断读写守卫与设置键）。**只改 `parentId` 风险可控，但会改变停用级联语义**——停用 AI Assistant 将不再能"一键停掉全部 AI 子工作流"。

### 4.3 建议：分三类、渐进处理，不一步拆除

核心思路是引入一个概念区分——**"模块"**（有数据、可停用、有读写守卫）与 **"AI 能力"**（无数据、随业务模块走、只是业务模块的一个操作入口）。

| 子工作流 | 本质 | 建议处理 | 时机 |
|---|---|---|---|
| `daily-planning` | **AI 能力**（shared，无自有数据） | 逐步演变为 Tasks/Daily Focus 的"计划"操作入口 | 中期 |
| `task-organization` | **AI 能力**（shared，无自有数据） | 逐步演变为 Tasks 的"整理"操作入口 | 中期 |
| `document-summary` | **模块 + AI 能力**（own） | 先拆数据（历史→KB）与能力（总结→Documents），再谈归属 | 长期 |
| `ideas-writing` | **模块 + AI 能力**（own） | 先拆数据（灵感→Notes/KB）与能力（创作→Documents） | 长期 |

**三步走（每步独立可验收、可回滚）**：

- **第 1 步（近期，零风险）**：只重映射 `category`，把 5 个 ai-intelligence 模块的**展示分类**改到新业务域；`parentId`、守卫、取消机制**完全不动**。停用 AI Assistant 仍然级联停用全部子工作流，行为不变。这一步只改信息架构的"看见方式"，不改任何运行行为。
- **第 2 步（中期）**：对 `shared` 型子工作流（daily-planning、task-organization），评估把它们的 `parentId` 从 `ai-assistant` 改为 `task-manager`（或新建一个"AI 能力"轻量父级），同时保留 `dataOwnership="shared"` 语义。需同步确认：停用 task-manager 时是否应停用其"AI 能力"（建议：是，因为能力依附于模块）。
- **第 3 步（长期）**：对 `own` 型子工作流（document-summary、ideas-writing），先完成数据与能力的拆分（新增 `documents`、`knowledge-base` 模块承接其数据），再调整 `parentId`。此步必须配合数据迁移。

**为什么不一步拆除**：一步拆除会让"停用 AI Assistant"失去"一键停用所有 AI 能力"的语义，且 `own` 型模块涉及数据迁移，贸然改 id 会打断读写守卫、破坏 `my-tech-lab-ideas` / `my-tech-lab-document-summaries` 两个键的守卫指向。渐进式才能在不推倒现有机制的前提下完成演化。

---

## 五、目标导航结构（树状）

```
My Tech Lab（Personal Command Center）
│
├─ Productivity & Knowledge　　（个人效率与知识沉淀）
│   ├─ Tasks　　　　　　　〔现有 task-manager〕
│   ├─ Daily Focus　　　　〔现有 daily-focus〕
│   ├─ Notes　　　　　　 〔现有 quick-notes〕
│   ├─ Knowledge Base　　〔未来新增 · 暂缓〕
│   └─ Calendar　　　　　〔未来新增 · 暂缓〕
│
├─ Projects & Creation　　　　（围绕项目与产出）
│   ├─ Projects　　　　　〔未来新增 · 暂缓〕
│   ├─ Documents & Writing 〔现有 ideas-writing 的创作 + document-summary 的总结〕
│   ├─ Research　　　　　〔未来新增 · 暂缓〕
│   └─ Creative Workspace 〔未来新增 · 暂缓〕
│
├─ System　　　　　　　　　　（系统管理）
│   ├─ Data Center　　　　〔现有〕
│   ├─ Module Management　〔现有〕
│   └─ Settings　　　　　 〔未来新增 · 暂缓〕
│
└─ 横向公共能力（非分类，常驻）
    ├─ AI　　〔对话 · 总结 · 规划 · 组织 · 创作〕
    ├─ Search 〔全文检索〕
    └─ Attachments 〔附件存储〕
```

**每个区域职责**：

- **Productivity & Knowledge**：回答"我今天要做什么、我积累了什么"——个人日常效率 + 长期知识资产。
- **Projects & Creation**：回答"我正在做什么产出"——围绕具体项目/作品的组织与创作。
- **System**：回答"系统本身如何管理"——数据、模块、设置。
- **横向能力**：AI、Search、Attachments 是**能力层**，任何业务模块就地调用，不属于任何分类。

---

## 六、当前结构与建议结构对比

| 维度 | 当前结构 | 建议结构 | 必要性 | 收益 | 复杂度 | 风险 |
|---|---|---|---|---|---|---|
| 顶层分类 | work-knowledge / ai-intelligence / system | Productivity & Knowledge / Projects & Creation / System | **高**：ai-intelligence 把"AI"当功能域，导致子工作流被锁在 AI 入口 | 分类反映用户心智，而非技术栈 | 低（纯展示重映射） | 低 |
| AI 定位 | 独立分类 + 父模块 | 横向能力 + 全局入口 | **高**：避免每个新模块重复接 AI | AI 能力复用，不重复实现 | 中（需 3 步渐进） | 中（级联语义变化） |
| 子工作流 | 4 个挂 ai-assistant | shared 型回归业务、own 型先拆数据 | 中：方向正确但不必一步到位 | 消除"AI 模块"与"业务模块"割裂 | 中～高 | 中（守卫/取消/迁移） |
| 模块数量 | 10 | 10（不变）+ 暂缓新增 | — | 不推倒、不膨胀 | 低 | 低 |
| 数据模型 | 5 键 + 模块设置 | 不变（本次不动） | — | 数据零改动 | 无 | 无 |

**核心收益**：新结构把"AI 是技术实现"这个错误维度，替换为"生产力/项目/系统"这个**用户真实工作流**维度，同时把 AI 降为横向能力，从根上避免"每加一个模块就问要不要接 AI、接了就再复制一套 AI 逻辑"的恶性膨胀。

**核心风险**：第 2、3 步改 `parentId` 会改变停用级联语义，且 `own` 型子工作流的拆分涉及数据迁移。**因此本方案明确：第一步只做零风险的分类重映射，后两步各自独立评估、可回滚，绝不一步到位。**

---

## 七、待共同评审的决策点

1. **AI 最终形态**：是否接受"AI 横向能力 + 全局对话入口"的定位（即不再保留 `ai-intelligence` 分类）。
2. **分类命名**：`Productivity & Knowledge` / `Projects & Creation` 是否定稿，还是需要更简洁的中文主名。
3. **子工作流演进节奏**：第 2、3 步是否纳入近期，还是长期观察后再定（建议：暂缓，先跑第 1 步）。
4. **新增模块克制**：Calendar、Projects、Research、Knowledge Base 等**全部暂缓**，待第 1 步分类重映射稳定、后端方向确定后再逐个评估，避免为架构完整而膨胀。

---

## 八、Professional Applications（专业应用层）—— 未来扩展领域

**性质**：未来扩展领域，当前**不属于**现有五大工作区，也不新增工作区。

- Professional Applications 是 My Tech Lab 的**未来扩展层**，用于承载面向特定专业领域的应用，**同时支持 AI 专业助手与独立业务管理系统**。医疗领域未来示例（**仅作示例**）：Medical Assistant（医疗智能辅助）、Department Management（医疗科室管理）、Research Assistant（医学科研管理与研究）、Palliative Care（安宁疗护专业应用）、Medical Knowledge（医学专业知识应用），不代表已规划或已开发。
- 其中 Department Management 是面向**真实科室业务活动**的独立业务应用（涉及科室组织与人员、工作安排与任务、排班与计划、质量管理、业务统计、制度文档资料等），与 System 中的 Module Management（管理 My Tech Lab 软件模块）**完全不同**，不得混淆。
- 未来专业应用作为**独立模块**接入平台，可**调用 Knowledge Base 与 AI Assistant 的公共能力**，但**不重复建设**已有基础功能（统一 AI、知识库、文档处理、统一 API 等）。
- 专业应用拥有**独立的业务逻辑、数据模型与权限边界**；医疗等敏感数据需独立隔离与访问控制。
- **不改变**当前五大工作区结构；具体实施在第五阶段（专业应用阶段）按实际需求启动，当前只做架构预留。

---

## 九、用户身份与账号体系（非工作区澄清）

- 用户身份与账号体系是**基础架构能力**，**不是**新的工作区，也**不是**独立业务模块，因此不进入上述五大工作区树。
- 未来接入 FastAPI + PostgreSQL 与多设备同步时，数据以 **User ID** 为归属锚点（区分 User ID / Username / Display Name / Login Account）；当前仍是个人单用户工作台，不开发登录/注册/用户管理。详见 `ARCHITECTURE.md` §13。

---

**附注**：本文为研究与设计成果，未修改任何项目文件、未改动 Git 状态、未建数据库、未开发 Flask、未设计详细 SQL、未 Commit/Push。
