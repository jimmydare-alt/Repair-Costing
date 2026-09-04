export function needsWorkspaceReset(previousUserId: string | null, nextUserId: string | null) {
  return previousUserId !== nextUserId;
}
