import { Statistic } from "antd";
import { Activity } from "lucide-react";

export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="metric">
      <div className={`metric-icon ${tone}`}>
        <Activity size={16} />
      </div>
      <Statistic
        title={label}
        value={value}
        styles={{
          content: { fontSize: 19, fontWeight: 600, color: "#1d2433" },
        }}
        suffix={<small>{note}</small>}
      />
    </div>
  );
}
