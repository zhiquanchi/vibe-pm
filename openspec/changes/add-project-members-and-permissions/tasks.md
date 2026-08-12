# Tasks: add-project-members-and-permissions

## 1. 数据模型与 Schema

- [ ] 1.1 扩展 `project_members.role` 支持 `observer`（ALTER TABLE 或迁移脚本）
- [ ] 1.2 新增 `backend/app/schemas/projects.py`：MemberCreate（role 可选 owner/member/observer）、MemberUpdate（role）
- [ ] 1.3 新增 `backend/app/schemas/stages.py`：StageOwnerRequest（owner_id）

## 2. 后端服务层

- [ ] 2.1 实现 `app/services/projects.py`：添加成员、调整角色、移除成员（owner 限定；项目负责人至少 2 人校验；移除检查阶段负责人和未完成任务）
- [ ] 2.2 实现 `app/services/stages.py`：分配/更换阶段负责人（owner 限定；启动前检查；更换时展示影响）
- [ ] 2.3 新增活动记录类型：`member_added`、`member_role_changed`、`member_removed`、`stage_owner_changed`

## 3. 后端路由

- [ ] 3.1 新增 `app/routers/projects.py`：`GET /api/projects/{id}/members`、`POST /api/projects/{id}/members`、`PATCH /api/projects/{id}/members/{user_id}`、`DELETE /api/projects/{id}/members/{user_id}`
- [ ] 3.2 新增 `app/routers/stages.py`：`PATCH /api/projects/{id}/stages/{sid}/owner`
- [ ] 3.3 扩展 `app/routers/projects.py` 的 `create_project` 支持可选 members 参数（向后兼容）

## 4. 后端测试

- [ ] 4.1 `backend/tests/test_projects.py`：添加成员、调整角色、移除成员、项目负责人至少 2 人校验（spec 场景 1.x、3.x）
- [ ] 4.2 `backend/tests/test_stages.py`：分配阶段负责人、更换负责人、启动前检查（spec 场景 4.x）
- [ ] 4.3 `backend/tests/test_permissions.py`：服务端权限校验测试（spec 场景 5.x）
- [ ] 4.4 回归：`uv run pytest` 全部通过

## 5. 前端

- [ ] 5.1 `/projects/:projectId/members` 成员列表页：展示用户标识、项目角色、加入时间，owner 可添加/调整/移除
- [ ] 5.2 阶段列表页扩展：展示阶段负责人，owner 可分配/更换
- [ ] 5.3 前端构建通过（`npm run build`），浏览器手工验证添加成员、调整角色、移除成员、阶段负责人分配

## 6. 收尾

- [ ] 6.1 更新 `backend/README.md` 结构说明（新增 projects/stages 路由/服务）
- [ ] 6.2 `openspec validate add-project-members-and-permissions` 通过