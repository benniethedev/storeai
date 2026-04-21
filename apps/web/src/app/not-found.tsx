import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-page">
      <div className="auth-card card" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 40, margin: 0 }}>404</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          That page doesn't exist.
        </p>
        <div style={{ marginTop: 20 }}>
          <Link href="/">Go home →</Link>
        </div>
      </div>
    </div>
  );
}
