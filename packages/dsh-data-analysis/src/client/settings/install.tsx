import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { localized } from '../i18n/host.tsx'
import { PythonSettingsCard, type PythonSettingsValue } from './card.tsx'

export function installSettings(ctx: Context): void {
  const scope = ctx.settingsScope.bind<PythonSettingsValue>({ namespace: 'dsh-data-analysis' })
  const Card = localized(ctx, PythonSettingsCard)
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      { name: 'settings.plugin.item', key: 'dsh-data-analysis', locale: 'marivo.settings' },
      function SettingsCard() {
        return <Card scope={scope} />
      },
    ),
  )
}
