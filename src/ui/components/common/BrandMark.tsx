export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <div
      className="brand-mark"
      style={{ width: size, height: size, borderRadius: size * 0.32 }}
      aria-hidden
    >
      <svg
        width={size * 0.47}
        height={size * 0.47}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 18L18 6" />
        <path d="M9.5 6H18v8.5" />
      </svg>
    </div>
  );
}
