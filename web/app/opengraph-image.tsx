import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const alt = "Bounty Pad: paid for the action";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  const logo = `data:image/png;base64,${readFileSync(path.join(process.cwd(), "public/brand/logo.png")).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#101010", color: "#f2f1ee", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={72} height={72} alt="" />
          <div style={{ fontSize: 40, fontWeight: 500, letterSpacing: -1 }}>Bounty Pad</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 120, fontWeight: 400, lineHeight: 1, letterSpacing: -5 }}>Make them</div>
          <div style={{ fontSize: 120, fontWeight: 400, lineHeight: 1, letterSpacing: -5 }}>earn it.</div>
          <div style={{ fontSize: 30, color: "#a7a79f", marginTop: 32 }}>Others pay for nothing. We pay for the action.</div>
        </div>
        <div style={{ display: "flex", height: 1, width: "100%", background: "#3a3a36" }} />
      </div>
    ),
    size,
  );
}
