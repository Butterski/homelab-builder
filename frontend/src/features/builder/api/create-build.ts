import { buildApi, type Build, type CreateBuildParams } from './builds';

/**
 * Creates the build empty, then saves its topology. When that save fails the
 * empty build is deleted again, so no partial project is kept.
 */
export async function createBuildWithTopology(params: CreateBuildParams): Promise<Build> {
  const created = await buildApi.create({ ...params, nodes: [], edges: [], services: [] });
  if (params.nodes.length === 0) return created;
  try {
    const result = await buildApi.updateTopology(created.id, {
      ...params,
      revision: created.revision,
    });
    return result.build;
  } catch (error) {
    await buildApi.delete(created.id).catch(() => undefined);
    throw error;
  }
}
