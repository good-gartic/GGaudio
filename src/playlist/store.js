import {mkdirSync, readFileSync, writeFileSync, renameSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
export const directory = resolve(process.env.SPOTIFY_DATA_DIR || './data/spotify-playlist');
mkdirSync(directory, {recursive:true, mode:0o700});
export function load(name, fallback) {
  const path = join(directory, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}
export function save(name, value) {
  const path = join(directory, name);
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), {mode:0o600});
  renameSync(`${path}.tmp`, path);
}
