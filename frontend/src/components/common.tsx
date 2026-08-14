import { Alert, Button, Empty, Modal as AntModal, Statistic } from 'antd';
import { DotChartOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  copy,
  actions,
}: {
  eyebrow?: string;
  title: string;
  copy?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {copy && <p>{copy}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
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

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <Alert
      className="page-alert"
      type="error"
      showIcon
      title={message}
      action={
        <Button size="small" onClick={retry} icon={<ReloadOutlined />}>
          重试
        </Button>
      }
    />
  );
}

export function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className="metric">
      <div className={`metric-icon ${tone}`}>
        <DotChartOutlined style={{ fontSize: 16 }} />
      </div>
      <Statistic
        title={label}
        value={value}
        styles={{ content: { fontSize: 19, fontWeight: 600, color: '#1d2433' } }}
        suffix={<small>{note}</small>}
      />
    </div>
  );
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return (
    <AntModal open title={title} footer={null} onCancel={close} destroyOnClose>
      {children}
    </AntModal>
  );
}
