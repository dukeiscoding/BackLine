import type { Metadata } from "next";
import { Geist_Mono, Space_Grotesk } from "next/font/google";
import FooterNav from "@/components/FooterNav";
import ThemeInitializer from "@/components/ThemeInitializer";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BackLine",
  description: "BackLine tour management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeInitializer />
        <div className="mx-auto w-full max-w-6xl pb-24">{children}</div>
        <FooterNav />
      </body>
    </html>
  );
}
