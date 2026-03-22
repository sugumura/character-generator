import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchAuthSession } from "aws-amplify/auth";
import { usePolling } from "../hooks/usePolling";
import CharacterCard from "../components/CharacterCard";
import type { Project } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [editingWorld, setEditingWorld] = useState(false);
  const [worldSettingDraft, setWorldSettingDraft] = useState("");
  const [savingWorld, setSavingWorld] = useState(false);

  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const { characters, isPolling } = usePolling(projectId ?? "", API_BASE_URL);

  // Fetch project details
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        const res = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error("Failed to fetch project");
        const data: Project = await res.json();
        setProject(data);
        setWorldSettingDraft(data.worldSetting);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingProject(false);
      }
    })();
  }, [projectId]);

  const handleSaveWorldSetting = async () => {
    if (!projectId || !project) return;
    setSavingWorld(true);
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      const res = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ worldSetting: worldSettingDraft }),
      });
      if (!res.ok) throw new Error("Failed to update");
      const updated: Project = await res.json();
      setProject(updated);
      setEditingWorld(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingWorld(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      const res = await fetch(`${API_BASE_URL}/projects/${projectId}/characters/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ count }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? "生成に失敗しました");
      }
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  if (loadingProject) return <p>読み込み中...</p>;
  if (!project) return <p>プロジェクトが見つかりません</p>;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>{project.projectName}</h1>

      {/* World Setting */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18 }}>世界設定</h2>
        {editingWorld ? (
          <div>
            <textarea
              value={worldSettingDraft}
              onChange={(e) => setWorldSettingDraft(e.target.value)}
              rows={5}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button onClick={handleSaveWorldSetting} disabled={savingWorld}>
                {savingWorld ? "保存中..." : "保存"}
              </button>
              <button
                onClick={() => {
                  setEditingWorld(false);
                  setWorldSettingDraft(project.worldSetting);
                }}
                disabled={savingWorld}
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ whiteSpace: "pre-wrap" }}>{project.worldSetting || "（未設定）"}</p>
            <button onClick={() => setEditingWorld(true)}>編集</button>
          </div>
        )}
      </section>

      {/* Generate Form */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18 }}>キャラクター生成</h2>
        <form onSubmit={handleGenerate} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label>
            生成数:
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              style={{ width: 60, marginLeft: 8 }}
            />
          </label>
          <button type="submit" disabled={generating}>
            {generating ? "生成中..." : "生成する"}
          </button>
        </form>
        {generateError && <p style={{ color: "red", marginTop: 8 }}>{generateError}</p>}
      </section>

      {/* Relationship Map Link */}
      <section style={{ marginBottom: 32 }}>
        <button onClick={() => navigate(`/projects/${projectId}/relationships`)}>
          関係性マップを見る
        </button>
      </section>

      {/* Character List */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>キャラクター一覧</h2>
          {isPolling && <span style={{ fontSize: 12, color: "#f0a500" }}>● 更新中...</span>}
        </div>
        {characters.length === 0 ? (
          <p style={{ color: "#888" }}>キャラクターがまだいません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {characters.map((c) => (
              <CharacterCard
                key={c.characterId}
                character={c}
                onClick={() =>
                  navigate(`/projects/${projectId}/characters/${c.characterId}`)
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
