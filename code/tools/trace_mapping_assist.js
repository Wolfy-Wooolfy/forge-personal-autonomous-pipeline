const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

async function main() {
  const root = path.resolve(__dirname, "../../");

  const tracePath = path.join(root, "artifacts/trace/trace_matrix.json");
  if (!fs.existsSync(tracePath)) {
    console.log("Missing trace_matrix.json");
    return;
  }

  const trace = JSON.parse(fs.readFileSync(tracePath, "utf-8"));

  const input = {
    orphan_code_units: trace.orphan_code_units || [],
    orphan_requirements: trace.orphan_requirements || [],
    orphan_artifacts: trace.orphan_artifacts || []
  };

  if (
    input.orphan_code_units.length === 0 &&
    input.orphan_requirements.length === 0 &&
    input.orphan_artifacts.length === 0
  ) {
    console.log("No ambiguity detected — nothing to analyze");
    return;
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const prompt = `
You are assisting in TRACE mapping.

Return ONLY JSON in this format:
{
  "candidate_mappings": [
    {
      "requirement": "...",
      "code_units": [],
      "artifacts": [],
      "confidence": 0.0,
      "reasoning": "..."
    }
  ]
}

Input:
${JSON.stringify(input, null, 2)}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1",
    temperature: 0,
    messages: [
      { role: "system", content: "Strict JSON only" },
      { role: "user", content: prompt }
    ]
  });

  const content = response.choices[0].message.content;

  const outDir = path.join(root, "artifacts/llm/outputs");
  fs.mkdirSync(outDir, { recursive: true });

  const fileName = `trace_mapping_${Date.now()}.json`;
  const outPath = path.join(outDir, fileName);

  fs.writeFileSync(outPath, content);

  console.log("Saved:", outPath);
}

main().catch(err => {
  console.error("ERROR:", err.message);
});