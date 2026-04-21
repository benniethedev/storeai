"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0b0d12",
          color: "#e8ecf1",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1>Something went very wrong</h1>
          <p style={{ opacity: 0.7 }}>The app failed to render.</p>
          {error.digest && (
            <p style={{ opacity: 0.5, fontSize: 12 }}>
              <code>digest: {error.digest}</code>
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 12,
              padding: "8px 14px",
              background: "#5b8cff",
              color: "white",
              border: 0,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
