import { describe, expect, it } from 'vitest';
import { gameServersContent } from './game-compose';

describe('gameServersContent', () => {
  it('says what to do when the build has no game servers', () => {
    expect(gameServersContent(undefined)).toContain('No game servers in this build.');
    expect(gameServersContent([])).toContain('Drag a game from the Services tab');
  });

  it('shows each host with its compose file and the values to fill in', () => {
    const text = gameServersContent([
      {
        host_id: 'h1',
        host: 'Game Host',
        folder: 'game-host',
        compose: 'services:\n  valheim:\n    image: example/valheim\n',
        env: '# Values for the game servers on Game Host.\nVALHEIM_SERVER_PASS=\n',
        services: 1,
      },
      {
        host_id: 'h2',
        host: 'Party Server',
        folder: 'party-server',
        compose: 'services:\n  cs2:\n    image: example/cs2\n',
        env: 'CS2_RCONPW=\n',
        services: 1,
      },
    ]);

    // The folder is where the file sits in the export bundle.
    expect(text).toContain('# Game Host: gaming/game-host/docker-compose.yml');
    expect(text).toContain('  valheim:\n    image: example/valheim');
    // The env template is shown as comments, so the whole tab stays valid YAML.
    expect(text).toContain('# Game Host: gaming/game-host/.env.example');
    expect(text).toContain('# VALHEIM_SERVER_PASS=');
    expect(text).not.toMatch(/^VALHEIM_SERVER_PASS=/m);
    expect(text).toContain('# Party Server: gaming/party-server/docker-compose.yml');
    expect(text.indexOf('Game Host')).toBeLessThan(text.indexOf('Party Server'));
  });
});
