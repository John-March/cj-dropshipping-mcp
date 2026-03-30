{
  "name": "cj-dropshipping-mcp",
  "version": "1.0.0",
  "description": "MCP server for CJ Dropshipping API",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
  import express from "express";
  import { z } from "zod";
  
  const CJ_BASE = "https://developers.cjdropshipping.com/api2.0";
  const PORT = process.env.PORT || 3000;
  const CJ_API_KEY = process.env.CJ_API_KEY;
  let tokenCache = { token: null, expiry: null };
  
  async function getAccessToken() {
      if (tokenCache.token && tokenCache.expiry && new Date() < new Date(tokenCache.expiry)) return tokenCache.token;
      const res = await fetch(CJ_BASE + "/v1/authentication/getAccessToken", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: CJ_API_KEY }) });
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

    server.tool("cj_search_products", "Search CJ Dropshipping catalogue by keyword", { keyword: z.string(), page: z.number().optional().default(1), pageSize: z.number().optional().default(20) }, async ({ keyword, page, pageSize }) => {
        const params = new URLSearchParams({ productNameEn: keyword, pageNum: page, pageSize });
        const data = await cjRequest("/v1/product/list?" + params);
        const products = (data.list || []).map(p => ({ pid: p.pid, name: p.productNameEn, image: p.productImage, sellPrice: p.sellPrice, categoryName: p.categoryName }));
        return { content: [{ type: "text", text: JSON.stringify({ total: data.total, products }, null, 2) }] };
    });

    server.tool("cj_get_product", "Get full product details from CJ", { pid: z.string() }, async ({ pid }) => {
        const data = await cjRequest("/v1/product/query?pid=" + pid);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });

    server.tool("cj_get_variants", "Get all variants for a CJ product", { pid: z.string() }, async ({ pid }) => {
        const data = await cjRequest("/v1/product/variant/query?pid=" + pid);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });

    server.tool("cj_get_shipping", "Get shipping costs to a country", { pid: z.string(), vid: z.string(), country: z.string(), quantity: z.number().optional().default(1) }, async ({ pid, vid, country, quantity }) => {
        const data = await cjRequest("/v1/logistic/freightCalculate", "POST", { pid, vid, country, quantity });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });

    server.tool("cj_get_categories", "List all CJ product categories", {}, async () => {
        const data = await cjRequest("/v1/product/getCategory");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });

    server.tool("cj_get_inventory", "Check stock levels for a CJ variant", { vid: z.string() }, async ({ vid }) => {
        const data = await cjRequest("/v1/product/stock/queryByVid?vid=" + vid);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });

    const app = express();
    app.use(express.json());

    const handle = async (req, res) => {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    };

    app.post("/mcp", handle);
    app.get("/mcp", handle);
    app.delete("/mcp", handle);
    app.get("/health", (_, res) => res.json({ status: "ok", service: "cj-mcp" }));
    app.listen(PORT, () => console.log("CJ MCP running on port " + PORT));
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.10.2",
    "express": "^4.18.2",
    "zod": "^3.22.4"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
