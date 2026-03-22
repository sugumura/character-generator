import { useAuthenticator } from '@aws-amplify/ui-react';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { signInWithRedirect, getCurrentUser } from 'aws-amplify/auth';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import CharacterDetail from './pages/CharacterDetail';
import RelationshipMap from './pages/RelationshipMap';

function GoogleLoginPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
      <h1>Character Generator</h1>
      <button onClick={() => signInWithRedirect({ provider: 'Google' })} style={{ padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}>
        Googleでログイン
      </button>
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { authStatus } = useAuthenticator();

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      getCurrentUser().catch(() => {});
    }
  }, [authStatus]);

  if (authStatus === 'configuring') return null;
  if (authStatus !== 'authenticated') return <GoogleLoginPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthGuard>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/characters/:characterId" element={<CharacterDetail />} />
          <Route path="/projects/:projectId/relationships" element={<RelationshipMap />} />
        </Routes>
      </BrowserRouter>
    </AuthGuard>
  );
}
