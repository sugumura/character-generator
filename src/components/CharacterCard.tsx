import type { Character } from "../types";

export interface CharacterCardProps {
  character: Character;
  onClick: () => void;
}

const statusLabel: Record<string, string> = {
  pending: "待機中",
  generating: "生成中",
  completed: "完了",
  failed: "失敗",
};

const statusColor: Record<string, string> = {
  pending: "#888",
  generating: "#f0a500",
  completed: "#2e7d32",
  failed: "#c62828",
};

export default function CharacterCard({ character, onClick }: CharacterCardProps) {
  const displayName = [character.species, character.occupation].filter(Boolean).join(" / ");
  const status = character.generationStatus;
  const date = new Date(character.createdAt).toLocaleDateString("ja-JP");

  return (
    <div
      onClick={onClick}
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: "12px 16px",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontWeight: "bold" }}>{displayName || "未設定"}</div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{date}</div>
      </div>
      <span
        style={{
          fontSize: 12,
          padding: "2px 8px",
          borderRadius: 12,
          background: statusColor[status] ?? "#888",
          color: "#fff",
        }}
      >
        {statusLabel[status] ?? status}
      </span>
    </div>
  );
}
