import { ApiError } from "../api";
import type { Sprint } from "../types";

export function formatDate(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
      }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
    : "-";
}

export function formatRange(sprint?: Sprint | null) {
  return sprint
    ? `${formatDate(sprint.start_date)} - ${formatDate(sprint.end_date)}`
    : "暂无日期";
}

export function formatDateTime(value?: string | null) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

export function errorText(error: unknown) {
  return error instanceof ApiError && error.status === 403
    ? "你没有访问该项目的权限"
    : error instanceof Error
      ? error.message
      : "请求失败，请稍后重试";
}

/** 按当前日期动态计算逾期天数（不足一天按一天计）。 */
export function overdueDays(date?: string | null) {
  if (!date) return 0;
  const end = new Date(`${date.slice(0, 10)}T23:59:59`).getTime();
  const diff = Date.now() - end;
  return diff > 0 ? Math.ceil(diff / 86400000) : 0;
}
