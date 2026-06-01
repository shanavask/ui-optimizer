import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UI auditor",
  description: "Submit URLs for UI auditing",
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <header className="top-nav">
          <a className="brand" href="/">
            UI auditor
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}
