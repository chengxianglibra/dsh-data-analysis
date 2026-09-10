import { useCopy } from './i18n/context.tsx'

const styles = `
.marivo-workspace-header-action{display:inline-flex;flex:none;align-items:center;justify-content:center;gap:5px;height:32px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:20px;white-space:nowrap;cursor:pointer}
.marivo-workspace-header-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#7b899414)}
.marivo-workspace-header-action:focus-visible{outline:2px solid var(--dsw-alias-label-primary,#087b70);outline-offset:2px}
.marivo-workspace-header-action:disabled{opacity:.45;cursor:default}
@media(max-width:640px){.marivo-workspace-header-action{width:32px;padding:8px}.marivo-workspace-header-action span{display:none}}
`

export function WorkspaceHeaderAction({
  label,
  icon,
  disabled,
  title,
  onClick,
}: {
  label: string
  icon: 'semantic' | 'credentials' | 'reports'
  disabled: boolean
  title?: string
  onClick: () => void
}) {
  const t = useCopy()

  return (
    <>
      <style>{styles}</style>
      <button
        className="marivo-workspace-header-action"
        type="button"
        title={t(title ?? label)}
        aria-label={t('marivo.navigation.open-value', { p0: label })}
        disabled={disabled}
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
          {icon === 'reports' ? (
            <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />
          ) : icon === 'semantic' ? (
            <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
          ) : (
            <>
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
            </>
          )}
        </svg>
        <span>{t(label)}</span>
      </button>
    </>
  )
}
