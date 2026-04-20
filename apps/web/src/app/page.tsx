import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/context";

export default async function HomePage() {
  const s = await getUserSession();
  if (s) redirect("/dashboard");
  redirect("/login");
}
