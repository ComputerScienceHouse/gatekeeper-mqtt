import { validateToken, REQUIRED_SCOPE } from "./oidc.js";
import { checkSecret } from "../auth.js";

export function hybridAuth(realm) {
  return async function (req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization required" });
    }

    if (authHeader.startsWith("Bearer ")) {
      try {
        const { userId, groups } = await validateToken(authHeader.slice(7), REQUIRED_SCOPE);
        req.ctx.userId = userId;
        req.ctx.groups = groups;
        req.ctx.authMethod = "oidc";
        next();
      } catch (err) {
        return res.status(err.status || 401).json({ message: err.message });
      }
    } else {
      if (!checkSecret(realm, authHeader)) {
        return res.status(403).json({
          message: "Unknown application! Are you on the wrong realm?",
        });
      }
      req.ctx.authMethod = "secret";
      next();
    }
  };
}
