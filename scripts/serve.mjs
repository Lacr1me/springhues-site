import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp", ".woff2":"font/woff2" };

http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,"http://localhost").pathname);
    let file = path.join(root, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!path.resolve(file).startsWith(path.resolve(root))) throw new Error("Forbidden");
    if ((await stat(file)).isDirectory()) file = path.join(file,"index.html");
    response.writeHead(200,{"Content-Type":mime[path.extname(file).toLowerCase()] || "application/octet-stream","Cache-Control":"no-store"});
    response.end(await readFile(file));
  } catch {
    response.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
    response.end("Not found");
  }
}).listen(port,"127.0.0.1",() => console.log(`Preview: http://127.0.0.1:${port}`));
