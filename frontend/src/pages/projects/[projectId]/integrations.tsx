import { BranchesOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { PageHeader } from '@/components/common';

export default function IntegrationsPage() {
  return <>
    <PageHeader eyebrow="PROJECT CONNECTIONS" title="集成" copy="查看项目可用的自动化连接能力。" />
    <section className="integration-grid">
      <div className="panel integration-card">
        <div className="integration-icon"><BranchesOutlined style={{ fontSize: 22 }} /></div>
        <div className="integration-copy">
          <div><h2>GitHub</h2><span className="status-pill planning">MVP-2</span></div>
          <p>提交、Pull Request 与任务进度自动关联。</p>
          <small>连接能力将在 MVP-2 提供，当前不会伪造 OAuth 或已连接状态。</small>
        </div>
        <button className="ghost-btn" disabled title="GitHub 集成将在 MVP-2 提供">连接 GitHub</button>
      </div>
      <div className="panel manual-card">
        <ThunderboltOutlined style={{ fontSize: 18 }} />
        <div><b>手动更新仍然可用</b><p>你可以继续通过看板、Backlog 和范围时间线管理任务与进度。</p></div>
      </div>
    </section>
  </>;
}
