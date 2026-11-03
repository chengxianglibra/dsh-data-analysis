import {
  CalendarDaysIcon,
  CodeXmlIcon,
  CopyIcon,
  GitForkIcon,
  Table2Icon,
  XIcon,
} from 'lucide-react'

/** Domain action names use the same Lucide icon family as the shadcn primitives. */
export function FrameIcon({
  kind,
  size = 16,
}: {
  kind: 'copy' | 'table' | 'close' | 'source' | 'calendar' | 'code'
  size?: number
}) {
  const Icon = {
    copy: CopyIcon,
    table: Table2Icon,
    close: XIcon,
    source: GitForkIcon,
    calendar: CalendarDaysIcon,
    code: CodeXmlIcon,
  }[kind]
  return <Icon size={size} aria-hidden="true" focusable="false" />
}
