import { resolveCommand, usage } from '../../../src/cli/commands.js';

// `argos` is one command with subcommands. With nothing to do it prints
// usage rather than starting a silent stdio server.
describe('resolveCommand', () => {
  it('prints help when no subcommand is given', () => {
    expect(resolveCommand([])).toEqual({ kind: 'help', args: [] });
  });

  it.each(['help', '--help', '-h'])('treats %s as help', (arg) => {
    expect(resolveCommand([arg])).toEqual({ kind: 'help', args: [] });
  });

  it.each(['version', '--version', '-v'])('treats %s as version', (arg) => {
    expect(resolveCommand([arg])).toEqual({ kind: 'version', args: [] });
  });

  it('starts the server on serve, passing what follows through', () => {
    expect(resolveCommand(['serve', '--config', '/etc/argos/config.ini'])).toEqual({
      kind: 'serve',
      args: ['--config', '/etc/argos/config.ini'],
    });
  });

  it('runs the wizard on setup, passing what follows through', () => {
    expect(resolveCommand(['setup', '--template=minimal'])).toEqual({
      kind: 'setup',
      args: ['--template=minimal'],
    });
  });

  it('names an unknown subcommand instead of guessing', () => {
    expect(resolveCommand(['serv'])).toEqual({ kind: 'unknown', args: [], name: 'serv' });
  });

  it('does not take a flag before the subcommand as the subcommand', () => {
    expect(resolveCommand(['--config', 'x.ini'])).toEqual({
      kind: 'unknown',
      args: [],
      name: '--config',
    });
  });
});

describe('pane subcommands', () => {
  it.each([
    'connections',
    'schema',
    'query',
    'history',
    'result',
    'pin',
    'unpin',
    'pins',
    'install-plugin',
  ])('resolves %s, passing what follows through', (kind) => {
    expect(resolveCommand([kind, 'demo', '--refresh'])).toEqual({
      kind,
      args: ['demo', '--refresh'],
    });
  });
});

describe('usage', () => {
  it('lists every subcommand', () => {
    const text = usage();
    for (const sub of [
      'serve',
      'setup',
      'help',
      'version',
      'connections',
      'schema',
      'query',
      'history',
      'result',
      'pin',
      'unpin',
      'pins',
      'install-plugin',
    ]) {
      expect(text).toContain(`argos ${sub}`);
    }
  });
});
