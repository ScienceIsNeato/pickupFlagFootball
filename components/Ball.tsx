export function Ball({ w = 28, h = 18 }: { w?: number; h?: number }) {
  return (
    <span className="ball" aria-hidden="true">
      <svg viewBox="0 0 34 22" width={w} height={h}>
        <ellipse cx="17" cy="11" rx="16" ry="10" fill="#8a4b2a" />
        <path d="M7 11 H27" stroke="#fff" strokeWidth="1.6" />
        <path d="M13 8 V14 M17 7.2 V14.8 M21 8 V14" stroke="#fff" strokeWidth="1.6" />
      </svg>
    </span>
  );
}
