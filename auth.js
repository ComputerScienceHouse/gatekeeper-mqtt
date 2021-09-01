const realms = {
  admin: new Set(process.env.GK_ADMIN_SECRETS.split(",")),
  drink: new Set(process.env.GK_DRINK_SECRETS.split(",")),
  projects: new Set(process.env.GK_MEMBER_PROJECT_SECRETS.split(",")),
};

function generateMiddleware(realm) {
  if (!realms[realm]) {
    throw new Error("No such realm: " + realm);
  }

  function authMiddleware(req, res, next) {
    if (!req.headers.authorization) {
      res.status(403).json({
        message: "Secret not provided",
      });
      return;
    }
    if (!realms[realm].has(req.headers.authorization)) {
      res.status(403).json({
        message: "Unknown application! Are you on the wrong realm?",
      });
      return;
    }
    next();
  }

  return authMiddleware;
}

module.exports = generateMiddleware;
