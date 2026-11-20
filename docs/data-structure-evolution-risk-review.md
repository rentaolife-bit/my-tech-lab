# My Tech Lab 数据结构演进风险复核报告

> 版本：v1　日期：2026-11-08
> 性质：只读代码审查与风险评估，未修改任何代码、数据或配置。
> 依据：`index.html` 实际代码（含函数调用链），辅以 `docs/data-asset-inventory.md`。
> 结论原则：不把潜在风险写成已发生损失，不把合理严格校验误判为缺陷。

---

## 1. Git 状态与检查范围

- 分支 `main`，HEAD `8e38561`，工作区干净；未跟踪文件：`.workbuddy/`、`docs/data-asset-inventory.md`。
- 检查范围：`index.html` 中 5 个业务数据模块 + 3 个系统键的全部「创建 / 编辑 / 归档 / 备份 / 导入 / 恢复」路径，以及全局对象重建、整键覆盖、固定字段校验、归一化、导入导出等模式。

---

## 2. Ideas 风险复核

**创建数据结构**（`ideaForm` submit，:11719-11725）：
```js
const nextIdea = {
    id: existing?.id ?? `${Date.now()}-...`,
    title, content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
};
const nextIdeas = existing
    ? ideas.map((idea) => idea.id === editingIdeaId ? nextIdea : idea)
    : [nextIdea, ...ideas];
```

**结论**：编辑（`existing` 存在）时，`nextIdea` 是**从零重建**的对象，仅含 `id/title/content/createdAt/updatedAt` 五个字段，**未使用 `...existing` spread**。

- **是否字段白名单/重建**：是，重建且未 spread。
- **新增字段是否会在编辑时丢失**：**会**。若未来为 Idea 增加字段（如 `tags`、`status`），编辑该 Idea 后新增字段会被丢弃。
- **是否存在其他更新入口**：无。Ideas 只有「新建 / 编辑（同一 submit）/ 删除」三条路径，唯一更新入口即此 submit。

**风险等级：P2**（未来新增字段时丢失；当前 Idea 只有这 5 个字段，**尚未造成现有数据丢失**）。

---

## 3. Daily Focus 风险复核

涉及函数：

| 函数 | 位置 | 行为 |
|---|---|---|
| `cloneDailyFocusArchive` | :9991 | 重建 `{schemaVersion, activeDate, records:{date:{priorities}}}`，丢弃其他字段 |
| `normalizeDataCenterDailyFocus` | :6669 | 旧格式迁移 或 `cloneDailyFocusArchive(validateDailyFocusArchive(data))`，重建丢弃其他字段 |
| `validateDailyFocusArchive` | :9943 | 严格校验 `schemaVersion` 精确等于 1、`activeDate` 格式、`records` 结构 |

调用链：`persistDailyFocus`（:10158，写回时 `cloneDailyFocusArchive`）、Data Center 备份（:6943）、导入（:7157）、恢复合并（:7303）、`applyDataCenterData`（:7228）——**均经过 clone/normalize**。

**结论**：
- Daily Focus 的 `cloneDailyFocusArchive` / `normalizeDataCenterDailyFocus` 是**固定字段重建**，未来为归档或单日记录新增字段时，会在保存/备份/导入/恢复过程中被丢弃。
- **关键区分**：这不是「正常业务更新的字段过滤」，而是**数据格式标准化**——当前 Daily Focus 是结构固定的 `{schemaVersion, activeDate, records}`，clone/normalize 恰好完整覆盖现有字段，**当前无数据丢失**。因此不能简单认定它是缺陷，未来演进时需同步更新其字段白名单。

**风险等级：P2**（未来字段丢失；当前格式固定、无损失）。

---

## 4. Data Center 风险复核

### 4.1 整键替换（是否覆盖）

- `applyDataCenterData`（:7224）用 `notes = imported.get("quick-notes")` 等**整体替换内存态**；`runDataCenterRecoveryTransaction`（:7257）的写循环（:7311）对每个 key 执行 `localStorage.setItem` **整键覆盖**。
- 触发条件：用户导入旧备份时，5 个模块的本地数据**按备份覆盖**（确认弹窗明示「五个模块的本地数据将按备份覆盖」）。

**结论**：整键替换**确实存在**，但属**刻意设计**：导入前有 `window.confirm` 覆盖提示（:7417），且有预导入备份下载（:7280-7284）。**不是 bug**。

### 4.2 导入失败是否部分写入

- 写循环对每个 key `setItem` + 回读校验（:7311-7317），任一步失败即抛错进入回滚。
- 回滚（:7337-7386）恢复所有 key 的原始值；回滚失败则 `lockDataCenterForRecoveryFailure` 进入**恢复失败保护锁定**，并要求用户用专用恢复流程 + 下载的快照处理。

**结论**：导入**具备事务性**（预导入快照 + 写后回读 + 失败回滚 + 恢复锁定）。部分写入仅在「写入失败且回滚也失败」的双重极端下才可能残留，且此时系统已锁定保护并留有快照。**风险已被有效缓解**。

### 4.3 未知字段能否在备份/恢复中保留

- 备份导出（`createDataCenterBackup`，:6926）：非 daily-focus 模块读取 `data` 原样写入；daily-focus 经 `normalize` 重建。
- 备份校验（`validateDataCenterBackup`，:7125）：非 daily-focus 模块 `module.validate(entry.data)` 宽松（不拒绝未知字段）；daily-focus 经 `normalize` 重建。
- 恢复写回（:7291-7308）：非 daily-focus `data` 原样写回（未知字段保留）；daily-focus 经 `normalize`/合并重建。

**结论**：Tasks / Notes / Ideas / Documents 的未知字段**可经备份往返保留**；**Daily Focus 的未知字段会丢失**（normalize 重建）。

### 4.4 旧版本备份是否覆盖新版本数据

- `validateDataCenterBackup` 严格校验 `backup.format === dataCenterFormat`、`backup.version === dataCenterVersion`、`backup.modules.length === dataCenterModules.length`（:7126-7134）。
- 触发：未来**新增模块**或**改版本**后，旧备份因 `modules.length` 或 `version` 不匹配被**拒**（而非覆盖）；反之，当前版本导入旧版本备份（字段缺失）会整键覆盖，但有预导入备份兜底。

**风险等级：P2**（新增模块/改版本会破坏旧备份兼容；需引入版本兼容策略）。

---

## 5. 全局类似问题扫描结果

| 模块 | 更新入口 | 是否 spread 保留未知字段 | 结论 |
|---|---|---|---|
| Task Manager | `toggleTask`（:10655）、`changeTaskPriority`（:10681）、编辑（:10803） | ✅ 均 `{...task, ...}` | **好** |
| Quick Notes | 编辑（:10496 `{...note, text}`） | ✅ spread | **好** |
| Ideas | 编辑（:11719 `nextIdea`） | ❌ 重建 | **丢未知字段（P2）** |
| Document Summary | 保存/更新（:11407 `nextRecord`） | ❌ 重建 | **丢未知字段（P2）** |
| Daily Focus | clone/normalize | ❌ 重建（格式标准化） | **丢未知字段（P2）** |
| Module Settings | `validateModuleSettings`（:5442） | ✅ 严格白名单（刻意） | 需显式演进 |
| AI Assistant 工作流 | 无持久化（仅内存） | — | 不涉及 |
| Projects & Creation | 静态展示，无数据 | — | 不涉及 |
| Data Center | 备份/导入/恢复 | 见 §4 | 见 §4 |

**其他发现（规范性，P3）**：
- 同类字段命名不一致：`text`（Task/Note）vs `content`（Idea）vs `sourceText`（Document）。
- `updatedAt` 仅 Idea / Document 有，Task / Note 无。
- 4 类裸数组（notes/tasks/ideas/documents）无 `schemaVersion`。

**正面结论（避免误判）**：
- Task / Note 的编辑均用 spread，未知字段可保留。
- Data Center 导入是事务性的（预导入快照 + 回滚 + 恢复锁定）。
- Module Settings / Daily Focus 已有 schemaVersion 与 legacy 迁移（v1→v2、legacy→v1），是**可复用范本**。
- Module Settings 的严格白名单是**合理的损坏检测边界**，不应取消。

---

## 6. P0—P3 风险清单

**P0（不可逆数据丢失/严重损坏）：无。**

**P1（真实存在的数据丢失/覆盖/恢复风险）：无。**
> 经逐路径核实，当前所有更新入口均完整覆盖现有字段，未发现会导致**现有数据**丢失的代码路径；Data Center 整键覆盖有确认 + 预导入备份 + 回滚三重保护。

**P2（未来增字段/迁移数据库的兼容风险）：5 项**

| # | 问题 | 位置 | 触发条件 | 影响数据 | 已影响现有数据 |
|---|---|---|---|---|---|
| R1 | Idea 编辑重建对象，未知字段丢失 | :11719 | 编辑已保存 Idea（未来字段） | Ideas | 否 |
| R2 | Document 更新重建对象，未知字段丢失 | :11407 | 更新已保存资料（未来字段） | Document Summary | 否 |
| R3 | Daily Focus clone/normalize 重建，未知字段丢失 | :9991、:6669 | 保存/备份/导入/恢复（未来字段） | Daily Focus | 否 |
| R4 | Module Settings 严格白名单，新增字段需同步改校验 | :5442 | 新增设置字段 | 模块设置 | 否 |
| R5 | 备份版本/模块数严格校验，旧备份不兼容 | :7126 | 新增模块或改版本 | 备份兼容性 | 否 |

**P3（规范性/维护性）：3 项**
- 字段命名不一致（`text`/`content`/`sourceText`）。
- `updatedAt` 字段覆盖不全。
- 4 类裸数组无 `schemaVersion`。

---

## 7. 建议修复顺序

| 顺序 | 项 | 优先级 | 时机 |
|---|---|---|---|
| 1 | R1、R2（Ideas / Document 编辑改为 spread） | P2 | 可在后续任意增量迭代中顺带修复 |
| 2 | R4（Module Settings 演进规范）+ R5（备份版本兼容） | P2 | 在**首次需要新增字段/模块时**一并实施 |
| 3 | R3（Daily Focus 字段白名单演进） | P2 | 在首次为 Daily Focus 新增字段时实施 |
| 4 | P3 类（命名统一、schemaVersion） | P3 | 统一数据底座建设时一并规范 |

> 原则：**当前无需立即修改任何代码**。所有 P2 项都只在「未来真正要加字段/模块」时才触发，且触发时再修即可，不提前重构。

---

## 8. 每项问题的最小修改方案

**R1（Idea）**：`nextIdea` 改为 `{ ...existing, title, content, updatedAt: now }`（`existing` 存在时 spread；新建时 `existing` 为 `undefined`，`{...undefined}` 安全）。不改变现有字段语义。

**R2（Document）**：`nextRecord` 改为 `{ ...existing, title, sourceText, summary, analysisMode, model, updatedAt: now }`。`summary` 已由 `getDocumentSummaryValues()` 完整覆盖 5 个字段，spread 仅用于保留未来未知字段。

**R3（Daily Focus）**：不在 `clone`/`normalize` 里无脑 spread（会破坏格式标准化），而是在未来新增字段时**同步更新**这两个函数的字段白名单 + `validateDailyFocusArchive` + `dailyFocusSchemaVersion` 递增 + legacy 迁移。

**R4（Module Settings）**：新增字段时同步改 `validateModuleSettings` + 提升 `moduleSettingsSchemaVersion` + 在 `migrateModuleSettings` 新增「旧→新」迁移（复用现有 v1→v2 模式）。

**R5（备份版本兼容）**：`validateDataCenterBackup` 改为「接受当前版本 + 明确的前一版本，前一版本经迁移到当前版本」，`modules.length` 校验改为「按 id 匹配 + 缺失模块用 `emptyValue()` 兜底」，保留格式/损坏严格校验。

**P3**：统一数据底座时规范命名（`content`/`text` 统一）、补 `updatedAt`、为 4 类裸数组加 `schemaVersion` 包装。

**修复是否影响已验收功能**：R1/R2 仅改更新路径的 spread，行为等价，**不影响**；R3/R4/R5 涉及校验与迁移，需配合回归测试，**不改变正常运行行为**。

---

## 9. 回归测试建议

- **R1/R2**：编辑 Idea / 资料后，5 个现有字段内容正确更新、`createdAt` 不变、`updatedAt` 刷新；新增（未来）字段经 spread 保留。
- **R3**：Daily Focus 新增字段后，保存/备份/导入/恢复四路径均保留该字段。
- **R4**：模块设置新增字段后，旧版本设置可迁移、损坏设置仍被拒绝。
- **R5**：旧版本备份可导入、新版本备份不被旧代码误读、缺失模块用空值兜底。
- **通用回归**：现有 300 项测试全绿 + 各模块增删改查手测。

---

## 10. 当前不需要处理的问题及原因

1. **Data Center 整键覆盖**：非缺陷，已有「确认 + 预导入备份 + 回滚」三重保护，属刻意设计。
2. **Module Settings 严格白名单**：是合理的损坏检测边界，不应为了「保留未知字段」而放宽（会削弱安全校验）。
3. **Daily Focus clone/normalize 重建**：是格式标准化的正确行为（当前格式固定、无字段丢失），不能简单改为 spread。
4. **AI 对话不持久化**：属产品决策（隐私/保留策略），非数据演进风险。
5. **字段命名不一致 / schemaVersion 缺失**：P3 规范性，待统一数据底座时一并处理，不单独重构。

---

*本报告基于实际代码调用链生成，未修改任何文件、数据或配置。*
