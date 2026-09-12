import type { NextConfig } from "next";

/**
 * Origins the WalletConnect v2 stack talks to when a user connects a mobile
 * wallet by QR code (see lib/stellar/wallet.ts). Without these, the browser
 * blocks the relay socket and the pairing never completes.
 */
const WALLET_CONNECT_CONNECT_SRC = [
  // Relay websocket + its HTTPS fallback, on both the .org and legacy .com hosts
  "https://relay.walletconnect.org",
  "wss://relay.walletconnect.org",
  "https://relay.walletconnect.com",
  "wss://relay.walletconnect.com",
  // Reown AppKit: wallet registry, and its telemetry/analytics endpoint
  "https://api.web3modal.org",
  "https://explorer-api.walletconnect.com",
  "https://pulse.walletconnect.org",
];

/** Wallet and AppKit logo hosts used by the wallet picker. */
const WALLET_IMG_SRC = [
  "https://explorer-api.walletconnect.com",
  "https://api.web3modal.org",
  // StellarWalletsKit serves each module's product icon from here
  "https://stellar.creit.tech",
];

const securityHeaders = [
  // Content Security Policy — restricts where resources can load from
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline styles; nonces would be ideal but require extra infra
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // Stellar APIs + the WalletConnect relay. The database is only reached
      // server-side, so no DB host is needed here.
      [
        "connect-src 'self'",
        "https://horizon-testnet.stellar.org",
        "https://soroban-testnet.stellar.org",
        "https://friendbot.stellar.org",
        ...WALLET_CONNECT_CONNECT_SRC,
      ].join(" "),
      ["img-src 'self' data: blob:", ...WALLET_IMG_SRC].join(" "),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  // Prevent clickjacking — only allow iframes from same origin
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME type sniffing attacks
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block XSS reflected attacks in legacy browsers
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Control what referrer info is sent
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restrict browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Force HTTPS for 1 year (preload-ready)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
