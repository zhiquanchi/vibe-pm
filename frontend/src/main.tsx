import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from './context';
import { router } from './router';
import './styles.css';
import './backlog.css';
import './app-shell.css';
import './stages.css';
import './views.css';

createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    theme={{
      token: {
        colorPrimary: '#7056df',
        borderRadius: 7,
        colorBgLayout: '#f7f8fa',
        fontFamily: "'DM Sans', sans-serif",
      },
    }}
  >
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </ConfigProvider>,
);
