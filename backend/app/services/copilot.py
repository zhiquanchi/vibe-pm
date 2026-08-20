from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Profile,
    Project,
    ProjectActivity,
    ProjectMember,
    Stage,
    StageBlocker,
    Task,
    TaskBlocker,
    TaskDependency,
)


STAGE_STATUS_LABELS = {
    "planned": "未开始",
    "active": "进行中",
    "blocked": "受阻",
    "pending_acceptance": "待验收",
    "completed": "已完成",
}
TASK_STATUS_LABELS = {
    "todo": "未开始",
    "in_progress": "进行中",
    "blocked": "受阻",
    "pending_verification": "待确认",
    "done": "已完成",
    "in_review": "评审中",
}
RANGE_HOURS = {"24h": 24, "7d": 24 * 7, "30d": 24 * 30}


def _item(
    kind: str,
    text: str,
    link_path: str | None = None,
    link_label: str | None = None,
) -> dict:
    return {
        "kind": kind,
        "text": text,
        "link_path": link_path,
        "link_label": link_label,
    }


def _fact(text: str, link_path: str | None = None, link_label: str | None = None) -> dict:
    return _item("fact", text, link_path, link_label)


def _inference(text: str) -> dict:
    return _item("inference", text)


def _suggestion(text: str, link_path: str | None = None) -> dict:
    return _item("suggestion", f"{text}（需要您确认执行）", link_path, "查看对象")


def _stage_path(project_id: int, stage_id: int | None) -> str | None:
    return f"/projects/{project_id}/stages/{stage_id}" if stage_id is not None else None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _days_since(value: str | None, now: datetime) -> int | None:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    return max((now.date() - parsed.date()).days, 0)


def _overdue_days(value: str | None, today: date) -> int | None:
    parsed = _parse_date(value)
    if parsed is None or parsed >= today:
        return None
    return (today - parsed).days


def _project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _stage_or_404(session: Session, project_id: int, stage_id: int) -> Stage:
    stage = session.get(Stage, stage_id)
    if stage is None or stage.project_id != project_id:
        raise HTTPException(status_code=404, detail="Stage not found")
    return stage


def _profiles(session: Session, user_ids: Iterable[str | None]) -> dict[str, str]:
    ids = {user_id for user_id in user_ids if user_id}
    rows = session.scalars(select(Profile).where(Profile.id.in_(ids))).all() if ids else []
    return {row.id: row.name for row in rows}


def _display_name(profiles: dict[str, str], user_id: str | None) -> str | None:
    return profiles.get(user_id or "", user_id)


def _tasks_by_id(tasks: Iterable[Task]) -> dict[int, Task]:
    return {task.id: task for task in tasks}


def _unresolved_dependencies(
    project_tasks: Iterable[Task], dependencies: Iterable[TaskDependency]
) -> list[tuple[TaskDependency, Task, Task]]:
    by_id = _tasks_by_id(project_tasks)
    result: list[tuple[TaskDependency, Task, Task]] = []
    for link in dependencies:
        dependent = by_id.get(link.task_id)
        dependency = by_id.get(link.dependency_id)
        if dependent is None or dependency is None or dependency.status == "done":
            continue
        result.append((link, dependent, dependency))
    return result

def _stage_brief(
    stage: Stage,
    owner_name: str | None,
    tasks: Iterable[Task],
) -> dict:
    stage_tasks = list(tasks)
    done = sum(task.status == "done" for task in stage_tasks)
    return {
        "name": stage.name,
        "status": stage.status,
        "owner_name": owner_name,
        "total_tasks": len(stage_tasks),
        "done_tasks": done,
        "progress": round(done / len(stage_tasks), 2) if stage_tasks else None,
    }


def generate_summary(session: Session, project_id: int) -> dict:
    """Generate a deterministic, real-time project summary from project records."""
    now = datetime.utcnow()
    today = now.date()
    project = _project_or_404(session, project_id)
    stages = session.scalars(
        select(Stage).where(Stage.project_id == project_id).order_by(Stage.position, Stage.id)
    ).all()
    tasks = session.scalars(select(Task).where(Task.project_id == project_id).order_by(Task.id)).all()
    dependencies = session.scalars(
        select(TaskDependency)
        .join(Task, Task.id == TaskDependency.task_id)
        .where(Task.project_id == project_id)
        .order_by(TaskDependency.id)
    ).all()
    task_blockers = session.scalars(
        select(TaskBlocker)
        .join(Task, Task.id == TaskBlocker.task_id)
        .where(Task.project_id == project_id, TaskBlocker.resolved_at.is_(None))
        .order_by(TaskBlocker.id)
    ).all()
    stage_blockers = session.scalars(
        select(StageBlocker)
        .where(StageBlocker.stage_id.in_([stage.id for stage in stages]), StageBlocker.resolved_at.is_(None))
        .order_by(StageBlocker.id)
    ).all() if stages else []
    profiles = _profiles(
        session,
        [stage.owner_id for stage in stages]
        + [blocker.handler_id for blocker in task_blockers + stage_blockers],
    )
    task_by_id = _tasks_by_id(tasks)

    primary = next((stage for stage in stages if stage.is_primary), None)
    parallel = [stage for stage in stages if stage.status == "active" and stage.id != (primary.id if primary else None)]
    primary_tasks = [task for task in tasks if primary and task.stage_id == primary.id]
    primary_brief = _stage_brief(primary, _display_name(profiles, primary.owner_id), primary_tasks) if primary else None
    parallel_briefs = [
        _stage_brief(
            stage,
            _display_name(profiles, stage.owner_id),
            [task for task in tasks if task.stage_id == stage.id],
        )
        for stage in parallel
    ]

    if not primary and not parallel and not tasks:
        return {
            "project_name": project.name,
            "project_description": project.description,
            "primary_stage": None,
            "parallel_stages": [],
            "risks": [
                _fact(
                    "项目尚未启动，数据不足",
                    f"/projects/{project_id}/stages",
                    "查看阶段",
                )
            ],
            "actions": [],
            "insufficient_data": True,
        }

    risks: list[dict] = []
    if primary:
        progress = "无任务" if primary_brief["progress"] is None else f"{primary_brief['done_tasks']}/{primary_brief['total_tasks']} 任务完成"
        risks.append(
            _fact(
                f"主阶段「{primary.name}」状态为{STAGE_STATUS_LABELS.get(primary.status, primary.status)}，{progress}",
                _stage_path(project_id, primary.id),
                "查看主阶段",
            )
        )

    for blocker in stage_blockers:
        stage = next((item for item in stages if item.id == blocker.stage_id), None)
        duration = _days_since(blocker.created_at, now)
        handler = _display_name(profiles, blocker.handler_id)
        risks.append(
            _fact(
                f"阶段「{stage.name if stage else blocker.stage_id}」未解除阻塞：{blocker.reason}"
                f"（处理人：{handler or '未指定'}，持续 {duration if duration is not None else '未知'} 天）",
                _stage_path(project_id, blocker.stage_id),
                "查看阻塞阶段",
            )
        )
    for blocker in task_blockers:
        task = task_by_id.get(blocker.task_id)
        duration = _days_since(blocker.created_at, now)
        handler = _display_name(profiles, blocker.handler_id)
        risks.append(
            _fact(
                f"任务「{task.title if task else blocker.task_id}」未解除阻塞：{blocker.reason}"
                f"（处理人：{handler or '未指定'}，持续 {duration if duration is not None else '未知'} 天）",
                _stage_path(project_id, task.stage_id if task else None),
                "查看受阻任务",
            )
        )
    for stage in stages:
        overdue = _overdue_days(stage.planned_end, today)
        if stage.status not in ("completed", "planned") and overdue is not None:
            risks.append(
                _fact(
                    f"阶段「{stage.name}」已逾期 {overdue} 天",
                    _stage_path(project_id, stage.id),
                    "查看逾期阶段",
                )
            )
    for task in tasks:
        overdue = _overdue_days(task.planned_date, today)
        if task.status != "done" and overdue is not None:
            risks.append(
                _fact(
                    f"任务「{task.title}」已逾期 {overdue} 天",
                    _stage_path(project_id, task.stage_id),
                    "查看逾期任务",
                )
            )
    for _link, dependent, dependency in _unresolved_dependencies(tasks, dependencies):
        risks.append(
            _fact(
                f"任务「{dependent.title}」仍等待未完成前置任务「{dependency.title}」",
                _stage_path(project_id, dependent.stage_id),
                "查看依赖",
            )
        )
    for stage in stages:
        if stage.status == "pending_acceptance":
            risks.append(
                _fact(
                    f"阶段「{stage.name}」待验收",
                    _stage_path(project_id, stage.id),
                    "查看待验收阶段",
                )
            )

    if not risks:
        risks.append(_fact("当前未发现项目记录支持的风险", f"/projects/{project_id}", "查看项目"))

    actions: list[dict] = []
    for risk in risks:
        if len(actions) >= 5:
            break
        if "未解除阻塞" in risk["text"]:
            action = "优先跟进未解除阻塞，确认处理方案"
        elif "已逾期" in risk["text"]:
            action = "核对逾期事项计划并确认新的处理节奏"
        elif "等待未完成前置" in risk["text"]:
            action = "推进前置任务或重新确认依赖关系"
        elif "待验收" in risk["text"]:
            action = "核对验收条件并安排验收确认"
        else:
            continue
        actions.append(
            {
                "order": len(actions) + 1,
                "text": action,
                "reason": f"项目记录显示：{risk['text']}",
                "link_path": risk["link_path"],
            }
        )

    return {
        "project_name": project.name,
        "project_description": project.description,
        "primary_stage": primary_brief,
        "parallel_stages": parallel_briefs,
        "risks": risks,
        "actions": actions,
        "insufficient_data": False,
    }


def analyze_stage(session: Session, project_id: int, stage_id: int) -> dict:
    """Analyze recorded stage facts and derive labelled inferences and suggestions."""
    now = datetime.utcnow()
    today = now.date()
    project = _project_or_404(session, project_id)
    stage = _stage_or_404(session, project_id, stage_id)
    tasks = session.scalars(
        select(Task).where(Task.stage_id == stage_id).order_by(Task.position, Task.id)
    ).all()
    task_ids = [task.id for task in tasks]
    dependencies = (
        session.scalars(
            select(TaskDependency)
            .where(TaskDependency.task_id.in_(task_ids))
            .order_by(TaskDependency.id)
        ).all()
        if task_ids
        else []
    )
    all_project_tasks = session.scalars(select(Task).where(Task.project_id == project_id)).all()
    dependency_gaps = _unresolved_dependencies(all_project_tasks, dependencies)
    task_blockers = (
        session.scalars(
            select(TaskBlocker)
            .where(TaskBlocker.task_id.in_(task_ids), TaskBlocker.resolved_at.is_(None))
            .order_by(TaskBlocker.id)
        ).all()
        if task_ids
        else []
    )
    stage_blockers = session.scalars(
        select(StageBlocker)
        .where(StageBlocker.stage_id == stage_id, StageBlocker.resolved_at.is_(None))
        .order_by(StageBlocker.id)
    ).all()
    profiles = _profiles(session, [stage.owner_id] + [item.handler_id for item in task_blockers + stage_blockers])
    task_by_id = _tasks_by_id(tasks)
    stage_link = _stage_path(project_id, stage_id)
    done_count = sum(task.status == "done" for task in tasks)

    items: list[dict] = [
        _fact(
            f"项目「{project.name}」阶段「{stage.name}」状态为{STAGE_STATUS_LABELS.get(stage.status, stage.status)}，"
            f"负责人为{_display_name(profiles, stage.owner_id) or '未指定'}，任务完成 {done_count}/{len(tasks)}",
            stage_link,
            "查看阶段",
        )
    ]
    concrete_risks: list[tuple[str, str, str | None]] = []
    for blocker in stage_blockers:
        duration = _days_since(blocker.created_at, now)
        text = f"阶段存在未解除阻塞：{blocker.reason}（处理人：{_display_name(profiles, blocker.handler_id) or '未指定'}，持续 {duration if duration is not None else '未知'} 天）"
        items.append(_fact(text, stage_link, "查看阻塞"))
        concrete_risks.append((text, "解除阻塞前，阶段推进会持续受限", "先确认阻塞解除条件并跟进处理人"))
    for blocker in task_blockers:
        task = task_by_id.get(blocker.task_id)
        duration = _days_since(blocker.created_at, now)
        text = f"任务「{task.title if task else blocker.task_id}」未解除阻塞：{blocker.reason}（处理人：{_display_name(profiles, blocker.handler_id) or '未指定'}，持续 {duration if duration is not None else '未知'} 天）"
        items.append(_fact(text, stage_link, "查看受阻任务"))
        concrete_risks.append((text, "受阻任务会拖慢阶段整体进度", "确认阻塞原因是否已具备解除条件"))
    for task in tasks:
        overdue = _overdue_days(task.planned_date, today)
        if task.status != "done" and overdue is not None:
            text = f"任务「{task.title}」已逾期 {overdue} 天"
            items.append(_fact(text, stage_link, "查看逾期任务"))
            concrete_risks.append((text, "逾期任务可能影响阶段计划达成", "核对任务计划日期和剩余工作量"))
    for _link, dependent, dependency in dependency_gaps:
        text = f"任务「{dependent.title}」等待未完成前置任务「{dependency.title}」"
        items.append(_fact(text, stage_link, "查看依赖"))
        concrete_risks.append((text, "前置任务未完成时，后续任务难以并行推进", "优先确认前置任务剩余工作"))
    for task in tasks:
        if task.status != "done" and not task.assignee:
            text = f"未完成任务「{task.title}」没有负责人"
            items.append(_fact(text, stage_link, "查看任务"))
            concrete_risks.append((text, "无人负责的任务容易处于等待状态", "为任务指定负责人"))
    if stage.status == "pending_acceptance":
        text = "阶段处于待验收状态"
        items.append(_fact(text, stage_link, "查看待验收阶段"))
        concrete_risks.append((text, "验收前需要确认所有验收条件", "逐项确认验收条件后再提交或确认验收"))

    if not stage.planned_end:
        items.append(_inference("阶段未设置计划结束日期，信息不足，无法判断是否逾期"))
    items.append(
        _inference("当前记录未包含必需任务、交付物或验收条件明细，信息不足，无法判断完整验收缺口")
    )

    if not concrete_risks:
        items.append(_fact("当前未发现该阶段的风险", stage_link, "查看阶段"))
    for fact, inference, suggestion in concrete_risks:
        items.append(_inference(f"推断：基于“{fact}”，{inference}"))
        items.append(_suggestion(suggestion, stage_link))

    return {"has_risk": bool(concrete_risks), "items": items}


def my_task_advice(session: Session, user_id: str) -> list[dict]:
    """Return prioritized advice for the caller's visible, unfinished tasks."""
    now = datetime.utcnow()
    today = now.date()
    member_project_ids = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
    rows = session.execute(
        select(Task, Project.name, Stage)
        .join(Project, Project.id == Task.project_id)
        .outerjoin(Stage, Stage.id == Task.stage_id)
        .where(Task.assignee == user_id)
        .where(Task.project_id.in_(member_project_ids))
        .where(Task.status != "done")
        .order_by(Task.id)
    ).all()
    task_ids = [task.id for task, _project_name, _stage in rows]
    blockers = (
        session.scalars(
            select(TaskBlocker)
            .where(TaskBlocker.task_id.in_(task_ids), TaskBlocker.resolved_at.is_(None))
            .order_by(TaskBlocker.id)
        ).all()
        if task_ids
        else []
    )
    blockers_by_task: dict[int, list[TaskBlocker]] = {}
    for blocker in blockers:
        blockers_by_task.setdefault(blocker.task_id, []).append(blocker)
    dependencies = (
        session.scalars(select(TaskDependency).where(TaskDependency.task_id.in_(task_ids))).all()
        if task_ids
        else []
    )
    dependencies_by_task: dict[int, list[TaskDependency]] = {}
    for link in dependencies:
        dependencies_by_task.setdefault(link.task_id, []).append(link)
    all_visible_tasks = {task.id: task for task, _name, _stage in rows}
    profiles = _profiles(session, [blocker.handler_id for blocker in blockers])

    advice: list[dict] = []
    for task, project_name, stage in rows:
        active_blockers = blockers_by_task.get(task.id, [])
        unfinished_dependencies = []
        for link in dependencies_by_task.get(task.id, []):
            dependency = all_visible_tasks.get(link.dependency_id) or session.get(Task, link.dependency_id)
            if dependency is not None and dependency.status != "done":
                unfinished_dependencies.append(dependency)
        overdue = _overdue_days(task.planned_date, today)
        is_primary = bool(stage and stage.is_primary)
        near_acceptance = bool(stage and stage.status == "pending_acceptance")
        if active_blockers:
            blocker = active_blockers[0]
            reason = (
                f"任务受阻：{blocker.reason}（处理人：{_display_name(profiles, blocker.handler_id) or '未指定'}）"
            )
        elif task.status == "blocked":
            reason = "任务处于受阻状态，当前记录中没有未解除阻塞明细"
        elif overdue is not None:
            reason = f"任务已逾期 {overdue} 天"
        elif unfinished_dependencies:
            titles = "、".join(dependency.title for dependency in unfinished_dependencies)
            reason = f"等待前置任务完成：{titles}"
        elif is_primary:
            reason = "该任务属于项目当前主推进方向"
        elif near_acceptance:
            reason = "所属阶段待验收，请确认验收条件"
        else:
            reason = "根据计划日期和当前状态排序"
        advice.append(
            {
                "task_id": task.id,
                "task_title": task.title,
                "reason": reason,
                "project_id": task.project_id,
                "project_name": project_name,
                "stage_id": task.stage_id,
                "stage_name": stage.name if stage else None,
                "link_path": _stage_path(task.project_id, task.stage_id) or "/my-tasks",
                "order": 0,
            }
        )

    def rank(item: dict) -> tuple[int, date]:
        task = next(row[0] for row in rows if row[0].id == item["task_id"])
        blocker_first = 0 if blockers_by_task.get(task.id) or task.status == "blocked" else 1
        overdue_first = 0 if _overdue_days(task.planned_date, today) is not None else 1
        primary_first = 0 if any(row[2] and row[2].is_primary for row in rows if row[0].id == task.id) else 1
        dependency_first = 0 if dependencies_by_task.get(task.id) else 1
        acceptance_first = 0 if any(row[2] and row[2].status == "pending_acceptance" for row in rows if row[0].id == task.id) else 1
        planned = _parse_date(task.planned_date) or date.max
        return (blocker_first, overdue_first, primary_first, dependency_first, acceptance_first, planned)

    advice.sort(key=rank)
    for index, item in enumerate(advice, start=1):
        item["order"] = index
    return advice


def _recent_user_question(history: list[dict]) -> str | None:
    for message in reversed(history):
        if message.get("role") == "user":
            return str(message.get("content", ""))
    return None


def _refuse_mutation(question: str) -> str | None:
    acceptance_verbs = ("确认", "通过", "驳回", "提交")
    if "验收" in question and any(word in question for word in acceptance_verbs):
        return "我无法代替您执行验收操作，验收需要由项目负责人确认"
    mutation_verbs = ("创建", "新增", "修改", "改为", "更新", "删除", "移动", "分配", "指派", "完成")
    imperative = question.startswith(("把", "将", "帮我", "请", "代替我", "自动"))
    if imperative and any(word in question for word in mutation_verbs):
        return "我无法自动修改项目数据，请您在任务详情中手动更新状态"
    return None


def _chat_link(project_id: int, path: str | None, label: str) -> dict[str, str]:
    return {"label": label, "path": path or f"/projects/{project_id}"}


def answer_project_question(
    session: Session, project_id: int, question: str, history: list[dict], user_id: str
) -> dict:
    """Answer narrowly scoped project-management questions from current records."""
    normalized = question.strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="问题不能为空")
    previous = _recent_user_question(history)
    if previous and (len(normalized) <= 4 or "它" in normalized or normalized in {"继续", "为什么"}):
        normalized = f"{previous} {normalized}"

    refusal = _refuse_mutation(normalized)
    if refusal is not None:
        return {"role": "assistant", "content": refusal, "links": None}

    project = _project_or_404(session, project_id)
    other_projects = session.scalars(select(Project).where(Project.id != project_id)).all()
    for other in other_projects:
        if other.name and other.name in normalized and session.get(ProjectMember, (other.id, user_id)) is None:
            return {
                "role": "assistant",
                "content": "您没有访问该项目的权限，无法回答",
                "links": None,
            }

    stages = session.scalars(
        select(Stage).where(Stage.project_id == project_id).order_by(Stage.position, Stage.id)
    ).all()
    tasks = session.scalars(select(Task).where(Task.project_id == project_id).order_by(Task.id)).all()
    matched_stages = sorted(
        (stage for stage in stages if stage.name and stage.name in normalized), key=lambda item: len(item.name), reverse=True
    )
    matched_tasks = sorted(
        (task for task in tasks if task.title and task.title in normalized), key=lambda item: len(item.title), reverse=True
    )
    project_terms = (
        "项目",
        "阶段",
        "任务",
        "依赖",
        "阻塞",
        "交付",
        "验收",
        "活动",
        "进展",
        "状态",
        "风险",
        "变化",
        "负责人",
        "计划",
    )
    if not any(term in normalized for term in project_terms) and not matched_stages and not matched_tasks:
        return {
            "role": "assistant",
            "content": "该问题超出项目管理副驾驶职责范围，无法回答",
            "links": None,
        }

    if matched_tasks and any(term in normalized for term in ("依赖", "阻塞", "前置")):
        task = matched_tasks[0]
        dependencies = session.scalars(
            select(TaskDependency).where(TaskDependency.task_id == task.id)
        ).all()
        blockers = session.scalars(
            select(TaskBlocker).where(TaskBlocker.task_id == task.id, TaskBlocker.resolved_at.is_(None))
        ).all()
        dependency_titles = []
        for link in dependencies:
            dependency = session.get(Task, link.dependency_id)
            if dependency is not None:
                dependency_titles.append(f"「{dependency.title}」（{TASK_STATUS_LABELS.get(dependency.status, dependency.status)}）")
        blocker_texts = [f"「{item.reason}」" for item in blockers]
        content = f"项目「{project.name}」任务「{task.title}」："
        content += f"前置依赖 {len(dependency_titles)} 个（{'、'.join(dependency_titles) or '无记录'}）；"
        content += f"未解除阻塞 {len(blockers)} 个（{'、'.join(blocker_texts) or '无'}）。"
        return {
            "role": "assistant",
            "content": content,
            "links": [_chat_link(project_id, _stage_path(project_id, task.stage_id), "查看任务所属阶段")],
        }

    if matched_stages and any(term in normalized for term in ("阶段", "进展", "状态", "如何", "情况")):
        stage = matched_stages[0]
        stage_tasks = [task for task in tasks if task.stage_id == stage.id]
        done = sum(task.status == "done" for task in stage_tasks)
        blocked = sum(task.status == "blocked" for task in stage_tasks)
        content = (
            f"项目「{project.name}」阶段「{stage.name}」当前为"
            f"{STAGE_STATUS_LABELS.get(stage.status, stage.status)}，任务完成 {done}/{len(stage_tasks)}，受阻任务 {blocked} 个。"
        )
        return {
            "role": "assistant",
            "content": content,
            "links": [_chat_link(project_id, _stage_path(project_id, stage.id), "查看阶段详情")],
        }

    if any(term in normalized for term in ("最近", "近期", "活动", "变化")):
        match = re.search(r"(\d+)\s*天", normalized)
        days = int(match.group(1)) if match else 3
        cutoff = datetime.utcnow() - timedelta(days=days)
        activities = [
            activity
            for activity in session.scalars(
                select(ProjectActivity)
                .where(ProjectActivity.project_id == project_id)
                .order_by(ProjectActivity.created_at.desc())
            ).all()
            if (_parse_datetime(activity.created_at) or datetime.min) >= cutoff
        ]
        if not activities:
            return {
                "role": "assistant",
                "content": f"项目记录中没有「{project.name}」最近 {days} 天的相关活动信息",
                "links": [_chat_link(project_id, f"/projects/{project_id}", "查看项目")],
            }
        descriptions = "；".join(activity.description for activity in activities[:5])
        return {
            "role": "assistant",
            "content": f"项目「{project.name}」最近 {days} 天共有 {len(activities)} 条活动：{descriptions}",
            "links": [_chat_link(project_id, f"/projects/{project_id}", "查看项目")],
        }

    # A question that names a specific task/stage but no such record exists is a
    # "no info" answer instead of falling through to the generic status summary.
    specific = re.search(r"(任务|阶段)\s*「?([^」\s]+)」?", normalized)
    if specific is not None and specific.group(2) not in {
        "状态", "进展", "如何", "情况", "怎么样", "都有", "列表", "数量",
        "多少", "类型", "变化", "活动", "风险", "逾期", "阻塞", "依赖", "验收", "交付",
    }:
        matches = matched_tasks if specific.group(1) == "任务" else matched_stages
        if not matches:
            return {
                "role": "assistant",
                "content": "项目记录中没有相关信息",
                "links": [_chat_link(project_id, f"/projects/{project_id}", "查看项目")],
            }

    if matched_tasks and any(term in normalized for term in ("状态", "进展", "情况", "如何", "怎么样", "完成")):
        task = matched_tasks[0]
        content = f"项目「{project.name}」任务「{task.title}」当前为{TASK_STATUS_LABELS.get(task.status, task.status)}。"
        return {
            "role": "assistant",
            "content": content,
            "links": [_chat_link(project_id, _stage_path(project_id, task.stage_id), "查看任务所属阶段")],
        }

    if any(term in normalized for term in ("状态", "进展", "情况", "如何", "怎么样")):
        primary = next((stage for stage in stages if stage.is_primary), None)
        parallel = [stage for stage in stages if stage.status == "active" and stage != primary]
        open_tasks = sum(task.status != "done" for task in tasks)
        blockers = sum(task.status == "blocked" for task in tasks)
        primary_text = (
            f"主阶段「{primary.name}」（{STAGE_STATUS_LABELS.get(primary.status, primary.status)}）"
            if primary
            else "暂无主阶段"
        )
        parallel_text = "、".join(stage.name for stage in parallel) or "无"
        content = (
            f"项目「{project.name}」当前有 {open_tasks} 个未完成任务、{blockers} 个受阻任务；"
            f"{primary_text}，并行阶段：{parallel_text}。"
        )
        return {
            "role": "assistant",
            "content": content,
            "links": [_chat_link(project_id, f"/projects/{project_id}", "查看项目总览")],
        }

    if any(term in normalized for term in ("交付", "验收")):
        pending = [stage for stage in stages if stage.status == "pending_acceptance"]
        if pending:
            names = "、".join(stage.name for stage in pending)
            return {
                "role": "assistant",
                "content": f"项目「{project.name}」当前待验收阶段：{names}；交付物明细在当前记录中不存在。",
                "links": [_chat_link(project_id, _stage_path(project_id, pending[0].id), "查看待验收阶段")],
            }
        return {
            "role": "assistant",
            "content": "项目记录中没有相关信息",
            "links": [_chat_link(project_id, f"/projects/{project_id}", "查看项目")],
        }

    return {
        "role": "assistant",
        "content": "项目记录中没有相关信息",
        "links": [_chat_link(project_id, f"/projects/{project_id}", "查看项目")],
    }


def _activity_link(
    activity: ProjectActivity,
    project_id: int,
    stages: list[Stage],
    tasks: list[Task],
) -> str:
    for stage in stages:
        if stage.name and stage.name in activity.description:
            return _stage_path(project_id, stage.id) or f"/projects/{project_id}"
    for task in tasks:
        if task.title and task.title in activity.description:
            return _stage_path(project_id, task.stage_id) or f"/projects/{project_id}"
    if activity.type.startswith("member_"):
        return f"/projects/{project_id}/members"
    return f"/projects/{project_id}"


def review_changes(session: Session, project_id: int, range_key: str) -> dict:
    """Review project activity and currently open risks in the requested range."""
    project = _project_or_404(session, project_id)
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=RANGE_HOURS[range_key])
    stages = session.scalars(select(Stage).where(Stage.project_id == project_id)).all()
    tasks = session.scalars(select(Task).where(Task.project_id == project_id)).all()
    activities = [
        activity
        for activity in session.scalars(
            select(ProjectActivity)
            .where(ProjectActivity.project_id == project_id)
            .order_by(ProjectActivity.created_at.desc())
        ).all()
        if cutoff <= (_parse_datetime(activity.created_at) or datetime.min) <= now
    ]

    completed: list[dict] = []
    unresolved: list[dict] = []
    new_risks: list[dict] = []
    blocker_created_types = {"task_blocker_created", "stage_blocker_created"}
    for activity in activities:
        deleted = "删除" in activity.description or activity.type.endswith("_deleted")
        link = None if deleted else _activity_link(activity, project_id, stages, tasks)
        if activity.type in blocker_created_types or activity.type in {"task_status_changed"} and "受阻" in activity.description:
            continue
        prefix = "已完成：" if not deleted else "对象已删除："
        completed.append(_fact(f"{prefix}{activity.description}", link, None if deleted else "查看记录"))

    task_by_id = _tasks_by_id(tasks)
    stage_by_id = {stage.id: stage for stage in stages}
    task_blockers = session.scalars(
        select(TaskBlocker).join(Task, Task.id == TaskBlocker.task_id).where(
            Task.project_id == project_id, TaskBlocker.resolved_at.is_(None)
        )
    ).all()
    stage_blockers = session.scalars(
        select(StageBlocker).where(StageBlocker.stage_id.in_(stage_by_id), StageBlocker.resolved_at.is_(None))
    ).all() if stage_by_id else []
    for blocker in task_blockers:
        task = task_by_id.get(blocker.task_id)
        link = _stage_path(project_id, task.stage_id if task else None)
        text = f"任务「{task.title if task else blocker.task_id}」阻塞待处理：{blocker.reason}"
        unresolved.append(_fact(f"仍未解决：{text}", link, "查看任务"))
        created = _parse_datetime(blocker.created_at)
        if created is not None and cutoff <= created <= now:
            new_risks.append(_fact(f"新出现风险：{text}", link, "查看任务"))
    for blocker in stage_blockers:
        link = _stage_path(project_id, blocker.stage_id)
        text = f"阶段「{stage_by_id[blocker.stage_id].name}」阻塞待处理：{blocker.reason}"
        unresolved.append(_fact(f"仍未解决：{text}", link, "查看阶段"))
        created = _parse_datetime(blocker.created_at)
        if created is not None and cutoff <= created <= now:
            new_risks.append(_fact(f"新出现风险：{text}", link, "查看阶段"))
    for task in tasks:
        planned = _parse_date(task.planned_date)
        if (
            task.status != "done"
            and planned is not None
            and cutoff.date() <= planned <= now.date()
            and planned < now.date()
        ):
            text = f"任务「{task.title}」逾期 {(now.date() - planned).days} 天"
            new_risks.append(_fact(f"新出现风险：{text}", _stage_path(project_id, task.stage_id), "查看任务"))
    for stage in stages:
        planned = _parse_date(stage.planned_end)
        if (
            stage.status not in ("completed", "planned")
            and planned is not None
            and cutoff.date() <= planned <= now.date()
            and planned < now.date()
        ):
            text = f"阶段「{stage.name}」逾期 {(now.date() - planned).days} 天"
            new_risks.append(_fact(f"新出现风险：{text}", _stage_path(project_id, stage.id), "查看阶段"))

    return {"completed": completed, "unresolved": unresolved, "new_risks": new_risks}
