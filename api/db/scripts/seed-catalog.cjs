/**
 * Rich dev catalog seed — idempotent (ON CONFLICT DO NOTHING).
 * Adds varied categories+subcategories, brands, products (gender,
 * compare_at_price, tags), variants (letter + numeric shoe sizes, colors,
 * stock) and product images so the storefront filtering system has real data.
 *
 * Run:  node db/scripts/seed-catalog.cjs
 * (uses DATABASE_URL from .env, or the local dev default below)
 */
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  try {
    const p = path.join(__dirname, "..", "..", ".env");
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* ignore */ }
}
loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // No hardcoded fallback credential here on purpose — a seed script
  // silently defaulting to a real (superuser) connection string if the
  // environment is misconfigured is itself a bad pattern, separate from
  // the fact that the previous fallback value was an exposed real
  // credential. Fail loudly instead.
  console.error("DATABASE_URL is not set. Set it in your environment (see .env.example) before running this script.");
  process.exit(1);
}

// Reusable, stable image URLs (placeholder fashion imagery already used by the
// storefront, so they resolve rather than 404ing).
const IMG = [
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_4388ad6a3e_effb5cdcc9a65c6d.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_5758fdb691_996cfb5b68aba7c3.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_829db95645_bfd73a88bf43694f.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_4e7624a7b5_2cfbdac8030d744a.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_74c8f9ba6b_9a37710e94d5c07b.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_5e478dac61_6a402d4542d508df.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_87c1ace3ee_917d1b387b4da4c8.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_205b7ede03_3f09b9b9e5bcafdd.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_fca3a7917a_08b173fe2528f411.png",
  "https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_fc20c58299_b2aa3b0755e92c6d.png",
];
const pick = (i) => IMG[i % IMG.length];

// Categories: slug -> { name, parent }
const CATEGORIES = {
  clothing: { name: "Clothing", parent: null },
  "tops": { name: "Tops", parent: "clothing" },
  "dresses": { name: "Dresses", parent: "clothing" },
  "outerwear": { name: "Outerwear", parent: "clothing" },
  "pants": { name: "Pants", parent: "clothing" },
  "knitwear": { name: "Knitwear", parent: "clothing" },
  shoes: { name: "Shoes", parent: null },
  "sneakers": { name: "Sneakers", parent: "shoes" },
  "boots": { name: "Boots", parent: "shoes" },
  "heels": { name: "Heels", parent: "shoes" },
  "sandals": { name: "Sandals", parent: "shoes" },
  bags: { name: "Bags", parent: null },
  "totes": { name: "Totes", parent: "bags" },
  "crossbody": { name: "Crossbody", parent: "bags" },
  "backpacks": { name: "Backpacks", parent: "bags" },
  "clutches": { name: "Clutches", parent: "bags" },
  accessories: { name: "Accessories", parent: null },
  "belts": { name: "Belts", parent: "accessories" },
  "hats": { name: "Hats", parent: "accessories" },
  "sunglasses": { name: "Sunglasses", parent: "accessories" },
  "jewelry": { name: "Jewelry", parent: "accessories" },
  activewear: { name: "Activewear", parent: null },
  "leggings": { name: "Leggings", parent: "activewear" },
  "sportswear": { name: "Sportswear", parent: "activewear" },
};

const BRANDS = ["Nike", "Adidas", "Gucci", "Zara", "Calvin Klein", "H&M", "Balenciaga", "Puma", "New Balance", "Uniqlo", "The North Face", "Levis"];

// [name, brand, category(leaf), price_cents, compare_at_cents|null, gender, colors:[...], sizes, tags]
const PRODUCTS = [
  ["Oversized Linen Blazer", "Zara", "outerwear", 12900, 18900, "women", ["Black", "Beige"], ["S","M","L","XL"], ["trending"]],
  ["Minimal Leather Tote", "Gucci", "totes", 15900, null, "unisex", ["Black","Tan"], ["One Size"], []],
  ["Classic White Sneakers", "Nike", "sneakers", 9900, 13900, "men", ["White","Black"], ["7","8","9","9.5","10","11"], ["trending","campus"]],
  ["Silk Slip Dress", "Zara", "dresses", 18900, 24900, "women", ["Burgundy","Navy","Black"], ["XS","S","M","L"], ["new","trending"]],
  ["Tailored Wool Blazer", "H&M", "outerwear", 17800, null, "men", ["Charcoal","Navy"], ["S","M","L","XL"], []],
  ["Structured Leather Bag", "Gucci", "crossbody", 18900, 22900, "unisex", ["Black"], ["One Size"], ["premium"]],
  ["Leather Chelsea Boots", "Zara", "boots", 14900, 19900, "unisex", ["Brown","Black"], ["7","8","9","10","11"], []],
  ["Minimal Runner", "Nike", "sneakers", 11000, null, "unisex", ["Grey","White","Black"], ["7","8","9","9.5","10","11"], ["new","trending"]],
  ["Ribbed Knit Set", "H&M", "knitwear", 9800, 12900, "women", ["Cream","Black","Rose"], ["XS","S","M","L"], ["trending"]],
  ["Oversized Technical Jacket", "The North Face", "outerwear", 16900, null, "unisex", ["Black","Olive"], ["S","M","L","XL"], []],
  ["High-Waist Skinny Jeans", "Levis", "pants", 8400, 10900, "women", ["Blue","Black"], ["24","26","28","30"], ["campus"]],
  ["Classic Straight Jeans", "Levis", "pants", 8900, null, "men", ["Blue"], ["30","32","34","36"], []],
  ["Logo Hoodie", "Adidas", "sportswear", 7200, 9500, "unisex", ["Black","White","Grey"], ["S","M","L","XL"], ["campus","trending"]],
  ["Crop Top", "Zara", "tops", 5900, null, "women", ["White","Black","Pink"], ["XS","S","M"], ["new"]],
  ["Linen Shirt", "Uniqlo", "tops", 8900, 11900, "men", ["White","Blue","Beige"], ["S","M","L","XL"], []],
  ["Leather Crossbody", "Calvin Klein", "crossbody", 13900, 17900, "unisex", ["Black","Cognac"], ["One Size"], ["premium"]],
  ["Running Trainers", "New Balance", "sneakers", 12500, 16500, "unisex", ["Grey","Navy","White"], ["7","8","9","10","11","12"], ["new"]],
  ["Ankle Boots", "Calvin Klein", "boots", 15900, null, "women", ["Black","Tan"], ["6","7","8","9"], []],
  ["Block Heel Sandals", "Zara", "heels", 8200, null, "women", ["Black","Nude"], ["6","7","8","9"], ["new"]],
  ["Platform Sneakers", "Gucci", "sneakers", 21900, 26900, "women", ["White","Silver"], ["6","7","8","9","10"], ["premium"]],
  ["Backpack", "H&M", "backpacks", 6900, null, "unisex", ["Black","Olive"], ["One Size"], ["campus"]],
  ["Wool Scarf", "Uniqlo", "accessories", 4800, 6900, "unisex", ["Grey","Red","Beige"], ["One Size"], []],
  ["Bucket Hat", "New Balance", "hats", 3900, null, "unisex", ["Black","Beige"], ["One Size"], ["campus"]],
  ["Aviator Sunglasses", "Gucci", "sunglasses", 16800, 19800, "unisex", ["Gold","Black"], ["One Size"], ["premium"]],
  ["Gold Hoop Earrings", "H&M", "jewelry", 2900, 4500, "women", ["Gold","Silver"], ["One Size"], []],
  ["Leggings", "Nike", "leggings", 6400, 8500, "women", ["Black","Navy"], ["XS","S","M","L"], ["activewear"]],
  ["Performance Tee", "Adidas", "sportswear", 5200, null, "men", ["Black","White"], ["S","M","L","XL"], ["activewear"]],
  ["Denim Jacket", "Levis", "outerwear", 11900, 14900, "unisex", ["Blue","Black"], ["S","M","L","XL"], []],
  ["Pleated Midi Skirt", "Zara", "dresses", 9200, null, "women", ["Black","Beige"], ["XS","S","M","L"], ["new","trending"]],
  ["Tailored Chinos", "Zara", "pants", 7800, null, "men", ["Khaki","Navy","Black"], ["30","32","34","36"], []],
  ["Cashmere Crewneck", "Gucci", "knitwear", 24900, 29900, "unisex", ["Charcoal","Cream"], ["S","M","L"], ["premium"]],
  ["Fleece Zip Hoodie", "The North Face", "outerwear", 10500, 13500, "unisex", ["Black","Navy"], ["S","M","L","XL"], []],
  ["Slides", "Nike", "sandals", 4900, 6500, "unisex", ["Black","White"], ["7","8","9","10","11"], ["campus"]],
  ["Puffer Coat", "The North Face", "outerwear", 24900, 32900, "unisex", ["Black","Red"], ["S","M","L","XL"], []],
  ["Silk Camisole", "Zara", "tops", 6800, null, "women", ["Cream","Black"], ["XS","S","M"], []],
  ["Wide-Leg Trousers", "H&M", "pants", 9500, 12500, "women", ["Black","Grey"], ["S","M","L"], []],
  ["Court Sneakers", "Puma", "sneakers", 7900, 9900, "unisex", ["White","Black","Red"], ["7","8","9","10","11"], []],
  ["Weekender Duffel", "Calvin Klein", "totes", 17900, 21900, "unisex", ["Black"], ["One Size"], ["premium"]],
  ["V-Neck Sweater", "Uniqlo", "knitwear", 7600, null, "men", ["Navy","Grey","Green"], ["S","M","L","XL"], []],
  ["Chunky Platform Boots", "Puma", "boots", 14900, 18500, "women", ["Black","White"], ["7","8","9","10"], ["trending"]],
];

async function main() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  // Categories (parents first so parent ids exist — CATEGORIES order already does)
  const catId = {};
  for (const slug of Object.keys(CATEGORIES)) {
    const { name, parent } = CATEGORIES[slug];
    await c.query(
      `INSERT INTO categories (slug, name, parent_id) VALUES ($1,$2,NULL) ON CONFLICT (slug) DO NOTHING`,
      [slug, name]
    );
  }
  for (const slug of Object.keys(CATEGORIES)) {
    const { parent } = CATEGORIES[slug];
    if (!parent) continue;
    const r = await c.query(`SELECT id FROM categories WHERE slug=$1`, [parent]);
    const pid = r.rows[0]?.id;
    await c.query(`UPDATE categories SET parent_id=$2 WHERE slug=$1 AND parent_id IS NULL`, [slug, pid]);
  }
  const allCat = await c.query(`SELECT id, slug FROM categories`);
  for (const row of allCat.rows) catId[row.slug] = row.id;

  const brandId = {};
  for (const b of BRANDS) {
    const r = await c.query(`SELECT id FROM brands WHERE slug=$1`, [b.toLowerCase().replace(/\s+/g, "-")]);
    if (!r.rows[0]) {
      const ins = await c.query(`INSERT INTO brands (slug, name) VALUES ($1,$2) RETURNING id`, [b.toLowerCase().replace(/\s+/g, "-"), b]);
      brandId[b] = ins.rows[0].id;
    } else brandId[b] = r.rows[0].id;
  }

  let prodIdx = 0;
  for (const [name, brand, catSlug, price, compare, gender, colors, sizes, tags] of PRODUCTS) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const ins = await c.query(
      `INSERT INTO products (slug, name, brand_id, category_id, price_cents, compare_at_price_cents, gender, tags, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true, now() - ($9 || ' days')::interval)
       ON CONFLICT (slug) DO UPDATE SET
         brand_id = EXCLUDED.brand_id,
         category_id = EXCLUDED.category_id,
         price_cents = EXCLUDED.price_cents,
         compare_at_price_cents = EXCLUDED.compare_at_price_cents,
         gender = EXCLUDED.gender,
         tags = EXCLUDED.tags,
         active = true
       RETURNING id`,
      [slug, name, brandId[brand], catId[catSlug], price, compare, gender, tags, prodIdx]
    );
    const pid = ins.rows[0].id;

    // Authoritative gender model is the many-to-many join (migration 0011) —
    // `products.gender` is legacy and ignored by the storefront filter. Map:
    //   women  -> [women]
    //   men    -> [men]
    //   unisex -> [women, men, unisex] so unisex pieces surface on both gender
    //             pages AND the "unisex" gender filter (ANY-match semantics).
    const audiences =
      gender === "women" ? ["women"] :
      gender === "men" ? ["men"] :
      ["women", "men", "unisex"];
    for (const aud of audiences) {
      await c.query(
        `INSERT INTO product_gender_audiences (product_id, gender_audience_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [pid, aud]
      );
    }

    // Link to the "Campus outfit" lifestyle if the product carries the campus
    // tag, so lifestyle pages also have organic data (join is ANY-match).
    if (tags.includes("campus")) {
      const life = await c.query(`SELECT id FROM lifestyles WHERE slug='campus' OR name ILIKE '%campus%'`);
      if (life.rows[0]) {
        await c.query(
          `INSERT INTO product_lifestyles (product_id, lifestyle_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [pid, life.rows[0].id]
        );
      }
    }

    // variants: color x size, with some out-of-stock + low-stock sprinkled in
    const vrows = [];
    colors.forEach((color, ci) => {
      sizes.forEach((size, si) => {
        let stock = color === "Default" ? 25 : 8;
        if ((prodIdx + ci) % 9 === 0) stock = 0;          // some out of stock
        else if ((prodIdx + si) % 7 === 0) stock = 3;      // some low stock
        vrows.push([pid, size, color, stock]);
      });
    });
    for (const v of vrows) {
      await c.query(
        `INSERT INTO product_variants (product_id, size, color, stock_qty) VALUES ($1,$2,$3,$4) ON CONFLICT (product_id,size,color) DO NOTHING`,
        v
      );
    }

    // images (skip if this product already has any, so re-runs are idempotent)
    const existingImg = await c.query(`SELECT 1 FROM product_images WHERE product_id=$1 LIMIT 1`, [pid]);
    if (!existingImg.rows[0]) {
      for (let im = 0; im < 3; im++) {
        await c.query(
          `INSERT INTO product_images (product_id, url, position) VALUES ($1,$2,$3)`,
          [pid, pick(prodIdx + im), im]
        );
      }
    }
    prodIdx++;
  }

  const counts = await c.query(
    `SELECT (SELECT count(*)::int FROM products) products, (SELECT count(*)::int FROM product_variants) variants, (SELECT count(*)::int FROM categories) categories, (SELECT count(*)::int FROM brands) brands, (SELECT count(*)::int FROM product_images) images`
  );
  console.log("SEED OK", JSON.stringify(counts.rows[0]));
  await c.end();
}

main().catch((e) => { console.error("SEED ERR", e); process.exit(1); });
