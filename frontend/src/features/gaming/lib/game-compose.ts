import type { GameComposeFile } from '../../builder/api/builds';

const RULE = `# ${'='.repeat(70)}`;

/**
 * One text for the Config Generator tab: every host's game compose file with
 * the values to fill in below it. Game servers get a compose file per host,
 * apart from the homelab stack, because they publish their ports on the host
 * instead of joining a shared network.
 */
export function gameServersContent(files: GameComposeFile[] | undefined): string {
  if (!files || files.length === 0) {
    return [
      '# No game servers in this build.',
      '# Drag a game from the Services tab of the builder onto a server, PC or mini PC.',
    ].join('\n');
  }
  return files
    .map(file =>
      [
        RULE,
        `# ${file.host}: gaming/${file.folder}/docker-compose.yml`,
        RULE,
        file.compose.trimEnd(),
        '',
        `# ${file.host}: gaming/${file.folder}/.env.example`,
        ...file.env
          .trimEnd()
          .split('\n')
          .map(line => (line.startsWith('#') ? line : `# ${line}`)),
      ].join('\n'),
    )
    .join('\n\n');
}
