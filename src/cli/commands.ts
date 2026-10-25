/**
 * The `argos` command's subcommands
 * Pure parsing, so the entry point (src/cli.ts) stays a thin dispatcher.
 */

export type Command =
  | { kind: 'serve' | 'setup' | 'help' | 'version'; args: string[] }
  | { kind: 'unknown'; args: string[]; name: string };

const ALIASES: Record<string, 'help' | 'version'> = {
  help: 'help',
  '--help': 'help',
  '-h': 'help',
  version: 'version',
  '--version': 'version',
  '-v': 'version',
};

/**
 * Resolve the subcommand from the arguments after `argos`
 */
export function resolveCommand(args: readonly string[]): Command {
  const [first, ...rest] = args;
  if (first === undefined) return { kind: 'help', args: [] };
  if (first === 'serve' || first === 'setup') return { kind: first, args: rest };
  const alias = ALIASES[first];
  if (alias) return { kind: alias, args: [] };
  return { kind: 'unknown', args: [], name: first };
}

/**
 * Usage text for `argos` with no subcommand, `argos help`, or a mistyped one
 */
export function usage(): string {
  return `Argos - the hundred-eyed SQL server for AI assistants

USAGE:
  argos serve [--config <path>]   Start the MCP server (what your MCP client runs)
  argos setup [options]           Interactive configuration wizard (argos setup --help)
  argos help                      Show this help
  argos version                   Show the version

For more information, visit: https://github.com/AraneaDev/argos
`;
}
