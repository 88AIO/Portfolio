"use client";

// Root-level error boundary. Unlike app/error.tsx (which catches errors within the page tree),
// this catches errors thrown by the ROOT layout itself, so it must render its own <html>/<body>.
// Kept dependency-free and inline-styled — a failure this deep can't assume the app's CSS loaded.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f4ec",
          color: "#1b1914",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "1rem",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            background: "#ffffff",
            border: "1px solid #e7e2d6",
            borderRadius: "1.5rem",
            padding: "2rem",
            textAlign: "center",
            boxShadow: "0 24px 48px -28px rgba(23,63,51,0.30)",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 500, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b6459", margin: "0 0 1.5rem" }}>
            We hit an unexpected error. Your data is safe, and this is usually temporary.
          </p>
          <button
            onClick={reset}
            style={{
              borderRadius: "0.75rem",
              background: "#173f33",
              color: "#f7f4ec",
              border: "none",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
