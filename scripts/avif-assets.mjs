import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import os from 'node:os';

export const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const avifPath = file => file.replace(/\.[^.\/]+$/, '.avif');

// Maps contain small serif labels and fine contours. Preserve those details
// with a higher-quality, full-chroma profile; portraits/icons stay compact.
export function imageSizeLimits() {
  const limits = new Map();
  for (const [name, sizeFor] of [['enemies', enemy => enemy.isBoss ? 256 : 128], ['heroes', () => 128]]) {
    const entries = JSON.parse(fs.readFileSync(`data/${name}.json`, 'utf8'));
    for (const entry of entries) for (const image of entry.images || []) {
      // A shared texture must satisfy the largest of its consumers.
      limits.set(image.path, Math.max(limits.get(image.path) || 0, sizeFor(entry)));
    }
  }
  return limits;
}

export function resizeImageMetadata(image, maxSize) {
  if (!maxSize || !(image.width > 0) || !(image.height > 0)) return;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  image.width = Math.max(1, Math.floor(image.width * scale));
  image.height = Math.max(1, Math.floor(image.height * scale));
}

export function compressionProfile(destination, sizeLimits = imageSizeLimits()) {
  const normalized = destination.replaceAll('\\', '/');
  if (normalized.startsWith('images/dungeons/combined/')) return {quality: 85, subsampling: '4:4:4', sharpen: true};
  if (/^(?:private\/)?images\/dungeons\/(maps|overview|full)\//.test(normalized)) return {quality: 85, subsampling: '4:4:4'};
  const maxSize = /^images\/(hero-items|modifiers|pois|relics)\//.test(normalized) ? 64 : sizeLimits.get(normalized);
  return {quality: 50, subsampling: '4:2:0', ...(maxSize ? {maxSize} : {})};
}

export function originalFor(image) {
  const sourcesFile='data/game-image-sources.json';
  if(fs.existsSync(sourcesFile)){
    const own=JSON.parse(fs.readFileSync(sourcesFile,'utf8'))[image];
    if(own){if(hashFile(own.source)!==own.sha256)throw new Error('Changed extracted image: '+own.source);return own.source;}
  }
  image = image.replace(/^private\/images\//, 'images/').replace(/^images\/dungeons\/overview\//, 'images/dungeons/maps/');
  if (!/^images\/[a-zA-Z0-9_./-]+$/.test(image) || image.split('/').includes('..')) throw new Error(`Invalid image path: ${image}`);
  const relative = image.slice('images/'.length);
  const roots = relative.startsWith('dungeons/full/')
    ? [['private/images-referenced', relative.slice('dungeons/full/'.length)]]
    : relative.startsWith('dungeons/combined/')
      ? [['private/images-combined', relative.slice('dungeons/combined/'.length)]]
      : [];
  for (const [root, name] of roots) {
    const directory = path.join(root, path.dirname(name));
    if (!fs.existsSync(directory)) continue;
    const stem = path.parse(name).name;
    const candidates = fs.readdirSync(directory).filter(file => path.parse(file).name === stem && /\.(webp|png|jpe?g|gif|svg|ico|avif)$/i.test(file));
    // Combined's SVG is the master; its PNG is a generated intermediate.
    const exact = candidates.find(file => file === path.basename(name) && !name.endsWith('.avif'));
    const selected = exact || (candidates.includes(stem + '.svg') ? stem + '.svg' : candidates.length === 1 ? candidates[0] : undefined);
    if (!selected && candidates.length > 1) throw new Error(`Ambiguous originals for ${image}: ${candidates.join(', ')}`);
    if (selected) return path.join(directory, selected).replaceAll('\\', '/');
  }
  throw new Error(`Missing private original for ${image}`);
}

export function combinedRasterSize(layout, dungeon) {
  const ratios = Object.entries(layout.artworkSources || layout.sources).flatMap(([id, transform]) => {
    const original = dungeon.mapImages.find(image => image.id === id);
    if (!original || !(transform.width > 0) || !(transform.height > 0)) throw new Error(`Missing artwork dimensions: ${id}`);
    return [original.width / transform.width, original.height / transform.height];
  });
  // Keep the logical map coordinates, but never enlarge any original artwork.
  const scale = Math.min(1, ...ratios);
  return {width: Math.max(1, Math.floor(layout.width * scale)), height: Math.max(1, Math.floor(layout.height * scale))};
}

export async function rasterizeSvg(source, size) {
  const destination = source.replace(/\.svg$/, '.png');
  const stamp = destination + '.source-sha256';
  const fingerprint = hashFile(source) + ';browser-raster-v2;' + JSON.stringify(size || null);
  let cached;
  try { cached = JSON.parse(fs.readFileSync(stamp, 'utf8')); } catch { /* Old or missing raster cache. */ }
  if (!fs.existsSync(destination) || cached?.fingerprint !== fingerprint || cached?.sha256 !== hashFile(destination)) {
    console.log(`Rasterizing: ${source}`);
    const temporary = destination + '.tmp';
    const svg = fs.readFileSync(source, 'utf8');
    const dimensions = svg.match(/<svg\b[^>]*\bwidth="(\d+)"\s+height="(\d+)"/);
    if (!dimensions) throw new Error(`SVG needs explicit pixel dimensions: ${source}`);
    const width = size?.width || Number(dimensions[1]), height = size?.height || Number(dimensions[2]);
    console.log(`Raster resolution: ${width} x ${height}`);
    const browser = await chromium.launch({headless: true,
      ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE}
        : process.platform === 'win32' ? {channel: 'msedge'} : {})});
    try {
      const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1});
      await page.goto(pathToFileURL(path.resolve(source)).href, {waitUntil: 'load'});
      await page.evaluate(({width,height}) => {
        document.documentElement.setAttribute('width', width);
        document.documentElement.setAttribute('height', height);
      }, {width,height});
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('image')].map(element => new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = resolve;
          image.onerror = () => reject(new Error('Embedded SVG image failed to load'));
          image.src = element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        })));
      });
      await page.screenshot({path: temporary, type: 'png', omitBackground: true, timeout: 180000});
      fs.renameSync(temporary, destination);
    } finally {
      await browser.close();
    }
    fs.writeFileSync(stamp, JSON.stringify({fingerprint, sha256: hashFile(destination)}));
  }
  return destination;
}

export async function compressImages(jobs) {
  const sizeLimits = imageSizeLimits();
  for (const job of jobs) Object.assign(job, {...compressionProfile(job.destination, sizeLimits), ...job});
  // Resolve every source before starting to avoid partial runs on missing inputs.
  for (const job of jobs) if (!fs.existsSync(job.source)) throw new Error(`Missing original: ${job.source}`);
  for (const job of jobs) if (job.source.endsWith('.svg')) job.source = await rasterizeSvg(job.source, job.rasterSize);
  fs.mkdirSync('private', {recursive: true});
  const manifest = `private/compress-jobs-${process.pid}.json`;
  fs.writeFileSync(manifest, JSON.stringify(jobs));
  try {
    const bundledPython = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    const virtualPython = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
    const python = process.env.PYTHON || (fs.existsSync(virtualPython) ? path.resolve(virtualPython)
      : process.platform === 'win32' && fs.existsSync(bundledPython) ? bundledPython : 'python');
    const result = spawnSync(python, ['scripts/compress-avif.py', '--batch', manifest], {stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('AVIF compression failed. Install Pillow with AVIF support and set PYTHON to its Python executable.');
  } finally {
    fs.unlinkSync(manifest);
  }
}

export function prunePublicImages(required) {
  const keep = new Set(required);
  for (const file of keep) if (!file.endsWith('.avif') || !fs.existsSync(file)) throw new Error(`Missing compressed output: ${file}`);
  let removed = 0;
  for (const entry of fs.readdirSync('images', {recursive: true, withFileTypes: true})) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name).replaceAll('\\', '/');
    if (keep.has(file)) continue;
    let original;
    try { original = originalFor(file); } catch { /* Preserve non-image authoring files below. */ }
    if (!original || hashFile(original) !== hashFile(file)) {
      const relative = file.slice('images/'.length);
      original = `private/assets/unused/${relative}`;
      if (fs.existsSync(original) && hashFile(original) !== hashFile(file)) original += '.' + hashFile(file);
      fs.mkdirSync(path.dirname(original), {recursive: true});
      fs.copyFileSync(file, original);
      if (hashFile(file) !== hashFile(original)) throw new Error(`Backup differs: ${file}`);
    }
    fs.unlinkSync(file);
    removed++;
  }
  const directories = fs.readdirSync('images', {recursive: true, withFileTypes: true})
    .filter(entry => entry.isDirectory()).map(entry => path.join(entry.parentPath, entry.name))
    .sort((a, b) => b.length - a.length);
  for (const directory of directories) if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  console.log(`Removed ${removed} obsolete public files; originals are private.`);
}
