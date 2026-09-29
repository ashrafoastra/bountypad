import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const alt = "Bounty Pad: every meme coin is a challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  const logo = `data:image/svg+xml;base64,${readFileSync(path.join(process.cwd(), "public/brand/logo.svg")).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ffffff", color: "#121212", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={84} height={84} alt="" />
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Bounty Pad</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3 }}>Every meme coin</div>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3 }}>is a challenge.</div>
          <div style={{ fontSize: 32, color: "#6b6e76", marginTop: 28 }}>Name anyone on X. The pot is locked on Solana until they do it.</div>
        </div>
        <div style={{ display: "flex", height: 14, width: 180, background: "#ffc72c", borderRadius: 7 }} />
      </div>
    ),
    size,
  );
}
