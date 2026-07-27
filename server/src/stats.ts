let activeConnections = 0;

export function connectionOpened(): void {
  activeConnections += 1;
}

export function connectionClosed(): void {
  activeConnections = Math.max(0, activeConnections - 1);
}

export function getOnlineCount(): number {
  return activeConnections;
}
