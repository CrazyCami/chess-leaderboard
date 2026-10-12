import type { Metadata } from "next";
import Link from "next/link";
import { Masthead } from "../Masthead";
import { AdminReviewPanel } from "@/league/AdminReviewPanel";

export const metadata: Metadata = {
  title: "Game review | Chess League",
  description: "Sign in to review questionable chess league games.",
};

export default function ReviewPage() {
  return (
    <main className="page-shell">
      <Masthead eyebrow="League administration" title="Game review">
        Review uncertain results and record an audited decision. Only approved
        eligible games count toward league ratings.
      </Masthead>
      <AdminReviewPanel />
      <footer className="page-footer">
        <p><Link href="/">Return to the public leaderboard</Link></p>
      </footer>
    </main>
  );
}
