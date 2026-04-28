import dgram from "node:dgram";

const host = process.env.UDP_HOST || "127.0.0.1";
const port = Number(process.env.UDP_PORT || 41234);
const socket = dgram.createSocket("udp4");

let sequence = 0;

const packet = () => {
  const now = new Date().toISOString();
  const wave = sequence / 10;
  const x = Math.sin(wave);
  const y = Math.cos(wave * 0.73);
  const z = Math.sin(wave * 0.41 + 1.5);

  return {
    type: "phone-motion",
    sentAt: now,
    intervalMs: 100,
    telemetry: {
      gyroscope: {
        source: "gyroscope",
        units: "radians/second",
        receivedAt: now,
        sequence,
        data: {
          x: x * 0.8,
          y: y * 0.65,
          z: z * 0.5,
          timestamp: sequence
        }
      },
      accelerometer: {
        source: "accelerometer",
        units: "g-force",
        receivedAt: now,
        sequence,
        data: {
          x: x * 0.18,
          y: y * 0.18,
          z: 0.98 + z * 0.1,
          timestamp: sequence
        }
      },
      magnetometer: {
        source: "magnetometer",
        units: "microtesla",
        receivedAt: now,
        sequence,
        data: {
          x: -27 + x * 20,
          y: 4 + y * 18,
          z: -29 + z * 16,
          timestamp: sequence
        }
      },
      deviceMotion: {
        source: "deviceMotion",
        units: "mixed: m/s^2, degrees/second, degrees",
        receivedAt: now,
        sequence,
        data: {
          orientation: 0,
          interval: 100,
          acceleration: {
            x: x * 0.4,
            y: y * 0.4,
            z: z * 0.4,
            timestamp: sequence
          },
          rotation: {
            alpha: x * 35,
            beta: y * 28,
            gamma: z * 31,
            timestamp: sequence
          },
          rotationRate: {
            alpha: y * 2,
            beta: z * 1.7,
            gamma: x * 2.1,
            timestamp: sequence
          },
          accelerationIncludingGravity: {
            x: x * 1.5,
            y: y * 1.8,
            z: -9.81 + z,
            timestamp: sequence
          }
        }
      }
    }
  };
};

console.log(`Sending sample UDP telemetry to ${host}:${port}`);

const send = () => {
  sequence += 1;
  const message = Buffer.from(JSON.stringify(packet()));
  socket.send(message, port, host);
};

send();
const timer = setInterval(send, 100);

process.on("SIGINT", () => {
  clearInterval(timer);
  try {
    socket.close();
  } catch {
    // The socket may already be closed when Ctrl-C lands between sends.
  }
  process.exit(0);
});
