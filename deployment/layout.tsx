import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YA JANG. 야장하기 좋은 날",
  description: "날씨와 대기질, 음식점 정보로 살펴보는 서울 야장 대시보드",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
