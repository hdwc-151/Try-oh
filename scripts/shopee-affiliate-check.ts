// Quick connectivity check for the Shopee Affiliate Open API, run on your own machine:
//   npx tsx scripts/shopee-affiliate-check.ts "áo thun nam"
// Reads SHOPEE_AFFILIATE_APP_ID / SHOPEE_AFFILIATE_SECRET (and optional
// SHOPEE_AFFILIATE_ENDPOINT) from .env. Prints a few products; never prints the secret.
import 'dotenv/config'
import { createShopeeAffiliateClientFromEnv, DEFAULT_SHOPEE_AFFILIATE_ENDPOINT, ShopeeAffiliateError } from '../server/shop/shopee-affiliate.js'

const keyword = process.argv[2] ?? 'áo thun'
const client = createShopeeAffiliateClientFromEnv()
if (!client) {
  console.error('Thiếu SHOPEE_AFFILIATE_APP_ID hoặc SHOPEE_AFFILIATE_SECRET trong .env')
  process.exit(1)
}
console.log(`Endpoint: ${process.env.SHOPEE_AFFILIATE_ENDPOINT?.trim() || DEFAULT_SHOPEE_AFFILIATE_ENDPOINT}`)

type Result = { productOfferV2: { nodes: Array<{ itemId: number | string; productName: string; offerLink: string }>; pageInfo: { hasNextPage: boolean } } }
try {
  const data = await client.query<Result>(`{ productOfferV2(keyword: ${JSON.stringify(keyword)}, limit: 3) { nodes { itemId productName offerLink } pageInfo { hasNextPage } } }`)
  console.log(`OK — ${data.productOfferV2.nodes.length} sản phẩm cho "${keyword}":`)
  for (const item of data.productOfferV2.nodes) console.log(`- ${item.itemId} · ${item.productName}\n  ${item.offerLink}`)
} catch (error) {
  if (error instanceof ShopeeAffiliateError) console.error(`Lỗi (${error.kind}${error.code ? `, mã ${error.code}` : ''}): ${error.message}`)
  else console.error(error)
  process.exit(1)
}
