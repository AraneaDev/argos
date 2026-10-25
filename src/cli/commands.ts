/**
 * The `argos` command's subcommands
 * Pure parsing, so the entry point (src/cli.ts) stays a thin dispatcher.
 */

export const PANE_COMMANDS = [
  'connections',
  'schema',
  'query',
  'history',
  'result',
  'pin',
  'unpin',
  'pins',
  'install-plugin',
] as const;

export type PaneCommandKind = (typeof PANE_COMMANDS)[number];

export type Command =
  | { kind: 'serve' | 'setup' | 'help' | 'version' | PaneCommandKind; args: string[] }
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
  if ((PANE_COMMANDS as readonly string[]).includes(first)) {
    return { kind: first as PaneCommandKind, args: rest };
  }
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
  argos connections               List configured connections as JSON (read-only)
  argos schema <db> [--refresh]   Print a database's schema as JSON
  argos query <db> --sql <sql>    Run a read-only query and journal it
  argos history                   Print the query journal
  argos result <id>               Page a spooled result
  argos pin <db> --sql <sql>      Pin a query
  argos unpin <id>                Remove a pin
  argos pins                      List pins
  argos install-plugin            Install the Claude Code pane
  argos help                      Show this help
  argos version                   Show the version

For more information, visit: https://github.com/AraneaDev/argos
`;
}
