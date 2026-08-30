import StatsD from "hot-shots";

export const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST,
  prefix: "gatekeeper.",
  globalTags: { service: "gatekeeper-mqtt" },
  errorHandler: (err) => console.error("StatsD error:", err),
});
