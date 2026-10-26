/**
 * Creates one folder per liked model under ./photos/, each with the listing
 * text alongside it. Drop your real photos of the printed object into the
 * matching folder and everything for that listing lives in one place.
 *
 *   npm run photos
 */
import './_env';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getLikedModels } from '../src/lib/queries';
import { buildListing } from '../src/lib/listing';

const ROOT = path.join(process.cwd(), 'photos');

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

async function main() {
  const liked = await getLikedModels();
  if (liked.length === 0) {
    console.log('Nothing liked yet — swipe some models first.');
    return;
  }

  mkdirSync(ROOT, { recursive: true });
  let created = 0;

  for (const m of liked) {
    const dir = path.join(ROOT, `${m.id}-${slug(m.name)}`);
    const isNew = !existsSync(dir);
    mkdirSync(dir, { recursive: true });

    const l = buildListing({
      name: m.name,
      creator: m.creator,
      url: m.url,
      category: m.category,
      license: m.license,
    });

    // Listing text next to the photos, so nothing has to be looked up later.
    writeFileSync(
      path.join(dir, 'anunt.txt'),
      [
        `TITLU:\n${l.title}`,
        '',
        `PRET: ${l.priceSuggested} lei  (interval piata ${l.priceMin}-${l.priceMax})`,
        '',
        `CATEGORIE OLX: ${l.olxCategory}`,
        `CATEGORIE VINTED: ${l.vintedCategory}`,
        '',
        `LICENTA: ${m.license ?? '?'} — ${l.licenseWarning ?? 'ok de vandut'}`,
        '',
        `MODEL: ${m.url}`,
        '',
        'DESCRIERE:',
        l.description,
        '',
        'ETICHETE: ' + l.tags.join(', '),
        '',
        '--- POZE ---',
        'Pune aici pozele TALE cu obiectul printat. 4-6 bucati:',
        '  1-fata.jpg      obiectul din fata, 3/4 stanga',
        '  2-detaliu.jpg   prim-plan pe o suprafata / detaliu',
        '  3-scara.jpg     langa ceva de dimensiune cunoscuta (moneda, pix)',
        '  4-utilizare.jpg obiectul folosit / pus la locul lui',
        '  5-spate.jpg     (optional)',
        '  6-culori.jpg    (optional) acelasi obiect in 2-3 culori',
        '',
        'Lumina de la geam, fundal simplu, fara blitz.',
      ].join('\n'),
      'utf8'
    );

    if (isNew) created++;
  }

  console.log(`photos/ ready — ${liked.length} folders (${created} new)`);
  console.log(`root: ${ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
