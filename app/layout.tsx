import type { ReactNode } from "react";

export const metadata = {
  title: "Sandbox Hosting",
  description: "IP-restricted HTML sandbox host",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
