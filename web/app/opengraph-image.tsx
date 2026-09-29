import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const alt = "Bounty Pad: make them earn it";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  const coin = `data:image/png;base64,${readFileSync(path.join(process.cwd(), "public/brand/coin-3d-og.png")).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", background: "radial-gradient(circle at 75% 50%, #2a2210 0%, #060709 55%)", color: "#f4f5f7", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 26, color: "#3dffa2", letterSpacing: 6 }}>BOUNTY PAD</div>
          <div style={{ fontSize: 92, fontWeight: 700, lineHeight: 1, marginTop: 24, letterSpacing: -3 }}>Make them</div>
          <div style={{ fontSize: 92, fontWeight: 700, lineHeight: 1, color: "#f7c75a", letterSpacing: -3 }}>earn it.</div>
          <div style={{ fontSize: 30, color: "#8b909a", marginTop: 32, maxWidth: 560 }}>Launch a meme coin, name anyone on X, set the challenge. The pot unlocks when they do it.</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coin} width={460} height={460} alt="" />
      </div>
    ),
    size,
  );
}
