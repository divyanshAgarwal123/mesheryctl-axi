import {
  getFlag,
  getFlagValues,
  getPositional,
  rejectUnknownFlags,
} from "../args.js";
import { AxiError } from "../errors.js";
import { selectFields } from "../fields.js";
import { asObject, mesheryctlJson } from "../mesheryctl.js";
import { API } from "../paths.js";
import {
  listQueryFromFlags,
  listTotal,
  nextPage,
  serverGetJson,
} from "../server.js";
import { getSuggestions } from "../suggestions.js";
import {
  emptyState,
  field,
  lower,
  renderDetail,
  renderHelp,
  renderList,
  renderListCounts,
  renderOutput,
  renderStatusSummary,
  type FieldDef,
} from "../toon.js";

export const CONNECTION_FLAGS: Record<string, readonly string[]> = {
  list: [
    "--page",
    "--pagesize",
    "--limit",
    "--fields",
    "--full",
    "--kind",
    "-k",
    "--status",
    "-s",
  ],
  view: ["--fields", "--full"],
};

export const CONNECTION_HELP = `usage: mesheryctl-axi connection <subcommand>
subcommands[2]:
  list, view
flags{list}:
  --page, --pagesize, --limit, -k/--kind, -s/--status, --fields, --full
flags{view}:
  --fields, --full
examples:
  mesheryctl-axi connection list
  mesheryctl-axi connection view <id>
`;

const listSchema: FieldDef[] = [
  field("id"),
  field("name"),
  lower("status"),
  field("kind"),
  field("type"),
];

const viewSchema: FieldDef[] = [
  field("id"),
  field("name"),
  lower("status"),
  field("kind"),
  field("type"),
  field("created_at", "created"),
  field("updated_at", "updated"),
];

function normalizeConnection(
  item: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: item["id"] ?? item["ID"],
    name: item["name"] ?? item["Name"],
    status: item["status"] ?? item["Status"],
    kind: item["kind"] ?? item["Kind"],
    type: item["type"] ?? item["connection_type"] ?? item["ConnectionType"],
    created_at: item["created_at"] ?? item["createdAt"],
    updated_at: item["updated_at"] ?? item["updatedAt"],
  };
}

function suggestionValue(value: string): string {
  return /^[A-Za-z0-9._:/-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

async function listConnections(args: string[]): Promise<string> {
  const schema = selectFields(args, listSchema, viewSchema, "connection list");
  const kinds = getFlagValues(args, ["--kind", "-k"]);
  const statuses = getFlagValues(args, ["--status", "-s"]);
  // Interim: mesheryctl connection list has no --output-format; use Server API
  // (same path as mesheryctl: api/integrations/connections). Never scrape tables.
  const q = listQueryFromFlags({
    page: getFlag(args, "--page"),
    pagesize: getFlag(args, "--pagesize") ?? getFlag(args, "--limit"),
  });
  const payload = await serverGetJson<Record<string, unknown>>({
    path: API.connections,
    query: {
      page: q.page,
      pagesize: q.pagesize,
      kind: kinds,
      status: statuses,
    },
  });
  const raw = Array.isArray(payload["connections"])
    ? (payload["connections"] as Record<string, unknown>[])
    : Array.isArray(payload)
      ? (payload as Record<string, unknown>[])
      : [];
  const items = raw.map(normalizeConnection);
  const isEmpty = items.length === 0;
  const total = listTotal(payload);
  const sourceSummary = payload["statusSummary"] ?? payload["status_summary"];
  const summary: Record<string, number> = {};
  if (
    sourceSummary &&
    typeof sourceSummary === "object" &&
    !Array.isArray(sourceSummary)
  ) {
    for (const [status, value] of Object.entries(sourceSummary)) {
      const count = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(count) && count >= 0) {
        summary[status.toLowerCase()] = count;
      }
    }
  }
  if (Object.keys(summary).length === 0) {
    for (const item of items) {
      const status = item["status"];
      if (typeof status === "string" && status.length > 0) {
        const key = status.toLowerCase();
        summary[key] = (summary[key] ?? 0) + 1;
      }
    }
  }
  return renderOutput([
    renderListCounts(items.length, total),
    isEmpty
      ? emptyState("connections")
      : renderList("connections", items, schema),
    Object.keys(summary).length > 0 ? renderStatusSummary(summary) : "",
    renderHelp(
      getSuggestions({
        domain: "connection",
        action: "list",
        isEmpty,
        nextPage: nextPage(q.page, q.pagesize, items.length, total),
        nextPageFlags: [
          ...(q.pagesize === 10 ? [] : ["--pagesize", String(q.pagesize)]),
          ...kinds.flatMap((kind) => ["--kind", suggestionValue(kind)]),
          ...statuses.flatMap((status) => [
            "--status",
            suggestionValue(status),
          ]),
        ],
      }),
    ),
  ]);
}

async function viewConnection(args: string[]): Promise<string> {
  const schema = selectFields(args, viewSchema, viewSchema, "connection view");
  const id = getPositional(args, 0, ["--fields"]);
  if (!id) {
    throw new AxiError(
      "Connection id is required: mesheryctl-axi connection view <id>",
      "VALIDATION_ERROR",
    );
  }

  // view supports --output-format on released mesheryctl
  const payload = await mesheryctlJson([
    "connection",
    "view",
    id,
    "--output-format",
    "json",
  ]);
  const item = normalizeConnection(asObject(payload));
  return renderOutput([
    renderDetail("connection", item, schema),
    renderHelp(getSuggestions({ domain: "connection", action: "view" })),
  ]);
}

export async function connectionCommand(args: string[]): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === "-h" || sub === undefined) {
    return CONNECTION_HELP;
  }
  switch (sub) {
    case "list":
      rejectUnknownFlags(
        args.slice(1),
        CONNECTION_FLAGS.list,
        "connection",
        "list",
      );
      return listConnections(args.slice(1));
    case "view":
      rejectUnknownFlags(
        args.slice(1),
        CONNECTION_FLAGS.view,
        "connection",
        "view",
      );
      return viewConnection(args.slice(1));
    default:
      throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view",
        "mesheryctl-axi connection --help",
      ]);
  }
}
