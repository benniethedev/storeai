"use client";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="secondary"
      onClick={async () => {
        await apiFetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
