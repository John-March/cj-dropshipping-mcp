import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0";
const PORT = process.env.PORT || 3000;
const CJ_API_KEY = process.env.CJ_API_KEY;

let tokenCache = { token: null, expiry: null };

async function getAccessToken() {
  if (tokenCache.token && tokenCache.expiry && new Date() < new Date(tokenCache.expiry)) {
    return tokenCache.token;
  }
  const res = await fetch(CJ_BASE + "/v1/authentication/getAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: CJ_API_KEY }),
  });
  const data = await res.json();
  if (!data.result) throw new Error("CJ auth failed: " + data.message);
  tokenCache.token = data.data.accessToken;
  tokenCache.expiry = data.data.accessTokenExpiryDate;
  return tokenCache.token;
}

async function cjRequest(endpoint, method, body) {
  method = method || "GET";
  const token = await getAccessToken();
  const options = { method, headers: { "CJ-Access-Token": token, "Content-Type": "application/json" } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(CJ_BASE + endpoint, options);
  const data = await res.json();
  if (data.code !== 200) throw new Error("CJ API error: " + data.message);
  return data.data;
}

const server = new McpServer({ name: "cj-dropshipping", version: "1.0.0" });

server.tool("cj_search_products", "Search CJ Dropshipping catalogue by keyword", {
  keyword: z.string(), page: z.number().optional().default(1), pageSize: z.number().optional().default(20),
  minPrice: z.number().optional(), maxPrice: z.number().optional(),
}, async ({ keyword, page, pageSize, minPrice, maxPrice }) => {
  const params = new URLSearchParams({ productNameEn: keyword, pageNum: page, pageSize });
  if (minPrice) params.set("priceMin", minPrice);
  if (maxPrice) params.set("priceMax", maxPrice);
  const data = await cjRequest("/v1/product/list?" + params);
  const products = (data.list || []).map(p => ({ pid: p.pid, name: p.productNameEn, image: p.productImage, sellPrice: p.sellPrice, variants: p.variants ? p.variants.length : 0, categoryName: p.categoryName }));
  return { content: [{ type: "text", text: JSON.stringify({ total: data.total, page, products }, null, 2) }] };
});

server.tool("cj_get_product", "Get full details of a CJ product", { pid: z.string() }, async ({ pid }) => {
  const data = await cjRequest("/v1/product/query?pid=" + pid);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("cj_get_variants", "Get all variants for a CJ product with pricing", { pid: z.string() }, async ({ pid }) => {
  const data = await cjRequest("/v1/product/variant/query?pid=" + pid);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("cj_get_shipping", "Get shipping costs for a product to a country", {
  pid: z.string(), vid: z.string(), country: z.string(), quantity: z.number().optional().default(1),
}, async ({ pid, vid, country, quantity }) => {
  const data = await cjRequest("/v1/logistic/freightCalculate", "POST", { pid, vid, country, quantity });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("cj_get_order", "Get status and tracking of a CJ order", { orderId: z.string() }, async ({ orderId }) => {
  const data = await cjRequest("/v1/shopping/order/getOrderDetail?orderId=" + orderId);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("cj_get_categories", "List all CJ product categories", {}, async () => {
  const data = await cjRequest("/v1/product/getCategory");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("cj_get_inventory", "Check stock levels for a CJ product variant", { vid: z.string() }, async ({ vid }) => {
  const data = await cjRequest("/v1/product/stock/queryByVid?vid=" + vid);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
});
app.delete("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
});
app.get("/health", (_, res) => res.json({ status: "ok", service: "cj-mcp" }));

app.listen(PORT, () => console.log("CJ MCP server running on port " + PORT));
