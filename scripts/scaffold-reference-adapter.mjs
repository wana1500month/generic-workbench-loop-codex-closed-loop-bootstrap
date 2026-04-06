import {
  scaffoldReferenceAdapter,
  supportedTemplates
} from "./reference-adapter-template.mjs";

const args = process.argv.slice(2);
const outputDirectory = args.find((value) => !value.startsWith("--"));
const templateFlagIndex = args.findIndex((value) => value === "--template");
const template =
  templateFlagIndex >= 0 ? args[templateFlagIndex + 1] : "canonical-api";

if (!outputDirectory) {
  console.error(
    `Usage: node ./scripts/scaffold-reference-adapter.mjs <output-dir> [--template ${supportedTemplates.join("|")}]`
  );
  process.exit(1);
}

if (!supportedTemplates.includes(template)) {
  console.error(
    `Unsupported template '${template}'. Expected one of ${supportedTemplates.join(", ")}.`
  );
  process.exit(1);
}

const result = await scaffoldReferenceAdapter({
  outputDirectory,
  template
});

console.log(
  `[reference-adapter:scaffold] created ${result.template} template at ${result.outputDirectory}`
);
