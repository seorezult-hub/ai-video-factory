import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI Video Factory — Профессиональные AI-ролики для брендов",
  description:
    "Создавайте профессиональные AI-ролики для брендов за 30–60 минут. Пошаговый конструктор.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <body className={`${inter.className} bg-gray-950 text-white`}>{children}</body>
    </html>
  );
}
