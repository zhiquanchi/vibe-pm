import { DashboardOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from '@umijs/max';
import { useAppContext } from '@/layouts/MainLayout';

export default function NotFound() {
  const ctx = useAppContext();
  const navigate = useNavigate();
  return (
    <div className="not-found">
      <div className="brand">
        <div className="brand-mark"><ThunderboltOutlined style={{ fontSize: 16, color: 'currentColor' }} /></div>
        vibe<span className="brand-accent">pm</span>
      </div>
      <div className="not-found-card">
        <b>404</b>
        <h1>页面不存在</h1>
        <p>这个地址没有对应的项目页面。</p>
        <button className="primary-btn" onClick={() => navigate(`/projects/${ctx.projectId}`)}><DashboardOutlined style={{ fontSize: 15 }} /> 返回总览</button>
      </div>
    </div>
  );
}
