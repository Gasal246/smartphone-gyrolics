const express = require("express");
const cors = require("cors");
const dgram = require("dgram");

const app = express();
const UDP_PORT = 41234;
const HTTP_PORT = 3000;

app.use(cors());
app.use(express.json());

// Normal Express test route
app.get("/", (req, res) => {
  res.send("UDP + Express server is running");
});

// UDP Server
const udpServer = dgram.createSocket("udp4");

udpServer.on("listening", () => {
  const address = udpServer.address();
  console.log(`UDP server listening on ${address.address}:${address.port}`);
});

udpServer.on("message", (message, remote) => {
  console.log("----- UDP MESSAGE RECEIVED -----");
  console.log("From:", `${remote.address}:${remote.port}`);
  console.log("Raw Buffer:", message);
  console.log("Text:", message.toString());

  try {
    const json = JSON.parse(message.toString());
    console.log("JSON:", json);
  } catch {
    console.log("Message is not JSON");
  }

  console.log("--------------------------------");
});

udpServer.on("error", (err) => {
  console.error("UDP Server Error:", err);
  udpServer.close();
});

udpServer.bind(UDP_PORT, "0.0.0.0");

// Express Server
app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`Express server running on http://0.0.0.0:${HTTP_PORT}`);
});