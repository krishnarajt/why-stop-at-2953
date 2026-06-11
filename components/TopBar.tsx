"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./BrandMark";

/**
 * Primary navigation. Two tabs today — Dashboard and Generate.
 * A third (hidden) tab will slot in just left of the Generate CTA later;
 * the layout already leaves room for it.
 */
export function TopBar() {
  const pathname = usePathname();
  const onGenerate = pathname.startsWith("/generate");

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href="/" className="brand" aria-label="why-stop-at-2953 home">
          <BrandMark className="brand-mark" />
          <span>
            <span className="brand-name mono">why-stop-at-2953</span>
            <br />
            <span className="brand-sub">QR Studio</span>
          </span>
        </Link>

        <nav className="tabs">
          <Link href="/" className={`tab${onGenerate ? "" : " active"}`}>
            Dashboard
          </Link>

          {/* hidden tab mounts here */}

          <Link
            href="/generate"
            className={onGenerate ? "tab active" : "tab cta"}
          >
            Generate
            {!onGenerate && <span className="arr">→</span>}
          </Link>
        </nav>
      </div>
    </header>
  );
}
