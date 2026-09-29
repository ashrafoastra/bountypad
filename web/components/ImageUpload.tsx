"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";

const MAX = 2 * 1024 * 1024;
const OK = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Coin logo upload: click or drop an image. It's stored by the API and linked from the on-chain metadata. */
export function ImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File) {
    setErr(null);
    if (!OK.includes(file.type)) return setErr("Use a PNG, JPG, WebP or GIF image.");
    if (file.size > MAX) return setErr("The image must be 2 MB or smaller.");
    setBusy(true);
    try {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      const { url } = await api<{ url: string }>("/api/uploads", { method: "POST", json: { data } });
      onChange(url);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div>
      <div
        role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
        className={`flex items-center gap-5 border border-dashed p-4 cursor-pointer transition-colors ${drag ? "border-ink bg-panel-2" : "border-line-2 hover:border-mute"}`}
      >
        <div className="w-24 h-24 bg-panel-3 overflow-hidden flex items-center justify-center shrink-0">
          {value
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={value} alt="Coin logo" className="w-full h-full object-cover" />
            : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6e6e68" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>}
        </div>
        <div className="min-w-0">
          <div className="font-medium">{busy ? "Uploading…" : value ? "Change image" : "Upload the coin's logo"}</div>
          <div className="text-sm text-mute mt-1">PNG, JPG, WebP or GIF. Square works best, up to 2 MB.</div>
          {value && !busy && <button type="button" className="text-sm text-red mt-2" onClick={(e) => { e.stopPropagation(); onChange(""); }}>Remove</button>}
        </div>
        <input ref={input} type="file" accept={OK.join(",")} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      </div>
      {err && <p className="text-sm text-red mt-2">{err}</p>}
    </div>
  );
}
