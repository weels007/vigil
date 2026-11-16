export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="logo-svg"
    >
      <path d="M16 4.6v2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M11.6 8.6h8.8l1.5 3.3v10.9l-1.5 3.3h-8.8L10 23V11.9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 26.1h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="16" cy="16.6" rx="4.2" ry="2.9" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="16.6" r="1.3" fill="currentColor" />
      <path d="M16 13.4c.9 1.2 1.3 2.2 1.3 3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
