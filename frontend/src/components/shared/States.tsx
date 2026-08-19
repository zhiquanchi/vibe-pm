import { Alert, Button as AntButton, Empty } from "antd";
import { RefreshCw } from "lucide-react";
import type React from "react";

export function LoadingState() {
  return (
    <div className="state-panel">
      <RefreshCw className="spin" size={20} />
      <b>正在加载项目数据…</b>
    </div>
  );
}

export function EmptyState({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <>
            <b>{title}</b>
            <p>{copy}</p>
          </>
        }
      />
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <Alert
      className="page-alert"
      type="error"
      showIcon
      title={message}
      action={
        <AntButton size="small" onClick={retry} icon={<RefreshCw size={14} />}>
          重试
        </AntButton>
      }
    />
  );
}
