import { GenerateSurface } from "@/components/GenerateSurface";

export default function GeneratePage() {
  return (
    <div className="container">
      <section className="gen-head">
        <span className="eyebrow mono">GENERATOR</span>
        <h1 className="gen-title">Encode a symbol</h1>
        <p className="gen-sub">
          Everything runs locally. Your payload never leaves the browser.
        </p>
      </section>
      <GenerateSurface />
    </div>
  );
}
