import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Project } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [projectName, setProjectName] = useState('');
  const [worldSetting, setWorldSetting] = useState('');
  const [maxCharacters, setMaxCharacters] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function fetchProjects() {
    try {
      setLoading(true);
      setError(null);
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/projects`, { headers });
      if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`);
      const data: Project[] = await res.json();
      setProjects(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, worldSetting, maxCharacters }),
      });
      if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
      setProjectName('');
      setWorldSetting('');
      setMaxCharacters(10);
      await fetchProjects();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ marginBottom: 24 }}>プロジェクト一覧</h1>

      {/* Project list */}
      {loading && <p>読み込み中...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <p style={{ color: '#666' }}>プロジェクトがありません。</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginBottom: 40 }}>
        {projects.map((project) => (
          <div
            key={project.projectId}
            onClick={() => navigate(`/projects/${project.projectId}`)}
            style={{
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: 16,
              cursor: 'pointer',
              background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              transition: 'box-shadow 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)')}
          >
            <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>{project.projectName}</h2>
            <p style={{ fontSize: 14, color: '#555', margin: '0 0 12px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {project.worldSetting}
            </p>
            <p style={{ fontSize: 12, color: '#999', margin: 0 }}>
              作成日: {new Date(project.createdAt).toLocaleDateString('ja-JP')}
            </p>
          </div>
        ))}
      </div>

      {/* Create project form */}
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 24, background: '#fafafa' }}>
        <h2 style={{ marginTop: 0, marginBottom: 20 }}>新規プロジェクト作成</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              プロジェクト名 <span style={{ color: 'red' }}>*</span>
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              世界観設定 <span style={{ color: 'red' }}>*</span>
            </label>
            <textarea
              value={worldSetting}
              onChange={(e) => setWorldSetting(e.target.value)}
              required
              rows={3}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              最大キャラクター数
            </label>
            <input
              type="number"
              value={maxCharacters}
              onChange={(e) => setMaxCharacters(Number(e.target.value))}
              min={1}
              style={{ width: 120, padding: '8px 10px', borderRadius: 4, border: '1px solid #ccc' }}
            />
          </div>
          {formError && <p style={{ color: 'red', marginBottom: 12 }}>{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '10px 24px',
              background: '#0066cc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              fontSize: 15,
            }}
          >
            {submitting ? '作成中...' : '作成する'}
          </button>
        </form>
      </div>
    </div>
  );
}
