// Snowfolio's mark: a warm forest tile with a fine six-point flake struck through
// it — a quiet, bespoke icon in the brand palette, not a stock gradient blob.
// Sizing comes from the className (e.g. "h-8 w-8"); the SVG fills its box.
export default function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Snowfolio"
      fill="none"
    >
      <rect width="32" height="32" rx="9" fill="#173f33" />
      <rect width="32" height="32" rx="9" fill="url(#sf-sheen)" fillOpacity="0.55" />
      <g stroke="#f2efe2" strokeWidth="1.4" strokeLinecap="round" opacity="0.96">
        <path d="M16 6.5V25.5" />
        <path d="M7.77 11.25 24.23 20.75" />
        <path d="M7.77 20.75 24.23 11.25" />
        <path d="M16 9.6l-2.1 1.5M16 9.6l2.1 1.5" />
        <path d="M16 22.4l-2.1-1.5M16 22.4l2.1-1.5" />
        <path d="M10.3 12.7l.15 2.55M10.3 12.7l2.5-.55" />
        <path d="M21.7 19.3l-.15-2.55M21.7 19.3l-2.5.55" />
        <path d="M10.3 19.3l2.5.55M10.3 19.3l.15-2.55" />
        <path d="M21.7 12.7l-2.5-.55M21.7 12.7l-.15 2.55" />
      </g>
      <defs>
        <linearGradient id="sf-sheen" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2f755f" />
          <stop offset="1" stopColor="#123026" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
