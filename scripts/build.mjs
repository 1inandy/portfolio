import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(projectRoot, 'dist');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, 'server'), { recursive: true });

await Promise.all([
  cp(resolve(projectRoot, 'assets'), resolve(outputRoot, 'assets'), { recursive: true }),
  cp(resolve(projectRoot, 'index.html'), resolve(outputRoot, 'index.html')),
  cp(resolve(projectRoot, 'worker/index.js'), resolve(outputRoot, 'server/index.js'))
]);

// hosting config is local-only (gitignored), so a fresh clone builds without it
const hosting = resolve(projectRoot, '.openai/hosting.json');
if (await access(hosting).then(() => true, () => false)) {
  await mkdir(resolve(outputRoot, '.openai'), { recursive: true });
  await cp(hosting, resolve(outputRoot, '.openai/hosting.json'));
}

const indexPath = resolve(outputRoot, 'index.html');
const index = await readFile(indexPath, 'utf8');
await writeFile(indexPath, index.replaceAll('href="assets/', 'href="/assets/').replaceAll('src="assets/', 'src="/assets/'));

console.log('Built the portfolio for Sites.');
