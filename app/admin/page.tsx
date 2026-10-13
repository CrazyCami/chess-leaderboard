"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy address. A client-side redirect keeps it working on static hosting. */
export default function AdminPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/review");
  }, [router]);
  return (
    <main className="page-shell">
      <p className="connection-message">Taking you to game review…</p>
    </main>
  );
}
