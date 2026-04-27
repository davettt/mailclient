export function timeAgo(epoch: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - epoch;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d`;
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function extractName(from: string | null, addr: string): string {
  if (from && from.trim()) return from.trim();
  return addr.split('@')[0];
}

export function getInitial(name: string): string {
  return name[0]?.toUpperCase() || '?';
}

const COLORS = [
  '#C75B3F',
  '#D4944A',
  '#48A88C',
  '#5A8CE8',
  '#9B6BD4',
  '#D45B8E',
  '#E07850',
  '#4CAF83',
  '#7C8FA6',
  '#B8A44A',
];

export function avatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function parseAddresses(json: string): { name: string; address: string }[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export function folderIcon(type: string): string {
  switch (type) {
    case 'inbox':
      return '📥';
    case 'sent':
      return '📤';
    case 'drafts':
      return '📝';
    case 'trash':
      return '🗑';
    case 'spam':
      return '⚠️';
    case 'starred':
      return '⭐';
    case 'archive':
      return '📦';
    case 'all':
      return '📬';
    case 'important':
      return '🔴';
    default:
      return '📁';
  }
}

// Folder display order
const FOLDER_ORDER: Record<string, number> = {
  inbox: 0,
  starred: 1,
  sent: 2,
  drafts: 3,
  important: 4,
  all: 5,
  spam: 6,
  trash: 7,
  archive: 8,
};

export function sortFolders<T extends { type: string; name: string }>(folders: T[]): T[] {
  return [...folders].sort((a, b) => {
    const oa = FOLDER_ORDER[a.type] ?? 50;
    const ob = FOLDER_ORDER[b.type] ?? 50;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });
}

export function accountInitial(type: string): string {
  return type === 'gmail' ? 'G' : 'I';
}

export function accountColor(type: string): string {
  return type === 'gmail' ? '#EA4335' : 'var(--accent)';
}

export function accountBgColor(type: string): string {
  return type === 'gmail' ? 'rgba(234,67,53,0.15)' : 'var(--accent-dim)';
}
