type BacklineLogoProps = {
  className?: string;
};

export default function BacklineLogo({ className }: BacklineLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1200 420"
      width="100%"
      height="auto"
      role="img"
      aria-label="BackLine logo"
      className={className}
    >
      <style>{`
        .bl-stroke { stroke: var(--bl-stroke); stroke-width: 10; stroke-linejoin: round; stroke-linecap: round; }
        .bl-thin   { stroke: var(--bl-stroke); stroke-width: 6;  stroke-linejoin: round; stroke-linecap: round; }
        .bl-case   { fill: var(--bl-case); }
        .bl-case2  { fill: var(--bl-case-2); }
        .bl-metal  { fill: var(--bl-metal); }
        .bl-metal2 { fill: var(--bl-metal-2); }
        .bl-txt    {
          fill: var(--bl-text);
          font-family: var(--font-sans), system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
          font-weight: 800;
          font-size: 145px;
          line-height: 1;
          letter-spacing: -2px;
        }
      `}</style>

      <rect width="1200" height="420" fill="transparent" />

      <g opacity="0.9" transform="translate(0,10)">
        <rect x="140" y="76" width="920" height="268" rx="46" fill="var(--bl-shadow)" />
      </g>

      <g transform="translate(0,0)">
        <rect x="140" y="70" width="920" height="268" rx="46" className="bl-case bl-stroke" />
        <rect x="190" y="112" width="820" height="184" rx="34" className="bl-case2 bl-thin" />
        <rect x="170" y="86" width="860" height="40" rx="18" className="bl-metal bl-thin" />
        <rect x="170" y="282" width="860" height="40" rx="18" className="bl-metal bl-thin" />
        <rect x="210" y="270" width="780" height="12" rx="6" fill="var(--bl-accent)" opacity="0.18" />

        <g>
          <path d="M170 120 Q170 92 198 92 L230 92 L230 120 L202 120 Q190 120 190 132 L190 160 L170 160 Z" className="bl-metal2 bl-thin" />
          <path d="M1030 120 Q1030 92 1002 92 L970 92 L970 120 L998 120 Q1010 120 1010 132 L1010 160 L1030 160 Z" className="bl-metal2 bl-thin" />
          <path d="M170 288 L190 288 L190 260 Q190 248 202 248 L230 248 L230 320 L198 320 Q170 320 170 292 Z" className="bl-metal2 bl-thin" />
          <path d="M1030 288 L1010 288 L1010 260 Q1010 248 998 248 L970 248 L970 320 L1002 320 Q1030 320 1030 292 Z" className="bl-metal2 bl-thin" />
        </g>

        <g fill="var(--bl-stroke)" opacity="0.9">
          <circle cx="250" cy="106" r="6" /><circle cx="330" cy="106" r="6" /><circle cx="410" cy="106" r="6" />
          <circle cx="490" cy="106" r="6" /><circle cx="570" cy="106" r="6" /><circle cx="650" cy="106" r="6" />
          <circle cx="730" cy="106" r="6" /><circle cx="810" cy="106" r="6" /><circle cx="890" cy="106" r="6" />
          <circle cx="970" cy="106" r="6" />
          <circle cx="250" cy="302" r="6" /><circle cx="330" cy="302" r="6" /><circle cx="410" cy="302" r="6" />
          <circle cx="490" cy="302" r="6" /><circle cx="570" cy="302" r="6" /><circle cx="650" cy="302" r="6" />
          <circle cx="730" cy="302" r="6" /><circle cx="810" cy="302" r="6" /><circle cx="890" cy="302" r="6" />
          <circle cx="970" cy="302" r="6" />
        </g>

        <g transform="translate(330,0)">
          <rect x="0" y="250" width="150" height="72" rx="16" className="bl-metal bl-thin" />
          <rect x="26" y="270" width="98" height="32" rx="10" className="bl-case bl-thin" />
          <path d="M40 286 H110" className="bl-thin" fill="none" opacity="0.8" />
        </g>
        <g transform="translate(720,0)">
          <rect x="0" y="250" width="150" height="72" rx="16" className="bl-metal bl-thin" />
          <rect x="26" y="270" width="98" height="32" rx="10" className="bl-case bl-thin" />
          <path d="M40 286 H110" className="bl-thin" fill="none" opacity="0.8" />
        </g>

        <g>
          <text x="300" y="238" className="bl-txt" opacity="0.35" transform="translate(6,6)">BackLine</text>
          <text x="300" y="238" className="bl-txt">BackLine</text>
        </g>
      </g>
    </svg>
  );
}
