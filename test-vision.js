/**
 * Quick Vision vinyl test. Run with:
 *   node test-vision.js                 # uses default test URL
 *   node test-vision.js <image-url>     # test a URL
 *   node test-vision.js <local-path>    # test a local file
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { detectWebEntities, extractVinylInfoFromWebDetection } = require('./services/googleVisionService');
const { searchVinyl, getDetailedRelease } = require('./services/discogsService');

const DEFAULT_URL = 'https://coverartarchive.org/release/1122464e-56c9-4e4e-a2e1-5bfd12ad056b/41963476049-500.jpg';

async function loadImage(input) {
  if (!input) input = DEFAULT_URL;

  if (input.startsWith('http://') || input.startsWith('https://')) {
    console.log(`\nDownloading: ${input}`);
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  }

  const resolved = path.resolve(input);
  console.log(`\nLoading local file: ${resolved}`);
  return fs.readFileSync(resolved).toString('base64');
}

async function main() {
  console.log('=== Vision Vinyl Fallback Test ===');

  if (!process.env.GOOGLE_CLOUD_API_KEY) {
    console.error('ERROR: GOOGLE_CLOUD_API_KEY not set');
    process.exit(1);
  }

  const base64 = await loadImage(process.argv[2]);
  console.log(`Image size: ${(base64.length * 0.75 / 1024).toFixed(0)} KB\n`);

  console.log('--- Test 1: WEB_DETECTION ---');
  const web = await detectWebEntities(base64);
  if (!web) { console.error('FAIL'); process.exit(1); }

  console.log('Best guess labels:');
  (web.bestGuessLabels || []).forEach(l => console.log(`  - ${l.label}`));

  console.log('\nTop web entities:');
  (web.webEntities || []).slice(0, 10).forEach(e =>
    console.log(`  - ${e.description || '(no desc)'} (score: ${e.score?.toFixed(3) || 'n/a'})`)
  );

  console.log('\nMatching pages (first 5):');
  (web.pagesWithMatchingImages || []).slice(0, 5).forEach(p =>
    console.log(`  - ${p.url}`)
  );

  console.log('\n--- Test 2: Extraction ---');
  const info = extractVinylInfoFromWebDetection(web);
  if (!info) { console.warn('No vinyl info extracted'); return; }

  console.log(`Artist:             ${info.artist}`);
  console.log(`Album:              ${info.album}`);
  console.log(`Year:               ${info.release_year || 'unknown'}`);
  console.log(`Discogs page URL:   ${info.discogs_page_url || 'none'}`);
  console.log(`Discogs release ID: ${info.discogs_release_id || 'none'}`);
  console.log(`Confidence:         ${info.confidence}`);

  if (!process.env.DISCOGS_API_KEY) return;

  console.log('\n--- Test 3: Discogs lookup ---');
  let data = null;
  if (info.discogs_release_id) {
    console.log(`Direct release lookup (${info.discogs_release_id})`);
    data = await getDetailedRelease(info.discogs_release_id, process.env.DISCOGS_API_KEY, process.env.DISCOGS_API_SECRET);
  } else if (info.artist) {
    console.log(`Search lookup...`);
    data = await searchVinyl(info.artist, info.album, info.release_year);
  }

  if (!data) { console.warn('No Discogs match'); return; }

  console.log(`\n  Artist:     ${data.artist}`);
  console.log(`  Album:      ${data.album}`);
  console.log(`  Year:       ${data.release_year}`);
  console.log(`  Label:      ${data.label}`);
  console.log(`  Format:     ${data.format}`);
  console.log(`  Price:      ${data.discogs_avg_price ? `${data.discogs_currency || 'EUR'} ${data.discogs_avg_price}` : 'n/a'}`);
  console.log(`  URL:        ${data.discogs_url}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
