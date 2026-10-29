import type { NextConfig } from "next";
import { laboratory } from "./src/lib/development-lab";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: laboratory.allowedDevOrigins,
};

export default nextConfig;
