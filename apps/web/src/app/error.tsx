"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="auth-page">
      <div className="auth-card card" style={{ textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          An unexpected error occurred.
        </p>
        {error.digest && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <code>digest: {error.digest}</code>
          </p>
        )}
        <div style={{ marginTop: 16 }}>
          <button onClick={reset}>Try again</button>
        </div>
      </div>
    </div>
  );
}
