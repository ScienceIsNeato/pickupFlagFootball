import type { Metadata } from "next";
import { Inter, Barlow_Condensed } from "next/font/google";
import { FlagFieldCanvas } from "@/components/FlagFieldCanvas";
import { skin } from "@/lib/skin";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: skin.seo.title, template: `%s` },
  description: skin.seo.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable}`}>
      <body>
        <FlagFieldCanvas />
        {children}
      </body>
    </html>
  );
}
