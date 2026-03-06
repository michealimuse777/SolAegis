import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolAegis — Autonomous DeFi Dashboard",
  description: "Multi-agent DeFi wallet infrastructure on Solana Devnet. Monitor agents, execute trades, and manage autonomous wallets.",
  keywords: ["Solana", "DeFi", "Multi-Agent", "Wallet", "Dashboard"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="grid-bg min-h-screen">
        {children}
      </body>
    </html>
  );
}
