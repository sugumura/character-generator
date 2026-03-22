import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchAuthSession } from "aws-amplify/auth";
import type { Character, Relationship, RelationshipType } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const RELATIONSHIP_TYPES: RelationshipType[] = ["仲間", "ライバル", "師弟", "恋人", "家族", "敵対"];

const SVG_WIDTH = 600;
const SVG_HEIGHT = 500;
const CX = SVG_WIDTH / 2;
const CY = SVG_HEIGHT / 2;
const RADIUS = 180;
const NODE_R = 28;

function nodeLabel(c: Character): string {
  const parts = [c.species, c.occupation].filter(Boolean);
  return parts.length > 0 ? parts.join("/") : c.characterId.slice(0, 8);
}

function nodePositions(characters: Character[]): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  const n = characters.length;
  characters.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    map.set(c.characterId, {
      x: CX + RADIUS * Math.cos(angle),
      y: CY + RADIUS * Math.sin(angle),
    });
  });
  return map;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString();
  return { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" };
}

export default function RelationshipMap() {
  const { projectId } = useParams<{ projectId: string }>();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [charA, setCharA] = useState("");
  const [charB, setCharB] = useState("");
  const [relType, setRelType] = useState<RelationshipType>("仲間");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const headers = await authHeaders();
      const [cRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/projects/${projectId}/characters`, { headers }),
        fetch(`${API_BASE}/projects/${projectId}/relationships`, { headers }),
      ]);
      if (!cRes.ok) throw new Error("キャラクターの取得に失敗しました");
      if (!rRes.ok) throw new Error("関係性の取得に失敗しました");
      const chars: Character[] = await cRes.json();
      const rels: Relationship[] = await rRes.json();
      setCharacters(chars);
      // deduplicate by relationshipId
      const seen = new Set<string>();
      const unique = rels.filter((r) => {
        if (seen.has(r.relationshipId)) return false;
        seen.add(r.relationshipId);
        return true;
      });
      setRelationships(unique);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) fetchData();
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!charA || !charB || charA === charB) {
      setFormError("異なるキャラクターを選択してください");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/projects/${projectId}/relationships`, {
        method: "POST",
        headers,
        body: JSON.stringify({ characterIdA: charA, characterIdB: charB, relationshipType: relType, description }),
      });
      if (!res.ok) throw new Error("関係性の作成に失敗しました");
      setCharA("");
      setCharB("");
      setRelType("仲間");
      setDescription("");
      await fetchData();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (relationshipId: string) => {
    if (!confirm("この関係性を削除しますか？")) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/projects/${projectId}/relationships/${relationshipId}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error("削除に失敗しました");
      await fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除エラー");
    }
  };

  if (loading) return <p>読み込み中...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;

  const positions = nodePositions(characters);
  const charMap = new Map(characters.map((c) => [c.characterId, c]));

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h2>関係性マップ</h2>

      {/* SVG Network Graph */}
      <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", marginBottom: 32 }}>
        {characters.length === 0 ? (
          <p style={{ padding: 24, color: "#888", textAlign: "center" }}>キャラクターがいません</p>
        ) : (
          <svg width={SVG_WIDTH} height={SVG_HEIGHT} style={{ display: "block" }}>
            {/* Relationship lines */}
            {relationships.map((rel) => {
              const posA = positions.get(rel.characterIdA);
              const posB = positions.get(rel.characterIdB);
              if (!posA || !posB) return null;
              const mx = (posA.x + posB.x) / 2;
              const my = (posA.y + posB.y) / 2;
              return (
                <g key={rel.relationshipId}>
                  <line
                    x1={posA.x} y1={posA.y}
                    x2={posB.x} y2={posB.y}
                    stroke="#999" strokeWidth={2}
                  />
                  <text
                    x={mx} y={my - 4}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#555"
                    style={{ pointerEvents: "none" }}
                  >
                    {rel.relationshipType}
                  </text>
                </g>
              );
            })}

            {/* Character nodes */}
            {characters.map((c) => {
              const pos = positions.get(c.characterId);
              if (!pos) return null;
              const label = nodeLabel(c);
              return (
                <g key={c.characterId}>
                  <circle cx={pos.x} cy={pos.y} r={NODE_R} fill="#4a90d9" stroke="#2c5f8a" strokeWidth={2} />
                  <text
                    x={pos.x} y={pos.y + 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#fff"
                    style={{ pointerEvents: "none" }}
                  >
                    {label.length > 8 ? label.slice(0, 8) + "…" : label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Create Relationship Form */}
      <section style={{ marginBottom: 32 }}>
        <h3>関係性を追加</h3>
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>キャラクターA</label>
              <select value={charA} onChange={(e) => setCharA(e.target.value)} style={{ width: "100%" }} required>
                <option value="">選択してください</option>
                {characters.map((c) => (
                  <option key={c.characterId} value={c.characterId}>{nodeLabel(c)}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>キャラクターB</label>
              <select value={charB} onChange={(e) => setCharB(e.target.value)} style={{ width: "100%" }} required>
                <option value="">選択してください</option>
                {characters.map((c) => (
                  <option key={c.characterId} value={c.characterId}>{nodeLabel(c)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>関係性タイプ</label>
            <select value={relType} onChange={(e) => setRelType(e.target.value as RelationshipType)} style={{ width: "100%" }}>
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>説明</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="関係性の説明（任意）"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          {formError && <p style={{ color: "red", margin: 0, fontSize: 13 }}>{formError}</p>}

          <button type="submit" disabled={submitting} style={{ alignSelf: "flex-start" }}>
            {submitting ? "追加中..." : "追加"}
          </button>
        </form>
      </section>

      {/* Relationship List */}
      <section>
        <h3>関係性一覧</h3>
        {relationships.length === 0 ? (
          <p style={{ color: "#888" }}>関係性がまだありません</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>キャラクターA</th>
                <th style={{ padding: "8px 12px" }}>キャラクターB</th>
                <th style={{ padding: "8px 12px" }}>タイプ</th>
                <th style={{ padding: "8px 12px" }}>説明</th>
                <th style={{ padding: "8px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {relationships.map((rel) => {
                const cA = charMap.get(rel.characterIdA);
                const cB = charMap.get(rel.characterIdB);
                return (
                  <tr key={rel.relationshipId} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "8px 12px" }}>{cA ? nodeLabel(cA) : rel.characterIdA.slice(0, 8)}</td>
                    <td style={{ padding: "8px 12px" }}>{cB ? nodeLabel(cB) : rel.characterIdB.slice(0, 8)}</td>
                    <td style={{ padding: "8px 12px" }}>{rel.relationshipType}</td>
                    <td style={{ padding: "8px 12px" }}>{rel.description}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <button onClick={() => handleDelete(rel.relationshipId)} style={{ color: "red", background: "none", border: "1px solid red", borderRadius: 4, cursor: "pointer", padding: "2px 8px" }}>
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
