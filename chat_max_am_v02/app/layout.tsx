import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAX od AM",
  description: "Mój pierwszy chatbot na kursie LABA",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pl"><body>{children}</body></html>;
}
