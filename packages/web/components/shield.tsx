/** The single brand mark used everywhere: navbar, footer, avatars, social card. */
export function Shield({ className = "brand-shield" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 72" fill="none" aria-hidden="true">
      <path d="M32 2 60 12v22c0 17-11 30-28 38C15 64 4 51 4 34V12L32 2Z" fill="#d1fc70" stroke="#20251d" strokeWidth="3" />
      <path d="M32 14 50 21v13c0 11-7 20-18 26-11-6-18-15-18-26V21l18-7Z" fill="#20251d" />
      <path d="M32 22v25m-8-16 8-3 8 3" stroke="#d1fc70" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
