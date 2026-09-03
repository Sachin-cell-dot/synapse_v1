import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '..', '..');
const target = resolve(here, '..', 'public', 'data');

await mkdir(target, { recursive: true });
await Promise.all([
  copyFile(
    resolve(workspace, 'outputs', 'synapse_wx_dashboard_forecasts.csv'),
    resolve(target, 'forecasts.csv'),
  ),
  copyFile(
    resolve(workspace, 'outputs', 'synapse_wx_dashboard_districts.geojson'),
    resolve(target, 'districts.geojson'),
  ),
]);

console.log('Dashboard data copied from the audited workspace outputs.');
