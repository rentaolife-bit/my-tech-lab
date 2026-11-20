# 阶段 2 前端接入实施计划（Quick Notes 试点）

> 状态：实施中　日期：2026-11-20
> 依据：`docs/unified-data-foundation-design.md` §6.6 / §11（阶段 2）、`index.html` 实际代码、后端 `backend/` 已实现接口。

## 一、目标与非目标

目标：把前端数据读写从「直接 localStorage」抽象为可切换的 DataService，接入后端 API，先以 Quick Notes 为试点模块纵向打通。

非目标（本阶段不做）：

- 不迁移 localStorage 历史数据（阶段 3）。
- 不改 Task / Daily Focus / Ideas / Document Summary 四个模块。
- 不改模块启停/只读守卫、AI 取消机制、Data Center 现有行为（local 模式）。
- 不引入构建系统、不引入第三方前端依赖。

## 二、现状（已核实的代码事实）

- Quick Notes 存储键 `my-tech-lab-notes`，数据结构 `{ id, text, createdAt }`，id 由 `Date.now()-random` 生成。
- `persistNotes(nextNotes)`（约 `index.html:10389`）：同步写 localStorage + 更新内存 + `renderNotes()`，返回 boolean。
- `loadNotes()`（约 `index.html:10455`）：同步读 + 校验 + `notesStorageReady = true` + 渲染。
- 调用点：`notesForm` submit（约 `index.html:10477`）、`deleteNote()`（约 `index.html:10409`）、`startEditNote()`（约 `index.html:10439`）、`notesCancel`（约 `index.html:10520`）。
- 状态与守卫：`notes` / `notesStorageReady` / `notesStatus` / `editingNoteId`，`requireModuleAccess("quick-notes", notesStatus)`。
- 现有测试 `tests/module-readonly-behavior.test.js` 通过 `new Function` 加载真实脚本，并**同步**调用 `persistNotes` / `loadNotes` 断言 localStorage 行为，必须保持 local 模式同步语义不变。
- 后端 notes：`{ id(UUID), text, created_at, updated_at, version, deleted_at }`；认证走邮箱 OTP + Bearer（access 内存 + 可撤销 refresh）。

## 三、设计

1. `DATA_SOURCE`（`local` | `api`，默认 `local`）与 `API_BASE`（可配置，不硬编码局域网 IP）。
2. `authClient`：内存保存 access token；勾选「记住此设备」时把 refresh token 存 localStorage；启动时静默 `/refresh`；401 自动刷新一次；失效回登录。
3. `apiClient`：统一 fetch、Authorization 头、错误处理。
4. `DataService`：`listNotes / createNote / updateNote / deleteNote`，含字段映射（`createdAt ↔ created_at`、id 归一化、`version` 透传）。
5. 极简登录浮层：邮箱 → 验证码 → 登录，含「记住此设备」。

## 四、可执行改动点

1. 在脚本顶部新增配置常量：`DATA_SOURCE`（读取 `window.MY_TECH_LAB_DATA_SOURCE`，默认 `"local"`）、`API_BASE`（读取 `window.MY_TECH_LAB_API_BASE`，去尾斜杠）、refresh token 存储键。
2. 新增三个 IIFE：`authClient`、`apiClient`、`DataService`（放在脚本内一个清晰标注的新段落，不触碰既有函数）。
3. 新增登录浮层：HTML（`login-overlay` 及其表单）、CSS（遮罩 + 卡片）、JS（申请验证码 / 登录 / 记住此设备 / 关闭会话）。
4. Quick Notes 异步编排（保留现有同步函数不动）：
   - 保留 `persistNotes` / `loadNotes` 原样（local 同步，现有测试不变）。
   - 新增 `loadNotesFromApi()`、`createNoteToApi(text)`、`updateNoteToApi(id, text, version)`、`deleteNoteFromApi(id)`，统一走 `DataService`。
   - 启动调用点按 `DATA_SOURCE` 分支：`api` 先 `authClient.ensureSession()` 再 `loadNotesFromApi()`；`local` 走原 `loadNotes()`。
   - `notesForm` submit 分支：`api` 走 `await createNoteToApi/updateNoteToApi`；`local` 走原逻辑。
   - `deleteNote` 分支：`api` 走 `await deleteNoteFromApi`；`local` 走原逻辑。
   - `startEditNote` 额外记录 `editingNoteVersion`（api 模式更新时带 version）。
   - 保存中/成功/失败文案区分；失败保留输入并提示重试；409 提示「已在别处修改，请刷新」。
5. 新增测试 `tests/data-service.test.js`：字段映射、DataService 的 api 分支（mock fetch）、409 冲突、失败不丢输入、authClient 记住设备/静默刷新/清除。不修改任何现有测试。
6. 回归与人工验证：`node tests/run-all.js` 全绿；本地起 uvicorn + PostgreSQL，真实验证码走一遍 CRUD；真机浏览器人工检查（local 模式行为不变，api 模式连通）。

## 五、验收标准

- local 模式：现有功能、守卫、Data Center、全部测试与现状完全一致。
- api 模式：登录 → 静默刷新 → 增/改/删/列表闭环；401 自动刷新；409 冲突有提示；无授权访问被拒。
- 无意外改动：diff 仅限本计划范围；`git diff --check` 通过。
