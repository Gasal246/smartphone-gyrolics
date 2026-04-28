import type { NextConfig } from "next";
import os from "node:os";

const localHostnames = new Set<string>([os.hostname(), `${os.hostname()}.local`]);

for (const addresses of Object.values(os.networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === "IPv4" && !address.internal) {
      localHostnames.add(address.address);
    }
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["**.*", ...localHostnames],
  reactStrictMode: true,
};

export default nextConfig;
