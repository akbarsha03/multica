let _path: string | null = null;
export function getLastIssuePath(): string | null { return _path; }
export function setLastIssuePath(path: string): void { _path = path; }
