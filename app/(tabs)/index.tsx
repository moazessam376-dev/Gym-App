// Home tab. Content is driven by the role from the verified JWT — each role gets
// its own dashboard. The redirect guard (app/_layout.tsx) ensures a role exists.
import { useAuth } from '../../src/lib/auth-context';
import ClientHome from '../../src/components/home/ClientHome';
import CoachHome from '../../src/components/home/CoachHome';
import AdminHome from '../../src/components/home/AdminHome';

export default function Home() {
  const { role } = useAuth();
  if (role === 'coach') return <CoachHome />;
  if (role === 'admin') return <AdminHome />;
  return <ClientHome />;
}
