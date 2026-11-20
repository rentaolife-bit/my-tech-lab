# My Tech Lab Backend

FastAPI 模块化单体 + PostgreSQL。整体架构与数据契约见仓库根目录的 `ARCHITECTURE.md` 与 `docs/unified-data-foundation-design.md`。

## 本地开发

1. 安装 Python 3.12+ 与 PostgreSQL 16+。
2. 创建虚拟环境：`python3.12 -m venv .venv && source .venv/bin/activate`
3. 安装依赖：`pip install -e ".[dev]"`
4. 配置环境：`cp .env.example .env` 并填写真实的 `DATABASE_URL`。
5. 建库：`alembic upgrade head`
6. 初始化 Owner：`bootstrap-owner --email 你的邮箱`
7. 启动服务：`uvicorn app.main:app --reload`
8. 健康检查：`GET /api/v1/health`

## 约定

- 数据库迁移一律用 Alembic，禁止手改已应用的历史迁移。
- 业务表启用 `deleted_at` 软删除；系统表（`users` / `auth_identities` / `migration_batches`）与单行配置表（`user_preferences`）不启用。
- API Key、数据库密码等 Secret 只经环境变量注入，不进仓库、不进前端。
- 所有业务 API 必须认证；认证接口在后续阶段实现。
