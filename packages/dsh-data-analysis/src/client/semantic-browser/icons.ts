import {
  BanIcon,
  BoxIcon,
  BracesIcon,
  CalendarDaysIcon,
  Clock3Icon,
  Columns3Icon,
  DatabaseIcon,
  FilterIcon,
  FolderIcon,
  HashIcon,
  KeyRoundIcon,
  Layers2Icon,
  Link2Icon,
  type LucideIcon,
  RulerIcon,
  SigmaIcon,
  Table2Icon,
  TagIcon,
  UserRoundIcon,
} from 'lucide-react'

const kindIcons: Readonly<Record<string, LucideIcon>> = {
  domain: FolderIcon,
  datasource: DatabaseIcon,
  entity: Table2Icon,
  dimension: Columns3Icon,
  measure: RulerIcon,
  time_dimension: Clock3Icon,
  metric: HashIcon,
  relationship: Link2Icon,
  period_calendar: CalendarDaysIcon,
  temporal_set: CalendarDaysIcon,
}

const fieldIcons: Readonly<Record<string, LucideIcon>> = {
  domain: FolderIcon,
  roots: Table2Icon,
  entities: Table2Icon,
  entity: Table2Icon,
  from_entity: Table2Icon,
  to_entity: Table2Icon,
  datasource: DatabaseIcon,
  backend_type: DatabaseIcon,
  source_kind: DatabaseIcon,
  source_table: Table2Icon,
  source_database: DatabaseIcon,
  primary_key: KeyRoundIcon,
  keys: KeyRoundIcon,
  owner: UserRoundIcon,
  unit: TagIcon,
  additivity: SigmaIcon,
  default_time: Clock3Icon,
  is_default_time: Clock3Icon,
  date: Clock3Icon,
  start: Clock3Icon,
  end: Clock3Icon,
  time_bindings: Clock3Icon,
  boundary_timezone: Clock3Icon,
  sample_interval: Clock3Icon,
  occurrence_id: Columns3Icon,
  category: Columns3Icon,
  coverage: CalendarDaysIcon,
  cardinality: Link2Icon,
  null_rules: BanIcon,
  conditions: FilterIcon,
  reductions: SigmaIcon,
  facts: BracesIcon,
}

export function kindIcon(kind: string): LucideIcon {
  return kindIcons[kind] ?? BoxIcon
}

export function fieldIcon(name: string): LucideIcon {
  return fieldIcons[name] ?? Layers2Icon
}
