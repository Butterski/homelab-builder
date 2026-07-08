interface NetworkZoneEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: {
    direction?: unknown;
  } | null;
}

function isAutoLanPort(handle: string | null | undefined, isSourceEndpoint: boolean) {
  if (!handle) return isSourceEndpoint;
  return handle !== 'target-0';
}

export function isNatDownstreamEdge(
  edge: NetworkZoneEdge,
  natId: string,
  otherIsUpstreamAnchor: boolean,
) {
  const natIsSource = edge.source === natId;
  if (!natIsSource && edge.target !== natId) return false;

  const direction = edge.data?.direction;
  if (direction === 'lan') return true;
  if (direction === 'wan') return false;

  const natHandle = natIsSource ? edge.sourceHandle : edge.targetHandle;
  return isAutoLanPort(natHandle, natIsSource) && !otherIsUpstreamAnchor;
}
