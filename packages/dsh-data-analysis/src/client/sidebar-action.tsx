const styles = `
.marivo-sidebar-action{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:34px;padding:7px 6px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:20px;white-space:nowrap;cursor:pointer}
.marivo-sidebar-action:hover{background:var(--dsw-alias-interactive-bg-hover,#7b899414)}
.marivo-sidebar-action:focus-visible{outline:2px solid var(--dsw-alias-label-primary,#087b70);outline-offset:2px}
.marivo-sidebar-action[data-wide=false]{width:34px;padding:7px}
`

export function SidebarAction({
  wide,
  label,
  icon,
  onClick,
}: {
  wide: boolean
  label: string
  icon: 'semantic' | 'credentials'
  onClick: () => void
}) {
  return (
    <>
      <style>{styles}</style>
      <button
        className="marivo-sidebar-action"
        data-wide={wide}
        type="button"
        title={label}
        aria-label={`打开${label}`}
        onClick={onClick}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {icon === 'semantic' ? (
            <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
          ) : (
            <>
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
            </>
          )}
        </svg>
        {wide && <span>{label}</span>}
      </button>
    </>
  )
}
