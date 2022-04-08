const fetchPromise = import("node-fetch");

async function getSaToken() {
  const fetch = (await fetchPromise).default;

  const resp = await fetch(
    "https://sso.csh.rit.edu/auth/realms/master/protocol/openid-connect/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          process.env.GK_SA_USERNAME + ":" + process.env.GK_SA_PASSWORD
        ).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    }
  );
  const json = await resp.json();

  return json["access_token"];
}

async function getUidFromUsername(username, saToken) {
  const fetch = (await fetchPromise).default;

  const resp = await fetch(
    "https://sso.csh.rit.edu/auth/admin/realms/csh/users?username=" + username,
    {
      headers: {
        Authorization: `Bearer ${saToken}`,
      },
    }
  );
  const json = await resp.json();

  return json[0]["id"];
}

async function getImpersonationSession(userId, saToken) {
  const fetch = (await fetchPromise).default;

  const resp = await fetch(
    `https://sso.csh.rit.edu/auth/admin/realms/csh/users/${userId}/impersonation`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${saToken}`,
      },
    }
  );
  const headers = resp.headers;
  const cookies = headers.get("set-cookie");

  const identityRegex = /KEYCLOAK_IDENTITY=\S+/;
  const sessionRegex = /KEYCLOAK_SESSION=\S+/;

  const identity = identityRegex
    .exec(cookies)[0]
    .split("=")[1]
    .replace(";", "");
  const session = sessionRegex.exec(cookies)[0].split("=")[1].replace(";", "");

  return {identity, session};
}

async function getUserToken(identity, session) {
  const fetch = (await fetchPromise).default;

  const resp = await fetch(
    "https://sso.csh.rit.edu/auth/realms/csh/protocol/openid-connect/auth?client_id=gatekeeper&response_type=token&response_mode=fragment&redirect_uri=https%3A%2F%2Fgatekeeper.csh.rit.edu%2Fcallback",
    {
      method: "GET",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `KEYCLOAK_SESSION=${session}; KEYCLOAK_IDENTITY=${identity};`,
      },
      redirect: "manual",
    }
  );

  const headers = resp.headers;
  const location = new URL(headers.get("location").replace("#", "?"));

  let accessToken = location.searchParams.get("access_token");

  return accessToken;
}

async function getImpersonationToken(userId) {
  const saToken = await getSaToken();
  const uid = await getUidFromUsername(userId, saToken);
  const {identity, session} = await getImpersonationSession(uid, saToken);
  const accessToken = await getUserToken(identity, session);
  return {uid, userId, accessToken};
}

module.exports = {
  getImpersonationToken,
};
