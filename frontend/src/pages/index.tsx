import { useEffect } from 'react';
import { useNavigate } from '@umijs/max';

export default function IndexPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/projects/1', { replace: true });
  }, [navigate]);
  return null;
}
