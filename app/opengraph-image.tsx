import { ImageResponse } from "next/og";

export const alt = "Snowfolio — your whole portfolio, in one honest view";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Branded social card in the Snowfolio palette. Self-contained (no external fonts or assets)
// so it renders identically on any build.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #173f33 0%, #10322a 100%)",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "64px",
              height: "64px",
              borderRadius: "18px",
              background: "#2f755f",
              color: "#f2efe2",
              fontSize: "38px",
              fontWeight: 700,
            }}
          >
            S
          </div>
          <div style={{ color: "#f7f4ec", fontSize: "34px", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Snowfolio
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            color: "#f7f4ec",
            fontSize: "68px",
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
          }}
        >
          <div style={{ display: "flex" }}>Your whole portfolio,</div>
          <div style={{ display: "flex" }}>
            in one <span style={{ color: "#8fbfad", fontStyle: "italic", marginLeft: "18px" }}>honest</span>
            <span style={{ marginLeft: "18px" }}>view.</span>
          </div>
        </div>

        <div style={{ display: "flex", color: "#a9cebf", fontSize: "26px", letterSpacing: "0.01em" }}>
          Dividends + option premium · US &amp; international · calm by default
        </div>
      </div>
    ),
    { ...size },
  );
}
