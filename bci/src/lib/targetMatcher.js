// Typed target matching (spec section 4). Each authorized_scopes row is
// now created with an explicit target_type, and matching dispatches to a
// canonical parser/matcher for that type -- a CIDR is never matched by
// string suffix, a URL's path is never confused with a domain, etc.
// Every branch that can't confidently parse either side returns false
// (no match) rather than guessing: an ambiguous match is the same as no
// match, and the caller (policyEngine.js) already treats "no match" as DENY.

export const TARGET_TYPES = [
  'DOMAIN', 'SUBDOMAIN', 'URL', 'IP', 'CIDR', 'REPOSITORY',
  'API', 'CLOUD_ACCOUNT', 'CONTAINER', 'KUBERNETES_CLUSTER',
];

function normalizeDomain(host) {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(ip) {
  const m = IPV4_RE.exec(ip.trim());
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];
}

function parseCidr(cidr) {
  const [base, prefixStr] = cidr.split('/');
  const prefixLen = Number(prefixStr);
  const baseInt = parseIpv4(base);
  if (baseInt === null || !Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) return null;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return { network: (baseInt & mask) >>> 0, mask };
}

function ipInCidr(ip, cidr) {
  const ipInt = parseIpv4(ip);
  const range = parseCidr(cidr);
  if (ipInt === null || !range) return false;
  return (ipInt & range.mask) >>> 0 === range.network;
}

function normalizeRepository(repo) {
  return repo
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/\.git$/, '');
}

function parseUrlSafe(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function containerBaseName(ref) {
  // "registry/image:tag" or "registry/image@sha256:..." -> "registry/image"
  return ref.trim().toLowerCase().split(/[:@]/)[0];
}

const MATCHERS = {
  DOMAIN(scopeTarget, requestedTarget) {
    const a = normalizeDomain(scopeTarget);
    const b = normalizeDomain(requestedTarget);
    return a === b || b.endsWith(`.${a}`);
  },

  SUBDOMAIN(scopeTarget, requestedTarget) {
    return normalizeDomain(scopeTarget) === normalizeDomain(requestedTarget);
  },

  IP(scopeTarget, requestedTarget) {
    const a = parseIpv4(scopeTarget);
    const b = parseIpv4(requestedTarget);
    return a !== null && a === b;
  },

  CIDR(scopeTarget, requestedTarget) {
    // requestedTarget must itself be a single IP for a CIDR scope to cover
    // it -- a CIDR scope does not, by itself, authorize a bare hostname.
    return parseIpv4(requestedTarget) !== null && ipInCidr(requestedTarget, scopeTarget);
  },

  URL(scopeTarget, requestedTarget) {
    const scopeUrl = parseUrlSafe(scopeTarget);
    const reqUrl = parseUrlSafe(requestedTarget);
    if (!scopeUrl || !reqUrl) return false;
    if (scopeUrl.protocol !== reqUrl.protocol || scopeUrl.host !== reqUrl.host) return false;
    const scopePath = scopeUrl.pathname === '/' ? '' : scopeUrl.pathname.replace(/\/$/, '');
    return reqUrl.pathname === scopePath || reqUrl.pathname.startsWith(`${scopePath}/`);
  },

  API(scopeTarget, requestedTarget) {
    return MATCHERS.URL(scopeTarget, requestedTarget);
  },

  REPOSITORY(scopeTarget, requestedTarget) {
    return normalizeRepository(scopeTarget) === normalizeRepository(requestedTarget);
  },

  CLOUD_ACCOUNT(scopeTarget, requestedTarget) {
    return scopeTarget.trim() === requestedTarget.trim();
  },

  CONTAINER(scopeTarget, requestedTarget) {
    return containerBaseName(scopeTarget) === containerBaseName(requestedTarget);
  },

  KUBERNETES_CLUSTER(scopeTarget, requestedTarget) {
    return scopeTarget.trim() === requestedTarget.trim();
  },
};

// Fails closed: an unrecognized target_type matches nothing, rather than
// falling back to a permissive default.
export function targetMatchesTyped(targetType, scopeTarget, requestedTarget) {
  const matcher = MATCHERS[targetType];
  if (!matcher) return false;
  try {
    return matcher(scopeTarget, requestedTarget);
  } catch {
    return false;
  }
}

export function isValidTargetType(type) {
  return TARGET_TYPES.includes(type);
}
