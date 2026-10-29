'use strict';
const { isIP, BlockList } = require('node:net');

const DEFAULT_FRONTEND = 'https://expenseiq-tracker-app.netlify.app';
function canonicalIp(address) {
    if (typeof address !== 'string' || address.includes('%')) return null;
    if (isIP(address) === 4) return address;
    if (isIP(address) !== 6) return null;
    try {
        const ip = new URL(`http://[${address}]/`).hostname.slice(1, -1);
        const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(ip);
        if (mapped) {
            const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
            return [high >> 8, high & 255, low >> 8, low & 255].join('.');
        }
        return ip;
    } catch { return null; }
}
function trustedProxyPolicy(env = process.env) {
    const raw = (env.TRUSTED_PROXY_CIDRS || '').trim();
    if (!raw) {
        if (env.TRUSTED_PROXY_MAX_HOPS) throw Error('Proxy hops require an explicit trusted proxy allowlist');
        return false;
    }
    const maxHops = Number(env.TRUSTED_PROXY_MAX_HOPS || '1');
    if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 5) throw Error('Invalid trusted proxy hop limit');
    const entries = raw.split(',').map(value => value.trim());
    if (entries.length > 32) throw Error('Too many trusted proxy entries');
    const addresses = new BlockList();
    for (const entry of entries) {
        const parts = entry.split('/'), address = parts[0], version = isIP(address);
        if (!version || parts.length > 2 || parts.length === 2 && !/^\d+$/.test(parts[1])) throw Error('Invalid trusted proxy address');
        let prefix = parts.length === 2 ? Number(parts[1]) : version === 4 ? 32 : 128;
        const normalized = canonicalIp(address);
        if (!normalized) throw Error('Invalid trusted proxy address');
        if (version === 6 && isIP(normalized) === 4) {
            if (prefix < 120 || prefix > 128) throw Error('Mapped proxy ranges must be narrowly scoped');
            prefix -= 96;
        }
        const family = isIP(normalized) === 4 ? 'ipv4' : 'ipv6';
        if (prefix < (family === 'ipv4' ? 24 : 64) || prefix > (family === 'ipv4' ? 32 : 128)) throw Error('Trusted proxy range is too broad');
        const candidate = new BlockList(); candidate.addSubnet(normalized, prefix, family);
        if (family === 'ipv6' && candidate.check('::ffff:203.0.113.1', 'ipv6')) throw Error('IPv6 proxy range overlaps mapped IPv4 space');
        addresses.addSubnet(normalized, prefix, family);
    }
    return (address, hop) => {
        const normalized = canonicalIp(address);
        return Number.isInteger(hop) && hop >= 0 && hop < maxHops && !!normalized &&
            addresses.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6');
    };
}
function allowedOrigins(env = process.env) {
    const raw = env.CORS_ALLOWED_ORIGINS === undefined ? DEFAULT_FRONTEND : env.CORS_ALLOWED_ORIGINS;
    const origins = raw.split(',').map(value => value.trim());
    if (!origins.length || origins.length > 32) throw Error('Invalid CORS origin allowlist');
    for (const origin of origins) {
        let url;
        try { url = new URL(origin); } catch { throw Error('Invalid CORS origin'); }
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (origin !== url.origin || url.username || url.password ||
            !(url.protocol === 'https:' || url.protocol === 'http:' && loopback)) throw Error('CORS requires explicit HTTPS or loopback origins');
    }
    return new Set(origins);
}
function corsOptions(env = process.env) {
    const origins = allowedOrigins(env);
    return { origin: (origin, callback) => callback(null, !!origin && origins.has(origin)),
        exposedHeaders: ['Retry-After'], credentials: false };
}
function clientRateLimitIdentity(req) {
    // req.ip is computed by Express's verified-peer policy. Never select an XFF
    // element, CF-Connecting-IP or X-Real-IP independently of that trust boundary.
    return canonicalIp(req.ip) || canonicalIp(req.socket?.remoteAddress) || 'unknown';
}
module.exports = { canonicalIp, trustedProxyPolicy, allowedOrigins, corsOptions, clientRateLimitIdentity };
