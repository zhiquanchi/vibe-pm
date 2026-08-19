import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Shield, Zap } from 'lucide-react';

/** 403 页：无项目访问权限。 */
export function PermissionDenied() {
  const navigate = useNavigate();
  return (
    <div className="not-found">
      <div className="brand">
        <div className="brand-mark">
          <Zap size={16} fill="currentColor" />
        </div>
        vibe<span className="brand-accent">pm</span>
      </div>
      <div className="not-found-card">
        <Shield size={34} color="#7056df" />
        <h1>无权限访问</h1>
        <p>你不是该项目成员，请联系项目 Owner。</p>
        <button className="primary-btn" onClick={() => navigate('/my-tasks')}>
          <LayoutDashboard size={15} /> 前往我的任务
        </button>
      </div>
    </div>
  );
}

/** 404 页：路由不存在。 */
export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="not-found">
      <div className="brand">
        <div className="brand-mark">
          <Zap size={16} fill="currentColor" />
        </div>
        vibe<span className="brand-accent">pm</span>
      </div>
      <div className="not-found-card">
        <b>404</b>
        <h1>页面不存在</h1>
        <p>这个地址没有对应的项目页面。</p>
        <button className="primary-btn" onClick={() => navigate('/my-tasks')}>
          <LayoutDashboard size={15} /> 前往我的任务
        </button>
      </div>
    </div>
  );
}
