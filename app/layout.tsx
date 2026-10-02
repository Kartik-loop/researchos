import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ResearchOS — Your research workspace",
  description:
    "A private workspace to read, connect, and understand academic papers.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{let t=localStorage.getItem('researchos-theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')}catch{}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
