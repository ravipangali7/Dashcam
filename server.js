require("dotenv").config();

const net = require("node:net");

const PORT = Number(process.env.PORT) || 9000;
const HOST = process.env.HOST || "0.0.0.0";

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`client connected: ${remote}`);

  socket.setEncoding("utf8");

  socket.on("data", (chunk) => {
    process.stdout.write(`[${remote}] ${chunk}`);
    socket.write(chunk);
  });

  socket.on("end", () => {
    console.log(`client disconnected: ${remote}`);
  });

  socket.on("error", (err) => {
    console.error(`socket error (${remote}):`, err.message);
  });
});

server.on("error", (err) => {
  console.error("server error:", err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(`TCP listening on ${addr.address}:${addr.port}`);
});
