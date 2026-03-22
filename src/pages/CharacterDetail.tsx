import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchAuthSession } from "aws-amplify/auth";
import { Combobox } from "../components/Combobox";
import { ATTRIBUTE_OPTIONS } from "../constants/attributeOptions";
import type { Character } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const FIELD_LABELS: Record<string, string> = {
  gender: "性別",
  personality: "性格",
  age: "年齢",
  species: "種族",
  occupation: "職業",
  hairColor: "髪色",
  skinColor: "肌色",
};

const COMBOBOX_FIELDS = ["gender", "personality", "age", "species", "occupation", "hairColor", "skinColor"] as const;

export default function CharacterDetail() {
  const { projectId, characterId } = useParams<{ projectId: string; characterId: string }>();
  const [character, setCharacter] = useState<Character | null>(null);
  const [form, setForm] = useState<Partial<Character>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const fetchCharacter = async () => {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      const res = await fetch(`${API_BASE}/projects/${projectId}/characters/${characterId}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error("キャラクターの取得に失敗しました");
      const data: Character = await res.json();
      setCharacter(data);
      setForm({
        gender: data.gender,
        personality: data.personality,
        age: data.age,
        species: data.species,
        occupation: data.occupation,
        hairColor: data.hairColor,
        skinColor: data.skinColor,
        specialNotes: data.specialNotes,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCharacter();
  }, [projectId, characterId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      const res = await fetch(`${API_BASE}/projects/${projectId}/characters/${characterId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
      const updated: Character = await res.json();
      setCharacter(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存エラー");
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      const res = await fetch(`${API_BASE}/projects/${projectId}/characters/${characterId}/regenerate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error("再生成に失敗しました");
      const updated: Character = await res.json();
      setCharacter(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : "再生成エラー");
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) return <p>読み込み中...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!character) return null;

  const isGenerating = character.generationStatus === "pending" || character.generationStatus === "generating";
  const isFailed = character.generationStatus === "failed";
  const isCompleted = character.generationStatus === "completed";

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h2>キャラクター詳細</h2>

      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        {COMBOBOX_FIELDS.map((field) => (
          <div key={field} style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4 }}>{FIELD_LABELS[field]}</label>
            <Combobox
              options={[...ATTRIBUTE_OPTIONS[field]]}
              value={(form[field] as string) ?? ""}
              onChange={(val) => setForm((prev) => ({ ...prev, [field]: val }))}
              placeholder={FIELD_LABELS[field]}
            />
          </div>
        ))}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 4 }}>特記事項</label>
          <textarea
            value={form.specialNotes ?? ""}
            onChange={(e) => setForm((prev) => ({ ...prev, specialNotes: e.target.value }))}
            maxLength={200}
            placeholder="例: 左目に傷がある、常に仮面をつけている、王族の血を引く"
            rows={4}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <small>{(form.specialNotes ?? "").length}/200</small>
        </div>

        <button type="submit" disabled={saving} style={{ marginRight: 8 }}>
          {saving ? "保存中..." : "保存"}
        </button>

        {(isCompleted || isFailed) && (
          <button type="button" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? "再生成中..." : "再生成"}
          </button>
        )}
      </form>

      <div style={{ marginTop: 24 }}>
        <h3>バックグラウンドストーリー</h3>
        {isGenerating && (
          <p>⏳ 生成中です。しばらくお待ちください...</p>
        )}
        {isFailed && (
          <div>
            <p style={{ color: "red" }}>生成に失敗しました。再生成ボタンを押してください。</p>
          </div>
        )}
        {isCompleted && character.background && (
          <textarea
            readOnly
            value={character.background}
            rows={8}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        )}
        {isCompleted && !character.background && (
          <p>バックグラウンドストーリーがありません。</p>
        )}
      </div>
    </div>
  );
}
