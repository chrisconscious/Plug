import { useId, useState, type KeyboardEvent, type ClipboardEvent } from "react";
import { X } from "lucide-react";

/** Same limits the API enforces (api/src/lib/services/catalog.service.ts normalizeKeywords). */
export const MAX_KEYWORDS = 30;
export const MAX_KEYWORD_LENGTH = 60;

const clean = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Admin "Keyword" field: each keyword becomes a removable chip. Enter or a
 * comma adds what was typed; Backspace in an empty box removes the last chip;
 * pasting "a, b, c" adds all three. Values are normalised the same way the
 * server stores them (trimmed, lowercased, de-duplicated) so what the admin
 * sees is exactly what gets saved.
 */
export function KeywordInput({ value, onChange, id }: { value: string[]; onChange: (next: string[]) => void; id?: string }) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-keyword`;
  const helpId = `${inputId}-help`;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (raw: string) => {
    const parts = raw.split(",").map(clean).filter(Boolean);
    if (parts.length === 0) return true;
    const next = [...value];
    for (const k of parts) {
      if (k.length > MAX_KEYWORD_LENGTH) {
        setError(`Keep each keyword under ${MAX_KEYWORD_LENGTH} characters.`);
        return false;
      }
      if (!next.includes(k)) next.push(k);
    }
    if (next.length > MAX_KEYWORDS) {
      setError(`Use at most ${MAX_KEYWORDS} keywords per product.`);
      return false;
    }
    setError(null);
    onChange(next);
    return true;
  };

  const commitDraft = () => {
    if (add(draft)) setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (text.includes(",")) {
      e.preventDefault();
      if (add(draft + text)) setDraft("");
    }
  };

  return (
    <div className="kwField">
      <label htmlFor={inputId} className="kwLabel">Keyword</label>
      <div className={`kwBox${error ? " kwBox--error" : ""}`} onClick={() => document.getElementById(inputId)?.focus()}>
        {value.map((k) => (
          <span key={k} className="kwChip">
            {k}
            <button
              type="button"
              aria-label={`Remove keyword ${k}`}
              onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== k)); setError(null); }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            // Typing a comma commits the keyword before it.
            if (v.includes(",")) { if (add(v)) setDraft(""); } else setDraft(v);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={commitDraft}
          aria-describedby={helpId}
          placeholder={value.length ? "" : "Enter keywords separated by commas, e.g. black sneakers, running shoes, sportswear"}
        />
      </div>
      <p id={helpId} className="kwHelp">
        Add alternative names, related search terms, styles, colors, materials, or phrases customers might use to find this product.
      </p>
      {error && <p role="alert" className="kwError">{error}</p>}
    </div>
  );
}
