const fs = require("fs");
const path = require("path");

function readJson(absPath) {
  const txt = fs.readFileSync(absPath, "utf-8");
  return JSON.parse(txt);
}

function safeMkdir(dirAbs) {
  fs.mkdirSync(dirAbs, { recursive: true });
}

function listFilesRecursive(rootAbs) {
  const out = [];
  const stack = [rootAbs];
  while (stack.length) {
    const cur = stack.pop();
    if (!fs.existsSync(cur)) continue;
    const st = fs.statSync(cur);
    if (st.isDirectory()) {
      const items = fs.readdirSync(cur);
      for (let i = items.length - 1; i >= 0; i--) {
        stack.push(path.join(cur, items[i]));
      }
      continue;
    }
    out.push(cur);
  }
  out.sort();
  return out;
}

function extractDocId(docText) {
  const m = docText.match(/Document ID:\s*([A-Za-z0-9\-\_]+)/i);
  if (m && m[1]) return String(m[1]).trim();
  const m2 = docText.match(/DOC-\d+/i);
  if (m2 && m2[0]) return String(m2[0]).trim();
  return "";
}

function normalizeTitle(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRequirementsFromDocs(docsDirAbs) {
  const mdFiles = listFilesRecursive(docsDirAbs).filter((p) => p.toLowerCase().endsWith(".md"));
  const requirements = [];
  for (const abs of mdFiles) {
    const rel = abs.replace(/\\/g, "/");
    const text = fs.readFileSync(abs, "utf-8");
    const docId = extractDocId(text) || path.basename(abs).replace(/\.md$/i, "");
    const lines = text.split(/\r?\n/);

    const headings = [];
    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || "");
      if (line.startsWith("# ")) headings.push({ level: 1, title: normalizeTitle(line.slice(2)), line: i + 1 });
      else if (line.startsWith("## ")) headings.push({ level: 2, title: normalizeTitle(line.slice(3)), line: i + 1 });
    }

    let localIdx = 0;
    if (headings.length === 0) {
      localIdx += 1;
      requirements.push({
        requirement_id: `${docId}::R${String(localIdx).padStart(3, "0")}`,
        source_document: rel,
        section_path: "",
        normalized_title: path.basename(abs)
      });
      continue;
    }

    let currentH1 = "";
    for (const h of headings) {
      if (h.level === 1) currentH1 = h.title || "";
      localIdx += 1;
      const sectionPath = h.level === 1 ? currentH1 : `${currentH1} > ${h.title}`;
      requirements.push({
        requirement_id: `${docId}::R${String(localIdx).padStart(3, "0")}`,
        source_document: rel,
        section_path: sectionPath,
        normalized_title: h.title || ""
      });
    }
  }

  requirements.sort((a, b) => {
    if (a.source_document < b.source_document) return -1;
    if (a.source_document > b.source_document) return 1;
    if (a.requirement_id < b.requirement_id) return -1;
    if (a.requirement_id > b.requirement_id) return 1;
    return 0;
  });

  return requirements;
}

function extractExportedSymbols(jsText) {
  const symbols = new Set();

  const reExportsDot = /exports\.([A-Za-z0-9_]+)\s*=/g;
  let m;
  while ((m = reExportsDot.exec(jsText)) !== null) {
    if (m[1]) symbols.add(m[1]);
  }

  const reModuleExportsObj = /module\.exports\s*=\s*\{([\s\S]*?)\}/g;
  const objMatch = reModuleExportsObj.exec(jsText);
  if (objMatch && objMatch[1]) {
    const body = objMatch[1];
    const reKey = /([A-Za-z0-9_]+)\s*:/g;
    let k;
    while ((k = reKey.exec(body)) !== null) {
      if (k[1]) symbols.add(k[1]);
    }
  }

  return Array.from(symbols).sort();
}

function buildCodeUnitsFromSrc(codeSrcAbs, rootAbs) {
  const jsFiles = listFilesRecursive(codeSrcAbs).filter((p) => p.toLowerCase().endsWith(".js"));
  const units = [];
  for (const abs of jsFiles) {
    const rel = path.relative(rootAbs, abs).replace(/\\/g, "/");
    const text = fs.readFileSync(abs, "utf-8");
    const syms = extractExportedSymbols(text);

    if (syms.length === 0) {
      units.push({
        unit_id: `CODE::${rel}::FILE`,
        file_path: rel,
        exported_symbol: "FILE",
        detected_role: "FILE"
      });
      continue;
    }

    for (const s of syms) {
      units.push({
        unit_id: `CODE::${rel}::${s}`,
        file_path: rel,
        exported_symbol: s,
        detected_role: "EXPORT"
      });
    }
  }
  units.sort((a, b) => (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0));
  return units;
}

function buildArtifactsIndex(artifactsAbs, rootAbs) {
  const files = listFilesRecursive(artifactsAbs).filter((p) => {
    const low = p.toLowerCase();
    if (low.endsWith(".md")) return true;
    if (low.endsWith(".json")) return true;
    return false;
  });

  const rels = files.map((abs) => path.relative(rootAbs, abs).replace(/\\/g, "/")).sort();
  return rels;
}

function mapDeterministically(requirements, codeUnits, artifacts) {
  const codeByKey = new Map();
  for (const u of codeUnits) {
    codeByKey.set(u.unit_id, u);
  }

  const artifactsSet = new Set(artifacts);

  const mappings = requirements.map((r) => {
    const title = String(r.normalized_title || "").toLowerCase();

    const mapped_code_units = [];
    const mapped_artifacts = [];

    if (title.includes("intake")) {
      for (const u of codeUnits) if (u.file_path.includes("modules/intakeEngine.js")) mapped_code_units.push(u.unit_id);
      if (artifactsSet.has("artifacts/intake/intake_snapshot.json")) mapped_artifacts.push("artifacts/intake/intake_snapshot.json");
    }

    if (title.includes("audit")) {
      for (const u of codeUnits) if (u.file_path.includes("modules/auditEngine.js")) mapped_code_units.push(u.unit_id);
      if (artifactsSet.has("artifacts/audit/audit_report.md")) mapped_artifacts.push("artifacts/audit/audit_report.md");
      if (artifactsSet.has("artifacts/audit/audit_findings.json")) mapped_artifacts.push("artifacts/audit/audit_findings.json");
    }

    const uniqCode = Array.from(new Set(mapped_code_units)).sort();
    const uniqArt = Array.from(new Set(mapped_artifacts)).sort();

    let coverage_status = "NONE";
    if (uniqCode.length > 0 && uniqArt.length > 0) coverage_status = "FULL";
    else if (uniqCode.length > 0 || uniqArt.length > 0) coverage_status = "PARTIAL";

    return {
      requirement_id: r.requirement_id,
      document: r.source_document,
      mapped_code_units: uniqCode,
      mapped_artifacts: uniqArt,
      coverage_status
    };
  });

  const usedCode = new Set();
  const usedArtifacts = new Set();
  const coveredReq = new Set();

  for (const m of mappings) {
    if (m.coverage_status !== "NONE") coveredReq.add(m.requirement_id);
    for (const u of m.mapped_code_units) usedCode.add(u);
    for (const a of m.mapped_artifacts) usedArtifacts.add(a);
  }

  const orphan_code_units = codeUnits.map((u) => u.unit_id).filter((id) => !usedCode.has(id)).sort();
  const orphan_artifacts = artifacts.filter((a) => !usedArtifacts.has(a)).sort();
  const orphan_requirements = requirements.map((r) => r.requirement_id).filter((id) => !coveredReq.has(id)).sort();

  return { mappings, orphan_code_units, orphan_requirements, orphan_artifacts };
}

function writeTraceOutputs(rootAbs, traceJson) {
  const traceDir = path.resolve(rootAbs, "artifacts", "trace");
  safeMkdir(traceDir);

  const jsonAbs = path.resolve(traceDir, "trace_matrix.json");
  fs.writeFileSync(jsonAbs, JSON.stringify(traceJson, null, 2), "utf-8");

  const mdAbs = path.resolve(traceDir, "trace_matrix.md");
  const md = [
    "# Trace Matrix",
    "",
    "~~~json",
    JSON.stringify(traceJson, null, 2),
    "~~~",
    ""
  ].join("\n");
  fs.writeFileSync(mdAbs, md, "utf-8");

  return {
    json: "artifacts/trace/trace_matrix.json",
    md: "artifacts/trace/trace_matrix.md"
  };
}

function writeTraceError(rootAbs, msg) {
  const traceDir = path.resolve(rootAbs, "artifacts", "trace");
  safeMkdir(traceDir);

  const errAbs = path.resolve(traceDir, "trace_error.md");
  const md = [
    "# Trace Error",
    "",
    String(msg || "").trim(),
    ""
  ].join("\n");
  fs.writeFileSync(errAbs, md, "utf-8");

  return "artifacts/trace/trace_error.md";
}

function runTrace(contextOrStatus) {
  const rootAbs = path.resolve(__dirname, "../../..");

  const artifactsIntakeAbs = path.resolve(rootAbs, "artifacts", "intake", "intake_snapshot.json");
  const artifactsAuditAbs = path.resolve(rootAbs, "artifacts", "audit", "audit_findings.json");

  if (!fs.existsSync(artifactsIntakeAbs)) {
    const errRef = writeTraceError(rootAbs, "BLOCKED: missing required artifact artifacts/intake/intake_snapshot.json");
    return {
      blocked: true,
      artifact: errRef,
      status_patch: {
        blocking_questions: ["Trace BLOCKED: missing intake_snapshot.json"],
      next_step: ""
      }
    };
  }

  if (!fs.existsSync(artifactsAuditAbs)) {
    const errRef = writeTraceError(rootAbs, "BLOCKED: missing required artifact artifacts/audit/audit_findings.json");
    return {
      blocked: true,
      artifact: errRef,
      status_patch: {
        blocking_questions: ["Trace BLOCKED: missing audit_findings.json"],
      next_step: ""
      }
    };
  }

  const intake = readJson(artifactsIntakeAbs);
  const audit = readJson(artifactsAuditAbs);

  const locked = !!(intake && intake.locked_snapshot_flag);
  const auditBlocked = !!(audit && audit.blocked);

  if (!locked) {
    const errRef = writeTraceError(rootAbs, "BLOCKED: intake_snapshot.locked_snapshot_flag != true");
    return {
      blocked: true,
      artifact: errRef,
      status_patch: {
        blocking_questions: ["Trace BLOCKED: intake snapshot not locked"],
      next_step: ""
      }
    };
  }

  if (auditBlocked) {
    const errRef = writeTraceError(rootAbs, "BLOCKED: audit_findings.blocked == true");
    return {
      blocked: true,
      artifact: errRef,
      status_patch: {
        blocking_questions: ["Trace BLOCKED: audit blocked == true"],
      next_step: ""
      }
    };
  }

  const requirements = buildRequirementsFromDocs(path.resolve(rootAbs, "docs", "03_pipeline"));
  const codeUnits = buildCodeUnitsFromSrc(path.resolve(rootAbs, "code", "src"), rootAbs);
  const artifacts = buildArtifactsIndex(path.resolve(rootAbs, "artifacts"), rootAbs);

  const mapped = mapDeterministically(requirements, codeUnits, artifacts);

  const traceJson = {
    execution_id: `TRACE-${new Date().toISOString()}`,
    total_requirements: requirements.length,
    total_code_units: codeUnits.length,
    total_artifacts: artifacts.length,
    mappings: mapped.mappings,
    orphan_code_units: mapped.orphan_code_units,
    orphan_requirements: mapped.orphan_requirements,
    orphan_artifacts: mapped.orphan_artifacts
  };

  const outRefs = writeTraceOutputs(rootAbs, traceJson);

  return {
    blocked: false,
    artifact: outRefs.md,
    outputs: outRefs,
    status_patch: {}
  };
}

module.exports = {
  runTrace
};