import Link from "next/link";
import { HeroGlyph } from "@/components/HeroGlyph";

const STATS = [
  { v: "2953", k: "max bytes / symbol" },
  { v: "7089", k: "max numeric digits" },
  { v: "40", k: "QR versions" },
  { v: "4", k: "error-correction levels" },
];

const FEATURES = [
  {
    t: "Instant encoding",
    d: "Type a payload and watch it resolve to a crisp, scalable QR symbol in real time — all in the browser.",
  },
  {
    t: "Byte-accurate",
    d: "UTF-8 length is measured to the byte and held against the single-symbol ceiling so you always know how much room is left.",
  },
  {
    t: "Export ready",
    d: "Pull down a sharp SVG or PNG, tuned to pure black on pure white for maximum scanner contrast.",
  },
];

export default function Home() {
  return (
    <div className="container">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow mono">QR STUDIO · v0.1</span>
          <h1 className="hero-title">
            Generate QR codes that are
            <br />
            <span className="hero-em">impossibly clean.</span>
          </h1>
          <p className="hero-lede">
            A black-and-white encoding studio. Drop in up to 2953 bytes, see
            every byte accounted for, and export a pixel-perfect symbol — no
            accounts, no servers, no noise.
          </p>
          <div className="hero-actions">
            <Link href="/generate" className="btn">
              Open the generator <span>→</span>
            </Link>
            <a
              href="#features"
              className="btn ghost"
              aria-label="Learn more about the studio"
            >
              How it works
            </a>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <HeroGlyph />
        </div>
      </section>

      <section className="stats">
        {STATS.map((s) => (
          <div key={s.k} className="stat">
            <div className="stat-v mono">{s.v}</div>
            <div className="stat-k">{s.k}</div>
          </div>
        ))}
      </section>

      <section id="features" className="features">
        {FEATURES.map((f, i) => (
          <article key={f.t} className="feature">
            <span className="feature-no mono">0{i + 1}</span>
            <h3 className="feature-t">{f.t}</h3>
            <p className="feature-d">{f.d}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
