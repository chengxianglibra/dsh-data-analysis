export const MARIVO_HELP_PROGRAM = String.raw`
import sys
import marivo

marivo.help(sys.argv[1])
`.trim()

export const MARIVO_HELP_INVENTORY_PROGRAM = String.raw`
import marivo

marivo.help()
`.trim()
