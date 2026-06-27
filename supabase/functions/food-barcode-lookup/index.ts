// food-barcode-lookup — proxy a food barcode to OpenFoodFacts and return mapped, bounded
// macros so the app can prefill the "add food" form (Slice G4).
//
// OpenFoodFacts is an open, keyless API; we still treat its response as UNTRUSTED — map only
// the fields we need and re-validate/bound them with Zod before returning (§4/§9). No data is
// stored. Per-user rate-limited via the ai_usage_events ledger (the proxy is a free network
// call, so cost stays null). Generic errors only (§4); all non-auth outcomes are 200 + a
// `status` discriminator (so supabase.functions.invoke doesn't surface them as errors).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { barcodeLookupSchema, barcodeFoodSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { HOUR_MS, recordUsage, withinLimit } from '../_shared/rate-limit.ts';

const RATE_LIMIT = 60; // per-user hourly
const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const parsed = barcodeLookupSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);
  const { barcode } = parsed.data;

  const svc = serviceClient();

  try {
    if (!(await withinLimit(svc, caller.id, 'food_barcode_lookup', RATE_LIMIT, HOUR_MS))) {
      return json({ status: 'rate_limited' }, 200);
    }
    await recordUsage(svc, caller.id, 'food_barcode_lookup', 'openfoodfacts');

    const url = `${OFF_BASE}/${barcode}.json?fields=product_name,nutriments,serving_quantity,serving_size`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'RaptorFitness/1.0 (pilot; barcode lookup)' } });
    } catch (e) {
      console.error('openfoodfacts fetch failed', { message: String(e) });
      return json({ status: 'failed' }, 200);
    }
    if (!res.ok) return json({ status: 'not_found' }, 200);

    const data = (await res.json().catch(() => null)) as
      | { status?: number; product?: Record<string, unknown> }
      | null;
    const product = data?.product;
    if (!data || data.status !== 1 || !product) return json({ status: 'not_found' }, 200);

    const n = (product.nutriments ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => Math.round(Number(v ?? 0));
    const name = String(product.product_name ?? '').trim().slice(0, 120);
    const servingSize = product.serving_size;
    const servingQty = product.serving_quantity;

    const mapped = {
      name,
      kcal_per_100g: num(n['energy-kcal_100g']),
      protein_g_per_100g: num(n['proteins_100g']),
      carbs_g_per_100g: num(n['carbohydrates_100g']),
      fat_g_per_100g: num(n['fat_100g']),
      serving_label: typeof servingSize === 'string' ? servingSize.slice(0, 40) : null,
      serving_grams: servingQty != null && Number(servingQty) > 0 ? Math.round(Number(servingQty)) : null,
      barcode,
    };

    // Require a usable record: a name + at least a calorie figure.
    const out = barcodeFoodSchema.safeParse(mapped);
    if (!out.success || !mapped.name || mapped.kcal_per_100g <= 0) {
      return json({ status: 'not_found' }, 200);
    }

    return json({ status: 'found', food: out.data }, 200);
  } catch (e) {
    console.error('food-barcode-lookup error', { message: String(e) });
    return json({ error: 'server_error' }, 500);
  }
});
