import { discovery } from "openid-client";
import { createRemoteJWKSet, jwtVerify } from "jose";

const REQUIRED_SCOPE = "gatekeeper_provision";
const USER_ID_CLAIM = "uuid";

const issuerUrl = new URL(
  process.env.GK_OIDC_ISSUER || "https://sso.csh.rit.edu/auth/realms/csh"
);
export const clientId = process.env.GK_OIDC_CLIENT_ID;

export const oidcPromise = discovery(issuerUrl, clientId).then((config) => {
  const metadata = config.serverMetadata();
  return {
    issuer: metadata.issuer,
    JWKS: createRemoteJWKSet(new URL(metadata.jwks_uri)),
  };
});

class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Validates a Bearer token and returns userId.
// Pass requiredScope to enforce a specific scope claim.
export async function validateToken(token, requiredScope = null) {
  const { issuer, JWKS } = await oidcPromise;
  const verifyOptions = { issuer };
  if (clientId) verifyOptions.audience = clientId;

  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, verifyOptions));
  } catch (err) {
    throw new AuthError("Invalid or expired token", 401);
  }

  if (requiredScope) {
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (!scopes.includes(requiredScope)) {
      throw new AuthError(
        `Token missing required scope: ${requiredScope}`,
        403
      );
    }
  }

  const userId = payload[USER_ID_CLAIM];
  if (!userId) {
    throw new AuthError(`Token missing required claim: ${USER_ID_CLAIM}`, 403);
  }

  return userId;
}

export async function oidcAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Bearer token required" });
  }
  try {
    req.ctx.userId = await validateToken(authHeader.slice(7), REQUIRED_SCOPE);
    next();
  } catch (err) {
    return res.status(err.status || 401).json({ message: err.message });
  }
}
