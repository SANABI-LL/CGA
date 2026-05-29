interface PhoenixMarkProps {
  size?: number
  color?: string
}

// Light-theme variant (improved-map-v2.html "Phoenix")
export function PhoenixLight({ size = 24, color = '#800000' }: PhoenixMarkProps) {
  return (
    <svg width={size} height={Math.round(size * 0.83)} viewBox="0 0 120 100" fill="none">
      <g fill={color}>
        <ellipse cx="60" cy="62" rx="14" ry="18"/>
        <path d="M46 58 C30 45 18 50 20 65 C28 58 38 60 46 68 Z"/>
        <path d="M74 58 C90 45 102 50 100 65 C92 58 82 60 74 68 Z"/>
        <path d="M52 78 C48 88 44 94 40 98 C50 92 55 85 60 80 C65 85 70 92 80 98 C76 94 72 88 68 78 Z"/>
        <ellipse cx="60" cy="48" rx="8" ry="10"/>
        <circle cx="60" cy="36" r="9"/>
        <path d="M56 28 C54 20 50 14 52 8 C56 16 58 22 60 26 C62 22 64 16 68 8 C70 14 66 20 64 28 Z"/>
      </g>
    </svg>
  )
}

// Dark-theme variant (index.html "PhoenixMark") — with eye detail
export function PhoenixMark({ size = 28, color = 'white' }: PhoenixMarkProps) {
  const eyeFill = color === 'white' ? '#800000' : 'white'
  return (
    <svg width={size} height={Math.round(size * 0.83)} viewBox="0 0 120 100" fill="none">
      <g fill={color}>
        <ellipse cx="60" cy="62" rx="14" ry="18"/>
        <path d="M46 58 C30 45 18 50 20 65 C28 58 38 60 46 68 Z"/>
        <path d="M74 58 C90 45 102 50 100 65 C92 58 82 60 74 68 Z"/>
        <path d="M52 78 C48 88 44 94 40 98 C50 92 55 85 60 80 C65 85 70 92 80 98 C76 94 72 88 68 78 Z"/>
        <ellipse cx="60" cy="48" rx="8" ry="10"/>
        <circle cx="60" cy="36" r="9"/>
        <path d="M56 28 C54 20 50 14 52 8 C56 16 58 22 60 26 C62 22 64 16 68 8 C70 14 66 20 64 28 Z"/>
        <circle cx="63" cy="35" r="2.5" fill={eyeFill}/>
        <circle cx="63.5" cy="35" r="1.2" fill={color}/>
        <path d="M60 40 L65 43 L60 44 Z" fill="#C4903A"/>
      </g>
    </svg>
  )
}
