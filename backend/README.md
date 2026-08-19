# 启咨（Qizī）Backend

启咨后端：FastAPI + SQLite 实现的开发项目管理 API，覆盖项目成员权限、开发阶段、阶段任务、任务依赖与阻塞，以及遗留的 Sprint / 范围变更兼容端点。

> 环境变量名（`VIBE_PM_*`）与日志路径沿用仓库代码名 `vibe-pm`，不影响品牌名「启咨」。

## 目录结构

- `app/main.py`：应用工厂、生命周期与中间件
- `app/routers/api.py`：HTTP 端点与状态码
- `app/routers/projects.py` + `app/services/projects.py`：项目成员管理、角色调整、移除校验与活动记录
- `app/routers/stages.py` + `app/services/stages.py`：项目阶段模板、结构管理、阶段负责人分配、主阶段规则与活动记录
- `app/routers/tasks.py` + `app/services/tasks.py`：基于阶段的阶段任务管理（阶段内创建/编辑/推进、在未完成阶段间移动、带依赖守卫的删除、状态流转校验、跨项目「我的任务」列表），以及任务依赖/阻塞管理（带循环检测的前置依赖、任务与阶段阻塞的解除/确认流程）与活动记录
- `app/schemas/`：Pydantic 请求校验
- `app/db/models.py`：全部数据表的 SQLAlchemy ORM 模型
- `app/db/database.py`：引擎/会话工厂、schema 初始化、演示种子数据与快照 upsert
- `app/core/config.py`：环境变量驱动的数据库路径与 CORS 配置

## 依赖管理

依赖通过 [uv](https://docs.astral.sh/uv/) 由 `pyproject.toml` + `uv.lock` 管理。schema 初始化器是幂等的，启动时会创建索引。设置 `VIBE_PM_DB_PATH` 可使用其他 SQLite 文件（例如测试中的临时文件），设置 `VIBE_PM_CORS_ORIGINS` 可提供逗号分隔的允许来源列表。

## 日志

应用日志使用 [`loguru`](https://github.com/Delgan/loguru)，以 JSON 行（每行一个对象）输出到 `/var/log/vibe-pm/source/backend.log`，本机 Vector agent 尾随该文件并把采集到的流投递到 `/var/log/vibe-pm/backend.log`。行格式与本机其他服务（`bff/`、`archive-service/`）保持一致：

```json
{"time": "2026-08-13T12:00:00.123456+00:00", "level": "INFO", "correlation_id": "", "message": "...", "module": "uvicorn.server", "function": "_serve", "line": 83, "thread_id": 140123}
```

`source/backend.log` 有单一写入者（loguru）。Uvicorn 自身的访问/错误日志通过 `logging_config.json`（配合 `--log-config` 传入）桥接到 loguru，因此框架日志也经由 loguru 输出——只输出一次，同时写入文件（JSON）与 stderr（人类可读）。业务模块不得自行创建 `logging.getLogger(...)`，应改用 `from loguru import logger`。

```bash
uv sync
uv run uvicorn app.main:app --log-config logging_config.json --reload --port 8000

# 覆盖日志目录（默认 /var/log/vibe-pm）：
VIBE_PM_LOG_DIR=/path/to/logs uv run uvicorn app.main:app --log-config logging_config.json
```

导入 `app.main` 也会配置日志（即使不带 `--log-config` 也会生成文件日志）；`--log-config` 标志还会额外把 uvicorn 的框架日志路由到 loguru。

## 测试

```bash
# 在 backend/ 目录下执行
uv run pytest
```
