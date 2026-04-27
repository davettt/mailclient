import fs from 'fs';
import path from 'path';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'local_data', '.git', 'logs']);
const ROOT = path.resolve(__dirname, '../../..');
const SRC_DIR = path.join(ROOT, 'src');

function newestMtime(dir: string): number {
  let newest = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        newest = Math.max(newest, newestMtime(full));
      } else {
        if (entry.name.endsWith('.log')) continue;
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    }
  } catch {
    /* directory doesn't exist */
  }
  return newest;
}

export function checkBuildStale(): { buildStale: boolean; lastBuild: number | null } {
  const lastBuildPath = path.join(ROOT, '.last-build');
  let lastBuild: number | null = null;
  try {
    lastBuild = parseInt(fs.readFileSync(lastBuildPath, 'utf-8').trim());
  } catch {
    return { buildStale: true, lastBuild: null };
  }

  const newest = newestMtime(SRC_DIR);
  return { buildStale: newest > lastBuild, lastBuild };
}
