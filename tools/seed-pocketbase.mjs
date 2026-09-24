// Seeds a PocketBase database with the workbook's starting data
// (js/seedData.js): the three settings rows and the 28 ingredients.
// Safe to re-run: it only creates what's missing, and never touches
// ingredients at all once any exist.
//
// Usage: node tools/seed-pocketbase.mjs <url> <superuser-email> <superuser-password>
import { pathToFileURL } from 'node:url';
import PocketBase from '../js/vendor/pocketbase.es.mjs';
import { INGREDIENTS, NPN_SAFETY_LIMITS, NUTRIENT_TARGETS, PRODUCTION_TARGETS } from '../js/seedData.js';
import { ingredientToRecord } from '../js/pocketbaseMappers.js';

export async function seed(pb) {
  let settingsCreated = 0;
  const settings = {
    npn_safety_limits: NPN_SAFETY_LIMITS,
    nutrient_targets: NUTRIENT_TARGETS,
    production_targets: PRODUCTION_TARGETS,
  };
  for (const [key, value] of Object.entries(settings)) {
    const existing = await pb.collection('settings')
      .getFirstListItem(pb.filter('key = {:key}', { key }))
      .catch((err) => { if (err.status === 404) return null; throw err; });
    if (!existing) {
      await pb.collection('settings').create({ key, value });
      settingsCreated++;
    }
  }

  let ingredientsCreated = 0;
  const { totalItems } = await pb.collection('ingredients').getList(1, 1);
  if (totalItems === 0) {
    for (const ingredient of INGREDIENTS) {
      await pb.collection('ingredients').create({ ...ingredientToRecord(ingredient), is_active: true });
      ingredientsCreated++;
    }
  }
  return { ingredientsCreated, settingsCreated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, email, password] = process.argv.slice(2);
  if (!url || !email || !password) {
    console.error('Usage: node tools/seed-pocketbase.mjs <url> <superuser-email> <superuser-password>');
    process.exit(1);
  }
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(email, password);
  console.log(await seed(pb));
}
