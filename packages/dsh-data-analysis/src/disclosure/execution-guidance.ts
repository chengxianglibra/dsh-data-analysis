import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { MarivoDisclosureController, MarivoSkillName } from './activation.ts'

export const MARIVO_DATASOURCE_CREDENTIAL_PROMPT = [
  'These are Host execution and credential rules; Marivo API and semantic contracts come from the bound Runtime Skill and live Help.',
  'DSH Credentials owns Marivo datasource secrets. Never request values in chat, read credential files or ~/.marivo/secrets.toml, or write secrets to scripts, arguments, environment variables, reports or logs.',
  'Use marivo_datasource_configure for missing datasource setup or connection configuration repair; the user owns configuration in the Web form. Use marivo_datasource_test for connection checks under its tool contract. Configured credentials alone do not prove connection or read access.',
  'Execute analysis, metadata inspection and semantic data reads through marivo_python in the bound Runtime and Workspace. Declare all exact Marivo datasource names this execution may access, including datasources without passwords; use datasources: [] for local pandas or native DuckDB without Marivo datasource access.',
  'Each marivo_python call is a separate process. Create/resume Marivo Sessions inside the call, close them in finally, and retain the persisted Session identity when continuing the same analysis. Closing process resources does not delete durable Artifacts. Do not replace the credential resolver, read SecretValue contents, or bypass Host scope with environment/cache configuration.',
  'Preserve real failures. After uncertain execution, inspect existing effects before retrying; never automatically replay a script with possible side effects.',
].join('\n')

export const MARIVO_ANALYSIS_CLOSEOUT_PROMPT = [
  'Analysis semantics and execution contracts come from the activated Runtime Skill and current Help.',
  'Before completing any analysis, including a text-only answer, check each user question and each requested comparison scope against its evidence. Keep incomplete branches explicit; preserve comparison sides, direction and denominator. Match conclusion strength to evidence, and reflect limitations in the claims themselves.',
].join(' ')

/** Bridge rules activated after system prompt assembly, without changing their wording. */
function executionGuidanceSupplement(
  before: readonly MarivoSkillName[],
  after: readonly MarivoSkillName[],
): UserMessage[] {
  const rules: string[] = []
  if (before.length === 0 && after.length > 0) rules.push(MARIVO_DATASOURCE_CREDENTIAL_PROMPT)
  if (!before.includes('marivo-analysis') && after.includes('marivo-analysis'))
    rules.push(MARIVO_ANALYSIS_CLOSEOUT_PROMPT)
  if (rules.length === 0) return []
  return [
    createUserMessage({
      content: [
        {
          type: 'text',
          text: ['<marivo_execution_guidance>', ...rules, '</marivo_execution_guidance>'].join(
            '\n\n',
          ),
        },
      ],
      source: { kind: 'plugin', plugin: 'dsh-data-analysis' },
    }),
  ]
}

/** Full-plugin seam: requires its execution tools, credentials service and system sections. */
export function installMarivoExecutionGuidance(
  agent: Agent,
  controller: MarivoDisclosureController,
): () => void {
  return agent.ctx.on(
    'agent/pre-step',
    async ({ signal }, next): Promise<PreStepDecision> => {
      // Prepend after Help installation to wrap its successful disclosure decision.
      const previouslyActive = controller.activeSkills
      const decision = await next()
      if (decision.kind === 'reject') return decision
      signal.throwIfAborted()
      const guidance = executionGuidanceSupplement(previouslyActive, controller.activeSkills)
      return guidance.length === 0
        ? decision
        : { ...decision, messages: [...decision.messages, ...guidance] }
    },
    true,
  )
}
