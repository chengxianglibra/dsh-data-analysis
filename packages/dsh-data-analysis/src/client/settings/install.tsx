import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { localized } from '../i18n/host.tsx'
import { PythonSettingsCard, type PythonSettingsValue } from './card.tsx'

export function installSettings(ctx: Context): void {
  const scope = ctx.configForms.get<PythonSettingsValue>('dsh-data-analysis')
  const Card = localized(ctx, PythonSettingsCard)
  ctx.effect(() =>
    ctx.configForms.whileServed(['dsh-data-analysis'], () =>
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: '@chengxianglibra/dsh-data-analysis',
            locale: 'marivo.settings',
          },
          function SettingsCard() {
            return <Card scope={scope} />
          },
        ),
      ),
    ),
  )
}
