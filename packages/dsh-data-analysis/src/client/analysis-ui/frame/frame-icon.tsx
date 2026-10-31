/** Small, decorative action glyphs; their owning controls provide accessible names. */
export function FrameIcon({
  kind,
  size = 16,
}: {
  kind: 'copy' | 'table' | 'close' | 'source'
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'copy' ? (
        <>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </>
      ) : kind === 'table' ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11M15 9v11M3 14.5h18" />
        </>
      ) : kind === 'source' ? (
        <>
          <path d="M7.2 6.5l9.6 5M7.2 17.5l9.6-5" />
          <circle cx="5" cy="5.5" r="2.5" />
          <circle cx="5" cy="18.5" r="2.5" />
          <circle cx="19" cy="12" r="2.5" />
        </>
      ) : (
        <path d="M6 6l12 12M18 6 6 18" />
      )}
    </svg>
  )
}
