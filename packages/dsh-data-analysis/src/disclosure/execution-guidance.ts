import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { MarivoDisclosureController, MarivoSkillName } from './activation.ts'

export const MARIVO_DATASOURCE_CREDENTIAL_PROMPT = [
  'When a requested table has no usable configured datasource, call marivo_datasource_configure with mode=create and a brief reason. For a datasource needing connection configuration repair, use mode=edit and its exact name. The user configures it in the owning Web right tab; do not request secrets in chat or write connection configuration on the user behalf. Only status=ok allows continuing: rediscover the datasource and verify the requested table and read access before analysis. Other statuses are not connection success. A provided local file may be analyzed directly when appropriate; do not invent a remote datasource requirement.',
  'DSH Credentials owns Marivo datasource secrets. Never request values in chat, read credential files or ~/.marivo/secrets.toml, or write secrets to scripts, arguments, environment variables, reports or logs.',
  'Use marivo_datasource_test after datasource changes, credential rotation, connection failures, or explicit user requests. Missing credentials wait for the Web form only while the original call remains alive.',
  'Execute analysis, metadata inspection and semantic data reads through marivo_python. Declare all exact Marivo datasource names this execution may access, including datasources without passwords. Local file analysis with pandas or native DuckDB uses datasources: [] when no Marivo datasource is accessed.',
  'marivo_python waits for all missing credentials and validates the bound Workspace and datasource identities before taking one fresh snapshot and starting user code once. Configured credentials need no extra connection test. Ordinary Shell receives no datasource secret.',
  'marivo_python installs credential_scope before user code. When using Marivo Session/reader objects, create or resume them inside that execution, and close Sessions in finally. Do not replace the resolver, read SecretValue contents, or bypass Host scope with environment/cache configuration.',
  "Each marivo_python call uses a separate process. Closing releases that process's Session resources; it does not end the analytical question or delete durable Artifacts. When continuing a persisted Marivo analysis, reuse its Session identity across calls.",
  'Configured credentials do not imply a valid connection or query permissions. Preserve real failures; never automatically replay a script with possible side effects.',
  'Session lifetime pattern inside one marivo_python call (create/resume using current Runtime Help):\nsession = ...\ntry:\n    ...  # analysis using this Session\nfinally:\n    session.close()',
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
