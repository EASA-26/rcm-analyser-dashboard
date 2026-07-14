"use client";

import { ChangeEvent, useMemo, useState } from "react";

type CellValue = string | number | boolean | null;

type RawRow = Record<string, CellValue>;

type RCMRow = {
  site: string;
  rcmId: string;
  rcmNo: string;
  version: string;
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
  "#1f77b4",
  "#e15759",
  "#59a14f",
  "#f28e2b",
  "#76b7b2",
  "#b07aa1",
  "#edc949",
  "#4e79a7",
];

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

function summarizeRows(fileName: string, sheetName: string, rows: RCMRow[]): AnalysisSummary {
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

  const site = rows.find((row) => row.site)?.site ?? "";
  const rcmId = rows.find((row) => row.rcmId)?.rcmId ?? "";
  const assetName =
    rows.find((row) => row.rcmId)?.rcmId?.split("-").slice(-1)[0]?.replace(/[._]/g, " ") ||
    "Uploaded RCM Asset";

  return {
    fileName,
    sheetName,
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

  return summarizeRows(file.name, bestSheet.name, rcmRows);
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

function createZip(entries: Map<string, Uint8Array>) {
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

  return new Blob([...localParts, ...centralParts, end], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
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

async function exportPatchedPptx(summary: AnalysisSummary, meta: ReportMeta) {
  const response = await fetch("/report-template.pptx");
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
      patchSlideTexts(slideOne, [
        {
          includes: "RCM Analysis Final Report",
          text: `RCM Analysis Final Report ${meta.station} ${meta.assetName} Analysis Date : ${meta.analysisDate} Audit Session Date : ${meta.auditDate}`,
        },
      ]),
    ),
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

  const output = createZip(entries);
  const url = URL.createObjectURL(output);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `RCM Analysis Final Report - ${meta.assetName || "Dashboard"}.pptx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

export default function RCMDashboard() {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [reportMeta, setReportMeta] = useState<ReportMeta>({
    station: "Station",
    assetName: "Generator Transformers",
    analysisDate: "4th - 7th August 2025",
    auditDate: "3rd October 2025",
    preparedBy: "RCM Planning",
  });

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

  return (
    <main className="dashboard-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">RCM digital report</p>
          <h1>Reliability Centered Maintenance analyser</h1>
        </div>
        <div className="top-actions">
          <label className="file-button">
            <input accept=".xlsx,.xlsm" onChange={handleFile} type="file" />
            {isLoading ? "Reading workbook..." : "Upload raw data"}
          </label>
          <button disabled={!summary || isExporting} onClick={handleExport} type="button">
            {isExporting ? "Preparing PPT..." : "Export PowerPoint"}
          </button>
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
          <div className="source-box">
            <span>Source</span>
            <strong>{summary?.fileName ?? "No workbook loaded"}</strong>
            <small>{summary ? `${summary.sheetName} - ${summary.totalRows} RCM rows` : "Awaiting upload"}</small>
          </div>
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
