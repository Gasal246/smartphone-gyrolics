import dgram from "node:dgram";
import http from "node:http";
import os from "node:os";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const udpPort = Number(process.env.UDP_PORT || 41234);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const getLanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);

const envelope = (kind, data = {}) =>
  JSON.stringify({
    kind,
    serverTime: new Date().toISOString(),
    ...data
  });

await app.prepare();

const sendJson = (res, data) => {
  res.writeHead(200, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json"
  });
  res.end(JSON.stringify(data));
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

  if (pathname === "/api/runtime") {
    sendJson(res, {
      udpPort,
      webPort: port,
      lanAddresses: getLanAddresses()
    });
    return;
  }

  if (pathname === "/api/latest") {
    sendJson(res, {
      latest: latestPayload,
      latestRawPacket,
      stats: { receivedPackets, invalidPackets }
    });
    return;
  }

  handle(req, res);
});

const wss = new WebSocketServer({ noServer: true });
let latestPayload = null;
let latestRawPacket = null;
let receivedPackets = 0;
let invalidPackets = 0;

const broadcast = (message) => {
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
};

wss.on("connection", (ws) => {
  ws.send(
    envelope("hello", {
      config: {
        udpPort,
        webPort: port,
        lanAddresses: getLanAddresses()
      },
      stats: { receivedPackets, invalidPackets },
      latest: latestPayload
    })
  );
});

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

  if (pathname !== "/telemetry") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

const udp = dgram.createSocket("udp4");

udp.on("message", (buffer, remote) => {
  const text = buffer.toString("utf8");
  const receivedAtServer = new Date().toISOString();
  latestRawPacket = {
    bytes: buffer.length,
    receivedAtServer,
    remote: `${remote.address}:${remote.port}`,
    text
  };

  console.log("----- UDP MESSAGE RECEIVED -----");
  console.log("From:", latestRawPacket.remote);
  console.log("Bytes:", buffer.length);
  console.log("Text:", text);

  try {
    const payload = JSON.parse(text);
    receivedPackets += 1;
    latestPayload = {
      payload,
      meta: {
        bytes: buffer.length,
        receivedAtServer,
        remote: `${remote.address}:${remote.port}`,
        receivedPackets,
        invalidPackets
      }
    };

    console.log("JSON type:", payload?.type ?? "unknown");
    console.log("Valid JSON packets:", receivedPackets);
    broadcast(envelope("telemetry", latestPayload));
  } catch (error) {
    invalidPackets += 1;
    console.log("Message is not JSON:", error instanceof Error ? error.message : "Invalid UDP JSON");
    broadcast(
      envelope("invalid", {
        error: error instanceof Error ? error.message : "Invalid UDP JSON",
        raw: latestRawPacket,
        meta: {
          bytes: buffer.length,
          receivedAtServer,
          remote: `${remote.address}:${remote.port}`,
          receivedPackets,
          invalidPackets
        }
      })
    );
  }

  console.log("--------------------------------");
});

udp.on("listening", () => {
  const addresses = getLanAddresses();
  console.log(`Web dashboard: http://localhost:${port}`);
  for (const address of addresses) {
    console.log(`LAN dashboard: http://${address}:${port}`);
  }
  console.log(`UDP listener: 0.0.0.0:${udpPort}`);
});

udp.on("error", (error) => {
  console.error("UDP Server Error:", error);
  udp.close();
});

udp.bind(udpPort, "0.0.0.0");

server.listen(port, hostname);
