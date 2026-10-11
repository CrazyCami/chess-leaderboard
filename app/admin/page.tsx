import type { Metadata } from "next";
import Link from "next/link";
import { AdminReviewPanel } from "@/league/AdminReviewPanel";

export const metadata: Metadata = {
  title: "Admin review | School Chess League",
  description: "Sign in to review questionable school chess league games.",
};

export default function AdminPage() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="eyebrow">League administration</p>
        <h1>Game review</h1>
        <p className="intro">
          Review uncertain results and record an audited decision. Only approved
          eligible games count toward league ratings.
        </p>
      </header>
      <AdminReviewPanel />
      <footer>
        <Link href="/">Return to the public leaderboard</Link>
      </footer>
    </main>
  );
}
