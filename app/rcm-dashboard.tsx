"use client";

import { ChangeEvent, type CSSProperties, useEffect, useMemo, useState } from "react";

type CellValue = string | number | boolean | null;

type RawRow = Record<string, CellValue>;

type RCMRow = {
  site: string;
  rcmId: string;
  rcmNo: string;
  version: string;
  assetType: string;
  reference: string;
  functionId: string;
  functionText: string;
  functionFailureId: string;
  functionFailure: string;
  failureModeId: string;
  failureMode: string;
  failureEffect: string;
  analysisTracking: string;
  recommendedStrategy: string;
  proposedTask: string;
  interval: string;
  workCenter: string;
  implemented: boolean;
  kksCode: string;
  previousProposedTask: string;
  previousInterval: string;
  duplicateKey: string;
  duplicateCount: number;
  duplicateStatus: "Duplicate" | "Unique";
};

type StrategySummary = {
  code: string;
  label: string;
  revised: number;
  existing: number;
  actionable: boolean;
};

type WorkCenterSummary = {
  name: string;
  total: number;
  executed: number;
  pending: number;
};

type AnalysisSummary = {
  fileName: string;
  sheetName: string;
  sourceRows: CellValue[][];
  rows: RCMRow[];
  totalRows: number;
  functionsExisting: number;
  functionsRevised: number;
  failureModesExisting: number;
  failureModesRevised: number;
  actionableTasks: number;
  executedTasks: number;
  pendingTasks: number;
  strategySummary: StrategySummary[];
  actionableStrategySummary: StrategySummary[];
  workCenters: WorkCenterSummary[];
  duplicateRows: RCMRow[];
  topStrategies: StrategySummary[];
  metadata: {
    site: string;
    rcmId: string;
    assetName: string;
  };
};

type ReportMeta = {
  station: string;
  assetName: string;
  analysisDate: string;
  auditDate: string;
  auditComments: string[];
  preparedBy: string;
};

type SheetData = {
  name: string;
  rows: CellValue[][];
};

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  data?: Uint8Array;
};

const ACTIONABLE_CODES = new Set([
  "OC",
  "SR",
  "SD",
  "FF",
  "OCSR",
  "OCSD",
  "R-PRO",
  "R-SPARE",
  "R-TRN",
  "R-HRD",
]);

const NON_TASK_CODES = new Set(["NSM", "AS", "N/A", "OTHER FUNCTION", ""]);

const STRATEGIES = [
  ["OC", "OC - On Condition Task", true],
  ["SR", "SR - Schedule Restoration", true],
  ["SD", "SD - Schedule Discard", true],
  ["FF", "FF - Failure Finding", true],
  ["NSM", "NSM - No Schedule Maintenance", false],
  ["OCSR", "OCSR - On Condition Task and Schedule Restoration", true],
  ["OCSD", "OCSD - On Condition Task and Schedule Discard", true],
  ["R-PRO", "R-PRO - Redesign - Procedure", true],
  ["R-SPARE", "R-SPARE - Redesign - Spare Management", true],
  ["R-TRN", "R-TRN - Redesign - Training", true],
  ["R-HRD", "R-HRD - Redesign - Hardware", true],
  ["Other Function", "Other Function - Refer to Other Function", false],
  ["AS", "AS - Analysed Separately", false],
  ["N/A", "Not Analysed", false],
] as const;

const CHART_COLORS = [
  "#0f67b1",
  "#00a7d8",
  "#00b894",
  "#f58220",
  "#ef4444",
  "#7c3aed",
  "#ffd166",
  "#0b3d91",
];

const AUDIT_COMMENT_STORAGE_KEY = "rcm-genco-audit-comment";
const AUDIT_COMMENTS_STORAGE_KEY = "rcm-genco-audit-comments";

function normalizeHeader(value: CellValue) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function text(value: CellValue) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function isUsableText(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !["n/a", "na", "not applicable", "-", "nil"].includes(normalized);
}

function firstUsable<T>(items: T[], getValue: (item: T) => string) {
  return items.map(getValue).find(isUsableText) ?? "";
}

function loadSavedAuditComments() {
  if (typeof window === "undefined") {
    return [];
  }

  const storedComments = window.localStorage.getItem(AUDIT_COMMENTS_STORAGE_KEY);
  if (storedComments) {
    try {
      const parsed = JSON.parse(storedComments);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => text(item)).filter(Boolean);
      }
    } catch {
      // Fall back to the legacy single-comment value below.
    }
  }

  const legacyComment = text(window.localStorage.getItem(AUDIT_COMMENT_STORAGE_KEY));
  return legacyComment ? [legacyComment] : [];
}

function formatAuditComments(comments: string[]) {
  return comments
    .map((comment, index) => `${index + 1}. ${comment}`)
    .join("\n\n");
}

function isTrue(value: CellValue) {
  if (value === true) {
    return true;
  }
  const normalized = text(value).toLowerCase();
  return ["true", "yes", "y", "1", "implemented", "done"].includes(normalized);
}

function strategyIsActionable(code: string) {
  const upper = code.trim().toUpperCase();
  if (ACTIONABLE_CODES.has(upper)) {
    return true;
  }
  if (NON_TASK_CODES.has(upper)) {
    return false;
  }
  return upper.length > 0;
}

function byCount<T extends { total?: number; revised?: number }>(items: T[]) {
  return [...items].sort((a, b) => (b.total ?? b.revised ?? 0) - (a.total ?? a.revised ?? 0));
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function uniqueCount(items: RCMRow[], getKey: (row: RCMRow) => string) {
  const values = new Set<string>();
  for (const item of items) {
    const value = getKey(item).trim();
    if (value) {
      values.add(value);
    }
  }
  return values.size;
}

function mapRawRows(rows: CellValue[][]): RawRow[] {
  if (!rows.length) {
    return [];
  }
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) => {
    const record: RawRow = {};
    headers.forEach((header, index) => {
      if (header) {
        record[header] = row[index] ?? null;
      }
    });
    return record;
  });
}

function getField(row: RawRow, names: string[]) {
  for (const name of names) {
    const key = normalizeHeader(name);
    if (row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }
  return null;
}

function toRcmRows(rawRows: RawRow[]) {
  const normalized = rawRows
    .map((row) => {
      const functionId = text(getField(row, ["F_ID", "F ID", "Function ID"]));
      const functionFailureId = text(getField(row, ["FF_ID", "FF ID", "Function Failure ID"]));
      const failureModeId = text(getField(row, ["FM_ID", "FM ID", "Failure Mode ID"]));
      const failureMode = text(getField(row, ["Failure_Mode", "Failure Mode"]));
      const proposedTask = text(getField(row, ["Proposed_Task", "Proposed Task"]));
      const reference =
        text(getField(row, ["Reference", "Ref"])) ||
        [functionId, functionFailureId, failureModeId].filter(Boolean).join("/");

      return {
        site: text(getField(row, ["Site"])),
        rcmId: text(getField(row, ["RCM_ID", "RCM ID"])),
        rcmNo: text(getField(row, ["RCM_No", "RCM No"])),
        version: text(getField(row, ["Version"])),
        assetType: text(getField(row, ["Asset_Type", "Asset Type"])),
        reference,
        functionId,
        functionText: text(getField(row, ["Function"])),
        functionFailureId,
        functionFailure: text(getField(row, ["Function_Failure", "Function Failure"])),
        failureModeId,
        failureMode,
        failureEffect: text(getField(row, ["Failure_Effect", "Failure Effect"])),
        analysisTracking: text(getField(row, ["Analysis_Tracking", "Analysis Tracking"])),
        recommendedStrategy: text(getField(row, ["Recommended_Strategy", "Recommended Strategy"])),
        proposedTask,
        interval: text(getField(row, ["Interval"])),
        workCenter: text(getField(row, ["Work_Center", "Work Center", "Trade"])),
        implemented: isTrue(getField(row, ["Implemented"])),
        kksCode: text(getField(row, ["KKS_Code", "KKS Code"])),
        previousProposedTask: text(
          getField(row, ["Previous_Proposed_Task", "Previous Proposed Task"]),
        ),
        previousInterval: text(getField(row, ["Previous_Interval", "Previous Interval"])),
        duplicateKey: `${failureMode} - ${proposedTask}`.trim(),
        duplicateCount: 1,
        duplicateStatus: "Unique" as const,
      };
    })
    .filter((row) => row.reference || row.failureMode || row.functionText || row.proposedTask);

  const duplicateCounts = countBy(normalized, (row) => row.duplicateKey.toLowerCase());

  return normalized.map((row) => {
    const duplicateCount = duplicateCounts.get(row.duplicateKey.toLowerCase()) ?? 1;
    return {
      ...row,
      duplicateCount,
      duplicateStatus: duplicateCount > 1 ? "Duplicate" : "Unique",
    };
  });
}

function chooseBestSheet(sheets: SheetData[]) {
  let best = sheets[0];
  let bestScore = -1;

  for (const sheet of sheets) {
    const headers = sheet.rows[0]?.map(normalizeHeader) ?? [];
    const score = [
      "failuremode",
      "recommendedstrategy",
      "proposedtask",
      "function",
      "implemented",
      "fid",
      "ffid",
      "fmid",
      "reference",
    ].reduce((total, key) => total + (headers.includes(key) ? 1 : 0), 0);

    if (score > bestScore) {
      bestScore = score;
      best = sheet;
    }
  }

  return best;
}

function summarizeRows(
  fileName: string,
  sheetName: string,
  sourceRows: CellValue[][],
  rows: RCMRow[],
): AnalysisSummary {
  const existingRows = rows.filter((row) => row.implemented);
  const actionableRows = rows.filter((row) => strategyIsActionable(row.recommendedStrategy));
  const executableRows = actionableRows.filter((row) => row.implemented);

  const strategySummary: StrategySummary[] = STRATEGIES.map(([code, label, actionable]) => ({
    code,
    label,
    actionable,
    revised: rows.filter((row) => row.recommendedStrategy.toUpperCase() === code.toUpperCase())
      .length,
    existing: existingRows.filter(
      (row) => row.recommendedStrategy.toUpperCase() === code.toUpperCase(),
    ).length,
  }));

  const knownCodes = new Set(STRATEGIES.map(([code]) => code.toUpperCase()));
  const customCodes = [...new Set(rows.map((row) => row.recommendedStrategy).filter(Boolean))]
    .filter((code) => !knownCodes.has(code.toUpperCase()))
    .map((code) => ({
      code,
      label: code,
      actionable: strategyIsActionable(code),
      revised: rows.filter((row) => row.recommendedStrategy === code).length,
      existing: existingRows.filter((row) => row.recommendedStrategy === code).length,
    }));

  const allStrategySummary = [...strategySummary, ...customCodes];
  const actionableStrategySummary = allStrategySummary.filter(
    (item) => item.actionable && item.revised > 0,
  );

  const workCenterCounts = new Map<string, WorkCenterSummary>();
  for (const row of actionableRows) {
    const name = row.workCenter || "Unassigned";
    const current = workCenterCounts.get(name) ?? { name, total: 0, executed: 0, pending: 0 };
    current.total += 1;
    if (row.implemented) {
      current.executed += 1;
    }
    current.pending = current.total - current.executed;
    workCenterCounts.set(name, current);
  }

  const duplicateRows = [...new Map(rows.map((row) => [row.duplicateKey, row])).values()]
    .filter((row) => row.duplicateCount > 1)
    .sort((a, b) => b.duplicateCount - a.duplicateCount)
    .slice(0, 8);

  const site = firstUsable(rows, (row) => row.site);
  const rcmId = firstUsable(rows, (row) => row.rcmId);
  const assetType = firstUsable(rows, (row) => row.assetType);
  const assetName =
    assetType ||
    rcmId?.split("-").slice(-1)[0]?.replace(/[._]/g, " ") ||
    "Uploaded RCM Asset";

  return {
    fileName,
    sheetName,
    sourceRows,
    rows,
    totalRows: rows.length,
    functionsExisting: uniqueCount(existingRows, (row) => row.functionText),
    functionsRevised: uniqueCount(rows, (row) => row.functionText),
    failureModesExisting: existingRows.length,
    failureModesRevised: rows.length,
    actionableTasks: actionableRows.length,
    executedTasks: executableRows.length,
    pendingTasks: actionableRows.length - executableRows.length,
    strategySummary: allStrategySummary,
    actionableStrategySummary,
    workCenters: byCount([...workCenterCounts.values()]),
    duplicateRows,
    topStrategies: byCount(actionableStrategySummary).slice(0, 6),
    metadata: {
      site,
      rcmId,
      assetName,
    },
  };
}

function readUint16(data: DataView, offset: number) {
  return data.getUint16(offset, true);
}

function readUint32(data: DataView, offset: number) {
  return data.getUint32(offset, true);
}

class ZipArchive {
  private source: Uint8Array;
  entries: ZipEntry[];

  private constructor(source: Uint8Array, entries: ZipEntry[]) {
    this.source = source;
    this.entries = entries;
  }

  static async fromArrayBuffer(buffer: ArrayBuffer) {
    const source = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;

    for (let offset = source.length - 22; offset >= Math.max(0, source.length - 65557); offset--) {
      if (readUint32(view, offset) === 0x06054b50) {
        eocd = offset;
        break;
      }
    }

    if (eocd < 0) {
      throw new Error("The file is not a readable Excel or PowerPoint package.");
    }

    const totalEntries = readUint16(view, eocd + 10);
    const centralDirectoryOffset = readUint32(view, eocd + 16);
    const decoder = new TextDecoder();
    const entries: ZipEntry[] = [];
    let pointer = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index++) {
      if (readUint32(view, pointer) !== 0x02014b50) {
        throw new Error("The package central directory is invalid.");
      }

      const method = readUint16(view, pointer + 10);
      const crc32Value = readUint32(view, pointer + 16);
      const compressedSize = readUint32(view, pointer + 20);
      const uncompressedSize = readUint32(view, pointer + 24);
      const fileNameLength = readUint16(view, pointer + 28);
      const extraLength = readUint16(view, pointer + 30);
      const commentLength = readUint16(view, pointer + 32);
      const localHeaderOffset = readUint32(view, pointer + 42);
      const name = decoder.decode(source.slice(pointer + 46, pointer + 46 + fileNameLength));

      entries.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        crc32: crc32Value,
        localHeaderOffset,
      });

      pointer += 46 + fileNameLength + extraLength + commentLength;
    }

    return new ZipArchive(source, entries);
  }

  private compressedData(entry: ZipEntry) {
    const view = new DataView(this.source.buffer, this.source.byteOffset, this.source.byteLength);
    const offset = entry.localHeaderOffset;

    if (readUint32(view, offset) !== 0x04034b50) {
      throw new Error(`Local header not found for ${entry.name}.`);
    }

    const fileNameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    const start = offset + 30 + fileNameLength + extraLength;
    return this.source.slice(start, start + entry.compressedSize);
  }

  async getBytes(name: string) {
    const entry = this.entries.find((item) => item.name === name);
    if (!entry) {
      throw new Error(`${name} was not found in the package.`);
    }
    if (entry.data) {
      return entry.data;
    }

    const compressed = this.compressedData(entry);
    if (entry.method === 0) {
      entry.data = compressed;
      return entry.data;
    }

    if (entry.method !== 8) {
      throw new Error(`Unsupported zip compression method ${entry.method} in ${entry.name}.`);
    }

    const Decompression = (globalThis as unknown as { DecompressionStream?: new (format: string) => TransformStream })
      .DecompressionStream;
    if (!Decompression) {
      throw new Error("This browser cannot read compressed Office files.");
    }

    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new Decompression("deflate-raw"));
      entry.data = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      const stream = new Blob([compressed]).stream().pipeThrough(new Decompression("deflate"));
      entry.data = new Uint8Array(await new Response(stream).arrayBuffer());
    }

    if (entry.uncompressedSize && entry.data.byteLength !== entry.uncompressedSize) {
      return entry.data;
    }
    return entry.data;
  }

  async getText(name: string) {
    return new TextDecoder("utf-8").decode(await this.getBytes(name));
  }

  async materialize() {
    const result = new Map<string, Uint8Array>();
    for (const entry of this.entries) {
      result.set(entry.name, await this.getBytes(entry.name));
    }
    return result;
  }
}

function parseXml(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) {
    throw new Error("An Office XML part could not be parsed.");
  }
  return doc;
}

function elementsByLocalName(root: ParentNode, localName: string) {
  return Array.from(root.querySelectorAll("*")).filter((element) => element.localName === localName);
}

function firstElementByLocalName(root: ParentNode, localName: string) {
  return elementsByLocalName(root, localName)[0] as Element | undefined;
}

function resolveZipPath(basePath: string, target: string) {
  if (target.startsWith("/")) {
    return target.slice(1);
  }

  const parts = basePath.split("/");
  parts.pop();
  for (const part of target.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function columnIndex(ref: string) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, value - 1);
}

function readSharedStrings(xml: string) {
  const doc = parseXml(xml);
  return elementsByLocalName(doc, "si").map((item) =>
    elementsByLocalName(item, "t")
      .map((node) => node.textContent ?? "")
      .join(""),
  );
}

function readSheetRows(xml: string, sharedStrings: string[]) {
  const doc = parseXml(xml);
  const rows: CellValue[][] = [];

  for (const rowNode of elementsByLocalName(doc, "row")) {
    const row: CellValue[] = [];

    for (const cell of elementsByLocalName(rowNode, "c")) {
      const ref = cell.getAttribute("r") ?? "";
      const index = ref ? columnIndex(ref) : row.length;
      const type = cell.getAttribute("t");
      const valueNode = firstElementByLocalName(cell, "v");
      let value: CellValue = null;

      if (type === "inlineStr") {
        value = elementsByLocalName(cell, "t")
          .map((node) => node.textContent ?? "")
          .join("");
      } else if (valueNode) {
        const raw = valueNode.textContent ?? "";
        if (type === "s") {
          value = sharedStrings[Number(raw)] ?? "";
        } else if (type === "b") {
          value = raw === "1";
        } else if (type === "str") {
          value = raw;
        } else {
          const numeric = Number(raw);
          value = Number.isFinite(numeric) ? numeric : raw;
        }
      }

      row[index] = value;
    }

    if (row.some((value) => value !== null && value !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

async function readWorkbook(buffer: ArrayBuffer): Promise<SheetData[]> {
  const zip = await ZipArchive.fromArrayBuffer(buffer);
  const workbook = parseXml(await zip.getText("xl/workbook.xml"));
  const rels = parseXml(await zip.getText("xl/_rels/workbook.xml.rels"));
  const sharedStrings = zip.entries.some((entry) => entry.name === "xl/sharedStrings.xml")
    ? readSharedStrings(await zip.getText("xl/sharedStrings.xml"))
    : [];

  const relationshipTargets = new Map<string, string>();
  for (const rel of elementsByLocalName(rels, "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) {
      relationshipTargets.set(id, resolveZipPath("xl/workbook.xml", target));
    }
  }

  const sheets: SheetData[] = [];
  for (const sheet of elementsByLocalName(workbook, "sheet")) {
    const name = sheet.getAttribute("name") ?? "Sheet";
    const relId =
      sheet.getAttribute("r:id") ??
      sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = relId ? relationshipTargets.get(relId) : null;
    if (!target || !zip.entries.some((entry) => entry.name === target)) {
      continue;
    }
    sheets.push({
      name,
      rows: readSheetRows(await zip.getText(target), sharedStrings),
    });
  }

  return sheets;
}

async function buildAnalysisFromFile(file: File) {
  const sheets = await readWorkbook(await file.arrayBuffer());
  if (!sheets.length) {
    throw new Error("No worksheet was found in the uploaded file.");
  }

  const bestSheet = chooseBestSheet(sheets);
  const rawRows = mapRawRows(bestSheet.rows);
  const rcmRows = toRcmRows(rawRows);

  if (!rcmRows.length) {
    throw new Error("No RCM rows were found. Check that the raw data headers are present.");
  }

  return summarizeRows(file.name, bestSheet.name, bestSheet.rows, rcmRows);
}

function pct(value: number, total: number) {
  if (!total) {
    return "0%";
  }
  return `${Math.round((value / total) * 100)}%`;
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const startX = cx + radius * Math.cos(start);
  const startY = cy + radius * Math.sin(start);
  const endX = cx + radius * Math.cos(end);
  const endY = cy + radius * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
}

function StrategyDonut({ items }: { items: StrategySummary[] }) {
  const total = items.reduce((sum, item) => sum + item.revised, 0);
  let cursor = -Math.PI / 2;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 220 220" aria-label="Maintenance strategy split" role="img">
        <circle cx="110" cy="110" r="75" fill="none" stroke="#e4e7ec" strokeWidth="28" />
        {items.map((item, index) => {
          const span = total ? (item.revised / total) * Math.PI * 2 : 0;
          const start = cursor;
          const end = cursor + span;
          cursor = end;
          return (
            <path
              d={arcPath(110, 110, 75, start, end)}
              fill="none"
              key={item.code}
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeLinecap="butt"
              strokeWidth="28"
            />
          );
        })}
        <text className="donut-number" x="110" y="105">
          {total}
        </text>
        <text className="donut-label" x="110" y="128">
          tasks
        </text>
      </svg>
    </div>
  );
}

function WorkCenterBars({ items }: { items: WorkCenterSummary[] }) {
  const max = Math.max(1, ...items.map((item) => item.total));
  return (
    <div className="bar-list">
      {items.slice(0, 6).map((item) => (
        <div className="bar-row" key={item.name}>
          <div className="bar-label">
            <span>{item.name}</span>
            <strong>{item.total}</strong>
          </div>
          <div className="bar-track">
            <span className="bar-total" style={{ width: `${(item.total / max) * 100}%` }} />
            <span className="bar-executed" style={{ width: `${(item.executed / max) * 100}%` }} />
          </div>
          <div className="bar-meta">
            <span>{item.executed} executed</span>
            <span>{item.pending} pending</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TablePreview({ title, rows }: { title: string; rows: RCMRow[] }) {
  return (
    <section className="data-panel">
      <div className="panel-heading">
        <h3>{title}</h3>
        <span>{rows.length} rows</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Ref</th>
              <th>Failure Mode</th>
              <th>Proposed Task</th>
              <th>Interval</th>
              <th>Trade</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row, index) => (
              <tr key={`${row.reference}-${index}`}>
                <td>{index + 1}</td>
                <td>{row.reference}</td>
                <td>{row.failureMode}</td>
                <td>{row.proposedTask || row.previousProposedTask || "n/a"}</td>
                <td>{row.interval || row.previousInterval || "n/a"}</td>
                <td>{row.workCenter || "Unassigned"}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6}>No matching implemented tasks in this upload.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function makeCrcTable() {
  const table: number[] = [];
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(data: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of data) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function createZip(
  entries: Map<string, Uint8Array>,
  type = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
) {
  const centralParts: Uint8Array[] = [];
  const localParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = encodeText(name);
    const checksum = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    writeUint32(local, 0, 0x04034b50);
    writeUint16(local, 4, 20);
    writeUint16(local, 6, 0x0800);
    writeUint16(local, 8, 0);
    writeUint16(local, 10, 0);
    writeUint16(local, 12, 0);
    writeUint32(local, 14, checksum);
    writeUint32(local, 18, data.length);
    writeUint32(local, 22, data.length);
    writeUint16(local, 26, nameBytes.length);
    local.set(nameBytes, 30);

    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    writeUint32(central, 0, 0x02014b50);
    writeUint16(central, 4, 20);
    writeUint16(central, 6, 20);
    writeUint16(central, 8, 0x0800);
    writeUint16(central, 10, 0);
    writeUint16(central, 12, 0);
    writeUint16(central, 14, 0);
    writeUint32(central, 16, checksum);
    writeUint32(central, 20, data.length);
    writeUint32(central, 24, data.length);
    writeUint16(central, 28, nameBytes.length);
    writeUint32(central, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 8, entries.size);
  writeUint16(end, 10, entries.size);
  writeUint32(end, 12, centralSize);
  writeUint32(end, 16, offset);

  return new Blob([...localParts, ...centralParts, end], { type });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeXml(value: CellValue | string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellReference(rowIndex: number, columnIndexValue: number) {
  return `${columnName(columnIndexValue)}${rowIndex + 1}`;
}

function sheetRange(rowCount: number, columnCount: number) {
  return `A1:${columnName(Math.max(0, columnCount - 1))}${Math.max(1, rowCount)}`;
}

function cellXml(value: CellValue, rowIndex: number, columnIndexValue: number) {
  const ref = cellReference(rowIndex, columnIndexValue);
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function rowsToSheetData(rows: CellValue[][]) {
  return rows
    .map((row, rowIndex) => {
      const cells = row.map((value, columnIndexValue) => cellXml(value, rowIndex, columnIndexValue)).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
}

function replaceSheetRows(xml: string, rows: CellValue[][], columnCount: number) {
  const dimension = sheetRange(rows.length, columnCount);
  let next = xml.replace(/<dimension[^>]*\/>/, `<dimension ref="${dimension}"/>`);
  next = next.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${rowsToSheetData(rows)}</sheetData>`);
  return next;
}

function patchTableReference(xml: string, ref: string) {
  return xml
    .replace(/\bref="[^"]+"/, `ref="${ref}"`)
    .replace(/<autoFilter\b([^>]*)ref="[^"]+"/, `<autoFilter$1ref="${ref}"`)
    .replace(/<sortState\b([^>]*)ref="[^"]+"/, `<sortState$1ref="A2:${ref.split(":")[1]}"`);
}

function patchWorkbookCalculation(xml: string) {
  const calcPr =
    '<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  if (/<calcPr\b[\s\S]*?\/>/.test(xml)) {
    return xml.replace(/<calcPr\b[\s\S]*?\/>/, calcPr);
  }
  return xml.replace("</workbook>", `${calcPr}</workbook>`);
}

function removeRelationship(xml: string, targetIncludes: string) {
  return xml.replace(
    new RegExp(`<Relationship\\b[^>]*Target="[^"]*${targetIncludes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`, "g"),
    "",
  );
}

function removeContentTypeOverride(xml: string, partName: string) {
  return xml.replace(
    new RegExp(`<Override\\b[^>]*PartName="/${partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`, "g"),
    "",
  );
}

function buildQueryRows(summary: AnalysisSummary): CellValue[][] {
  const duplicateCounts = countBy(summary.rows, (row) => row.duplicateKey.toLowerCase());
  return [
    [
      "Site",
      "RCM_ID",
      "RCM_No",
      "Version",
      "Reference",
      "Function",
      "Function_Failure",
      "Failure_Mode",
      "Failure_Effect",
      "Analysis_Tracking",
      "Recommended_Strategy",
      "Proposed_Task",
      "Interval",
      "Work_Center",
      "Implemented",
      "KKS_Code",
      "Previous_Proposed_Task",
      "Previous_Interval",
      "Column1",
      "Column2",
      "Column3",
      "Column4",
      "Failure_Mode+Proposed_Task",
      "Count",
      "Duplicate",
    ],
    ...summary.rows.map((row) => {
      const count = duplicateCounts.get(row.duplicateKey.toLowerCase()) ?? 1;
      return [
        row.site,
        row.rcmId,
        row.rcmNo,
        row.version,
        row.reference,
        row.functionText,
        row.functionFailure,
        row.failureMode,
        row.failureEffect,
        row.analysisTracking,
        row.recommendedStrategy,
        row.proposedTask,
        row.interval,
        row.workCenter,
        row.implemented,
        row.kksCode,
        row.previousProposedTask,
        row.previousInterval,
        "",
        "",
        "",
        "",
        row.duplicateKey,
        count,
        count > 1 ? "Duplicate" : "Unique",
      ];
    }),
  ];
}

type ComparisonRow = {
  current: CellValue[];
  recommended: CellValue[];
};

function buildComparisonRows(summary: AnalysisSummary): ComparisonRow[] {
  return summary.rows
    .filter((row) => strategyIsActionable(row.recommendedStrategy))
    .map((row, index) => {
      const currentTask = row.previousProposedTask && row.previousProposedTask !== "0"
        ? row.previousProposedTask
        : row.proposedTask;
      const currentInterval = row.previousInterval && row.previousInterval !== "0"
        ? row.previousInterval
        : row.interval;
      return {
        current: row.implemented
          ? [index + 1, row.reference, row.failureMode, currentTask, currentInterval, row.workCenter]
          : ["", "", "", "", "", ""],
        recommended: [
          index + 1,
          row.reference,
          row.failureMode,
          row.proposedTask,
          row.interval,
          row.workCenter,
          row.implemented ? "No change" : "Added new",
        ],
      };
    });
}

function buildCurrentVsRcmRows(summary: AnalysisSummary): CellValue[][] {
  const rows: CellValue[][] = [
    [
      "Current Maintenance Plan (TRUE)",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "RCM Recommended Maintenance Plan (TRUE+FALSE)",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    [
      "No",
      "Ref",
      "Failure Mode",
      "Proposed Task",
      "Interval",
      "Trade",
      "Type Of Asset",
      "Remarks",
      "",
      "No",
      "Ref",
      "Failure Mode",
      "Proposed Task",
      "Interval",
      "Trade",
      "Remarks",
    ],
  ];
  for (const row of buildComparisonRows(summary)) {
    rows.push([...row.current, "", "", "", ...row.recommended]);
  }
  return rows;
}

function setTextCache(doc: Document, cache: Element | undefined, values: string[]) {
  if (!cache) {
    return;
  }
  while (cache.firstChild) {
    cache.removeChild(cache.firstChild);
  }
  const count = doc.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/chart", "c:ptCount");
  count.setAttribute("val", String(values.length));
  cache.appendChild(count);
  values.forEach((value, index) => {
    const point = doc.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/chart", "c:pt");
    point.setAttribute("idx", String(index));
    const item = doc.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/chart", "c:v");
    item.textContent = value;
    point.appendChild(item);
    cache.appendChild(point);
  });
}

function setNumberCache(doc: Document, cache: Element | undefined, values: number[]) {
  if (!cache) {
    return;
  }
  while (cache.firstChild) {
    cache.removeChild(cache.firstChild);
  }
  const format = doc.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/chart", "c:formatCode");
  format.textContent = "General";
  cache.appendChild(format);
  const count = doc.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/chart", "c:ptCount");
  count.setAttribute("val", String(values.length));
  cache.appendChild(count);
  values.forEach((value, index) => {
    const point = doc.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/chart", "c:pt");
    point.setAttribute("idx", String(index));
    const item = doc.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/chart", "c:v");
    item.textContent = String(value);
    point.appendChild(item);
    cache.appendChild(point);
  });
}

function patchChartTitle(doc: Document, assetName: string) {
  for (const node of elementsByLocalName(doc, "t")) {
    if (node.textContent?.includes("GENERATOR TRANSFORMERS")) {
      node.textContent = node.textContent.replace("GENERATOR TRANSFORMERS", assetName.toUpperCase());
    }
  }
}

function patchPieChart(xml: string, summary: AnalysisSummary, meta: ReportMeta) {
  const doc = parseXml(xml);
  const series = firstElementByLocalName(doc, "ser");
  if (!series) {
    return xml;
  }

  const items = summary.actionableStrategySummary.length
    ? summary.actionableStrategySummary
    : summary.strategySummary.filter((item) => item.revised > 0);
  const labels = items.map((item) => item.label);
  const values = items.map((item) => item.revised);
  const categoryCache = firstElementByLocalName(firstElementByLocalName(series, "cat") ?? series, "strCache");
  const valueCache = firstElementByLocalName(firstElementByLocalName(series, "val") ?? series, "numCache");

  setTextCache(doc, categoryCache, labels);
  setNumberCache(doc, valueCache, values);
  patchChartTitle(doc, meta.assetName);

  return new XMLSerializer().serializeToString(doc);
}

function patchBarChart(xml: string, summary: AnalysisSummary, meta: ReportMeta) {
  const doc = parseXml(xml);
  const workCenters = summary.workCenters.slice(0, 6);
  const labels = workCenters.map((item) => item.name);
  const totals = workCenters.map((item) => item.total);
  const executed = workCenters.map((item) => item.executed);
  const series = elementsByLocalName(doc, "ser");

  series.forEach((item, index) => {
    const categoryCache = firstElementByLocalName(firstElementByLocalName(item, "cat") ?? item, "strCache");
    const valueCache = firstElementByLocalName(firstElementByLocalName(item, "val") ?? item, "numCache");
    setTextCache(doc, categoryCache, labels);
    setNumberCache(doc, valueCache, index === 0 ? totals : executed);
  });
  patchChartTitle(doc, meta.assetName);

  return new XMLSerializer().serializeToString(doc);
}

function patchSlideTexts(xml: string, replacements: { includes: string; text: string }[]) {
  const doc = parseXml(xml);
  for (const shape of elementsByLocalName(doc, "sp")) {
    const textNodes = elementsByLocalName(shape, "t");
    const fullText = textNodes.map((node) => node.textContent ?? "").join("");
    const replacement = replacements.find((item) => fullText.includes(item.includes));
    if (!replacement || !textNodes.length) {
      continue;
    }
    textNodes[0].textContent = replacement.text;
    for (const node of textNodes.slice(1)) {
      node.textContent = "";
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function setTextNodesText(container: ParentNode, value: string) {
  const textNodes = elementsByLocalName(container, "t");
  if (!textNodes.length) {
    return;
  }
  textNodes[0].textContent = value;
  for (const node of textNodes.slice(1)) {
    node.textContent = "";
  }
}

function forcePlainPowerPointText(container: ParentNode) {
  for (const propertyName of ["rPr", "endParaRPr", "defRPr"]) {
    for (const properties of elementsByLocalName(container, propertyName)) {
      properties.setAttribute("b", "0");
      properties.setAttribute("u", "none");
    }
  }
}

function setTableCellText(cell: Element, value: CellValue) {
  setTextNodesText(cell, String(value ?? ""));
}

function tableRows(table: Element) {
  return Array.from(table.childNodes).filter(
    (node): node is Element => node instanceof Element && node.localName === "tr",
  );
}

function tableCells(row: Element) {
  return Array.from(row.childNodes).filter(
    (node): node is Element => node instanceof Element && node.localName === "tc",
  );
}

function firstTable(doc: Document) {
  return firstElementByLocalName(doc, "tbl");
}

function blankShapeTexts(xml: string, includes: string[]) {
  const doc = parseXml(xml);
  for (const shape of [...elementsByLocalName(doc, "sp"), ...elementsByLocalName(doc, "graphicFrame")]) {
    const fullText = elementsByLocalName(shape, "t")
      .map((node) => node.textContent ?? "")
      .join("");
    if (includes.some((item) => fullText.includes(item))) {
      setTextNodesText(shape, "");
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function removePicturesByRelationship(xml: string, relIds: string[]) {
  const doc = parseXml(xml);
  for (const pic of elementsByLocalName(doc, "pic")) {
    const blip = firstElementByLocalName(pic, "blip");
    const relId =
      blip?.getAttribute("r:embed") ??
      blip?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
    if (relId && relIds.includes(relId)) {
      pic.parentNode?.removeChild(pic);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function blankTextRuns(xml: string, terms: string[]) {
  const doc = parseXml(xml);
  for (const node of elementsByLocalName(doc, "t")) {
    const value = node.textContent ?? "";
    if (terms.some((term) => value.includes(term))) {
      node.textContent = "";
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function patchTeamMembersSlide(xml: string) {
  const doc = parseXml(xml);
  for (const shape of elementsByLocalName(doc, "sp")) {
    const fullText = elementsByLocalName(shape, "t")
      .map((node) => node.textContent ?? "")
      .join("");
    if (fullText.includes("System") && fullText.includes("Venue") && fullText.includes("Analysis date")) {
      setTextNodesText(shape, "System \t\t:\nVenue \t\t:\nAnalysis date \t:");
    }
  }

  const table = firstTable(doc);
  if (table) {
    tableRows(table).forEach((row, rowIndex) => {
      if (rowIndex === 0) {
        return;
      }
      const cells = tableCells(row);
      cells.forEach((cell, cellIndex) => {
        setTableCellText(cell, cellIndex === 0 ? rowIndex : "");
      });
    });
  }
  return new XMLSerializer().serializeToString(doc);
}

function patchOperatingContextSlide(xml: string) {
  const doc = parseXml(xml);
  for (const shape of elementsByLocalName(doc, "sp")) {
    const fullText = elementsByLocalName(shape, "t")
      .map((node) => node.textContent ?? "")
      .join("");
    if (fullText.includes("Primary Function:")) {
      setTextNodesText(shape, "Primary Function:\n\nOperating Context:\n\nReason of system selection:");
    }
    if (fullText.includes("Generator Transformers process flow and major parts")) {
      setTextNodesText(shape, "");
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function patchSystemBoundarySlide(xml: string) {
  let next = removePicturesByRelationship(xml, ["rId4"]);
  next = blankShapeTexts(next, [
    "List of components",
    "The scope or limits of the RCM analysis",
  ]);
  return next;
}

function patchAuditSessionSlide(xml: string, meta: ReportMeta) {
  const doc = parseXml(xml);
  const auditComment = formatAuditComments(meta.auditComments);

  for (const shape of [...elementsByLocalName(doc, "sp"), ...elementsByLocalName(doc, "graphicFrame")]) {
    const fullText = elementsByLocalName(shape, "t")
      .map((node) => node.textContent ?? "")
      .join("");

    if (fullText.includes("No.NameRolePosition") || fullText.includes("Venue")) {
      setTextNodesText(shape, "");
    }

    if (fullText.includes("The management of")) {
      setTextNodesText(shape, auditComment ? "RCM Audit Comment" : "");
      forcePlainPowerPointText(shape);
    }

    if (fullText.includes("Auditors")) {
      setTextNodesText(shape, auditComment);
      forcePlainPowerPointText(shape);
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

function patchComparisonSlide(xml: string, rows: ComparisonRow[], startIndex: number, pageNumber: number) {
  const doc = parseXml(xml);
  const table = firstTable(doc);
  if (table) {
    const pptRows = tableRows(table);
    const bodyRows = pptRows.slice(3);
    bodyRows.forEach((row, offset) => {
      const planRow = rows[startIndex + offset];
      const values = planRow
        ? [...planRow.current, "\u00a0", ...planRow.recommended]
        : ["", "", "", "", "", "", "\u00a0", "", "", "", "", "", "", ""];
      tableCells(row).forEach((cell, cellIndex) => setTableCellText(cell, values[cellIndex] ?? ""));
    });
  }
  for (const shape of elementsByLocalName(doc, "sp")) {
    const fullText = elementsByLocalName(shape, "t")
      .map((node) => node.textContent ?? "")
      .join("");
    if (/^\d+$/.test(fullText.trim())) {
      setTextNodesText(shape, String(pageNumber));
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function buildRecommendations(summary: AnalysisSummary, meta: ReportMeta) {
  const topTrade = summary.workCenters[0];
  const topStrategy = summary.topStrategies[0];
  const duplicateCount = summary.duplicateRows.reduce((total, row) => total + row.duplicateCount, 0);
  return [
    `Endorse the ${summary.actionableTasks} proposed maintenance tasks for ${meta.assetName}, with priority given to the ${summary.pendingTasks} newly added tasks before ERMS upload.`,
    `Assign task ownership by work centre and interval in the RCM Recommended Maintenance Plan${topTrade ? `, starting with ${topTrade.name} because it carries ${topTrade.total} task(s)` : ""}.`,
    `Use the exported working file as the controlled task register so approved changes, current maintenance references, intervals and remarks remain traceable to the uploaded raw RCM data.`,
    topStrategy
      ? `Prioritise implementation controls for ${topStrategy.code} tasks, as this is the largest recommended strategy group in the analysis.`
      : "Prioritise implementation controls for the highest-volume recommended strategy group in the analysis.",
    duplicateCount
      ? `Review duplicate failure-mode/task combinations before upload to reduce ERMS master-data duplication and align common tasks under one maintainable plan.`
      : "Review the RCM register annually and after any major failure, plant modification or operating context change to keep the maintenance plan current.",
  ];
}

function escapeHtml(value: CellValue | string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function htmlCell(value: CellValue | string) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function reportTable(headers: string[], rows: Array<Array<CellValue | string>>, className = "") {
  return `
    <div class="table-wrap ${className}">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                      <tr>${row.map((cell) => `<td>${htmlCell(cell)}</td>`).join("")}</tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="${headers.length}">No data available.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function metricBlock(label: string, value: CellValue, note: string) {
  return `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function exportPdfReport(summary: AnalysisSummary, meta: ReportMeta) {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    throw new Error("The PDF report window was blocked. Allow pop-ups for this site and try again.");
  }

  const comparisonRows = buildComparisonRows(summary).slice(0, 80);
  const recommendations = buildRecommendations(summary, meta);
  const logoUrl = new URL("tnb-genco-logo.png", window.location.href).href;
  const rcmIconUrl = new URL("rcm-favicon.png", window.location.href).href;
  const generatedAt = new Date().toLocaleString();
  const strategyRows = summary.strategySummary
    .filter((item) => item.revised > 0 || item.existing > 0)
    .map((item) => [
      item.code,
      item.label,
      item.existing,
      item.revised,
      Math.max(0, item.revised - item.existing),
    ]);
  const workCenterRows = summary.workCenters.map((item) => [
    item.name,
    item.total,
    item.executed,
    item.pending,
    pct(item.executed, item.total),
  ]);
  const comparisonTableRows = comparisonRows.map((row) => [
    row.recommended[0],
    row.recommended[1],
    row.recommended[2],
    row.current[3],
    row.current[4],
    row.recommended[3],
    row.recommended[4],
    row.recommended[5],
    row.recommended[6],
  ]);
  const duplicateRows = summary.duplicateRows.map((row) => [
    row.failureMode,
    row.proposedTask || "No proposed task",
    row.duplicateCount,
  ]);

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>RCM Genco PDF Report - ${escapeHtml(meta.assetName)}</title>
        <style>
          @page { margin: 14mm; size: A4; }
          * { box-sizing: border-box; }
          body {
            color: #12233b;
            font-family: Arial, Helvetica, sans-serif;
            margin: 0;
            background: #ffffff;
          }
          .cover {
            min-height: 940px;
            background:
              linear-gradient(145deg, rgba(3, 89, 153, 0.92), rgba(15, 171, 204, 0.70)),
              linear-gradient(180deg, #eaf8ff, #ffffff);
            color: white;
            padding: 38px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            page-break-after: always;
          }
          .cover-top, .report-top {
            align-items: center;
            display: flex;
            justify-content: space-between;
            gap: 18px;
          }
          .brand {
            background: rgba(255,255,255,0.92);
            border-radius: 8px;
            padding: 8px 12px;
          }
          .brand img { height: 48px; width: auto; }
          .rcm-mark {
            align-items: center;
            display: flex;
            gap: 12px;
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0;
            text-transform: uppercase;
          }
          .rcm-mark img { border-radius: 5px; height: 42px; object-fit: cover; width: 42px; }
          .cover h1 {
            font-size: 46px;
            letter-spacing: 0;
            line-height: 1.05;
            margin: 80px 0 12px;
            max-width: 720px;
          }
          .cover .subtitle {
            color: rgba(255,255,255,0.86);
            font-size: 18px;
            font-weight: 700;
            line-height: 1.45;
            max-width: 680px;
          }
          .meta-grid {
            border-top: 1px solid rgba(255,255,255,0.35);
            display: grid;
            gap: 12px;
            grid-template-columns: repeat(4, 1fr);
            padding-top: 20px;
          }
          .meta-grid span, .metric span, .section-kicker {
            color: #5b708a;
            display: block;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0;
            text-transform: uppercase;
          }
          .cover .meta-grid span { color: rgba(255,255,255,0.72); }
          .meta-grid strong {
            display: block;
            font-size: 14px;
            line-height: 1.35;
            margin-top: 4px;
          }
          .page {
            padding: 0;
            page-break-after: always;
          }
          .report-top {
            border-bottom: 3px solid #0878c9;
            margin-bottom: 18px;
            padding-bottom: 12px;
          }
          .report-top h2 {
            font-size: 24px;
            line-height: 1.15;
            margin: 2px 0 0;
          }
          .section {
            break-inside: avoid;
            margin: 0 0 20px;
          }
          .section h3 {
            color: #07518e;
            font-size: 17px;
            margin: 4px 0 10px;
          }
          .metric-grid {
            display: grid;
            gap: 10px;
            grid-template-columns: repeat(4, 1fr);
            margin-bottom: 18px;
          }
          .metric {
            background: linear-gradient(180deg, #f4fbff, #ffffff);
            border: 1px solid #c9e5f5;
            border-radius: 8px;
            padding: 12px;
          }
          .metric strong {
            color: #07518e;
            display: block;
            font-size: 30px;
            line-height: 1;
            margin: 8px 0 6px;
          }
          .metric small {
            color: #5b708a;
            font-size: 11px;
            font-weight: 700;
          }
          .insight-grid {
            display: grid;
            gap: 14px;
            grid-template-columns: 1fr 1fr;
          }
          .recommendations {
            counter-reset: rec;
            display: grid;
            gap: 10px;
            margin: 0;
            padding: 0;
          }
          .recommendations li {
            background: #f7fbff;
            border-left: 4px solid #f26a2e;
            border-radius: 6px;
            line-height: 1.45;
            list-style: none;
            padding: 10px 12px;
          }
          .audit-comment {
            background: #fff3cb;
            border: 1px solid #d7b85c;
            border-radius: 8px;
            color: #12233b;
            font-size: 13px;
            line-height: 1.5;
            min-height: 110px;
            padding: 14px;
            white-space: pre-wrap;
          }
          .table-wrap {
            border: 1px solid #d8e7f2;
            border-radius: 8px;
            overflow: hidden;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th {
            background: #0878c9;
            color: white;
            font-size: 10px;
            padding: 7px 6px;
            text-align: left;
            text-transform: uppercase;
          }
          td {
            border-top: 1px solid #e3edf4;
            font-size: 10px;
            line-height: 1.3;
            padding: 6px;
            vertical-align: top;
          }
          tbody tr:nth-child(even) td { background: #f7fbff; }
          .comparison td:nth-child(4),
          .comparison td:nth-child(6) { min-width: 130px; }
          .note {
            color: #5b708a;
            font-size: 11px;
            line-height: 1.45;
            margin-top: 8px;
          }
          .footer {
            border-top: 1px solid #d8e7f2;
            color: #6a7c91;
            font-size: 10px;
            margin-top: 14px;
            padding-top: 8px;
          }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <section class="cover">
          <div class="cover-top">
            <div class="rcm-mark"><img src="${rcmIconUrl}" alt="" /> RCM Genco</div>
            <div class="brand"><img src="${logoUrl}" alt="TNB Genco" /></div>
          </div>
          <div>
            <h1>Reliability Centered Maintenance Analysis Report</h1>
            <div class="subtitle">
              Dashboard-generated PDF summary for ${escapeHtml(meta.assetName)} using the uploaded raw RCM workbook data.
            </div>
          </div>
          <div class="meta-grid">
            <div><span>Station</span><strong>${escapeHtml(meta.station || "-")}</strong></div>
            <div><span>System</span><strong>${escapeHtml(meta.assetName || "-")}</strong></div>
            <div><span>Analysis Date</span><strong>${escapeHtml(meta.analysisDate || "-")}</strong></div>
            <div><span>Source</span><strong>${escapeHtml(summary.fileName)}</strong></div>
          </div>
        </section>

        <section class="page">
          <header class="report-top">
            <div>
              <span class="section-kicker">Executive Summary</span>
              <h2>RCM analysis converts uploaded raw data into actionable maintenance insight.</h2>
            </div>
            <div class="brand"><img src="${logoUrl}" alt="TNB Genco" /></div>
          </header>
          <div class="metric-grid">
            ${metricBlock("Functions analysed", summary.functionsRevised, `${summary.functionsExisting} existing`)}
            ${metricBlock("Failure modes", summary.failureModesRevised, `${summary.failureModesExisting} existing`)}
            ${metricBlock("Maintenance tasks", summary.actionableTasks, `${summary.pendingTasks} newly added`)}
            ${metricBlock("Task executed", summary.executedTasks, pct(summary.executedTasks, summary.actionableTasks))}
          </div>
          <div class="insight-grid">
            <section class="section">
              <span class="section-kicker">Maintenance Strategy</span>
              <h3>Existing vs revised strategy count</h3>
              ${reportTable(["Code", "Strategy", "Existing", "Revised", "New"], strategyRows)}
            </section>
            <section class="section">
              <span class="section-kicker">Task Ownership</span>
              <h3>Work-centre execution profile</h3>
              ${reportTable(["Work Centre", "Total", "Executed", "Pending", "Progress"], workCenterRows)}
            </section>
          </div>
          <section class="section">
            <span class="section-kicker">Recommendation</span>
            <h3>Actions to progress the maintenance plan</h3>
            <ol class="recommendations">
              ${recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ol>
          </section>
          <section class="section">
            <span class="section-kicker">RCM Audit Session</span>
            <h3>Management audit comment</h3>
            <div class="audit-comment">${htmlCell(formatAuditComments(meta.auditComments) || "No audit comment recorded.")}</div>
          </section>
          <div class="footer">Generated ${escapeHtml(generatedAt)} from ${escapeHtml(summary.sheetName)} - ${summary.totalRows} RCM rows.</div>
        </section>

        <section class="page">
          <header class="report-top">
            <div>
              <span class="section-kicker">Maintenance Plan Comparison</span>
              <h2>Current maintenance plan compared with RCM recommended plan.</h2>
            </div>
            <div class="brand"><img src="${logoUrl}" alt="TNB Genco" /></div>
          </header>
          ${reportTable(
            ["No", "Ref", "Failure Mode", "Current Task", "Current Interval", "RCM Task", "RCM Interval", "Trade", "Remarks"],
            comparisonTableRows,
            "comparison",
          )}
          <p class="note">Showing the first ${comparisonRows.length} actionable maintenance rows in the PDF report. Export the working file for the full editable register.</p>
        </section>

        <section class="page">
          <header class="report-top">
            <div>
              <span class="section-kicker">Data Quality</span>
              <h2>Duplicate task groups and implementation focus areas.</h2>
            </div>
            <div class="brand"><img src="${logoUrl}" alt="TNB Genco" /></div>
          </header>
          <section class="section">
            <h3>Duplicate failure-mode/task combinations</h3>
            ${reportTable(["Failure Mode", "Proposed Task", "Rows"], duplicateRows)}
          </section>
          <section class="section">
            <h3>Report profile</h3>
            ${reportTable(["Field", "Value"], [
              ["Station", meta.station || "-"],
              ["System", meta.assetName || "-"],
              ["Analysis Date", meta.analysisDate || "-"],
              ["Audit Date", meta.auditDate || "-"],
              ["RCM ID", summary.metadata.rcmId || "-"],
              ["RCM Audit Comment", formatAuditComments(meta.auditComments) || "-"],
              ["Rows Analysed", summary.totalRows],
            ])}
          </section>
          <div class="footer">RCM Genco PDF report. Use the PowerPoint and working-file exports for editable presentation and workbook handoff.</div>
        </section>
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => {
              window.focus();
              window.print();
            }, 450);
          });
        </script>
      </body>
    </html>`;

  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
}

function patchRecommendationSlide(xml: string, summary: AnalysisSummary, meta: ReportMeta) {
  const doc = parseXml(xml);
  const recommendations = buildRecommendations(summary, meta)
    .map((item, index) => `${index + 1}.    ${item}`)
    .join("\n\n");
  for (const shape of elementsByLocalName(doc, "sp")) {
    const fullText = elementsByLocalName(shape, "t")
      .map((node) => node.textContent ?? "")
      .join("");
    if (fullText.includes("The station management is recommended")) {
      setTextNodesText(shape, recommendations);
    }
    if (fullText.includes("Actions to be taken by station")) {
      setTextNodesText(
        shape,
        `Actions to be taken by station to further improve the operation & maintenance practices of ${meta.assetName}.`,
      );
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

async function exportWorkingFile(summary: AnalysisSummary, meta: ReportMeta) {
  const response = await fetch(new URL("working-template.xlsm", window.location.href));
  if (!response.ok) {
    throw new Error("The working-file template could not be loaded.");
  }

  const zip = await ZipArchive.fromArrayBuffer(await response.arrayBuffer());
  const entries = await zip.materialize();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readEntryText = (name: string) => {
    const bytes = entries.get(name);
    if (!bytes) {
      throw new Error(`${name} was not found in the working-file template.`);
    }
    return decoder.decode(bytes);
  };

  const sourceColumnCount = Math.max(24, summary.sourceRows[0]?.length ?? 24);
  const queryRows = buildQueryRows(summary);
  const currentVsRcmRows = buildCurrentVsRcmRows(summary);

  entries.set(
    "xl/worksheets/sheet2.xml",
    encoder.encode(replaceSheetRows(readEntryText("xl/worksheets/sheet2.xml"), summary.sourceRows, sourceColumnCount)),
  );
  entries.set(
    "xl/worksheets/sheet3.xml",
    encoder.encode(replaceSheetRows(readEntryText("xl/worksheets/sheet3.xml"), queryRows, 25)),
  );
  entries.set(
    "xl/worksheets/sheet5.xml",
    encoder.encode(replaceSheetRows(readEntryText("xl/worksheets/sheet5.xml"), currentVsRcmRows, 16)),
  );
  entries.set(
    "xl/tables/table1.xml",
    encoder.encode(patchTableReference(readEntryText("xl/tables/table1.xml"), sheetRange(summary.sourceRows.length, 24))),
  );
  entries.set(
    "xl/tables/table2.xml",
    encoder.encode(patchTableReference(readEntryText("xl/tables/table2.xml"), sheetRange(queryRows.length, 25))),
  );
  entries.set("xl/workbook.xml", encoder.encode(patchWorkbookCalculation(readEntryText("xl/workbook.xml"))));
  entries.set(
    "xl/_rels/workbook.xml.rels",
    encoder.encode(removeRelationship(readEntryText("xl/_rels/workbook.xml.rels"), "calcChain.xml")),
  );
  entries.set(
    "[Content_Types].xml",
    encoder.encode(removeContentTypeOverride(readEntryText("[Content_Types].xml"), "xl/calcChain.xml")),
  );
  entries.delete("xl/calcChain.xml");

  const output = createZip(
    entries,
    "application/vnd.ms-excel.sheet.macroEnabled.12",
  );
  downloadBlob(output, `RCM Working File - ${meta.assetName || "Dashboard"}.xlsm`);
}

async function exportPatchedPptx(summary: AnalysisSummary, meta: ReportMeta) {
  const response = await fetch(new URL("report-template.pptx", window.location.href));
  if (!response.ok) {
    throw new Error("The PowerPoint template could not be loaded.");
  }

  const zip = await ZipArchive.fromArrayBuffer(await response.arrayBuffer());
  const entries = await zip.materialize();
  const encoder = new TextEncoder();
  const getEntryText = (name: string) => {
    const bytes = entries.get(name);
    if (!bytes) {
      throw new Error(`${name} was not found in the PowerPoint template.`);
    }
    return new TextDecoder().decode(bytes);
  };

  const slideOne = getEntryText("ppt/slides/slide1.xml");
  entries.set(
    "ppt/slides/slide1.xml",
    encoder.encode(
      blankTextRuns(
        removePicturesByRelationship(
          patchSlideTexts(slideOne, [
            {
              includes: "RCM Analysis Final Report",
              text: `RCM Analysis Final Report ${meta.station} ${meta.assetName} Analysis Date : ${meta.analysisDate} Audit Session Date : ${meta.auditDate}`,
            },
          ]),
          ["rId3", "rId4"],
        ),
        [
          "TS-RE:",
          "Ts. Wan Mohamad Erfan",
          "Sr. Engineer",
          "Planning)",
          "Ir",
          "Ts.",
          "Dinishkaran",
          "Pillai",
          ",",
          "Principal Engineer",
          "Head of Maintenance",
          "Date: 3",
          "October 2025",
          "rd",
        ],
      ),
    ),
  );

  entries.set("ppt/slides/slide5.xml", encoder.encode(patchTeamMembersSlide(getEntryText("ppt/slides/slide5.xml"))));
  entries.set(
    "ppt/slides/slide6.xml",
    encoder.encode(patchOperatingContextSlide(getEntryText("ppt/slides/slide6.xml"))),
  );
  entries.set(
    "ppt/slides/slide7.xml",
    encoder.encode(patchSystemBoundarySlide(getEntryText("ppt/slides/slide7.xml"))),
  );

  const comparisonRows = buildComparisonRows(summary);
  [9, 10, 11, 12].forEach((slideNumber, index) => {
    entries.set(
      `ppt/slides/slide${slideNumber}.xml`,
      encoder.encode(
        patchComparisonSlide(
          getEntryText(`ppt/slides/slide${slideNumber}.xml`),
          comparisonRows,
          index * 14,
          6 + index,
        ),
      ),
    );
  });

  entries.set(
    "ppt/slides/slide13.xml",
    encoder.encode(patchAuditSessionSlide(getEntryText("ppt/slides/slide13.xml"), meta)),
  );

  const slideFourteen = getEntryText("ppt/slides/slide14.xml");
  entries.set(
    "ppt/slides/slide14.xml",
    encoder.encode(
      patchSlideTexts(slideFourteen, [
        {
          includes: "From the RCM analysis",
          text: `From the RCM analysis, a total of ${summary.functionsRevised} functions were analysed, ${summary.failureModesRevised} Failure Modes were evaluated & ${summary.actionableTasks} maintenance tasks were proposed`,
        },
        {
          includes: "tasks were found to be the same",
          text: `A total of ${summary.executedTasks} tasks were found to be the same as the existing tasks already implemented by the station's maintenance teams. The remaining ${summary.pendingTasks} tasks are newly added.`,
        },
      ]),
    ),
  );

  const slideFifteen = getEntryText("ppt/slides/slide15.xml");
  entries.set(
    "ppt/slides/slide15.xml",
    encoder.encode(
      patchSlideTexts(slideFifteen, [
        {
          includes: "A total of 54 maintenance tasks",
          text: `The RCM analysis's objective has been met with a total of ${summary.actionableTasks} maintenance tasks`,
        },
        {
          includes: "A total of 54 maintenance tasks for",
          text: `From this exercise, the objective of the RCM analysis has been met, where a more comprehensive & optimized maintenance strategy for ${meta.assetName} has been generated. A total of ${summary.actionableTasks} maintenance tasks for ${meta.assetName} were proposed by the team members.`,
        },
      ]),
    ),
  );

  const chartOne = getEntryText("ppt/charts/chart1.xml");
  entries.set("ppt/charts/chart1.xml", encoder.encode(patchPieChart(chartOne, summary, meta)));

  const chartTwo = getEntryText("ppt/charts/chart2.xml");
  entries.set("ppt/charts/chart2.xml", encoder.encode(patchBarChart(chartTwo, summary, meta)));

  entries.set(
    "ppt/slides/slide16.xml",
    encoder.encode(patchRecommendationSlide(getEntryText("ppt/slides/slide16.xml"), summary, meta)),
  );

  const output = createZip(entries);
  downloadBlob(output, `RCM Analysis Final Report - ${meta.assetName || "Dashboard"}.pptx`);
}

function MetricCard({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

const VISITOR_COUNTER_URL =
  "https://hits.sh/easa-26.github.io/RCM-Genco.svg?label=Website%20visits&color=0878c9";

function VisitorCounter() {
  const [isAvailable, setIsAvailable] = useState(true);
  const counterUrl = useMemo(() => `${VISITOR_COUNTER_URL}&cache=${Date.now()}`, []);

  return (
    <div className="visitor-counter">
      <span>Website visits</span>
      {isAvailable ? (
        <img
          alt="Total website visits"
          loading="lazy"
          onError={() => setIsAvailable(false)}
          referrerPolicy="no-referrer"
          src={counterUrl}
        />
      ) : (
        <strong>Tracking blocked</strong>
      )}
    </div>
  );
}

export default function RCMDashboard() {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isWorkingExporting, setIsWorkingExporting] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [auditDraft, setAuditDraft] = useState("");
  const [reportMeta, setReportMeta] = useState<ReportMeta>({
    station: "Station",
    assetName: "Generator Transformers",
    analysisDate: "4th - 7th August 2025",
    auditDate: "3rd October 2025",
    auditComments: loadSavedAuditComments(),
    preparedBy: "RCM Planning",
  });

  useEffect(() => {
    window.localStorage.setItem(AUDIT_COMMENTS_STORAGE_KEY, JSON.stringify(reportMeta.auditComments));
    window.localStorage.removeItem(AUDIT_COMMENT_STORAGE_KEY);
  }, [reportMeta.auditComments]);

  const implementedRows = useMemo(
    () => summary?.rows.filter((row) => row.implemented && strategyIsActionable(row.recommendedStrategy)) ?? [],
    [summary],
  );
  const revisedRows = useMemo(
    () => summary?.rows.filter((row) => strategyIsActionable(row.recommendedStrategy)) ?? [],
    [summary],
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError("");
    setIsLoading(true);
    try {
      const nextSummary = await buildAnalysisFromFile(file);
      setSummary(nextSummary);
      setReportMeta((current) => ({
        ...current,
        station: nextSummary.metadata.site || current.station,
        assetName: nextSummary.metadata.assetName || current.assetName,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be analysed.");
    } finally {
      setIsLoading(false);
      event.target.value = "";
    }
  }

  async function handleExport() {
    if (!summary) {
      return;
    }
    setIsExporting(true);
    setError("");
    try {
      await exportPatchedPptx(summary, reportMeta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PowerPoint export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleWorkingFileExport() {
    if (!summary) {
      return;
    }
    setIsWorkingExporting(true);
    setError("");
    try {
      await exportWorkingFile(summary, reportMeta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The working-file export failed.");
    } finally {
      setIsWorkingExporting(false);
    }
  }

  async function handlePdfExport() {
    if (!summary) {
      return;
    }
    setIsPdfExporting(true);
    setError("");
    try {
      exportPdfReport(summary, reportMeta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PDF report export failed.");
    } finally {
      setIsPdfExporting(false);
    }
  }

  function handleSubmitAuditComment() {
    const nextComment = auditDraft.trim();
    if (!nextComment) {
      return;
    }

    setReportMeta((current) => ({
      ...current,
      auditComments: [...current.auditComments, nextComment],
    }));
    setAuditDraft("");
  }

  function handleRemoveAuditComment(index: number) {
    setReportMeta((current) => ({
      ...current,
      auditComments: current.auditComments.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  const themeStyle = {
    "--theme-bg": "url('aspirasi-rt2-theme.png')",
  } as CSSProperties;

  return (
    <main className="dashboard-shell" style={themeStyle}>
      <section className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">RCM digital report</p>
          <h1>Reliability Centered Maintenance Analyser</h1>
          <p className="topbar-subtitle">Aspirasi RT2.0 styled maintenance intelligence for generation assets.</p>
        </div>
        <div className="topbar-right">
          <div className="brand-lockup" aria-label="TNB Genco">
            <img alt="TNB Genco" src="tnb-genco-logo.png" />
          </div>
          <div className="top-actions">
            <label className="file-button">
              <input accept=".xlsx,.xlsm" onChange={handleFile} type="file" />
              {isLoading ? "Reading workbook..." : "Upload raw data"}
            </label>
            <button disabled={!summary || isExporting} onClick={handleExport} type="button">
              {isExporting ? "Preparing PPT..." : "Export PowerPoint"}
            </button>
            <button disabled={!summary || isWorkingExporting} onClick={handleWorkingFileExport} type="button">
              {isWorkingExporting ? "Preparing XLSM..." : "Export Working File"}
            </button>
            <button disabled={!summary || isPdfExporting} onClick={handlePdfExport} type="button">
              {isPdfExporting ? "Preparing PDF..." : "Export PDF Report"}
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="report-layout">
        <aside className="side-panel">
          <div className="panel-heading">
            <h2>Report Profile</h2>
          </div>
          <label>
            <span>Station</span>
            <input
              onChange={(event) => setReportMeta({ ...reportMeta, station: event.target.value })}
              value={reportMeta.station}
            />
          </label>
          <label>
            <span>RCM ID</span>
            <input readOnly value={summary?.metadata.rcmId || "Awaiting upload"} />
          </label>
          <label>
            <span>System</span>
            <input
              onChange={(event) => setReportMeta({ ...reportMeta, assetName: event.target.value })}
              value={reportMeta.assetName}
            />
          </label>
          <label>
            <span>Analysis Date</span>
            <input
              onChange={(event) => setReportMeta({ ...reportMeta, analysisDate: event.target.value })}
              value={reportMeta.analysisDate}
            />
          </label>
          <label>
            <span>Audit Date</span>
            <input
              onChange={(event) => setReportMeta({ ...reportMeta, auditDate: event.target.value })}
              value={reportMeta.auditDate}
            />
          </label>
          <label className="comment-field">
            <span>RCM Audit Comment</span>
            <textarea
              onChange={(event) => setAuditDraft(event.target.value)}
              placeholder="Type management comment for the audit session report..."
              rows={5}
              value={auditDraft}
            />
          </label>
          <button
            className="comment-submit"
            disabled={!auditDraft.trim()}
            onClick={handleSubmitAuditComment}
            type="button"
          >
            Submit Comment
          </button>
          <div className="comment-list">
            {reportMeta.auditComments.length ? (
              reportMeta.auditComments.map((comment, index) => (
                <article className="comment-item" key={`${comment}-${index}`}>
                  <span>Comment {index + 1}</span>
                  <p>{comment}</p>
                  <button onClick={() => handleRemoveAuditComment(index)} type="button">
                    Remove
                  </button>
                </article>
              ))
            ) : (
              <small>No submitted audit comments.</small>
            )}
          </div>
          <div className="source-box">
            <span>Source</span>
            <strong>{summary?.fileName ?? "No workbook loaded"}</strong>
            <small>{summary ? `${summary.sheetName} - ${summary.totalRows} RCM rows` : "Awaiting upload"}</small>
          </div>
          <VisitorCounter />
        </aside>

        <section className="main-panel">
          <div className="report-header">
            <div>
              <p>3. ANALYSIS</p>
              <h2>Summary of the RCM Analysis Result</h2>
            </div>
            <span>{summary?.metadata.rcmId || "RCM dashboard"}</span>
          </div>

          <div className="metric-grid">
            <MetricCard
              label="Functions analysed"
              note={`${summary?.functionsExisting ?? 0} existing`}
              value={summary?.functionsRevised ?? "-"}
            />
            <MetricCard
              label="Failure modes"
              note={`${summary?.failureModesExisting ?? 0} existing`}
              value={summary?.failureModesRevised ?? "-"}
            />
            <MetricCard
              label="Maintenance tasks"
              note={`${summary?.pendingTasks ?? 0} newly added`}
              value={summary?.actionableTasks ?? "-"}
            />
            <MetricCard
              label="Task executed"
              note={summary ? pct(summary.executedTasks, summary.actionableTasks) : "0%"}
              value={summary?.executedTasks ?? "-"}
            />
          </div>

          <div className="insight-grid">
            <section className="data-panel strategy-panel">
              <div className="panel-heading">
                <h3>Maintenance strategy</h3>
                <span>{summary?.actionableTasks ?? 0} tasks</span>
              </div>
              <div className="strategy-content">
                <StrategyDonut items={summary?.topStrategies ?? []} />
                <div className="legend-list">
                  {(summary?.topStrategies ?? []).map((item, index) => (
                    <div className="legend-row" key={item.code}>
                      <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                      <span>{item.code}</span>
                      <strong>{item.revised}</strong>
                    </div>
                  ))}
                  {!summary ? <p className="empty-note">Upload raw RCM data to populate the report.</p> : null}
                </div>
              </div>
            </section>

            <section className="data-panel">
              <div className="panel-heading">
                <h3>Task ownership</h3>
                <span>{summary?.workCenters.length ?? 0} trades</span>
              </div>
              {summary ? <WorkCenterBars items={summary.workCenters} /> : <div className="empty-block" />}
            </section>
          </div>

          <section className="data-panel">
            <div className="panel-heading">
              <h3>Workbook summary logic</h3>
              <span>Existing vs revised</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Strategy</th>
                    <th>Existing</th>
                    <th>Revised</th>
                    <th>New</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.strategySummary ?? STRATEGIES.map(([code, label, actionable]) => ({
                    code,
                    label,
                    actionable,
                    existing: 0,
                    revised: 0,
                  }))).map((item) => (
                    <tr key={item.code}>
                      <td>{item.code}</td>
                      <td>{item.label}</td>
                      <td>{item.existing}</td>
                      <td>{item.revised}</td>
                      <td>{Math.max(0, item.revised - item.existing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="comparison-grid">
            <TablePreview rows={implementedRows} title="Current Maintenance Plan" />
            <TablePreview rows={revisedRows} title="RCM Recommended Maintenance Plan" />
          </div>

          <section className="data-panel">
            <div className="panel-heading">
              <h3>Duplicate task check</h3>
              <span>{summary?.duplicateRows.length ?? 0} repeated task groups</span>
            </div>
            <div className="duplicate-list">
              {(summary?.duplicateRows ?? []).map((row) => (
                <div className="duplicate-item" key={row.duplicateKey}>
                  <strong>{row.failureMode}</strong>
                  <span>{row.proposedTask || "No proposed task"}</span>
                  <em>{row.duplicateCount} rows</em>
                </div>
              ))}
              {summary && !summary.duplicateRows.length ? (
                <p className="empty-note">No duplicate failure-mode/task combinations found.</p>
              ) : null}
              {!summary ? <p className="empty-note">Duplicate checks will appear after upload.</p> : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
