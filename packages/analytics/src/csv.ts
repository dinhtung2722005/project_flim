function cell(value: unknown) {
  let text = String(value ?? "").replace(/\u0000/g, "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function viewMetricsCsv(report: any) {
  const meta = [
    report.definitionVersion,
    report.measurementStartedAt
      ? new Date(report.measurementStartedAt).toISOString()
      : "",
    report.days,
    "UTC",
  ];
  const rows: unknown[][] = [
    [
      "row_type",
      "day_utc",
      "title_id",
      "title",
      "qualified_views",
      "playback_starts",
      "definition_version",
      "measurement_started_at",
      "range_days",
      "timezone",
    ],
    [
      "TOTAL",
      "",
      "",
      "",
      report.total.views,
      report.total.playbackStarts,
      ...meta,
    ],
    ...report.daily.map((r: any) => [
      "DAILY",
      r.day,
      "",
      "",
      r.views,
      r.playbackStarts,
      ...meta,
    ]),
    ...report.top.map((r: any) => [
      "TOP_TITLE",
      "",
      r.id,
      r.name,
      r.views,
      r.playbackStarts,
      ...meta,
    ]),
  ];
  return (
    "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
  );
}
