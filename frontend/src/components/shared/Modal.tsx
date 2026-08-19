import { Modal as AntModal } from "antd";
import type React from "react";

export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <AntModal open title={title} footer={null} onCancel={close} destroyOnHidden>
      {children}
    </AntModal>
  );
}
