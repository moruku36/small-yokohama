const TARGET_RAILWAYS = [
  {
    lineId: "jr-keihin-tohoku",
    odptRailway: "odpt.Railway:JR-East.KeihinTohokuNegishi",
    operator: "JR-East",
    queryRailway: "odpt.Railway:JR-East.KeihinTohokuNegishi",
  },
  {
    lineId: "jr-tokaido",
    odptRailway: "odpt.Railway:JR-East.Tokaido",
    operator: "JR-East",
    queryRailway: "odpt.Railway:JR-East.Tokaido",
  },
  {
    lineId: "jr-yokosuka",
    odptRailway: "odpt.Railway:JR-East.Yokosuka",
    operator: "JR-East",
    queryRailway: "odpt.Railway:JR-East.Yokosuka",
  },
  {
    lineId: "keikyu-main",
    odptRailway: "odpt.Railway:Keikyu.Main",
    operator: "Keikyu",
    queryRailway: "odpt.Railway:Keikyu.Main",
  },
  {
    lineId: "sotetsu-main",
    odptRailway: "odpt.Railway:Sotetsu.Main",
    operator: "Sotetsu",
    queryRailway: "odpt.Railway:Sotetsu.Main",
  },
];

const RAILWAY_TO_LINE_ID = new Map(
  TARGET_RAILWAYS.map((r) => [r.odptRailway, r.lineId]),
);

const ODPT_BASES = [
  "https://api.odpt.org/api/v4/odpt:Train",
  "https://api-challenge.odpt.org/api/v4/odpt:Train",
];

async function fetchOperatorTrains(operator, token) {
  for (const base of ODPT_BASES) {
    const url = `${base}?odpt:operator=odpt.Operator:${encodeURIComponent(operator)}&acl:consumerKey=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) continue;
      const rows = await res.json();
      if (Array.isArray(rows)) return rows;
    } catch {
      // try fallback ODPT host
    }
  }
  return [];
}

function normalizeTrainRecord(row) {
  const railway = row["odpt:railway"] || "";
  const lineId = RAILWAY_TO_LINE_ID.get(railway);
  if (!lineId) return null;

  const trainNumber = row["odpt:trainNumber"] || row["owl:sameAs"] || row["@id"] || "";
  if (!trainNumber) return null;

  return {
    id: `${lineId}:${trainNumber}`,
    lineId,
    railway,
    trainNumber,
    trainType: row["odpt:trainType"] || "",
    direction: row["odpt:railDirection"] || "",
    fromStation: row["odpt:fromStation"] || null,
    toStation: row["odpt:toStation"] || null,
    delaySec: typeof row["odpt:delay"] === "number" ? row["odpt:delay"] : 0,
    carComposition:
      typeof row["odpt:carComposition"] === "number" ? row["odpt:carComposition"] : null,
    destinationStation: Array.isArray(row["odpt:destinationStation"])
      ? row["odpt:destinationStation"][0] || null
      : null,
    observedAt: row["dc:date"] || null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");

  const fetchedAt = new Date().toISOString();
  const token = (process.env.ODPT_ACCESS_TOKEN || "").trim();

  if (!token) {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        mode: "scheduled",
        sourceJa: "横浜実時刻ダイヤ運行（OSM実線路）",
        sourceEn: "Yokohama Live JST Timetable (OSM Tracks)",
        fetchedAt,
        trains: [],
      }),
    );
    return;
  }

  try {
    const operatorResults = await Promise.all(
      ["JR-East", "Keikyu", "Sotetsu"].map((op) => fetchOperatorTrains(op, token)),
    );
    const trains = [];
    const seen = new Set();
    for (const rows of operatorResults) {
      for (const row of rows) {
        const norm = normalizeTrainRecord(row);
        if (!norm || seen.has(norm.id)) continue;
        seen.add(norm.id);
        trains.push(norm);
      }
    }

    if (trains.length > 0) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          mode: "observed",
          sourceJa: "ODPT リアルタイム列車位置",
          sourceEn: "ODPT Live Train Telemetry",
          fetchedAt,
          trains,
        }),
      );
      return;
    }
  } catch {
    // Graceful fallback to live JST timetable on upstream timeout/error
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      mode: "scheduled",
      sourceJa: "横浜実時刻ダイヤ運行（OSM実線路）",
      sourceEn: "Yokohama Live JST Timetable (OSM Tracks)",
      fetchedAt,
      trains: [],
    }),
  );
};
