function Skull({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 100 110" fill="none" aria-hidden="true">
    <path d="M50 8C24 8 10 25 10 47c0 17 9 28 22 32v18h36V79c13-4 22-15 22-32C90 25 76 8 50 8Z" fill="currentColor" />
    <path d="M23 43c0-7 18-5 18 4s-18 16-18-4Zm54 0c0-7-18-5-18 4s18 16 18-4ZM50 59l-7 13h14Z" fill="#090a0c" />
    <path d="M41 83v15m9-15v15m9-15v15" stroke="#090a0c" strokeWidth="4" />
  </svg>;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`skeleton ${className}`}>
    <Skull className="skeleton-head" />
    <svg className="skeleton-body" viewBox="0 0 160 290" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M80 10v104m-30 7 30 19 30-19M50 121l5 26h50l5-26M54 157l-17 59 8 60m61-119 17 59-8 60M45 276H28m87 0h17" />
      <g className="skeleton-arm"><path d="M49 22 24 70l-8 53m-5 0 5 12 8-12" /></g>
      <g className="skeleton-arm right-arm"><path d="m111 22 25 48 8 53m-8 0 8 12 5-12" /></g>
      <path d="M48 23Q80 4 112 23M48 39q32 23 64 0M49 58q31 23 62 0M53 78q27 21 54 0" strokeWidth="7" />
    </svg>
  </div>;
}

export default function HauntedScene({ className = "" }: { className?: string }) {
  return <div className={`haunted-scene ${className}`} aria-hidden="true">
    <Skeleton className="skeleton-left" /><Skeleton className="skeleton-right" />
    <Skull className="floating-skull skull-one" /><Skull className="floating-skull skull-two" /><Skull className="floating-skull skull-three" />
  </div>;
}

export { Skull };
