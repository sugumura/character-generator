import { useState, useRef } from "react";

interface ComboboxProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function Combobox({ options, value, onChange, placeholder }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered =
    value === ""
      ? options
      : options.filter((opt) => opt.toLowerCase().includes(value.toLowerCase()));

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setOpen(true);
  };

  const handleBlur = () => {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const handleSelect = (opt: string) => {
    onChange(opt);
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{ width: "100%", boxSizing: "border-box" }}
      />
      {open && filtered.length > 0 && (
        <ul
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            margin: 0,
            padding: 0,
            listStyle: "none",
            background: "#fff",
            border: "1px solid #ccc",
            zIndex: 1000,
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          {filtered.map((opt) => (
            <li
              key={opt}
              onMouseDown={() => handleSelect(opt)}
              style={{ padding: "6px 8px", cursor: "pointer" }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
