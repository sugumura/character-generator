import { Authenticator } from '@aws-amplify/ui-react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import CharacterDetail from './pages/CharacterDetail';
import RelationshipMap from './pages/RelationshipMap';

export default function App() {
  return (
    <Authenticator>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/characters/:characterId" element={<CharacterDetail />} />
          <Route path="/projects/:projectId/relationships" element={<RelationshipMap />} />
        </Routes>
      </BrowserRouter>
    </Authenticator>
  );
}
