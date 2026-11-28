import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  ...(process.env.TUHOC_LOCAL_PREVIEW === "1" ? {
    distDir: ".sites-runtime/next-local",
    typescript: { tsconfigPath: "tsconfig.tuhoc-local.json" },
  } : {}),
};

export default nextConfig;
