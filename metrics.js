import StatsD from "hot-shots";

export const statsd = new StatsD({
  prefix: "gatekeeper.",
  globalTags: { service: "gatekeeper-mqtt" },
  errorHandler: (err) => console.error("StatsD error:", err),
});
