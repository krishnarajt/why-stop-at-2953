import { TopBar } from "@/components/TopBar";

/**
 * Public site chrome — top bar + footer. The hidden lab is not a route at all:
 * it's revealed as an in-page overlay from the generator (see GenerateSurface),
 * so it never appears in the URL or as a tab.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <TopBar />
      <main style={{ flex: 1 }}>{children}</main>
      <footer className="footer">
        <div className="container footer-inner">
          <span className="mono">why-stop-at-2953</span>
          <span>
            single-symbol ceiling: <strong>2953 bytes</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
