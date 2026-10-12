import type { NextConfig } from "next";

// GitHub Pages serves static files only. The Pages workflow sets
// NEXT_OUTPUT_EXPORT=1 to write the site to `out/`, and NEXT_BASE_PATH to the
// repository path (for example "/chess-leaderboard") so assets resolve under
// a project site. The export also uses trailing slashes so each page is a
// folder with an index.html, which every static host serves without needing
// extensionless-URL support. Local `next dev`, `next start` and the browser
// tests leave both variables unset and behave as before.
const staticExport = Boolean(process.env.NEXT_OUTPUT_EXPORT);

const nextConfig: NextConfig = {
  output: staticExport ? "export" : undefined,
  trailingSlash: staticExport,
  basePath: process.env.NEXT_BASE_PATH || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
