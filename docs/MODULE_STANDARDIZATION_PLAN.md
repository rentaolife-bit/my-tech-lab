# My Tech Lab 模块标准化规划

> **文档性质**：规划文档（已完成的阶段规划）。
> **状态**：[已完成]　**创建日期**：2026-11-04　**完成日期**：2026-11-04
> **约束**：本文只记录模块标准化的目标、原则、方向、阶段与当前状态；不修改任何业务代码、测试文件或既有规范文档；不创建三份正式规范文件；不提交、不推送。
> **权威边界**：架构与机制以 `ARCHITECTURE.md` 为准，开发与数据安全规范以 `DEVELOPMENT_RULES.md` 为准，进度与实施顺序以 `ROADMAP.md` 为准。本文不重复定义这些内容，只在它们之上规划"模块标准化"这条独立工作线。

---

## 一、规划目标

将 **Task Manager** 确立为 My Tech Lab 的第一个样板模块，通过它已经实现、已经测试、已经验证的实践，提炼出通用的模块开发规范，为 Notes（Quick Notes）等其他模块提供统一标准，最终让每个新模块都遵循同一套结构、数据、安全、响应式与交付约束。

核心诉求：

- 用"一个样板模块"验证并沉淀规范，而不是凭空设计规范。
- 让后续模块不再各自为政，避免重复踩坑、重复实现安全边界。
- 保持渐进式演进，不对现有稳定功能做一次性大重构。

---

## 二、总体原则

沿用项目既定理念：

> 基础能力统一建设，专业能力按需扩展；模块独立运行，数据有序关联，AI 横向赋能。

具体原则：

1. **不复制 Task Manager 的业务代码**——只提炼可复用的架构原则、设计约束和工程实践，不复制粘贴业务实现。
2. **尊重现有权威文档**——`ARCHITECTURE.md`（系统是什么）与 `DEVELOPMENT_RULES.md`（怎么干活）是权威来源，本标准化工作只做"引用 + 落到模块级的可执行清单"，不重复定义同一份细则。
3. **渐进式标准化**——不要求所有模块一次性重构；先样板定型，再以 Notes 验证，最后按优先级推广。
4. **数据安全优先**——保护已有用户数据，任何模块标准化都不得引入删除、覆盖或重置用户数据的风险。
5. **规范必须来源于实践**——每一条规范都必须对应到"已实现、已测试、已人工验证"的具体实践，不写无法证明的条目。
6. **事实如实记录**——实现状态、验收状态、测试数字、发布版本均以代码、测试与 Git 为准，不把规划描述成现状。

---

## 三、五类标准化方向

### 3.1 模块基础结构与生命周期

| 子项 | 规范要点（待从 Task Manager 提炼） |
|---|---|
| Registry 注册 | 稳定唯一 `id`、`name`/`description`、`category`、`type`（standalone / embedded-workflow / system-management）、`parentId`、`status`、`dataOwnership`、`entry` 三选择器 |
| DOM 入口 | `targetSelector` / `navigationSelector` / `shortcutSelector` 的声明与 `validateModuleRegistry` 校验 |
| 模块状态 | 统一运行时状态模型 `getModuleRuntimeState`（exists / protected / selfEnabled / parentEnabled / effectiveEnabled / readonly / state / message） |
| 导航与状态徽章 | 导航项状态徽章、模块只读徽章、`aria-disabled` / 标题提示的统一处理 |

### 3.2 数据管理

| 子项 | 规范要点 |
|---|---|
| 数据键与数据结构 | 唯一持久化键、字段契约（类型 / 枚举 / 日期可解析） |
| 加载校验 | `loadX` 的严格校验与失败降级（`setXUnavailable` / fail-closed） |
| 持久化入口 | 单一 `persistX` 写入函数，内部二次守卫，成功才更新内存态并重渲染 |
| Data Center 注册 | `validate` / `count` / `latest` / `emptyValue` 四件套，纳入备份与恢复链路 |
| 数据迁移、备份和恢复 | schema 版本、迁移前的校验与失败回滚、隔离恢复、旧数据兼容 |

### 3.3 权限与安全

| 子项 | 规范要点 |
|---|---|
| 双重守卫 | UI 层禁用 + 真实写入函数入口 `requireModuleAccess`，不能只在 UI 层拦截 |
| 模块停用只读 | 保留数据、可查看、禁增删改、禁模块内导入、禁 AI（见 ARCHITECTURE.md §6） |
| 恢复失败锁定 | Data Center 恢复失败后 fail-closed 锁定写入（见 ARCHITECTURE.md §7） |
| 异常回滚 | 持久化失败不误报成功，UI 状态回滚 |
| AI 取消与迟到响应 | 独立 `AbortController` + AccessVersion，停用中止、迟到丢弃 |

### 3.4 UI 与响应式设计

| 子项 | 规范要点 |
|---|---|
| 桌面与移动端布局 | 桌面双列、窄屏单列；卡片按内容自然撑高，不做异常拉伸 |
| 响应式断点 | 断点表（如 ≥900px / ≤1279px / ≤600px / max-height 规则），不凭感觉改所有平板布局 |
| 内容收缩与溢出 | `min-width: 0` 逐层收缩链、`max-width: 100%`、`box-sizing: border-box`，不靠隐藏 `overflow-x` 掩盖溢出 |
| 真机验收要求 | iPhone / iPad / Mac 视口测量（卡片右边界、子元素右边界、控件实际宽度），iOS 原生控件须真机确认 |

### 3.5 测试与交付

| 子项 | 规范要点 |
|---|---|
| 自动化测试 | 统一 `node tests/run-all.js`，mock localStorage / DOM / fetch，不触碰真实数据、不发真实 AI 请求 |
| 真实业务函数测试 | 断言真实函数行为，不靠字符串匹配；保留 `MTL_HTML_PATH` 反向验证能力 |
| 人工验收 | 真实浏览器人工检查（自动化无法替代），保留设备 / 视口 / 结论 / 日期记录 |
| Git 差异检查 | 修改前查状态、修改后 `git diff --check` 与完整 diff 自查 |
| 提交与发布流程 | 仅暂存明确文件、Conventional Commits、未经授权不 commit/push |

---

## 四、实施阶段（全部已完成）

### 阶段一：Task Manager 样板定型（已完成）

- 功能与安全验收已通过（真机 + 自动化）。
- 自动化测试 **183 项全部通过**。
- iPhone、iPad、Mac 人工验收通过。
- 产出：将已实现、已测试、已验证的实践整理为规范草案。

### 阶段二：形成三份规范文件（已完成）

- `docs/MODULE_DEVELOPMENT_STANDARD.md`（已定型 v1.0）
- `docs/MODULE_ACCEPTANCE_CHECKLIST.md`（已定型 v1.0）
- `docs/MODULE_TEMPLATE.md`（已定型 v1.0）

### 阶段三：Notes 第二模块验证（已完成）

- 按规范检查 Notes（Quick Notes）：Notes 无需业务代码改造即已符合规范，仅补齐 4 项测试覆盖缺口。
- 自动化测试由 183 提升至 **187 项全部通过**。
- Mac、iPhone 15 Pro、iPad mini 人工验收通过；Data Center 导出与恢复、停用只读、重新启用、响应式布局验收通过。

### 阶段四：规范定型与推广（已完成）

- 三份规范正式定型为 v1.0，已通过两个不同业务模块（Task Manager、Notes）验证。
- 后续新模块按规范建设，现有模块按优先级渐进改造。

---

## 五、阶段成果与当前事实（如实记录）

- Task Manager 样板模块已完成功能、权限、数据保护、AI 选择性导入及人工验收（自动化测试 183 passed / 0 failed）。
- Notes 第二模块验证完成（自动化测试 187 passed / 0 failed），本轮仅新增 4 项测试，未改 Notes 业务代码。
- 三份正式规范 v1.0 已定型，并通过两个不同业务模块验证。
- 当前 HEAD 为 `70145e8`；`v1.3.0` 已发布。
- Task Manager 后续增强与 Notes 新增测试**仍未提交、尚未纳入 v1.3.0**（`index.html`、`tests/module-readonly-behavior.test.js` 有未提交修改；`docs/` 仍为未跟踪目录）。

## 六、后续路线

模块标准化阶段正式结束，后续按以下方向推进（均尚未启动，不代表已完成）：

1. **下一阶段**：Dashboard 统一总览升级。
2. **后续**：按模块标准逐步推广到其他模块。
3. **再后续**：根据实际需求逐步扩展临床助手、科研助手、知识库等专业能力。

---

## 七、文档职责边界（已定型）

三份正式规范文档已定型，遵循以下单向引用，不复制既有权威内容：

- [MODULE_DEVELOPMENT_STANDARD.md](MODULE_DEVELOPMENT_STANDARD.md)：模块级"如何落地"的执行规范，逐章引用 [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md) §七（数据安全）与 [ARCHITECTURE.md](../ARCHITECTURE.md) §5–§7（Registry / 运行时行为 / 数据契约）。
- [MODULE_ACCEPTANCE_CHECKLIST.md](MODULE_ACCEPTANCE_CHECKLIST.md)：可勾选验收清单，每一项必须能填"证据"（命令输出 / 视口测量 / 设备与日期）。
- [MODULE_TEMPLATE.md](MODULE_TEMPLATE.md)：可复制骨架（Registry 条目、HTML 区块、CSS 断点、load/persist/守卫、测试文件骨架）。

> 附注：本规划文档自身不重复定义数据安全细则、运行时语义或测试方法，仅在计划层面引用它们。
