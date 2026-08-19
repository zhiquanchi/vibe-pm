import type React from "react";

export function PageHeader({
  eyebrow,
  title,
  copy,
  actions,
}: {
  eyebrow?: string;
  title: string;
  copy?: string;
  actions?: React.ReactNode;
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
