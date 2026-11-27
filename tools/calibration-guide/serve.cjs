const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 3012);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer((req,res)=>{
  const name = new URL(req.url,'http://localhost').pathname;
  const target = path.resolve(base,'.'+(name==='/'?'/index.html':name));
  if (!target.startsWith(base+path.sep)) return res.writeHead(403).end();
  fs.readFile(target,(error,data)=>{if(error)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});res.end(data)});
}).listen(port,'127.0.0.1',()=>console.log(`ParkMap guide: http://127.0.0.1:${port}`));
