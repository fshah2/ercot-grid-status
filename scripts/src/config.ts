export const CONFIG = {
  // ERCOT API
  tokenEndpoint:
    "https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token",
  apiBase: "https://api.ercot.com/api/public-reports",

  // Per ERCOT registration/auth docs, these are used in the ROPC flow:
  // client_id: fec253ea-0d06-4272-a5e6-b478baeecd70
  // scope: openid <client_id> offline_access
  // response_type: id_token
  // (We still send grant_type=password with username/password)
  clientId: "fec253ea-0d06-4272-a5e6-b478baeecd70",
  scope: "openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access",
  responseType: "id_token",

  // Data endpoints (required by your spec)
  endpoints: {
    actualLoad: "/np6-346-cd/act_sys_load_by_fzn",
    forecast: "/np3-565-cd/lf_by_model_weather_zone",
    outages: "/np3-233-cd/hourly_res_outage_cap",
    fuelMix: "/np3-910-er/2d_agg_gen_summary",
    prices: "/np6-788-cd/lmp_node_zone_hub",
    systemLambda: "/np6-322-cd/sced_system_lambda"
  },

  // Optional toggle (your spec): include lambda fetch & signal in stress logic
  includeSystemLambda: true,

  // Rolling window
  historyDays: 7,

  // Bump when the shape or meaning of site/public/data/*.json changes.
  // Existing files with a different schemaVersion are ignored (rebuilt from the fetch window).
  // v2: timestamps are real UTC (ERCOT Central time converted with DST handling).
  schemaVersion: 2,

  // Load forecast: only pull recent postings (ERCOT posts hourly; each posting covers ~7 days ahead).
  forecastPostedLookbackHours: 3,

  // API paging & rate-safety
  pageSize: 10000,
  maxPagesPerEndpoint: 50,
  interPageDelayMs: 250,

  // “Headline price” choice: HB_NORTH (common ERCOT trading hub)
  // If the API uses a different settlement point label in your subscription,
  // change this single value.
  headlineSettlementPoint: "HB_NORTH",

  // ERCOT timestamps are Central Prevailing Time with no offset.
  // We convert them to real UTC ISO for the website JSON (see time.ts).
  marketTimeZone: "America/Chicago"
};
