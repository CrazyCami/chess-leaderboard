import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"School Chess League",description:"A local starting point for a school year-group chess league."};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
